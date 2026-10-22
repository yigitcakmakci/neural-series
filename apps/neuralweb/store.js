"use strict";
// NeuralWeb data: settings, bookmarks, session and downloads as small JSON files; history and favicons in SQLite;
// and the Edge import. Plain Node, so it can be tested without Electron.
const fs = require("fs");
const path = require("path");
const os = require("os");
const { DatabaseSync } = require("node:sqlite");

const WEBKIT_EPOCH_OFFSET = 11644473600000; // ms between 1601-01-01 and 1970-01-01

class JsonFile {
  constructor(file, fallback) {
    this.file = file;
    this.timer = null;
    try { this.data = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { this.data = fallback(); }
  }
  save(now = false) {
    clearTimeout(this.timer);
    const write = () => {
      try {
        const tmp = this.file + ".tmp";
        fs.writeFileSync(tmp, JSON.stringify(this.data));
        fs.renameSync(tmp, this.file);
      } catch (e) { /* not critical */ }
    };
    if (now) write(); else this.timer = setTimeout(write, 400);
  }
}

const hostOf = (url) => { try { return new URL(url).hostname; } catch (e) { return ""; } };
let seq = Date.now();
const newId = () => (++seq).toString(36);

class Store {
  constructor(dir) {
    fs.mkdirSync(dir, { recursive: true });
    this.dir = dir;
    this.settings = new JsonFile(path.join(dir, "settings.json"), () => ({}));
    this.settings.data = Object.assign({
      theme: "neon",
      showBookmarksBar: true,
      startup: "restore",
      askDownloadPath: false,
      downloadDir: path.join(os.homedir(), "Downloads"),
      zoom: {},
      permissions: {},
      certExceptions: [],
      importOffered: false,
      passwordsOffer: true,
      shield: { enabled: true, allow: [], total: 0, day: "", today: 0, updated: 0, rules: 0, error: null },
    }, this.settings.data);
    this.bookmarks = new JsonFile(path.join(dir, "bookmarks.json"), () => ({
      bar: { id: "bar", type: "folder", title: "Yer imleri çubuğu", children: [] },
      other: { id: "other", type: "folder", title: "Diğer yer imleri", children: [] },
    }));
    this.session = new JsonFile(path.join(dir, "session.json"), () => ({ windows: [] }));
    this.downloads = new JsonFile(path.join(dir, "downloads.json"), () => ({ items: [] }));

    this.db = new DatabaseSync(path.join(dir, "history.sqlite"));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS urls (id INTEGER PRIMARY KEY, url TEXT UNIQUE NOT NULL, host TEXT, title TEXT, visit_count INTEGER DEFAULT 0, last_visit INTEGER);
      CREATE INDEX IF NOT EXISTS urls_last ON urls(last_visit DESC);
      CREATE INDEX IF NOT EXISTS urls_host ON urls(host);
      CREATE TABLE IF NOT EXISTS favicons (host TEXT PRIMARY KEY, data TEXT, updated INTEGER);
    `);
    this.q = {
      visit: this.db.prepare(`INSERT INTO urls (url, host, title, visit_count, last_visit) VALUES (?, ?, ?, 1, ?)
        ON CONFLICT(url) DO UPDATE SET visit_count = visit_count + 1, last_visit = excluded.last_visit, title = COALESCE(NULLIF(excluded.title, ''), urls.title)`),
      title: this.db.prepare("UPDATE urls SET title = ? WHERE url = ?"),
      recent: this.db.prepare("SELECT url, title, host, visit_count AS visits, last_visit AS time FROM urls ORDER BY last_visit DESC LIMIT ? OFFSET ?"),
      search: this.db.prepare("SELECT url, title, host, visit_count AS visits, last_visit AS time FROM urls WHERE url LIKE ? OR title LIKE ? ORDER BY last_visit DESC LIMIT ? OFFSET ?"),
      suggest: this.db.prepare("SELECT url, title FROM urls WHERE url LIKE ? OR title LIKE ? ORDER BY visit_count DESC, last_visit DESC LIMIT ?"),
      top: this.db.prepare(`SELECT host, SUM(visit_count) AS visits, MAX(last_visit) AS time,
        (SELECT title FROM urls u2 WHERE u2.host = urls.host ORDER BY visit_count DESC LIMIT 1) AS title
        FROM urls WHERE host != '' AND host NOT LIKE '%google.%' AND url LIKE 'http%' GROUP BY host ORDER BY visits DESC LIMIT ?`),
      remove: this.db.prepare("DELETE FROM urls WHERE url = ?"),
      clear: this.db.prepare("DELETE FROM urls"),
      count: this.db.prepare("SELECT COUNT(*) AS n FROM urls"),
      favGet: this.db.prepare("SELECT data FROM favicons WHERE host = ?"),
      favSet: this.db.prepare("INSERT INTO favicons (host, data, updated) VALUES (?, ?, ?) ON CONFLICT(host) DO UPDATE SET data = excluded.data, updated = excluded.updated"),
      merge: this.db.prepare(`INSERT INTO urls (url, host, title, visit_count, last_visit) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(url) DO UPDATE SET visit_count = MAX(visit_count, excluded.visit_count), last_visit = MAX(last_visit, excluded.last_visit), title = COALESCE(NULLIF(urls.title, ''), excluded.title)`),
    };
  }

  get s() { return this.settings.data; }
  set(key, value) { this.settings.data[key] = value; this.settings.save(); }

  /* ---------- history ---------- */
  recordVisit(url, title) {
    if (!/^https?:/i.test(url)) return;
    this.q.visit.run(url, hostOf(url), title || "", Date.now());
  }
  updateTitle(url, title) { if (title) this.q.title.run(title, url); }
  history({ query = "", limit = 200, offset = 0 } = {}) {
    if (!query) return this.q.recent.all(limit, offset);
    const like = `%${query}%`;
    return this.q.search.all(like, like, limit, offset);
  }
  suggestions(text, limit = 6) {
    const like = `%${text}%`;
    const fromHistory = this.q.suggest.all(like, like, limit).map((r) => ({ type: "history", url: r.url, title: r.title }));
    const t = text.toLocaleLowerCase("tr-TR");
    const fromBookmarks = this.allBookmarks()
      .filter((b) => b.url.toLocaleLowerCase("tr-TR").includes(t) || (b.title || "").toLocaleLowerCase("tr-TR").includes(t))
      .slice(0, 3)
      .map((b) => ({ type: "bookmark", url: b.url, title: b.title }));
    const seen = new Set();
    return [...fromBookmarks, ...fromHistory].filter((x) => !seen.has(x.url) && seen.add(x.url)).slice(0, limit);
  }
  topSites(limit = 8) {
    return this.q.top.all(limit).map((r) => ({ url: `https://${r.host}/`, host: r.host, title: r.title || r.host, favicon: this.favicon(r.host) }));
  }
  removeHistory(url) { this.q.remove.run(url); }
  clearHistory() { this.q.clear.run(); }
  historyCount() { return this.q.count.get().n; }

  /* ---------- favicons ---------- */
  favicon(host) { const r = host && this.q.favGet.get(host); return r ? r.data : null; }
  setFavicon(host, data) { if (host && data && data.length < 200000) this.q.favSet.run(host, data, Date.now()); }

  /* ---------- bookmarks ---------- */
  get roots() { return this.bookmarks.data; }
  *walk(node = null) {
    const nodes = node ? [node] : [this.roots.bar, this.roots.other];
    for (const n of nodes) {
      yield n;
      if (n.children) for (const c of n.children) yield* this.walk(c);
    }
  }
  allBookmarks() { return [...this.walk()].filter((n) => n.type === "url"); }
  findNode(id) {
    for (const n of this.walk()) if (n.id === id) return n;
    return null;
  }
  parentOf(id) {
    for (const n of this.walk()) if (n.children && n.children.some((c) => c.id === id)) return n;
    return null;
  }
  bookmarkFor(url) { return this.allBookmarks().find((b) => b.url === url) || null; }
  addBookmark({ parentId = "bar", title, url, type = "url", index = -1 }) {
    const parent = this.findNode(parentId) || this.roots.bar;
    const node = type === "folder" ? { id: newId(), type, title: title || "Yeni klasör", children: [] } : { id: newId(), type: "url", title: title || url, url, added: Date.now() };
    if (index < 0 || index > parent.children.length) parent.children.push(node); else parent.children.splice(index, 0, node);
    this.bookmarks.save();
    return node;
  }
  updateBookmark(id, { title, url }) {
    const n = this.findNode(id);
    if (!n || n.id === "bar" || n.id === "other") return null;
    if (typeof title === "string" && title.trim()) n.title = title.trim();
    if (n.type === "url" && typeof url === "string" && url.trim()) n.url = url.trim();
    this.bookmarks.save();
    return n;
  }
  removeBookmark(id) {
    const p = this.parentOf(id);
    if (!p) return false;
    p.children = p.children.filter((c) => c.id !== id);
    this.bookmarks.save();
    return true;
  }
  moveBookmark(id, parentId, index) {
    const node = this.findNode(id);
    const target = this.findNode(parentId);
    if (!node || !target || target.type !== "folder" || [...this.walk(node)].includes(target)) return false;
    this.parentOf(id).children = this.parentOf(id).children.filter((c) => c.id !== id);
    if (index < 0 || index > target.children.length) target.children.push(node); else target.children.splice(index, 0, node);
    this.bookmarks.save();
    return true;
  }

  /* ---------- downloads ---------- */
  putDownload(d) {
    const list = this.downloads.data.items;
    const i = list.findIndex((x) => x.id === d.id);
    if (i >= 0) list[i] = { ...list[i], ...d }; else list.unshift(d);
    if (list.length > 300) list.length = 300;
    this.downloads.save();
  }
  removeDownload(id) {
    this.downloads.data.items = this.downloads.data.items.filter((x) => x.id !== id);
    this.downloads.save();
  }
  clearDownloads() {
    this.downloads.data.items = this.downloads.data.items.filter((x) => x.state === "progressing");
    this.downloads.save();
  }

  /* ---------- Edge import ---------- */
  static edgeDir() { return process.env.NEURALWEB_EDGE_DIR || path.join(process.env.LOCALAPPDATA || "", "Microsoft", "Edge", "User Data"); }
  static edgeProfiles(dir = Store.edgeDir()) {
    const out = [];
    try {
      const state = JSON.parse(fs.readFileSync(path.join(dir, "Local State"), "utf8"));
      for (const [key, info] of Object.entries((state.profile && state.profile.info_cache) || {})) {
        if (fs.existsSync(path.join(dir, key))) out.push({ dir: key, name: info.name || key });
      }
    } catch (e) { /* no Local State */ }
    if (!out.length && fs.existsSync(path.join(dir, "Default"))) out.push({ dir: "Default", name: "Varsayılan" });
    return out;
  }
  importEdge({ profile = "Default", bookmarks = true, history = true, dir = Store.edgeDir() } = {}) {
    const base = path.join(dir, profile);
    const result = { bookmarks: 0, history: 0, errors: [] };
    if (bookmarks) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(base, "Bookmarks"), "utf8"));
        const known = new Set(this.allBookmarks().map((b) => b.url));
        const convert = (n, into) => {
          if (n.type === "url") {
            if (!n.url || known.has(n.url)) return;
            known.add(n.url);
            into.children.push({ id: newId(), type: "url", title: n.name || n.url, url: n.url, added: webkitToMs(n.date_added) || Date.now() });
            result.bookmarks += 1;
          } else if (n.type === "folder") {
            const folder = { id: newId(), type: "folder", title: n.name || "Klasör", children: [] };
            for (const c of n.children || []) convert(c, folder);
            if (folder.children.length) into.children.push(folder);
          }
        };
        const roots = data.roots || {};
        for (const c of (roots.bookmark_bar && roots.bookmark_bar.children) || []) convert(c, this.roots.bar);
        const rest = { id: newId(), type: "folder", title: "Edge'den aktarılanlar", children: [] };
        for (const key of ["other", "synced"]) for (const c of (roots[key] && roots[key].children) || []) convert(c, rest);
        if (rest.children.length) this.roots.other.children.push(rest);
        this.bookmarks.save(true);
      } catch (e) {
        result.errors.push(e.code === "ENOENT" ? "Edge yer imleri bulunamadı." : "Yer imleri okunamadı: " + e.message);
      }
    }
    if (history) {
      const tmp = path.join(os.tmpdir(), `neuralweb-edge-history-${process.pid}.sqlite`);
      try {
        fs.copyFileSync(path.join(base, "History"), tmp);
        const src = new DatabaseSync(tmp, { readOnly: true });
        // Edge keeps microseconds since 1601, too large for a JS number; convert to ms since 1970 inside SQLite.
        const rows = src.prepare(`SELECT url, title, visit_count, (last_visit_time / 1000 - ${WEBKIT_EPOCH_OFFSET}) AS last_ms
          FROM urls WHERE hidden = 0 ORDER BY last_visit_time DESC LIMIT 50000`).all();
        src.close();
        this.db.exec("BEGIN");
        for (const r of rows) {
          if (!/^https?:/i.test(r.url)) continue;
          this.q.merge.run(r.url, hostOf(r.url), r.title || "", r.visit_count || 1, r.last_ms > 0 ? r.last_ms : Date.now());
          result.history += 1;
        }
        this.db.exec("COMMIT");
      } catch (e) {
        try { this.db.exec("ROLLBACK"); } catch (x) { /* nothing open */ }
        result.errors.push(e.code === "EBUSY" ? "Edge açıkken geçmiş kopyalanamadı; Edge'i kapatıp yeniden deneyin." : e.code === "ENOENT" ? "Edge geçmişi bulunamadı." : "Geçmiş okunamadı: " + e.message);
      } finally {
        try { fs.rmSync(tmp, { force: true }); } catch (e) { /* temp file */ }
      }
    }
    return result;
  }

  close() {
    this.settings.save(true);
    this.bookmarks.save(true);
    this.session.save(true);
    this.downloads.save(true);
    try { this.db.close(); } catch (e) { /* already closed */ }
  }
}

function webkitToMs(t) {
  const n = Number(t);
  return n > 0 ? Math.round(n / 1000 - WEBKIT_EPOCH_OFFSET) : 0;
}

module.exports = { Store, hostOf, webkitToMs };
