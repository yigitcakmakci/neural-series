"use strict";
// Drives NeuralDeck through the Chrome DevTools protocol. Nothing is really started or copied: NEURALDECK_TEST_LAUNCH
// records it in a file, and NEURAL_ROOT points at a folder of fake programs (NeuralView is left out on purpose).
// Throwaway profiles, a temp series theme file and test shortcuts that nobody else uses.
//   node tests\neuraldeck\test-deck.js                     the staged build (out\stage, run with node_modules\electron)
//   set NEURALDECK_EXE=<root>\NeuralDeck\Program\NeuralDeck.exe   an installed copy (setup /test)
// Also checks NeuralCalc on the shared engine: set NEURALCALC_EXE for an installed copy.
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn, execFileSync } = require("child_process");
const { sleep, waitTarget, attach } = require("../../tools/cdp");

const ROOT = path.join(__dirname, "..", "..");
const OUT = path.join(os.tmpdir(), "neural-testler", "deck-e2e");
const FAKE = path.join(OUT, "Neural");
const BOX = path.join(OUT, "Arşiv Kutusu");
const LAUNCH = path.join(OUT, "launch.txt");
const THEME = path.join(OUT, "NeuralSeries", "theme.json");
const ELECTRON = path.join(ROOT, "node_modules", "electron", "dist", "electron.exe");
const STAGE = (name) => path.join(ROOT, "out", "stage", "apps", name);
const SHORTCUT = "Ctrl+Alt+Shift+F12";
let passed = 0, failed = 0;
const check = (cond, label, extra = "") => { if (cond) { passed++; console.log("  ok   " + label); } else { failed++; console.log("  FAIL " + label + (extra ? "  -> " + extra : "")); } };
const j = (x) => JSON.stringify(x);

fs.rmSync(OUT, { recursive: true, force: true });
for (const app of ["NeuralCalc", "NeuralPad", "NeuralNav", "NeuralTerm", "NeuralWeb"]) {
  fs.mkdirSync(path.join(FAKE, app, "Program"), { recursive: true });
  fs.writeFileSync(path.join(FAKE, app, "Program", `${app}.exe`), "");
}
for (const d of ["Belgeler", "Belgeler\\Proje", "Resimler"]) fs.mkdirSync(path.join(BOX, d), { recursive: true });
fs.writeFileSync(path.join(BOX, "Belgeler", "not defteri.txt"), "x");
fs.writeFileSync(path.join(BOX, "Resimler", "galata.jpg"), "x");
const launches = () => { try { return fs.readFileSync(LAUNCH, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch (e) { return []; } };
const exe = (app) => path.join(FAKE, app, "Program", `${app}.exe`);

const procs = [];
function start(name, port, { profileSettings, args = [] } = {}) {
  const profile = path.join(OUT, "profile-" + name);
  fs.mkdirSync(profile, { recursive: true });
  if (profileSettings) fs.writeFileSync(path.join(profile, "settings.json"), JSON.stringify(profileSettings));
  const env = { ...process.env, NEURALDECK_PROFILE: profile, NEURALDECK_TEST_LAUNCH: LAUNCH, NEURAL_ROOT: FAKE, NEURAL_THEME_FILE: THEME, NEURALDECK_KEEP_OPEN: "1" };
  const p = process.env.NEURALDECK_EXE
    ? spawn(process.env.NEURALDECK_EXE, [...args, `--remote-debugging-port=${port}`], { env, stdio: "ignore" })
    : spawn(ELECTRON, [STAGE("NeuralDeck"), ...args, `--remote-debugging-port=${port}`], { env, stdio: "ignore" });
  procs.push(p);
  return { p, profile, env };
}
const PRELUDE = `
  const q = s => document.querySelector(s); const qa = s => [...document.querySelectorAll(s)];
  const wait = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = fn(); if (v) return v; } catch {} await new Promise(r => setTimeout(r, 30)); } return null; };
  const items = () => qa('#results .item').map(li => ({ title: li.querySelector('.title').textContent, detail: li.querySelector('.detail').textContent, off: li.classList.contains('off'), sel: li.getAttribute('aria-selected') === 'true' }));
  const type = async (text) => { const i = q('#q'); i.value = text; i.dispatchEvent(new Event('input')); await new Promise(r => setTimeout(r, 250)); };
  const key = async (k, o = {}) => { q('#q').dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o })); await new Promise(r => setTimeout(r, 250)); };
`;

(async () => {
  try {
    const A = start("A", 9371, { profileSettings: { shortcut: SHORTCUT } });
    const c = await attach(await waitTarget(9371, (t) => /index\.html/.test(t.url), 30000));
    const run = (body) => c.evaluate(PRELUDE + body);

    console.log("the panel");
    let r = await run("await wait(() => q('#results .item')); return { items: items(), shown: !document.hidden, x: screenX, w: outerWidth, aw: screen.availWidth, ax: screen.availLeft, y: screenY, ay: screen.availTop, ah: screen.availHeight, hint: q('#band-hint').textContent, warn: q('#warn').hidden };");
    check(r.shown && Math.abs(r.x - (r.ax + (r.aw - r.w) / 2)) <= 2 && r.y > r.ay && r.y < r.ay + r.ah / 3, "a normal start shows the panel at the top middle of the screen", j({ x: r.x, w: r.w, aw: r.aw, y: r.y }));
    check(r.hint === SHORTCUT && r.warn, "its shortcut is registered and shown on the band", r.hint);
    check(r.items.length >= 6 && r.items[0].title === "NeuralCalc", "empty input lists the programs", j(r.items.map((i) => i.title)));
    const view = r.items.find((i) => i.title === "NeuralView");
    check(view && view.off && /kurulu değil/.test(view.detail) && !r.items.find((i) => i.title === "NeuralPad").off, "NeuralView (not installed here) is greyed out", j(view));

    console.log("calculator");
    r = await run("await type('=12*7'); return items()[0];");
    check(r.title === "= 84", "=12*7 shows 84 as you type", j(r));
    await run("await key('Enter'); return 1;");
    await sleep(300);
    check(j(launches().pop()) === j({ copy: "84" }), "Enter copies 84 (test record instead of the clipboard)", j(launches()));
    r = await run("await type('hesap 1/0'); return items()[0];");
    check(r.off && /SIFIRA BÖLME/.test(r.detail), "an error is shown and cannot be run");

    console.log("folders and files");
    const typedBel = path.join(BOX, "Bel");
    r = await run(`await type(${j("nav " + typedBel)}); return items();`);
    check(r[0].title === path.join(BOX, "Belgeler") + "\\", "nav completes the folder name", j(r[0]));
    r = await run("await key('Tab'); return q('#q').value;");
    check(r === `nav ${path.join(BOX, "Belgeler")}\\`, "Tab puts the completed path in the box", r);
    r = await run("return items().map(i => i.title);");
    check(r.some((t) => t.endsWith("Proje\\")), "and lists what is inside", j(r));
    await run(`await type(${j("nav " + path.join(BOX, "Belgeler"))}); await key('Enter'); return 1;`);
    await sleep(300);
    check(j(launches().pop()) === j({ exe: exe("NeuralNav"), args: [path.join(BOX, "Belgeler")] }), "Enter starts NeuralNav with the folder as one argument", j(launches().pop()));
    await run(`await type(${j("term " + BOX)}); await key('Enter'); return 1;`);
    await sleep(300);
    check(j(launches().pop()) === j({ exe: exe("NeuralTerm"), args: [BOX] }), "term <folder> starts NeuralTerm there");
    const txt = path.join(BOX, "Belgeler", "not defteri.txt");
    await run(`await type(${j("pad " + txt)}); await key('Enter'); return 1;`);
    await sleep(300);
    check(j(launches().pop()) === j({ exe: exe("NeuralPad"), args: [txt] }), "pad <file> with a space in its name: still one argument");
    r = await run("await type('pad'); return items().map(i => i.title);");
    check(r[0] === "Başlat: NeuralPad" && r.includes(txt), "pad alone offers the file just opened (recent)", j(r));
    const before = launches().length;
    r = await run(`await type(${j("view " + path.join(BOX, "Resimler", "galata.jpg"))}); const it = items()[0]; await key('Enter'); return it;`);
    await sleep(300);
    check(r.off && /NeuralView kurulu değil/.test(r.detail) && launches().length === before, "a command for a program that is not installed is greyed and does nothing", j(r));

    console.log("web, search, theme");
    await run("await type('web example.com/yol?a=1'); await key('Enter'); return 1;");
    await sleep(300);
    check(j(launches().pop()) === j({ exe: exe("NeuralWeb"), args: ["--", "https://example.com/yol?a=1"] }), "web <address> → NeuralWeb -- https://…");
    const n0 = launches().length;
    r = await run("await type('web javascript:alert(1)'); const a = items()[0]; await key('Enter'); await type('web file:///C:/Windows'); const b = items()[0]; await key('Enter'); return [a, b];");
    await sleep(300);
    check(r[0].off && r[1].off && launches().length === n0, "javascript: and file: addresses are refused", j(r));
    await run("await type('ara neo istanbul gece'); await key('Enter'); return 1;");
    await sleep(300);
    check(j(launches().pop()) === j({ exe: exe("NeuralWeb"), args: ["--", "https://www.google.com/search?q=neo%20istanbul%20gece"] }), "ara <words> → a Google search in NeuralWeb");
    r = await run("await type('tema buz'); await key('Enter'); await wait(() => document.documentElement.classList.contains('theme-ice')); return document.documentElement.className;");
    const series = JSON.parse(fs.readFileSync(THEME, "utf8"));
    check(/theme-ice/.test(r) && series.theme === "ice" && series.by.startsWith("NeuralDeck:"), "tema buz changes the series theme, and the panel follows", j(series));
    fs.writeFileSync(THEME + ".tmp", JSON.stringify({ theme: "alarm", changedAt: Date.now() + 5, by: "Test:1" }));
    fs.renameSync(THEME + ".tmp", THEME);
    r = await run("await wait(() => document.documentElement.classList.contains('theme-alarm')); return document.documentElement.className;");
    check(/theme-alarm/.test(r), "it follows a theme picked in another program");

    console.log("only what the main process suggested can run");
    const n1 = launches().length;
    r = await run("await type('nav'); return [await deck.run(99), await deck.run(-1), await deck.run('0; calc.exe'), await deck.run(1.5)];");
    await sleep(300);
    check(r.every((x) => x && x.ok === false) && launches().length === n1, "numbers outside the list, or not numbers, run nothing", j(r));

    console.log("settings: the shortcut");
    r = await run("await type('ayarlar'); await key('Enter'); await wait(() => !q('#settings').hidden); q('#set-shortcut').click(); await wait(() => q('#set-shortcut').classList.contains('capturing')); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F11', code: 'F11', ctrlKey: true, altKey: true, shiftKey: true, bubbles: true, cancelable: true })); await wait(() => !q('#set-shortcut').classList.contains('capturing')); return { key: q('#set-shortcut').textContent, msg: q('#set-msg').textContent, st: await deck.state() };");
    const saved = JSON.parse(fs.readFileSync(path.join(A.profile, "settings.json"), "utf8"));
    check(r.key === "Ctrl+Alt+Shift+F11" && r.st.shortcut.ok && saved.shortcut === "Ctrl+Alt+Shift+F11", "a new shortcut is captured, registered and saved", j({ r, saved }));
    r = await run("q('#set-shortcut').click(); await wait(() => q('#set-shortcut').classList.contains('capturing')); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', bubbles: true, cancelable: true })); await wait(() => !q('#set-shortcut').classList.contains('capturing')); return { msg: q('#set-msg').textContent, st: await deck.state() };");
    check(/kullanılamaz/.test(r.msg) && r.st.shortcut.accel === "Ctrl+Alt+Shift+F11" && r.st.shortcut.ok, "a plain letter is refused and the old shortcut stays", j(r));
    await run("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await wait(() => q('#settings').hidden); return 1;");

    console.log("a shortcut that is taken");
    start("B", 9372, { profileSettings: { shortcut: "Ctrl+Alt+Shift+F11" } });
    const b = await attach(await waitTarget(9372, (t) => /index\.html/.test(t.url), 30000));
    r = await b.evaluate(PRELUDE + "await wait(() => q('#results .item')); return { st: await deck.state(), warn: q('#warn').hidden ? '' : q('#warn').textContent };");
    check(!r.st.shortcut.ok && /kaydedilemedi/.test(r.warn), "a second copy cannot take the same shortcut and says so", j(r));
    b.close();

    console.log("hiding and showing");
    // (the panel runs with background throttling off, so document.hidden stays false: the main process is asked)
    r = await run("await key('Escape'); const t0 = Date.now(); while (Date.now() - t0 < 4000 && (await deck.state()).visible) await new Promise(r => setTimeout(r, 50)); return (await deck.state()).visible === false;");
    check(r === true, "Esc hides the panel");
    const again = spawn(process.env.NEURALDECK_EXE || ELECTRON, process.env.NEURALDECK_EXE ? [] : [STAGE("NeuralDeck")], { env: A.env, stdio: "ignore" });
    r = await run("const t0 = Date.now(); while (Date.now() - t0 < 8000 && !(await deck.state()).visible) await new Promise(r => setTimeout(r, 100)); return (await deck.state()).visible;");
    check(r === true, "starting it again shows the panel of the running one");
    await new Promise((res) => { again.on("exit", res); setTimeout(res, 5000); });
    check(again.exitCode === 0, "and the second process exits");
    c.close();

    console.log("defaults and background start");
    start("C", 9373, { args: ["--arka-plan"] });
    const d = await attach(await waitTarget(9373, (t) => /index\.html/.test(t.url), 30000));
    r = await d.evaluate(PRELUDE + "await new Promise(r => setTimeout(r, 800)); return { st: await deck.state() };");
    check(!r.st.visible && r.st.background, "--arka-plan starts without showing the panel", j(r.st));
    check(r.st.shortcut.accel === "Alt+Space", `the default shortcut is Alt+Space (${r.st.shortcut.ok ? "registered" : "taken by another program on this PC"})`, j(r.st.shortcut));
    d.close();

    console.log("NeuralCalc on the shared engine");
    const calcExe = process.env.NEURALCALC_EXE;
    const cp = spawn(calcExe || ELECTRON, [...(calcExe ? [] : [STAGE("NeuralCalc")]), `--user-data-dir=${path.join(OUT, "calc-profile")}`, "--remote-debugging-port=9374"], { stdio: "ignore" });
    procs.push(cp);
    const k = await attach(await waitTarget(9374, () => true, 30000));
    r = await k.evaluate(`
      await new Promise(r => setTimeout(r, 1200));
      const press = k => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
      for (const ch of '(12+30)*1337') press(ch);
      press('Enter');
      await new Promise(r => setTimeout(r, 300));
      const a = document.getElementById('mainLine').textContent;
      for (const ch of '1/0') press(ch); press('Enter');
      await new Promise(r => setTimeout(r, 300));
      return { a, b: document.getElementById('mainLine').textContent, engine: typeof NeuralCalcEngine };`);
    check(r.a === "56154" && /^ERR 0x0D/.test(r.b) && r.engine === "object", "NeuralCalc computes with the shared engine and shows its errors", j(r));
    k.close();
  } catch (e) {
    failed++;
    console.log("  FAIL " + e.stack);
  } finally {
    for (const p of procs) { try { execFileSync("taskkill", ["/T", "/F", "/PID", String(p.pid)], { stdio: "ignore" }); } catch (e) { /* gone */ } }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
