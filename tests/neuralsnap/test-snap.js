"use strict";
require("../../tools/lang-env")(); // the program speaks Turkish, the language of its checks
// Drives NeuralSnap from source (node_modules\electron\dist\electron.exe apps\neuralsnap) through the Chrome DevTools
// protocol. Nothing of the real screen is used: NEURALSNAP_TEST_IMAGE makes a demo screenshot of the series the
// "screen" (with fake window rectangles), NEURALSNAP_TEST_OVERLAY shows the overlay as a small inactive window instead
// of covering the display, every window opens without taking the focus (NEURALSNAP_TEST_INACTIVE), no key is pressed
// for real (CDP input and page events only), the clipboard is a file, captures go to a temp folder, the save dialog is
// answered by NEURALSNAP_TEST_SAVE_AS, hand-offs and notifications are log lines (NEURAL_TEST_LAUNCH, NEURAL_TEST_NOTIFY)
// and the global shortcuts are ones nobody else uses (Ctrl+Alt+Shift+F5..F8, set in throwaway profiles). The helper
// sngrab.exe is compiled into a temp folder (NEURALSNAP_GRAB); it runs but is never asked to grab. Only the processes
// this test starts are ended.
//   node tests\neuralsnap\test-snap.js
const fs = require("fs");
const path = require("path");
const os = require("os");
const zlib = require("zlib");
const { spawn, execFileSync } = require("child_process");
const { sleep, waitTarget, attach, targets } = require("../../tools/cdp");

const ROOT = path.join(__dirname, "..", "..");
const APP = path.join(ROOT, "apps", "neuralsnap");
const ELECTRON = path.join(ROOT, "node_modules", "electron", "dist", "electron.exe");
const CSC = path.join(process.env.SystemRoot || "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
const IMAGE = path.join(ROOT, "docs", "images", "screenshots", "neuralnav.png"); // 1180 x 760
const OUT = path.join(os.tmpdir(), "neural-testler", "snap-e2e");
const BIN = path.join(OUT, "bin");
const GRAB = path.join(BIN, "sngrab.exe");
const FAKE = path.join(OUT, "Neural");
const LOG = path.join(OUT, "launch.jsonl");
const NOTIFY = path.join(OUT, "notify.jsonl");
const THEME = path.join(OUT, "theme.json");
const CLIP = path.join(OUT, "pano.png");
const SAVED = path.join(OUT, "Resimler", "NeuralSnap");
const SAVE_AS = path.join(OUT, "Farklı kayıt.png");
const BIG = path.join(OUT, "big-screen.png");
const OVERLAY = "40,40,590,380"; // half the test picture: one CSS pixel is two picture pixels
const WINDOWS = [{ x: 100, y: 80, w: 400, h: 300 }, { x: 600, y: 200, w: 500, h: 400 }, { x: 900, y: 500, w: 400, h: 400 }]; // z-order, top first
const ACCEL = "Ctrl+Alt+Shift+F8", NEW_ACCEL = "Ctrl+Alt+Shift+F7", HELD = "Ctrl+Alt+Shift+F6";
const FLAGS = ["--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding"];
let passed = 0, failed = 0;
const check = (cond, label, extra = "") => { if (cond) { passed++; console.log("  ok   " + label); } else { failed++; console.log("  FAIL " + label + (extra ? "  -> " + extra : "")); } };
const j = (x) => JSON.stringify(x);
const started = [];
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
const lines = (f) => { try { return fs.readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch (e) { return []; } };
const savedFiles = () => { try { return fs.readdirSync(SAVED).sort(); } catch (e) { return []; } };
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

/* ---------- PNG, with zlib only ---------- */
function decodePng(buf) {
  if (!buf || buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let p = 8, w = 0, h = 0, depth = 0, type = 0, interlace = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), name = buf.toString("ascii", p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
    if (name === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; type = data[9]; interlace = data[12]; }
    else if (name === "IDAT") idat.push(data);
    else if (name === "IEND") break;
    p += 12 + len;
  }
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[type];
  if (depth !== 8 || !ch || interlace) throw new Error(`PNG kind not handled (depth ${depth}, type ${type}, interlace ${interlace})`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch, out = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(stride), cur = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
      let v = line[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[i] = v & 255;
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4, s = x * ch;
      if (ch >= 3) { out[o] = cur[s]; out[o + 1] = cur[s + 1]; out[o + 2] = cur[s + 2]; out[o + 3] = ch === 4 ? cur[s + 3] : 255; }
      else { out[o] = out[o + 1] = out[o + 2] = cur[s]; out[o + 3] = ch === 2 ? cur[s + 1] : 255; }
    }
    [prev, cur] = [cur, prev];
  }
  return { w, h, data: out };
}
function encodePng(rgba, w, h) {
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const chunk = (name, data) => { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length, 0); b.write(name, 4, "ascii"); data.copy(b, 8); b.writeUInt32BE(zlib.crc32(b.subarray(4, 8 + data.length)), 8 + data.length); return b; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 1 })), chunk("IEND", Buffer.alloc(0))]);
}
const pix = (img, x, y) => [...img.data.subarray((y * img.w + x) * 4, (y * img.w + x) * 4 + 4)];
const near = (p, hex, tol = 40) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)); return c.every((v, i) => Math.abs(v - p[i]) <= tol); };
const sameRGB = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

// The test picture as NeuralSnap sees it: drawn on black (its chamfered corners are transparent).
const source = decodePng(fs.readFileSync(IMAGE));
const screen = { w: source.w, h: source.h, data: Buffer.alloc(source.data.length), soft: new Uint8Array(source.w * source.h) };
for (let i = 0, k = 0; i < source.data.length; i += 4, k++) {
  const a = source.data[i + 3];
  for (let c = 0; c < 3; c++) screen.data[i + c] = Math.round((source.data[i + c] * a) / 255);
  screen.data[i + 3] = 255;
  screen.soft[k] = a !== 255 ? 1 : 0;
}
// png against the screen's rectangle: exact for opaque pixels, within 1 where the source is transparent
function matchesScreen(img, r) {
  if (!img || img.w !== r.w || img.h !== r.h) return { ok: false, why: `size ${img && img.w}x${img && img.h}` };
  let diff = 0, first = null;
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
    const a = pix(img, x, y), b = pix(screen, r.x + x, r.y + y);
    const tol = screen.soft[(r.y + y) * screen.w + r.x + x] ? 1 : 0;
    if (a[3] !== 255 || [0, 1, 2].some((c) => Math.abs(a[c] - b[c]) > tol)) { diff++; if (!first) first = { x, y, got: a, want: b }; }
  }
  return { ok: diff === 0, why: `${diff} pixels differ, first ${j(first)}` };
}
const sameImage = (a, b) => !!a && !!b && a.w === b.w && a.h === b.h && Buffer.compare(a.data, b.data) === 0;

/* ---------- programs ---------- */
function compile(out, src) {
  try { execFileSync(CSC, ["/nologo", "/optimize+", "/target:exe", "/platform:x64", `/out:${out}`, src], { stdio: "pipe" }); } catch (e) { /* checked below */ }
  return fs.existsSync(out);
}
function profile(name, settings) {
  const dir = path.join(OUT, "profile-" + name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify(settings));
  // a modest editor window, so a test run takes little of the screen
  fs.writeFileSync(path.join(dir, "window.json"), JSON.stringify({ bounds: { x: 680, y: 60, width: 940, height: 660 }, maximized: false }));
  return dir;
}
function envFor(name, settings, extra = {}) {
  return {
    ...process.env, NEURALSNAP_PROFILE: profile(name, settings), NEURALSNAP_GRAB: GRAB, NEURAL_THEME_FILE: THEME,
    NEURALSNAP_TEST_IMAGE: IMAGE, NEURALSNAP_TEST_WINDOWS: JSON.stringify(WINDOWS), NEURALSNAP_TEST_OVERLAY: OVERLAY, NEURALSNAP_TEST_INACTIVE: "1",
    NEURALSNAP_TEST_CLIPBOARD: CLIP, NEURALSNAP_SAVE_DIR: SAVED, NEURALSNAP_TEST_SAVE_AS: SAVE_AS,
    NEURAL_ROOT: FAKE, NEURAL_TEST_LAUNCH: LOG, NEURAL_TEST_NOTIFY: NOTIFY, ...extra,
  };
}
function startApp(port, env, args = []) {
  const p = spawn(ELECTRON, [APP, ...(port ? [`--remote-debugging-port=${port}`] : []), ...FLAGS, ...args], { env, stdio: "ignore" });
  started.push(p);
  return p;
}
const exited = (p, ms) => new Promise((res) => { if (p.exitCode !== null) { res(true); return; } const t = setTimeout(() => res(false), ms); p.on("exit", () => { clearTimeout(t); res(true); }); });

/* ---------- input through the DevTools protocol (never real keys) ---------- */
const MOD = { alt: 1, ctrl: 2, shift: 8 };
// A call to a page that closes its window on the event (Esc or a double-click on a pin, Atla when quitting) is never
// answered: no wait is endless.
const timed = (p, ms = 5000) => Promise.race([p, sleep(ms).then(() => undefined)]);
function input(c) {
  const call = (method, params) => timed(c.call(method, params));
  const mouse = (type, x, y, o = {}) => call("Input.dispatchMouseEvent", { type, x, y, button: o.button || "none", buttons: o.buttons || 0, clickCount: o.count || 0, modifiers: o.mod || 0 });
  const api = {
    move: (x, y, held = false) => mouse("mouseMoved", x, y, held ? { button: "left", buttons: 1 } : {}),
    down: (x, y, button = "left", count = 1) => mouse("mousePressed", x, y, { button, buttons: button === "left" ? 1 : button === "right" ? 2 : 4, count }),
    up: (x, y, button = "left", count = 1) => mouse("mouseReleased", x, y, { button, count }),
    async click(x, y, button = "left") { await api.move(x, y); await api.down(x, y, button); await api.up(x, y, button); },
    async dblclick(x, y) { await api.move(x, y); await api.down(x, y, "left", 1); await api.up(x, y, "left", 1); await api.down(x, y, "left", 2); await api.up(x, y, "left", 2); },
    async drag(points) {
      const [a, ...rest] = points;
      await api.move(a.x, a.y);
      await api.down(a.x, a.y);
      for (const p of rest) { await api.move(p.x, p.y, true); await sleep(15); }
      const z = points[points.length - 1];
      await api.up(z.x, z.y);
    },
    wheel: (x, y, deltaY) => call("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY }),
    async key(key, code, vk, mod = 0) {
      await call("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code, windowsVirtualKeyCode: vk, modifiers: mod });
      await call("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, modifiers: mod });
    },
    letter: (ch, mod = 0) => api.key(mod & MOD.shift ? ch.toUpperCase() : ch, "Key" + ch.toUpperCase(), ch.toUpperCase().charCodeAt(0), mod),
    digit: (d) => api.key(String(d), "Digit" + d, 48 + d),
    enter: () => api.key("Enter", "Enter", 13),
    esc: () => api.key("Escape", "Escape", 27),
    del: () => api.key("Delete", "Delete", 46),
  };
  return api;
}
const PRELUDE = `
  const q = s => document.querySelector(s); const qa = s => [...document.querySelectorAll(s)];
  const wait = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = await fn(); if (v) return v; } catch {} await new Promise(r => setTimeout(r, 40)); } return null; };
`;
// A page just attached may still be replacing its first document: ask until it answers with its own script loaded.
async function attachReady(port, match, probe, ms = 30000) {
  const c = await attach(await waitTarget(port, match, ms));
  for (let i = 0; i < 100; i++) {
    try { if (await c.evaluate(`return document.readyState === 'complete' && !!(${probe});`)) return c; } catch (e) { /* the context was replaced */ }
    await sleep(100);
  }
  return c;
}
const mtime = (f) => { try { return fs.statSync(f, { bigint: true }).mtimeNs; } catch (e) { return 0n; } };
// Runs fn, then waits for the test clipboard file to change and reads it.
async function clipAfter(fn, ms = 8000) {
  const before = mtime(CLIP);
  await fn();
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (mtime(CLIP) !== before) { await sleep(120); try { return decodePng(fs.readFileSync(CLIP)); } catch (e) { await sleep(200); return decodePng(fs.readFileSync(CLIP)); } }
    await sleep(40);
  }
  return null;
}
async function shot(c, name) {
  try {
    const r = await c.call("Page.captureScreenshot", { format: "png" });
    if (r.result && r.result.data) fs.writeFileSync(path.join(OUT, name), Buffer.from(r.result.data, "base64"));
  } catch (e) { /* only a picture for people */ }
}

(async () => {
  try {
    fs.rmSync(OUT, { recursive: true, force: true });
    fs.mkdirSync(BIN, { recursive: true });
    for (const name of ["NeuralView", "NeuralNav"]) {
      const exe = path.join(FAKE, name, "Program", `${name}.exe`);
      fs.mkdirSync(path.dirname(exe), { recursive: true });
      fs.writeFileSync(exe, "");
    }
    console.log("setup");
    check(compile(GRAB, path.join(APP, "sngrab.cs")), "the helper compiles into a temp folder");
    check(source.w === 1180 && source.h === 760, `the fake screen: ${path.basename(IMAGE)} (${source.w} x ${source.h})`);

    /* ===== A: the main run ===== */
    const envA = envFor("A", { shortcut: ACCEL });
    const A = startApp(9410, envA, ["--arka-plan"]);
    const ov = await attachReady(9410, (t) => /overlay\.html/.test(t.url), "window.ovState", 30000);
    const ovIn = input(ov);
    const ovRun = (body) => ov.evaluate(PRELUDE + body);
    const state = () => ovRun("return await window.snapOverlay.state();");
    const waitState = async (fn, ms = 8000) => { const t0 = Date.now(); let s; while (Date.now() - t0 < ms) { s = await state(); if (fn(s)) return s; await sleep(50); } return s; };

    console.log("background start (--arka-plan)");
    let s = await waitState((x) => x.grabber.running, 6000);
    check(s.background && !s.editor && s.visibleWindows === 0, "no window: the editor is not even created, the overlay waits hidden", j({ editor: s.editor, visible: s.visibleWindows }));
    check(s.shortcut.ok && s.shortcut.accel === ACCEL, `the shortcut from the profile's settings.json is registered (${ACCEL})`, j(s.shortcut));
    check(s.grabber.running && s.grabber.pid > 0, "the grabber (sngrab.exe) runs as a child, waiting", j(s.grabber));
    check(s.overlays.length === 1 && s.overlays[0].test && !s.overlays[0].visible && j(s.overlays[0].bounds) === j({ x: 40, y: 40, width: 590, height: 380 }), "one overlay, the small test window, hidden", j(s.overlays));
    const grabberPid = s.grabber.pid;

    console.log("--cek from a second start");
    const second = startApp(0, envA, ["--cek"]);
    s = await waitState((x) => x.overlays[0].visible && x.capturing);
    check(s.overlays[0].visible && s.capturing, "the overlay comes up with the frozen picture");
    check(await exited(second, 8000) && second.exitCode === 0, "the second process hands over and exits");
    let o = await ovRun("return await wait(() => window.ovState().mode === 'idle' && window.ovState());");
    check(o && o.w === 1180 && o.h === 760 && j(o.scale) === j([2, 2]), "the overlay holds the picture in its own pixels (1180 x 760, two per CSS pixel here)", j(o));
    check(o.hint === "Sürükle: bölge · Tıkla: pencere · Enter: tam ekran · Esc: vazgeç", "the hint bar", o.hint);
    check(s.timing && s.timing.total < 300, `shortcut → overlay shown in ${s.timing && s.timing.total} ms (grab ${s.timing && s.timing.grab}, draw ${s.timing && s.timing.draw}, show ${s.timing && s.timing.show})`, j(s.timing));

    console.log("drag a region");
    await ovIn.move(30, 25);
    await ovIn.down(30, 25);
    for (const [x, y] of [[80, 60], [150, 120], [230, 175]]) { await ovIn.move(x, y, true); await sleep(20); }
    o = await ovRun("return window.ovState();");
    check(o.mode === "drag" && j(o.sel) === j({ x: 60, y: 50, w: 400, h: 300, kind: "rect" }), "the selection follows the drag in picture pixels", j(o.sel));
    check(o.chip === "400 × 300", "the size readout: 400 × 300 (physical pixels)", o.chip);
    const want = pix(screen, 460, 350);
    const hex = "#" + want.slice(0, 3).map((v) => v.toString(16).padStart(2, "0").toUpperCase()).join("");
    check(o.loupe && o.loupe.xy === "460, 350" && o.loupe.hex === hex, `the magnifier: the cursor's pixel and its colour (${hex})`, j(o.loupe));
    await shot(ov, "overlay-drag.png");
    const n0 = savedFiles().length;
    let img = await clipAfter(() => ovIn.up(230, 175));
    let r = matchesScreen(img, { x: 60, y: 50, w: 400, h: 300 });
    check(r.ok, "mouse-up: the clipboard (test file) holds exactly that crop, pixel for pixel", r.why);
    let files = savedFiles();
    const nameRe = /^NeuralSnap \d{4}-\d\d-\d\d \d\d-\d\d-\d\d( \(\d+\))?\.png$/;
    const first = files.find((f) => nameRe.test(f));
    check(files.length === n0 + 1 && first, "it is saved automatically as \"NeuralSnap <date> <time>.png\"", j(files));
    check(first && sameImage(decodePng(fs.readFileSync(path.join(SAVED, first))), img), "the saved PNG is the same picture");
    s = await waitState((x) => !x.overlays[0].visible && !x.capturing);
    check(!s.overlays[0].visible && !s.capturing && s.captures === 1, "the overlay is put away");
    const ed = await attachReady(9410, (t) => /index\.html/.test(t.url), "window.snapTest", 20000);
    await ed.call("Emulation.setFocusEmulationEnabled", { enabled: true }); // the page acts focused; the window never takes the focus
    const edIn = input(ed);
    const edRun = (body) => ed.evaluate(PRELUDE + body);
    const doc = () => edRun("return window.snapTest.doc();");
    let d = await edRun("return await wait(() => window.snapTest.doc());");
    s = await state();
    check(d && d.w === 400 && d.h === 300 && d.name === first && !d.dirty, "the editor opens with the capture and its file", j(d));
    check(s.editorVisible, "the editor window is shown (inactive in tests)");
    let st = await edRun("return [...document.querySelectorAll('.statusbar span')].map(s => s.textContent);");
    check(st[0] === "400 × 300 px" && /^Yakınlaştırma %\d+$/.test(st[1]) && st[3] === first, "status bar: size in pixels, zoom, file", j(st));

    console.log("pin");
    const pinTarget = () => attachReady(9410, (t) => /pin\.html/.test(t.url), "window.pinState", 10000);
    await edIn.letter("p", MOD.ctrl);
    let pin = await pinTarget();
    let ps = await pin.evaluate(PRELUDE + "return await wait(() => window.pinState().loaded && window.pinState());");
    s = await waitState((x) => x.pins.length === 1 && x.pins[0].visible);
    const pin0 = s.pins[0] || {};
    check(pin0.visible && pin0.alwaysOnTop, "Ctrl+P: a pin window, always on top", j(s.pins));
    check(ps && ps.shown.w === 400 && ps.shown.h === 300, "it shows the picture at full resolution", j(ps));
    const sf = await pin.evaluate("return devicePixelRatio;");
    check(pin0.bounds && Math.abs(pin0.bounds.width - (400 / sf + 20)) <= 2 && Math.abs(pin0.bounds.height - (300 / sf + 20)) <= 2, `at its natural size (one picture pixel per screen pixel, scale ${sf}), plus room for the shadow`, j(pin0.bounds));
    await shot(pin, "pin.png");
    const pinIn = input(pin);
    // a drag moves it: the pointer is given in the window's coordinates, which move with it, so each step aims at a
    // point on the screen
    {
      const b0 = pin0.bounds;
      await pinIn.move(100, 100);
      await pinIn.down(100, 100);
      for (const d of [10, 20, 30, 40]) {
        const cur = (await state()).pins[0].bounds;
        await pinIn.move(b0.x + 100 + d * 1.5 - cur.x, b0.y + 100 + d - cur.y, true);
        await sleep(60);
      }
      const cur = (await state()).pins[0].bounds;
      await pinIn.up(b0.x + 160 - cur.x, b0.y + 140 - cur.y);
      s = await state();
      const b1 = s.pins[0].bounds;
      check(Math.abs(b1.x - b0.x - 60) <= 2 && Math.abs(b1.y - b0.y - 40) <= 2 && b1.width === b0.width, "dragging it moves it", j({ b0, b1 }));
      pin0.bounds = b1;
    }
    await pinIn.wheel(150, 120, -150);
    s = await waitState((x) => x.pins[0] && x.pins[0].bounds.width > pin0.bounds.width + 20, 4000);
    check(s.pins[0] && s.pins[0].bounds.width > pin0.bounds.width + 20 && s.pins[0].zoom > 1, "the wheel zooms it", j(s.pins[0]));
    img = await clipAfter(() => pin.evaluate("return window.snapPin.act('copy');"));
    r = matchesScreen(img, { x: 60, y: 50, w: 400, h: 300 });
    check(r.ok, "its menu's Kopyala copies the picture", r.why);
    await pinIn.esc();
    s = await waitState((x) => x.pins.length === 0, 4000);
    check(s.pins.length === 0, "Esc closes it");
    await edIn.letter("p", MOD.ctrl);
    pin = await pinTarget();
    await pin.evaluate(PRELUDE + "return await wait(() => window.pinState().loaded);");
    await waitState((x) => x.pins.length === 1 && x.pins[0].visible);
    await input(pin).dblclick(100, 80);
    s = await waitState((x) => x.pins.length === 0, 4000);
    check(s.pins.length === 0, "so does a double-click");

    console.log("click a window");
    const capture = async () => { await ovRun("return await window.snapOverlay.test('capture');"); return waitState((x) => x.overlays[0].visible && x.capturing); };
    await capture();
    await ovRun("return await wait(() => window.ovState().mode === 'idle');");
    await ovIn.move(500, 275); // picture (1000, 550): inside the second and the third window; the second is on top
    o = await ovRun("return window.ovState();");
    check(o.sel && o.sel.kind === "window" && j([o.sel.x, o.sel.y, o.sel.w, o.sel.h]) === j([600, 200, 500, 400]), "hovering marks the topmost window under the cursor (cyan)", j(o.sel));
    await ovIn.move(350, 150);
    o = await ovRun("return window.ovState();");
    check(o.chip === "500 × 400", "with its size", o.chip);
    await shot(ov, "overlay-window.png");
    img = await clipAfter(() => ovIn.click(350, 150));
    r = matchesScreen(img, { x: 600, y: 200, w: 500, h: 400 });
    check(r.ok, "a click without dragging takes that window's rectangle", r.why);
    await waitState((x) => !x.capturing);
    await capture();
    await ovRun("return await wait(() => window.ovState().mode === 'idle');");
    img = await clipAfter(() => ovIn.click(500, 330)); // picture (1000, 660): only the third window, which reaches past the screen
    r = matchesScreen(img, { x: 900, y: 500, w: 280, h: 260 });
    check(r.ok, "a window that reaches past the screen is clipped to it (280 x 260)", r.why);
    await waitState((x) => !x.capturing);
    check(savedFiles().length === n0 + 3, "every capture is saved, each under its own name", j(savedFiles()));

    console.log("Enter, Esc, right-click");
    await capture();
    await ovRun("return await wait(() => window.ovState().mode === 'idle');");
    img = await clipAfter(() => ovIn.enter());
    r = matchesScreen(img, { x: 0, y: 0, w: 1180, h: 760 });
    check(r.ok, "Enter takes the whole (fake) screen", r.why);
    await waitState((x) => !x.capturing);
    d = await edRun("return await wait(() => window.snapTest.doc().w === 1180 && window.snapTest.doc());");
    const fullFile = d && d.file;
    check(d && d.w === 1180 && d.h === 760 && fullFile && path.dirname(fullFile) === SAVED, "and the editor has it", j(d));
    const clipBefore = mtime(CLIP), savedBefore = savedFiles().length, cancelled = (await state()).cancelled;
    await capture();
    await ovRun("return await wait(() => window.ovState().mode === 'idle');");
    await ovIn.move(200, 200);
    await ovIn.esc();
    s = await waitState((x) => !x.capturing && !x.overlays[0].visible);
    check(!s.capturing && !s.overlays[0].visible && s.cancelled === cancelled + 1, "Esc cancels and puts the overlay away");
    await capture();
    await ovRun("return await wait(() => window.ovState().mode === 'idle');");
    await ovIn.down(200, 200, "right");
    await ovIn.up(200, 200, "right");
    s = await waitState((x) => !x.capturing && !x.overlays[0].visible);
    check(!s.capturing && s.cancelled === cancelled + 2, "so does a right-click");
    await sleep(300);
    d = await doc();
    check(mtime(CLIP) === clipBefore && savedFiles().length === savedBefore && d.w === 1180 && d.file === fullFile, "nothing was copied, saved or opened", j({ files: savedFiles().length, d }));
    await edRun("q('#act-new').click(); return 1;");
    s = await waitState((x) => x.capturing && x.overlays[0].visible);
    check(s.capturing && !s.editorVisible, "the editor's Yeni çekim: the editor steps out of the picture first");
    await ovRun("return await wait(() => window.ovState().mode === 'idle');");
    await ovIn.esc();
    s = await waitState((x) => !x.capturing && x.editorVisible);
    check(!s.capturing && s.editorVisible, "and comes back when the capture is cancelled");
    await ovIn.move(100, 100);
    await capture();
    await ovRun("return await wait(() => window.ovState().mode === 'idle');");
    await ovIn.move(100, 100);
    await ovIn.down(100, 100);
    await ovIn.move(104, 101, true); // past the click threshold (3 CSS pixels), but only 8 x 2 picture pixels
    await ovIn.up(104, 101);
    o = await ovRun("return window.ovState();");
    s = await state();
    check(s.capturing && o.mode === "idle", "a drag smaller than 4 x 4 pixels is ignored (the overlay stays)", j({ mode: o.mode, capturing: s.capturing }));
    await ovIn.esc();
    await waitState((x) => !x.capturing);

    console.log("annotating");
    const toClient = (x, y) => edRun(`return window.snapTest.toClient(${x}, ${y});`);
    const dragOn = async (pts) => { const c = []; for (const [x, y] of pts) c.push(await toClient(x, y)); await edIn.drag(c); await sleep(80); };
    const clickOn = async (x, y) => { const c = await toClient(x, y); await edIn.click(c.x, c.y); await sleep(80); };
    const exportNow = () => clipAfter(() => edIn.letter("c", MOD.ctrl));
    const list = () => edRun("return window.snapTest.list();");
    const orig = (x, y) => pix(screen, x, y);
    const count = (im, x0, y0, x1, y1, fn) => { let n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (fn(pix(im, x, y), x, y)) n++; return n; };
    await edIn.letter("a");
    await edIn.digit(3);
    await dragOn([[100, 100], [200, 140], [300, 180]]);
    let L = await list();
    const arrow = L[0] || {};
    check(L.length === 1 && arrow.type === "arrow" && Math.abs(arrow.x1 - 100) <= 2 && Math.abs(arrow.y2 - 180) <= 2 && arrow.color === "#ff2a4f" && arrow.width === 6, "A, 3, drag: a red arrow (medium width)", j(L));
    img = await exportNow();
    const red = count(img, 95, 95, 305, 185, (p) => near(p, "#ff2a4f", 50));
    check(near(pix(img, 200, 140), "#ff2a4f", 50) && red > 600, `the exported picture has it (${red} red pixels along it, the head included)`, j(pix(img, 200, 140)));
    check(sameRGB(pix(img, 700, 600), orig(700, 600)) && img.w === 1180, "full resolution, and untouched elsewhere");
    check(await edRun("return window.snapTest.doc().dirty && q('#st-file').classList.contains('dirty');"), "the status bar marks the unsaved change");
    await edIn.letter("r");
    await edIn.digit(2);
    await dragOn([[400, 100], [500, 180], [600, 250]]);
    img = await exportNow();
    check(near(pix(img, 400, 175), "#00f0ff", 50) && near(pix(img, 600, 175), "#00f0ff", 50) && sameRGB(pix(img, 500, 175), orig(500, 175)), "R, 2: a cyan rectangle, an outline (its inside untouched)", j([pix(img, 400, 175), pix(img, 500, 175)]));
    await edIn.letter("p");
    await edIn.digit(1);
    await dragOn([[100, 300], [130, 318], [160, 330], [190, 318], [220, 300], [250, 318], [280, 330]]);
    img = await exportNow();
    const yellow = count(img, 95, 290, 290, 340, (p) => near(p, "#fcee0a", 60));
    check(yellow > 400, `P, 1: a yellow freehand line (${yellow} yellow pixels)`);
    await edIn.letter("h");
    await dragOn([[700, 400], [850, 400], [1000, 400]]);
    img = await exportNow();
    let tinted = 0, solid = 0, all = 0;
    for (let x = 720; x < 980; x++) for (let y = 393; y < 408; y++) {
      const a = pix(img, x, y), b = orig(x, y);
      all++;
      // towards yellow: red and green up (or kept), blue down relative to them
      if ((a[0] - b[0]) - (a[2] - b[2]) >= 12 && a[0] >= b[0] && a[1] >= b[1]) tinted++;
      if (near(a, "#fcee0a", 30)) solid++;
    }
    check(tinted > all * 0.9 && solid === 0, `H: the highlighter tints what is under it yellow, translucently, on this dark page too (${tinted} of ${all} pixels, none solid yellow)`);
    await edIn.letter("t");
    await clickOn(100, 450);
    check(await edRun("return await wait(() => window.snapTest.editing() && document.activeElement === q('#text-edit'));", 3000), "T, click: a text box opens where the click was");
    await ed.call("Input.insertText", { text: "NEO 77" });
    await edIn.enter();
    L = await list();
    const text = L.find((a) => a.type === "text") || {};
    check(text.text === "NEO 77" && Math.abs(text.x - 100) <= 2 && Math.abs(text.y - 450) <= 2 && text.w > 40 && text.color === "#fcee0a" && !(await edRun("return window.snapTest.editing();")), "typing and Enter place the text", j(text));
    img = await exportNow();
    const glyphs = count(img, Math.floor(text.x), Math.floor(text.y), Math.ceil(text.x + text.w), Math.ceil(text.y + text.h), (p) => near(p, "#fcee0a", 70));
    const outline = count(img, Math.floor(text.x), Math.floor(text.y), Math.ceil(text.x + text.w), Math.ceil(text.y + text.h), (p, x, y) => p[0] + p[1] + p[2] < 30 && !sameRGB(p, orig(x, y)));
    check(glyphs > 80 && outline > 20, `the text is drawn in yellow with a dark outline (${glyphs} yellow, ${outline} outline pixels)`);
    await edIn.letter("b");
    await dragOn([[620, 220], [700, 300], [840, 360]]); // over the file list: names and dates
    L = await list();
    const px = L[L.length - 1] || {};
    check(px.type === "pixelate" && Math.abs(px.w - 220) <= 3 && Math.abs(px.h - 140) <= 3 && px.block === 16 && Number.isInteger(px.x), "B, drag: a pixelated area in whole pixels (blocks of 16 at medium width)", j(px));
    const pixImg = await exportNow();
    const colours = new Set();
    let blocky = true, differs = 0;
    for (let y = px.y; y < px.y + px.h; y++) for (let x = px.x; x < px.x + px.w; x++) {
      const p = pix(pixImg, x, y);
      colours.add(p.slice(0, 3).join(","));
      const bx = px.x + Math.floor((x - px.x) / 16) * 16, by = px.y + Math.floor((y - px.y) / 16) * 16;
      if (!sameRGB(p, pix(pixImg, bx, by))) blocky = false;
      if (!sameRGB(p, orig(x, y))) differs++;
    }
    const blocks = Math.ceil(px.w / 16) * Math.ceil(px.h / 16);
    check(blocky && colours.size <= blocks, `the exported area is blocky: ${colours.size} colours for ${blocks} blocks, each block one colour`);
    check(differs > px.w * px.h * 0.5, `and differs from the original (${differs} of ${px.w * px.h} pixels)`);
    await edIn.letter("a");
    await edIn.digit(3);
    await dragOn([[640, 240], [730, 290], [820, 340]]);
    const overImg = await exportNow();
    const sharp = count(overImg, px.x, px.y, px.x + px.w, px.y + px.h, (p) => near(p, "#ff2a4f", 40));
    check(sharp > 300 && near(pix(overImg, 730, 290), "#ff2a4f", 40), `an arrow drawn over it stays sharp (${sharp} red pixels in the area)`);
    await shot(ed, "editor-annotated.png");

    console.log("undo, redo");
    await edIn.letter("z", MOD.ctrl);
    img = await exportNow();
    check(sameImage(img, pixImg), "Ctrl+Z takes the last arrow away (the picture is the one from before, exactly)");
    await edIn.letter("y", MOD.ctrl);
    img = await exportNow();
    check(sameImage(img, overImg), "Ctrl+Y brings it back");
    await edIn.letter("z", MOD.ctrl);
    await edIn.letter("z", MOD.ctrl | MOD.shift);
    img = await exportNow();
    check(sameImage(img, overImg) && (await list()).length === 7, "Ctrl+Shift+Z redoes too");

    console.log("select, move, delete");
    await edIn.letter("v");
    await clickOn(400, 175);
    let sel = await edRun("return window.snapTest.sel();");
    L = await list();
    check(sel >= 0 && L[sel] && L[sel].type === "rect", "V, click on the rectangle's edge: selected", j({ sel }));
    await edIn.del();
    L = await list();
    img = await exportNow();
    check(!L.some((a) => a.type === "rect") && sameRGB(pix(img, 400, 175), orig(400, 175)), "Del deletes it");
    await edIn.letter("z", MOD.ctrl);
    await sleep(80);
    L = await list();
    check(L.some((a) => a.type === "rect"), "Ctrl+Z restores it");
    await dragOn([[400, 175], [415, 185], [430, 195]]);
    L = await list();
    const moved = L.find((a) => a.type === "rect") || {};
    check(Math.abs(moved.x - 430) <= 2 && Math.abs(moved.y - 120) <= 2, "dragging moves it", j(moved));
    await edIn.letter("z", MOD.ctrl);
    const tc = await toClient(text.x + 10, text.y + 10);
    await edIn.dblclick(tc.x, tc.y);
    const editing = await edRun("return await wait(() => window.snapTest.editing() && q('#text-edit').value);", 3000);
    check(editing === "NEO 77", "a double-click on the text edits it", j(editing));
    await edIn.esc();
    L = await list();
    check(!(await edRun("return window.snapTest.editing();")) && L.find((a) => a.type === "text").text === "NEO 77", "Esc leaves it as it was");

    console.log("copy, save, save as, NeuralView");
    const annotated = await exportNow();
    check(annotated && annotated.w === 1180 && !sameImage(annotated, screen), "Ctrl+C writes the annotated picture (full resolution) to the clipboard");
    const nSaved = savedFiles().length;
    await edIn.letter("s", MOD.ctrl);
    d = await edRun("return await wait(() => !window.snapTest.doc().dirty && window.snapTest.doc());");
    check(d && d.file === fullFile && sameImage(decodePng(fs.readFileSync(fullFile)), annotated) && savedFiles().length === nSaved, "Ctrl+S overwrites the automatically saved file with the annotated picture", j(d));
    let t = await edRun("return await wait(() => q('#toast.show') && /^Kaydedildi/.test(q('#toast').textContent) && q('#toast').textContent);");
    check(t === `Kaydedildi: ${path.basename(fullFile)}`, "and says so", t);
    await edIn.letter("a");
    await dragOn([[700, 650], [800, 700]]);
    await edIn.letter("s", MOD.ctrl | MOD.shift);
    d = await edRun(`return await wait(() => window.snapTest.doc().name === ${j(path.basename(SAVE_AS))} && window.snapTest.doc());`);
    const asImg = fs.existsSync(SAVE_AS) ? decodePng(fs.readFileSync(SAVE_AS)) : null;
    check(d && !d.dirty && asImg && asImg.w === 1180 && !sameImage(asImg, annotated), "Ctrl+Shift+S: Farklı kaydet writes the test path (a space and Turkish letters in it)", j(d));
    st = await edRun("return q('#st-file').textContent;");
    check(st === path.basename(SAVE_AS), "the status bar names the new file", st);
    await edRun("q('#act-view').click(); return 1;");
    let hand = null;
    for (let i = 0; i < 60 && !hand; i++) { hand = lines(LOG).find((l) => l.by === "NeuralSnap" && l.program === "NeuralView"); if (!hand) await sleep(50); }
    check(hand && hand.args.length === 1 && hand.args[0] === SAVE_AS && /\.png$/i.test(hand.args[0]), "NeuralView'da aç hands the PNG to NeuralView", j(lines(LOG)));

    console.log("unsaved annotations and a new capture");
    await dragOn([[100, 650], [250, 700]]);
    const before = await doc();
    await capture();
    await ovRun("return await wait(() => window.ovState().mode === 'idle');");
    await clipAfter(() => ovIn.enter());
    t = await edRun("return await wait(() => q('#dlg-unsaved[open]') && q('#unsaved-text').textContent);");
    check(before.dirty && /kaydedilmedi/.test(t || ""), "the editor asks first: Kaydet / Atla / Vazgeç", t);
    await edRun("q('#unsaved-cancel').click(); return 1;");
    d = await edRun("return await wait(() => !q('#dlg-unsaved[open]') && window.snapTest.doc());");
    check(d.id === before.id && d.dirty && d.count === before.count, "Vazgeç keeps the annotated picture in the editor (the new one is on the clipboard and saved)", j(d));
    await capture();
    await ovRun("return await wait(() => window.ovState().mode === 'idle');");
    await clipAfter(() => ovIn.enter());
    await edRun("await wait(() => q('#dlg-unsaved[open]')); q('#unsaved-skip').click(); return 1;");
    d = await edRun(`return await wait(() => window.snapTest.doc().id !== ${before.id} && window.snapTest.doc());`);
    check(d && d.count === 0 && !d.dirty, "Atla opens the new capture", j(d));

    console.log("settings: automatic saving, the editor");
    const openSettings = () => edRun("q('#menu-btn').click(); await wait(() => q('.popup')); [...document.querySelectorAll('.popup .mi')].find(b => b.textContent.includes('Ayarlar')).click(); return !!(await wait(() => q('#dlg-settings[open]')));");
    check(await openSettings(), "the menu opens the settings");
    r = await edRun("return { dir: q('#set-dir').textContent, auto: q('#set-autosave').getAttribute('aria-checked'), editor: q('#set-editor').getAttribute('aria-checked'), key: q('#set-shortcut').textContent };");
    check(r.dir === SAVED && r.auto === "true" && r.editor === "true" && r.key === ACCEL, "they show the folder, both switches on and the shortcut", j(r));
    await shot(ed, "settings.png");
    await edRun("q('#set-autosave').click(); await wait(() => q('#set-autosave').getAttribute('aria-checked') === 'false'); q('#set-ok').click(); return 1;");
    const settingsA = () => JSON.parse(fs.readFileSync(path.join(envA.NEURALSNAP_PROFILE, "settings.json"), "utf8"));
    check(settingsA().autoSave === false, "switching automatic saving off is saved", j(settingsA()));
    let n1 = savedFiles().length;
    await capture();
    await ovRun("return await wait(() => window.ovState().mode === 'idle');");
    img = await clipAfter(() => ovIn.enter());
    d = await edRun("return await wait(() => window.snapTest.doc() && !window.snapTest.doc().file && window.snapTest.doc());");
    await sleep(300);
    check(img && img.w === 1180 && savedFiles().length === n1 && d && d.file === null, "then a capture is copied but no file is written", j({ files: savedFiles().length - n1, d }));
    check((await edRun("return q('#st-file').textContent;")) === "Kaydedilmedi", "the status bar says Kaydedilmedi");
    const logN = lines(LOG).length;
    await edRun("q('#act-view').click(); return 1;");
    for (let i = 0; i < 60 && lines(LOG).length === logN; i++) await sleep(50);
    hand = lines(LOG)[logN];
    files = savedFiles();
    check(hand && hand.program === "NeuralView" && files.length === n1 + 1 && path.dirname(hand.args[0]) === SAVED, "NeuralView'da aç saves it into the capture folder first", j({ hand, files: files.length - n1 }));
    await openSettings();
    await edRun("q('#set-autosave').click(); q('#set-editor').click(); await wait(() => q('#set-editor').getAttribute('aria-checked') === 'false'); q('#set-ok').click(); return 1;");
    check(settingsA().autoSave === true && settingsA().openEditor === false, "the editor switch off (saving back on)", j(settingsA()));
    const docId = (await doc()).id;
    n1 = savedFiles().length;
    const notes = lines(NOTIFY).length;
    const filesBefore = savedFiles();
    await capture();
    await ovRun("return await wait(() => window.ovState().mode === 'idle');");
    img = await clipAfter(() => ovIn.enter());
    for (let i = 0; i < 60 && lines(NOTIFY).length === notes; i++) await sleep(50);
    const note = lines(NOTIFY)[notes];
    files = savedFiles();
    const added = files.filter((f) => !filesBefore.includes(f));
    check(note && note.by === "NeuralSnap" && note.title === "Panoya kopyalandı" && added.length === 1 && note.body === `Kaydedildi: ${added[0]}`, "then a capture gives a notification: Panoya kopyalandı, with the file", j(note));
    await sleep(300);
    check((await doc()).id === docId && files.length === n1 + 1, "and the editor keeps its picture", j(await doc()));
    await openSettings();
    await edRun("q('#set-editor').click(); await wait(() => q('#set-editor').getAttribute('aria-checked') === 'true'); return 1;");

    console.log("settings: the shortcut");
    const record = (keyInit) => edRun(`q('#set-msg').textContent = ''; q('#set-shortcut').click(); await wait(() => q('#set-shortcut').classList.contains('capturing'));
      window.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ bubbles: true, cancelable: true }, ${j(keyInit)})));
      await wait(() => !q('#set-shortcut').classList.contains('capturing') && q('#set-msg').textContent);
      return { key: q('#set-shortcut').textContent, msg: q('#set-msg').textContent, err: q('#set-msg').classList.contains('err') };`);
    r = await record({ key: "F7", code: "F7", ctrlKey: true, altKey: true, shiftKey: true });
    s = await state();
    check(r.key === NEW_ACCEL && r.msg === `Yeni kısayol: ${NEW_ACCEL}` && s.shortcut.ok && s.shortcut.accel === NEW_ACCEL && settingsA().shortcut === NEW_ACCEL, "a new shortcut is recorded, registered and saved", j({ r, sc: s.shortcut }));
    r = await record({ key: "a", code: "KeyA" });
    s = await state();
    check(r.err && /kullanılamaz/.test(r.msg) && s.shortcut.ok && s.shortcut.accel === NEW_ACCEL, "a plain letter is refused; the shortcut stays", j(r));
    const B = startApp(9411, envFor("B", { shortcut: HELD }), ["--arka-plan"]);
    const b = await attachReady(9411, (x) => /overlay\.html/.test(x.url), "window.ovState", 30000);
    const sb = await b.evaluate(PRELUDE + "return await wait(async () => { const s = await window.snapOverlay.state(); return s.shortcut.accel && s; });");
    check(sb.shortcut.ok && sb.shortcut.accel === HELD, `another NeuralSnap (its own profile) holds ${HELD}`, j(sb.shortcut));
    const C = startApp(9412, envFor("C", { shortcut: HELD }), ["--arka-plan"]);
    const cc = await attachReady(9412, (x) => /overlay\.html/.test(x.url), "window.ovState", 30000);
    const sc = await cc.evaluate(PRELUDE + "return await wait(async () => { const s = await window.snapOverlay.state(); return s.shortcut.accel && s; });");
    check(!sc.shortcut.ok && sc.shortcut.error === `Kısayol başka bir program tarafından kullanılıyor: ${HELD}`, "a third one that starts with the same shortcut cannot register it and says why", j(sc.shortcut));
    r = await record({ key: "F6", code: "F6", ctrlKey: true, altKey: true, shiftKey: true });
    s = await state();
    check(r.err && r.msg === `Kısayol başka bir program tarafından kullanılıyor: ${HELD} Kısayol ${NEW_ACCEL} olarak kaldı.` && s.shortcut.ok && s.shortcut.accel === NEW_ACCEL, "picking a shortcut that is taken: reported, and the old one stays", j(r));
    await edRun("q('#set-ok').click(); return 1;");
    b.close();
    cc.close();
    for (const p of [B, C]) { try { execFileSync("taskkill", ["/T", "/F", "/PID", String(p.pid)], { stdio: "ignore" }); } catch (e) { /* gone */ } }

    console.log("closing and quitting");
    await dragOn([[600, 300], [700, 350]]);
    await edRun("q('#win-close').click(); return 1;");
    s = await waitState((x) => !x.editorVisible, 4000);
    check(!s.editorVisible && A.exitCode === null && s.editor, "closing the window hides it; NeuralSnap stays in the tray");
    await ovRun("return await window.snapOverlay.test('quit');");
    t = await edRun("return await wait(() => q('#dlg-unsaved[open]') && q('#unsaved-text').textContent);");
    s = await state();
    check(/NeuralSnap kapanmadan önce/.test(t || "") && s.editorVisible, "Çık with unsaved annotations: the editor comes back and asks", t);
    await edRun("q('#unsaved-cancel').click(); return 1;");
    await sleep(800);
    check(A.exitCode === null, "Vazgeç: NeuralSnap keeps running");
    const pids = (await state()).pids;
    check(pids.includes(grabberPid) && pids.length >= 4, `its processes: ${pids.length} (the grabber among them)`);
    await ovRun("return await window.snapOverlay.test('quit');");
    await timed(edRun("await wait(() => q('#dlg-unsaved[open]')); q('#unsaved-skip').click(); return 1;").catch(() => {}));
    const gone = await exited(A, 8000);
    for (let i = 0; i < 40 && pids.some(alive); i++) await sleep(100);
    check(gone && !pids.some(alive), "Atla: it quits, and every process of it ends (the grabber too)", j(pids.filter(alive)));
    ov.close();
    ed.close();

    /* ===== D: English ===== */
    console.log("English");
    const enLang = path.join(OUT, "language-en.json");
    fs.writeFileSync(enLang, JSON.stringify({ language: "en", changedAt: Date.now(), by: "test" }));
    startApp(9413, envFor("D", { shortcut: ACCEL }, { NEURAL_LANG_FILE: enLang }));
    const e = await attachReady(9413, (x) => /index\.html/.test(x.url), "window.snapTest", 30000);
    r = await e.evaluate(PRELUDE + `await wait(() => q('#empty-key').textContent);
      const texts = []; const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n; (n = walk.nextNode());) if (n.nodeValue.trim() && !n.parentElement.closest('script, style')) texts.push(n.nodeValue.trim());
      for (const el of qa('[title], [placeholder], [aria-label]')) for (const a of ['title', 'placeholder', 'aria-label']) if (el.getAttribute(a)) texts.push(el.getAttribute(a));
      return { lang: document.documentElement.lang, band: q('#band-title').textContent, big: q('.big-label').textContent, key: q('#empty-key').textContent, arrow: q('[data-tool="arrow"]').title, view: q('#act-view').title, file: q('#st-file').textContent, tool: q('#st-tool').textContent, texts };`);
    check(r.lang === "en" && r.band === "Screenshot" && r.big === "NEW CAPTURE" && r.key === ACCEL, "the editor in English: band, the big button with the shortcut", j({ lang: r.lang, band: r.band, big: r.big, key: r.key }));
    check(r.arrow === "Arrow (A)" && r.view === "Open in NeuralView" && r.file === "No capture" && r.tool === "Arrow", "tooltips and the status bar", j({ arrow: r.arrow, view: r.view, file: r.file, tool: r.tool }));
    const turkish = [...new Set(r.texts.join(" ").split(/[^\p{L}'’]+/u).filter((w) => /[çğıöşüÇĞİÖŞÜ]/.test(w) && w !== "Türkçe"))];
    check(!turkish.length, `no Turkish words on the page, hidden dialogs included (${r.texts.length} texts)`, turkish.join(" "));
    await shot(e, "editor-en.png");
    const eo = await attachReady(9413, (x) => /overlay\.html/.test(x.url), "window.ovState", 10000);
    const hint = await eo.evaluate("return document.querySelector('#hint').textContent;");
    check(hint === "Drag: region · Click: window · Enter: full screen · Esc: cancel", "the overlay's hint in English", hint);
    eo.close();
    e.close();

    /* ===== E: timing at 2560 x 1440 ===== */
    console.log("timing (a 2560 x 1440 fake screen made of the demo picture)");
    const W = 2560, H = 1440, big = Buffer.alloc(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) screen.data.copy(big, (y * W + x) * 4, ((y % screen.h) * screen.w + (x % screen.w)) * 4, ((y % screen.h) * screen.w + (x % screen.w)) * 4 + 4);
    fs.writeFileSync(BIG, encodePng(big, W, H));
    startApp(9414, envFor("E", { shortcut: ACCEL }, { NEURALSNAP_TEST_IMAGE: BIG }), ["--arka-plan"]);
    const tm = await attachReady(9414, (x) => /overlay\.html/.test(x.url), "window.ovState", 30000);
    const tmIn = input(tm);
    const tmState = () => tm.evaluate("return await window.snapOverlay.state();");
    for (let i = 0; i < 7; i++) {
      await tm.evaluate("return await window.snapOverlay.test('capture');");
      for (let k = 0; k < 100 && !(await tmState()).overlays[0].visible; k++) await sleep(30);
      await tm.evaluate(PRELUDE + "return await wait(() => window.ovState().mode === 'idle');");
      await tmIn.esc();
      for (let k = 0; k < 100 && (await tmState()).capturing; k++) await sleep(30);
      await sleep(150);
    }
    const tms = (await tmState()).timings.slice(1); // the first one decodes the test PNG
    const tot = tms.map((x) => x.total);
    console.log(`       shown after ${tot.join(", ")} ms (median ${median(tot)}; of that, sending and drawing the picture ${median(tms.map((x) => x.draw))} ms)`);
    check(tms.length >= 5 && tms.every((x) => x.size === "2560x1440") && median(tot) < 300, `grab done → overlay shown: median ${median(tot)} ms for 2560 x 1440 (add the grab itself, ~30-45 ms in test-grab.js)`);
    tm.close();
  } catch (err) {
    failed++;
    console.log("  FAIL " + (err.stack || err.message));
  } finally {
    for (const p of started) {
      if (p.exitCode !== null) continue;
      try { execFileSync("taskkill", ["/T", "/F", "/PID", String(p.pid)], { stdio: "ignore" }); } catch (e) { /* gone */ }
    }
  }
  console.log(`\n${passed} passed, ${failed} failed  (screenshots of the demo picture in ${OUT})`);
  process.exit(failed ? 1 : 0);
})();
