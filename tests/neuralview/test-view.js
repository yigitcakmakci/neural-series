"use strict";
// Drives NeuralView through the Chrome DevTools protocol on a copy of the test images, with a throwaway profile.
// Deleting, copying and opening NeuralNav go to test files (NEURALVIEW_TEST_*), never to the real Recycle Bin,
// clipboard or programs.
//   node tests\neuralview\test-view.js                   the source folder, run with node_modules\electron
//   set NEURALVIEW_APP=out\stage\apps\NeuralView        a staged build (with its bundled fonts)
//   set NEURALVIEW_EXE=<root>\NeuralView\Program\NeuralView.exe   an installed copy (setup /test)
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");
const { sleep, waitTarget, attach } = require("../../tools/cdp");
const meta = require("../../apps/neuralview/meta");

const ROOT = path.join(__dirname, "..", "..");
const OUT = path.join(os.tmpdir(), "neural-testler");
const BOX = path.join(OUT, "view-sandbox", "Neo İstanbul Arşivi");
const PROFILE = path.join(OUT, "view-profile");
const TRASH = path.join(OUT, "view-trash");
const CLIP = path.join(OUT, "view-clipboard");
const LAUNCH = path.join(OUT, "view-launch.txt");
const EXE = process.env.NEURALVIEW_EXE || path.join(ROOT, "node_modules", "electron", "dist", "electron.exe");
const APP_ARGS = process.env.NEURALVIEW_EXE ? [] : [path.resolve(process.env.NEURALVIEW_APP || path.join(ROOT, "apps", "neuralview"))];
const PORT = 9341;

let passed = 0, failed = 0;
const check = (cond, label, extra = "") => { if (cond) { passed++; console.log("  ok   " + label); } else { failed++; console.log("  FAIL " + label + (extra ? "  -> " + extra : "")); } };

for (const d of [path.dirname(BOX), PROFILE, TRASH, CLIP]) fs.rmSync(d, { recursive: true, force: true });
fs.rmSync(LAUNCH, { force: true });
fs.mkdirSync(BOX, { recursive: true });
for (const f of fs.readdirSync(path.join(__dirname, "fixtures"))) fs.copyFileSync(path.join(__dirname, "fixtures", f), path.join(BOX, f));
const P = (name) => path.join(BOX, name);

const ENV = { ...process.env, NEURALVIEW_TEST_TRASH: TRASH, NEURALVIEW_TEST_CLIPBOARD: CLIP, NEURALVIEW_TEST_LAUNCH: LAUNCH };
const launch = (file) => spawn(EXE, [...APP_ARGS, file, `--user-data-dir=${PROFILE}`, `--remote-debugging-port=${PORT}`], { env: ENV, stdio: "ignore" });

const PRELUDE = `
  const q = s => document.querySelector(s);
  const qa = s => [...document.querySelectorAll(s)];
  const wait = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = fn(); if (v) return v; } catch {} await new Promise(r => setTimeout(r, 50)); } return null; };
  // The picture of the file named in the title: while the next one decodes, the previous one stays on screen.
  const img = () => { const i = q('#viewport img'); return i && document.title === i.alt + ' - NeuralView' ? i : null; };
  const state = () => ({
    title: document.title, pos: q('#st-pos').textContent, zoom: q('#st-zoom').textContent, dims: q('#st-dims').textContent,
    notice: q('#notice').hidden ? '' : q('#notice-title').textContent, empty: !q('#empty').hidden,
    w: img() ? img().naturalWidth : 0, h: img() ? img().naturalHeight : 0, transform: img() ? img().style.transform : '',
    rotbar: q('#rotbar').hidden ? '' : q('#rot-text').textContent, thumbs: qa('.thumb').length,
    dialog: q('dialog[open]') ? q('dialog[open]').id : '', full: document.documentElement.classList.contains('is-full'),
  });
`;

const KEYS = {
  Right: ["ArrowRight", "ArrowRight", 39], Left: ["ArrowLeft", "ArrowLeft", 37], Home: ["Home", "Home", 36], End: ["End", "End", 35],
  F1: ["F1", "F1", 112], F2: ["F2", "F2", 113], F11: ["F11", "F11", 122], Del: ["Delete", "Delete", 46], Esc: ["Escape", "Escape", 27],
  Enter: ["Enter", "Enter", 13, 0, "\r"], Space: [" ", "Space", 32, 0, " "],
};
const letter = (ch, mods = 0) => [mods & 8 ? ch.toUpperCase() : ch, "Key" + ch.toUpperCase(), ch.toUpperCase().charCodeAt(0), mods, mods & 2 ? undefined : (mods & 8 ? ch.toUpperCase() : ch)];
const digit = (d) => [d, "Digit" + d, 48 + Number(d), 0, d];
const SHIFT = 8, CTRL = 2;

(async () => {
  const proc = launch(P("01-galata-gece.jpg"));
  const cdp = await attach(await waitTarget(PORT, (t) => /index\.html/.test(t.url)));
  const run = (body) => cdp.evaluate(PRELUDE + body);
  const key = async (k) => { await cdp.key(...k); await sleep(60); };
  const st = () => run("return state();");
  const until = (cond, ms) => run(`return await wait(() => { const s = state(); return (${cond}) ? s : null; }, ${ms || 8000}) || state();`);

  try {
    console.log("opening");
    let s = await until("s.w > 0");
    check(s.title === "01-galata-gece.jpg - NeuralView" && s.pos === "1 / 12", "opens the file from the command line, lists the 12 images of its folder", JSON.stringify(s));
    check(s.thumbs === 12, "12 thumbnails (the text file is left out)", String(s.thumbs));
    check(/sığdır/.test(s.zoom) && s.w === 1600 && s.h === 1000, "fits the 1600x1000 picture", JSON.stringify(s));
    let r = await run("return await wait(() => qa('.thumb img').filter(i => i.complete && i.naturalWidth > 0).length >= 5) && qa('.thumb img').filter(i => i.complete && i.naturalWidth > 0).length;");
    check(r >= 5, "thumbnails are drawn", String(r));

    console.log("information panel");
    await key(letter("i"));
    r = await run("await wait(() => !q('#info').hidden && q('#info-list').textContent.includes('Kamera')); return { text: q('#info-list').innerText, gps: !q('#gps-warn').hidden };");
    const has = (t) => r.text.includes(t);
    check(has("Neural Systems VW-3 Optik") && has("1/125 sn") && has("f/2,8") && has("200") && has("35 mm (35 mm karşılığı 52 mm)"), "camera, exposure, aperture, ISO, focal length", r.text.replace(/\n/g, " | ").slice(0, 400));
    check(has("1.600 × 1.000 piksel") && has("NS 35mm f/2.8 Siber") && has("22 Eki 2077"), "dimensions, lens, date taken");
    check(r.gps && has("41,02560° K") && has("28,97410° D") && has("61 m"), "GPS: warning shown, coordinates and altitude listed");

    console.log("formats");
    const expect = [
      ["02-tabela.png", 1000, 640], ["03-karakoy-yagmur.webp", 1200, 750], ["04-sinyal.gif", 96, 60], ["05-dikey-yön6.jpg", 600, 900],
      ["06-devre.bmp", 320, 200], ["07-amblem.svg", 640, 640], ["08-simge.ico", 256, 256], ["09-hiz.avif", 800, 500],
      ["10-telefon.heic", "HEIC açılamıyor"], ["11-bozuk.png", "Resim açılamadı"], ["12 ölçüsüz #1.svg", 400, 300],
    ];
    for (const [name, a, b] of expect) {
      await key(KEYS.Right);
      s = await until(`s.title.startsWith(${JSON.stringify(name)}) && (s.w > 0 || s.notice)`);
      if (typeof a === "string") check(s.notice === a && !s.w, `${name}: "${a}"`, JSON.stringify(s));
      else check(!s.notice && s.dims === `${a.toLocaleString("tr-TR")} × ${b.toLocaleString("tr-TR")}`, `${name}: shown at ${a}x${b}`, JSON.stringify(s));
    }
    r = await run("return q('#info-list').innerText;");
    check(/SVG/.test(r) && /400 × 300/.test(r), "an SVG without its own size takes it from its viewBox");
    await key(KEYS.Right);
    s = await until("s.pos === '1 / 12'");
    check(s.title.startsWith("01-galata-gece.jpg"), "→ after the last image wraps to the first");
    await key(KEYS.End);
    s = await until("s.pos === '12 / 12'");
    check(s.pos === "12 / 12", "End jumps to the last image");
    await key(KEYS.Home);
    s = await until("s.pos === '1 / 12' && s.w > 0");
    await cdp.call("Input.dispatchMouseEvent", { type: "mouseWheel", x: 400, y: 300, deltaX: 0, deltaY: 120 });
    s = await until("s.pos === '2 / 12'");
    check(s.pos === "2 / 12", "the mouse wheel steps to the next image");
    await key(KEYS.Left);
    s = await until("s.pos === '1 / 12' && s.w > 0");

    console.log("zoom and pan");
    const scale = (z) => Number((/%(\d+)/.exec(z) || [])[1]);
    const fitPct = scale(s.zoom);
    check(fitPct > 0 && fitPct < 100, "fit shrinks the large picture", s.zoom);
    await key(digit("1"));
    s = await until("/^%100(?!.*sığdır)/.test(s.zoom)");
    check(scale(s.zoom) === 100, "1: actual size", s.zoom);
    const t0 = s.transform;
    await cdp.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: 500, y: 400 });
    await cdp.call("Input.dispatchMouseEvent", { type: "mousePressed", x: 500, y: 400, button: "left", clickCount: 1 });
    for (let i = 1; i <= 5; i++) await cdp.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: 500 + i * 30, y: 400 + i * 10, button: "left", buttons: 1 });
    await cdp.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: 650, y: 450, button: "left", clickCount: 1 });
    s = await st();
    check(s.transform !== t0 && /translate\(150px, 50px\)/.test(s.transform), "dragging pans the enlarged picture", s.transform);
    await cdp.call("Input.dispatchMouseEvent", { type: "mouseWheel", x: 500, y: 400, deltaX: 0, deltaY: -240, modifiers: CTRL });
    s = await st();
    check(scale(s.zoom) > 100, "Ctrl+wheel zooms in", s.zoom);
    await key(digit("0"));
    s = await until("/sığdır/.test(s.zoom)");
    check(scale(s.zoom) === fitPct, "0: back to fit", s.zoom);
    await cdp.click(500, 400, { count: 1 });
    await cdp.call("Input.dispatchMouseEvent", { type: "mousePressed", x: 500, y: 400, button: "left", clickCount: 2 });
    await cdp.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: 500, y: 400, button: "left", clickCount: 2 });
    s = await until("/^%100/.test(s.zoom)");
    check(scale(s.zoom) === 100, "double click: fit → 100 %", s.zoom);
    await cdp.click(500, 400, { count: 1 });
    await cdp.call("Input.dispatchMouseEvent", { type: "mousePressed", x: 500, y: 400, button: "left", clickCount: 2 });
    await cdp.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: 500, y: 400, button: "left", clickCount: 2 });
    s = await until("/sığdır/.test(s.zoom)");
    check(/sığdır/.test(s.zoom), "double click again: back to fit", s.zoom);

    console.log("rotation (JPEG: EXIF orientation)");
    const jpgBefore = fs.readFileSync(P("01-galata-gece.jpg"));
    await key(letter("r"));
    s = await until("s.rotbar");
    check(/90° döndürüldü · kaydedilmedi/.test(s.rotbar) && /rotate\(90deg\)/.test(s.transform), "R turns the view and marks it unsaved", s.rotbar);
    await key(KEYS.Right);
    s = await until("s.dialog === 'dlg-confirm'");
    r = await run("return q('#confirm-title').textContent + ' | ' + q('#confirm-hint').textContent;");
    check(s.dialog === "dlg-confirm" && /Döndürme/.test(r) && /kayıpsız/.test(r), "leaving asks whether to save (JPEG: lossless)", r);
    await key(KEYS.Esc);
    s = await until("!s.dialog");
    check(s.pos === "1 / 12" && /90°/.test(s.rotbar), "cancel keeps the image and its rotation", JSON.stringify(s));
    await key(letter("s", CTRL));
    s = await until("s.dialog === 'dlg-confirm'");
    await key(KEYS.Enter);
    s = await until("!s.dialog && !s.rotbar && s.w === 1000");
    const jpgAfter = fs.readFileSync(P("01-galata-gece.jpg"));
    check(meta.jpegOrientation(jpgAfter) === 6 && jpgAfter.length === jpgBefore.length, "Ctrl+S saved orientation 6, file size unchanged");
    check(s.w === 1000 && s.h === 1600, "the saved file now shows upright 1000x1600", JSON.stringify(s));
    await key(letter("r", SHIFT));
    await key(letter("s", CTRL));
    await until("s.dialog === 'dlg-confirm'");
    await key(KEYS.Enter);
    s = await until("!s.dialog && s.w === 1600");
    check(meta.jpegOrientation(fs.readFileSync(P("01-galata-gece.jpg"))) === 1 && fs.readFileSync(P("01-galata-gece.jpg")).equals(jpgBefore), "Shift+R and save: back to the original bytes");

    console.log("rotation (PNG, BMP: pixels; GIF: screen only)");
    await key(KEYS.Right);
    await until("s.title.startsWith('02-tabela.png') && s.w > 0");
    await key(letter("r"));
    await key(letter("s", CTRL));
    await until("s.dialog === 'dlg-confirm'");
    await key(KEYS.Enter);
    s = await until("!s.dialog && s.w === 640");
    let m = meta.readMeta(fs.readFileSync(P("02-tabela.png")));
    check(m.format === "PNG" && m.width === 640 && m.height === 1000, "PNG rewritten turned: 640x1000", JSON.stringify(m));
    await key(KEYS.Right); await key(KEYS.Right); // webp, gif
    s = await until("s.title.startsWith('04-sinyal.gif') && s.w > 0");
    await key(letter("r"));
    s = await until("s.rotbar");
    check(/yalnızca ekranda/.test(s.rotbar), "GIF: the rotation is on screen only", s.rotbar);
    await key(KEYS.Right);
    s = await until("s.title.startsWith('05-dikey')");
    check(!s.dialog, "and leaving it asks nothing");
    await key(KEYS.Right);
    s = await until("s.title.startsWith('06-devre.bmp') && s.w > 0");
    await key(letter("r", SHIFT));
    await key(letter("s", CTRL));
    await until("s.dialog === 'dlg-confirm'");
    await key(KEYS.Enter);
    s = await until("!s.dialog && s.w === 200");
    m = meta.readMeta(fs.readFileSync(P("06-devre.bmp")));
    check(m.format === "BMP" && m.width === 200 && m.height === 320, "BMP rewritten turned: 200x320", JSON.stringify(m));

    console.log("clipboard and NeuralNav (test files)");
    await key(letter("c", CTRL));
    await run("await wait(() => q('#toast').classList.contains('show')); return 1;");
    await sleep(300);
    const png = fs.existsSync(path.join(CLIP, "pano.png")) ? meta.readMeta(fs.readFileSync(path.join(CLIP, "pano.png"))) : {};
    check(png.format === "PNG" && png.width === 200 && png.height === 320, "Ctrl+C copies the picture as shown", JSON.stringify(png));
    await key(letter("c", CTRL | SHIFT));
    await sleep(400);
    check(fs.existsSync(path.join(CLIP, "pano.txt")) && fs.readFileSync(path.join(CLIP, "pano.txt"), "utf8") === P("06-devre.bmp"), "Ctrl+Shift+C copies the path");
    await key(letter("e", CTRL));
    await sleep(400);
    const launched = fs.existsSync(LAUNCH) ? JSON.parse(fs.readFileSync(LAUNCH, "utf8").trim().split("\n").pop()) : null;
    check(launched && launched.args[0] === P("06-devre.bmp") && (launched.exe === "explorer" || /NeuralNav\\Program\\NeuralNav\.exe$/.test(launched.exe)),
      "Ctrl+E opens the file's place in NeuralNav (or Explorer)", JSON.stringify(launched));

    console.log("rename");
    await key(KEYS.Left); await key(KEYS.Left); await key(KEYS.Left);
    s = await until("s.title.startsWith('03-karakoy-yagmur.webp') && s.w > 0");
    await key(KEYS.F2);
    s = await until("s.dialog === 'dlg-rename'");
    r = await run("const i = q('#rename-input'); return i.value.slice(i.selectionStart, i.selectionEnd);");
    check(s.dialog === "dlg-rename" && r === "03-karakoy-yagmur", "F2 offers the name with the base name selected", r);
    await run("q('#rename-input').value = 'a:b.webp'; q('#rename-form').requestSubmit(); await wait(() => q('#rename-error').textContent); return 1;");
    r = await run("return q('#rename-error').textContent;");
    check(/içeremez/.test(r) && fs.existsSync(P("03-karakoy-yagmur.webp")), "an invalid name is refused with a reason", r);
    await run("q('#rename-input').value = '03 köprü yağmuru.webp'; q('#rename-form').requestSubmit(); return 1;");
    s = await until("!s.dialog && s.title.startsWith('03 köprü yağmuru.webp')");
    check(fs.existsSync(P("03 köprü yağmuru.webp")) && !fs.existsSync(P("03-karakoy-yagmur.webp")) && s.thumbs === 12, "renamed on disk, still 12 images", JSON.stringify(s));

    console.log("delete (to the test trash)");
    await key(KEYS.End); await key(KEYS.Left);
    s = await until("s.title.startsWith('11-bozuk.png')");
    await key(KEYS.Del);
    s = await until("s.dialog === 'dlg-confirm'");
    r = await run("return q('#confirm-text').textContent;");
    check(/Geri Dönüşüm Kutusu/.test(r), "Del asks first", r);
    await key(KEYS.Enter);
    s = await until("!s.dialog && s.thumbs === 11");
    check(!fs.existsSync(P("11-bozuk.png")) && fs.existsSync(path.join(TRASH, "11-bozuk.png")) && s.title.startsWith("12 ölçüsüz"), "moved away, the next image shows", JSON.stringify(s));

    console.log("folder changes, sorting, second launch");
    fs.copyFileSync(P("02-tabela.png"), P("13-yeni.png"));
    s = await until("s.thumbs === 12", 5000);
    check(s.thumbs === 12, "a new file in the folder appears in the strip");
    await run(`
      const top = (label) => qa('#menubar > button').find(b => b.textContent === label);
      const item = (label) => qa('.popup .mi').find(b => b.textContent.includes(label));
      top('Görünüm').click();
      await wait(() => item('Sırala'));
      item('Sırala').click();
      await wait(() => item('Boyut'));
      item('Boyut').click();
      return 1;`);
    r = await run("return qa('.thumb').map(b => b.title);");
    check(r[0] === "10-telefon.heic" && r[r.length - 1] === "01-galata-gece.jpg", "sort by size: the 88-byte HEIC first, the JPEG last", r.join(", "));
    s = await st();
    check(/^12 ölçüsüz/.test(s.title), "sorting keeps the open image", s.title);
    const second = spawn(EXE, [...APP_ARGS, P("05-dikey-yön6.jpg"), `--user-data-dir=${PROFILE}`], { env: ENV, stdio: "ignore" });
    s = await until("s.title.startsWith('05-dikey-yön6.jpg') && s.w > 0", 10000);
    check(s.title.startsWith("05-dikey-yön6.jpg") && s.w === 600 && s.h === 900, "a second launch hands its file to the open window", JSON.stringify(s));
    await new Promise((res) => { if (second.exitCode !== null) res(); else second.on("exit", res); setTimeout(res, 5000); });
    check(second.exitCode === 0, "and the second process exits", String(second.exitCode));

    console.log("full screen and slideshow");
    await key(KEYS.F11);
    s = await until("s.full");
    r = await run("return { w: innerWidth, h: innerHeight, sw: screen.width, sh: screen.height };");
    check(s.full && r.w === r.sw && r.h === r.sh, "F11 covers the whole screen", JSON.stringify(r));
    await key(KEYS.Esc);
    s = await until("!s.full");
    check(!s.full, "Esc leaves full screen");
    const before = s.pos;
    await key(KEYS.Space);
    s = await until("s.full");
    check(s.full, "Space starts the slideshow in full screen");
    s = await until(`s.pos !== ${JSON.stringify(before)}`, 6000);
    check(s.pos !== before, "the slideshow moves on by itself", `${before} -> ${s.pos}`);
    await key(KEYS.Space);
    s = await until("!s.full");
    check(!s.full, "Space stops it and leaves full screen");

    console.log("dialogs and themes");
    await key(KEYS.F1);
    s = await until("s.dialog === 'dlg-keys'");
    r = await run("return qa('#keys-list .kk').length;");
    check(s.dialog === "dlg-keys" && r >= 20, "F1 lists the shortcuts", String(r));
    await key(KEYS.Esc);
    await until("!s.dialog");
    await run(`
      const top = (label) => qa('#menubar > button').find(b => b.textContent === label);
      const item = (label) => qa('.popup .mi').find(b => b.textContent.includes(label));
      top('Görünüm').click(); await wait(() => item('Tema')); item('Tema').click(); await wait(() => item('Buz')); item('Buz').click(); return 1;`);
    r = await run("return { ice: document.documentElement.classList.contains('theme-ice'), saved: JSON.parse(localStorage.getItem('neuralview.settings')).theme };");
    check(r.ice && r.saved === "ice", "theme Buz applied and remembered", JSON.stringify(r));

    console.log("drag and drop");
    await cdp.call("Input.dispatchDragEvent", { type: "dragEnter", x: 400, y: 300, data: { items: [], files: [P("01-galata-gece.jpg")], dragOperationsMask: 1 } });
    await cdp.call("Input.dispatchDragEvent", { type: "dragOver", x: 400, y: 300, data: { items: [], files: [P("01-galata-gece.jpg")], dragOperationsMask: 1 } });
    await cdp.call("Input.dispatchDragEvent", { type: "drop", x: 400, y: 300, data: { items: [], files: [P("01-galata-gece.jpg")], dragOperationsMask: 1 } });
    s = await until("s.title.startsWith('01-galata-gece.jpg') && s.w > 0");
    check(s.title.startsWith("01-galata-gece.jpg"), "dropping a file opens it", s.title);

    console.log("closing with an unsaved rotation");
    await key(letter("r"));
    await run("q('#win-close').click(); return 1;");
    s = await until("s.dialog === 'dlg-confirm'");
    check(s.dialog === "dlg-confirm", "closing asks about the turned JPEG");
    await run("qa('#confirm-btns button').find(b => b.value === 'discard').click(); return 1;");
    const exited = await new Promise((res) => { if (proc.exitCode !== null) res(true); proc.on("exit", () => res(true)); setTimeout(() => res(false), 6000); });
    check(exited, "\"Kaydetme\" closes the window without saving");
  } catch (e) {
    failed++;
    console.log("  FAIL " + e.stack);
  } finally {
    try { cdp.close(); } catch (e) { /* closed */ }
    if (proc.exitCode === null) proc.kill();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
