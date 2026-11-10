"use strict";
// NeuralPulse PL-2 desktop shell: one frameless transparent window (the same model as NeuralTerm) and the measuring
// helper plsensor.exe, which writes one JSON line a second; the page draws it. The helper rests while the window is
// minimized or hidden and ends with the program. Ending a process: the page asks the user first, this process checks
// that the PID still belongs to the same program and is not NeuralPulse itself, then ends it (Windows refuses the
// processes of other users and of the system, as NeuralPulse never asks for administrator rights).
// Tests: NEURALPULSE_PROFILE (settings folder), NEURALPULSE_SENSOR (a helper compiled elsewhere), NEURALPULSE_DEMO=1
// (invented data: nothing can be ended then), NEURALPULSE_TEST_INACTIVE=1 (the window never takes the keyboard focus
// from whatever the user is doing while a test runs).
const { app, BrowserWindow, ipcMain, screen, Menu, clipboard, shell } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
// Shared with the series: next to main.js when installed, in apps\shared when run from source.
const shared = (name) => require(fs.existsSync(path.join(__dirname, `${name}.js`)) ? `./${name}` : `../shared/${name}`);
const themeSync = shared("theme-sync");
const language = shared("language");
let L = null; // the interface language, read once app is ready (lang\*.json)
const T = (key, vars) => (L ? L.t(key, vars) : key);
const handoff = shared("handoff").create({ self: "NeuralPulse", shell, t: T });

if (process.env.NEURALPULSE_PROFILE) app.setPath("userData", process.env.NEURALPULSE_PROFILE);
app.setAppUserModelId("NeuralPulse.PL2");

const MIN_W = 760;
const MIN_H = 480;
const SENSOR = process.env.NEURALPULSE_SENSOR ? path.resolve(process.env.NEURALPULSE_SENSOR) : path.join(__dirname, "plsensor.exe");
const DEMO = process.env.NEURALPULSE_DEMO === "1";
const INACTIVE = process.env.NEURALPULSE_TEST_INACTIVE === "1";
const HISTORY = 60; // seconds of graphs

let mainWin = null;

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
const send = (wc, channel, payload) => { if (wc && !wc.isDestroyed()) wc.send(channel, payload); };
const toPage = (channel, payload) => { if (mainWin && !mainWin.isDestroyed()) send(mainWin.webContents, channel, payload); };

/* ---------- the measuring helper ---------- */
// last: the newest sample (with its process list); history: the graphs' samples without process lists.
const sensor = { proc: null, paused: false, quitting: false, samples: 0, last: null, lastAt: 0, history: [], error: "", restarts: 0 };
const sensorState = () => ({ running: !!sensor.proc, paused: sensor.paused, samples: sensor.samples, pid: sensor.proc ? sensor.proc.pid : 0, error: sensor.error, demo: DEMO });

function command(text) {
  const p = sensor.proc;
  if (p && p.stdin && p.stdin.writable) { try { p.stdin.write(text + "\n"); } catch (e) { /* it is ending */ } }
}
function onLine(line) {
  let s;
  try { s = JSON.parse(line); } catch (e) { return; }
  if (!s || !s.cpu || !Array.isArray(s.procs)) return;
  sensor.samples++;
  sensor.last = s;
  sensor.lastAt = Date.now();
  sensor.restarts = 0;
  const { procs, ...rest } = s;
  sensor.history.push(rest);
  if (sensor.history.length > HISTORY) sensor.history.splice(0, sensor.history.length - HISTORY);
  toPage("np:sample", s);
}
function startSensor() {
  if (sensor.quitting || sensor.proc) return;
  if (!fs.existsSync(SENSOR)) { sensor.error = "missing"; toPage("np:sensor", sensorState()); return; }
  let proc;
  try {
    proc = spawn(SENSOR, DEMO ? ["--demo"] : [], { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
  } catch (e) {
    sensor.error = "failed";
    toPage("np:sensor", sensorState());
    return;
  }
  sensor.proc = proc;
  sensor.error = "";
  let buf = "";
  proc.stdout.setEncoding("utf8");
  proc.stdout.on("data", (d) => {
    buf += d;
    for (let i; (i = buf.indexOf("\n")) >= 0; buf = buf.slice(i + 1)) onLine(buf.slice(0, i));
  });
  proc.stdin.on("error", () => { /* the helper ended */ });
  proc.on("error", () => { /* reported by exit */ });
  proc.on("exit", () => {
    if (sensor.proc !== proc) return;
    sensor.proc = null;
    if (sensor.quitting) return;
    // A helper that dies is started again a few times; after that the page says it stopped.
    if (sensor.restarts++ < 3) setTimeout(startSensor, 1500);
    else sensor.error = "stopped";
    toPage("np:sensor", sensorState());
  });
  if (sensor.paused) command("pause");
  toPage("np:sensor", sensorState());
}
function setPaused(on) {
  if (sensor.paused === on) return;
  sensor.paused = on;
  command(on ? "pause" : "resume");
  toPage("np:sensor", sensorState());
}
function stopSensor() {
  sensor.quitting = true;
  const p = sensor.proc;
  sensor.proc = null;
  if (!p) return;
  try { p.stdin.write("quit\n"); p.stdin.end(); } catch (e) { /* already gone */ }
  try { p.kill(); } catch (e) { /* already gone */ }
}

/* ---------- ending a process, opening its location ---------- */
// NeuralPulse's own processes: this one, its renderer, GPU and utility processes, and the helper.
function ownPids() {
  const own = new Set([process.pid]);
  try { for (const m of app.getAppMetrics()) own.add(m.pid); } catch (e) { /* only this one */ }
  if (sensor.proc) own.add(sensor.proc.pid);
  return own;
}
function endProcess(pid, name) {
  const id = Number(pid);
  const label = String(name || "");
  if (DEMO) return { ok: false, error: T("end.demo") };
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: T("end.gone") };
  if (ownPids().has(id)) return { ok: false, error: T("end.self") };
  // The newest sample is at most a second old while the window is shown; an older one may name a reused PID.
  if (!sensor.last || Date.now() - sensor.lastAt > 5000) return { ok: false, error: T("end.stale") };
  const now = sensor.last.procs.find((p) => p.pid === id);
  if (!now) return { ok: false, error: T("end.gone") };
  if (now.name !== label) return { ok: false, error: T("end.changed", { pid: id }) };
  try {
    process.kill(id);
  } catch (e) {
    if (e.code === "EPERM") return { ok: false, error: T("end.denied", { name: label }), denied: true };
    if (e.code === "ESRCH") return { ok: false, error: T("end.gone") };
    return { ok: false, error: T("end.failed", { error: e.message }) };
  }
  return { ok: true };
}
async function openLocation(p) {
  const target = String(p || "");
  if (!target || !path.isAbsolute(target)) return T("loc.none");
  try { await fs.promises.stat(target); } catch (e) { return T("loc.missing", { path: target }); }
  return handoff.showInNav(target);
}

/* ---------- bounds, maximize, resize (same model as NeuralTerm) ---------- */
function onScreen(b) {
  return !!b && screen.getAllDisplays().some(({ workArea: a }) =>
    b.x < a.x + a.width - 60 && b.x + b.width > a.x + 60 && b.y >= a.y - 8 && b.y < a.y + a.height - 60);
}
function defaultBounds() {
  const a = screen.getPrimaryDisplay().workArea;
  const width = Math.max(MIN_W, Math.min(1180, a.width - 60));
  const height = Math.max(MIN_H, Math.min(760, a.height - 60));
  return { x: Math.round(a.x + (a.width - width) / 2), y: Math.round(a.y + (a.height - height) / 2), width, height };
}
function saveState(win) {
  if (win !== mainWin || win.isDestroyed()) return;
  const s = win.np;
  writeJSON("window.json", { bounds: s.maximized ? s.restore : win.getBounds(), maximized: s.maximized });
}
function setMaximized(win, on) {
  const s = win.np;
  if (s.maximized === on) return;
  if (on) {
    s.restore = win.getBounds();
    win.setBounds(screen.getDisplayMatching(s.restore).workArea);
  } else {
    win.setBounds(onScreen(s.restore) ? s.restore : defaultBounds());
  }
  s.maximized = on;
  send(win.webContents, "np:maximized", on);
  saveState(win);
}
function startResize(win, edge) {
  if (win.np.maximized || !/^(n|s|e|w|ne|nw|se|sw)$/.test(edge)) return;
  stopResize(win);
  const r = { from: win.getBounds(), cursor: screen.getCursorScreenPoint(), last: null };
  r.timer = setInterval(() => {
    if (win.isDestroyed()) { clearInterval(r.timer); return; }
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
  win.np.resizing = r;
}
function stopResize(win) {
  const r = win.np && win.np.resizing;
  if (!r) return;
  clearInterval(r.timer);
  win.np.resizing = null;
  saveState(win);
}

/* ---------- the window ---------- */
function createWindow() {
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
    title: "NeuralPulse",
    icon: path.join(__dirname, "neuralpulse.ico"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  win.np = { maximized: false, restore: null, resizing: null };
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.setVisualZoomLevelLimits(1, 1);
  win.once("ready-to-show", () => {
    if (saved && saved.maximized) setMaximized(win, true);
    if (INACTIVE) win.showInactive(); else win.show();
  });
  win.on("moved", () => {
    const s = win.np;
    if (s.maximized && s.restore) {
      const b = win.getBounds();
      s.maximized = false;
      win.setBounds({ x: b.x, y: b.y, width: s.restore.width, height: s.restore.height });
      send(win.webContents, "np:maximized", false);
    }
    saveState(win);
  });
  win.on("blur", () => stopResize(win));
  // Nothing to measure for while nobody can see it.
  win.on("minimize", () => setPaused(true));
  win.on("hide", () => setPaused(true));
  win.on("restore", () => setPaused(!win.isVisible()));
  win.on("show", () => setPaused(win.isMinimized()));
  win.on("closed", () => { if (mainWin === win) mainWin = null; });
  win.loadFile(path.join(__dirname, "index.html"));
  return win;
}

const fromMain = (e) => mainWin && !mainWin.isDestroyed() && e.sender === mainWin.webContents;
ipcMain.on("np:minimize", (e) => { if (fromMain(e)) mainWin.minimize(); });
ipcMain.on("np:toggle-max", (e) => { if (fromMain(e)) setMaximized(mainWin, !mainWin.np.maximized); });
ipcMain.on("np:close", (e) => { if (fromMain(e)) mainWin.close(); });
ipcMain.on("np:resize-start", (e, edge) => { if (fromMain(e)) startResize(mainWin, String(edge)); });
ipcMain.on("np:resize-end", (e) => { if (fromMain(e)) stopResize(mainWin); });
ipcMain.handle("np:info", () => ({
  demo: DEMO,
  version: app.getVersion(),
  nav: !!handoff.exe("NeuralNav"),
  uptime: DEMO ? 2 * 86400 + 7 * 3600 + 14 * 60 : os.uptime(), // seconds since Windows started, when asked
  history: sensor.history,
  last: sensor.last,
  sensor: sensorState(),
}));
ipcMain.handle("np:state", () => sensorState());
ipcMain.handle("np:end", (e, pid, name) => (fromMain(e) ? endProcess(pid, name) : { ok: false, error: T("end.failed", { error: "?" }) }));
ipcMain.handle("np:open-location", (e, p) => (fromMain(e) ? openLocation(p) : ""));
ipcMain.on("np:clip-write", (_e, text) => clipboard.writeText(String(text)));

/* ---------- app lifecycle ---------- */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Starting it again brings the window back.
  app.on("second-instance", () => {
    if (!mainWin) { mainWin = createWindow(); return; }
    if (INACTIVE) { mainWin.showInactive(); setPaused(mainWin.isMinimized() || !mainWin.isVisible()); return; }
    if (mainWin.isMinimized()) mainWin.restore();
    mainWin.show();
    mainWin.focus();
  });
  app.on("window-all-closed", () => app.quit());
  app.on("will-quit", stopSensor);
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    L = language.load({ appDir: __dirname, name: "NeuralPulse", systemLanguages: app.getPreferredSystemLanguages() });
    L.wire(ipcMain);
    // New versions of the series: checked after startup and every few hours, once a day for all programs together.
    const updates = shared("update-check").create({ name: "NeuralPulse", version: app.getVersion(), t: T });
    updates.wire(ipcMain);
    updates.start();
    themeSync.wire({ ipcMain, BrowserWindow, prefix: "np", name: "NeuralPulse" });
    startSensor();
    mainWin = createWindow();
  });
}
