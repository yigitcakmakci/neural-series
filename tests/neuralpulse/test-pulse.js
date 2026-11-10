"use strict";
require("../../tools/lang-env")(); // the program speaks Turkish, the language of its checks
// Drives NeuralPulse from source (node_modules\electron\dist\electron.exe apps\neuralpulse) through the Chrome DevTools
// protocol. The helper is compiled into a temp folder and named by NEURALPULSE_SENSOR; settings, the series theme and
// the hand-off log are throwaway files; NEURAL_ROOT is a fake installation whose NeuralNav only gets a log line
// (NEURAL_TEST_LAUNCH). The only process it ends is a tiny program it starts itself; "ending" the System process
// (PID 4) is refused by Windows to everyone.
//   node tests\neuralpulse\test-pulse.js
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn, execFileSync } = require("child_process");
const { sleep, waitTarget, attach } = require("../../tools/cdp");

const ROOT = path.join(__dirname, "..", "..");
const APP = path.join(ROOT, "apps", "neuralpulse");
const ELECTRON = path.join(ROOT, "node_modules", "electron", "dist", "electron.exe");
const CSC = path.join(process.env.SystemRoot || "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
const OUT = path.join(os.tmpdir(), "neural-testler", "pulse-e2e");
const BIN = path.join(OUT, "bin");
const SENSOR = path.join(BIN, "plsensor.exe");
const KID_NAME = `plkid${process.pid}`; // a name nothing else on this computer has
const KID = path.join(BIN, `${KID_NAME}.exe`);
const FAKE = path.join(OUT, "Neural");
const LOG = path.join(OUT, "launch.jsonl");
const THEME = path.join(OUT, "theme.json");
const PORT = 9395, PORT_EN = 9396;
const FLAGS = ["--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding"];
let passed = 0, failed = 0;
const check = (cond, label, extra = "") => { if (cond) { passed++; console.log("  ok   " + label); } else { failed++; console.log("  FAIL " + label + (extra ? "  -> " + extra : "")); } };
const j = (x) => JSON.stringify(x);
const logged = () => { try { return fs.readFileSync(LOG, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch (e) { return []; } };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
const started = [];

function compile(out, src, extra = []) {
  try { execFileSync(CSC, ["/nologo", "/optimize+", "/target:exe", "/platform:x64", ...extra, `/out:${out}`, src], { stdio: "pipe" }); } catch (e) { /* checked below */ }
  return fs.existsSync(out);
}
function startApp(port, env, args = []) {
  const p = spawn(ELECTRON, [APP, `--remote-debugging-port=${port}`, ...FLAGS, ...args], { env, stdio: "ignore" });
  started.push(p);
  return p;
}
const PRELUDE = `
  const q = s => document.querySelector(s); const qa = s => [...document.querySelectorAll(s)];
  const wait = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = await fn(); if (v) return v; } catch {} await new Promise(r => setTimeout(r, 50)); } return null; };
  const rows = () => qa('#rows .tr:not([hidden])').map(r => { const c = r.querySelectorAll('.td'); return { pid: +r.dataset.pid, name: c[0].textContent, cpu: +c[2].dataset.v, mem: +c[3].dataset.v, path: c[4].textContent, sel: r.classList.contains('sel') }; });
  const search = async (text) => { const i = q('#search'); i.value = text; i.dispatchEvent(new Event('input')); await new Promise(r => setTimeout(r, 50)); };
  const menuItem = (label) => qa('.popup .mi').find(b => b.textContent.includes(label));
`;

(async () => {
  try {
    fs.rmSync(OUT, { recursive: true, force: true });
    fs.mkdirSync(BIN, { recursive: true });
    const nav = path.join(FAKE, "NeuralNav", "Program", "NeuralNav.exe");
    fs.mkdirSync(path.dirname(nav), { recursive: true });
    fs.writeFileSync(nav, "");

    console.log("setup");
    check(compile(SENSOR, path.join(APP, "plsensor.cs")), "the helper compiles into a temp folder");
    // The harmless child: holds 48 MB and waits until its stdin closes (so it never outlives the test).
    const kidSrc = path.join(BIN, "kid.cs");
    fs.writeFileSync(kidSrc, "class K { static void Main() { byte[] b = new byte[48 << 20]; for (int i = 0; i < b.Length; i += 4096) b[i] = 1; System.Console.In.ReadToEnd(); System.GC.KeepAlive(b); } }");
    check(compile(KID, kidSrc), `a child program for the test (${KID_NAME}.exe)`);
    const kid = spawn(KID, [], { stdio: ["pipe", "ignore", "ignore"], windowsHide: true });
    started.push(kid);
    let kidExit = null;
    kid.on("exit", (code) => { kidExit = code; });

    const env = { ...process.env, NEURALPULSE_PROFILE: path.join(OUT, "profile"), NEURALPULSE_SENSOR: SENSOR, NEURAL_THEME_FILE: THEME, NEURAL_ROOT: FAKE, NEURAL_TEST_LAUNCH: LOG, NEURALPULSE_TEST_INACTIVE: "1" };
    delete env.NEURALPULSE_DEMO;
    const app = startApp(PORT, env);
    const c = await attach(await waitTarget(PORT, (t) => /index\.html/.test(t.url), 30000));
    const run = (body) => c.evaluate(PRELUDE + body);
    const key = async (k, code, vk, modifiers = 0) => {
      await c.call("Input.dispatchKeyEvent", { type: "rawKeyDown", key: k, code, windowsVirtualKeyCode: vk, modifiers });
      await c.call("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, modifiers });
    };
    const mouse = async (x, y, button = "left") => {
      await c.call("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
      await c.call("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button, clickCount: 1 });
      await c.call("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button, clickCount: 1 });
    };
    const rowPoint = (pid) => run(`const r = q('#rows .tr[data-pid="${pid}"]:not([hidden])'); if (!r) return null; const b = r.getBoundingClientRect(); return { x: b.left + 60, y: b.top + b.height / 2 };`);

    console.log("graphs");
    let r = await run(`await wait(async () => (await window.np.state()).samples >= 6, 15000);
      // The line grows from the right edge (a few seconds is a short stretch of a 60-second graph), so count the
      // columns it covers and check that it reaches the right edge, rather than counting pixels.
      const cyan = (cv) => { const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; const cols = new Set();
        for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 120 && d[i] < 90 && d[i + 1] > 180 && d[i + 2] > 180) cols.add((i / 4) % cv.width);
        return { cols: cols.size, right: cols.has(cv.width - 1) || cols.has(cv.width - 2) }; };
      const cards = qa('.card').map(x => ({ kind: x.dataset.kind, label: x.querySelector('.card-label').textContent, big: x.querySelector('.big').textContent, foot: x.querySelector('.card-foot').textContent }));
      return { state: await window.np.state(), cards, cyan: cyan(q('.card[data-kind="cpu"] canvas')), cores: qa('.cores i').length, live: q('#live').textContent, status: qa('.statusbar span').map(s => s.textContent), domRows: qa('#rows .tr').length };`);
    check(r.state.running && r.state.samples >= 6 && !r.state.paused && !r.state.demo, "the helper runs and sends samples", j(r.state));
    const kinds = r.cards.map((x) => x.kind);
    check(kinds[0] === "cpu" && kinds[1] === "mem" && kinds.includes("disk") && kinds.includes("net"), "cards: CPU, memory, each disk, network" + (kinds.includes("gpu") ? ", GPU" : " (no GPU counters here)"), j(r.cards));
    check(r.cards.every((x) => x.big && x.big !== "—") && /^%\d+$/.test(r.cards[0].big), "each card shows its current value (Turkish percent: %23)", j(r.cards.map((x) => x.big)));
    check(r.cyan.cols >= 10 && r.cyan.right, `the CPU graph is drawn on the canvas in the theme's colour, ending at the right edge (${r.cyan.cols} cyan columns)`, j(r.cyan));
    check(r.cores === os.cpus().length, `a strip with one bar per logical processor (${r.cores})`);
    check(r.live === "CANLI" && /^\d+ süreç$/.test(r.status[0]) && /^CPU %\d+$/.test(r.status[1]) && /^Bellek %\d+$/.test(r.status[2]) && /^Açık kalma süresi /.test(r.status[3]), "status bar: process count, CPU, memory, up time", j(r.status));
    const total = +r.status[0].split(" ")[0];
    check(total > 50 && r.domRows < 60, `only the visible rows exist (${r.domRows} rows for ${total} processes)`);
    r = await run(`const long = []; const po = new PerformanceObserver(l => { for (const e of l.getEntries()) long.push(Math.round(e.duration)); }); po.observe({ type: 'longtask' });
      const n0 = (await window.np.state()).samples; await new Promise(r => setTimeout(r, 4200)); po.disconnect(); return { long, n: (await window.np.state()).samples - n0 };`);
    check(r.n >= 3 && !r.long.some((d) => d > 100), `${r.n} updates without a long task on the page`, j(r.long));

    console.log("the test's own child process");
    r = await run(`await search(${j(KID_NAME)}); await wait(() => rows().length === 1); return { rows: rows(), count: q('#procs-count').textContent };`);
    const kr = r.rows[0] || {};
    check(r.rows.length === 1 && kr.pid === kid.pid && kr.name === KID_NAME, "search finds it by name: one row, its PID", j(r));
    check(kr.mem > 40 * 1048576 && kr.path.toLowerCase() === KID.toLowerCase(), "its memory (it holds 48 MB) and its path", j(kr));
    check(r.count === "1 eşleşme", "the match count", r.count);
    r = await run(`await search(${j(String(kid.pid))}); await wait(() => rows().some(x => x.pid === ${kid.pid})); return rows().map(x => x.pid);`);
    check(r.includes(kid.pid), "search finds it by PID too");
    r = await run(`await search('bin\\\\${KID_NAME}'); await wait(() => rows().length === 1); return rows().map(x => x.name);`);
    check(r.length === 1 && r[0] === KID_NAME, "and by a piece of its path", j(r));

    console.log("sorting");
    r = await run(`await search(''); const out = {};
      const take = (k) => rows().map(x => x[k]);
      const click = (col) => q('.th[data-col="' + col + '"]').click();
      out.start = { sort: q('.th.sorted').dataset.col, desc: q('.th.sorted').classList.contains('desc'), cpu: take('cpu') };
      click('mem'); out.memDesc = take('mem'); out.memHead = q('.th.sorted').getAttribute('aria-sort');
      click('mem'); out.memAsc = take('mem');
      click('name'); out.names = take('name');
      click('pid'); out.pids = take('pid');
      click('cpu'); out.cpu = take('cpu'); out.cpuHead = q('.th[data-col="cpu"]').getAttribute('aria-sort');
      return out;`);
    const mono = (a, dir) => a.length > 5 && a.every((v, i) => i === 0 || (dir > 0 ? a[i - 1] <= v : a[i - 1] >= v));
    check(r.start.sort === "cpu" && r.start.desc && mono(r.start.cpu, -1), "it starts sorted by CPU, busiest first", j(r.start));
    check(mono(r.memDesc, -1) && r.memHead === "descending", "a click on Bellek sorts by memory, largest first", j(r.memDesc.slice(0, 6)));
    check(mono(r.memAsc, 1), "a second click turns it around", j(r.memAsc.slice(0, 6)));
    const coll = new Intl.Collator("tr-TR", { sensitivity: "base", numeric: true });
    check(r.names.length > 5 && r.names.every((n, i) => i === 0 || coll.compare(r.names[i - 1], n) <= 0), "by name, A to Z", j(r.names.slice(0, 6)));
    check(mono(r.pids, 1) && r.pids[0] === 4, "by PID, the System process (4) first", j(r.pids.slice(0, 6)));
    check(mono(r.cpu, -1) && r.cpuHead === "descending", "and back to CPU", j(r.cpu.slice(0, 6)));
    const savedSort = await run(`return JSON.parse(localStorage.getItem('neuralpulse.settings'));`);
    check(savedSort && savedSort.sort === "cpu" && savedSort.dir === "desc", "the order is remembered", j(savedSort));

    console.log("open location");
    await run(`await search(${j(KID_NAME)}); await wait(() => rows().length === 1); return 1;`);
    let pt = await rowPoint(kid.pid);
    await mouse(pt.x, pt.y, "right");
    r = await run(`await wait(() => q('.popup')); return qa('.popup .mi').map(b => ({ t: b.textContent, off: b.disabled }));`);
    check(r.length === 4 && r[0].t.includes("Dosya konumunu NeuralNav'da aç") && !r[0].off && r[3].t.includes("Süreci sonlandır…"), "right-click: open location, copy path, copy name, end process", j(r));
    await run(`menuItem("NeuralNav'da aç").click(); return 1;`);
    let hit = null;
    for (let i = 0; i < 40 && !hit; i++) { hit = logged().find((l) => l.by === "NeuralPulse" && l.program === "NeuralNav"); if (!hit) await sleep(100); }
    check(hit && hit.args.length === 1 && hit.args[0].toLowerCase() === KID.toLowerCase(), "its path goes to NeuralNav (which opens the folder with the file selected)", j(logged()));
    await run(`q('#tbody').focus(); return 1;`);
    await key("Enter", "Enter", 13);
    await sleep(500);
    check(logged().filter((l) => l.program === "NeuralNav").length === 2, "Enter does the same", j(logged()));

    console.log("ending asks first");
    await run(`q('#tbody').focus(); return 1;`);
    await key("Delete", "Delete", 46);
    r = await run(`await wait(() => q('#dlg-end[open]')); return { open: !!q('#dlg-end[open]'), head: q('#dlg-end .dlg-head').textContent, target: q('#end-target').textContent, path: q('#end-path').textContent, warn: q('#dlg-end .end-warn').textContent, focus: document.activeElement.id };`);
    check(r.open && r.target === `${KID_NAME} · PID ${kid.pid}` && /kaydedilmemiş çalışmalar kaybolur/.test(r.warn), "Del asks: name, PID and the warning about unsaved work", j(r));
    check(r.focus === "end-cancel", "Vazgeç has the focus (Enter does not end anything)", r.focus);
    await run(`q('#end-cancel').click(); return 1;`);
    await sleep(2200);
    r = await run(`return { open: !!q('#dlg-end[open]'), rows: rows().map(x => x.pid) };`);
    check(!r.open && kidExit === null && alive(kid.pid) && r.rows.includes(kid.pid), "Vazgeç: the process keeps running and stays in the list", j({ r, kidExit }));
    pt = await rowPoint(kid.pid);
    await mouse(pt.x, pt.y, "right");
    await run(`await wait(() => q('.popup')); menuItem('Süreci sonlandır').click(); await wait(() => q('#dlg-end[open]')); return 1;`);
    r = await run(`const t = q('#end-target').textContent; if (t !== ${j(`${KID_NAME} · PID ${kid.pid}`)}) { q('#end-cancel').click(); return { refused: t }; } q('#end-ok').click(); return { toast: await wait(() => q('#toast.show')?.textContent) };`);
    for (let i = 0; i < 40 && kidExit === null; i++) await sleep(100);
    check(kidExit !== null && !alive(kid.pid), "Sonlandır (from the context menu) ends it", j({ r, kidExit }));
    check(r.toast === `${KID_NAME} (PID ${kid.pid}) sonlandırıldı.`, "and says so", r.toast);
    await sleep(1500);
    r = await run(`return { rows: rows().length, empty: q('#empty').hidden ? '' : q('#empty').textContent };`);
    check(r.rows === 0 && r.empty === `“${KID_NAME}” ile eşleşen süreç yok.`, "it is gone from the list", j(r));

    console.log("what NeuralPulse does not end");
    r = await run(`await search(''); const h = q('.th[data-col="pid"]'); h.click(); if (h.classList.contains('desc')) h.click(); q('#tbody').scrollTop = 0; await new Promise(r => setTimeout(r, 100)); return rows()[0];`);
    check(r && r.pid === 4 && r.name === "System", "the first row by PID is System (4)", j(r));
    pt = await rowPoint(4);
    await mouse(pt.x, pt.y);
    await key("Delete", "Delete", 46);
    r = await run(`await wait(() => q('#dlg-end[open]')); const t = q('#end-target').textContent; if (t !== 'System · PID 4') { q('#end-cancel').click(); return { refused: t }; } q('#end-ok').click(); const toast = await wait(() => q('#toast.show.error')?.textContent); return { t, toast };`);
    check(r.t === "System · PID 4" && /Windows System sürecini sonlandırmaya izin vermedi/.test(r.toast || "") && /yönetici izni/.test(r.toast || ""), "the System process: Windows refuses, and the page says why", j(r));
    await sleep(1500);
    r = await run(`return rows()[0];`);
    check(r && r.pid === 4, "nothing happened to it", j(r));
    const st = await run(`return await window.np.state();`);
    r = await run(`return [await window.np.endProcess(${st.pid}, 'plsensor'), await window.np.endProcess(999999999, 'yok'), await window.np.endProcess(4, 'başka-ad')];`);
    check(!r[0].ok && /kendi süreçlerini/.test(r[0].error) && alive(st.pid), "its own helper: refused", j(r[0]));
    check(!r[1].ok && /artık çalışmıyor/.test(r[1].error), "a PID that is not running: refused", j(r[1]));
    check(!r[2].ok && /başka bir sürece ait/.test(r[2].error), "a PID whose name changed: refused (no PID reuse)", j(r[2]));
    await run(`q('.th[data-col="cpu"]').click(); return 1;`);

    console.log("minimized, the helper rests");
    await run(`window.np.minimize(); return 1;`);
    await sleep(800);
    const s1 = await run(`return await window.np.state();`);
    await sleep(2600);
    const s2 = await run(`return await window.np.state();`);
    check(s1.paused && s2.paused && s2.samples === s1.samples && s2.running, "no samples while minimized", j({ s1, s2 }));
    const again = spawn(ELECTRON, [APP], { env, stdio: "ignore" }); // a second start brings the window back
    started.push(again);
    r = await run(`return await wait(async () => { const s = await window.np.state(); return !s.paused && s.samples > ${s2.samples} ? s : null; }, 8000);`);
    check(r && !r.paused && r.samples > s2.samples, "starting it again restores the window, and the samples come back", j(r));
    await new Promise((res) => { if (again.exitCode !== null) res(); again.on("exit", res); setTimeout(res, 5000); });
    check(again.exitCode === 0, "and the second copy exits");

    console.log("theme and dialogs");
    r = await run(`q('#menu-btn').click(); await wait(() => q('.popup')); menuItem('Tema').click(); await wait(() => menuItem('Buz')); menuItem('Buz').click(); await wait(() => document.documentElement.classList.contains('theme-ice')); return document.documentElement.className;`);
    const series = JSON.parse(fs.readFileSync(THEME, "utf8"));
    check(/theme-ice/.test(r) && series.theme === "ice" && /^NeuralPulse:/.test(series.by), "a theme from the menu becomes the series theme", j(series));
    r = await run(`await wait(() => !q('.popup')); q('#tbody').focus(); return 1;`);
    await key("F1", "F1", 112);
    r = await run(`await wait(() => q('#dlg-keys[open]')); const k = q('#keys-list').textContent; q('#dlg-keys button').click(); q('#menu-btn').click(); await wait(() => q('.popup')); menuItem('NeuralPulse hakkında').click(); await wait(() => q('#dlg-about[open]')); const a = q('#about-hint').textContent; q('#dlg-about button').click(); return { k, a };`);
    check(/Süreci sonlandır/.test(r.k) && /Del/.test(r.k), "F1 lists the keyboard shortcuts", r.k.slice(0, 80));
    check(/^Sürüm 1\.7\.0 /.test(r.a), "the about dialog names the version", r.a);
    const shot = await c.call("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(OUT, "pulse-tr.png"), Buffer.from(shot.result.data, "base64"));

    console.log("close");
    const helper = (await run(`return await window.np.state();`)).pid;
    await run(`q('#win-close').click(); return 1;`).catch(() => {});
    for (let i = 0; i < 40 && app.exitCode === null; i++) await sleep(150);
    check(app.exitCode !== null, "the window closes and the program exits");
    for (let i = 0; i < 20 && alive(helper); i++) await sleep(100);
    check(helper && !alive(helper), "its helper ends with it");
    c.close();

    console.log("English (demo data)");
    const enLang = path.join(OUT, "language-en.json");
    fs.writeFileSync(enLang, JSON.stringify({ language: "en", changedAt: Date.now(), by: "test" }));
    const envEn = { ...env, NEURAL_LANG_FILE: enLang, NEURALPULSE_PROFILE: path.join(OUT, "profile-en"), NEURALPULSE_DEMO: "1" };
    startApp(PORT_EN, envEn);
    const e = await attach(await waitTarget(PORT_EN, (t) => /index\.html/.test(t.url), 30000));
    r = await e.evaluate(PRELUDE + `await wait(() => rows().length > 5);
      const texts = []; const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n; (n = walk.nextNode());) if (n.nodeValue.trim() && !n.parentElement.closest('script, style')) texts.push(n.nodeValue.trim());
      for (const el of qa('[title], [placeholder], [aria-label]')) for (const a of ['title', 'placeholder', 'aria-label']) if (el.getAttribute(a)) texts.push(el.getAttribute(a));
      return { lang: document.documentElement.lang, band: q('#band-title').textContent, live: q('#live').textContent, heads: qa('.th span').map(s => s.textContent), ph: q('#search').placeholder, status: qa('.statusbar span').map(s => s.textContent), cards: qa('.card-label').map(s => s.textContent), cpu: q('.card .big').textContent, mem: q('.card[data-kind="mem"] .unit').textContent, texts, first: rows()[0] };`);
    check(r.lang === "en" && r.band === "System Monitor" && r.live === "DEMO DATA", "band and state in English", j({ lang: r.lang, band: r.band, live: r.live }));
    check(j(r.heads) === j(["Name", "PID", "CPU", "Memory", "Location"]) && r.ph === "Search: name, PID or location", "column headers and the search box", j({ heads: r.heads, ph: r.ph }));
    check(/^\d+ processes$/.test(r.status[0]) && /^CPU \d+%$/.test(r.status[1]) && /^Memory \d+%$/.test(r.status[2]) && /^Up time 2 d \d\d:\d\d:\d\d$/.test(r.status[3]), "status bar in English (23%, not %23)", j(r.status));
    check(j(r.cards) === j(["CPU", "Memory", "Disk", "Disk", "Network", "GPU"]) && /^\d+%$/.test(r.cpu) && /^[\d.]+ \/ 32\.0 GB$/.test(r.mem), "cards in English, sizes like 1.2 GB", j({ cards: r.cards, cpu: r.cpu, mem: r.mem }));
    const turkish = [...new Set(r.texts.join(" ").split(/[^\p{L}'’]+/u).filter((w) => /[çğıöşüÇĞİÖŞÜ]/.test(w) && w !== "Türkçe"))];
    check(!turkish.length, `no Turkish words on the page (${r.texts.length} texts)`, turkish.join(" "));
    await e.evaluate(PRELUDE + `q('#tbody').focus(); return 1;`);
    for (const [k, vk] of [["ArrowDown", 40], ["ArrowDown", 40], ["Delete", 46]]) {
      await e.call("Input.dispatchKeyEvent", { type: "rawKeyDown", key: k, code: k, windowsVirtualKeyCode: vk });
      await e.call("Input.dispatchKeyEvent", { type: "keyUp", key: k, code: k, windowsVirtualKeyCode: vk });
    }
    r = await e.evaluate(PRELUDE + `const t = await wait(() => q('#toast.show')?.textContent); return { t, dialog: !!q('#dlg-end[open]'), sel: rows().findIndex(x => x.sel) };`);
    check(r.sel === 1, "the arrow keys move the selection", j(r));
    check(/invented; they cannot be ended/.test(r.t || "") && !r.dialog, "demo processes cannot be ended (their PIDs are made up)", j(r));
    const shotEn = await e.call("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(OUT, "pulse-en-demo.png"), Buffer.from(shotEn.result.data, "base64"));
    e.close();
  } catch (err) {
    failed++;
    console.log("  FAIL " + (err.stack || err.message));
  } finally {
    for (const p of started) {
      if (p.exitCode !== null) continue;
      try { p.stdin && p.stdin.end(); } catch (e) { /* closed */ }
      try { execFileSync("taskkill", ["/T", "/F", "/PID", String(p.pid)], { stdio: "ignore" }); } catch (e) { /* gone */ }
    }
  }
  console.log(`\n${passed} passed, ${failed} failed  (screenshots in ${OUT})`);
  process.exit(failed ? 1 : 0);
})();
