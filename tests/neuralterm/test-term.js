"use strict";
// Drives the installed NeuralTerm through the Chrome DevTools protocol.
const fs = require("fs");
const path = require("path");
const { spawn, execFileSync } = require("child_process");

const SP = __dirname;
const OUT = path.join(require("os").tmpdir(), "neural-testler"); // screenshots and throwaway profiles
fs.mkdirSync(OUT, { recursive: true });
// The installed NeuralTerm; NEURAL_ROOT points at another installation, such as one made with setup /test.
const EXE = path.join(process.env.NEURAL_ROOT || path.join(process.env.USERPROFILE, "Neural"), "NeuralTerm", "Program", "NeuralTerm.exe");
const SNAP = path.join(__dirname, "..", "..", "tools", "snap-window.ps1");
const PORT = 9334;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
const check = (cond, label, extra = "") => { if (cond) { passed++; console.log("  ok   " + label); } else { failed++; console.log("  FAIL " + label + (extra ? "  -> " + extra : "")); } };

// A throwaway settings folder: the real %APPDATA%\NeuralTerm is never touched.
const PROFILE = path.join(OUT, "term-profile");
fs.rmSync(PROFILE, { recursive: true, force: true });
// Paths to Ctrl+click (a short folder, so they fit on one row), and a fake series installation whose hand-offs only
// go into a log (NEURAL_TEST_LAUNCH): nothing starts.
const BOX = path.join(OUT, "tl");
fs.rmSync(BOX, { recursive: true, force: true });
fs.mkdirSync(path.join(BOX, "Alt Klasör"), { recursive: true });
fs.writeFileSync(path.join(BOX, "not.txt"), "not");
const FAKE = path.join(OUT, "term-handoff");
fs.rmSync(FAKE, { recursive: true, force: true });
for (const n of ["NeuralNav", "NeuralWeb"]) { const p = path.join(FAKE, n, "Program", `${n}.exe`); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, ""); }
const LOG = path.join(FAKE, "launch.jsonl");
const logged = () => { try { return fs.readFileSync(LOG, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse); } catch (e) { return []; } };
const waitLog = async (fn) => { for (let i = 0; i < 40; i++) { const hit = logged().find(fn); if (hit) return hit; await sleep(150); } return null; };

async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const page = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === "page");
      if (page) {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        let id = 0;
        const waiting = new Map();
        ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); } };
        const call = (method, params) => new Promise((res) => { const n = ++id; waiting.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });
        const evaluate = async (expr) => {
          const r = await call("Runtime.evaluate", { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
          if (r.result && r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || "eval failed");
          return r.result?.result?.value;
        };
        return { call, evaluate, close: () => ws.close() };
      }
    } catch (e) { /* not up yet */ }
    await sleep(500);
  }
  throw new Error("no debugging port");
}

(async () => {
  const app = spawn(EXE, [SP, `--user-data-dir=${PROFILE}`, `--remote-debugging-port=${PORT}`], { env: { ...process.env, NEURAL_ROOT: FAKE, NEURAL_TEST_LAUNCH: LOG }, stdio: "ignore" });
  const cdp = await connect();
  const run = (body) => cdp.evaluate(`
    const q = s => document.querySelector(s);
    const qa = s => [...document.querySelectorAll(s)];
    const wait = async (fn, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = fn(); if (v) return v; } catch {} await new Promise(r => setTimeout(r, 100)); } return null; };
    const rawText = () => { const t = qa('.term').find(t => !t.hidden); return t ? t.querySelector('.xterm-rows').innerText : ''; };
    const screenText = () => rawText().replace(/(scratchpad|-3f|-3f4ca)\\n/g, '$1').replace(/\\n(4ca9276f58|9276f58)/g, '$1');
    ${body}`);
  const type = async (text) => {
    await run(`qa('.term').find(t => !t.hidden).querySelector('textarea').focus(); return true;`);
    await cdp.call("Input.insertText", { text });
    await cdp.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
    await cdp.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  };
  const key = async (k, code, vk, mods) => {
    await cdp.call("Input.dispatchKeyEvent", { type: "rawKeyDown", key: k, code, windowsVirtualKeyCode: vk, modifiers: mods });
    await cdp.call("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, modifiers: mods });
  };

  console.log("PowerShell");
  let r = await run(`await wait(() => /PS .+neuralterm>/.test(screenText())); return { text: screenText().slice(0, 400), tabs: qa('.tab').length, shell: q('#st-shell').textContent, size: q('#st-size').textContent };`);
  check(/PS .+neuralterm>/.test(r.text), "PowerShell starts in the folder given on the command line", JSON.stringify(r));
  check(r.shell === "Windows PowerShell" && /^\d+×\d+$/.test(r.size), "status shows the shell and the terminal size", JSON.stringify(r));
  await type('Write-Output "NEURAL-$((2+3)*7) ğüşıöç İ"');
  r = await run(`return await wait(() => /NEURAL-35 ğüşıöç İ/.test(screenText())) ? 'yes' : screenText().slice(-400);`);
  check(r === "yes", "a command runs and Turkish output is correct", r);
  await type("cmd /c echo yerel-program çğüşİ");
  r = await run(`return await wait(() => /\\nyerel-program çğüşİ/.test(screenText())) ? 'yes' : screenText().slice(-400);`);
  check(r === "yes", "a native program's Turkish output is correct (UTF-8 code page)", r);
  await run(`window.nt.clipWrite('Write-Output yapistirildi-42'); return true;`);
  await key("v", "KeyV", 86, 2);
  await sleep(300);
  await key("Enter", "Enter", 13, 0);
  await cdp.call("Input.dispatchKeyEvent", { type: "char", text: "\r" });
  r = await run(`return await wait(() => /\\nyapistirildi-42/.test(screenText())) ? (screenText().match(/yapistirildi-42/g) || []).length : screenText().slice(-300);`);
  check(r === 2, "Ctrl+V pastes from the clipboard exactly once (command line + its output)", String(r));
  execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", SNAP, "-ProcessName", "NeuralTerm", "-Out", path.join(OUT, "term-1.png")], { stdio: "pipe" });

  console.log("Komut İstemi tab");
  r = await run(`q('#tab-shells').click(); await wait(() => q('.popup')); qa('.popup .mi').find(b => b.textContent.includes('Komut İstemi')).click(); await wait(() => qa('.tab').length === 2 && /neuralterm>/.test(screenText())); return { tabs: qa('.tab').length, text: screenText().slice(0, 300) };`);
  check(r.tabs === 2 && /neuralterm>/.test(r.text) && !/�/.test(r.text), "a Komut İstemi tab opens in the same folder without broken characters", JSON.stringify(r));
  await type("echo merhaba-cmd ğüş");
  r = await run(`return await wait(() => /\\nmerhaba-cmd ğüş/.test(screenText())) ? 'yes' : screenText().slice(-300);`);
  check(r === "yes", "cmd runs commands", r);
  await type("exit");
  r = await run(`await wait(() => qa('.tab').length === 1); return { tabs: qa('.tab').length, shell: q('#st-shell').textContent };`);
  check(r.tabs === 1 && r.shell === "Windows PowerShell", "'exit' closes the tab and returns to PowerShell", JSON.stringify(r));

  console.log("failing command keeps the tab");
  await run(`q('#tab-new').click(); await wait(() => qa('.tab').length === 2 && /PS .+>/.test(screenText())); return true;`);
  await type("exit 3");
  r = await run(`await wait(() => q('.tab.dead')); return { dead: !!q('.tab.dead'), text: screenText().slice(-200) };`);
  check(r.dead && /3 koduyla sonlandı/.test(r.text), "a non-zero exit keeps the tab with a note", JSON.stringify(r));
  await key("Enter", "Enter", 13, 0);
  await cdp.call("Input.dispatchKeyEvent", { type: "char", text: "\r" });
  r = await run(`await wait(() => !q('.tab.dead') && /PS .+>/.test(screenText())); return { alive: !q('.tab.dead'), shell: q('#st-shell').textContent };`);
  check(r.alive, "Enter restarts the shell in that tab");
  check(r.shell === "Windows PowerShell", "the status bar no longer says it ended", JSON.stringify(r));

  console.log("links: Ctrl+click");
  // A shell that has just started may drop the first keys it gets, so the folder change is retried once.
  const inBox = () => run(`return !!(await wait(() => screenText().trim().endsWith(${JSON.stringify("PS " + BOX + ">")}), 6000));`);
  await sleep(1500);
  await type(`Set-Location '${BOX}'`);
  r = await inBox();
  if (!r) { await type(`Set-Location '${BOX}'`); r = await inBox(); }
  check(r, "the shell is in the links folder", await run(`return screenText().slice(-300);`));
  await type(`Write-Output 'mutlak: ${BOX}\\Alt Klasör' 'göreli: .\\not.txt hazır' 'site: https://example.com/yol?x=1.' 'yok: C:\\yok\\boyle-bir-yer'`);
  await run(`return await wait(() => /\\nyok: C:/.test(screenText()));`);
  // The screen point of a word on the output row that starts with prefix (the DOM renderer draws one div per row).
  const pointAt = (prefix, word) => run(`
    const box = qa('.term').find(t => !t.hidden);
    const rows = [...box.querySelectorAll('.xterm-rows > div')].map(d => ({ d, t: d.textContent.replace(/\\u00a0/g, ' ') }));
    const row = rows.find(x => x.t.startsWith(${JSON.stringify(prefix)}));
    if (!row) return null;
    const scr = box.querySelector('.xterm-screen').getBoundingClientRect();
    const cw = scr.width / +q('#st-size').textContent.split('×')[0];
    const rr = row.d.getBoundingClientRect();
    return { x: scr.left + (row.t.indexOf(${JSON.stringify(word)}) + 1) * cw + cw / 2, y: rr.top + rr.height / 2 };`);
  const mouse = (pt, type, modifiers = 0) => cdp.call("Input.dispatchMouseEvent", { type, x: pt.x, y: pt.y, modifiers, button: type === "mouseMoved" ? "none" : "left", clickCount: type === "mouseMoved" ? 0 : 1 });
  const hover = async (pt) => {
    await mouse({ x: pt.x, y: pt.y + 120 }, "mouseMoved");
    await sleep(150);
    await mouse(pt, "mouseMoved");
    await sleep(600);
    return run(`return { pointer: !!qa('.term').find(t => !t.hidden).querySelector('.xterm-cursor-pointer'), tip: q('#link-tip.show')?.textContent || '' };`);
  };
  const click = async (pt, modifiers) => { await mouse(pt, "mousePressed", modifiers); await mouse(pt, "mouseReleased", modifiers); };
  let pt = await pointAt("mutlak: ", "Alt Klasör");
  r = await hover(pt);
  check(r.pointer && r.tip === "Ctrl+tıkla: NeuralNav'da aç", "over a folder path: link cursor and the tip", JSON.stringify(r));
  await click(pt, 0);
  await sleep(700);
  check(logged().length === 0, "a plain click opens nothing", JSON.stringify(logged()));
  await click(pt, 2);
  check(await waitLog((l) => l.by === "NeuralTerm" && l.program === "NeuralNav" && l.args[0] === path.join(BOX, "Alt Klasör")), "Ctrl+click opens the folder (with a space in its name) in NeuralNav", JSON.stringify(logged()));
  pt = await pointAt("göreli: ", "not.txt");
  r = await hover(pt);
  check(r.pointer && r.tip === "Ctrl+tıkla: NeuralNav'da göster", "a relative file path is a link too", JSON.stringify(r));
  await click(pt, 2);
  check(await waitLog((l) => l.program === "NeuralNav" && l.args[0] === path.join(BOX, "not.txt")), "it resolves against the prompt's folder and opens selected in NeuralNav", JSON.stringify(logged()));
  pt = await pointAt("site: ", "example");
  r = await hover(pt);
  check(r.pointer && r.tip === "Ctrl+tıkla: NeuralWeb'de aç", "a web address is a link", JSON.stringify(r));
  await click(pt, 2);
  check(await waitLog((l) => l.program === "NeuralWeb" && l.args[0] === "https://example.com/yol?x=1"), "Ctrl+click opens it in NeuralWeb, without the full stop", JSON.stringify(logged()));
  pt = await pointAt("yok: ", "boyle");
  r = await hover(pt);
  check(!r.pointer, "a path that does not exist is not a link", JSON.stringify(r));
  await click(pt, 2);
  await sleep(700);
  check(logged().length === 3, "nothing else was opened", JSON.stringify(logged()));
  execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", SNAP, "-ProcessName", "NeuralTerm", "-Out", path.join(OUT, "term-links.png")], { stdio: "pipe" });

  console.log("close");
  await run(`window.nt.confirmClose(); return true;`).catch(() => {});
  for (let i = 0; i < 20 && app.exitCode === null; i++) await sleep(250);
  check(app.exitCode !== null, "window closes and the app exits");
  const left = execFileSync("powershell", ["-NoProfile", "-Command", "(Get-Process ntpty -ErrorAction SilentlyContinue | Measure-Object).Count"], { encoding: "utf8" }).trim();
  check(left === "0", "no shell bridges are left running", left);
  cdp.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("ERROR:", e.message); process.exit(2); });
