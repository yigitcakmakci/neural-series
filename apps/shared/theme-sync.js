"use strict";
// The series theme: one small file, %APPDATA%\NeuralSeries\theme.json = { theme, changedAt, by }, that every Neural
// program with themes reads at startup and watches while it runs. A program writes it when the user picks a theme
// there; the others follow within a moment. NEURAL_THEME_FILE points tests at another file.
// build.ps1 copies this file next to each program's main.js; from source it is loaded from apps\shared.
const fs = require("fs");
const path = require("path");

const THEMES = ["neon", "ice", "alarm", "daylight"];
const DEBOUNCE = 120;
const POLL = 1000; // only when the folder cannot be watched

function defaultFile() {
  if (process.env.NEURAL_THEME_FILE) return path.resolve(process.env.NEURAL_THEME_FILE);
  return path.join(require("electron").app.getPath("appData"), "NeuralSeries", "theme.json");
}
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

class ThemeSync {
  // name: the program ("NeuralPad"); onChange(theme): another program changed the series theme.
  constructor({ name, file, onChange }) {
    this.file = file || defaultFile();
    this.me = `${name}:${process.pid}`;
    this.onChange = onChange || (() => {});
    this.last = null; // the newest state seen or written: { theme, changedAt, by }
    this.watcher = null;
    this.timer = null;
    this.poller = null;
  }

  read() {
    try {
      const v = JSON.parse(fs.readFileSync(this.file, "utf8"));
      return v && THEMES.includes(v.theme) && Number.isFinite(v.changedAt) && typeof v.by === "string" ? v : null;
    } catch (e) {
      return null;
    }
  }

  // Writes through a temporary file and a rename, so a reader never sees half a file. When two programs write at
  // once, the rename that lands last wins, whatever its changedAt: the file is the one truth everybody follows, and
  // a follower never writes back, so nothing can bounce.
  write(theme) {
    if (!THEMES.includes(theme)) return false;
    const seen = this.read();
    const floor = Math.max(this.last ? this.last.changedAt : 0, seen ? seen.changedAt : 0);
    const v = { theme, changedAt: Math.max(Date.now(), floor + 1), by: this.me };
    const tmp = `${this.file}.${process.pid}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(v));
      for (let i = 0; ; i++) {
        try { fs.renameSync(tmp, this.file); break; } catch (e) {
          if (i >= 9 || (e.code !== "EPERM" && e.code !== "EBUSY" && e.code !== "EACCES")) throw e;
          pause(15); // another program is reading it right now
        }
      }
      this.last = v;
      return true;
    } catch (e) {
      try { fs.rmSync(tmp, { force: true }); } catch (e2) { /* nothing to clean */ }
      return false;
    }
  }

  // A state other than the last one seen or written by this program (it may carry an older changedAt when it won
  // a race between two writers).
  isOther(v) {
    const l = this.last;
    return !l || v.changedAt !== l.changedAt || v.by !== l.by;
  }

  check() {
    const v = this.read();
    if (!v || !this.isOther(v)) return;
    this.last = v;
    if (v.by !== this.me) this.onChange(v.theme);
  }

  start() {
    if (this.watcher || this.poller) return this;
    this.last = this.read() || this.last;
    const dir = path.dirname(this.file);
    const base = path.basename(this.file).toLowerCase();
    const later = () => { clearTimeout(this.timer); this.timer = setTimeout(() => this.check(), DEBOUNCE); };
    try {
      fs.mkdirSync(dir, { recursive: true });
      this.watcher = fs.watch(dir, { persistent: false }, (_ev, name) => { if (!name || String(name).toLowerCase() === base) later(); });
      this.watcher.on("error", () => { this.stop(); this.poll(); });
    } catch (e) {
      this.poll();
    }
    return this;
  }

  poll() {
    if (!this.poller) { this.poller = setInterval(() => this.check(), POLL); this.poller.unref?.(); }
  }

  stop() {
    clearTimeout(this.timer);
    if (this.watcher) { try { this.watcher.close(); } catch (e) { /* closed */ } this.watcher = null; }
    if (this.poller) { clearInterval(this.poller); this.poller = null; }
  }
}

// Main-process side for programs that keep the theme in their pages (NeuralPad, NeuralNav, NeuralTerm, NeuralView).
// The page asks <prefix>:theme-init at startup with its own theme and "follow the series" setting, sends
// <prefix>:theme-set when the user picks a theme and <prefix>:theme-sync when the setting changes; it receives
// <prefix>:theme-apply and <prefix>:theme-sync-state. The program's other windows always follow each other.
function wire({ ipcMain, BrowserWindow, prefix, name, file }) {
  let follow = true;
  const windows = () => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && !w.webContents.isDestroyed());
  const send = (channel, value, except) => { for (const w of windows()) if (w.webContents !== except) w.webContents.send(channel, value); };
  const sync = new ThemeSync({ name, file, onChange: (theme) => { if (follow) send(`${prefix}:theme-apply`, theme); } }).start();

  ipcMain.handle(`${prefix}:theme-init`, (_e, theme, enabled) => {
    follow = !!enabled;
    const v = follow ? sync.read() : null;
    return v ? v.theme : String(theme);
  });
  ipcMain.on(`${prefix}:theme-set`, (e, theme) => {
    if (!THEMES.includes(theme)) return;
    if (follow) sync.write(theme);
    send(`${prefix}:theme-apply`, theme, e.sender);
  });
  ipcMain.on(`${prefix}:theme-sync`, (e, enabled, theme) => {
    follow = !!enabled;
    send(`${prefix}:theme-sync-state`, follow, e.sender);
    if (!follow) return;
    // Switched on: take the series theme, or make this program's theme the series theme if there is none yet.
    const v = sync.read();
    if (v) send(`${prefix}:theme-apply`, v.theme);
    else if (THEMES.includes(theme)) sync.write(theme);
  });
  return sync;
}

module.exports = { ThemeSync, wire, THEMES };
