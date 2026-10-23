"use strict";
// NeuralTerm NT-5 desktop shell: frameless transparent windows (same model as NeuralNav), and one ntpty.exe
// pseudo-console bridge per tab that runs the shell and streams its output to the page.
const { app, BrowserWindow, ipcMain, screen, Menu, clipboard, shell } = require("electron");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { StringDecoder } = require("string_decoder");
// Shared with the series: next to main.js when installed, in apps\shared when run from source.
const shared = (name) => require(fs.existsSync(path.join(__dirname, `${name}.js`)) ? `./${name}` : `../shared/${name}`);
const themeSync = shared("theme-sync");
const handoff = shared("handoff").create({ self: "NeuralTerm", shell });

app.setAppUserModelId("NeuralTerm.NT5");

const MIN_W = 520;
const MIN_H = 320;
const PTY = path.join(__dirname, "ntpty.exe");
const SYS32 = path.join(process.env.SystemRoot || "C:\\Windows", "System32");

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

/* ---------- shells ---------- */
// Every shell starts with the UTF-8 code page so Turkish text from native programs shows correctly.
function findOnPath(exe) {
  for (const dir of (process.env.PATH || "").split(";")) {
    if (!dir) continue;
    const p = path.join(dir, exe);
    if (fs.existsSync(p)) return p;
  }
  return null;
}
function detectShells() {
  const list = [];
  const ps = path.join(SYS32, "WindowsPowerShell", "v1.0", "powershell.exe");
  const utf8 = "[Console]::InputEncoding=[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding $false";
  if (fs.existsSync(ps)) list.push({ id: "powershell", name: "Windows PowerShell", cmd: `"${ps}" -NoLogo -NoExit -Command "${utf8}"` });
  const pwsh = findOnPath("pwsh.exe") || [path.join(process.env.ProgramFiles || "", "PowerShell", "7", "pwsh.exe")].find((p) => fs.existsSync(p));
  if (pwsh) list.push({ id: "pwsh", name: "PowerShell 7", cmd: `"${pwsh}" -NoLogo -NoExit -Command "${utf8}"` });
  list.push({ id: "cmd", name: "Komut İstemi", cmd: `"${path.join(SYS32, "cmd.exe")}" /K chcp 65001 >nul` });
  const bash = [path.join(process.env.ProgramFiles || "", "Git", "bin", "bash.exe")].find((p) => fs.existsSync(p));
  if (bash) list.push({ id: "gitbash", name: "Git Bash", cmd: `"${bash}" --login -i` });
  const wsl = path.join(SYS32, "wsl.exe");
  if (fs.existsSync(wsl)) list.push({ id: "wsl", name: "WSL", cmd: `"${wsl}"` });
  return list;
}
let SHELLS = null;
const shells = () => SHELLS || (SHELLS = detectShells());

function dirsFromArgs(argv, cwd) {
  const out = [];
  for (const raw of argv.slice(app.isPackaged ? 1 : 2)) {
    if (!raw || raw.startsWith("-")) continue;
    let p = path.resolve(cwd || process.cwd(), raw.replace(/^"(.*)"$/, "$1"));
    try { if (fs.statSync(p).isFile()) p = path.dirname(p); out.push(p); } catch (e) { /* not a path */ }
  }
  return out;
}

/* ---------- bounds, maximize, resize (same model as NeuralNav) ---------- */
function onScreen(b) {
  return !!b && screen.getAllDisplays().some(({ workArea: a }) =>
    b.x < a.x + a.width - 60 && b.x + b.width > a.x + 60 && b.y >= a.y - 8 && b.y < a.y + a.height - 60);
}
function defaultBounds() {
  const a = screen.getPrimaryDisplay().workArea;
  const width = Math.max(MIN_W, Math.min(1040, a.width - 60));
  const height = Math.max(MIN_H, Math.min(640, a.height - 60));
  return { x: Math.round(a.x + (a.width - width) / 2), y: Math.round(a.y + (a.height - height) / 2), width, height };
}
function saveState(win) {
  if (win !== mainWin || win.isDestroyed()) return;
  const s = win.nt;
  writeJSON("window.json", { bounds: s.maximized ? s.restore : win.getBounds(), maximized: s.maximized });
}
function setMaximized(win, on) {
  const s = win.nt;
  if (s.maximized === on) return;
  if (on) {
    s.restore = win.getBounds();
    win.setBounds(screen.getDisplayMatching(s.restore).workArea);
  } else {
    win.setBounds(onScreen(s.restore) ? s.restore : defaultBounds());
  }
  s.maximized = on;
  win.webContents.send("nt:maximized", on);
  saveState(win);
}
function startResize(win, edge) {
  if (win.nt.maximized || !/^(n|s|e|w|ne|nw|se|sw)$/.test(edge)) return;
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
  win.nt.resizing = r;
}
function stopResize(win) {
  const r = win.nt && win.nt.resizing;
  if (!r) return;
  clearInterval(r.timer);
  win.nt.resizing = null;
  saveState(win);
}

/* ---------- windows ---------- */
function createWindow({ extra = false, dirs = [] } = {}) {
  const saved = extra ? null : readJSON("window.json");
  let bounds = saved && onScreen(saved.bounds) ? saved.bounds : defaultBounds();
  if (extra) {
    const ref = BrowserWindow.getFocusedWindow() || mainWin;
    if (ref && !ref.nt.maximized) {
      const b = ref.getBounds();
      const shifted = { x: b.x + 32, y: b.y + 32, width: b.width, height: b.height };
      if (onScreen(shifted)) bounds = shifted;
    }
  }
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
    title: "NeuralTerm",
    icon: path.join(__dirname, "neuralterm.ico"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  win.nt = { dirs: [...dirs], loaded: false, maximized: false, restore: null, allowClose: false, resizing: null };
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.on("did-finish-load", () => { win.nt.loaded = true; });
  win.webContents.setVisualZoomLevelLimits(1, 1);
  win.once("ready-to-show", () => {
    if (!extra && saved && saved.maximized) setMaximized(win, true);
    win.show();
  });
  // With more than one tab open, closing asks first (like Windows Terminal).
  win.on("close", (e) => {
    if (win.nt.allowClose) return;
    const open = [...sessions.values()].filter((s) => s.wc === win.webContents).length;
    if (open <= 1) return;
    e.preventDefault();
    win.webContents.send("nt:close-request", open);
  });
  win.on("moved", () => {
    const s = win.nt;
    if (s.maximized && s.restore) {
      const b = win.getBounds();
      s.maximized = false;
      win.setBounds({ x: b.x, y: b.y, width: s.restore.width, height: s.restore.height });
      win.webContents.send("nt:maximized", false);
    }
    saveState(win);
  });
  win.on("blur", () => stopResize(win));
  const wc = win.webContents;
  win.on("closed", () => {
    for (const [id, s] of sessions) if (s.wc === wc) killSession(id);
    if (mainWin === win) mainWin = null;
  });
  win.loadFile(path.join(__dirname, "index.html"));
  return win;
}

const winOf = (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  return w && !w.isDestroyed() ? w : null;
};
const send = (wc, channel, payload) => { if (wc && !wc.isDestroyed()) wc.send(channel, payload); };

ipcMain.on("nt:minimize", (e) => { const w = winOf(e); if (w) w.minimize(); });
ipcMain.on("nt:toggle-max", (e) => { const w = winOf(e); if (w) setMaximized(w, !w.nt.maximized); });
ipcMain.on("nt:close", (e) => { const w = winOf(e); if (w) w.close(); });
ipcMain.on("nt:close-confirm", (e) => { const w = winOf(e); if (w) { w.nt.allowClose = true; w.close(); } });
ipcMain.on("nt:resize-start", (e, edge) => { const w = winOf(e); if (w) startResize(w, String(edge)); });
ipcMain.on("nt:resize-end", (e) => { const w = winOf(e); if (w) stopResize(w); });
ipcMain.on("nt:new-window", () => { createWindow({ extra: true }); });
ipcMain.handle("nt:pending-dirs", (e) => {
  const w = winOf(e);
  if (!w) return [];
  const d = w.nt.dirs;
  w.nt.dirs = [];
  return d;
});
ipcMain.handle("nt:info", () => ({
  shells: shells().map(({ id, name }) => ({ id, name })),
  home: app.getPath("home"),
  handoff: { nav: !!handoff.exe("NeuralNav"), web: !!handoff.exe("NeuralWeb") },
}));
ipcMain.handle("nt:clip-read", () => clipboard.readText());
ipcMain.on("nt:clip-write", (_e, text) => clipboard.writeText(String(text)));

/* ---------- links: paths and addresses in the output (Ctrl+click) ---------- */
// Asynchronous on purpose: a missing network share or an offline drive must not freeze the windows.
const statOf = (p) => Promise.race([
  fs.promises.stat(p).then((s) => s, () => null),
  new Promise((r) => setTimeout(() => r(null), 1500)),
]);
// For each candidate (its possible spellings, see links.js), the longest one that exists, resolved against the line's folder.
ipcMain.handle("nt:link-check", async (_e, base, cands) => {
  const dir = typeof base === "string" && path.isAbsolute(base) ? base : null;
  const list = Array.isArray(cands) ? cands.slice(0, 200) : [];
  return Promise.all(list.map(async (variants) => {
    const tries = (Array.isArray(variants) ? variants : []).filter((v) => typeof v === "string" && v.length < 1024).slice(0, 30);
    let best = null;
    await Promise.all(tries.map(async (text) => {
      const p = path.isAbsolute(text) && /^([A-Za-z]:[\\/]|\\\\)/.test(text) ? path.resolve(text) : dir ? path.resolve(dir, text) : null;
      const s = p && (await statOf(p));
      if (s && (!best || text.length > best.text.length)) best = { text, path: p, isDir: s.isDirectory() };
    }));
    return best;
  }));
});
ipcMain.handle("nt:open-link", async (_e, kind, target) => {
  const t = String(target);
  if (kind === "url") return handoff.openUrl(t);
  if (kind === "path" && path.isAbsolute(t) && (await statOf(t))) return handoff.showInNav(t);
  return "Bulunamadı.";
});

/* ---------- shell sessions ---------- */
const sessions = new Map();
function frame(type, payload) {
  const head = Buffer.alloc(5);
  head[0] = type.charCodeAt(0);
  head.writeInt32LE(payload.length, 1);
  return Buffer.concat([head, payload]);
}
function killSession(id) {
  const s = sessions.get(id);
  if (!s) return;
  sessions.delete(id);
  try { s.proc.stdin.end(); } catch (e) { /* already gone */ }
  setTimeout(() => { try { s.proc.kill(); } catch (e) { /* already gone */ } }, 1500);
}
ipcMain.on("nt:spawn", (e, id, shellId, cwd, cols, rows) => {
  const sh = shells().find((x) => x.id === shellId) || shells()[0];
  let dir = String(cwd || app.getPath("home"));
  try { if (!fs.statSync(dir).isDirectory()) dir = app.getPath("home"); } catch (err) { dir = app.getPath("home"); }
  const c = Math.max(10, Math.min(1000, cols | 0));
  const r = Math.max(4, Math.min(500, rows | 0));
  const proc = spawn(PTY, [String(c), String(r), dir, sh.cmd], { windowsHide: true, windowsVerbatimArguments: false, stdio: ["pipe", "pipe", "pipe"] });
  const decoder = new StringDecoder("utf8");
  const wc = e.sender;
  sessions.set(id, { proc, wc });
  send(wc, "nt:started", { id, shell: { id: sh.id, name: sh.name }, cwd: dir });
  proc.stdout.on("data", (d) => send(wc, "nt:data", { id, data: decoder.write(d) }));
  let err = "";
  proc.stderr.on("data", (d) => { err += d.toString(); });
  proc.on("error", (x) => send(wc, "nt:exit", { id, code: -1, error: x.message }));
  proc.on("exit", (code) => {
    const rest = decoder.end();
    if (rest) send(wc, "nt:data", { id, data: rest });
    sessions.delete(id);
    send(wc, "nt:exit", { id, code: code == null ? -1 : code, error: err.trim() });
  });
});
ipcMain.on("nt:input", (_e, id, text) => {
  const s = sessions.get(id);
  if (s) s.proc.stdin.write(frame("D", Buffer.from(String(text), "utf8")));
});
ipcMain.on("nt:resize", (_e, id, cols, rows) => {
  const s = sessions.get(id);
  if (!s) return;
  const b = Buffer.alloc(4);
  b.writeInt16LE(Math.max(10, Math.min(1000, cols | 0)), 0);
  b.writeInt16LE(Math.max(4, Math.min(500, rows | 0)), 2);
  s.proc.stdin.write(frame("R", b));
});
ipcMain.on("nt:kill", (_e, id) => killSession(id));

/* ---------- app lifecycle ---------- */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Launching again opens a new window; a folder argument opens a new tab in the main window instead.
  app.on("second-instance", (_e, argv, cwd) => {
    const dirs = dirsFromArgs(argv, cwd);
    if (!mainWin) { mainWin = createWindow({ dirs }); return; }
    if (!dirs.length) { createWindow({ extra: true }); return; }
    if (mainWin.isMinimized()) mainWin.restore();
    mainWin.show();
    mainWin.focus();
    if (mainWin.nt.loaded) send(mainWin.webContents, "nt:open-dirs", dirs);
    else mainWin.nt.dirs.push(...dirs);
  });
  app.on("window-all-closed", () => app.quit());
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    themeSync.wire({ ipcMain, BrowserWindow, prefix: "nt", name: "NeuralTerm" });
    mainWin = createWindow({ dirs: dirsFromArgs(process.argv, process.cwd()) });
  });
}
