"use strict";
// Desktop shell for NeuralCalc KX-9: a frameless, transparent window that is shaped by the page itself.
const { app, BrowserWindow, ipcMain, screen, Menu } = require("electron");
const fs = require("fs");
const path = require("path");

app.setAppUserModelId("NeuralCalc.KX9");

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let win = null;
  let placed = false;

  const posFile = () => path.join(app.getPath("userData"), "window.json");
  const readPos = () => {
    try {
      const p = JSON.parse(fs.readFileSync(posFile(), "utf8"));
      return Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null;
    } catch (e) {
      return null;
    }
  };
  const savePos = () => {
    if (!win) return;
    const [x, y] = win.getPosition();
    try { fs.writeFileSync(posFile(), JSON.stringify({ x, y })); } catch (e) { /* not critical */ }
  };

  function createWindow() {
    Menu.setApplicationMenu(null);
    win = new BrowserWindow({
      width: 488,
      height: 900,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      hasShadow: false,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      title: "NeuralCalc KX-9",
      icon: path.join(__dirname, "neuralcalc.ico"),
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
      },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (e) => e.preventDefault());
    win.on("maximize", () => win.unmaximize());
    win.on("moved", savePos);
    win.on("closed", () => { win = null; });
    win.loadFile(path.join(__dirname, "index.html"));
  }

  // The page reports the size of the device (plus its transparent margin); the window wraps it exactly.
  // On short screens the whole page is zoomed down so the calculator still fits.
  function fit(w, h) {
    if (!win || !(w > 0 && h > 0)) return;
    const saved = placed ? null : readPos();
    const display = saved ? screen.getDisplayNearestPoint(saved) : screen.getDisplayMatching(win.getBounds());
    const area = display.workArea;
    const zoom = Math.min(1, area.height / h);
    win.webContents.setZoomFactor(zoom);
    const width = Math.ceil(w * zoom);
    const height = Math.ceil(h * zoom);
    let x;
    let y;
    if (placed) {
      [x, y] = win.getPosition();
    } else if (saved) {
      ({ x, y } = saved);
    } else {
      x = Math.round(area.x + (area.width - width) / 2);
      y = Math.round(area.y + (area.height - height) / 2);
    }
    x = Math.min(Math.max(x, area.x), area.x + area.width - width);
    y = Math.min(Math.max(y, area.y), area.y + area.height - height);
    win.setBounds({ x, y, width, height });
    if (!placed) {
      placed = true;
      win.show();
    }
  }

  const fromWin = (e) => win && e.sender === win.webContents;
  ipcMain.on("kx9:minimize", (e) => { if (fromWin(e)) win.minimize(); });
  ipcMain.on("kx9:close", (e) => { if (fromWin(e)) win.close(); });
  ipcMain.on("kx9:fit", (e, w, h) => { if (fromWin(e)) fit(w, h); });
  ipcMain.on("kx9:pass", (e, on) => {
    if (!fromWin(e)) return;
    if (on) win.setIgnoreMouseEvents(true, { forward: true });
    else win.setIgnoreMouseEvents(false);
  });

  app.on("second-instance", () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.on("window-all-closed", () => app.quit());
  app.whenReady().then(createWindow);
}
