"use strict";
// Unit tests of apps\shared\update-check.js with plain Node against a local server (never GitHub): one question a
// day for the whole series, one notification per version, nothing personal in the request.
//   node tests\shared\test-update-check.js
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const { create, newer, parse } = require("../../apps/shared/update-check");

const DIR = path.join(os.tmpdir(), "neural-testler", "update-unit");
const FILE = path.join(DIR, "NeuralSeries", "update.json"); // the folder does not exist yet
const NOTIFY = path.join(DIR, "notify.jsonl");
const HOUR = 3600e3, DAY = 24 * HOUR;
let passed = 0, failed = 0;
const check = (cond, label, extra = "") => { if (cond) { passed++; console.log("  ok   " + label); } else { failed++; console.log("  FAIL " + label + (extra ? "  -> " + extra : "")); } };

fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
// The local "GitHub": its answer can be changed; every request is recorded.
let answer = { status: 200, body: { tag_name: "v1.7.0", html_url: "https://github.com/yigitcakmakci/neural-series/releases/tag/v1.7.0", name: "v1.7.0 · Test" } };
const requests = [];
const server = http.createServer((req, res) => {
  requests.push({ url: req.url, headers: req.headers });
  setTimeout(() => {
    res.writeHead(answer.status, { "content-type": "application/json" });
    res.end(typeof answer.body === "string" ? answer.body : JSON.stringify(answer.body));
  }, 50);
});
const texts = { "update.notify.title": "Neural Series {version} çıktı", "update.notify.body": "Tıkla." };
const T = (k, v) => String(texts[k] || k).replace(/\{(\w+)\}/g, (m, x) => (v && v[x] !== undefined ? v[x] : m));
let clock = Date.UTC(2026, 10, 10, 9, 0, 0);
const opened = [];
const make = (name, version = "1.6.0", extra = {}) => create({
  name, version, t: T, fetch, Notification: null, open: (u) => opened.push(u), file: FILE,
  env: { NEURAL_UPDATE_URL: `http://127.0.0.1:${server.address().port}/repos/x/releases/latest`, NEURAL_TEST_NOTIFY: NOTIFY }, now: () => clock, ...extra,
});
const notes = () => { try { return fs.readFileSync(NOTIFY, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse); } catch (e) { return []; } };
const state = () => JSON.parse(fs.readFileSync(FILE, "utf8"));

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  console.log("versions");
  check(parse("v1.6.0").join() === "1,6,0" && parse("1.10.2").join() === "1,10,2" && parse("v1.6") === null && parse("x") === null, "reads v1.6.0 and 1.6.0, refuses the rest");
  check(newer("1.10.0", "1.9.9") && newer("v2.0.0", "1.99.99") && !newer("1.6.0", "1.6.0") && !newer("1.5.9", "1.6.0") && !newer("bozuk", "1.0.0"), "compares numerically, not as text");

  console.log("one question a day");
  const nav = make("NeuralNav");
  let s = await nav.check();
  check(requests.length === 1 && s.latest && s.latest.version === "1.7.0" && /releases\/tag\/v1\.7\.0$/.test(s.latest.url), "the first check asks and keeps the answer", JSON.stringify(s));
  check(fs.existsSync(FILE) && state().lastCheck === clock && /^NeuralNav:\d+$/.test(state().by), "the state file is written (the folder made on the way)");
  const h = requests[0].headers;
  check(h["user-agent"] === "Neural-Series-update-check" && !h.cookie && !h.authorization && requests[0].url === "/repos/x/releases/latest", "the request carries a generic User-Agent and nothing else about the user", JSON.stringify(h));
  clock += 5 * HOUR;
  await make("NeuralPad").check();
  check(requests.length === 1, "another program the same day does not ask again");
  clock += 20 * HOUR;
  await make("NeuralWeb").check();
  check(requests.length === 2, "a day later the next program asks");
  check(fs.readdirSync(path.dirname(FILE)).every((f) => !/\.(tmp|lock)$/.test(f)), "no temporary or lock file is left behind", fs.readdirSync(path.dirname(FILE)).join(","));

  console.log("programs that start together");
  clock += DAY;
  await Promise.all(["NeuralCalc", "NeuralTerm", "NeuralView", "NeuralDeck"].map((n) => make(n).check()));
  check(requests.length === 3, "four programs at once: one question", String(requests.length));
  clock += DAY;
  fs.writeFileSync(FILE + ".lock", "");
  await make("NeuralDeck").check();
  check(requests.length === 3, "a fresh lock (another program asking right now) is respected");
  fs.utimesSync(FILE + ".lock", new Date(Date.now() - 120e3), new Date(Date.now() - 120e3));
  await make("NeuralDeck").check();
  check(requests.length === 4 && !fs.existsSync(FILE + ".lock"), "a lock left by a crash (older than a minute) is cleared");

  console.log("one notification per version");
  fs.rmSync(NOTIFY, { force: true });
  check(nav.announce(state()) === true && make("NeuralWeb").announce(state()) === false, "the first program announces 1.7.0, the next does not");
  let n = notes();
  check(n.length === 1 && n[0].title === "Neural Series 1.7.0 çıktı" && n[0].by === "NeuralNav" && /v1\.7\.0$/.test(n[0].url) && state().notified === "1.7.0", "the notification: title, and the page it opens", JSON.stringify(n));
  check(make("NeuralPad", "1.7.0").announce({ ...state(), notified: null }) === false && make("NeuralPad", "1.8.0").announce({ ...state(), notified: null }) === false, "no notification when the program is already that new");
  check(nav.state().latest && nav.state().latest.version === "1.7.0" && make("X", "1.7.0").state().latest === null, "the menus see the newer version only where it is newer");
  check(nav.openLatest() === true && opened[0] === "https://github.com/yigitcakmakci/neural-series/releases/tag/v1.7.0", "the menu entry opens the release page");
  answer.body = { ...answer.body, tag_name: "v1.8.0", html_url: "https://github.com/yigitcakmakci/neural-series/releases/tag/v1.8.0" };
  clock += DAY;
  await nav.run();
  n = notes();
  check(n.length === 2 && n[1].title === "Neural Series 1.8.0 çıktı", "the next version is announced again (run: check + announce)", JSON.stringify(n));

  console.log("when GitHub does not answer well");
  const count = requests.length;
  for (const [status, body, label] of [[404, { message: "Not Found" }, "no release (404)"], [500, "{", "a server error with broken JSON"], [200, { tag_name: "nightly", html_url: "https://github.com/x" }, "an unexpected tag"], [200, { tag_name: "v9.0.0", html_url: "https://evil.example/" }, "a page outside github.com"]]) {
    answer = { status, body };
    clock += DAY;
    s = await nav.check();
    check(s.lastError && s.latest.version === "1.8.0", `${label}: the last good answer stays, the error is noted`, JSON.stringify(s));
  }
  check(requests.length === count + 4, "each of those days asked once");
  clock += 2 * HOUR;
  await nav.check();
  check(requests.length === count + 4, "after a failure: not again within 3 hours");
  clock += 1.5 * HOUR;
  answer = { status: 200, body: { tag_name: "v1.8.1", html_url: "https://github.com/yigitcakmakci/neural-series/releases/tag/v1.8.1" } };
  s = await nav.check();
  check(requests.length === count + 5 && s.latest.version === "1.8.1" && !s.lastError, "but 3 hours later, and the error clears");

  console.log("switched off");
  const before = requests.length;
  check(nav.setEnabled(false).enabled === false && state().enabled === false, "the switch is saved for the series");
  clock += 3 * DAY;
  await make("NeuralTerm").run();
  check(requests.length === before && make("NeuralTerm").state().enabled === false, "no question while it is off");
  check(make("X", "1.0.0").announce(state()) === false, "and no notification");
  nav.setEnabled(true);
  await new Promise((r) => setTimeout(r, 300));
  check(requests.length === before + 1 && state().enabled === true, "switching it on asks right away");

  console.log("start");
  const t0 = requests.length;
  clock += DAY;
  const timed = make("NeuralDeck", "1.6.0", { env: { NEURAL_UPDATE_URL: `http://127.0.0.1:${server.address().port}/x`, NEURAL_UPDATE_DELAY: "100", NEURAL_TEST_NOTIFY: NOTIFY } });
  timed.start();
  await new Promise((r) => setTimeout(r, 600));
  timed.stop();
  check(requests.length === t0 + 1, "start() checks after NEURAL_UPDATE_DELAY");

  server.close();
  fs.rmSync(DIR, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("ERROR:", e.stack); process.exit(2); });
