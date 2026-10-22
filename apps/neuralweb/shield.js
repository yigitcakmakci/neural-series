"use strict";
// NeuralWeb's shield: Ghostery's filter engine fed with EasyList, EasyPrivacy, uBlock Origin and Peter Lowe's
// lists. It is wired into each browsing session here rather than with the library's own helper, which can only
// serve one session (its IPC handlers are global) and has no per-site switch.
const fs = require("fs");
const path = require("path");
const { ipcMain, net } = require("electron");
const { ElectronBlocker, adsAndTrackingLists, fromElectronDetails } = require("@ghostery/adblocker-electron");

const PRELOAD = require.resolve("@ghostery/adblocker-electron-preload");
const REFRESH_MS = 4 * 24 * 3600e3;
const CONFIG = { loadNetworkFilters: true, loadCosmeticFilters: true, enableCompression: true, enableMutationObserver: true };
const MIN_RULES = 50000; // a list download that parses to fewer rules than this is treated as broken

const hostOf = (url) => { try { return new URL(url).hostname.toLowerCase(); } catch (e) { return ""; } };
const bareHost = (host) => host.replace(/^www\./, "");
const today = () => new Date().toISOString().slice(0, 10);

class Shield {
  // store: NeuralWeb's Store (settings live in store.s.shield); tabOf(webContents) → { w, t } or null;
  // onBlocked(found) after each blocked request of a tab; onChange() when settings or lists change.
  constructor({ store, dir, tabOf, onBlocked, onChange }) {
    this.store = store;
    this.file = path.join(dir, "shield-engine.bin");
    this.tabOf = tabOf;
    this.onBlocked = onBlocked;
    this.onChange = onChange;
    this.engine = null;
    this.updating = null;
    this.sessions = new WeakSet();
    ipcMain.handle("@ghostery/adblocker/inject-cosmetic-filters", (event, url, msg) => {
      if (!this.active(url) || this.allowedUrl(event.sender.getURL())) return undefined;
      return this.engine.onInjectCosmeticFilters(event, url, msg);
    });
    ipcMain.handle("@ghostery/adblocker/is-mutation-observer-enabled", () => !!(this.engine && this.s.enabled));
  }

  get s() { return this.store.s.shield; }
  save() { this.store.settings.save(); }
  active(url) { return !!(this.engine && this.s.enabled && /^https?:/i.test(url || "")); }

  /* ---------- per-site switch ---------- */
  allowedUrl(url) { return this.allowedHost(hostOf(url)); }
  allowedHost(host) {
    const h = bareHost(host || "");
    return !!h && this.s.allow.some((a) => h === a || h.endsWith("." + a));
  }
  setAllowed(host, allowed) {
    const h = bareHost((host || "").toLowerCase());
    if (!h) return;
    this.s.allow = this.s.allow.filter((a) => a !== h && !(allowed === false && (h.endsWith("." + a) || a.endsWith("." + h))));
    if (allowed) this.s.allow.push(h);
    this.s.allow.sort();
    this.save();
    this.onChange();
  }
  setEnabled(on) {
    this.s.enabled = !!on;
    this.save();
    if (this.s.enabled && !this.engine) this.update().catch(() => {});
    this.onChange();
  }

  /* ---------- sessions ---------- */
  attach(ses, priv) {
    if (this.sessions.has(ses)) return;
    this.sessions.add(ses);
    ses.registerPreloadScript({ type: "frame", id: "neuralweb-shield", filePath: PRELOAD });
    ses.webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, (details, callback) => this.onBeforeRequest(details, callback, priv));
    ses.webRequest.onHeadersReceived({ urls: ["<all_urls>"] }, (details, callback) => this.onHeadersReceived(details, callback));
  }
  pageUrl(details) {
    if (details.resourceType === "mainFrame") return details.url;
    try { return details.webContents ? details.webContents.getURL() : ""; } catch (e) { return ""; }
  }
  onBeforeRequest(details, callback, priv) {
    const page = this.pageUrl(details);
    if (details.resourceType === "mainFrame" || !this.active(details.url) || /^neural:/i.test(page) || this.allowedUrl(page)) return callback({});
    const { redirect, match } = this.engine.match(fromElectronDetails(details));
    if (!redirect && !match) return callback({});
    callback(redirect ? { redirectURL: redirect.dataUrl } : { cancel: true });
    this.count(details, priv);
  }
  onHeadersReceived(details, callback) {
    const page = this.pageUrl(details);
    if (!this.active(details.url) || this.allowedUrl(page)) return callback({});
    this.engine.onHeadersReceived(details, callback);
  }
  count(details, priv) {
    const found = details.webContents ? this.tabOf(details.webContents) : null;
    if (found) {
      const t = found.t;
      t.blocked = (t.blocked || 0) + 1;
      const h = hostOf(details.url);
      if (!t.blockedHosts) t.blockedHosts = new Map();
      t.blockedHosts.set(h, (t.blockedHosts.get(h) || 0) + 1);
      this.onBlocked(found);
    }
    if (priv) return; // private windows leave no trace, not even in the counters
    const d = today();
    if (this.s.day !== d) { this.s.day = d; this.s.today = 0; }
    this.s.today += 1;
    this.s.total += 1;
    this.save();
  }

  /* ---------- filter lists ---------- */
  async start() {
    try {
      this.engine = ElectronBlocker.deserialize(await fs.promises.readFile(this.file));
    } catch (e) {
      this.engine = null; // first run, or a cache from another engine version
    }
    const stale = () => !this.engine || Date.now() - (this.s.updated || 0) > REFRESH_MS;
    if (this.s.enabled && stale()) this.update().catch(() => {});
    this.timer = setInterval(() => { if (this.s.enabled && stale()) this.update().catch(() => {}); }, 6 * 3600e3);
  }
  update() {
    if (this.updating) return this.updating;
    this.updating = (async () => {
      this.onChange();
      const fetchList = async (url) => {
        const res = await net.fetch(url, { cache: "no-cache" });
        if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
        return res;
      };
      try {
        // NEURALWEB_SHIELD_EXTRA_LISTS: extra list URLs (comma separated), used by the tests.
        const extra = (process.env.NEURALWEB_SHIELD_EXTRA_LISTS || "").split(",").filter(Boolean);
        const engine = await ElectronBlocker.fromLists(fetchList, [...adsAndTrackingLists, ...extra], CONFIG);
        const f = engine.getFilters();
        const rules = f.networkFilters.length + f.cosmeticFilters.length;
        if (rules < MIN_RULES) throw new Error(`liste eksik indi (${rules} kural)`);
        const tmp = this.file + ".tmp";
        await fs.promises.writeFile(tmp, engine.serialize());
        await fs.promises.rename(tmp, this.file);
        this.engine = engine;
        Object.assign(this.s, { updated: Date.now(), rules, error: null });
      } catch (e) {
        this.s.error = String(e && e.message ? e.message : e);
        throw e;
      } finally {
        this.save();
        this.updating = null;
        this.onChange();
      }
    })();
    return this.updating;
  }

  info() {
    const d = today();
    return {
      enabled: this.s.enabled, ready: !!this.engine, updating: !!this.updating,
      rules: this.s.rules || 0, updated: this.s.updated || 0, error: this.s.error || null,
      total: this.s.total || 0, today: this.s.day === d ? this.s.today : 0, allow: [...this.s.allow],
    };
  }
}

module.exports = { Shield, bareHost };
