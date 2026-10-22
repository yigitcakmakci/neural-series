"use strict";
// Drives the installed NeuralNav through the Chrome DevTools protocol on a throwaway folder.
const fs = require("fs");
const path = require("path");
const { spawn, execFileSync } = require("child_process");

const SP = __dirname;
const OUT = path.join(require("os").tmpdir(), "neural-testler"); // screenshots and throwaway profiles
fs.mkdirSync(OUT, { recursive: true });
const BOX = path.join(OUT, "nav-sandbox");
const EXE = path.join(process.env.USERPROFILE, "Neural", "NeuralNav", "Program", "NeuralNav.exe");
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
const check = (cond, label, extra = "") => { if (cond) { passed++; console.log("  ok   " + label); } else { failed++; console.log("  FAIL " + label + (extra ? "  -> " + extra : "")); } };

/* ---------- clean profile (only test runs have used NeuralNav so far) and sandbox ---------- */
// A throwaway settings folder: the real %APPDATA%\NeuralNav is never touched.
const PROFILE = path.join(OUT, "nav-profile");
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.rmSync(BOX, { recursive: true, force: true });
const mk = (rel, text) => { const p = path.join(BOX, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); if (text !== undefined) fs.writeFileSync(p, text); return p; };
mk("Belgeler/not.txt", "Neo-İstanbul notu: ğüşıöç İĞÜŞÖÇ\r\nikinci satır");
mk("Belgeler/ikinci.md", "# Başlık");
mk("Klasör B/iç.txt", "iç");
fs.mkdirSync(path.join(BOX, "Klasör A"), { recursive: true });
for (let i = 1; i <= 300; i++) mk(`Arşiv/kayit-${String(i).padStart(3, "0")}.log`, "x".repeat(i));
fs.copyFileSync(path.join(process.env.USERPROFILE, "Neural", "NeuralNav", "Program", "resources", "app", "icon.png"), path.join(BOX, "resim.png"));
mk("gizli.txt", "gizli");
mk("ac.bat", '@echo acildi> "%~dp0acildi.txt"\r\n');
execFileSync("attrib", ["+h", path.join(BOX, "gizli.txt")]);

/* ---------- CDP ---------- */
async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find((t) => t.type === "page");
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
          return r.result && r.result.result ? r.result.result.value : undefined;
        };
        return { evaluate, call, close: () => ws.close() };
      }
    } catch (e) { /* not up yet */ }
    await sleep(500);
  }
  throw new Error("NeuralNav did not open a debugging port");
}

const PRELUDE = `
  const q = s => document.querySelector(s);
  const qa = s => [...document.querySelectorAll(s)];
  const wait = async (fn, ms = 6000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = fn(); if (v) return v; } catch {} await new Promise(r => setTimeout(r, 60)); } return null; };
  const key = (k, o = {}) => { const code = /^[a-z]$/i.test(k) ? 'Key' + k.toUpperCase() : k; window.dispatchEvent(new KeyboardEvent('keydown', { key: k, code, ctrlKey: !!o.ctrl, shiftKey: !!o.shift, altKey: !!o.alt, bubbles: true, cancelable: true })); };
  const rowByName = n => qa('.row, .tile').find(r => r.querySelector('.nm')?.textContent === n);
  const click = (el, o = {}) => { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, ctrlKey: !!o.ctrl, shiftKey: !!o.shift })); document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 })); };
  const dbl = el => { for (const detail of [1, 2]) { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, detail })); document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, detail })); } };
  const crumbs = () => qa('.crumb').map(c => c.textContent).join(' > ');
  const status = () => q('#st-count').textContent + ' | ' + q('#st-sel').textContent;
`;

function snap(name) {
  try {
    execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(SP, "..", "..", "tools", "snap-window.ps1"), "-ProcessName", "NeuralNav", "-Out", path.join(OUT, name)], { stdio: "pipe" });
    console.log("  [screenshot] " + name);
  } catch (e) { console.log("  [screenshot failed] " + name); }
}

(async () => {
  const app = spawn(EXE, [BOX, `--user-data-dir=${PROFILE}`, `--remote-debugging-port=${PORT}`], { stdio: "ignore", detached: false });
  const cdp = await connect();
  const run = (body) => cdp.evaluate(PRELUDE + body);

  console.log("start");
  let r = await run(`await wait(() => qa('.tab').length >= 2 && q('.crumb.last')?.textContent === 'nav-sandbox'); return { tabs: qa('.tab').length, crumbs: crumbs(), rows: qa('.row').length, status: status(), title: document.title };`);
  check(r.tabs === 2 && r.crumbs.endsWith("nav-sandbox"), "opens the folder from the command line in a new tab", JSON.stringify(r));
  check(r.rows === 6 && /6 öğe/.test(r.status), "lists the 6 visible items (hidden file not shown)", JSON.stringify(r));
  r = await run(`const names = qa('.row .nm').map(n => n.textContent); return names;`);
  check(r[0] === "Arşiv" && r[1] === "Belgeler" && r.indexOf("resim.png") > r.indexOf("Klasör B"), "folders first, Turkish-aware name order", r.join(", "));
  snap("nav-1-details.png");

  console.log("real mouse double-click");
  const realDouble = async (name) => {
    const pt = await run(`const r = rowByName(${JSON.stringify(name)}).querySelector('.nm').getBoundingClientRect(); return { x: r.left + 10, y: r.top + r.height / 2 };`);
    for (const clickCount of [1, 2]) {
      await cdp.call("Input.dispatchMouseEvent", { type: "mousePressed", x: pt.x, y: pt.y, button: "left", clickCount });
      await cdp.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: pt.x, y: pt.y, button: "left", clickCount });
    }
  };
  await realDouble("ac.bat");
  for (let i = 0; i < 40 && !fs.existsSync(path.join(BOX, "acildi.txt")); i++) await sleep(150);
  check(fs.existsSync(path.join(BOX, "acildi.txt")), "a real double-click on a file opens it with its Windows program");
  await realDouble("Klasör B");
  r = await run(`await wait(() => q('.crumb.last')?.textContent === 'Klasör B'); return crumbs();`);
  check(r.endsWith("Klasör B"), "a real double-click on a folder opens it", r);
  await run(`key('Backspace'); await wait(() => q('.crumb.last')?.textContent === 'nav-sandbox' && rowByName('ac.bat')); return true;`);
  fs.rmSync(path.join(BOX, "ac.bat"));
  fs.rmSync(path.join(BOX, "acildi.txt"), { force: true });
  await run(`await wait(() => !rowByName('ac.bat')); return true;`);

  console.log("selection and keyboard");
  r = await run(`key('End'); await wait(() => q('.row.sel')); return { sel: q('.row.sel .nm').textContent, status: status() };`);
  check(r.sel === "resim.png" && /1 öğe seçildi/.test(r.status), "End selects the last item and the status shows it", JSON.stringify(r));
  r = await run(`key('Home', { shift: true }); await new Promise(r => setTimeout(r, 100)); return status();`);
  check(/5 öğe seçildi/.test(r), "Shift+Home extends the selection", r);
  r = await run(`key('k'); await new Promise(r => setTimeout(r, 50)); key('l'); await new Promise(r => setTimeout(r, 100)); return q('.row.sel .nm').textContent;`);
  check(r === "Klasör A", "type-ahead jumps to 'Klasör A'", r);

  console.log("hidden files");
  r = await run(`q('[data-cmd="view"]').click(); await wait(() => q('.popup')); qa('.popup .mi').find(b => b.textContent.includes('Gizli öğeler')).click(); await new Promise(r => setTimeout(r, 150)); const n = qa('.row').length; const hid = !!q('.row.hid'); q('[data-cmd="view"]').click(); await wait(() => q('.popup')); qa('.popup .mi').find(b => b.textContent.includes('Gizli öğeler')).click(); await new Promise(r => setTimeout(r, 150)); return { n, hid, after: qa('.row').length };`);
  check(r.n === 6 && r.hid && r.after === 5, "hidden-items toggle shows and hides gizli.txt", JSON.stringify(r));

  console.log("new folder + inline rename");
  r = await run(`key('N', { ctrl: true, shift: true }); const inp = await wait(() => q('input.rename')); if (!inp) return 'no input'; const before = inp.value; inp.value = 'Test Klasörü'; inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await wait(() => rowByName('Test Klasörü')); return { before, sel: q('.row.sel .nm')?.textContent };`);
  check(r.before === "Yeni klasör" && r.sel === "Test Klasörü" && fs.existsSync(path.join(BOX, "Test Klasörü")), "Ctrl+Shift+N creates a folder, renames it in place", JSON.stringify(r));

  console.log("rename + undo");
  r = await run(`click(rowByName('Klasör A')); key('F2'); const inp = await wait(() => q('input.rename')); inp.value = 'Klasör Z'; inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await wait(() => rowByName('Klasör Z')); return true;`);
  check(fs.existsSync(path.join(BOX, "Klasör Z")), "F2 renames on disk");
  r = await run(`key('z', { ctrl: true }); await wait(() => rowByName('Klasör A')); return !!rowByName('Klasör A');`);
  check(r && fs.existsSync(path.join(BOX, "Klasör A")) && !fs.existsSync(path.join(BOX, "Klasör Z")), "Ctrl+Z undoes the rename");
  r = await run(`click(rowByName('Klasör A')); key('F2'); const inp = await wait(() => q('input.rename')); inp.value = 'a:b'; inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); const t = await wait(() => /karakter/.test(q('#toast').textContent) && q('#toast').textContent); return t || q('#toast').textContent;`);
  check(/karakter/.test(r || ""), "invalid name is refused with an explanation", r);

  console.log("copy / paste through the Windows clipboard");
  r = await run(`dbl(rowByName('Belgeler')); await wait(() => q('.crumb.last')?.textContent === 'Belgeler'); click(rowByName('not.txt')); key('c', { ctrl: true }); await new Promise(r => setTimeout(r, 400)); key('Backspace'); await wait(() => q('.crumb.last')?.textContent === 'nav-sandbox'); dbl(rowByName('Test Klasörü')); await wait(() => q('.crumb.last')?.textContent === 'Test Klasörü'); key('v', { ctrl: true }); await wait(() => rowByName('not.txt')); return { crumbs: crumbs(), sel: q('.row.sel .nm')?.textContent };`);
  check(fs.existsSync(path.join(BOX, "Test Klasörü", "not.txt")) && r.sel === "not.txt", "Ctrl+C, open folder, Ctrl+V copies and selects the pasted file", JSON.stringify(r));
  const clip = execFileSync("powershell", ["-NoProfile", "-Command", "Get-Clipboard -Format FileDropList | ForEach-Object { $_.FullName }"], { encoding: "utf8" }).trim();
  check(clip.endsWith("not.txt"), "the copy is on the Windows clipboard too (Explorer can paste it)", clip);

  console.log("conflict dialog");
  r = await run(`key('v', { ctrl: true }); const d = await wait(() => q('#dlg-conflict[open]')); if (!d) return 'no dialog'; const text = q('#cf-text').textContent; q('#dlg-conflict button[value=keep]').click(); await wait(() => rowByName('not (2).txt')); return text;`);
  check(/zaten var/.test(r) && fs.existsSync(path.join(BOX, "Test Klasörü", "not (2).txt")), "pasting again asks; 'İkisini de tut' writes not (2).txt", r);

  console.log("cut / move");
  r = await run(`click(rowByName('not (2).txt')); key('x', { ctrl: true }); await new Promise(r => setTimeout(r, 300)); const faded = !!q('.row.cut'); key('ArrowUp', { alt: true }); await wait(() => q('.crumb.last')?.textContent === 'nav-sandbox'); key('v', { ctrl: true }); await wait(() => rowByName('not (2).txt')); return { faded };`);
  check(r.faded && fs.existsSync(path.join(BOX, "not (2).txt")) && !fs.existsSync(path.join(BOX, "Test Klasörü", "not (2).txt")), "Ctrl+X fades the item; Ctrl+V elsewhere moves it", JSON.stringify(r));

  console.log("search");
  r = await run(`const s = q('#search'); s.value = 'not'; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await wait(() => /arama bitti/.test(status())); return { names: qa('.row .nm').map(n => n.textContent), status: status(), crumbs: crumbs(), head: qa('.h').map(h => h.textContent.replace(/[▲▼]/g, '')).join('|') };`);
  check(r.names.length === 3 && r.names.every((n) => n.startsWith("not")) && /Konum/.test(r.head), "Enter in the search box searches subfolders and adds a Konum column", JSON.stringify(r));
  snap("nav-2-search.png");
  r = await run(`key('Escape'); await new Promise(r => setTimeout(r, 200)); return { rows: qa('.row').length, crumbs: crumbs() };`);
  check(r.rows >= 7 && r.crumbs.endsWith("nav-sandbox"), "Esc leaves the search", JSON.stringify(r));

  console.log("large folder, tiles, preview");
  r = await run(`dbl(rowByName('Arşiv')); await wait(() => /300 öğe/.test(status())); const rendered = qa('.row').length; q('#scroller').scrollTop = 99999; await new Promise(r => setTimeout(r, 150)); const last = qa('.row .nm').map(n => n.textContent).pop(); return { rendered, last, status: status() };`);
  check(r.rendered < 120 && r.last === "kayit-300.log", "300 items: only the visible rows are drawn, scrolling reaches the end", JSON.stringify(r));
  r = await run(`key('ArrowUp', { alt: true }); await wait(() => q('.crumb.last')?.textContent === 'nav-sandbox'); q('[data-cmd="view"]').click(); await wait(() => q('.popup')); qa('.popup .mi').find(b => b.textContent.includes('Kutucuklar')).click(); await wait(() => q('.tile')); click(rowByName('resim.png')); q('[data-cmd="preview"]').click(); await wait(() => q('#preview .pv-name')); await wait(() => q('.tile .ic.has-thumb img'), 4000); return { tiles: qa('.tile').length, preview: q('#preview .pv-name')?.textContent, thumb: !!q('.tile .ic.has-thumb img') };`);
  check(r.tiles === 7 && r.preview === "resim.png", "tile view and the preview pane", JSON.stringify(r));
  check(r.thumb, "image tile shows a Windows thumbnail");
  await sleep(400);
  snap("nav-3-tiles.png");

  console.log("properties");
  r = await run(`click(rowByName('Arşiv')); key('Enter', { alt: true }); await wait(() => q('#dlg-props[open]')); await wait(() => /300 dosya/.test(q('#pr-contents')?.textContent || '')); const rows = qa('#pr-rows dt').map((d, i) => d.textContent + '=' + qa('#pr-rows dd')[i].textContent); q('#dlg-props button[value=ok]').click(); return rows;`);
  check(r.some((x) => /İçerik=300 dosya, 0 klasör/.test(x)) && r.some((x) => /Boyut=44 KB/.test(x)), "Alt+Enter properties count 300 files and their size", r.join(" ; "));

  console.log("permanent delete with confirmation");
  r = await run(`click(rowByName('not (2).txt')); key('Delete', { shift: true }); await wait(() => q('#dlg-confirm[open]')); const text = q('#cfm-text').textContent; q('#dlg-confirm button[value=ok]').click(); await wait(() => !rowByName('not (2).txt')); return text;`);
  check(/kalıcı/.test(r) && !fs.existsSync(path.join(BOX, "not (2).txt")), "Shift+Del asks, then deletes", r);

  console.log("tabs and Bu Bilgisayar");
  r = await run(`key('t', { ctrl: true }); await wait(() => qa('.tab').length === 3 && q('.pc-card')); const cards = qa('.pc-card .pc-name').map(n => n.textContent); key('w', { ctrl: true }); await wait(() => qa('.tab').length === 2); return { cards, tabs: qa('.tab').length };`);
  check(r.cards.includes("Belgeler") && r.cards.some((c) => /\(C:\)/.test(c)) && r.tabs === 2, "Ctrl+T opens Bu Bilgisayar with folders and drives; Ctrl+W closes it", JSON.stringify(r));
  r = await run(`qa('.tab')[0].click(); await wait(() => q('.pc-card')); return { cards: qa('.pc-card').length, title: document.title };`);
  check(r.cards >= 7, "switching tabs restores each tab's view", JSON.stringify(r));
  snap("nav-4-pc.png");

  console.log("close");
  await run(`window.nv.close(); return true;`).catch(() => {});
  for (let i = 0; i < 20 && app.exitCode === null; i++) await sleep(250);
  check(app.exitCode !== null, "window closes and the app exits");
  cdp.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("ERROR:", e.message); process.exit(2); });
