"use strict";
// NeuralView VW-3 desktop shell: a frameless transparent window shaped by the page, the folder of the open image,
// image bytes and Windows thumbnails through two private protocols, and the file operations (copy, rename, Recycle
// Bin, saving a rotation, showing the file in NeuralNav).
const { app, BrowserWindow, ipcMain, dialog, screen, Menu, shell, clipboard, nativeImage, protocol } = require("electron");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const { spawn } = require("child_process");
const meta = require("./meta");

app.setAppUserModelId("NeuralView.VW3");
// Tests that start NeuralView through another program (NeuralNav) give it a throwaway profile this way.
if (process.env.NEURALVIEW_PROFILE) app.setPath("userData", process.env.NEURALVIEW_PROFILE);

const MIN_W = 520;
const MIN_H = 360;
const MAX_META = 128 * 1024 * 1024;
// What the viewer opens; HEIC and HEIF are listed too, so that they can be explained instead of silently skipped.
const MIME = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".jpe": "image/jpeg", ".jfif": "image/jpeg", ".png": "image/png",
  ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp", ".dib": "image/bmp", ".ico": "image/x-icon",
  ".svg": "image/svg+xml", ".avif": "image/avif", ".heic": "image/heic", ".heif": "image/heif",
};
const isImage = (p) => Object.prototype.hasOwnProperty.call(MIME, path.extname(p).toLowerCase());
const FILTERS = [
  { name: "Resimler", extensions: Object.keys(MIME).map((e) => e.slice(1)) },
  { name: "Tüm Dosyalar (*.*)", extensions: ["*"] },
];
// Tests set these, so that deleting, copying and launching NeuralNav never reach the real Recycle Bin, clipboard
// and programs: the trash becomes a folder, the clipboard files in a folder, a launch a line in a file.
const TEST_TRASH = process.env.NEURALVIEW_TEST_TRASH || "";
const TEST_CLIPBOARD = process.env.NEURALVIEW_TEST_CLIPBOARD || "";
const TEST_LAUNCH = process.env.NEURALVIEW_TEST_LAUNCH || "";

// Another program of the series: <root>\<Name>\Program\<Name>.exe, next to wherever this one was installed.
function sibling(name) {
  const local = path.resolve(path.dirname(process.execPath), "..", "..", name, "Program", `${name}.exe`);
  return fs.existsSync(local) ? local : path.join(process.env.USERPROFILE || "", "Neural", name, "Program", `${name}.exe`);
}
const NEURALNAV = sibling("NeuralNav");

let mainWin = null;

protocol.registerSchemesAsPrivileged([
  { scheme: "nvimg", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  { scheme: "nvthumb", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

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
    case "EEXIST": return "Bu adla bir dosya zaten var.";
    case "ENOSPC": return "Diskte yer kalmadı.";
    default: return (err && err.message) || "Bilinmeyen hata.";
  }
}

// Paths from the command line; a folder opens its first image. Chromium may move its switches in front of the
// paths, so the app's own folder (given when it runs from source) is skipped by value, not by position.
function pathsFromArgs(argv, cwd) {
  const out = [];
  const self = path.resolve(app.getAppPath()).toLowerCase();
  for (const a of argv.slice(1)) {
    if (!a || a.startsWith("-")) continue;
    const p = path.resolve(cwd || process.cwd(), a);
    if (p.toLowerCase() === self) continue;
    try { if (fs.statSync(p)) out.push(p); } catch (e) { /* does not exist */ }
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
  const width = Math.max(MIN_W, Math.min(1120, a.width - 60));
  const height = Math.max(MIN_H, Math.min(760, a.height - 60));
  return { x: Math.round(a.x + (a.width - width) / 2), y: Math.round(a.y + (a.height - height) / 2), width, height };
}
function saveState(win) {
  if (win !== mainWin || win.isDestroyed() || win.vw.full) return;
  const s = win.vw;
  writeJSON("window.json", { bounds: s.maximized ? s.restore : win.getBounds(), maximized: s.maximized });
}

/* ---------- maximize and full screen (our own: the window is not natively resizable) ---------- */
function setMaximized(win, on) {
  const s = win.vw;
  if (s.maximized === on || s.full) return;
  if (on) {
    s.restore = win.getBounds();
    win.setBounds(screen.getDisplayMatching(s.restore).workArea);
  } else {
    win.setBounds(onScreen(s.restore) ? s.restore : defaultBounds());
  }
  s.maximized = on;
  win.webContents.send("vw:maximized", on);
  saveState(win);
}
// Full screen covers the whole display, taskbar included; the page drops its frame meanwhile.
function setFull(win, on) {
  const s = win.vw;
  if (s.full === on) return;
  if (on) {
    s.fullRestore = win.getBounds();
    s.full = true;
    win.setAlwaysOnTop(true, "screen-saver");
    win.setBounds(screen.getDisplayMatching(s.fullRestore).bounds);
  } else {
    s.full = false;
    win.setAlwaysOnTop(false);
    win.setBounds(s.maximized ? screen.getDisplayMatching(s.fullRestore).workArea : s.fullRestore);
  }
  win.webContents.send("vw:full", on);
}

/* ---------- resize from the page's edge handles ---------- */
function startResize(win, edge) {
  if (win.vw.maximized || win.vw.full || !/^(n|s|e|w|ne|nw|se|sw)$/.test(edge)) return;
  stopResize(win);
  const r = { edge, from: win.getBounds(), cursor: screen.getCursorScreenPoint(), last: null };
  r.timer = setInterval(() => resizeTick(win, r), 16);
  win.vw.resizing = r;
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
  const r = win.vw && win.vw.resizing;
  if (!r) return;
  clearInterval(r.timer);
  win.vw.resizing = null;
  saveState(win);
}

/* ---------- the window ---------- */
function createWindow(paths = []) {
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
    title: "NeuralView",
    icon: path.join(__dirname, "neuralview.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.vw = { paths: [...paths], loaded: false, maximized: false, restore: null, full: false, fullRestore: null, resizing: null, allowClose: false, askedAt: 0, acked: false, watcher: null };

  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.on("did-finish-load", () => { win.vw.loaded = true; });
  win.webContents.setVisualZoomLevelLimits(1, 1);

  win.once("ready-to-show", () => {
    if (saved && saved.maximized) setMaximized(win, true);
    win.show();
  });
  // The page may hold a rotation that is not saved yet; it answers with close-confirm. A page that never answers
  // (it crashed) does not keep the window open: a second close after a few seconds goes through.
  win.on("close", (e) => {
    const s = win.vw;
    if (s.allowClose) return;
    if (s.askedAt && !s.acked && Date.now() - s.askedAt > 3000) return;
    e.preventDefault();
    s.askedAt = Date.now();
    s.acked = false;
    win.webContents.send("vw:close-request");
  });
  win.on("moved", () => {
    const s = win.vw;
    if (s.full) return;
    if (s.maximized && s.restore) {
      const b = win.getBounds();
      s.maximized = false;
      win.setBounds({ x: b.x, y: b.y, width: s.restore.width, height: s.restore.height });
      win.webContents.send("vw:maximized", false);
    }
    saveState(win);
  });
  win.on("blur", () => stopResize(win));
  win.on("closed", () => {
    if (win.vw.watcher) win.vw.watcher.close();
    if (mainWin === win) mainWin = null;
  });

  win.loadFile(path.join(__dirname, "index.html"));
  return win;
}

/* ---------- image and thumbnail protocols ---------- */
// nvimg://f/<encoded path>?v=<version>: the file itself, with CORS headers so the page may draw it onto a canvas
// (copying and saving a rotation). nvthumb://f/<encoded path>: the Windows Explorer thumbnail as PNG.
function pathOfUrl(url) {
  try {
    const p = decodeURIComponent(new URL(url).pathname.slice(1));
    return path.isAbsolute(p) && isImage(p) ? path.normalize(p) : null;
  } catch (e) { return null; }
}
const CORS = { "access-control-allow-origin": "*" };
function registerProtocols() {
  protocol.handle("nvimg", async (req) => {
    const p = pathOfUrl(req.url);
    if (!p) return new Response("", { status: 400, headers: CORS });
    try {
      const bytes = await fsp.readFile(p);
      return new Response(bytes, { headers: { ...CORS, "content-type": MIME[path.extname(p).toLowerCase()], "cache-control": "no-store" } });
    } catch (e) {
      return new Response("", { status: 404, headers: CORS });
    }
  });
  protocol.handle("nvthumb", async (req) => {
    const p = pathOfUrl(req.url);
    if (!p) return new Response("", { status: 400, headers: CORS });
    try {
      const img = await nativeImage.createThumbnailFromPath(p, { width: 192, height: 192 });
      if (img.isEmpty()) throw new Error("empty");
      return new Response(img.toPNG(), { headers: { ...CORS, "content-type": "image/png" } });
    } catch (e) {
      return new Response("", { status: 404, headers: CORS });
    }
  });
}

/* ---------- IPC: window ---------- */
const winOf = (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  return w && !w.isDestroyed() ? w : null;
};
ipcMain.on("vw:minimize", (e) => { const w = winOf(e); if (w) w.minimize(); });
ipcMain.on("vw:toggle-max", (e) => { const w = winOf(e); if (w) setMaximized(w, !w.vw.maximized); });
ipcMain.on("vw:set-full", (e, on) => { const w = winOf(e); if (w) setFull(w, Boolean(on)); });
ipcMain.on("vw:close", (e) => { const w = winOf(e); if (w) w.close(); });
ipcMain.on("vw:close-ack", (e) => { const w = winOf(e); if (w) w.vw.acked = true; });
ipcMain.on("vw:close-confirm", (e) => {
  const w = winOf(e);
  if (!w) return;
  saveState(w);
  w.vw.allowClose = true;
  w.close();
});
ipcMain.on("vw:resize-start", (e, edge) => { const w = winOf(e); if (w) startResize(w, String(edge)); });
ipcMain.on("vw:resize-end", (e) => { const w = winOf(e); if (w) stopResize(w); });

/* ---------- IPC: files ---------- */
ipcMain.handle("vw:pending-paths", (e) => {
  const w = winOf(e);
  if (!w) return [];
  const p = w.vw.paths;
  w.vw.paths = [];
  return p;
});
ipcMain.handle("vw:open-dialog", async (e, dir) => {
  const r = await dialog.showOpenDialog(winOf(e), {
    title: "Resim aç",
    defaultPath: dir || undefined,
    properties: ["openFile"],
    filters: FILTERS,
  });
  return r.canceled ? null : r.filePaths[0];
});

// The images of a folder: { ok, dir, entries: [{ name, path, size, mtime, ctime }] }. A file path lists its folder.
ipcMain.handle("vw:list", async (_e, target) => {
  try {
    const p = path.resolve(String(target));
    const st = await fsp.stat(p);
    const dir = st.isDirectory() ? p : path.dirname(p);
    const names = await fsp.readdir(dir, { withFileTypes: true });
    const entries = [];
    await Promise.all(names.filter((d) => d.isFile() && isImage(d.name)).map(async (d) => {
      const full = path.join(dir, d.name);
      try {
        const s = await fsp.stat(full);
        entries.push({ name: d.name, path: full, size: s.size, mtime: s.mtimeMs, ctime: s.birthtimeMs });
      } catch (e) { /* vanished meanwhile */ }
    }));
    return { ok: true, dir, entries };
  } catch (err) {
    return { ok: false, error: describe(err) };
  }
});

// The open folder is watched; the page lists it again a moment after something in it changes.
ipcMain.on("vw:watch", (e, dir) => {
  const w = winOf(e);
  if (!w) return;
  if (w.vw.watcher) { w.vw.watcher.close(); w.vw.watcher = null; }
  if (!dir) return;
  let timer = null;
  try {
    w.vw.watcher = fs.watch(String(dir), { persistent: false }, () => {
      clearTimeout(timer);
      timer = setTimeout(() => { if (!w.isDestroyed()) w.webContents.send("vw:dir-changed", String(dir)); }, 350);
    });
    w.vw.watcher.on("error", () => {});
  } catch (err) { /* a folder that cannot be watched is simply not refreshed */ }
});

ipcMain.handle("vw:meta", async (_e, p) => {
  try {
    const file = String(p);
    const st = await fsp.stat(file);
    let buf;
    if (st.size <= MAX_META) buf = await fsp.readFile(file);
    else {
      const fh = await fsp.open(file, "r");
      try { buf = Buffer.alloc(1024 * 1024); await fh.read(buf, 0, buf.length, 0); } finally { await fh.close(); }
    }
    return { ok: true, size: st.size, mtime: st.mtimeMs, ctime: st.birthtimeMs, ...meta.readMeta(buf) };
  } catch (err) {
    return { ok: false, error: describe(err) };
  }
});

ipcMain.handle("vw:copy-image", async (_e, png) => {
  const img = nativeImage.createFromBuffer(Buffer.from(png));
  if (img.isEmpty()) return { ok: false, error: "Resim panoya kopyalanamadı." };
  if (TEST_CLIPBOARD) {
    fs.mkdirSync(TEST_CLIPBOARD, { recursive: true });
    fs.writeFileSync(path.join(TEST_CLIPBOARD, "pano.png"), img.toPNG());
  } else clipboard.writeImage(img);
  return { ok: true };
});
ipcMain.handle("vw:copy-text", (_e, text) => {
  if (TEST_CLIPBOARD) {
    fs.mkdirSync(TEST_CLIPBOARD, { recursive: true });
    fs.writeFileSync(path.join(TEST_CLIPBOARD, "pano.txt"), String(text));
  } else clipboard.writeText(String(text));
  return { ok: true };
});

ipcMain.handle("vw:trash", async (_e, p) => {
  try {
    const file = String(p);
    if (!isImage(file)) throw new Error("Yalnızca resimler silinebilir.");
    if (TEST_TRASH) {
      await fsp.mkdir(TEST_TRASH, { recursive: true });
      await fsp.rename(file, path.join(TEST_TRASH, path.basename(file)));
    } else await shell.trashItem(file);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: describe(err) };
  }
});

const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
ipcMain.handle("vw:rename", async (_e, p, newName) => {
  const file = String(p);
  const name = String(newName).trim();
  if (!name) return { ok: false, error: "Ad boş olamaz." };
  if (/[<>:"/\\|?*\x00-\x1f]/.test(name)) return { ok: false, error: 'Ad şu karakterleri içeremez: \\ / : * ? " < > |' };
  if (/[. ]$/.test(name)) return { ok: false, error: "Ad nokta ya da boşlukla bitemez." };
  if (RESERVED.test(name)) return { ok: false, error: "Bu ad Windows'a ayrılmış." };
  const target = path.join(path.dirname(file), name);
  if (target === file) return { ok: true, path: file };
  try {
    // Only a change of letter case may land on the "same" file.
    if (target.toLowerCase() !== file.toLowerCase() && fs.existsSync(target)) throw Object.assign(new Error(), { code: "EEXIST" });
    await fsp.rename(file, target);
    return { ok: true, path: target };
  } catch (err) {
    return { ok: false, error: describe(err) };
  }
});

ipcMain.handle("vw:show-in-nav", (_e, p) => {
  const file = String(p);
  if (TEST_LAUNCH) {
    const found = fs.existsSync(NEURALNAV);
    fs.appendFileSync(TEST_LAUNCH, JSON.stringify({ exe: found ? NEURALNAV : "explorer", args: [file] }) + "\n");
    return { ok: true, via: found ? "NeuralNav" : "Explorer" };
  }
  if (fs.existsSync(NEURALNAV)) {
    try {
      const c = spawn(NEURALNAV, [file], { detached: true, stdio: "ignore" });
      c.on("error", () => {});
      c.unref();
      return { ok: true, via: "NeuralNav" };
    } catch (e) { /* falls back to Explorer */ }
  }
  shell.showItemInFolder(file);
  return { ok: true, via: "Explorer" };
});
ipcMain.handle("vw:has-nav", () => fs.existsSync(NEURALNAV));

// Saves a rotation. JPEG: only the EXIF orientation changes (lossless). Others: the page sends the rotated pixels,
// already encoded (PNG, WebP) or as RGBA for BMP. The file is replaced through a temporary file next to it.
ipcMain.handle("vw:save-rotation", async (_e, p, job) => {
  const file = String(p);
  try {
    let out;
    if (job.kind === "jpeg") {
      const buf = await fsp.readFile(file);
      out = meta.setJpegOrientation(buf, meta.rotateOrientation(meta.jpegOrientation(buf), Number(job.quarterTurns) || 0));
    } else if (job.kind === "bmp") {
      out = meta.encodeBmp(job.width, job.height, Buffer.from(job.rgba));
    } else if (job.kind === "encoded") {
      out = Buffer.from(job.bytes);
    } else throw new Error("Bu biçimde döndürme kaydedilemez.");
    const tmp = file + ".nvtmp";
    await fsp.writeFile(tmp, out);
    await fsp.rename(tmp, file);
    const st = await fsp.stat(file);
    return { ok: true, size: st.size, mtime: st.mtimeMs };
  } catch (err) {
    try { fs.rmSync(file + ".nvtmp", { force: true }); } catch (e) { /* nothing to clean */ }
    return { ok: false, error: describe(err) };
  }
});

/* ---------- app lifecycle ---------- */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_e, argv, cwd) => {
    const paths = pathsFromArgs(argv, cwd);
    if (!mainWin) { mainWin = createWindow(paths); return; }
    if (mainWin.isMinimized()) mainWin.restore();
    mainWin.show();
    mainWin.focus();
    if (!paths.length) return;
    if (mainWin.vw.loaded) mainWin.webContents.send("vw:open-paths", paths);
    else mainWin.vw.paths.push(...paths);
  });
  app.on("window-all-closed", () => app.quit());
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    registerProtocols();
    mainWin = createWindow(pathsFromArgs(process.argv, process.cwd()));
  });
}
