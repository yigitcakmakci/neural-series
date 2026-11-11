"use strict";
// NeuralSnap SN-8: a screenshot tool that waits in the background (tray icon) and holds a global shortcut, Ctrl+Alt+S
// by default. The shortcut freezes the screen: sngrab.exe (a persistent C# helper) copies the whole virtual screen into
// a short-lived file, which is read and deleted at once; one overlay window per display, created ahead and kept hidden,
// shows its part of that picture at native sharpness. The user drags a region, clicks a window or presses Enter for the
// display; the result is cropped from the grab in physical pixels, copied to the clipboard, saved to
// Pictures\NeuralSnap (unless switched off) and opened in the editor (the main window), where it can be annotated,
// copied, saved, opened in NeuralView or pinned on the screen (a small always-on-top window).
// Started with --arka-plan (at sign-in) it opens no window; started normally it opens the editor; --cek (NeuralDeck's
// "snap" command, also from a second start) starts a capture.
// Tests: NEURALSNAP_PROFILE (settings folder), NEURALSNAP_GRAB (a helper compiled elsewhere), NEURALSNAP_TEST_IMAGE (a
// picture used as the screen instead of a grab), NEURALSNAP_TEST_WINDOWS (fake window rectangles on it),
// NEURALSNAP_TEST_OVERLAY ("x,y,w,h": the overlay is one small ordinary window), NEURALSNAP_TEST_INACTIVE=1 (no window
// takes the focus), NEURALSNAP_TEST_CLIPBOARD (a PNG file instead of the clipboard), NEURALSNAP_SAVE_DIR (instead of
// Pictures\NeuralSnap), NEURALSNAP_TEST_SAVE_AS (the answer of the save dialog), NEURAL_TEST_NOTIFY (notifications as
// JSON lines), NEURAL_ROOT + NEURAL_TEST_LAUNCH (hand-offs as JSON lines).
const { app, BrowserWindow, ipcMain, screen, Menu, Tray, globalShortcut, clipboard, nativeImage, dialog, shell, Notification } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { pathToFileURL } = require("url");
const kit = require("./annotate");
// Shared with the series: next to main.js when installed, in apps\shared when run from source.
const shared = (name) => require(fs.existsSync(path.join(__dirname, `${name}.js`)) ? `./${name}` : `../shared/${name}`);
const themeSync = shared("theme-sync");
const language = shared("language");
let L = null; // the interface language, read once app is ready (lang\*.json)
const T = (key, vars) => (L ? L.t(key, vars) : key);
const handoff = shared("handoff").create({ self: "NeuralSnap", shell, t: T });

if (process.env.NEURALSNAP_PROFILE) app.setPath("userData", process.env.NEURALSNAP_PROFILE);
app.setAppUserModelId("NeuralSnap.SN8");

const BACKGROUND = process.argv.includes("--arka-plan");
const DEFAULT_SHORTCUT = "Ctrl+Alt+S";
const MIN_W = 820;
const MIN_H = 520;
const CAPTURE_DELAY = 250; // --cek: the launching program's window is gone by then
const GRABBER = process.env.NEURALSNAP_GRAB ? path.resolve(process.env.NEURALSNAP_GRAB) : path.join(__dirname, "sngrab.exe");
const GRAB_DIR = path.join(os.tmpdir(), "NeuralSnap");
const ICON = ["neuralsnap.ico", "icon.png"].map((f) => path.join(__dirname, f)).find((f) => fs.existsSync(f)) || null;

/* ---------- test hooks ---------- */
const TEST_IMAGE = process.env.NEURALSNAP_TEST_IMAGE ? path.resolve(process.env.NEURALSNAP_TEST_IMAGE) : "";
const TEST_WINDOWS = (() => {
  try {
    const v = JSON.parse(process.env.NEURALSNAP_TEST_WINDOWS || "[]");
    return Array.isArray(v) ? v.filter((w) => w && [w.x, w.y, w.w, w.h].every(Number.isFinite)).map((w) => ({ x: w.x, y: w.y, w: w.w, h: w.h, pid: 0 })) : [];
  } catch (e) { return []; }
})();
const TEST_OVERLAY = (() => {
  const m = /^\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*$/.exec(process.env.NEURALSNAP_TEST_OVERLAY || "");
  return m ? { x: +m[1], y: +m[2], width: Math.max(80, +m[3]), height: Math.max(60, +m[4]) } : null;
})();
const INACTIVE = process.env.NEURALSNAP_TEST_INACTIVE === "1";
const TEST_CLIPBOARD = process.env.NEURALSNAP_TEST_CLIPBOARD ? path.resolve(process.env.NEURALSNAP_TEST_CLIPBOARD) : "";
const TEST_SAVE_AS = process.env.NEURALSNAP_TEST_SAVE_AS ? path.resolve(process.env.NEURALSNAP_TEST_SAVE_AS) : "";
const TEST_NOTIFY = process.env.NEURAL_TEST_NOTIFY || "";
const TESTING = !!(TEST_IMAGE || TEST_OVERLAY || INACTIVE || TEST_CLIPBOARD || TEST_SAVE_AS);

const now = () => Number(process.hrtime.bigint() / 1000n) / 1000; // ms, fractional
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => { try { console.log("[NeuralSnap]", ...a); } catch (e) { /* no console */ } };

/* ---------- small persistent files ---------- */
const dataPath = (name) => path.join(app.getPath("userData"), name);
function readJSON(name) {
  try { return JSON.parse(fs.readFileSync(dataPath(name), "utf8")); } catch (e) { return null; }
}
function writeJSON(name, value) {
  try {
    fs.mkdirSync(app.getPath("userData"), { recursive: true });
    const tmp = dataPath(name + ".tmp");
    fs.writeFileSync(tmp, JSON.stringify(value));
    fs.renameSync(tmp, dataPath(name));
  } catch (e) { /* not critical */ }
}
const settings = { shortcut: DEFAULT_SHORTCUT, autoSave: true, openEditor: true };
{
  const s = readJSON("settings.json") || {};
  if (typeof s.shortcut === "string") settings.shortcut = s.shortcut;
  if (typeof s.autoSave === "boolean") settings.autoSave = s.autoSave;
  if (typeof s.openEditor === "boolean") settings.openEditor = s.openEditor;
}
const saveSettings = () => writeJSON("settings.json", settings);
const saveDir = () => (process.env.NEURALSNAP_SAVE_DIR ? path.resolve(process.env.NEURALSNAP_SAVE_DIR) : path.join(app.getPath("pictures"), "NeuralSnap"));
const send = (wc, channel, payload) => { if (wc && !wc.isDestroyed()) wc.send(channel, payload); };
const alive = (w) => !!w && !w.isDestroyed();

/* ---------- the grabber (sngrab.exe, one process for the program's life) ---------- */
const grabber = { proc: null, waiting: [], quitting: false, restarts: 0, n: 0, error: "" };
function startGrabber() {
  if (grabber.quitting || grabber.proc) return;
  if (!fs.existsSync(GRABBER)) { grabber.error = "missing"; return; }
  let proc;
  try {
    proc = spawn(GRABBER, [], { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
  } catch (e) {
    grabber.error = "failed";
    return;
  }
  grabber.proc = proc;
  grabber.error = "";
  let buf = "";
  proc.stdout.setEncoding("utf8");
  proc.stdout.on("data", (d) => {
    buf += d;
    for (let i; (i = buf.indexOf("\n")) >= 0; buf = buf.slice(i + 1)) {
      const line = buf.slice(0, i);
      const w = grabber.waiting.shift();
      if (w) { clearTimeout(w.timer); w.resolve(line); }
    }
  });
  proc.stdin.on("error", () => { /* it ended */ });
  proc.on("error", () => { /* reported by exit */ });
  proc.on("exit", () => {
    if (grabber.proc !== proc) return;
    grabber.proc = null;
    for (const w of grabber.waiting.splice(0)) { clearTimeout(w.timer); w.resolve(null); }
    if (grabber.quitting) return;
    if (grabber.restarts++ < 3) setTimeout(startGrabber, 1000);
    else grabber.error = "stopped";
  });
}
function stopGrabber() {
  grabber.quitting = true;
  const p = grabber.proc;
  grabber.proc = null;
  if (!p) return;
  try { p.stdin.write("quit\n"); p.stdin.end(); } catch (e) { /* already gone */ }
  setTimeout(() => { try { p.kill(); } catch (e) { /* already gone */ } }, 500).unref();
}
function askGrabber(line, ms = 5000) {
  return new Promise((resolve) => {
    if (!grabber.proc) startGrabber();
    const p = grabber.proc;
    if (!p) { resolve(null); return; }
    const w = { resolve, timer: setTimeout(() => { const i = grabber.waiting.indexOf(w); if (i >= 0) grabber.waiting.splice(i, 1); resolve(null); }, ms) };
    grabber.waiting.push(w);
    try { p.stdin.write(line + "\n"); } catch (e) { resolve(null); }
  });
}
// Grab files are deleted as soon as they are read; one left by a crash goes at the next start.
function cleanGrabDir() {
  try {
    for (const f of fs.readdirSync(GRAB_DIR)) {
      const p = path.join(GRAB_DIR, f);
      if (/^grab-.*\.raw$/i.test(f) && Date.now() - fs.statSync(p).mtimeMs > 60e3) fs.rmSync(p, { force: true });
    }
  } catch (e) { /* no folder yet */ }
}
// NeuralSnap's own processes (its windows are left out of the "click a window" list).
function ownPids() {
  const own = new Set([process.pid]);
  try { for (const m of app.getAppMetrics()) own.add(m.pid); } catch (e) { /* only this one */ }
  if (grabber.proc) own.add(grabber.proc.pid);
  return own;
}
// The windows a click can take: grab-relative, clipped to the virtual screen, without NeuralSnap's own.
function usableWindows(list, g) {
  const own = ownPids();
  const out = [];
  for (const w of list || []) {
    if (own.has(w.pid)) continue;
    const r = kit.clipRect({ x: w.x - g.x, y: w.y - g.y, w: w.w, h: w.h }, g.w, g.h);
    if (r && r.w > 1 && r.h > 1) out.push(r);
  }
  return out;
}

// A grab: { rgba, x, y, w, h, monitors, windows, ms } (physical pixels; windows grab-relative).
async function realGrab() {
  fs.mkdirSync(GRAB_DIR, { recursive: true });
  const file = path.join(GRAB_DIR, `grab-${process.pid}-${++grabber.n}.raw`);
  const line = await askGrabber(`grab ${file}`);
  let g = null;
  try { g = JSON.parse(line); } catch (e) { /* below */ }
  if (!g || !g.ok) {
    try { fs.rmSync(file, { force: true }); } catch (e) { /* never written */ }
    throw new Error(grabber.error === "missing" ? T("err.grabber-missing") : T("err.grab-failed", { error: (g && g.error) || "?" }));
  }
  let rgba;
  try {
    rgba = fs.readFileSync(file);
  } finally {
    try { fs.rmSync(file, { force: true }); } catch (e) { /* the next start removes it */ }
  }
  if (rgba.length !== g.w * g.h * 4) throw new Error(T("err.grab-failed", { error: "size" }));
  return { rgba, x: g.x, y: g.y, w: g.w, h: g.h, monitors: g.monitors || [], windows: usableWindows(g.windows, g), ms: g.ms };
}
// Tests: the picture is the screen, one fake display at the primary display's origin (0, 0 on Windows).
let testShot = null;
function fakeGrab() {
  const t0 = now();
  if (!testShot) {
    const img = nativeImage.createFromPath(TEST_IMAGE);
    if (img.isEmpty()) throw new Error(T("err.grab-failed", { error: "NEURALSNAP_TEST_IMAGE" }));
    const { width, height } = img.getSize();
    // a picture with transparent corners becomes opaque: as if it were drawn on black
    testShot = { rgba: Buffer.from(kit.swapRB(img.toBitmap(), true).buffer), w: width, h: height };
  }
  const { rgba, w, h } = testShot;
  const g = { rgba, x: 0, y: 0, w, h, monitors: [{ x: 0, y: 0, w, h, primary: true, dpi: 96 }], ms: 0 };
  g.windows = usableWindows(TEST_WINDOWS, g);
  g.ms = Math.round(now() - t0);
  return g;
}

/* ---------- the overlay: one window per display, created ahead and kept hidden ---------- */
let overlays = []; // { win, display, bounds, test, ready: Promise, frame: { seq, resolve } }
let rebuildTimer = null;
const fromOverlay = (e) => overlays.find((o) => alive(o.win) && e.sender === o.win.webContents) || null;

function createOverlay(o) {
  const win = new BrowserWindow({
    ...o.bounds,
    show: false,
    frame: false,
    transparent: !o.test,
    backgroundColor: o.test ? "#000000" : "#00000000",
    hasShadow: false,
    resizable: false,
    movable: !!o.test,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: !o.test,
    thickFrame: false,
    enableLargerThanScreen: true,
    useContentSize: true,
    title: "NeuralSnap",
    icon: ICON || undefined,
    webPreferences: { preload: path.join(__dirname, "preload-tools.js"), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, backgroundThrottling: false },
  });
  // above everything, the taskbar and the pins included
  if (!o.test) win.setAlwaysOnTop(true, "screen-saver");
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.setVisualZoomLevelLimits(1, 1);
  // Alt+F4 on an overlay cancels the capture; the window stays for the next one.
  win.on("close", (e) => { if (!app.quitting) { e.preventDefault(); if (cap.busy) cancelCapture(); } });
  win.webContents.on("render-process-gone", () => { if (cap.busy) cancelCapture(); scheduleRebuild(); });
  o.win = win;
  o.ready = new Promise((res) => win.webContents.once("did-finish-load", res));
  win.loadFile(path.join(__dirname, "overlay.html"));
  return o;
}
function createOverlays() {
  for (const o of overlays) if (alive(o.win)) o.win.destroy();
  overlays = [];
  const list = TEST_OVERLAY ? [{ test: true, bounds: TEST_OVERLAY, display: null }]
    : screen.getAllDisplays().map((d) => ({ test: false, bounds: d.bounds, display: d }));
  overlays = list.map(createOverlay);
}
// Displays added, removed or rearranged: new overlays (after the capture, if one is running).
function scheduleRebuild() {
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => { if (cap.busy) scheduleRebuild(); else createOverlays(); }, 400);
}

// The part of the grab an overlay shows, in grab-relative physical pixels. A display's DIP bounds map to physical
// pixels with screen.dipToScreenRect (Windows' own conversion); the grab's monitor with the nearest rectangle is it.
function regionFor(o, g) {
  if (o.test) return { x: 0, y: 0, w: g.w, h: g.h };
  let phys;
  try { phys = screen.dipToScreenRect(null, o.display.bounds); } catch (e) { phys = null; }
  if (!phys) {
    const sf = o.display.scaleFactor || 1;
    phys = { x: Math.round(o.display.bounds.x * sf), y: Math.round(o.display.bounds.y * sf), width: Math.round(o.display.bounds.width * sf), height: Math.round(o.display.bounds.height * sf) };
  }
  let best = null, bestD = Infinity;
  for (const m of g.monitors) {
    const d = Math.abs(m.x - phys.x) + Math.abs(m.y - phys.y) + Math.abs(m.w - phys.width) + Math.abs(m.h - phys.height);
    if (d < bestD) { bestD = d; best = m; }
  }
  const r = best ? { x: best.x - g.x, y: best.y - g.y, w: best.w, h: best.h } : { x: phys.x - g.x, y: phys.y - g.y, w: phys.width, h: phys.height };
  return kit.clipRect(r, g.w, g.h);
}
function frameFor(o, g, seq) {
  const region = regionFor(o, g);
  if (!region) return null;
  const whole = region.x === 0 && region.y === 0 && region.w === g.w && region.h === g.h;
  const pixels = whole ? g.rgba : kit.crop(g.rgba, g.w, g.h, region);
  return { seq, w: region.w, h: region.h, pixels, region, origin: { x: g.x, y: g.y }, windows: g.windows };
}
// Sends an overlay its part of the picture; resolves when it is drawn (false when it never answers).
function sendFrame(o, frame) {
  return new Promise((resolve) => {
    if (!frame || !alive(o.win)) { resolve(false); return; }
    const timer = setTimeout(() => { o.frame = null; resolve(false); }, 4000);
    o.frame = { seq: frame.seq, resolve: (ok) => { clearTimeout(timer); o.frame = null; resolve(ok); } };
    o.region = frame.region;
    send(o.win.webContents, "ov:frame", frame);
  });
}
function showOverlays() {
  const cursor = screen.getCursorScreenPoint();
  const hot = overlays.find((o) => !o.test && o.display && kit.inRect({ x: o.bounds.x, y: o.bounds.y, w: o.bounds.width, h: o.bounds.height }, cursor.x, cursor.y)) || overlays[0];
  for (const o of overlays) {
    if (!alive(o.win) || !o.drawn) continue;
    if (!o.test) o.win.setBounds(o.bounds); // Windows may have kept another size after a DPI change
    if (o === hot && !INACTIVE && !o.test) { o.win.show(); o.win.focus(); o.win.moveTop(); } else o.win.showInactive();
    if (!o.test) o.win.setBounds(o.bounds);
    const b = o.win.getContentBounds();
    const inside = cursor.x >= b.x && cursor.y >= b.y && cursor.x < b.x + b.width && cursor.y < b.y + b.height;
    send(o.win.webContents, "ov:shown", { cursor: inside ? { x: cursor.x - b.x, y: cursor.y - b.y } : null, hot: o === hot });
  }
}
// Each overlay clears its picture, then hides (so a later show never flashes an old capture).
function hideOverlays() {
  for (const o of overlays) {
    o.drawn = false;
    if (!alive(o.win)) continue;
    const win = o.win;
    let done = false;
    const hide = () => { if (done) return; done = true; if (alive(win) && win.isVisible()) win.hide(); };
    o.onCleared = hide;
    setTimeout(hide, 150);
    send(win.webContents, "ov:reset");
  }
}

/* ---------- a capture ---------- */
const cap = { busy: false, grab: null, seq: 0, count: 0, cancelled: 0, timing: null, timings: [], editorWasVisible: false, escape: false };
// source: "shortcut", "tray", "cek", "editor", "notification"
async function capture(source) {
  if (cap.busy) return { ok: false, busy: true };
  cap.busy = true;
  cap.editorWasVisible = false;
  try {
    // From the editor's own button: the editor steps out of the picture first.
    if (source === "editor" && alive(editor) && editor.isVisible() && !editor.isMinimized()) {
      cap.editorWasVisible = true;
      editor.hide();
      await sleep(220);
    }
    const t0 = now();
    const g = TEST_IMAGE ? fakeGrab() : await realGrab();
    const t1 = now();
    cap.grab = g;
    const seq = ++cap.seq;
    await Promise.all(overlays.map((o) => o.ready));
    const drawn = await Promise.all(overlays.map((o) => sendFrame(o, frameFor(o, g, seq)).then((ok) => { o.drawn = ok; return ok; })));
    if (!drawn.some(Boolean)) throw new Error(T("err.grab-failed", { error: "overlay" }));
    const t2 = now();
    showOverlays();
    const t3 = now();
    cap.timing = { source, size: `${g.w}x${g.h}`, helper: g.ms, grab: Math.round(t1 - t0), draw: Math.round(t2 - t1), show: Math.round(t3 - t2), total: Math.round(t3 - t0) };
    cap.timings = [...cap.timings.slice(-19), cap.timing];
    log(`capture ${g.w}x${g.h}: grab ${cap.timing.grab} ms (helper ${g.ms} ms), overlay drawn after ${Math.round(t2 - t0)} ms, shown after ${cap.timing.total} ms`);
    // A second way out when the overlay could not take the keyboard (never in tests: Esc is the user's key there).
    if (!TESTING) { try { cap.escape = globalShortcut.register("Escape", cancelCapture); } catch (e) { cap.escape = false; } }
    return { ok: true };
  } catch (e) {
    endCapture();
    log("capture failed:", e.message);
    notify(T("notify.failed"), e.message);
    if (cap.editorWasVisible) showEditor();
    return { ok: false, error: e.message };
  }
}
function endCapture() {
  if (cap.escape) { try { globalShortcut.unregister("Escape"); } catch (e) { /* gone */ } cap.escape = false; }
  hideOverlays();
  cap.grab = null;
  cap.busy = false;
}
function cancelCapture() {
  if (!cap.busy) return;
  cap.cancelled++;
  endCapture();
  if (cap.editorWasVisible) showEditor();
}
// The overlay o picked a rectangle (grab-relative physical pixels).
function finishCapture(o, kind, rect) {
  const g = cap.grab;
  if (!g) return;
  let r = null;
  if (kind === "display") {
    // the display under the cursor (with one overlay per display, the one that has it)
    const c = screen.getCursorScreenPoint();
    const under = overlays.find((x) => !x.test && x.display && kit.inRect({ x: x.bounds.x, y: x.bounds.y, w: x.bounds.width, h: x.bounds.height }, c.x, c.y));
    r = regionFor(under || o, g);
  } else r = kit.clipRect(rect, g.w, g.h);
  endCapture();
  if (!r) return;
  const rgba = kit.crop(g.rgba, g.w, g.h, r);
  // where it was on the screen, in DIP (a pin of it opens there)
  let origin = null;
  try {
    if (o.test) {
      const b = o.win.getContentBounds();
      origin = { x: Math.round(b.x + (r.x * b.width) / g.w), y: Math.round(b.y + (r.y * b.height) / g.h), width: Math.round((r.w * b.width) / g.w), height: Math.round((r.h * b.height) / g.h) };
    } else origin = screen.screenToDipRect(null, { x: g.x + r.x, y: g.y + r.y, width: r.w, height: r.h });
  } catch (e) { origin = null; }
  deliver({ rgba, w: r.w, h: r.h, origin });
}

/* ---------- pictures out: clipboard, files ---------- */
function imageFromRgba(rgba, w, h) {
  return nativeImage.createFromBitmap(Buffer.from(kit.swapRB(rgba, true).buffer), { width: w, height: h, scaleFactor: 1 });
}
function toClipboard(img, png) {
  if (TEST_CLIPBOARD) {
    fs.mkdirSync(path.dirname(TEST_CLIPBOARD), { recursive: true });
    fs.writeFileSync(TEST_CLIPBOARD, png || img.toPNG());
  } else clipboard.writeImage(img);
}
// A new file in the capture folder, named after the moment (with " (2)" when that name is taken).
function saveNew(png, date = new Date()) {
  const dir = saveDir();
  fs.mkdirSync(dir, { recursive: true });
  const name = kit.uniqueName(date, (n) => fs.existsSync(path.join(dir, n)));
  const file = path.join(dir, name);
  fs.writeFileSync(file, png, { flag: "wx" });
  return file;
}
// PNG or JPEG by the file's extension.
function writePicture(file, png) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const data = /\.jpe?g$/i.test(file) ? nativeImage.createFromBuffer(Buffer.from(png)).toJPEG(92) : Buffer.from(png);
  fs.writeFileSync(file, data);
}
function notify(title, body, onClick) {
  if (TEST_NOTIFY) {
    try { fs.appendFileSync(TEST_NOTIFY, JSON.stringify({ by: "NeuralSnap", title, body }) + "\n"); } catch (e) { /* the test reports it */ }
    return;
  }
  try {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title, body, icon: ICON || undefined, silent: true });
    if (onClick) n.on("click", onClick);
    n.show();
  } catch (e) { /* never in the way */ }
}
// A capture is done: clipboard, auto-save, then the editor (or a notification).
function deliver(shot) {
  const t0 = now();
  const img = imageFromRgba(shot.rgba, shot.w, shot.h);
  const png = img.toPNG();
  let file = null, error = "";
  try { toClipboard(img, png); } catch (e) { error = e.message; }
  if (settings.autoSave) {
    try { file = saveNew(png); } catch (e) { error = T("err.save", { error: e.message }); }
  }
  cap.count++;
  log(`delivered ${shot.w}x${shot.h} in ${Math.round(now() - t0)} ms${file ? ": " + path.basename(file) : ""}`);
  const doc = { rgba: shot.rgba, w: shot.w, h: shot.h, file, origin: shot.origin };
  if (settings.openEditor) {
    openInEditor(doc, { error });
  } else {
    notify(T("notify.copied"), error || (file ? T("toast.saved", { name: path.basename(file) }) : T("notify.copied-only")), () => openInEditor(doc, {}));
    if (cap.editorWasVisible) showEditor();
  }
}

/* ---------- the editor (the main window) ---------- */
let editor = null;
let editorReady = null;
let editorDirty = false;
let quitAsked = false;
const docs = new Map(); // id -> { file, origin, w, h }
let docSeq = 0;
const fromEditor = (e) => alive(editor) && e.sender === editor.webContents;

function onScreen(b) {
  return !!b && screen.getAllDisplays().some(({ workArea: a }) =>
    b.x < a.x + a.width - 60 && b.x + b.width > a.x + 60 && b.y >= a.y - 8 && b.y < a.y + a.height - 60);
}
function defaultBounds() {
  const a = screen.getPrimaryDisplay().workArea;
  const width = Math.max(MIN_W, Math.min(1180, a.width - 60));
  const height = Math.max(MIN_H, Math.min(780, a.height - 60));
  return { x: Math.round(a.x + (a.width - width) / 2), y: Math.round(a.y + (a.height - height) / 2), width, height };
}
function saveState(win) {
  if (win !== editor || !alive(win)) return;
  const s = win.ns;
  writeJSON("window.json", { bounds: s.maximized ? s.restore : win.getBounds(), maximized: s.maximized });
}
function setMaximized(win, on) {
  const s = win.ns;
  if (s.maximized === on) return;
  if (on) {
    s.restore = win.getBounds();
    win.setBounds(screen.getDisplayMatching(s.restore).workArea);
  } else {
    win.setBounds(onScreen(s.restore) ? s.restore : defaultBounds());
  }
  s.maximized = on;
  send(win.webContents, "snap:maximized", on);
  saveState(win);
}
function startResize(win, edge) {
  if (win.ns.maximized || !/^(n|s|e|w|ne|nw|se|sw)$/.test(edge)) return;
  stopResize(win);
  const r = { from: win.getBounds(), cursor: screen.getCursorScreenPoint(), last: null };
  r.timer = setInterval(() => {
    if (!alive(win)) { clearInterval(r.timer); return; }
    const p = screen.getCursorScreenPoint();
    const dx = p.x - r.cursor.x;
    const dy = p.y - r.cursor.y;
    const b = r.from;
    let { x, y, width, height } = b;
    if (edge.includes("e")) width = Math.max(MIN_W, b.width + dx);
    if (edge.includes("s")) height = Math.max(MIN_H, b.height + dy);
    if (edge.includes("w")) { width = Math.max(MIN_W, b.width - dx); x = b.x + b.width - width; }
    if (edge.includes("n")) { height = Math.max(MIN_H, b.height - dy); y = b.y + b.height - height; }
    const l = r.last;
    if (l && l.x === x && l.y === y && l.width === width && l.height === height) return;
    r.last = { x, y, width, height };
    win.setBounds(r.last);
  }, 16);
  win.ns.resizing = r;
}
function stopResize(win) {
  const r = win.ns && win.ns.resizing;
  if (!r) return;
  clearInterval(r.timer);
  win.ns.resizing = null;
  saveState(win);
}
function createEditor() {
  const saved = readJSON("window.json");
  let bounds = saved && onScreen(saved.bounds) ? saved.bounds : defaultBounds();
  bounds = { ...bounds, width: Math.max(MIN_W, bounds.width), height: Math.max(MIN_H, bounds.height) };
  const win = new BrowserWindow({
    ...bounds,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    title: "NeuralSnap",
    icon: ICON || undefined,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  win.ns = { maximized: false, restore: null, resizing: null };
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.setVisualZoomLevelLimits(1, 1);
  if (saved && saved.maximized) win.once("ready-to-show", () => setMaximized(win, true));
  win.on("moved", () => {
    const s = win.ns;
    if (s.maximized && s.restore) {
      const b = win.getBounds();
      s.maximized = false;
      win.setBounds({ x: b.x, y: b.y, width: s.restore.width, height: s.restore.height });
      send(win.webContents, "snap:maximized", false);
    }
    saveState(win);
  });
  win.on("blur", () => stopResize(win));
  // Closing puts it away: NeuralSnap keeps running in the tray (Çık in the tray menu ends it).
  win.on("close", (e) => { if (!app.quitting) { e.preventDefault(); stopResize(win); win.hide(); } });
  win.on("closed", () => { if (editor === win) { editor = null; editorReady = null; } });
  win.webContents.on("render-process-gone", () => { if (alive(win)) win.destroy(); });
  editor = win;
  editorReady = new Promise((res) => win.webContents.once("did-finish-load", res));
  win.loadFile(path.join(__dirname, "index.html"));
  return win;
}
async function showEditor() {
  if (!alive(editor)) createEditor();
  await editorReady;
  if (!alive(editor)) return;
  if (editor.isMinimized()) editor.restore();
  if (INACTIVE) editor.showInactive();
  else { editor.show(); editor.focus(); }
}
async function openInEditor(d, extra = {}) {
  const id = ++docSeq;
  docs.set(id, { file: d.file || null, origin: d.origin || null, w: d.w, h: d.h });
  if (docs.size > 20) docs.delete(docs.keys().next().value);
  if (!alive(editor)) createEditor();
  await editorReady;
  if (!alive(editor)) return;
  send(editor.webContents, "snap:open", { id, w: d.w, h: d.h, rgba: d.rgba, file: d.file || null, name: d.file ? path.basename(d.file) : "", error: extra.error || "" });
  showEditor();
}
// A picture file (a recent capture, or a pin taken back to the editor) as the editor's picture.
function openPicture(file, png) {
  const img = png ? nativeImage.createFromBuffer(Buffer.from(png)) : nativeImage.createFromPath(file);
  if (img.isEmpty()) return false;
  const { width, height } = img.getSize();
  openInEditor({ rgba: kit.swapRB(img.toBitmap(), true), w: width, h: height, file: png ? null : file, origin: null });
  return true;
}
// The newest captures in the folder, for the editor's empty screen.
function recentCaptures(n = 8) {
  const dir = saveDir();
  try {
    return fs.readdirSync(dir).filter((f) => /\.(png|jpe?g)$/i.test(f))
      .map((f) => { const p = path.join(dir, f); return { path: p, name: f, mtime: fs.statSync(p).mtimeMs }; })
      .sort((a, b) => b.mtime - a.mtime).slice(0, n)
      .map((r) => ({ ...r, url: pathToFileURL(r.path).href }));
  } catch (e) { return []; }
}
async function openFolder() {
  const dir = saveDir();
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* shown by the hand-off */ }
  return handoff.showInNav(dir);
}

// The editor's picture, exported by the page as PNG: copy, save, save as, NeuralView, pin.
async function saveAsDialog(win, meta) {
  if (TEST_SAVE_AS) return TEST_SAVE_AS;
  const dir = saveDir();
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* the dialog starts elsewhere */ }
  const base = meta && meta.file ? path.basename(meta.file).replace(/\.[^.]+$/, ".png") : kit.captureName(new Date());
  const r = await dialog.showSaveDialog(alive(win) ? win : undefined, {
    title: T("saveas.title"),
    defaultPath: path.join(meta && meta.file ? path.dirname(meta.file) : dir, base),
    filters: [{ name: T("saveas.png"), extensions: ["png"] }, { name: T("saveas.jpg"), extensions: ["jpg", "jpeg"] }],
  });
  return r.canceled || !r.filePath ? null : r.filePath;
}
async function exportAction(kind, id, png, dirty) {
  const meta = docs.get(id);
  if (!meta || !png || !png.length) return { ok: false, error: T("err.no-picture") };
  const name = (f) => path.basename(f);
  try {
    switch (kind) {
      case "copy": {
        toClipboard(nativeImage.createFromBuffer(Buffer.from(png)), Buffer.from(png));
        return { ok: true, toast: T("toast.copied") };
      }
      case "save": {
        if (!meta.file) return exportAction("saveAs", id, png, dirty);
        writePicture(meta.file, png);
        return { ok: true, saved: true, file: meta.file, name: name(meta.file), toast: T("toast.saved", { name: name(meta.file) }) };
      }
      case "saveAs": {
        const file = await saveAsDialog(editor, meta);
        if (!file) return { ok: false, canceled: true };
        writePicture(file, png);
        meta.file = file;
        return { ok: true, saved: true, file, name: name(file), toast: T("toast.saved", { name: name(file) }) };
      }
      case "view": {
        // NeuralView opens files: the picture is saved first when needed (over its file, or as a new capture file)
        let saved = false;
        if (!meta.file) { meta.file = saveNew(Buffer.from(png)); saved = true; } else if (dirty) { writePicture(meta.file, png); saved = true; }
        const err = await handoff.openFiles([meta.file]);
        if (err) return { ok: false, error: err, saved, file: meta.file, name: name(meta.file) };
        return { ok: true, saved, file: meta.file, name: name(meta.file), toast: T("toast.view", { name: name(meta.file) }) };
      }
      case "pin": {
        openPin(Buffer.from(png), meta.origin);
        return { ok: true };
      }
      default: return { ok: false };
    }
  } catch (e) {
    return { ok: false, error: T("err.save", { error: e.message }) };
  }
}

/* ---------- pins: the picture on the screen, always on top ---------- */
const PIN_MARGIN = 10; // room for the shadow around the frame
const pins = new Set(); // { win, png, iw, ih, natural: { w, h } (DIP at 100 %), zoom }
const pinOf = (e) => [...pins].find((p) => alive(p.win) && e.sender === p.win.webContents) || null;
function pinBounds(p, x, y) {
  const w = Math.max(16, Math.round(p.natural.w * p.zoom)), h = Math.max(16, Math.round(p.natural.h * p.zoom));
  return { x: Math.round(x), y: Math.round(y), width: w + 2 * PIN_MARGIN, height: h + 2 * PIN_MARGIN };
}
function openPin(png, origin) {
  const img = nativeImage.createFromBuffer(png);
  if (img.isEmpty()) return null;
  const { width: iw, height: ih } = img.getSize();
  const near = origin || (alive(editor) && editor.isVisible() ? editor.getBounds() : screen.getPrimaryDisplay().workArea);
  const disp = screen.getDisplayMatching(near);
  const sf = disp.scaleFactor || 1;
  // natural size: one picture pixel per screen pixel; at most 60 % of the display
  const natural = { w: iw / sf, h: ih / sf };
  const a = disp.workArea;
  const zoom = Math.min(1, (a.width * 0.6) / natural.w, (a.height * 0.6) / natural.h);
  const p = { win: null, png, iw, ih, natural, zoom, ready: false };
  let x, y;
  if (origin) { x = origin.x - PIN_MARGIN; y = origin.y - PIN_MARGIN; } else {
    const b = pinBounds(p, 0, 0);
    x = near.x + (near.width - b.width) / 2 + pins.size * 24;
    y = near.y + (near.height - b.height) / 2 + pins.size * 24;
  }
  let b = pinBounds(p, x, y);
  b.x = Math.max(a.x - PIN_MARGIN, Math.min(b.x, a.x + a.width - b.width + PIN_MARGIN));
  b.y = Math.max(a.y - PIN_MARGIN, Math.min(b.y, a.y + a.height - b.height + PIN_MARGIN));
  const win = new BrowserWindow({
    ...b,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    title: "NeuralSnap",
    icon: ICON || undefined,
    webPreferences: { preload: path.join(__dirname, "preload-tools.js"), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  p.win = win;
  pins.add(p);
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.setVisualZoomLevelLimits(1, 1);
  win.on("closed", () => pins.delete(p));
  win.webContents.once("did-finish-load", () => send(win.webContents, "pin:image", { png, w: iw, h: ih, zoom: p.zoom, margin: PIN_MARGIN }));
  win.loadFile(path.join(__dirname, "pin.html"));
  return p;
}
async function pinAction(p, id) {
  switch (id) {
    case "copy": toClipboard(nativeImage.createFromBuffer(p.png), p.png); return { ok: true };
    case "save": {
      const file = await saveAsDialog(p.win, null);
      if (!file) return { ok: false, canceled: true };
      writePicture(file, p.png);
      return { ok: true, file };
    }
    case "edit": return { ok: openPicture(null, p.png) };
    case "close": if (alive(p.win)) p.win.close(); return { ok: true };
    default: return { ok: false };
  }
}

/* ---------- the global shortcut ---------- */
// Electron accelerators with at least one of Ctrl/Alt/Shift/Super, or a function key alone (as NeuralDeck).
const ACCEL = /^((Ctrl|Alt|Shift|Super)\+)*(Space|[A-Z0-9]|F([1-9]|1[0-9]|2[0-4])|Tab|Enter|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Up|Down|Left|Right|Plus|Minus|Comma|Period|PrintScreen)$/;
function validAccel(a) {
  return typeof a === "string" && ACCEL.test(a) && (/(Ctrl|Alt|Shift|Super)\+/.test(a) || /^(F\d+|PrintScreen)$/.test(a));
}
let shortcut = { accel: settings.shortcut, ok: false, error: "" };
let recording = false;
let tray = null;
function register(accel) {
  try { return validAccel(accel) && globalShortcut.register(accel, () => capture("shortcut")); } catch (e) { return false; }
}
// Takes the new shortcut, or keeps the old one when the new one cannot be registered.
function setShortcut(accel, save) {
  const old = shortcut.accel;
  if (shortcut.ok) { try { globalShortcut.unregister(old); } catch (e) { /* was not registered */ } }
  if (register(accel)) {
    shortcut = { accel, ok: true, error: "" };
    if (save) { settings.shortcut = accel; saveSettings(); }
  } else {
    const okOld = accel !== old && register(old);
    shortcut = { accel: okOld ? old : accel, ok: okOld, error: T("err.shortcut-taken", { accel }) };
  }
  updateTray();
  send(alive(editor) && editor.webContents, "snap:shortcut", shortcut);
  return shortcut;
}
function updateTray() {
  if (!tray) return;
  tray.setToolTip(shortcut.ok ? `NeuralSnap SN-8 · ${shortcut.accel}` : T("tray.no-shortcut"));
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: shortcut.ok ? T("tray.capture-key", { accel: shortcut.accel }) : T("tray.capture"), click: () => capture("tray") },
    { label: T("tray.open"), click: () => showEditor() },
    { label: T("tray.folder"), click: () => openFolder() },
    { label: T("tray.settings"), click: async () => { await showEditor(); send(alive(editor) && editor.webContents, "snap:open-settings"); } },
    { type: "separator" },
    { label: T("tray.quit"), click: () => quit() },
  ]));
}

/* ---------- quitting ---------- */
// Unsaved annotations in the editor: it asks first (Kaydet / Atla / Vazgeç).
async function quit(force = false) {
  if (!force && editorDirty && alive(editor)) {
    if (quitAsked) return;
    quitAsked = true;
    await showEditor();
    send(editor.webContents, "snap:confirm-quit");
    return;
  }
  app.quitting = true;
  app.quit();
}

/* ---------- IPC ---------- */
function state() {
  const vis = (w) => alive(w) && w.isVisible();
  return {
    version: app.getVersion(),
    background: BACKGROUND,
    testing: TESTING,
    shortcut,
    settings: { ...settings },
    saveDir: saveDir(),
    editor: alive(editor),
    editorVisible: vis(editor),
    dirty: editorDirty,
    overlays: overlays.map((o) => ({ visible: vis(o.win), bounds: alive(o.win) ? o.win.getBounds() : null, test: !!o.test, region: o.region || null })),
    capturing: cap.busy,
    captures: cap.count,
    cancelled: cap.cancelled,
    timing: cap.timing,
    timings: cap.timings,
    grabber: { running: !!grabber.proc, pid: grabber.proc ? grabber.proc.pid : 0, error: grabber.error },
    pins: [...pins].filter((p) => alive(p.win)).map((p) => ({ visible: p.win.isVisible(), alwaysOnTop: p.win.isAlwaysOnTop(), bounds: p.win.getBounds(), zoom: p.zoom, w: p.iw, h: p.ih })),
    visibleWindows: BrowserWindow.getAllWindows().filter((w) => vis(w)).length,
    pids: [...ownPids()],
  };
}
ipcMain.handle("snap:state", () => state());
// Tests only: what the tray menu would do.
ipcMain.handle("snap:test", (_e, cmd) => {
  if (!TESTING) return null;
  if (cmd === "quit") { setTimeout(() => quit(), 50); return true; }
  if (cmd === "quit-now") { setTimeout(() => quit(true), 50); return true; }
  if (cmd === "capture") return capture("tray");
  if (cmd === "open") { showEditor(); return true; }
  if (cmd === "folder") return openFolder();
  return null;
});

// overlay
ipcMain.on("ov:drawn", (e, seq) => { const o = fromOverlay(e); if (o && o.frame && o.frame.seq === seq) o.frame.resolve(true); });
ipcMain.on("ov:cleared", (e) => { const o = fromOverlay(e); if (o && o.onCleared) { const f = o.onCleared; o.onCleared = null; f(); } });
ipcMain.on("ov:pick", (e, seq, kind, rect) => {
  const o = fromOverlay(e);
  if (!o || !cap.busy || seq !== cap.seq || !["rect", "window", "display"].includes(kind)) return;
  const r = rect && [rect.x, rect.y, rect.w, rect.h].every(Number.isFinite) ? { x: rect.x, y: rect.y, w: rect.w, h: rect.h } : null;
  if (kind !== "display" && (!r || r.w < 1 || r.h < 1)) return;
  finishCapture(o, kind, r);
});
ipcMain.on("ov:cancel", (e, seq) => { if (fromOverlay(e) && seq === cap.seq) cancelCapture(); });

// editor window
ipcMain.on("snap:minimize", (e) => { if (fromEditor(e)) editor.minimize(); });
ipcMain.on("snap:toggle-max", (e) => { if (fromEditor(e)) setMaximized(editor, !editor.ns.maximized); });
ipcMain.on("snap:close", (e) => { if (fromEditor(e)) editor.close(); });
ipcMain.on("snap:resize-start", (e, edge) => { if (fromEditor(e)) startResize(editor, String(edge)); });
ipcMain.on("snap:resize-end", (e) => { if (fromEditor(e)) stopResize(editor); });
ipcMain.handle("snap:info", (e) => (fromEditor(e) ? { version: app.getVersion(), shortcut, settings: { ...settings }, saveDir: saveDir(), nav: !!handoff.exe("NeuralNav"), view: !!handoff.exe("NeuralView") } : null));
ipcMain.handle("snap:capture", (e) => (fromEditor(e) ? capture("editor") : { ok: false }));
ipcMain.handle("snap:export", (e, kind, id, png, dirty) => (fromEditor(e) ? exportAction(String(kind), Number(id), png, !!dirty) : { ok: false }));
ipcMain.on("snap:dirty", (e, on) => { if (fromEditor(e)) editorDirty = !!on; });
ipcMain.on("snap:quit-answer", (e, go) => { if (!fromEditor(e)) return; quitAsked = false; if (go) quit(true); });
ipcMain.handle("snap:recent", (e) => (fromEditor(e) ? recentCaptures() : []));
ipcMain.handle("snap:open-file", (e, p) => {
  if (!fromEditor(e)) return false;
  const file = String(p || "");
  // only pictures from the capture folder (what the empty screen lists)
  if (path.dirname(path.resolve(file)).toLowerCase() !== saveDir().toLowerCase() || !/\.(png|jpe?g)$/i.test(file)) return false;
  return openPicture(file, null);
});
ipcMain.handle("snap:open-folder", (e) => (fromEditor(e) ? openFolder() : ""));
ipcMain.handle("snap:set", (e, patch) => {
  if (!fromEditor(e) || !patch || typeof patch !== "object") return { ...settings };
  if (typeof patch.autoSave === "boolean") settings.autoSave = patch.autoSave;
  if (typeof patch.openEditor === "boolean") settings.openEditor = patch.openEditor;
  saveSettings();
  return { ...settings };
});
// Recording a new shortcut: the old one rests meanwhile, so pressing it records instead of capturing.
ipcMain.handle("snap:shortcut-record", (e, on) => {
  if (!fromEditor(e)) return shortcut;
  recording = !!on;
  if (recording) { if (shortcut.ok) { try { globalShortcut.unregister(shortcut.accel); } catch (err) { /* gone */ } } shortcut = { ...shortcut, ok: false }; }
  else if (!shortcut.ok) setShortcut(settings.shortcut, false);
  return shortcut;
});
ipcMain.handle("snap:set-shortcut", (e, accel) => {
  if (!fromEditor(e)) return shortcut;
  recording = false;
  if (!validAccel(accel)) {
    setShortcut(settings.shortcut, false);
    return { ...shortcut, error: T("err.shortcut-invalid") };
  }
  return setShortcut(accel, true);
});

// pins
ipcMain.on("pin:ready", (e) => { const p = pinOf(e); if (!p || p.ready) return; p.ready = true; if (INACTIVE) p.win.showInactive(); else p.win.show(); });
ipcMain.on("pin:move-to", (e, x, y) => { const p = pinOf(e); if (p && Number.isFinite(x) && Number.isFinite(y)) p.win.setPosition(Math.round(x), Math.round(y)); });
ipcMain.handle("pin:zoom", (e, zoom, ax, ay) => {
  const p = pinOf(e);
  if (!p || !Number.isFinite(zoom)) return null;
  const z = Math.max(0.1, Math.min(4, zoom));
  const b = p.win.getBounds();
  const oldW = b.width - 2 * PIN_MARGIN, oldH = b.height - 2 * PIN_MARGIN;
  p.zoom = z;
  const nb = pinBounds(p, 0, 0);
  // the point under the cursor stays where it is
  const fx = Number.isFinite(ax) ? Math.max(0, Math.min(1, (ax - PIN_MARGIN) / oldW)) : 0.5;
  const fy = Number.isFinite(ay) ? Math.max(0, Math.min(1, (ay - PIN_MARGIN) / oldH)) : 0.5;
  nb.x = Math.round(b.x + PIN_MARGIN + fx * oldW - PIN_MARGIN - fx * (nb.width - 2 * PIN_MARGIN));
  nb.y = Math.round(b.y + PIN_MARGIN + fy * oldH - PIN_MARGIN - fy * (nb.height - 2 * PIN_MARGIN));
  p.win.setBounds(nb);
  return z;
});
ipcMain.on("pin:close", (e) => { const p = pinOf(e); if (p) p.win.close(); });
ipcMain.on("pin:menu", (e) => {
  const p = pinOf(e);
  if (!p) return;
  Menu.buildFromTemplate([
    { label: T("pin.copy"), click: () => pinAction(p, "copy") },
    { label: T("pin.save"), click: () => pinAction(p, "save") },
    { label: T("pin.edit"), click: () => pinAction(p, "edit") },
    { type: "separator" },
    { label: T("pin.close"), click: () => pinAction(p, "close") },
  ]).popup({ window: p.win });
});
ipcMain.handle("pin:act", (e, id) => { const p = pinOf(e); return p ? pinAction(p, String(id)) : { ok: false }; });

/* ---------- app lifecycle ---------- */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // A second start hands over its arguments: --cek captures, --arka-plan does nothing, nothing opens the editor.
  app.on("second-instance", (_e, argv) => {
    if (argv.includes("--cek")) setTimeout(() => capture("cek"), CAPTURE_DELAY);
    else if (!argv.includes("--arka-plan")) showEditor();
  });
  app.on("window-all-closed", () => { /* keeps running in the tray */ });
  app.on("before-quit", () => { app.quitting = true; });
  app.on("will-quit", () => { globalShortcut.unregisterAll(); stopGrabber(); });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    L = language.load({ appDir: __dirname, name: "NeuralSnap", systemLanguages: app.getPreferredSystemLanguages() });
    L.wire(ipcMain);
    // New versions of the series: checked after startup and every few hours, once a day for all programs together.
    const updates = shared("update-check").create({ name: "NeuralSnap", version: app.getVersion(), t: T });
    updates.wire(ipcMain);
    updates.start();
    themeSync.wire({ ipcMain, BrowserWindow, prefix: "snap", name: "NeuralSnap" });
    cleanGrabDir();
    startGrabber();
    createOverlays();
    for (const ev of ["display-added", "display-removed", "display-metrics-changed"]) screen.on(ev, scheduleRebuild);
    try {
      tray = new Tray(ICON ? nativeImage.createFromPath(ICON) : nativeImage.createEmpty());
      tray.on("click", () => showEditor()); // a click would otherwise freeze the screen the user is looking at
    } catch (e) { tray = null; }
    setShortcut(settings.shortcut, false);
    if (BACKGROUND) {
      if (!shortcut.ok && tray) tray.displayBalloon({ iconType: "warning", title: "NeuralSnap", content: T("tray.balloon", { accel: shortcut.accel }) });
    } else if (!process.argv.includes("--cek")) showEditor();
    if (process.argv.includes("--cek")) setTimeout(() => capture("cek"), CAPTURE_DELAY);
  });
}
