"use strict";
// NeuralNav NV-4 desktop shell: frameless transparent windows shaped by the page, file system access,
// copy/move jobs with conflict questions, shell integration (open, open with, recycle bin, terminal).
const { app, BrowserWindow, ipcMain, screen, Menu, shell, nativeImage } = require("electron");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const ops = require("./ops");
// The series theme: next to main.js when installed, in apps\shared when run from source.
const themeSync = require(fs.existsSync(path.join(__dirname, "theme-sync.js")) ? "./theme-sync" : "../shared/theme-sync");

app.setAppUserModelId("NeuralNav.NV4");

const MIN_W = 680;
const MIN_H = 420;
const helper = new ops.Helper(path.join(__dirname, "nvhelper.exe"));
// Another program of the series: <root>\<Name>\Program\<Name>.exe, next to wherever this one was installed.
function sibling(name) {
  const local = path.resolve(path.dirname(process.execPath), "..", "..", name, "Program", `${name}.exe`);
  return fs.existsSync(local) ? local : path.join(process.env.USERPROFILE || "", "Neural", name, "Program", `${name}.exe`);
}
const NEURALPAD = sibling("NeuralPad");
const NEURALVIEW = sibling("NeuralView");
const WT = path.join(process.env.LOCALAPPDATA || "", "Microsoft", "WindowsApps", "wt.exe");

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

// As the default for folders, NeuralNav also receives Windows' virtual folders ("::{GUID}", "shell:...").
// This PC opens in NeuralNav's own view; the rest (Control Panel, Recycle Bin, libraries) go back to Windows Explorer.
const THIS_PC = ["::{20d04fe0-3aea-1069-a2d8-08002b30309d}", "shell:mycomputerfolder"];
let forwardedVirtual = false;
function pathsFromArgs(argv, cwd) {
  const out = [];
  for (const raw of argv.slice(app.isPackaged ? 1 : 2)) {
    if (!raw || raw.startsWith("-")) continue;
    const a = raw.replace(/^"(.*)"$/, "$1");
    if (a.startsWith("::") || /^shell:/i.test(a)) {
      if (THIS_PC.includes(a.toLowerCase())) out.push("pc");
      else { detached("explorer.exe", [a]); forwardedVirtual = true; }
      continue;
    }
    const p = path.resolve(cwd || process.cwd(), a);
    if (fs.existsSync(p)) out.push(p);
  }
  return out;
}

/* ---------- bounds, maximize, resize (same model as NeuralPad) ---------- */
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
  const s = win.nv;
  writeJSON("window.json", { bounds: s.maximized ? s.restore : win.getBounds(), maximized: s.maximized });
}
function setMaximized(win, on) {
  const s = win.nv;
  if (s.maximized === on) return;
  if (on) {
    s.restore = win.getBounds();
    win.setBounds(screen.getDisplayMatching(s.restore).workArea);
  } else {
    win.setBounds(onScreen(s.restore) ? s.restore : defaultBounds());
  }
  s.maximized = on;
  win.webContents.send("nv:maximized", on);
  saveState(win);
}
function startResize(win, edge) {
  if (win.nv.maximized || !/^(n|s|e|w|ne|nw|se|sw)$/.test(edge)) return;
  stopResize(win);
  const r = { edge, from: win.getBounds(), cursor: screen.getCursorScreenPoint(), last: null };
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
  win.nv.resizing = r;
}
function stopResize(win) {
  const r = win.nv && win.nv.resizing;
  if (!r) return;
  clearInterval(r.timer);
  win.nv.resizing = null;
  saveState(win);
}

/* ---------- windows ---------- */
function createWindow({ extra = false, paths = [] } = {}) {
  const saved = extra ? null : readJSON("window.json");
  let bounds = saved && onScreen(saved.bounds) ? saved.bounds : defaultBounds();
  if (extra) {
    const ref = BrowserWindow.getFocusedWindow() || mainWin;
    if (ref && !ref.nv.maximized) {
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
    title: "NeuralNav",
    icon: path.join(__dirname, "neuralnav.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.nv = { extra, paths: [...paths], loaded: false, maximized: false, restore: null, allowClose: false, resizing: null };

  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.on("did-finish-load", () => { win.nv.loaded = true; });
  win.webContents.setVisualZoomLevelLimits(1, 1);

  win.once("ready-to-show", () => {
    if (!extra && saved && saved.maximized) setMaximized(win, true);
    win.show();
  });
  // Closing during a copy or move asks first; otherwise windows close at once.
  win.on("close", (e) => {
    if (win.nv.allowClose) return;
    const running = [...jobs.values()].some((j) => j.sender === win.webContents);
    if (!running) return;
    e.preventDefault();
    win.webContents.send("nv:close-request");
  });
  win.on("moved", () => {
    const s = win.nv;
    if (s.maximized && s.restore) {
      const b = win.getBounds();
      s.maximized = false;
      win.setBounds({ x: b.x, y: b.y, width: s.restore.width, height: s.restore.height });
      win.webContents.send("nv:maximized", false);
    }
    saveState(win);
  });
  win.on("blur", () => stopResize(win));
  const wcId = win.webContents.id;
  win.on("closed", () => {
    stopWatch(wcId);
    for (const j of jobs.values()) if (j.senderId === wcId) j.ac.abort();
    if (mainWin === win) mainWin = null;
  });

  win.loadFile(path.join(__dirname, "index.html"), extra ? { query: { yeni: "1" } } : undefined);
  return win;
}

const winOf = (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  return w && !w.isDestroyed() ? w : null;
};
const send = (wc, channel, payload) => { if (wc && !wc.isDestroyed()) wc.send(channel, payload); };

/* ---------- window IPC ---------- */
ipcMain.on("nv:minimize", (e) => { const w = winOf(e); if (w) w.minimize(); });
ipcMain.on("nv:toggle-max", (e) => { const w = winOf(e); if (w) setMaximized(w, !w.nv.maximized); });
ipcMain.on("nv:close", (e) => { const w = winOf(e); if (w) w.close(); });
ipcMain.on("nv:close-confirm", (e) => {
  const w = winOf(e);
  if (!w) return;
  w.nv.allowClose = true;
  w.close();
});
ipcMain.on("nv:resize-start", (e, edge) => { const w = winOf(e); if (w) startResize(w, String(edge)); });
ipcMain.on("nv:resize-end", (e) => { const w = winOf(e); if (w) stopResize(w); });
ipcMain.on("nv:new-window", (_e, p) => { createWindow({ extra: true, paths: p ? [String(p)] : [] }); });
ipcMain.handle("nv:pending-paths", (e) => {
  const w = winOf(e);
  if (!w) return [];
  const p = w.nv.paths;
  w.nv.paths = [];
  return p;
});
ipcMain.handle("nv:session-load", () => readJSON("session.json"));
ipcMain.on("nv:session-save", (e, data) => { if (winOf(e) === mainWin) writeJSON("session.json", data); });

/* ---------- places and listing ---------- */
const KNOWN = ["desktop", "downloads", "documents", "pictures", "music", "videos"];
async function fallbackDrives() {
  const out = [];
  for (const letter of "CDEFGHIJKLMNOPQRSTUVWXYZ") {
    const root = letter + ":\\";
    try {
      const s = await fsp.statfs(root);
      out.push({ root, type: "Fixed", label: "", total: s.blocks * s.bsize, free: s.bavail * s.bsize, ready: true });
    } catch (e) { /* no such drive */ }
  }
  return out;
}
ipcMain.handle("nv:places", async () => {
  const known = [];
  for (const key of KNOWN) { try { known.push({ key, path: app.getPath(key) }); } catch (e) { /* not available */ } }
  let drives;
  try { drives = await helper.call("drives"); } catch (e) { drives = await fallbackDrives(); }
  return { home: app.getPath("home"), known, drives, neuralPad: fs.existsSync(NEURALPAD), neuralView: fs.existsSync(NEURALVIEW) };
});

ipcMain.handle("nv:list", async (_e, dir) => {
  try {
    let d = path.resolve(String(dir));
    if (/^[a-z]:$/i.test(d)) d += "\\";
    const st = await fsp.stat(d);
    if (!st.isDirectory()) return { ok: false, error: "Bu bir klasör değil." };
    return { ok: true, dir: d, entries: await ops.listDir(helper, d) };
  } catch (err) {
    return { ok: false, error: ops.describe(err) };
  }
});

ipcMain.handle("nv:resolve", async (_e, input, base) => {
  let s = String(input || "").trim().replace(/^"(.*)"$/, "$1");
  s = s.replace(/%([^%]+)%/g, (m, k) => {
    const key = Object.keys(process.env).find((x) => x.toLowerCase() === k.toLowerCase());
    return key ? process.env[key] : m;
  });
  if (s === "~" || /^~[\\/]/.test(s)) s = path.join(app.getPath("home"), s.slice(1));
  if (/^[a-z]:$/i.test(s)) s += "\\";
  const full = path.resolve(base || app.getPath("home"), s);
  try {
    const st = await fsp.stat(full);
    return { ok: true, path: full, isDir: st.isDirectory() };
  } catch (err) {
    return { ok: false, error: ops.describe(err) };
  }
});

ipcMain.handle("nv:stat", async (_e, p) => {
  try {
    const st = await fsp.stat(p);
    let attrs = 0;
    try { attrs = await helper.call("attrs", p); } catch (e) { /* attributes unknown */ }
    return { ok: true, isDir: st.isDirectory(), size: st.size, mtime: st.mtimeMs, ctime: st.birthtimeMs, atime: st.atimeMs, attrs };
  } catch (err) {
    return { ok: false, error: ops.describe(err) };
  }
});

/* ---------- opening things ---------- */
const detached = (cmd, args, opts = {}) => {
  try {
    const p = spawn(cmd, args, { detached: true, stdio: "ignore", ...opts });
    p.on("error", () => {});
    p.unref();
    return true;
  } catch (e) {
    return false;
  }
};
ipcMain.handle("nv:open", async (_e, p) => (await shell.openPath(String(p))) || "");
ipcMain.handle("nv:read-link", (_e, p) => {
  try { return shell.readShortcutLink(String(p)).target || ""; } catch (e) { return ""; }
});
// rundll32 takes the rest of its command line as the path, so it is passed unquoted.
ipcMain.on("nv:open-with", (_e, p) => {
  detached("rundll32.exe", ["shell32.dll,OpenAs_RunDLL " + String(p)], { windowsVerbatimArguments: true });
});
ipcMain.handle("nv:open-neuralpad", (_e, paths) => fs.existsSync(NEURALPAD) && detached(NEURALPAD, paths.map(String)));
// NeuralView shows one image at a time and steps through its folder, so only the first selected image is passed.
ipcMain.handle("nv:open-neuralview", (_e, p) => fs.existsSync(NEURALVIEW) && detached(NEURALVIEW, [String(p)]));
const NEURALTERM = sibling("NeuralTerm");
ipcMain.on("nv:open-terminal", (_e, dir) => {
  const d = String(dir);
  if (fs.existsSync(NEURALTERM)) detached(NEURALTERM, [d]);
  else if (fs.existsSync(WT)) detached(WT, ["-d", d]);
  else detached("powershell.exe", ["-NoExit"], { cwd: d });
});
/* ---------- background watcher that hands new Explorer windows to NeuralNav ---------- */
const WATCH_EXE = path.join(__dirname, "nvwatch.exe");
const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const RUN_VALUE = "NeuralNavWatch";
// Tells the watcher that the next Explorer window is wanted.
function allowExplorer() {
  try {
    fs.mkdirSync(app.getPath("userData"), { recursive: true });
    fs.writeFileSync(dataPath("explorer-allow"), String(Date.now()));
  } catch (e) { /* not critical */ }
}
function watcherEnabled() {
  const r = spawnSync("reg.exe", ["query", RUN_KEY, "/v", RUN_VALUE], { windowsHide: true });
  return r.status === 0;
}
ipcMain.handle("nv:watcher-get", () => ({ available: fs.existsSync(WATCH_EXE), enabled: watcherEnabled() }));
ipcMain.handle("nv:watcher-set", (_e, on) => {
  if (on) {
    spawnSync("reg.exe", ["add", RUN_KEY, "/v", RUN_VALUE, "/t", "REG_SZ", "/d", `"${WATCH_EXE}"`, "/f"], { windowsHide: true });
    detached(WATCH_EXE, []);
  } else {
    spawnSync("reg.exe", ["delete", RUN_KEY, "/v", RUN_VALUE, "/f"], { windowsHide: true });
    spawnSync("taskkill.exe", ["/im", "nvwatch.exe", "/f"], { windowsHide: true });
  }
  return watcherEnabled();
});

ipcMain.on("nv:show-in-explorer", (_e, p) => {
  const s = String(p);
  allowExplorer();
  // explorer.exe by name: when NeuralNav is the default for folders, shell.openPath would come back here.
  if (fs.existsSync(s) && fs.statSync(s).isDirectory()) detached("explorer.exe", [s]);
  else shell.showItemInFolder(s);
});
ipcMain.on("nv:open-recycle", () => { detached("explorer.exe", ["shell:RecycleBinFolder"]); });

/* ---------- changes ---------- */
ipcMain.handle("nv:trash", async (_e, paths) => {
  const failed = [];
  for (const p of paths) {
    try { await shell.trashItem(String(p)); } catch (err) { failed.push({ path: p, message: ops.describe(err) }); }
  }
  return { failed };
});
ipcMain.handle("nv:delete-permanent", async (_e, paths) => {
  const failed = [];
  for (const p of paths) {
    try { await fsp.rm(String(p), { recursive: true, force: false }); } catch (err) { failed.push({ path: p, message: ops.describe(err) }); }
  }
  return { failed };
});
ipcMain.handle("nv:rename", async (_e, p, newName) => {
  const bad = ops.invalidName(newName);
  if (bad) return { ok: false, error: bad };
  const src = String(p);
  const dest = path.join(path.dirname(src), newName);
  if (dest === src) return { ok: true, path: src };
  if (!ops.samePath(dest, src) && (await ops.lstatOrNull(dest))) return { ok: false, error: "Bu konumda aynı adlı bir öğe zaten var." };
  try {
    await fsp.rename(src, dest);
    return { ok: true, path: dest };
  } catch (err) {
    return { ok: false, error: ops.describe(err) };
  }
});
ipcMain.handle("nv:create", async (_e, dir, base, kind) => {
  try {
    const isDir = kind === "dir";
    const name = await ops.uniqueName(String(dir), base, isDir);
    const p = path.join(String(dir), name);
    if (isDir) await fsp.mkdir(p);
    else await fsp.writeFile(p, "", { flag: "wx" });
    return { ok: true, path: p };
  } catch (err) {
    return { ok: false, error: ops.describe(err) };
  }
});

/* ---------- copy / move jobs ---------- */
const jobs = new Map();
let askSeq = 0;
ipcMain.on("nv:transfer", (e, id, op, sources, destDir) => {
  if (jobs.has(id)) return;
  const sender = e.sender;
  const job = { id, sender, senderId: sender.id, ac: new AbortController(), asks: new Map() };
  jobs.set(id, job);
  let last = 0;
  const post = (payload) => send(sender, "nv:job", { id, ...payload });
  post({ state: "start", op, count: sources.length, destDir });
  ops.transfer({
    op: op === "move" ? "move" : "copy",
    sources: sources.map(String),
    destDir: String(destDir),
    signal: job.ac.signal,
    progress: (p) => {
      const now = Date.now();
      if (now - last > 120) { last = now; post({ state: "progress", ...p }); }
    },
    ask: (c) => new Promise((resolve) => {
      const reqId = ++askSeq;
      job.asks.set(reqId, resolve);
      post({ state: "conflict", reqId, ...c });
    }),
  })
    .then((result) => post({ state: result.cancelled ? "cancelled" : "done", result }))
    .catch((err) => post({ state: err.name === "AbortError" ? "cancelled" : "error", message: ops.describe(err) }))
    .finally(() => jobs.delete(id));
});
ipcMain.on("nv:conflict-reply", (_e, jobId, reqId, decision) => {
  const j = jobs.get(jobId);
  const resolve = j && j.asks.get(reqId);
  if (!resolve) return;
  j.asks.delete(reqId);
  resolve(decision);
});
ipcMain.on("nv:job-cancel", (_e, jobId) => {
  const j = jobs.get(jobId);
  if (!j) return;
  j.ac.abort();
  for (const resolve of j.asks.values()) resolve({ action: "cancel" });
  j.asks.clear();
});

/* ---------- clipboard (shared with Windows Explorer through the helper) ---------- */
let localClip = { op: null, paths: [] };
ipcMain.handle("nv:clip-set", async (_e, op, paths) => {
  localClip = { op, paths };
  try { await helper.call("clip-set", op, ...paths); return true; } catch (e) { return false; }
});
ipcMain.handle("nv:clip-get", async () => {
  try { return await helper.call("clip-get"); } catch (e) { return localClip; }
});
ipcMain.handle("nv:clip-clear", async () => {
  localClip = { op: null, paths: [] };
  try { await helper.call("clip-clear"); } catch (e) { /* nothing to clear */ }
  return true;
});

/* ---------- pictures: thumbnails, native icons, drag image ---------- */
ipcMain.handle("nv:thumb", async (_e, p, size) => {
  try {
    const img = await nativeImage.createThumbnailFromPath(String(p), { width: size, height: size });
    return img.isEmpty() ? null : img.toDataURL();
  } catch (e) {
    return null;
  }
});
ipcMain.handle("nv:icon", async (_e, p, size) => {
  try {
    const img = await app.getFileIcon(String(p), { size: size === "large" ? "large" : "normal" });
    return img.isEmpty() ? null : img.toDataURL();
  } catch (e) {
    return null;
  }
});
let dragIcon = null;
ipcMain.on("nv:start-drag", (e, paths) => {
  const files = paths.map(String).filter((p) => fs.existsSync(p));
  if (!files.length) return;
  if (!dragIcon) dragIcon = nativeImage.createFromPath(path.join(__dirname, "icon.png")).resize({ width: 40, height: 40 });
  e.sender.startDrag({ file: files[0], files, icon: dragIcon });
});

ipcMain.handle("nv:preview-text", async (_e, p) => {
  let fh;
  try {
    fh = await fsp.open(String(p), "r");
    const buf = Buffer.alloc(65536);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    return { ok: true, bytes: buf.subarray(0, bytesRead), truncated: bytesRead === buf.length };
  } catch (err) {
    return { ok: false, error: ops.describe(err) };
  } finally {
    if (fh) await fh.close();
  }
});

/* ---------- folder size, search ---------- */
const sizeJobs = new Map();
ipcMain.handle("nv:folder-size", async (e, token, p) => {
  const ac = new AbortController();
  sizeJobs.set(token, ac);
  try {
    return { ok: true, ...(await ops.folderSize(String(p), { signal: ac.signal, onProgress: (acc) => send(e.sender, "nv:size-progress", { token, ...acc }) })) };
  } catch (err) {
    return { ok: false, error: err.name === "AbortError" ? "" : ops.describe(err) };
  } finally {
    sizeJobs.delete(token);
  }
});
ipcMain.on("nv:size-cancel", (_e, token) => { const ac = sizeJobs.get(token); if (ac) ac.abort(); });

const searches = new Map();
ipcMain.on("nv:search", (e, token, root, query) => {
  const ac = new AbortController();
  searches.set(token, ac);
  ops.search({
    root: String(root),
    query: String(query),
    signal: ac.signal,
    onBatch: (items) => send(e.sender, "nv:search-results", { token, items }),
  })
    .then((r) => send(e.sender, "nv:search-results", { token, items: [], done: true, truncated: r.truncated }))
    .catch(() => send(e.sender, "nv:search-results", { token, items: [], done: true, cancelled: true }))
    .finally(() => searches.delete(token));
});
ipcMain.on("nv:search-cancel", (_e, token) => { const ac = searches.get(token); if (ac) ac.abort(); });

/* ---------- watching the open folder ---------- */
const watchers = new Map();
function stopWatch(id) {
  const w = watchers.get(id);
  if (!w) return;
  clearTimeout(w.timer);
  try { w.watcher.close(); } catch (e) { /* already closed */ }
  watchers.delete(id);
}
ipcMain.on("nv:watch", (e, dir) => {
  const id = e.sender.id;
  stopWatch(id);
  if (!dir) return;
  try {
    const entry = { timer: null, watcher: null };
    entry.watcher = fs.watch(String(dir), { persistent: false }, () => {
      clearTimeout(entry.timer);
      entry.timer = setTimeout(() => send(e.sender, "nv:changed", String(dir)), 300);
    });
    entry.watcher.on("error", () => stopWatch(id));
    watchers.set(id, entry);
  } catch (err) { /* folder cannot be watched */ }
});

/* ---------- app lifecycle ---------- */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Launching again opens a new window, like Explorer; a path argument opens in a new tab instead.
  app.on("second-instance", (_e, argv, cwd) => {
    forwardedVirtual = false;
    const paths = pathsFromArgs(argv, cwd);
    if (!paths.length && forwardedVirtual) return;
    if (!mainWin) { mainWin = createWindow({ paths }); return; }
    if (!paths.length) { createWindow({ extra: true }); return; }
    if (mainWin.isMinimized()) mainWin.restore();
    mainWin.show();
    mainWin.focus();
    if (mainWin.nv.loaded) send(mainWin.webContents, "nv:open-paths", paths);
    else mainWin.nv.paths.push(...paths);
  });
  app.on("window-all-closed", () => { helper.stop(); app.quit(); });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    const paths = pathsFromArgs(process.argv, process.cwd());
    if (!paths.length && forwardedVirtual) { app.quit(); return; }
    themeSync.wire({ ipcMain, BrowserWindow, prefix: "nv", name: "NeuralNav" });
    mainWin = createWindow({ paths });
  });
}
