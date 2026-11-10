"use strict";
// The update check across running programs, against a local "GitHub" (never the real one): NeuralTerm and NeuralPad
// from out\stage start together, ask once, announce once, show the newer version in their menus, open its page in
// NeuralWeb (a fake installation and the hand-off log), and the switch reaches the series file.
//   node tests\shared\test-update-e2e.js
require("../../tools/lang-env")(); // Turkish texts; the update state below replaces the switched-off default
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const { spawn, execFileSync } = require("child_process");
const { sleep, waitTarget, attach } = require("../../tools/cdp");

const ROOT = path.join(__dirname, "..", "..");
const ELECTRON = path.join(ROOT, "node_modules", "electron", "dist", "electron.exe");
const BOX = path.join(os.tmpdir(), "neural-testler", "update-e2e");
const STATE = path.join(BOX, "NeuralSeries", "update.json");
const NOTIFY = path.join(BOX, "notify.jsonl");
const LAUNCH = path.join(BOX, "launch.jsonl");
const FAKE = path.join(BOX, "Neural");
const PAGE = "https://github.com/yigitcakmakci/neural-series/releases/tag/v9.9.9";
let passed = 0, failed = 0;
const check = (cond, label, extra = "") => { if (cond) { passed++; console.log("  ok   " + label); } else { failed++; console.log("  FAIL " + label + (extra ? "  -> " + extra : "")); } };
const lines = (f) => { try { return fs.readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse); } catch (e) { return []; } };
const state = () => { try { return JSON.parse(fs.readFileSync(STATE, "utf8")); } catch (e) { return {}; } };

fs.rmSync(BOX, { recursive: true, force: true });
fs.mkdirSync(path.dirname(STATE), { recursive: true });
fs.writeFileSync(STATE, JSON.stringify({ enabled: true }));
for (const n of ["NeuralWeb"]) { const p = path.join(FAKE, n, "Program", `${n}.exe`); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, ""); }
const requests = [];
const server = http.createServer((req, res) => {
  requests.push(req.url);
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ tag_name: "v9.9.9", html_url: PAGE, name: "v9.9.9 · Test" }));
});
const procs = [];
function launch(name, port) {
  const ud = path.join(BOX, "ud", name);
  const env = {
    ...process.env, NEURAL_UPDATE_FILE: STATE, NEURAL_UPDATE_URL: `http://127.0.0.1:${server.address().port}/latest`, NEURAL_UPDATE_DELAY: "1500",
    NEURAL_TEST_NOTIFY: NOTIFY, NEURAL_TEST_LAUNCH: LAUNCH, NEURAL_ROOT: FAKE, NEURAL_THEME_FILE: path.join(BOX, "theme.json"),
  };
  const p = spawn(ELECTRON, [path.join(ROOT, "out", "stage", "apps", name), `--user-data-dir=${ud}`, `--remote-debugging-port=${port}`, "--disable-background-timer-throttling", "--disable-renderer-backgrounding"], { env, stdio: "ignore" });
  procs.push(p);
}
const PRELUDE = `const q = s => document.querySelector(s); const qa = s => [...document.querySelectorAll(s)];
  const wait = async (fn, ms = 6000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = fn(); if (v) return v; } catch {} await new Promise(r => setTimeout(r, 100)); } return null; };`;

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  console.log("two programs start together");
  launch("NeuralTerm", 9371);
  launch("NeuralPad", 9372);
  const term = await attach(await waitTarget(9371, (t) => /index\.html/.test(t.url), 30000));
  const pad = await attach(await waitTarget(9372, (t) => /index\.html/.test(t.url), 30000));
  for (let i = 0; i < 60 && lines(NOTIFY).length === 0; i++) await sleep(200);
  await sleep(1500);
  check(requests.length === 1, "one question to GitHub for both", String(requests.length));
  const n = lines(NOTIFY);
  check(n.length === 1 && n[0].title === "Neural Series 9.9.9 çıktı" && n[0].url === PAGE, "one notification, in Turkish, for the release page", JSON.stringify(n));
  const s = state();
  check(s.latest && s.latest.version === "9.9.9" && s.notified === "9.9.9" && s.enabled === true, "the series file keeps the answer and the announcement", JSON.stringify(s));

  console.log("menus");
  const T = (body) => term.evaluate(PRELUDE + body);
  let r = await T(`window.dispatchEvent(new Event('focus')); await new Promise(r => setTimeout(r, 400)); q('#menu-btn').click(); await wait(() => q('.popup')); return qa('.popup .mi').map(b => b.textContent);`);
  check(r.some((x) => /Yeni sürümleri denetle/.test(x) && /✓/.test(x)), "NeuralTerm: 'Yeni sürümleri denetle' is ticked", JSON.stringify(r));
  check(r.some((x) => /Yeni sürüm: v9\.9\.9/.test(x)), "NeuralTerm: 'Yeni sürüm: v9.9.9' is in the menu");
  await T(`qa('.popup .mi').find(b => /Yeni sürüm: v9/.test(b.textContent)).click(); return 1;`);
  for (let i = 0; i < 30 && !lines(LAUNCH).length; i++) await sleep(200);
  const l = lines(LAUNCH);
  check(l.length === 1 && l[0].program === "NeuralWeb" && l[0].args[0] === PAGE, "it opens the release page in NeuralWeb", JSON.stringify(l));
  await T(`q('#menu-btn').click(); await wait(() => q('.popup')); qa('.popup .mi').find(b => /Yeni sürümleri denetle/.test(b.textContent)).click(); return 1;`);
  for (let i = 0; i < 30 && state().enabled !== false; i++) await sleep(200);
  check(state().enabled === false && state().latest.version === "9.9.9", "switching it off in NeuralTerm writes the series file and keeps the rest");
  const P = (body) => pad.evaluate(PRELUDE + body);
  r = await P(`window.dispatchEvent(new Event('focus')); await new Promise(r => setTimeout(r, 400)); qa('#menubar button, #menubar .mb').find(b => /Görünüm/.test(b.textContent)).click(); await wait(() => q('.popup')); return qa('.popup .mi').map(b => b.textContent);`);
  check(r.some((x) => /Yeni sürümleri denetle/.test(x) && !/✓/.test(x)) && r.some((x) => /Yeni sürüm: v9\.9\.9/.test(x)), "NeuralPad's menu follows: unticked, the newer version still listed", JSON.stringify(r));
  check(requests.length === 1, "and nobody asked GitHub again", String(requests.length));

  for (const p of procs) { try { execFileSync("taskkill", ["/T", "/F", "/PID", String(p.pid)], { stdio: "ignore" }); } catch (e) { /* gone */ } }
  server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error("ERROR:", e.message);
  for (const p of procs) { try { execFileSync("taskkill", ["/T", "/F", "/PID", String(p.pid)], { stdio: "ignore" }); } catch (x) { /* gone */ } }
  process.exit(2);
});
