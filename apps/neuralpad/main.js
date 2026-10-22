"use strict";
// NeuralPad NP-7 desktop shell: frameless transparent windows shaped by the page, native file dialogs,
// a session file in userData, and window moves/resizes driven from the page's own handles.
const { app, BrowserWindow, ipcMain, dialog, screen, Menu } = require("electron");
const fs = require("fs");
const path = require("path");

app.setAppUserModelId("NeuralPad.NP7");

const MIN_W = 560;
const MIN_H = 340;
const MAX_FILE = 64 * 1024 * 1024;
const FILTERS = [
  { name: "Metin Belgeleri (*.txt)", extensions: ["txt"] },
  { name: "Tüm Dosyalar (*.*)", extensions: ["*"] },
];

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

function describe(err) {
  switch (err && err.code) {
    case "ENOENT": return "Dosya bulunamadı.";
    case "EACCES":
    case "EPERM": return "Bu konuma erişim izni yok.";
    case "EBUSY": return "Dosya başka bir program tarafından kullanılıyor.";
    case "EISDIR": return "Bu bir klasör.";
    case "ENOSPC": return "Diskte yer kalmadı.";
    default: return (err && err.message) || "Bilinmeyen hata.";
  }
}

function filesFromArgs(argv, cwd) {
  const out = [];
  for (const a of argv.slice(app.isPackaged ? 1 : 2)) {
    if (!a || a.startsWith("-")) continue;
    const p = path.resolve(cwd || process.cwd(), a);
    try { if (fs.statSync(p).isFile()) out.push(p); } catch (e) { /* not a file */ }
  }
  return out;
}

/* ---------- bounds ---------- */
function onScreen(b) {
  return !!b && screen.getAllDisplays().some(({ workArea: a }) =>
    b.x < a.x + a.width - 60 && b.x + b.width > a.x + 60 && b.y >= a.y - 8 && b.y < a.y + a.height - 60);
}
function defaultBounds() {
  const a = screen.getPrimaryDisplay().workArea;
  const width = Math.max(MIN_W, Math.min(1000, a.width - 60));
  const height = Math.max(MIN_H, Math.min(700, a.height - 60));
  return { x: Math.round(a.x + (a.width - width) / 2), y: Math.round(a.y + (a.height - height) / 2), width, height };
}
function saveState(win) {
  if (win !== mainWin || win.isDestroyed()) return;
  const s = win.np;
  writeJSON("window.json", { bounds: s.maximized ? s.restore : win.getBounds(), maximized: s.maximized });
}

/* ---------- maximize (our own: the window is not natively resizable) ---------- */
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
  win.webContents.send("np:maximized", on);
  saveState(win);
}

/* ---------- resize from the page's edge handles ---------- */
function startResize(win, edge) {
  if (win.np.maximized || !/^(n|s|e|w|ne|nw|se|sw)$/.test(edge)) return;
  stopResize(win);
  const r = { edge, from: win.getBounds(), cursor: screen.getCursorScreenPoint(), last: null };
  r.timer = setInterval(() => resizeTick(win, r), 16);
  win.np.resizing = r;
}
function resizeTick(win, r) {
  if (win.isDestroyed()) { clearInterval(r.timer); return; }
  const p = screen.getCursorScreenPoint();
  const dx = p.x - r.cursor.x;
  const dy = p.y - r.cursor.y;
  const b = r.from;
  let { x, y, width, height } = b;
  if (r.edge.includes("e")) width = Math.max(MIN_W, b.width + dx);
  if (r.edge.includes("s")) height = Math.max(MIN_H, b.height + dy);
  if (r.edge.includes("w")) { width = Math.max(MIN_W, b.width - dx); x = b.x + b.width - width; }
  if (r.edge.includes("n")) { height = Math.max(MIN_H, b.height - dy); y = b.y + b.height - height; }
  const l = r.last;
  if (l && l.x === x && l.y === y && l.width === width && l.height === height) return;
  r.last = { x, y, width, height };
  win.setBounds(r.last);
}
function stopResize(win) {
  const r = win.np && win.np.resizing;
  if (!r) return;
  clearInterval(r.timer);
  win.np.resizing = null;
  saveState(win);
}

/* ---------- windows ---------- */
function createWindow({ extra = false, files = [] } = {}) {
  const saved = extra ? null : readJSON("window.json");
  let bounds = saved && onScreen(saved.bounds) ? saved.bounds : defaultBounds();
  if (extra) {
    const ref = BrowserWindow.getFocusedWindow() || mainWin;
    if (ref && !ref.np.maximized) {
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
    title: "NeuralPad",
    icon: path.join(__dirname, "neuralpad.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.np = { extra, files: [...files], loaded: false, maximized: false, restore: null, allowClose: false, askedAt: 0, acked: false, resizing: null };

  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.on("did-finish-load", () => { win.np.loaded = true; });
  win.webContents.setVisualZoomLevelLimits(1, 1);

  win.once("ready-to-show", () => {
    if (!extra && saved && saved.maximized) setMaximized(win, true);
    win.show();
  });
  // The page decides: the main window keeps its session, extra windows ask about unsaved tabs.
  // If the page never answers (it crashed), a second close after a few seconds goes through.
  win.on("close", (e) => {
    const s = win.np;
    if (s.allowClose) return;
    if (s.askedAt && !s.acked && Date.now() - s.askedAt > 3000) return;
    e.preventDefault();
    s.askedAt = Date.now();
    s.acked = false;
    win.webContents.send("np:close-request");
  });
  win.on("moved", () => {
    const s = win.np;
    if (s.maximized && s.restore) {
      // Dragging a maximized window gives it back its earlier size where it was dropped.
      const b = win.getBounds();
      s.maximized = false;
      win.setBounds({ x: b.x, y: b.y, width: s.restore.width, height: s.restore.height });
      win.webContents.send("np:maximized", false);
    }
    saveState(win);
  });
  win.on("blur", () => stopResize(win));
  win.on("closed", () => { if (mainWin === win) mainWin = null; });

  win.loadFile(path.join(__dirname, "index.html"), extra ? { query: { yeni: "1" } } : undefined);
  return win;
}

/* ---------- IPC ---------- */
const winOf = (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  return w && !w.isDestroyed() ? w : null;
};

ipcMain.on("np:minimize", (e) => { const w = winOf(e); if (w) w.minimize(); });
ipcMain.on("np:toggle-max", (e) => { const w = winOf(e); if (w) setMaximized(w, !w.np.maximized); });
ipcMain.on("np:close", (e) => { const w = winOf(e); if (w) w.close(); });
ipcMain.on("np:close-ack", (e) => { const w = winOf(e); if (w) w.np.acked = true; });
ipcMain.on("np:close-confirm", (e) => {
  const w = winOf(e);
  if (!w) return;
  saveState(w);
  w.np.allowClose = true;
  w.close();
});
ipcMain.on("np:resize-start", (e, edge) => { const w = winOf(e); if (w) startResize(w, String(edge)); });
ipcMain.on("np:resize-end", (e) => { const w = winOf(e); if (w) stopResize(w); });
ipcMain.on("np:new-window", () => { createWindow({ extra: true }); });
ipcMain.on("np:paste", (e) => e.sender.paste());

ipcMain.handle("np:pending-files", (e) => {
  const w = winOf(e);
  if (!w) return [];
  const f = w.np.files;
  w.np.files = [];
  return f;
});
ipcMain.handle("np:open-dialog", async (e, dir) => {
  const r = await dialog.showOpenDialog(winOf(e), {
    title: "Aç",
    defaultPath: dir || undefined,
    properties: ["openFile", "multiSelections"],
    filters: FILTERS,
  });
  return r.canceled ? [] : r.filePaths;
});
ipcMain.handle("np:save-dialog", async (e, suggested) => {
  const r = await dialog.showSaveDialog(winOf(e), {
    title: "Farklı kaydet",
    defaultPath: suggested || "Başlıksız.txt",
    filters: FILTERS,
  });
  return r.canceled || !r.filePath ? null : r.filePath;
});
ipcMain.handle("np:read-file", async (_e, p) => {
  try {
    const st = await fs.promises.stat(p);
    if (!st.isFile()) return { ok: false, error: "Bu bir dosya değil." };
    if (st.size > MAX_FILE) return { ok: false, error: "Dosya 64 MB'tan büyük." };
    return { ok: true, path: p, name: path.basename(p), bytes: await fs.promises.readFile(p) };
  } catch (err) {
    return { ok: false, error: describe(err) };
  }
});
ipcMain.handle("np:write-file", async (_e, p, bytes) => {
  try {
    await fs.promises.writeFile(p, Buffer.from(bytes));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: describe(err) };
  }
});
ipcMain.handle("np:session-load", () => readJSON("session.json"));
ipcMain.on("np:session-save", (e, data) => { if (winOf(e) === mainWin) writeJSON("session.json", data); });

/* ---------- app lifecycle ---------- */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_e, argv, cwd) => {
    const files = filesFromArgs(argv, cwd);
    if (!mainWin) { mainWin = createWindow({ files }); return; }
    if (mainWin.isMinimized()) mainWin.restore();
    mainWin.show();
    mainWin.focus();
    if (!files.length) return;
    if (mainWin.np.loaded) mainWin.webContents.send("np:open-files", files);
    else mainWin.np.files.push(...files);
  });
  app.on("window-all-closed", () => app.quit());
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    mainWin = createWindow({ files: filesFromArgs(process.argv, process.cwd()) });
  });
}
