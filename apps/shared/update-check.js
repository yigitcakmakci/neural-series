"use strict";
// New versions of the series: at most one question to GitHub a day for all seven programs together. The state lives
// in %APPDATA%\NeuralSeries\update.json = { enabled, lastCheck, latest: { version, url }, notified }: whichever program
// comes first claims the day's check by writing lastCheck before it asks, the answer is kept for the others, and a
// new version is announced once (notified), with a Windows notification that opens its release page.
// The request carries nothing about the user: a plain GET of the public "latest release" with a generic User-Agent.
// Tests: NEURAL_UPDATE_FILE (state), NEURAL_UPDATE_URL (a local server), NEURAL_UPDATE_DELAY (ms before the first
// check), NEURAL_TEST_NOTIFY (a file that receives one JSON line per notification instead of showing it).
// build.ps1 copies this file (and handoff.js, which opens the page) next to each program's main.js.
const fs = require("fs");
const path = require("path");

const URL = "https://api.github.com/repos/yigitcakmakci/neural-series/releases/latest";
const DAY = 24 * 3600e3;
const RETRY = 3 * 3600e3; // after a failed check (offline, GitHub down), ask again this much later
const FIRST = 30e3; // after the program starts
const EVERY = 6 * 3600e3; // programs that stay open (NeuralDeck, NeuralWeb) look again; the day rule still holds

function defaultFile(env = process.env) {
  if (env.NEURAL_UPDATE_FILE) return path.resolve(env.NEURAL_UPDATE_FILE);
  return path.join(require("electron").app.getPath("appData"), "NeuralSeries", "update.json");
}
// "v1.6.0" / "1.6.0" → [1, 6, 0]; anything else → null.
function parse(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v || "").trim());
  return m ? m.slice(1).map(Number) : null;
}
function newer(a, b) {
  const x = parse(a), y = parse(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}
function read(file) {
  try {
    const v = JSON.parse(fs.readFileSync(file, "utf8"));
    return v && typeof v === "object" ? v : {};
  } catch (e) {
    return {};
  }
}
// Through a temporary file and a rename, as theme.json and language.json.
function write(file, state) {
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, file);
    return true;
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (x) { /* never written */ }
    return false;
  }
}
const enabledIn = (s) => s.enabled !== false; // on unless the user or the setup switched it off

// name: the program; version: its own (app.getVersion()); t: its texts (language.js). In a program the rest comes from
// Electron: fetch (net.fetch, which follows Windows' proxy settings), Notification, and open(url), which shows the
// release page in NeuralWeb, or the default browser without it (handoff.js). Tests pass their own, and now/env.
function create({ name, version, t, fetch, Notification, open, file = defaultFile(), env = process.env, now = () => Date.now() }) {
  const url = env.NEURAL_UPDATE_URL || URL;
  if (!fetch) fetch = (...a) => require("electron").net.fetch(...a);
  if (Notification === undefined) Notification = require("electron").Notification;
  if (!open) {
    const handoff = require("./handoff").create({ self: name, shell: require("electron").shell, t });
    open = (u) => handoff.openUrl(u);
  }
  let timers = [];

  // The day's check belongs to whoever writes lastCheck first. A lock file (created exclusively, removed right after)
  // keeps two programs that start together from both claiming it; a lock older than a minute was left by a crash.
  function claim(t0, force) {
    const lock = `${file}.lock`;
    let fd = null;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      try { fd = fs.openSync(lock, "wx"); } catch (e) {
        let age = 0;
        try { age = Date.now() - fs.statSync(lock).mtimeMs; } catch (x) { /* just removed */ }
        if (age < 60e3) return null;
        fs.unlinkSync(lock);
        fd = fs.openSync(lock, "wx");
      }
      const s = read(file);
      if (!enabledIn(s)) return null;
      if (!force && Number.isFinite(s.lastCheck) && t0 - s.lastCheck < DAY && t0 >= s.lastCheck) return null;
      write(file, { ...s, lastCheck: t0, by: `${name}:${process.pid}` });
      return s;
    } catch (e) {
      return null;
    } finally {
      if (fd !== null) { try { fs.closeSync(fd); fs.unlinkSync(lock); } catch (e) { /* gone */ } }
    }
  }

  // Asks GitHub when the day's check is due and nobody has claimed it. Resolves to the state afterwards.
  async function check({ force = false } = {}) {
    let s = read(file);
    if (!enabledIn(s)) return s;
    const t0 = now();
    if (!claim(t0, force)) return read(file);
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15e3);
      let res;
      try {
        res = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/vnd.github+json", "User-Agent": "Neural-Series-update-check" } });
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      if (!parse(body.tag_name) || !/^https:\/\/github\.com\//.test(String(body.html_url || ""))) throw new Error("unexpected answer");
      s = { ...read(file), lastCheck: t0, latest: { version: String(body.tag_name).replace(/^v/, ""), url: body.html_url }, lastError: undefined };
    } catch (e) {
      s = { ...read(file), lastCheck: t0 - DAY + RETRY, lastError: String(e.message || e).slice(0, 200) };
    }
    write(file, s);
    return s;
  }

  // A newer version than this program's, once per version for the whole series.
  function announce(s) {
    const v = s.latest && s.latest.version;
    if (!enabledIn(s) || !v || !newer(v, version) || s.notified === v) return false;
    write(file, { ...read(file), notified: v });
    const title = t("update.notify.title", { version: v });
    const body = t("update.notify.body");
    if (env.NEURAL_TEST_NOTIFY) {
      try { fs.appendFileSync(env.NEURAL_TEST_NOTIFY, JSON.stringify({ by: name, title, body, url: s.latest.url }) + "\n"); } catch (e) { /* the test reports it */ }
      return true;
    }
    if (Notification && Notification.isSupported()) {
      const n = new Notification({ title, body });
      n.on("click", () => open(s.latest.url));
      n.show();
    }
    return true;
  }

  async function run(opts) {
    try { announce(await check(opts)); } catch (e) { /* never in the user's way */ }
  }

  // What the menus show: the switch, and the newer version when one is known.
  function state() {
    const s = read(file);
    const v = s.latest && s.latest.version;
    return { enabled: enabledIn(s), current: version, latest: v && newer(v, version) ? { version: v, url: s.latest.url } : null };
  }

  return {
    check, announce, state, run,
    // After the program has started, then every few hours while it stays open.
    start() {
      const delay = /^\d+$/.test(env.NEURAL_UPDATE_DELAY || "") ? Number(env.NEURAL_UPDATE_DELAY) : FIRST;
      timers.push(setTimeout(() => run(), delay));
      const every = setInterval(() => run(), EVERY);
      if (every.unref) every.unref();
      timers.push(every);
    },
    stop() { for (const x of timers) { clearTimeout(x); clearInterval(x); } timers = []; },
    setEnabled(on) {
      write(file, { ...read(file), enabled: !!on });
      if (on) run();
      return state();
    },
    openLatest() {
      const s = state();
      if (s.latest) open(s.latest.url);
      return !!s.latest;
    },
    // The page asks for the state, switches checking on or off, and opens the newer version's page.
    wire(ipcMain) {
      ipcMain.handle("neural:update-state", () => state());
      ipcMain.handle("neural:update-set", (_e, on) => this.setEnabled(!!on));
      ipcMain.handle("neural:update-open", () => this.openLatest());
    },
  };
}

module.exports = { create, newer, parse, read, write, defaultFile, URL };
