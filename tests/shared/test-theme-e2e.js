"use strict";
// The series theme across running programs: NeuralPad, NeuralTerm, NeuralView and NeuralWeb at once, NeuralNav
// started later. Themes are picked through each program's own menu (NeuralWeb through the command its menu sends).
// Throwaway profiles and a temp theme file (NEURAL_THEME_FILE): the real %APPDATA% is not touched.
//   node tests\shared\test-theme-e2e.js            the staged build (out\stage, run with node_modules\electron)
//   set NEURAL_ROOT=<root>                         an installed copy (setup /test)
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn, execFileSync } = require("child_process");
const { sleep, targets, waitTarget, attach } = require("../../tools/cdp");

const ROOT = path.join(__dirname, "..", "..");
const OUT = path.join(os.tmpdir(), "neural-testler", "theme-e2e");
const FILE = path.join(OUT, "NeuralSeries", "theme.json");
const ELECTRON = path.join(ROOT, "node_modules", "electron", "dist", "electron.exe");
const APPS = {
  NeuralPad: { port: 9351, page: /index\.html/ },
  NeuralTerm: { port: 9352, page: /index\.html/ },
  NeuralView: { port: 9353, page: /index\.html/ },
  NeuralWeb: { port: 9354, page: /ui\/index\.html/ },
  NeuralNav: { port: 9355, page: /index\.html/ },
};
let passed = 0, failed = 0;
const check = (cond, label, extra = "") => { if (cond) { passed++; console.log("  ok   " + label); } else { failed++; console.log("  FAIL " + label + (extra ? "  -> " + extra : "")); } };

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const procs = [];
function launch(name) {
  const ud = path.join(OUT, "ud", name);
  const env = { ...process.env, NEURAL_THEME_FILE: FILE };
  // Windows behind others slow their timers down, which only slows the test's own menu driving.
  let args = [`--remote-debugging-port=${APPS[name].port}`, "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding"];
  if (name === "NeuralWeb") { env.NEURALWEB_PROFILE = ud; env.NEURALWEB_EDGE_DIR = path.join(OUT, "no-edge"); } else args.unshift(`--user-data-dir=${ud}`);
  let exe = ELECTRON;
  if (process.env.NEURAL_ROOT) exe = path.join(process.env.NEURAL_ROOT, name, "Program", `${name}.exe`);
  else args = [path.join(ROOT, "out", "stage", "apps", name), ...args];
  const p = spawn(exe, args, { env, stdio: "ignore" });
  procs.push(p);
  return p;
}

const PRELUDE = `
  const q = s => document.querySelector(s); const qa = s => [...document.querySelectorAll(s)];
  const wait = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = fn(); if (v) return v; } catch {} await new Promise(r => setTimeout(r, 30)); } return null; };
  const theme = () => (document.documentElement.className.match(/theme-(\\w+)/) || [])[1] || '';
  const item = label => qa('.mi').find(b => (b.querySelectorAll('span')[1]?.textContent || '').trim() === label);
  const pick = async (opener, labels) => {
    const o = typeof opener === 'string' ? q(opener) : opener();
    o.click();
    for (const l of labels) { const b = await wait(() => item(l)); if (!b) throw new Error('menu item not found: ' + l); b.click(); await new Promise(r => setTimeout(r, 40)); }
  };
`;
// How each program opens its theme menu (label of the theme, or the follow-the-series item).
const MENU = {
  NeuralPad: (label) => `await pick(() => qa('#menubar > button').find(b => b.textContent === 'Görünüm'), ['Tema', ${JSON.stringify(label)}]);`,
  NeuralView: (label) => `await pick(() => qa('#menubar > button').find(b => b.textContent === 'Görünüm'), ['Tema', ${JSON.stringify(label)}]);`,
  NeuralTerm: (label) => `await pick('#menu-btn', ['Tema', ${JSON.stringify(label)}]);`,
  NeuralNav: (label) => `await pick('[data-cmd="more"]', ['Tema', ${JSON.stringify(label)}]);`,
};
const NAMES = { neon: "Neon", ice: "Buz", alarm: "Alarm", daylight: "Gündüz" };
const SYNC = "Temayı seriyle eşitle";

(async () => {
  const c = {};
  try {
    for (const n of ["NeuralPad", "NeuralTerm", "NeuralView", "NeuralWeb"]) launch(n);
    for (const n of ["NeuralPad", "NeuralTerm", "NeuralView", "NeuralWeb"]) c[n] = await attach(await waitTarget(APPS[n].port, (t) => APPS[n].page.test(t.url), 30000));
    const run = (n, body) => c[n].evaluate(PRELUDE + body);
    const themeOf = (n) => run(n, "await wait(() => theme()); return theme();");
    const all = async (names) => Object.fromEntries(await Promise.all(names.map(async (n) => [n, await themeOf(n)])));
    const setVia = (n, id) => (n === "NeuralWeb" ? run(n, `nw.cmd('theme', ${JSON.stringify(id)}); return 1;`) : run(n, MENU[n](NAMES[id]) + "return 1;"));
    const toggleSync = (n) => (n === "NeuralWeb" ? run(n, "nw.cmd('syncTheme'); return 1;") : run(n, MENU[n](SYNC) + "return 1;"));
    const file = () => { try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch (e) { return null; } };
    // Waits until every named program shows `id`; returns the milliseconds it took, or -1.
    const until = async (names, id, ms = 3000, t0 = Date.now()) => {
      while (Date.now() - t0 < ms) {
        const s = await all(names);
        if (Object.values(s).every((v) => v === id)) return Date.now() - t0;
        await sleep(40);
      }
      return -1;
    };
    const FOUR = ["NeuralPad", "NeuralTerm", "NeuralView", "NeuralWeb"];
    // Picks a theme in one program and returns how long the others took to follow once that program showed it
    // (-1: they did not within 3 s). Driving the menu is timed apart.
    const change = async (n, id, names) => {
      const t0 = Date.now();
      await setVia(n, id);
      const click = Date.now() - t0;
      // Every program is asked on its own, so a busy one does not delay the others' times.
      const arrival = async (x) => { while (Date.now() - t0 < 3000) { if ((await themeOf(x)) === id) return Date.now() - t0; await sleep(20); } return -1; };
      const times = Object.fromEntries(await Promise.all(names.map(async (x) => [x, await arrival(x)])));
      const local = times[n] ?? (await until([n], id, 3000, t0));
      const total = Object.values(times).every((v) => v >= 0) ? Math.max(...Object.values(times)) : -1;
      console.log(`        (${n}: menu ${click} ms, own window ${local} ms; ${Object.entries(times).filter(([x]) => x !== n).map(([x, ms]) => `${x.replace("Neural", "")} ${ms}`).join(", ")})`);
      return local < 0 || total < 0 ? -1 : total - local;
    };

    console.log("start");
    await sleep(4000); // NeuralWeb's main process is busy for a moment after startup (it builds the ad blocker)
    let s = await all(FOUR);
    check(Object.values(s).every((v) => v === "neon") && !file(), "four programs open with their own theme (Neon); no series theme yet", JSON.stringify(s));

    console.log("one change, everyone follows");
    let ms = await change("NeuralPad", "ice", FOUR);
    check(ms >= 0 && ms <= 1000, `NeuralPad → Buz: the other three follow in ${ms} ms (≤ 1000)`, JSON.stringify(await all(FOUR)));
    check(file() && file().theme === "ice" && file().by.startsWith("NeuralPad:"), "theme.json says ice, by NeuralPad", JSON.stringify(file()));
    ms = await change("NeuralWeb", "alarm", FOUR);
    check(ms >= 0 && ms <= 1000, `NeuralWeb → Alarm: the others follow in ${ms} ms`, JSON.stringify(await all(FOUR)));
    ms = await change("NeuralTerm", "daylight", FOUR);
    check(ms >= 0 && ms <= 1000, `NeuralTerm → Gündüz: the others follow in ${ms} ms`);
    ms = await change("NeuralView", "ice", FOUR);
    check(ms >= 0 && ms <= 1000, `NeuralView → Buz: the others follow in ${ms} ms`);

    console.log("following switched off");
    await toggleSync("NeuralTerm");
    await setVia("NeuralView", "alarm");
    await until(["NeuralPad", "NeuralView", "NeuralWeb"], "alarm");
    await sleep(1200);
    s = await all(FOUR);
    check(s.NeuralTerm === "ice" && s.NeuralPad === "alarm" && s.NeuralWeb === "alarm", "NeuralTerm (off) keeps Buz while the others go Alarm", JSON.stringify(s));
    await setVia("NeuralTerm", "neon");
    await sleep(1200);
    s = await all(FOUR);
    check(s.NeuralTerm === "neon" && s.NeuralPad === "alarm" && file().theme === "alarm", "and its own change does not reach the others", JSON.stringify(s));
    const saved = await run("NeuralTerm", "return JSON.parse(localStorage.getItem('neuralterm.settings')).syncTheme;");
    check(saved === false, "the setting is saved as off");
    await toggleSync("NeuralTerm");
    ms = await until(["NeuralTerm"], "alarm");
    check(ms >= 0, "switched on again, NeuralTerm takes the series theme (Alarm)");
    await toggleSync("NeuralWeb");
    await setVia("NeuralPad", "daylight");
    await until(["NeuralPad", "NeuralTerm", "NeuralView"], "daylight");
    await sleep(1200);
    s = await all(FOUR);
    check(s.NeuralWeb === "alarm", "NeuralWeb with the setting off stays Alarm", JSON.stringify(s));
    await toggleSync("NeuralWeb");
    ms = await until(["NeuralWeb"], "daylight");
    check(ms >= 0, "and follows again once it is on");

    console.log("rapid and simultaneous changes");
    const seq = ["ice", "alarm", "neon", "daylight", "ice", "alarm"];
    await Promise.all([
      (async () => { for (const t of seq) await setVia("NeuralPad", t); })(),
      (async () => { for (const t of [...seq].reverse()) await setVia("NeuralView", t); })(),
    ]);
    await sleep(1500);
    s = await all(FOUR);
    const f1 = file();
    check(Object.values(s).every((v) => v === f1.theme), `after 12 changes from two programs everyone agrees on ${f1.theme}`, JSON.stringify({ s, f1 }));
    const m1 = fs.statSync(FILE).mtimeMs;
    await sleep(2000);
    const s2 = await all(FOUR);
    check(JSON.stringify(s2) === JSON.stringify(s) && fs.statSync(FILE).mtimeMs === m1, "and it stays still: no program writes back, no flicker");

    console.log("windows of one program");
    await run("NeuralPad", "np.newWindow(); return 1;");
    let ids = [];
    for (let i = 0; i < 60 && ids.length < 2; i++) { ids = (await targets(APPS.NeuralPad.port)).filter((t) => t.type === "page" && /index\.html/.test(t.url)); await sleep(200); }
    const second = ids.find((t) => /yeni=1/.test(t.url));
    const c2 = second && await attach(second);
    const target = f1.theme === "daylight" ? "ice" : "daylight"; // never the default, so a fresh profile must change
    if (c2) {
      await c2.evaluate(PRELUDE + "await wait(() => theme()); return 1;");
      const t0 = Date.now();
      await c2.evaluate(PRELUDE + MENU.NeuralPad(NAMES[target]) + "return 1;");
      ms = await until(FOUR, target, 3000, t0);
      check(ms >= 0 && ms <= 1000, `a second NeuralPad window changes it: the first window and the others follow in ${ms} ms`);
      c2.close();
    } else check(false, "a second NeuralPad window opened");

    console.log("a program started later");
    launch("NeuralNav");
    c.NeuralNav = await attach(await waitTarget(APPS.NeuralNav.port, (t) => APPS.NeuralNav.page.test(t.url), 30000));
    const navTheme = await run("NeuralNav", "await wait(() => theme()); await new Promise(r => setTimeout(r, 300)); return theme();");
    check(navTheme === target, `NeuralNav starts with the series theme (${target})`, navTheme);
    const navSaved = await run("NeuralNav", "return JSON.parse(localStorage.getItem('neuralnav.settings') || '{}').theme;");
    check(navSaved === target, "and remembers it", navSaved);
    ms = await change("NeuralNav", "alarm", [...FOUR, "NeuralNav"]);
    check(ms >= 0 && ms <= 1000, `NeuralNav → Alarm: all five follow in ${ms} ms`);
    const padSaved = await run("NeuralPad", "return JSON.parse(localStorage.getItem('neuralpad.settings')).theme;");
    check(padSaved === "alarm", "a follower saves the theme too (it starts with it next time)", padSaved);
    check(!fs.existsSync(path.join(process.env.APPDATA, "NeuralSeries", "theme.json")) || fs.statSync(path.join(process.env.APPDATA, "NeuralSeries", "theme.json")).mtimeMs < Date.now() - 600000,
      "the real %APPDATA%\\NeuralSeries was not written");
  } catch (e) {
    failed++;
    console.log("  FAIL " + e.stack);
  } finally {
    for (const x of Object.values(c)) { try { x.close(); } catch (e) { /* closed */ } }
    for (const p of procs) { try { execFileSync("taskkill", ["/T", "/F", "/PID", String(p.pid)], { stdio: "ignore" }); } catch (e) { /* gone */ } }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
