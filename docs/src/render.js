"use strict";
// Renders the README images from the HTML pages next to this file, at twice their CSS size.
//   node_modules\electron\dist\electron.exe docs\src\render.js
// The pages use the bundled typefaces in out\fonts and the screenshots in docs\images, so run build.ps1 first.
// The page size is set through the DevTools protocol, so images larger than the screen come out whole.
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");

const JOBS = [
  { page: "banner.html", width: 1280, height: 440, out: "banner.png" },
  { page: "showcase.html", width: 1600, height: 980, out: "showcase.png" },
];

app.on("window-all-closed", () => { /* one window per image; keep running until the last one is written */ });
app.whenReady().then(async () => {
  for (const job of JOBS) {
    // Offscreen rendering keeps producing frames although the window is never shown.
    const win = new BrowserWindow({ width: 800, height: 600, show: false, frame: false, webPreferences: { offscreen: true } });
    await win.loadFile(path.join(__dirname, job.page));
    const dbg = win.webContents.debugger;
    dbg.attach("1.3");
    await dbg.sendCommand("Emulation.setDeviceMetricsOverride", { width: job.width, height: job.height, deviceScaleFactor: 2, mobile: false });
    await dbg.sendCommand("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
    await win.webContents.executeJavaScript(
      "document.fonts.ready.then(() => Promise.all([...document.images].map((i) => i.decode().catch(() => 0)))).then(() => new Promise((r) => setTimeout(r, 800)))");
    const shot = await dbg.sendCommand("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    const out = path.join(__dirname, "..", "images", job.out);
    fs.writeFileSync(out, Buffer.from(shot.data, "base64"));
    console.log(`${job.out}: ${fs.statSync(out).size} bytes`);
    dbg.detach();
    win.destroy();
  }
  app.quit();
}).catch((e) => { console.error(e); app.exit(1); });
