"use strict";
// NeuralDeck DK-0: a launcher and command palette that waits in the background. A global shortcut (Alt+Space by
// default) shows a panel at the top of the screen; it hides again on Esc or when it loses focus. The suggestions are
// built here (commands.js) and the page only sends back the number of the one to run, so the page itself cannot start
// anything. Started with --arka-plan (at sign-in) it stays hidden until the shortcut; started normally it shows the
// panel, and a second start shows the panel of the running one.
const { app, BrowserWindow, ipcMain, screen, Menu, Tray, globalShortcut, clipboard } = require("electron");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const commands = require("./commands");
// The series theme: next to main.js when installed, in apps\shared when run from source.
const { ThemeSync } = require(fs.existsSync(path.join(__dirname, "theme-sync.js")) ? "./theme-sync" : "../shared/theme-sync");

app.setAppUserModelId("NeuralDeck.DK0");
// Tests: a throwaway profile, a file that records what would be started or copied, and a folder of fake programs.
if (process.env.NEURALDECK_PROFILE) app.setPath("userData", process.env.NEURALDECK_PROFILE);
const TEST_LAUNCH = process.env.NEURALDECK_TEST_LAUNCH || "";
const BACKGROUND = process.argv.includes("--arka-plan");
const DEFAULT_SHORTCUT = "Alt+Space";
const WIDTH = 700;

// Another program of the series. Installed, it is next to this one (<root>\<Name>\Program\<Name>.exe); from source
// the usual installation is used. NEURAL_ROOT points tests at another root.
function exeOf(name) {
  if (process.env.NEURAL_ROOT) return path.join(process.env.NEURAL_ROOT, name, "Program", `${name}.exe`);
  const local = path.resolve(path.dirname(process.execPath), "..", "..", name, "Program", `${name}.exe`);
  if (app.isPackaged || fs.existsSync(local)) return local;
  return path.join(process.env.USERPROFILE || "", "Neural", name, "Program", `${name}.exe`);
}

/* ---------- small persistent files ---------- */
const dataPath = (name) => path.join(app.getPath("userData"), name);
function readJSON(name, fallback) {
  try { return JSON.parse(fs.readFileSync(dataPath(name), "utf8")); } catch (e) { return fallback; }
}
function writeJSON(name, value) {
  try {
    fs.mkdirSync(app.getPath("userData"), { recursive: true });
    fs.writeFileSync(dataPath(name + ".tmp"), JSON.stringify(value));
    fs.renameSync(dataPath(name + ".tmp"), dataPath(name));
  } catch (e) { /* not critical */ }
}
const settings = { shortcut: DEFAULT_SHORTCUT, ...readJSON("settings.json", {}) };
let recent = readJSON("recent.json", []).filter((r) => r && typeof r.path === "string");
function remember(p, kind) {
  recent = [{ path: p, kind }, ...recent.filter((r) => r.path.toLowerCase() !== p.toLowerCase())].slice(0, 20);
  writeJSON("recent.json", recent);
}

/* ---------- the panel ---------- */
let win = null;
let tray = null;
let shortcut = { accel: settings.shortcut, ok: false, error: "" };
let capturing = false;
let lastItems = [];
let ans = 0;
const themeSync = new ThemeSync({ name: "NeuralDeck", onChange: (t) => send("deck:theme", t) });
const seriesTheme = () => (themeSync.read() || {}).theme || "neon";
const send = (ch, v) => { if (win && !win.isDestroyed()) win.webContents.send(ch, v); };

function createPanel() {
  win = new BrowserWindow({
    width: WIDTH,
    height: 200,
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
    title: "NeuralDeck",
    icon: path.join(__dirname, "neuraldeck.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
  win.setAlwaysOnTop(true, "pop-up-menu");
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.setVisualZoomLevelLimits(1, 1);
  // A palette: clicking anywhere else puts it away.
  win.on("blur", () => { if (!capturing && !process.env.NEURALDECK_KEEP_OPEN) hidePanel(); });
  win.on("close", (e) => { if (!app.quitting) { e.preventDefault(); hidePanel(); } });
  win.loadFile(path.join(__dirname, "index.html"));
}

function placePanel(height) {
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const h = Math.max(120, Math.min(Math.round(height), d.height - 40));
  win.setBounds({ x: Math.round(d.x + (d.width - WIDTH) / 2), y: Math.round(d.y + d.height * 0.14), width: WIDTH, height: h });
}
function showPanel() {
  if (!win) return;
  placePanel(win.getBounds().height);
  win.show();
  win.focus();
  send("deck:shown", { theme: seriesTheme(), shortcut });
}
function hidePanel() {
  if (win && !win.isDestroyed() && win.isVisible()) { win.hide(); send("deck:hidden"); }
}
const togglePanel = () => (win && win.isVisible() && win.isFocused() ? hidePanel() : showPanel());

/* ---------- the global shortcut ---------- */
// Electron accelerators with at least one of Ctrl/Alt/Shift/Super, or a function key alone.
const ACCEL = /^((Ctrl|Alt|Shift|Super)\+)*(Space|[A-Z0-9]|F([1-9]|1[0-9]|2[0-4])|Tab|Enter|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Up|Down|Left|Right|Plus|Minus|Comma|Period)$/;
function validAccel(a) {
  return typeof a === "string" && ACCEL.test(a) && (/(Ctrl|Alt|Shift|Super)\+/.test(a) || /^F\d+$/.test(a));
}
function register(accel) {
  let ok = false;
  try { ok = validAccel(accel) && globalShortcut.register(accel, togglePanel); } catch (e) { ok = false; }
  return ok;
}
// Takes the new shortcut, or keeps the old one when the new one cannot be registered.
function setShortcut(accel, save) {
  const old = shortcut.accel;
  if (shortcut.ok) { try { globalShortcut.unregister(old); } catch (e) { /* was not registered */ } }
  if (register(accel)) {
    shortcut = { accel, ok: true, error: "" };
    if (save) { settings.shortcut = accel; writeJSON("settings.json", settings); }
  } else {
    const okOld = accel !== old && register(old);
    shortcut = { accel: okOld ? old : accel, ok: okOld, error: `${accel} kaydedilemedi: başka bir program bu kısayolu kullanıyor olabilir.` };
  }
  updateTray();
  return shortcut;
}
function updateTray() {
  if (!tray) return;
  tray.setToolTip(shortcut.ok ? `NeuralDeck DK-0 · ${shortcut.accel}` : "NeuralDeck DK-0 · kısayol kaydedilemedi");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: shortcut.ok ? `Paneli aç (${shortcut.accel})` : "Paneli aç", click: showPanel },
    { label: "Ayarlar…", click: () => { showPanel(); send("deck:open-settings"); } },
    { type: "separator" },
    { label: "Çıkış", click: () => { app.quitting = true; app.quit(); } },
  ]));
}

/* ---------- running a suggestion ---------- */
function launch(action) {
  const s = commands.toSpawn(action, exeOf);
  if (!s || !fs.existsSync(s.exe)) return { ok: false, error: "Bu program kurulu değil." };
  if (TEST_LAUNCH) {
    fs.appendFileSync(TEST_LAUNCH, JSON.stringify({ exe: s.exe, args: s.args }) + "\n");
  } else {
    try {
      const c = spawn(s.exe, s.args, { detached: true, stdio: "ignore" }); // no shell: the arguments are passed as they are
      c.on("error", () => {});
      c.unref();
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }
  const arg = s.args.find((a) => a !== "--");
  if (arg && /^[a-z]:\\/i.test(arg)) remember(arg, action.app === "NeuralNav" || action.app === "NeuralTerm" ? "dir" : "file");
  return { ok: true, hide: true };
}
function execute(item) {
  const a = item.action;
  switch (a.type) {
    case "launch": return launch(a);
    case "copy":
      if (TEST_LAUNCH) fs.appendFileSync(TEST_LAUNCH, JSON.stringify({ copy: a.text }) + "\n");
      else clipboard.writeText(a.text);
      if (Number.isFinite(a.value)) ans = a.value;
      return { ok: true, hide: true, toast: `${a.text} panoya kopyalandı` };
    case "theme":
      themeSync.write(a.theme);
      send("deck:theme", a.theme);
      return { ok: true, hide: false, toast: "Serinin teması değişti" };
    case "settings": return { ok: true, view: "settings" };
    case "complete": return { ok: true, complete: item.complete };
    default: return { ok: false };
  }
}

/* ---------- IPC ---------- */
const fromPanel = (e) => win && e.sender === win.webContents;
ipcMain.handle("deck:query", (e, text) => {
  if (!fromPanel(e)) return [];
  const env = { installed: (id) => fs.existsSync(exeOf(id)), home: app.getPath("home"), vars: process.env, recent, ans, theme: seriesTheme() };
  try { lastItems = commands.suggest(String(text || ""), env); } catch (err) { lastItems = []; }
  return lastItems.map(({ title, detail, chip, disabled, complete }) => ({ title, detail, chip, disabled: !!disabled, complete: complete || "" }));
});
// The page names a suggestion by its number in the last list; nothing else it sends is run.
ipcMain.handle("deck:run", (e, index) => {
  if (!fromPanel(e)) return { ok: false };
  const item = Number.isInteger(index) ? lastItems[index] : null;
  if (!item || item.disabled) return { ok: false };
  const r = execute(item);
  if (r.hide) hidePanel();
  return r;
});
ipcMain.on("deck:hide", (e) => { if (fromPanel(e)) hidePanel(); });
ipcMain.on("deck:resize", (e, height) => { if (fromPanel(e) && win.isVisible()) placePanel(Number(height) || 200); else if (fromPanel(e)) win.setSize(WIDTH, Math.max(120, Math.round(Number(height) || 200))); });
ipcMain.handle("deck:state", (e) => (fromPanel(e) ? { shortcut, theme: seriesTheme(), background: BACKGROUND, visible: win.isVisible() } : null));
ipcMain.handle("deck:capture", (e, on) => {
  if (!fromPanel(e)) return shortcut;
  capturing = !!on;
  if (capturing) { if (shortcut.ok) { try { globalShortcut.unregister(shortcut.accel); } catch (err) { /* gone */ } } shortcut = { ...shortcut, ok: false }; }
  else if (!shortcut.ok) setShortcut(settings.shortcut, false);
  return shortcut;
});
ipcMain.handle("deck:set-shortcut", (e, accel) => {
  if (!fromPanel(e)) return shortcut;
  capturing = false;
  if (!validAccel(accel)) {
    setShortcut(settings.shortcut, false);
    return { ...shortcut, error: "Bu tuş birleşimi kullanılamaz: Ctrl, Alt, Shift ya da Win ile birlikte bir tuş seç." };
  }
  return setShortcut(accel, true);
});

/* ---------- app lifecycle ---------- */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_e, argv) => { if (!argv.includes("--arka-plan")) showPanel(); });
  app.on("window-all-closed", () => { /* keeps running in the background */ });
  app.on("will-quit", () => { globalShortcut.unregisterAll(); themeSync.stop(); });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    themeSync.start();
    createPanel();
    tray = new Tray(path.join(__dirname, "neuraldeck.ico"));
    tray.on("click", togglePanel);
    setShortcut(settings.shortcut, false);
    win.webContents.once("did-finish-load", () => {
      if (!BACKGROUND) showPanel();
      else if (!shortcut.ok) {
        tray.displayBalloon({ iconType: "warning", title: "NeuralDeck", content: `${shortcut.accel} kısayolu kaydedilemedi. Tepsideki NeuralDeck simgesinden Ayarlar'ı açıp başka bir kısayol seç.` });
      }
    });
  });
}
