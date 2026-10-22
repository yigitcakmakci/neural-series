"use strict";
// Closing a NeuralWeb window while the pointer rests on a link must not crash the main process: the tabs are destroyed
// after the window and still report the hovered link (bug fixed in 1.2.1, "Object has been destroyed").
//   node tests\neuralweb\test-close.js             the staged build (out\stage, run with node_modules\electron)
//   node tests\neuralweb\test-close.js --installed C:\path\to\NeuralWeb.exe
// Throwaway profile, no Edge folder, a temp series theme file; the page comes from a local server.
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const { spawn, execFileSync } = require("child_process");
const { sleep, waitTarget, attach } = require("../../tools/cdp");

const ROOT = path.join(__dirname, "..", "..");
const OUT = path.join(os.tmpdir(), "neural-testler", "web-close");
const i = process.argv.indexOf("--installed");
const EXE = i > 0 ? process.argv[i + 1] : path.join(ROOT, "node_modules", "electron", "dist", "electron.exe");
const ARGS = i > 0 ? [] : [path.join(ROOT, "out", "stage", "apps", "NeuralWeb")];
const PORT = 9361;
const ROUNDS = Number(process.env.ROUNDS) || 6;
let passed = 0, failed = 0;
const check = (cond, label, extra = "") => { if (cond) { passed++; console.log("  ok   " + label); } else { failed++; console.log("  FAIL " + label + (extra ? "  -> " + extra : "")); } };

const PAGE = `<!doctype html><meta charset="utf-8"><title>Bağlantı</title>
<style>html,body{margin:0;height:100%;background:#05070c} a{display:block;height:50%;font:40px sans-serif;color:#fcee0a;background:#0c0d15}</style>
<a href="/hedef-sayfa">Bu bağlantının üzerinde dur</a><p>boş alan</p>`;
const server = http.createServer((req, res) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(PAGE); });

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  for (let round = 1; round <= ROUNDS; round++) {
    const dir = path.join(OUT, String(round)); // a fresh profile each round; the last process may still hold the old one
    fs.rmSync(dir, { recursive: true, force: true });
    const env = { ...process.env, NEURALWEB_PROFILE: path.join(dir, "profile"), NEURALWEB_EDGE_DIR: path.join(dir, "no-edge"), NEURAL_THEME_FILE: path.join(dir, "theme.json") };
    const app = spawn(EXE, [...ARGS, url, `--remote-debugging-port=${PORT}`], { env, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    app.stderr.on("data", (d) => { stderr += d; });
    const exited = new Promise((r) => app.on("exit", (code) => r(code)));
    try {
      const page = await attach(await waitTarget(PORT, (t) => t.url.startsWith(url), 30000));
      const ui = await attach(await waitTarget(PORT, (t) => /ui\/index\.html/.test(t.url), 30000));
      await page.evaluate("await new Promise(r => document.readyState === 'complete' ? r() : addEventListener('load', r)); return 1;");
      await sleep(1500);
      // The pointer rests on the link: Chromium reports the target URL to the main process.
      for (let k = 0; k < 4; k++) { await page.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: 200 + k * 10, y: 120 }); await sleep(120); }
      const hover = await ui.evaluate("return document.body.innerText.includes('hedef-sayfa');").catch(() => false);
      // While the window closes, the pointer keeps crossing the edge of the link, so the page keeps reporting a new
      // target URL (the link, then none) and some reports arrive while the window is being torn down.
      let moving = true;
      (async () => {
        for (let k = 0; moving && k < 400; k++) {
          page.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: 200, y: k % 2 ? 60 : 400 }).catch(() => { moving = false; });
          await sleep(3);
        }
      })();
      await sleep(150);
      await ui.evaluate("nw.cmd('closeWindow'); return 1;").catch(() => 0);
      const code = await Promise.race([exited, sleep(10000).then(() => "zaman asimi")]);
      moving = false;
      // A main-process exception opens Electron's error box and keeps the process alive; its title gives it away.
      let boxes = "";
      if (code !== 0 && app.exitCode === null) {
        try {
          boxes = execFileSync("powershell", ["-NoProfile", "-Command",
            `Add-Type -Name W -Namespace N -MemberDefinition '[DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, System.IntPtr l); public delegate bool EnumProc(System.IntPtr h, System.IntPtr l); [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(System.IntPtr h, out int pid); [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(System.IntPtr h, System.Text.StringBuilder s, int n); [DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr h);'; $o = @(); [N.W]::EnumWindows({ param($h, $l) $p = 0; [void][N.W]::GetWindowThreadProcessId($h, [ref]$p); if ($p -eq ${app.pid} -and [N.W]::IsWindowVisible($h)) { $sb = New-Object System.Text.StringBuilder 256; [void][N.W]::GetWindowText($h, $sb, 256); if ($sb.Length) { $script:o += $sb.ToString() } }; $true }, [IntPtr]::Zero) | Out-Null; $o -join ' | '`],
            { encoding: "utf8" }).trim();
        } catch (e) { boxes = "?"; }
      }
      const crash = /Uncaught Exception|Object has been destroyed/.test(stderr) || /^Error$|\| Error|Error \|/.test(boxes);
      check(code === 0 && !crash, `round ${round}: link hovered${hover ? " (shown in the status line)" : ""}, window closed, the process ends cleanly`,
        JSON.stringify({ code, windows: boxes, stderr: stderr.split("\n").filter((l) => /Error|Exception|destroyed/.test(l)).slice(0, 3) }));
      page.close(); ui.close();
    } catch (e) {
      failed++;
      console.log(`  FAIL round ${round}: ${e.message}`);
    } finally {
      if (app.exitCode === null) { try { execFileSync("taskkill", ["/T", "/F", "/PID", String(app.pid)], { stdio: "ignore" }); } catch (e) { /* gone */ } }
    }
  }
  server.close();
  await sleep(1000);
  try { fs.rmSync(OUT, { recursive: true, force: true }); } catch (e) { /* removed next time */ }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
