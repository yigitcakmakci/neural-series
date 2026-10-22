"use strict";
// NeuralWeb NW-1. Each window = a frameless transparent BrowserWindow whose own page is the Neural UI
// (ui/index.html); every tab is a sandboxed WebContentsView laid over the UI's viewport; a transparent overlay
// view on top draws menus, suggestions and prompts so they can cover the page.
const { app, BrowserWindow, WebContentsView, ipcMain, session, protocol, screen, Menu, shell, clipboard, dialog } = require("electron");
const fs = require("fs");
const path = require("path");
const { Store, hostOf } = require("./store");
const { Shield, bareHost } = require("./shield");
const { Vault, originOf: loginOrigin } = require("./passwords");

app.setAppUserModelId("NeuralWeb.NW1");
// Tests run against a throwaway profile.
if (process.env.NEURALWEB_PROFILE) app.setPath("userData", process.env.NEURALWEB_PROFILE);
protocol.registerSchemesAsPrivileged([{ scheme: "neural", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const CHROME_MAJOR = process.versions.chrome.split(".")[0];
app.userAgentFallback = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_MAJOR}.0.0.0 Safari/537.36`;

const MIN_W = 640;
const MIN_H = 420;
const NEWTAB = "neural://newtab/";
const PAGES = new Set(["newtab", "history", "bookmarks", "downloads", "settings", "passwords"]);
const HELPERS = { dpapi: path.join(__dirname, "nwdpapi.exe"), hello: path.join(__dirname, "nwhello.exe") };
const PAGES_DIR = path.join(__dirname, "pages");
const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
// NeuralNav from the same installation (<root>\NeuralNav\Program), wherever the setup put the series.
const NEURALNAV = (() => {
  const local = path.resolve(path.dirname(process.execPath), "..", "..", "NeuralNav", "Program", "NeuralNav.exe");
  return fs.existsSync(local) ? local : path.join(process.env.USERPROFILE || "", "Neural", "NeuralNav", "Program", "NeuralNav.exe");
})();

let store = null;
let shield = null;
let vault = null;
let lastCsv = null; // the password CSV last imported, which the passwords page may move to the recycle bin
const windows = new Set();
let winSeq = 0;
let tabSeq = 0;
let popupSeq = 0;
let privateSeq = 0;
const closedTabs = [];
const downloadItems = new Map();
const privateDownloads = [];
const privatePermissions = new Map();
const privateCertExceptions = new Set();

/* ============================================================ helpers */
const isInternal = (url) => /^neural:/i.test(url || "");
const isNewTab = (url) => /^neural:\/\/newtab\/?$/i.test(url || "");
function securityOf(url) {
  if (!url || isInternal(url)) return "internal";
  if (/^https:/i.test(url)) return "secure";
  if (/^http:/i.test(url)) return "insecure";
  if (/^file:/i.test(url)) return "file";
  return "other";
}
const send = (wc, channel, payload) => { if (wc && !wc.isDestroyed()) wc.send(channel, payload); };

// What the address bar does with typed text: a URL when it looks like one, otherwise a Google search.
function resolveInput(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  if (/^javascript:/i.test(t)) return null;
  if (/^(https?|file|neural|about|view-source|data):/i.test(t)) return t;
  if (/^[a-z]:[\\/]/i.test(t)) return "file:///" + t.replace(/\\/g, "/");
  if (/^(localhost|\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:]+\])(:\d+)?([/?#].*)?$/i.test(t)) return "http://" + t;
  if (!/\s/.test(t) && /^[^/?#]+\.[a-z¡-￿]{2,}(:\d+)?([/?#].*)?$/i.test(t)) return "https://" + t;
  return googleSearch(t);
}
const googleSearch = (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}&ie=UTF-8`;

/* ============================================================ internal pages (neural://) */
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };
// neural://history/ is pages/history.html; any other path on a page host is a shared file from pages/ (pages.css, history.js…).
const PAGE_CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'";
async function servePage(request) {
  const u = new URL(request.url);
  if (!PAGES.has(u.hostname)) return new Response("Bulunamadı", { status: 404 });
  const rel = u.pathname === "/" || u.pathname === "" ? `${u.hostname}.html` : decodeURIComponent(u.pathname).replace(/^\/+/, "");
  const file = path.normalize(path.join(PAGES_DIR, rel));
  if (!file.startsWith(PAGES_DIR + path.sep)) return new Response("Bulunamadı", { status: 404 });
  try {
    const data = await fs.promises.readFile(file);
    return new Response(data, { headers: {
      "content-type": MIME[path.extname(file)] || "application/octet-stream",
      "cache-control": "no-store",
      "x-frame-options": "DENY",
      "content-security-policy": PAGE_CSP,
    } });
  } catch (e) {
    return new Response("Bulunamadı", { status: 404 });
  }
}

/* ============================================================ sessions, permissions */
const configured = new WeakSet();
function setupSession(ses, priv) {
  if (configured.has(ses)) return;
  configured.add(ses);
  ses.protocol.handle("neural", servePage);
  ses.setUserAgent(app.userAgentFallback);
  // The tab preload belongs to the session rather than to each tab, so popups opened by pages get it too
  // (a tab's webPreferences preload does not reach them).
  ses.registerPreloadScript({ type: "frame", id: "neuralweb-page", filePath: path.join(__dirname, "preload-page.js") });
  ses.setPermissionRequestHandler((wc, permission, callback, details) => onPermissionRequest(wc, permission, callback, details, priv));
  ses.setPermissionCheckHandler((wc, permission, origin) => permissionCheck(permission, origin, priv));
  ses.on("will-download", (e, item, wc) => onDownload(item, wc, priv));
  shield.attach(ses, priv);
  try {
    const langs = ["tr", "en-US"].filter((l) => ses.availableSpellCheckerLanguages.includes(l));
    if (langs.length) ses.setSpellCheckerLanguages(langs);
  } catch (e) { /* spellchecker unavailable */ }
}

const ALWAYS = new Set(["fullscreen", "clipboard-sanitized-write", "pointerLock", "keyboardLock"]);
const ASK = {
  media: "kamera ve mikrofonunu kullanmak",
  geolocation: "konumunu öğrenmek",
  notifications: "bildirim göndermek",
  "clipboard-read": "panodaki metni okumak",
  midi: "MIDI cihazlarını kullanmak",
  midiSysex: "MIDI cihazlarını tam erişimle kullanmak",
  openExternal: "bir bağlantıyı Windows'taki başka bir uygulamada açmak",
};
const originOf = (url) => { try { return new URL(url).origin; } catch (e) { return ""; } };
function permStore(priv) {
  if (priv) return { get: (o, p) => privatePermissions.get(`${o}|${p}`), set: (o, p, v) => privatePermissions.set(`${o}|${p}`, v) };
  return {
    get: (o, p) => (store.s.permissions[o] || {})[p],
    set: (o, p, v) => { store.s.permissions[o] = { ...(store.s.permissions[o] || {}), [p]: v }; store.settings.save(); },
  };
}
function permissionCheck(permission, origin, priv) {
  if (ALWAYS.has(permission)) return true;
  return permStore(priv).get(originOf(origin), permission) === "allow";
}
function onPermissionRequest(wc, permission, callback, details, priv) {
  if (ALWAYS.has(permission)) return callback(true);
  if (!ASK[permission]) return callback(false);
  const origin = originOf(details.requestingUrl || (wc && wc.getURL()));
  const ps = permStore(priv);
  if (permission !== "openExternal") {
    const saved = ps.get(origin, permission);
    if (saved) return callback(saved === "allow");
  }
  const found = wc && findTab(wc);
  if (!found) return callback(false);
  let what = ASK[permission];
  if (permission === "media" && Array.isArray(details.mediaTypes)) {
    what = details.mediaTypes.includes("video") && details.mediaTypes.includes("audio") ? "kamera ve mikrofonunu kullanmak" : details.mediaTypes.includes("video") ? "kamerasını kullanmak" : "mikrofonunu kullanmak";
  }
  const host = hostOf(origin) || origin || "Bu sayfa";
  const extra = permission === "openExternal" && details.externalURL ? `\n${String(details.externalURL).slice(0, 120)}` : "";
  queuePrompt(found.w, {
    title: `${host} şunu istiyor:`,
    text: `Bu bilgisayarın ${what}.${extra}`,
    icon: permission,
    buttons: [{ id: "block", label: "Engelle" }, { id: "allow", label: "İzin ver", primary: true }],
  }, (choice) => {
    const allow = choice === "allow";
    if (choice && permission !== "openExternal") ps.set(origin, permission, allow ? "allow" : "block");
    callback(allow);
  });
}

/* ============================================================ windows */
function onScreen(b) {
  return !!b && screen.getAllDisplays().some(({ workArea: a }) =>
    b.x < a.x + a.width - 60 && b.x + b.width > a.x + 60 && b.y >= a.y - 8 && b.y < a.y + a.height - 60);
}
function defaultBounds() {
  const a = screen.getPrimaryDisplay().workArea;
  const width = Math.max(MIN_W, Math.min(1320, a.width - 60));
  const height = Math.max(MIN_H, Math.min(860, a.height - 40));
  return { x: Math.round(a.x + (a.width - width) / 2), y: Math.round(a.y + (a.height - height) / 2), width, height };
}
function nextBounds() {
  const ref = BrowserWindow.getFocusedWindow();
  if (ref && ref.nw && !ref.nw.maximized) {
    const b = ref.getBounds();
    const s = { x: b.x + 32, y: b.y + 32, width: b.width, height: b.height };
    if (onScreen(s)) return s;
  }
  return defaultBounds();
}

function createWindow({ priv = false, urls = null, bounds = null, maximized = false, tabs = null, active = 0 } = {}) {
  const partition = priv ? `nw-private-${++privateSeq}` : "persist:neuralweb";
  const ses = session.fromPartition(partition);
  setupSession(ses, priv);
  const b = bounds && onScreen(bounds) ? bounds : nextBounds();
  const win = new BrowserWindow({
    x: b.x, y: b.y, width: Math.max(MIN_W, b.width), height: Math.max(MIN_H, b.height),
    show: false, frame: false, transparent: true, backgroundColor: "#00000000", hasShadow: false,
    resizable: false, maximizable: false, fullscreenable: true,
    title: "NeuralWeb", icon: path.join(__dirname, "neuralweb.ico"),
    webPreferences: { preload: path.join(__dirname, "preload-ui.js"), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  const w = { id: ++winSeq, win, priv, partition, ses, tabs: [], activeId: null, layout: null, popup: null, prompts: [], fullscreen: false, maximized: false, restore: null, resizing: null, statePending: false };
  win.nw = w;
  windows.add(w);

  const overlay = new WebContentsView({ webPreferences: { preload: path.join(__dirname, "preload-ui.js"), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false } });
  overlay.setBackgroundColor("#00000000");
  overlay.setVisible(false);
  overlay.webContents.loadFile(path.join(__dirname, "ui", "popup.html"));
  overlay.webContents.on("before-input-event", (e, input) => { if (handleShortcut(w, input)) e.preventDefault(); });
  win.contentView.addChildView(overlay);
  w.overlay = overlay;

  win.webContents.on("before-input-event", (e, input) => { if (handleShortcut(w, input)) e.preventDefault(); });
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.setVisualZoomLevelLimits(1, 1);
  win.loadFile(path.join(__dirname, "ui", "index.html"), { query: { private: priv ? "1" : "" } });
  win.once("ready-to-show", () => {
    if (maximized) setMaximized(w, true);
    win.show();
  });
  // Focus given while the window was hidden or in the background does not stick: when the window comes to the
  // front with nothing inside it focused, put the keyboard in the address bar (new tab) or in the page.
  const focusDefault = () => setTimeout(() => {
    if (win.isDestroyed() || !win.isFocused()) return;
    const t = activeTab(w);
    if (!t || win.webContents.isFocused() || w.overlay.webContents.isFocused()) return;
    // On the new tab page the address bar wins, as in Chrome; Windows tends to hand the keyboard to the page view.
    if (isNewTab(t.url) || isNewTab(t.pendingUrl) || t.error || t.crashed) focusOmnibox(w);
    else if (!t.wc.isFocused()) t.wc.focus();
  }, 60);
  win.on("show", focusDefault);
  win.on("focus", focusDefault);
  win.webContents.once("did-finish-load", () => {
    if (tabs && tabs.length) {
      tabs.forEach((t, i) => createTab(w, { url: t.url, title: t.title, pinned: t.pinned, background: true, lazy: i !== active }));
      activate(w, w.tabs[Math.min(active, w.tabs.length - 1)].id);
    } else {
      const list = urls && urls.length ? urls : [NEWTAB];
      list.forEach((u, i) => createTab(w, { url: u, background: i > 0 }));
    }
    sendBookmarks(w);
    sendDownloads(w);
  });
  win.on("app-command", (e, command) => {
    if (command === "browser-backward") run(w, "back");
    else if (command === "browser-forward") run(w, "forward");
  });
  win.on("blur", () => { closePopup(w); stopResize(w); });
  win.on("resize", () => closePopup(w));
  win.on("moved", () => {
    if (w.maximized && w.restore) {
      const cur = win.getBounds();
      w.maximized = false;
      win.setBounds({ x: cur.x, y: cur.y, width: w.restore.width, height: w.restore.height });
      send(win.webContents, "maximized", false);
    }
    saveSessionSoon();
  });
  win.on("close", () => {
    // The last regular window leaves its tabs in the session; closing one of several removes it.
    const others = [...windows].filter((x) => x !== w && !x.priv);
    if (!w.priv) saveSessionNow(others.length ? w : null);
  });
  win.on("closed", () => {
    for (const t of w.tabs) { try { t.wc.destroy(); } catch (e) { /* gone */ } }
    try { overlay.webContents.destroy(); } catch (e) { /* gone */ }
    windows.delete(w);
    if (w.priv) { try { ses.clearStorageData(); ses.clearCache(); } catch (e) { /* private data */ } }
  });
  return w;
}
const winOf = (wc) => [...windows].find((w) => w.win.webContents === wc || w.overlay.webContents === wc) || null;
function findTab(wc) {
  for (const w of windows) { const t = w.tabs.find((x) => x.wc === wc); if (t) return { w, t }; }
  return null;
}

/* ---------- maximize, resize (same model as the rest of the Neural series) ---------- */
function setMaximized(w, on) {
  if (w.maximized === on) return;
  const win = w.win;
  if (on) { w.restore = win.getBounds(); win.setBounds(screen.getDisplayMatching(w.restore).workArea); }
  else win.setBounds(onScreen(w.restore) ? w.restore : defaultBounds());
  w.maximized = on;
  send(win.webContents, "maximized", on);
  saveSessionSoon();
}
function startResize(w, edge) {
  if (w.maximized || w.fullscreen || !/^(n|s|e|w|ne|nw|se|sw)$/.test(edge)) return;
  stopResize(w);
  const r = { from: w.win.getBounds(), cursor: screen.getCursorScreenPoint(), last: null };
  r.timer = setInterval(() => {
    if (w.win.isDestroyed()) { clearInterval(r.timer); return; }
    const p = screen.getCursorScreenPoint();
    const dx = p.x - r.cursor.x, dy = p.y - r.cursor.y, b = r.from;
    let { x, y, width, height } = b;
    if (edge.includes("e")) width = Math.max(MIN_W, b.width + dx);
    if (edge.includes("s")) height = Math.max(MIN_H, b.height + dy);
    if (edge.includes("w")) { width = Math.max(MIN_W, b.width - dx); x = b.x + b.width - width; }
    if (edge.includes("n")) { height = Math.max(MIN_H, b.height - dy); y = b.y + b.height - height; }
    const l = r.last;
    if (l && l.x === x && l.y === y && l.width === width && l.height === height) return;
    r.last = { x, y, width, height };
    w.win.setBounds(r.last);
  }, 16);
  w.resizing = r;
}
function stopResize(w) {
  if (!w.resizing) return;
  clearInterval(w.resizing.timer);
  w.resizing = null;
  saveSessionSoon();
}
function setFullscreen(w, on) {
  if (w.fullscreen === on) return;
  w.fullscreen = on;
  closePopup(w);
  w.win.setFullScreen(on);
  send(w.win.webContents, "fullscreen", on);
}

/* ============================================================ tabs */
function tabPrefs(w) {
  return {
    partition: w.partition,
    contextIsolation: true, sandbox: true, nodeIntegration: false,
    webSecurity: true, allowRunningInsecureContent: false,
    plugins: true, spellcheck: true, safeDialogs: true,
  };
}
function createTab(w, { url = NEWTAB, title = "", webContents = null, background = false, index = null, pinned = false, lazy = false } = {}) {
  const view = webContents ? new WebContentsView({ webContents }) : new WebContentsView({ webPreferences: tabPrefs(w) });
  const tab = {
    id: ++tabSeq, view, wc: view.webContents, url, title, favicon: null, loading: false, audible: false,
    pinned, crashed: false, error: null, cert: null, pendingUrl: lazy ? url : null, forceLeave: false,
  };
  view.setBackgroundColor(isInternal(url) ? "#05070c" : "#ffffff");
  view.setVisible(false);
  let at = index == null ? w.tabs.length : Math.max(0, Math.min(index, w.tabs.length));
  if (!pinned) at = Math.max(at, w.tabs.filter((t) => t.pinned).length);
  w.tabs.splice(at, 0, tab);
  w.win.contentView.addChildView(view);
  w.win.contentView.addChildView(w.overlay); // keep the overlay on top
  attachTab(w, tab);
  if (!webContents && !lazy) tab.wc.loadURL(url);
  if (!background || !w.activeId) activate(w, tab.id);
  pushState(w);
  saveSessionSoon();
  return tab;
}

function attachTab(w, tab) {
  const wc = tab.wc;
  wc.setWindowOpenHandler((d) => windowOpen(w, tab, d));
  wc.on("did-start-loading", () => { tab.loading = true; pushState(w); });
  wc.on("did-stop-loading", () => { tab.loading = false; tab.navUrl = null; pushState(w); });
  // A freshly loaded page grabs the keyboard; on the new tab page it belongs in the address bar.
  wc.on("did-finish-load", () => {
    if (w.activeId === tab.id && isNewTab(wc.getURL()) && w.win.isFocused() && !w.popup) focusOmnibox(w);
  });
  wc.on("did-start-navigation", (details) => {
    if (!details.isMainFrame || details.isSameDocument) return;
    tab.pageTitle = null;
    tab.blocked = 0;
    tab.blockedHosts = new Map();
    if (w.popup && w.popup.spec.kind === "accounts" && w.popup.spec.tabId === tab.id) closePopup(w);
    tab.view.setBackgroundColor(isInternal(details.url) ? "#05070c" : "#ffffff");
  });
  wc.on("did-navigate", (e, url, httpCode) => {
    tab.url = url;
    tab.navUrl = null;
    tab.title = wc.getTitle();
    tab.crashed = false;
    if (httpCode) { tab.error = null; tab.cert = null; }
    tab.favicon = isInternal(url) ? null : (w.priv ? tab.favicon : store.favicon(hostOf(url)) || null);
    // The page's <title> can arrive before or after this; only a title the page really set goes to history.
    if (!w.priv) store.recordVisit(url, tab.pageTitle || "");
    applyZoom(w, tab);
    showActive(w);
    pushState(w);
    saveSessionSoon();
  });
  wc.on("did-navigate-in-page", (e, url, isMainFrame) => {
    if (!isMainFrame) return;
    tab.url = url;
    if (!w.priv) store.recordVisit(url, tab.pageTitle || "");
    pushState(w);
    saveSessionSoon();
  });
  wc.on("page-title-updated", (e, title) => {
    tab.title = title;
    tab.pageTitle = title;
    if (!w.priv) store.updateTitle(wc.getURL(), title);
    pushState(w);
  });
  wc.on("page-favicon-updated", (e, favicons) => fetchFavicon(w, tab, favicons[0]));
  wc.on("audio-state-changed", (e) => { tab.audible = !!e.audible; pushState(w); });
  wc.on("update-target-url", (e, url) => { if (w.activeId === tab.id) send(w.win.webContents, "hover", url); });
  wc.on("found-in-page", (e, r) => { if (w.activeId === tab.id) send(w.win.webContents, "find-result", { active: r.activeMatchOrdinal, matches: r.matches }); });
  wc.on("did-fail-load", (e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3: aborted (a new navigation started)
    tab.error = { code, desc, url };
    tab.url = url;
    tab.title = hostOf(url) || url;
    tab.navUrl = null;
    showActive(w);
    pushState(w);
  });
  wc.on("render-process-gone", (e, details) => {
    if (details.reason === "clean-exit") return;
    tab.crashed = true;
    tab.loading = false;
    showActive(w);
    pushState(w);
  });
  wc.on("enter-html-full-screen", () => { if (w.activeId === tab.id) setFullscreen(w, true); });
  wc.on("leave-html-full-screen", () => setFullscreen(w, false));
  wc.on("context-menu", (e, params) => contextMenu(w, tab, params));
  wc.on("before-input-event", (e, input) => { if (handleShortcut(w, input)) e.preventDefault(); });
  wc.on("zoom-changed", (e, dir) => zoomBy(w, tab, dir === "in" ? 1 : -1));
  // Web pages may not open NeuralWeb's own pages, by link or by redirect.
  wc.on("will-navigate", (e) => { if (isInternal(e.url) && !isInternal(wc.getURL())) e.preventDefault(); });
  wc.on("will-redirect", (e) => { if (isInternal(e.url)) e.preventDefault(); });
  wc.on("will-prevent-unload", (e) => {
    if (tab.forceLeave) { tab.forceLeave = false; e.preventDefault(); return; }
    queuePrompt(w, {
      title: "Bu siteden ayrılmak istiyor musun?",
      text: "Yaptığın değişiklikler kaydedilmemiş olabilir.",
      icon: "leave",
      buttons: [{ id: "stay", label: "Kal" }, { id: "leave", label: "Ayrıl", danger: true }],
    }, (choice) => {
      if (choice !== "leave") return;
      tab.forceLeave = true;
      if (tab.closing) wc.close({ waitForBeforeUnload: false });
      else if (tab.leaveTo) wc.loadURL(tab.leaveTo);
    });
  });
  wc.on("destroyed", () => removeTab(w, tab));
}

function windowOpen(w, tab, d) {
  const url = d.url || "";
  if (/^(mailto|tel|sms|callto|ms-[a-z-]+|zoommtg|msteams|spotify|steam|discord|slack|tg|whatsapp):/i.test(url)) {
    queuePrompt(w, {
      title: "Harici uygulama açılsın mı?", text: url.slice(0, 160), icon: "openExternal",
      buttons: [{ id: "no", label: "Vazgeç" }, { id: "open", label: "Aç", primary: true }],
    }, (c) => { if (c === "open") shell.openExternal(url); });
    return { action: "deny" };
  }
  if (!/^(https?|neural|blob|data|about|file):/i.test(url)) return { action: "deny" };
  if (isInternal(url) && !isInternal(tab.wc.getURL())) return { action: "deny" };
  const background = d.disposition === "background-tab";
  return {
    action: "allow",
    createWindow: (options) => {
      const after = w.tabs.indexOf(tab) + 1;
      return createTab(w, { url, webContents: options.webContents, background, index: after }).wc;
    },
  };
}

function removeTab(w, tab) {
  const i = w.tabs.indexOf(tab);
  if (i < 0) return;
  w.tabs.splice(i, 1);
  try { w.win.contentView.removeChildView(tab.view); } catch (e) { /* window closing */ }
  if (!w.priv && tab.url && !isNewTab(tab.url)) {
    closedTabs.push({ url: tab.url, title: tab.title, pinned: tab.pinned });
    if (closedTabs.length > 25) closedTabs.shift();
  }
  if (w.win.isDestroyed()) return;
  if (!w.tabs.length) { w.win.close(); return; }
  if (w.activeId === tab.id) activate(w, w.tabs[Math.min(i, w.tabs.length - 1)].id);
  pushState(w);
  saveSessionSoon();
}
function closeTab(w, id) {
  const tab = w.tabs.find((t) => t.id === id);
  if (!tab) return;
  tab.closing = true;
  if (tab.pendingUrl || tab.crashed) tab.wc.close({ waitForBeforeUnload: false });
  else tab.wc.close({ waitForBeforeUnload: true });
}
const activeTab = (w) => w.tabs.find((t) => t.id === w.activeId) || null;

function activate(w, id) {
  const tab = w.tabs.find((t) => t.id === id);
  if (!tab) return;
  closePopup(w);
  const prev = activeTab(w);
  if (prev && prev !== tab) { try { prev.wc.stopFindInPage("clearSelection"); } catch (e) { /* no find */ } }
  w.activeId = id;
  if (tab.pendingUrl) { const u = tab.pendingUrl; tab.pendingUrl = null; tab.wc.loadURL(u); }
  showActive(w);
  if (isNewTab(tab.url) || isNewTab(tab.pendingUrl)) focusOmnibox(w);
  else tab.wc.focus();
  pushState(w);
}
function focusOmnibox(w) {
  w.win.webContents.focus();
  send(w.win.webContents, "focus-omnibox");
}
// Shows the active tab's view over the viewport; a tab with an error or crash shows the UI's panel instead.
function showActive(w) {
  const vp = w.layout && w.layout.viewport;
  for (const t of w.tabs) {
    const show = t.id === w.activeId && !t.error && !t.crashed && vp && vp.width > 0;
    if (show) t.view.setBounds({ x: Math.round(vp.x), y: Math.round(vp.y), width: Math.round(vp.width), height: Math.round(vp.height) });
    t.view.setVisible(!!show);
  }
}

function navigate(w, tab, input) {
  const url = resolveInput(input);
  if (!url || !tab) return;
  tab.error = null;
  tab.crashed = false;
  tab.pendingUrl = null;
  tab.leaveTo = url;
  tab.navUrl = url; // shown in the address bar until the page commits
  tab.wc.loadURL(url);
  tab.wc.focus();
  showActive(w);
  pushState(w);
}

/* ---------- favicons ---------- */
async function fetchFavicon(w, tab, url) {
  if (!url || !/^(https?|data):/i.test(url)) return;
  try {
    let data = url;
    if (!url.startsWith("data:")) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      const res = await w.ses.fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) return;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 150000) return;
      const type = (res.headers.get("content-type") || "image/x-icon").split(";")[0];
      data = `data:${type};base64,${buf.toString("base64")}`;
    }
    tab.favicon = data;
    if (!w.priv) store.setFavicon(hostOf(tab.wc.getURL()), data);
    pushState(w);
  } catch (e) { /* no favicon */ }
}

/* ---------- zoom ---------- */
function applyZoom(w, tab) {
  const host = hostOf(tab.wc.getURL());
  const f = (!w.priv && host && store.s.zoom[host]) || 1;
  if (Math.abs(tab.wc.getZoomFactor() - f) > 0.001) tab.wc.setZoomFactor(f);
}
function zoomBy(w, tab, dir) {
  if (!tab) return;
  const cur = tab.wc.getZoomFactor();
  let i = ZOOM_STEPS.findIndex((z) => z >= cur - 0.001);
  if (i < 0) i = ZOOM_STEPS.length - 1;
  if (dir > 0) i = Math.min(ZOOM_STEPS.length - 1, ZOOM_STEPS[i] > cur + 0.001 ? i : i + 1);
  else if (dir < 0) i = Math.max(0, i - 1);
  const f = dir === 0 ? 1 : ZOOM_STEPS[i];
  tab.wc.setZoomFactor(f);
  const host = hostOf(tab.wc.getURL());
  if (!w.priv && host) {
    if (f === 1) delete store.s.zoom[host]; else store.s.zoom[host] = f;
    store.settings.save();
  }
  pushState(w);
}

/* ============================================================ state to the UI */
function tabState(t) {
  const url = t.pendingUrl || t.navUrl || t.url || "";
  let canBack = false, canForward = false;
  try { canBack = t.wc.navigationHistory.canGoBack(); canForward = t.wc.navigationHistory.canGoForward(); } catch (e) { /* destroyed */ }
  return {
    id: t.id,
    url: isNewTab(url) ? "" : url,
    title: t.title || (isNewTab(url) ? "Yeni sekme" : url.replace(/^https?:\/\//, "")),
    favicon: t.favicon,
    loading: t.loading, audible: t.audible, muted: (() => { try { return t.wc.isAudioMuted(); } catch (e) { return false; } })(),
    pinned: t.pinned, crashed: t.crashed,
    error: t.error ? { code: t.error.code, desc: t.error.desc, url: t.error.url, cert: t.error.code <= -200 && t.error.code > -300 } : null,
    canBack, canForward,
    zoom: (() => { try { return Math.round(t.wc.getZoomFactor() * 100); } catch (e) { return 100; } })(),
    bookmarked: !!(url && store.bookmarkFor(url)),
    security: securityOf(url),
    internal: isInternal(url),
    blocked: t.blocked || 0,
    shield: shieldStateOf(url),
  };
}
function pushState(w) {
  if (w.statePending) return;
  w.statePending = true;
  setTimeout(() => {
    w.statePending = false;
    if (w.win.isDestroyed()) return;
    send(w.win.webContents, "state", { tabs: w.tabs.map(tabState), activeId: w.activeId, priv: w.priv, theme: store.s.theme, showBar: store.s.showBookmarksBar });
    const t = activeTab(w);
    w.win.setTitle(t ? `${tabState(t).title} - NeuralWeb` : "NeuralWeb");
  }, 16);
}
function barData() {
  const fav = (url) => store.favicon(hostOf(url));
  const conv = (n) => (n.type === "folder" ? { id: n.id, type: "folder", title: n.title, children: n.children.map(conv) } : { id: n.id, type: "url", title: n.title, url: n.url, favicon: fav(n.url) });
  return { bar: store.roots.bar.children.map(conv), other: store.roots.other.children.map(conv) };
}
function sendBookmarks(w) { send(w.win.webContents, "bookmarks", barData()); }
/* ============================================================ passwords in pages */
// Messages come from the tab preload's isolated world; the origin is taken from the frame, never from the page.
function loginSender(e) {
  const f = e.senderFrame;
  if (!f || f.parent) return null;
  const found = findTab(e.sender);
  const origin = loginOrigin(f.url);
  return found && origin ? { ...found, origin } : null;
}
const accountsPopup = (w, t) => (w.popup && w.popup.spec.kind === "accounts" && (!t || w.popup.spec.tabId === t.id) ? w.popup : null);
function fillLogin(w, t, origin, id) {
  const l = vault.get(id);
  if (!l || l.origin !== origin || t.wc.isDestroyed() || loginOrigin(t.wc.getURL()) !== origin) return;
  t.wc.send("pw:fill", { origin, username: l.username, password: vault.decrypt(l) });
  vault.touch(id);
  t.wc.focus();
}
ipcMain.on("pw:focus", (e, r) => {
  const s = loginSender(e);
  if (!s || s.w.activeId !== s.t.id || !s.w.layout || accountsPopup(s.w, s.t)) return;
  const { w, t, origin } = s;
  const logins = vault.forOrigin(origin);
  if (!logins.length) return;
  const zoom = t.wc.getZoomFactor();
  const vp = w.layout.viewport;
  const num = (v) => (Number.isFinite(+v) ? +v : 0);
  const anchor = { x: vp.x + num(r && r.x) * zoom, y: vp.y + num(r && r.y) * zoom, width: num(r && r.width) * zoom, height: num(r && r.height) * zoom };
  const data = { host: new URL(origin).host, items: logins.map((l) => ({ id: l.id, username: l.username })), sel: -1 };
  const closed = () => { if (!t.wc.isDestroyed()) t.wc.send("pw:popup", false); };
  openPopup(w, { kind: "accounts", tabId: t.id, origin, focus: false, anchor, width: Math.round(Math.max(280, Math.min(440, anchor.width))), data }, (v) => {
    closed();
    if (v === "manage") openInternal(w, "neural://passwords/");
    else fillLogin(w, t, origin, String(v));
  }, closed);
  t.wc.send("pw:popup", true);
});
ipcMain.on("pw:blur", (e) => {
  const s = loginSender(e);
  if (s && accountsPopup(s.w, s.t)) closePopup(s.w);
});
ipcMain.on("pw:nav", (e, key) => {
  const s = loginSender(e);
  const p = s && accountsPopup(s.w, s.t);
  if (!p) return;
  const items = p.spec.data.items;
  if (key === "Enter") {
    const it = items[p.spec.data.sel];
    if (!it) return;
    p.onClose = null;
    closePopup(s.w, "pick");
    p.onPick(it.id);
    return;
  }
  const n = items.length;
  const sel = p.spec.data.sel;
  p.spec.data.sel = key === "ArrowDown" ? (sel + 1) % n : (sel <= 0 ? n - 1 : sel - 1);
  send(s.w.overlay.webContents, "popup:update", { id: p.id, data: p.spec.data });
});
ipcMain.on("pw:userstep", (e, username) => {
  const s = loginSender(e);
  if (s) s.t.lastUser = { origin: s.origin, username: String(username || "").slice(0, 300), at: Date.now() };
});
ipcMain.on("pw:submit", (e, c) => {
  const s = loginSender(e);
  if (!s || !c) return;
  const { w, t, origin } = s;
  if (w.priv || store.s.passwordsOffer === false || vault.isNever(origin)) return;
  let username = String(c.username || "").slice(0, 300);
  const password = String(c.password || "");
  if (!password || password.length > 1000) return;
  if (!username && t.lastUser && t.lastUser.origin === origin && Date.now() - t.lastUser.at < 10 * 60e3) username = t.lastUser.username;
  const existing = vault.find(origin, username);
  if (existing && vault.decrypt(existing) === password) { vault.touch(existing.id); return; }
  const host = new URL(origin).host;
  const who = `Kullanıcı adı: ${username || "(yok)"}`;
  queuePrompt(w, existing
    ? { title: "Şifre güncellensin mi?", text: `${host}\n${who}\nBu hesap için kayıtlı şifre farklı.`, icon: "key",
        buttons: [{ id: "no", label: "Hayır" }, { id: "save", label: "Güncelle", primary: true }] }
    : { title: "Şifre kaydedilsin mi?", text: `${host}\n${who}\nŞifre: ${"•".repeat(Math.min(12, password.length))}`, icon: "key",
        buttons: [{ id: "never", label: "Bu sitede asla" }, { id: "no", label: "Şimdi değil" }, { id: "save", label: "Kaydet", primary: true }] },
  (choice) => {
    if (choice === "save") vault.upsert({ origin, username, password });
    else if (choice === "never") vault.setNever(origin, true);
    else return;
    broadcastPages("passwords");
  });
});
function hwndOf(w) {
  const b = w.win.getNativeWindowHandle();
  return b.length >= 8 ? b.readBigUInt64LE(0).toString() : String(b.readUInt32LE(0));
}

/* ============================================================ shield (ads and trackers) */
function shieldStateOf(url) {
  if (!/^https?:/i.test(url || "")) return "na";
  if (!store.s.shield.enabled) return "off";
  return shield.allowedUrl(url) ? "site" : "on";
}
function shieldData(w) {
  const t = activeTab(w);
  const url = t ? (t.error ? t.error.url : t.url) : "";
  const info = shield.info();
  const hosts = t && t.blockedHosts ? [...t.blockedHosts].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([host, n]) => ({ host, n })) : [];
  return {
    host: bareHost(hostOf(url)), web: /^https?:/i.test(url), count: t ? t.blocked || 0 : 0, hosts,
    enabled: info.enabled, siteOff: shield.allowedUrl(url), ready: info.ready, updating: info.updating, today: info.today, priv: w.priv,
    pending: !!(t && w.shieldBefore && w.shieldBefore.tabId === t.id && shieldStateOf(url) !== w.shieldBefore.state),
  };
}
function refreshShieldPopup(w) {
  if (w.popup && w.popup.spec.kind === "shield") send(w.overlay.webContents, "popup:update", { id: w.popup.id, data: shieldData(w) });
}
// Switching the shield for a site takes effect on reload; the page reloads when the panel closes, so the
// panel stays put while the user is still deciding.
function openShieldPopup(w) {
  const t0 = activeTab(w);
  w.shieldBefore = t0 ? { tabId: t0.id, state: shieldStateOf(t0.url) } : null;
  const applyOnClose = () => {
    const before = w.shieldBefore;
    w.shieldBefore = null;
    const t = before && w.tabs.find((x) => x.id === before.tabId);
    if (t && /^https?:/i.test(t.url) && shieldStateOf(t.url) !== before.state) t.wc.reload();
  };
  openPopup(w, { kind: "shield", data: shieldData(w), anchor: w.layout && w.layout.anchors.shield, align: "right", width: 330, returnFocus: "ui" }, (v) => {
    if (!v) return;
    const t = activeTab(w);
    if (v.action === "site" && t && /^https?:/i.test(t.url)) shield.setAllowed(hostOf(t.url), !v.on);
    else if (v.action === "global") shield.setEnabled(v.on);
    else if (v.action === "settings") { applyOnClose(); openInternal(w, "neural://settings/#shield"); return; }
    refreshShieldPopup(w);
  }, applyOnClose);
}
// Called for every blocked request; the popup follows at most a few times a second.
function shieldTick(w) {
  pushState(w);
  if (w.popup && w.popup.spec.kind === "shield" && !w.shieldTimer) {
    w.shieldTimer = setTimeout(() => { w.shieldTimer = null; if (!w.win.isDestroyed()) refreshShieldPopup(w); }, 250);
  }
}
function shieldChanged() {
  for (const w of windows) { pushState(w); refreshShieldPopup(w); }
  broadcastPages("shield");
}

function bookmarksChanged() { for (const w of windows) { sendBookmarks(w); pushState(w); } broadcastPages("bookmarks"); }

/* ============================================================ overlay popups */
function openPopup(w, spec, onPick, onClose) {
  closePopup(w);
  const id = ++popupSeq;
  w.popup = { id, spec, onPick, onClose };
  send(w.win.webContents, "popup-state", spec.kind);
  const b = w.win.getBounds();
  w.overlay.setBounds({ x: 0, y: 0, width: b.width, height: b.height });
  w.overlay.setVisible(false);
  send(w.overlay.webContents, "popup:render", { id, kind: spec.kind, data: spec.data, width: spec.width || 0, maxHeight: Math.max(120, b.height - 24), theme: store.s.theme, priv: w.priv });
  return id;
}
function placePopup(w, size) {
  const spec = w.popup.spec;
  const b = w.win.getBounds();
  const a = spec.anchor || { x: 40, y: 80, width: 0, height: 0 };
  const width = Math.min(Math.ceil(size.width), b.width - 16);
  const height = Math.min(Math.ceil(size.height), b.height - 16);
  let x = spec.align === "right" ? a.x + a.width - width : a.x;
  let y = spec.at === "point" ? a.y : a.y + a.height + 4;
  x = Math.max(8, Math.min(x, b.width - width - 8));
  if (y + height > b.height - 8) y = spec.at === "point" ? Math.max(8, a.y - height) : Math.max(8, a.y - height - 4);
  w.overlay.setBounds({ x: Math.round(x), y: Math.round(y), width, height });
  w.overlay.setVisible(true);
  w.win.contentView.addChildView(w.overlay);
  if (spec.focus !== false) w.overlay.webContents.focus();
}
function closePopup(w, reason) {
  if (!w.popup) return;
  const p = w.popup;
  w.popup = null;
  send(w.win.webContents, "popup-state", null);
  if (!w.overlay.webContents.isDestroyed()) {
    w.overlay.setVisible(false);
    send(w.overlay.webContents, "popup:clear");
  }
  if (p.onClose) p.onClose(reason);
  if (p.spec.focus !== false && !w.win.isDestroyed() && w.win.isFocused()) {
    const t = activeTab(w);
    if (p.spec.returnFocus === "ui" || !t || t.error || t.crashed) w.win.webContents.focus(); else t.wc.focus();
  }
  setImmediate(() => nextPrompt(w));
}
// Permission and leave prompts wait their turn so a menu never swallows them.
function queuePrompt(w, data, done) {
  w.prompts.push({ data, done });
  if (!w.popup) nextPrompt(w);
}
function nextPrompt(w) {
  if (w.popup || !w.prompts.length || w.win.isDestroyed()) return;
  const { data, done } = w.prompts.shift();
  let answered = false;
  openPopup(w, { kind: "prompt", data, anchor: w.layout && w.layout.anchors.omnibox, focus: true, width: 380 },
    (v) => { answered = true; done(v); },
    () => { if (!answered) done(null); });
}

/* ============================================================ context menu */
function contextMenu(w, tab, p) {
  const items = [];
  const sep = () => { if (items.length && items[items.length - 1] !== "-") items.push("-"); };
  const actions = {};
  const add = (label, fn, extra = {}) => { const id = `c${items.length}`; actions[id] = fn; items.push({ id, label, ...extra }); };
  const wc = tab.wc;
  if (p.misspelledWord) {
    for (const s of (p.dictionarySuggestions || []).slice(0, 5)) add(s, () => wc.replaceMisspelling(s), { bold: true });
    add("Sözlüğe ekle", () => w.ses.addWordToSpellCheckerDictionary(p.misspelledWord));
    sep();
  }
  if (p.linkURL) {
    add("Bağlantıyı yeni sekmede aç", () => createTab(w, { url: p.linkURL, background: true, index: w.tabs.indexOf(tab) + 1 }));
    add("Bağlantıyı yeni pencerede aç", () => createWindow({ priv: w.priv, urls: [p.linkURL] }));
    if (!w.priv) add("Bağlantıyı gizli pencerede aç", () => createWindow({ priv: true, urls: [p.linkURL] }));
    sep();
    add("Bağlantıyı farklı kaydet", () => wc.downloadURL(p.linkURL));
    add("Bağlantı adresini kopyala", () => clipboard.writeText(p.linkURL));
    sep();
  }
  if (p.mediaType === "image" && p.srcURL) {
    add("Resmi yeni sekmede aç", () => createTab(w, { url: p.srcURL, background: true, index: w.tabs.indexOf(tab) + 1 }));
    add("Resmi farklı kaydet", () => wc.downloadURL(p.srcURL));
    add("Resmi kopyala", () => wc.copyImageAt(p.x, p.y));
    add("Resim adresini kopyala", () => clipboard.writeText(p.srcURL));
    sep();
  } else if ((p.mediaType === "video" || p.mediaType === "audio") && p.srcURL && !p.srcURL.startsWith("blob:")) {
    add(p.mediaType === "video" ? "Videoyu yeni sekmede aç" : "Sesi yeni sekmede aç", () => createTab(w, { url: p.srcURL, index: w.tabs.indexOf(tab) + 1 }));
    add("Adresi kopyala", () => clipboard.writeText(p.srcURL));
    sep();
  }
  if (p.isEditable) {
    const f = p.editFlags || {};
    add("Geri al", () => wc.undo(), { disabled: !f.canUndo, key: "Ctrl+Z" });
    add("Yinele", () => wc.redo(), { disabled: !f.canRedo, key: "Ctrl+Y" });
    sep();
    add("Kes", () => wc.cut(), { disabled: !f.canCut, key: "Ctrl+X" });
    add("Kopyala", () => wc.copy(), { disabled: !f.canCopy, key: "Ctrl+C" });
    add("Yapıştır", () => wc.paste(), { disabled: !f.canPaste, key: "Ctrl+V" });
    add("Düz metin olarak yapıştır", () => wc.pasteAndMatchStyle(), { disabled: !f.canPaste, key: "Ctrl+Shift+V" });
    add("Tümünü seç", () => wc.selectAll(), { key: "Ctrl+A" });
    sep();
  } else if (p.selectionText && p.selectionText.trim()) {
    const s = p.selectionText.trim().replace(/\s+/g, " ");
    add("Kopyala", () => wc.copy(), { key: "Ctrl+C" });
    add(`Google'da ara: “${s.length > 28 ? s.slice(0, 28) + "…" : s}”`, () => createTab(w, { url: googleSearch(s), index: w.tabs.indexOf(tab) + 1 }));
    sep();
  }
  if (!p.linkURL && !p.isEditable && !p.selectionText && p.mediaType === "none") {
    add("Geri", () => wc.navigationHistory.goBack(), { disabled: !wc.navigationHistory.canGoBack(), key: "Alt+Sol" });
    add("İleri", () => wc.navigationHistory.goForward(), { disabled: !wc.navigationHistory.canGoForward(), key: "Alt+Sağ" });
    add("Yeniden yükle", () => wc.reload(), { key: "Ctrl+R" });
    sep();
    add("Yazdır…", () => wc.print(), { key: "Ctrl+P" });
    if (/^https?:/i.test(wc.getURL())) add("Sayfa kaynağını görüntüle", () => createTab(w, { url: "view-source:" + wc.getURL(), index: w.tabs.indexOf(tab) + 1 }), { key: "Ctrl+U" });
    sep();
  }
  add("İncele", () => { wc.inspectElement(p.x, p.y); }, { key: "Ctrl+Shift+I" });
  const vp = (w.layout && w.layout.viewport) || { x: 0, y: 0 };
  openPopup(w, { kind: "menu", data: { items }, anchor: { x: vp.x + p.x, y: vp.y + p.y, width: 0, height: 0 }, at: "point", width: 280 },
    (id) => { const fn = actions[id]; if (fn) fn(); });
}

/* ============================================================ downloads */
function uniquePath(dir, name) {
  const safe = (name || "indirilen-dosya").replace(/[\\/:*?"<>|]/g, "_");
  const ext = path.extname(safe);
  const base = safe.slice(0, safe.length - ext.length);
  let p = path.join(dir, safe);
  for (let n = 1; fs.existsSync(p); n++) p = path.join(dir, `${base} (${n})${ext}`);
  return p;
}
const downloadList = () => [...privateDownloads, ...store.downloads.data.items];
function onDownload(item, wc, priv) {
  const id = "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  let dir = store.s.downloadDir;
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { dir = app.getPath("downloads"); }
  if (store.s.askDownloadPath) item.setSaveDialogOptions({ defaultPath: path.join(dir, item.getFilename()) });
  else item.setSavePath(uniquePath(dir, item.getFilename()));
  const rec = { id, url: item.getURL(), filename: path.basename(item.getSavePath() || item.getFilename()), path: item.getSavePath(), state: "progressing", received: 0, total: item.getTotalBytes(), start: Date.now(), priv };
  let referrer = "";
  try { referrer = wc ? wc.getURL() : ""; } catch (e) { /* gone */ }
  downloadItems.set(id, item);
  if (priv) privateDownloads.unshift(rec); else store.putDownload(rec);
  let last = 0;
  item.on("updated", (e, state) => {
    rec.path = item.getSavePath();
    rec.filename = path.basename(rec.path || rec.filename);
    rec.received = item.getReceivedBytes();
    rec.total = item.getTotalBytes();
    rec.state = state === "interrupted" ? "interrupted" : item.isPaused() ? "paused" : "progressing";
    if (Date.now() - last > 250) { last = Date.now(); if (!priv) store.putDownload(rec); downloadsChanged(); }
  });
  item.once("done", (e, state) => {
    rec.state = state;
    rec.path = item.getSavePath();
    rec.filename = path.basename(rec.path || rec.filename);
    rec.received = item.getReceivedBytes();
    rec.end = Date.now();
    downloadItems.delete(id);
    if (state === "completed") markOfTheWeb(rec.path, rec.url, referrer);
    if (!priv) store.putDownload(rec);
    downloadsChanged();
  });
  downloadsChanged();
  const owner = wc && findTab(wc);
  const w = owner ? owner.w : [...windows][0];
  if (w && w.layout && !w.popup) setTimeout(() => { if (!w.popup && !w.win.isDestroyed()) openDownloadsPopup(w, true); }, 150);
}
// Files from the internet get the same zone mark Chrome and Edge write, so Windows SmartScreen checks them when run.
function markOfTheWeb(file, url, referrer) {
  try {
    const host = /^https?:/i.test(url) ? url : "about:internet";
    const lines = ["[ZoneTransfer]", "ZoneId=3"];
    if (/^https?:/i.test(referrer)) lines.push(`ReferrerUrl=${referrer}`);
    lines.push(`HostUrl=${host}`);
    fs.writeFileSync(`${file}:Zone.Identifier`, lines.join("\r\n") + "\r\n");
  } catch (e) { /* not NTFS */ }
}
function downloadSummary() {
  const list = downloadList();
  const active = list.filter((d) => d.state === "progressing" || d.state === "paused");
  const total = active.reduce((s, d) => s + (d.total || 0), 0);
  const got = active.reduce((s, d) => s + (d.received || 0), 0);
  return { active: active.length, progress: total ? got / total : active.length ? -1 : 0, recent: list.slice(0, 6), count: list.length };
}
let dlTimer = null;
function downloadsChanged() {
  if (dlTimer) return;
  dlTimer = setTimeout(() => {
    dlTimer = null;
    for (const w of windows) {
      sendDownloads(w);
      if (w.popup && w.popup.spec.kind === "downloads") send(w.overlay.webContents, "popup:update", { id: w.popup.id, data: downloadSummary() });
    }
    broadcastPages("downloads");
  }, 120);
}
function sendDownloads(w) { send(w.win.webContents, "downloads", downloadSummary()); }
// auto: opened by a new download, so it must not take the keyboard from the page.
function openDownloadsPopup(w, auto = false) {
  openPopup(w, { kind: "downloads", data: { ...downloadSummary(), autoClose: auto }, anchor: w.layout && w.layout.anchors.downloads, align: "right", width: 380, focus: !auto, returnFocus: "ui" },
    (v) => downloadAction(w, v));
}
function downloadAction(w, v) {
  if (!v) return;
  const rec = downloadList().find((d) => d.id === v.id);
  const item = v.id && downloadItems.get(v.id);
  switch (v.action) {
    case "open": if (rec && rec.path) shell.openPath(rec.path); break;
    case "show": if (rec && rec.path) shell.showItemInFolder(rec.path); break;
    case "cancel": if (item) item.cancel(); break;
    case "pause": if (item) item.pause(); break;
    case "resume": if (item && item.canResume()) item.resume(); break;
    case "retry": if (rec) { const t = activeTab(w); (t ? t.wc : w.win.webContents).downloadURL(rec.url); } break;
    case "remove": if (rec) { if (rec.priv) privateDownloads.splice(privateDownloads.indexOf(rec), 1); else store.removeDownload(rec.id); downloadsChanged(); } break;
    case "all": openInternal(w, "neural://downloads/"); break;
  }
}

/* ============================================================ site info */
const PERM_LABEL = { media: "Kamera ve mikrofon", geolocation: "Konum", notifications: "Bildirimler", "clipboard-read": "Pano okuma", midi: "MIDI cihazları", midiSysex: "MIDI (tam erişim)" };
function permsFor(w, origin) {
  if (!w.priv) return { ...(store.s.permissions[origin] || {}) };
  const out = {};
  for (const [k, v] of privatePermissions) { const i = k.lastIndexOf("|"); if (k.slice(0, i) === origin) out[k.slice(i + 1)] = v; }
  return out;
}
const SECURITY_TEXT = {
  secure: ["Bağlantı güvenli", "Bu siteye gönderdiğin bilgiler (şifreler, kart numaraları) şifrelenerek iletilir."],
  insecure: ["Bağlantı güvenli değil", "Bu sitede şifre veya kart bilgisi girme: bilgiler açık metin olarak iletilir."],
  internal: ["NeuralWeb sayfası", "Bu sayfa NeuralWeb'in kendi sayfası; internete bağlanmaz."],
  file: ["Yerel dosya", "Bu dosya bilgisayarından açıldı."],
  other: ["Özel sayfa", ""],
};
function siteInfoData(w) {
  const t = activeTab(w);
  const url = t ? (t.error ? t.error.url : t.url) : "";
  const origin = originOf(url);
  const sec = securityOf(url);
  const certBypass = sec === "secure" && (w.priv ? [...privateCertExceptions] : store.s.certExceptions).some((k) => k.startsWith(hostOf(url) + "|"));
  const [title, text] = certBypass ? ["Sertifika hatası yok sayıldı", "Bu sitenin sertifikasına güvenilmiyor; devam etmeyi sen seçtin."] : SECURITY_TEXT[sec];
  const perms = Object.entries(permsFor(w, origin)).map(([perm, value]) => ({ perm, label: PERM_LABEL[perm] || perm, value }));
  return { host: hostOf(url) || url, origin, security: certBypass ? "insecure" : sec, title, text, perms };
}
function openSiteInfo(w) {
  openPopup(w, { kind: "siteinfo", data: siteInfoData(w), anchor: w.layout && w.layout.anchors.security, width: 340, returnFocus: "ui" }, (v) => {
    if (!v) return;
    const d = siteInfoData(w);
    if (v.action === "reset" && d.origin) {
      if (w.priv) privatePermissions.delete(`${d.origin}|${v.perm}`);
      else pageApi.revokePermission(null, d.origin, v.perm);
      if (w.popup && w.popup.spec.kind === "siteinfo") send(w.overlay.webContents, "popup:update", { id: w.popup.id, data: siteInfoData(w) });
    } else if (v.action === "settings") openInternal(w, "neural://settings/#permissions");
  });
}

/* ============================================================ commands and shortcuts */
function openInternal(w, url) {
  const base = url.replace(/#.*$/, "");
  const t = w.tabs.find((x) => (x.url || "").startsWith(base));
  if (t) { activate(w, t.id); if (url !== base && t.url !== url) t.wc.loadURL(url); }
  else createTab(w, { url, index: w.tabs.indexOf(activeTab(w)) + 1 });
}

function run(w, name, arg) {
  const tab = activeTab(w);
  switch (name) {
    case "newTab": return createTab(w, { url: NEWTAB, index: w.tabs.length });
    case "closeTab": return closeTab(w, arg || w.activeId);
    case "reopenTab": { const c = closedTabs.pop(); if (c) createTab(w, { url: c.url, pinned: c.pinned }); return; }
    case "selectTab": return activate(w, arg);
    case "selectIndex": { const t = arg === -1 ? w.tabs[w.tabs.length - 1] : w.tabs[arg]; if (t) activate(w, t.id); return; }
    case "cycleTab": { if (w.tabs.length < 2) return; const i = w.tabs.indexOf(tab); activate(w, w.tabs[(i + arg + w.tabs.length) % w.tabs.length].id); return; }
    case "moveTab": {
      const t = w.tabs.find((x) => x.id === arg.id);
      if (!t) return;
      w.tabs.splice(w.tabs.indexOf(t), 1);
      const pins = w.tabs.filter((x) => x.pinned).length;
      const to = t.pinned ? Math.min(arg.index, pins) : Math.max(arg.index, pins);
      w.tabs.splice(Math.max(0, Math.min(to, w.tabs.length)), 0, t);
      pushState(w); saveSessionSoon(); return;
    }
    case "pinTab": { const t = w.tabs.find((x) => x.id === arg); if (!t) return; t.pinned = !t.pinned; w.tabs.splice(w.tabs.indexOf(t), 1); const pins = w.tabs.filter((x) => x.pinned).length; w.tabs.splice(t.pinned ? pins : pins, 0, t); pushState(w); saveSessionSoon(); return; }
    case "muteTab": { const t = w.tabs.find((x) => x.id === arg); if (t) { t.wc.setAudioMuted(!t.wc.isAudioMuted()); pushState(w); } return; }
    case "duplicateTab": { const t = w.tabs.find((x) => x.id === arg); if (t) createTab(w, { url: t.url, index: w.tabs.indexOf(t) + 1 }); return; }
    case "closeOthers": for (const t of w.tabs.filter((x) => x.id !== arg && !x.pinned)) closeTab(w, t.id); return;
    case "closeRight": { const i = w.tabs.findIndex((x) => x.id === arg); for (const t of w.tabs.slice(i + 1)) closeTab(w, t.id); return; }
    case "reloadTab": { const t = w.tabs.find((x) => x.id === arg); if (t) t.wc.reload(); return; }
    case "newWindow": return createWindow({ priv: false });
    case "newPrivate": return createWindow({ priv: true });
    case "navigate": return navigate(w, tab, arg);
    case "openUrlNewTab": return createTab(w, { url: resolveInput(arg) || NEWTAB, index: w.tabs.indexOf(tab) + 1, background: false });
    case "focusAddress": return focusOmnibox(w);
    case "back": if (tab && tab.wc.navigationHistory.canGoBack()) { tab.error = null; tab.crashed = false; tab.wc.navigationHistory.goBack(); } return;
    case "forward": if (tab && tab.wc.navigationHistory.canGoForward()) { tab.error = null; tab.wc.navigationHistory.goForward(); } return;
    case "reload":
      if (!tab) return;
      if (tab.error) { const u = tab.error.url; tab.error = null; showActive(w); tab.wc.loadURL(u); }
      else if (tab.crashed) { tab.crashed = false; showActive(w); tab.wc.reload(); }
      else tab.wc.reload();
      return pushState(w);
    case "hardReload": if (tab) tab.wc.reloadIgnoringCache(); return;
    case "stop": if (tab) tab.wc.stop(); return;
    case "home": return navigate(w, tab, NEWTAB);
    case "bookmark": return send(w.win.webContents, "star");
    case "siteInfo": return openSiteInfo(w);
    case "shieldPopup": return openShieldPopup(w);
    case "toggleBar": store.set("showBookmarksBar", !store.s.showBookmarksBar); for (const x of windows) pushState(x); return;
    case "history": return openInternal(w, "neural://history/");
    case "downloads": return openInternal(w, "neural://downloads/");
    case "passwords": return openInternal(w, "neural://passwords/");
    case "downloadsPopup": return openDownloadsPopup(w);
    case "bookmarksManager": return openInternal(w, "neural://bookmarks/");
    case "settings": return openInternal(w, "neural://settings/" + (arg ? "#" + arg : ""));
    case "find": w.win.webContents.focus(); return send(w.win.webContents, "find-open");
    // Electron's findNext means "start a new search", the opposite of "go to the next match".
    case "findText": if (tab && arg && arg.text) tab.wc.findInPage(String(arg.text), { forward: arg.forward !== false, findNext: !arg.next }); else if (tab) tab.wc.stopFindInPage("clearSelection"); return;
    case "focusPage": if (tab && !tab.error && !tab.crashed) tab.wc.focus(); return;
    case "editUI": if (["undo", "cut", "copy", "paste", "selectAll"].includes(arg)) w.win.webContents[arg](); return;
    case "pasteGo": return navigate(w, tab, clipboard.readText().trim());
    case "findStop": if (tab) tab.wc.stopFindInPage("keepSelection"); return;
    case "print": if (tab) tab.wc.print(); return;
    case "viewSource": if (tab && /^https?:/i.test(tab.url)) createTab(w, { url: "view-source:" + tab.url, index: w.tabs.indexOf(tab) + 1 }); return;
    case "devtools": if (tab) { if (tab.wc.isDevToolsOpened()) tab.wc.closeDevTools(); else tab.wc.openDevTools({ mode: "detach" }); } return;
    case "zoomIn": return zoomBy(w, tab, 1);
    case "zoomOut": return zoomBy(w, tab, -1);
    case "zoomReset": return zoomBy(w, tab, 0);
    case "fullscreen": return setFullscreen(w, !w.fullscreen);
    case "certProceed": {
      if (!tab || !tab.cert || !tab.error || hostOf(tab.error.url) !== tab.cert.host) return;
      const key = `${tab.cert.host}|${tab.cert.fingerprint}`;
      if (w.priv) privateCertExceptions.add(key);
      else { store.s.certExceptions.push(key); store.settings.save(); }
      const u = tab.error ? tab.error.url : tab.url;
      tab.error = null;
      showActive(w);
      tab.wc.loadURL(u);
      return;
    }
    case "theme": return pageApi.setSetting(null, "theme", arg);
    case "minimize": return w.win.minimize();
    case "toggleMax": return setMaximized(w, !w.maximized);
    case "closeWindow": return w.win.close();
    case "quit": return app.quit();
  }
}

const SHORTCUTS = {
  "Ctrl+T": "newTab", "Ctrl+W": "closeTab", "Ctrl+F4": "closeTab", "Ctrl+Shift+T": "reopenTab",
  "Ctrl+Tab": ["cycleTab", 1], "Ctrl+Shift+Tab": ["cycleTab", -1], "Ctrl+PageDown": ["cycleTab", 1], "Ctrl+PageUp": ["cycleTab", -1],
  "Ctrl+N": "newWindow", "Ctrl+Shift+N": "newPrivate",
  "Ctrl+L": "focusAddress", "Alt+D": "focusAddress", "F6": "focusAddress", "Ctrl+K": "focusAddress", "Ctrl+E": "focusAddress",
  "F5": "reload", "Ctrl+R": "reload", "Ctrl+F5": "hardReload", "Shift+F5": "hardReload", "Ctrl+Shift+R": "hardReload",
  "Alt+ArrowLeft": "back", "Alt+ArrowRight": "forward", "Alt+Home": "home", "BrowserBack": "back", "BrowserForward": "forward",
  "Ctrl+D": "bookmark", "Ctrl+Shift+B": "toggleBar", "Ctrl+Shift+O": "bookmarksManager",
  "Ctrl+H": "history", "Ctrl+J": "downloads", "Ctrl+F": "find", "F3": "find", "Ctrl+G": "find",
  "Ctrl+P": "print", "Ctrl+U": "viewSource", "F12": "devtools", "Ctrl+Shift+I": "devtools", "Ctrl+Shift+J": "devtools",
  "Ctrl+=": "zoomIn", "Ctrl++": "zoomIn", "Ctrl+Shift+=": "zoomIn", "Ctrl+Shift++": "zoomIn", "Ctrl+-": "zoomOut", "Ctrl+Shift+-": "zoomOut", "Ctrl+0": "zoomReset",
  "F11": "fullscreen", "Ctrl+Shift+Delete": ["settings", "privacy"],
};
for (let i = 1; i <= 8; i++) SHORTCUTS[`Ctrl+${i}`] = ["selectIndex", i - 1];
SHORTCUTS["Ctrl+9"] = ["selectIndex", -1];

function handleShortcut(w, input) {
  if (input.type !== "keyDown") return false;
  // Letters by physical key when the keyboard reports one (Ctrl+T stays Ctrl+T on any layout), else by the typed character.
  let key = input.key;
  if (/^Key[A-Z]$/.test(input.code)) key = input.code.slice(3);
  else if (/^Digit\d$/.test(input.code)) key = input.code.slice(5);
  else if (input.code === "NumpadAdd") key = "+";
  else if (input.code === "NumpadSubtract") key = "-";
  else if (key.length === 1) key = key.toUpperCase();
  const id = (input.control ? "Ctrl+" : "") + (input.alt ? "Alt+" : "") + (input.shift ? "Shift+" : "") + key;
  if (id === "Escape") {
    const t = activeTab(w);
    if (w.popup) { closePopup(w, "escape"); return true; }
    if (t && t.loading) { t.wc.stop(); return false; }
    return false;
  }
  const action = SHORTCUTS[id];
  if (!action) return false;
  const [name, arg] = Array.isArray(action) ? action : [action];
  setImmediate(() => run(w, name, arg));
  return true;
}

/* ============================================================ session restore */
let sessTimer = null;
function windowSnapshot(w) {
  return {
    bounds: w.maximized ? w.restore : w.win.getBounds(),
    maximized: w.maximized,
    active: Math.max(0, w.tabs.findIndex((t) => t.id === w.activeId)),
    tabs: w.tabs.map((t) => ({ url: t.error ? t.error.url : (t.pendingUrl || t.url), title: t.title, pinned: t.pinned })).filter((t) => t.url),
  };
}
function saveSessionNow(excluding = null) {
  clearTimeout(sessTimer);
  if (!store) return;
  const list = [...windows].filter((w) => !w.priv && w !== excluding && !w.win.isDestroyed()).map(windowSnapshot);
  if (!list.length && excluding === null) {
    const last = [...windows].find((w) => !w.priv && !w.win.isDestroyed());
    if (last) list.push(windowSnapshot(last));
  }
  store.session.data = { windows: list, saved: Date.now() };
  store.session.save(true);
}
function saveSessionSoon() { clearTimeout(sessTimer); sessTimer = setTimeout(() => saveSessionNow(), 1000); }

/* ============================================================ pages (neural://) API */
function broadcastPages(topic) {
  for (const w of windows) for (const t of w.tabs) if (isInternal(t.url)) send(t.wc, "page:event", { topic });
}
// Every call gets the calling tab first: ctx = { w, t }.
const versions = () => ({ app: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome });
const pageApi = {
  topSites: () => store.topSites(8),
  firstRun: () => !store.s.importOffered,
  dismissImport: () => { store.set("importOffered", true); return true; },
  history: (ctx, opts) => store.history(opts || {}),
  removeHistory: (ctx, url) => { store.removeHistory(String(url)); return true; },
  clearHistory: () => { store.clearHistory(); return true; },
  bookmarks: () => ({ bar: store.roots.bar, other: store.roots.other }),
  addBookmark: (ctx, o) => { const n = store.addBookmark(o || {}); bookmarksChanged(); return n; },
  updateBookmark: (ctx, id, o) => { const n = store.updateBookmark(id, o || {}); bookmarksChanged(); return n; },
  removeBookmark: (ctx, id) => { const r = store.removeBookmark(id); bookmarksChanged(); return r; },
  moveBookmark: (ctx, id, parent, index) => { const r = store.moveBookmark(id, parent, index); bookmarksChanged(); return r; },
  favicons: (ctx, hosts) => Object.fromEntries((Array.isArray(hosts) ? hosts : []).slice(0, 500).map((h) => [h, store.favicon(String(h))])),
  downloads: () => downloadList(),
  downloadAction: (ctx, v) => { downloadAction(ctx.w, v); return true; },
  clearDownloads: () => { store.clearDownloads(); privateDownloads.splice(0, privateDownloads.length, ...privateDownloads.filter((d) => d.state === "progressing")); downloadsChanged(); return true; },
  settings: (ctx) => ({ ...store.s, versions: versions(), priv: ctx.w.priv }),
  setSetting: (ctx, key, value) => {
    const ok = { theme: ["neon", "ice", "alarm", "daylight"], startup: ["restore", "newtab"] };
    if (ok[key] ? !ok[key].includes(value) : !["showBookmarksBar", "askDownloadPath", "passwordsOffer"].includes(key)) return false;
    store.set(key, ok[key] ? value : !!value);
    for (const w of windows) { pushState(w); send(w.overlay.webContents, "theme", store.s.theme); }
    broadcastPages("settings");
    return true;
  },
  chooseDownloadDir: async (ctx) => {
    const r = await dialog.showOpenDialog(ctx.w.win, { title: "İndirme klasörü", defaultPath: store.s.downloadDir, properties: ["openDirectory", "createDirectory"] });
    if (r.canceled || !r.filePaths[0]) return store.s.downloadDir;
    store.set("downloadDir", r.filePaths[0]);
    return r.filePaths[0];
  },
  revokePermission: (ctx, origin, perm) => {
    const p = store.s.permissions[origin];
    if (p) { delete p[perm]; if (!Object.keys(p).length) delete store.s.permissions[origin]; store.settings.save(); }
    return store.s.permissions;
  },
  edgeProfiles: () => Store.edgeProfiles(),
  importEdge: async (ctx, opts) => {
    const o = opts || {};
    const profile = String(o.profile || "Default");
    const r = store.importEdge({ profile, bookmarks: o.bookmarks !== false, history: o.history !== false });
    if (o.passwords) { r.passwords = await vault.importEdge(Store.edgeDir(), profile); broadcastPages("passwords"); }
    store.set("importOffered", true);
    bookmarksChanged();
    broadcastPages("history");
    return r;
  },
  clearData: async (ctx, what) => {
    const ses = ctx.w.ses;
    const w = what || {};
    if (w.history) store.clearHistory();
    if (w.cookies) await ses.clearStorageData();
    if (w.cache) await ses.clearCache();
    if (w.downloads) { store.clearDownloads(); downloadsChanged(); }
    broadcastPages("history");
    return true;
  },
  openDownloadsDir: () => { shell.openPath(store.s.downloadDir); return true; },
  openDefaultApps: () => { shell.openExternal("ms-settings:defaultapps?registeredAppUser=NeuralWeb"); return true; },
  open: (ctx, url) => { navigate(ctx.w, ctx.t, url); return true; },
  openNewTab: (ctx, url) => { createTab(ctx.w, { url: resolveInput(url) || NEWTAB, index: ctx.w.tabs.indexOf(ctx.t) + 1, background: true }); return true; },
  version: () => versions(),
  shieldInfo: () => shield.info(),
  // Password manager: only the passwords and settings pages may call these (checked in page:call).
  pwList: () => ({ logins: vault.list(), never: [...vault.data.never].sort(), offer: store.s.passwordsOffer !== false }),
  pwReveal: async (ctx, id) => {
    const l = vault.get(String(id));
    if (!l || !(await vault.verify(hwndOf(ctx.w)))) return null;
    return vault.decrypt(l);
  },
  pwCopy: async (ctx, id) => {
    const l = vault.get(String(id));
    if (!l || !(await vault.verify(hwndOf(ctx.w)))) return false;
    const p = vault.decrypt(l);
    clipboard.writeText(p);
    setTimeout(() => { if (clipboard.readText() === p) clipboard.clear(); }, 45e3); // do not leave it on the clipboard
    return true;
  },
  pwAdd: (ctx, o) => {
    const origin = loginOrigin(resolveInput(String((o && o.url) || "")) || "");
    if (!origin || !o.password) return false;
    vault.upsert({ origin, username: String(o.username || ""), password: String(o.password) });
    broadcastPages("passwords");
    return true;
  },
  pwUpdate: (ctx, id, o) => {
    const r = vault.update(String(id), { username: o && typeof o.username === "string" ? o.username : undefined, password: o && o.password ? String(o.password) : undefined });
    broadcastPages("passwords");
    return r;
  },
  pwRemove: (ctx, id) => { const r = vault.remove(String(id)); broadcastPages("passwords"); return r; },
  pwNeverRemove: (ctx, origin) => { vault.setNever(String(origin), false); broadcastPages("passwords"); return true; },
  pwImportCsv: async (ctx) => {
    const r = await dialog.showOpenDialog(ctx.w.win, { title: "Şifre dosyası (CSV)", filters: [{ name: "CSV", extensions: ["csv"] }], properties: ["openFile"] });
    if (r.canceled || !r.filePaths[0]) return null;
    let res;
    try { res = vault.importCsv(await fs.promises.readFile(r.filePaths[0], "utf8")); } catch (e) { return { error: e.message || "Dosya okunamadı." }; }
    lastCsv = r.filePaths[0];
    broadcastPages("passwords");
    return { ...res, file: path.basename(lastCsv) };
  },
  pwTrashCsv: async () => {
    if (!lastCsv) return false;
    try { await shell.trashItem(lastCsv); } catch (e) { return false; }
    lastCsv = null;
    return true;
  },
  pwImportEdge: async (ctx, profile) => { const r = await vault.importEdge(Store.edgeDir(), String(profile || "Default")); broadcastPages("passwords"); return r; },
  shieldSet: (ctx, on) => { shield.setEnabled(!!on); return shield.info(); },
  shieldAllow: (ctx, host, allowed) => { shield.setAllowed(String(host || ""), !!allowed); return shield.info(); },
  shieldUpdate: async () => {
    try { await shield.update(); } catch (e) { /* the error is in info() */ }
    return shield.info();
  },
};
ipcMain.handle("page:call", async (e, name, ...args) => {
  // Only NeuralWeb's own pages, in a tab's top frame, may call in.
  const frame = e.senderFrame;
  if (!frame || frame.parent || !isInternal(frame.url)) throw new Error("not allowed");
  const found = findTab(e.sender);
  if (!found || !Object.hasOwn(pageApi, name)) throw new Error("unknown call");
  if (name.startsWith("pw") && !/^neural:\/\/(passwords|settings)\//.test(frame.url)) throw new Error("not allowed");
  return pageApi[name]({ w: found.w, t: found.t }, ...args);
});

/* ============================================================ UI IPC */
ipcMain.on("ui:cmd", (e, name, arg) => { const w = winOf(e.sender); if (w) run(w, name, arg); });
ipcMain.on("ui:layout", (e, layout) => {
  const w = winOf(e.sender);
  if (!w) return;
  w.layout = layout;
  showActive(w);
});
ipcMain.on("ui:resize-start", (e, edge) => { const w = winOf(e.sender); if (w) startResize(w, String(edge)); });
ipcMain.on("ui:resize-end", (e) => { const w = winOf(e.sender); if (w) stopResize(w); });
ipcMain.handle("ui:suggest", async (e, text) => {
  if (!winOf(e.sender) || !text) return { local: [] };
  return { local: store.suggestions(text, 5) };
});
ipcMain.handle("ui:suggest-remote", async (e, text) => {
  const w = winOf(e.sender);
  if (!w || !text || text.length > 200) return [];
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    const res = await w.ses.fetch(`https://suggestqueries.google.com/complete/search?client=firefox&hl=tr&q=${encodeURIComponent(text)}`, { signal: ctrl.signal });
    clearTimeout(timer);
    const data = JSON.parse(await res.text());
    return Array.isArray(data[1]) ? data[1].slice(0, 6) : [];
  } catch (err) {
    return [];
  }
});
ipcMain.handle("ui:resolve", (e, text) => resolveInput(text));
ipcMain.on("ui:popup", (e, token, spec) => {
  const w = winOf(e.sender);
  if (!w) return;
  openPopup(w, { ...spec, returnFocus: spec.returnFocus || "ui" },
    (v, open) => send(w.win.webContents, "popup:picked", { token, value: v, open: !!open }),
    (reason) => send(w.win.webContents, "popup:closed", { token, reason }));
});
ipcMain.on("ui:popup-update", (e, data) => {
  const w = winOf(e.sender);
  if (w && w.popup) send(w.overlay.webContents, "popup:update", { id: w.popup.id, data });
});
ipcMain.on("ui:popup-close", (e) => { const w = winOf(e.sender); if (w) closePopup(w, "owner"); });
ipcMain.on("ui:bookmark-open", (e, url, how) => {
  const w = winOf(e.sender);
  if (!w) return;
  if (how === "tab") createTab(w, { url, background: true, index: w.tabs.length });
  else if (how === "window") createWindow({ urls: [url] });
  else if (how === "private") createWindow({ priv: true, urls: [url] });
  else navigate(w, activeTab(w), url);
});
ipcMain.handle("ui:bookmark", (e, op, a, b, c) => {
  if (!winOf(e.sender)) return null;
  let r = null;
  if (op === "add") r = store.addBookmark(a || {});
  else if (op === "update") r = store.updateBookmark(String(a), b || {});
  else if (op === "remove") r = store.removeBookmark(String(a));
  else if (op === "move") r = store.moveBookmark(String(a), String(b), Number(c));
  else return null;
  bookmarksChanged();
  return r;
});
// The overlay reports the rendered popup size; the overlay view is then fitted around it.
ipcMain.on("popup:measured", (e, id, size) => {
  const w = winOf(e.sender);
  if (w && w.popup && w.popup.id === id) placePopup(w, size);
});
ipcMain.on("popup:pick", (e, id, value, keepOpen) => {
  const w = winOf(e.sender);
  if (!w || !w.popup || w.popup.id !== id) return;
  const p = w.popup;
  if (!keepOpen) { p.onClose = null; closePopup(w, "pick"); }
  p.onPick(value, !!keepOpen);
});
ipcMain.on("popup:dismiss", (e, id) => {
  const w = winOf(e.sender);
  if (w && w.popup && w.popup.id === id) closePopup(w, "dismiss");
});

/* ============================================================ app-wide events */
app.on("certificate-error", (event, wc, url, error, certificate, callback) => {
  const host = hostOf(url);
  const key = `${host}|${certificate.fingerprint}`;
  const found = findTab(wc);
  const priv = found ? found.w.priv : false;
  if (priv ? privateCertExceptions.has(key) : store.s.certExceptions.includes(key)) {
    event.preventDefault();
    callback(true);
    return;
  }
  if (found) found.t.cert = { host, fingerprint: certificate.fingerprint, error, issuer: certificate.issuerName };
  callback(false);
});
app.on("login", (event, wc, details, authInfo, callback) => {
  const found = wc && findTab(wc);
  if (!found) return;
  event.preventDefault();
  queuePrompt(found.w, {
    title: `${authInfo.host} oturum açmanı istiyor`,
    text: authInfo.realm ? `Alan: ${authInfo.realm}` : "Bu siteye bağlantın özel değil.",
    icon: "login",
    fields: [{ id: "user", label: "Kullanıcı adı" }, { id: "pass", label: "Şifre", type: "password" }],
    buttons: [{ id: "cancel", label: "İptal" }, { id: "ok", label: "Oturum aç", primary: true }],
  }, (v) => { if (v && v.button === "ok") callback(v.values.user, v.values.pass); else callback(); });
});
app.on("web-contents-created", (e, wc) => {
  wc.on("will-attach-webview", (ev) => ev.preventDefault());
});

function urlsFromArgs(argv) {
  const out = [];
  for (const a of argv.slice(app.isPackaged ? 1 : 2)) {
    if (!a || a.startsWith("-")) continue;
    const s = a.replace(/^"(.*)"$/, "$1");
    if (/^(https?|file):/i.test(s)) out.push(s);
    else if (fs.existsSync(s)) out.push("file:///" + path.resolve(s).replace(/\\/g, "/"));
  }
  return out;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_e, argv) => {
    const urls = urlsFromArgs(argv);
    const target = [...windows].filter((w) => !w.priv).pop();
    if (!urls.length || !target) { createWindow({ urls }); return; }
    if (target.win.isMinimized()) target.win.restore();
    target.win.focus();
    for (const u of urls) createTab(target, { url: u });
  });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => saveSessionNow());
  app.on("will-quit", () => { if (store) store.close(); });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    store = new Store(app.getPath("userData"));
    shield = new Shield({
      store, dir: app.getPath("userData"),
      tabOf: (wc) => findTab(wc),
      onBlocked: (found) => shieldTick(found.w),
      onChange: shieldChanged,
    });
    shield.start();
    vault = new Vault(app.getPath("userData"), HELPERS);
    const urls = urlsFromArgs(process.argv);
    const saved = store.session.data.windows || [];
    if (store.s.startup === "restore" && saved.length) {
      saved.forEach((s, i) => createWindow({ bounds: s.bounds, maximized: s.maximized, tabs: s.tabs, active: s.active, urls: i === saved.length - 1 ? urls : null }));
      if (urls.length) { const w = [...windows].pop(); for (const u of urls) createTab(w, { url: u }); }
    } else {
      createWindow({ urls });
    }
  });
}
