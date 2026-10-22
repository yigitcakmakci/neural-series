"use strict";
const fs = require("fs");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const { sleep, targets, waitTarget, attach } = require("../../tools/cdp");

const SP = __dirname;
const OUT = path.join(require("os").tmpdir(), "neural-testler"); // screenshots and throwaway profiles
fs.mkdirSync(OUT, { recursive: true });
const ELECTRON = path.join(__dirname, "..", "..", "node_modules", "electron", "dist", "electron.exe");
const SNAP = path.join(__dirname, "..", "..", "tools", "snap-window.ps1");
const PORT = 9340;
const profile = path.join(OUT, "web-profile-smoke");
fs.rmSync(profile, { recursive: true, force: true });

(async () => {
  const log = [];
  const app = spawn(ELECTRON, [path.join(SP, "..", "..", "out", "stage", "apps", "NeuralWeb"), `--remote-debugging-port=${PORT}`], { env: { ...process.env, NEURALWEB_PROFILE: profile }, stdio: ["ignore", "pipe", "pipe"] });
  app.stdout.on("data", (d) => log.push(String(d)));
  app.stderr.on("data", (d) => log.push(String(d)));
  try {
    const ui = await attach(await waitTarget(PORT, (t) => t.url.includes("/ui/index.html")));
    await sleep(4000);
    const r = await ui.evaluate(`return { tabs: document.querySelectorAll('.tab').length, title: document.querySelector('.tab-title') && document.querySelector('.tab-title').textContent, omni: document.activeElement && document.activeElement.id, vp: JSON.stringify(document.querySelector('#viewport').getBoundingClientRect()) };`);
    console.log("UI:", JSON.stringify(r));
    console.log("targets:", (await targets(PORT)).map((t) => `${t.type} ${t.url}`).join("\n  "));
    const snap = (name) => execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", SNAP, "-ProcessName", "electron", "-Out", path.join(OUT, name)], { stdio: "pipe" });
    snap("web-smoke.png");
    await ui.evaluate(`nw.cmd("settings"); return 1;`);
    await sleep(2500);
    snap("web-smoke-settings.png");
    const page = await attach(await waitTarget(PORT, (t) => t.url.startsWith("neural://settings")));
    console.log("settings:", await page.evaluate(`return document.querySelector('#versions').textContent + ' | profiles=' + document.querySelector('#edge-profile').options.length;`));
    page.close();
    ui.close();
  } catch (e) {
    console.log("ERROR", e.message);
  }
  app.kill();
  await sleep(500);
  console.log("LOG:\n" + log.join("").slice(-3000));
})();
