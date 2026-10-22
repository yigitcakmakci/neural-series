"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { DatabaseSync } = require("node:sqlite");
const { Store } = require(path.join(__dirname, "..", "..", "apps", "neuralweb", "store.js"));

const box = path.join(__dirname, "store-sandbox");
fs.rmSync(box, { recursive: true, force: true });
let passed = 0;
const ok = (c, label) => { assert.ok(c, label); passed++; console.log("  ok  " + label); };

// A fake Edge profile in Edge's own formats
const edge = path.join(box, "Edge User Data");
fs.mkdirSync(path.join(edge, "Default"), { recursive: true });
fs.writeFileSync(path.join(edge, "Local State"), JSON.stringify({ profile: { info_cache: { Default: { name: "Kişisel" } } } }));
const wk = (ms) => String((ms + 11644473600000) * 1000);
fs.writeFileSync(path.join(edge, "Default", "Bookmarks"), JSON.stringify({ roots: {
  bookmark_bar: { type: "folder", children: [
    { type: "url", name: "Ekşi Sözlük", url: "https://eksisozluk.com/", date_added: wk(1700000000000) },
    { type: "folder", name: "İş", children: [{ type: "url", name: "GitHub", url: "https://github.com/" }] },
  ] },
  other: { type: "folder", children: [{ type: "url", name: "Hacker News", url: "https://news.ycombinator.com/" }] },
  synced: { type: "folder", children: [] },
} }));
const h = new DatabaseSync(path.join(edge, "Default", "History"));
h.exec("CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT, title TEXT, visit_count INTEGER, typed_count INTEGER, last_visit_time INTEGER, hidden INTEGER)");
const ins = h.prepare("INSERT INTO urls (url, title, visit_count, typed_count, last_visit_time, hidden) VALUES (?, ?, ?, 0, ?, ?)");
ins.run("https://www.youtube.com/watch?v=1", "Müzik videosu", 40, Number(wk(Date.now() - 3600e3)), 0);
ins.run("https://github.com/anthropics", "Anthropic · GitHub", 12, Number(wk(Date.now() - 7200e3)), 0);
ins.run("https://gizli.example/", "gizli", 3, Number(wk(Date.now())), 1);
h.close();

const store = new Store(path.join(box, "profile"));
ok(Store.edgeProfiles(edge).map((p) => p.name).join() === "Kişisel", "lists Edge profiles with their names");
const r = store.importEdge({ profile: "Default", dir: edge });
ok(r.bookmarks === 3 && r.history === 2 && r.errors.length === 0, `imports Edge bookmarks and visible history (${JSON.stringify(r)})`);
ok(store.roots.bar.children[0].title === "Ekşi Sözlük" && store.roots.bar.children[1].type === "folder", "bar bookmarks keep their order and folders");
ok(store.roots.other.children.at(-1).title === "Edge'den aktarılanlar", "other bookmarks go into an 'Edge'den aktarılanlar' folder");
const again = store.importEdge({ profile: "Default", dir: edge });
ok(again.bookmarks === 0, "importing twice does not duplicate bookmarks");

store.recordVisit("https://github.com/anthropics", "Anthropic · GitHub");
store.recordVisit("https://www.google.com/search?q=x", "x - Google");
store.recordVisit("neural://newtab", "Yeni sekme");
ok(store.historyCount() === 3, "records http(s) visits only, merging repeats");
const top = store.topSites();
ok(top[0].host === "www.youtube.com" && !top.some((t) => /google\./.test(t.host)), "top sites rank by visits and skip Google search pages");
ok(store.history({ query: "müzik" }).length === 1 || store.history({ query: "Müzik" }).length === 1, "history search by title");
const sug = store.suggestions("git");
ok(sug[0].type === "bookmark" && sug.some((s) => s.type === "history"), "suggestions put bookmarks first, then history");

const node = store.addBookmark({ title: "Test", url: "https://test.example/" });
ok(store.bookmarkFor("https://test.example/").id === node.id, "adds and finds a bookmark");
const folder = store.addBookmark({ type: "folder", title: "Klasör" });
ok(store.moveBookmark(node.id, folder.id, 0) && folder.children[0].id === node.id, "moves a bookmark into a folder");
ok(!store.moveBookmark(folder.id, folder.id, 0), "a folder cannot move into itself");
ok(store.removeBookmark(node.id) && !store.bookmarkFor("https://test.example/"), "removes a bookmark");

store.setFavicon("github.com", "data:image/png;base64,AAAA");
ok(store.favicon("github.com") === "data:image/png;base64,AAAA", "stores favicons by host");
store.close();

const reopened = new Store(path.join(box, "profile"));
ok(reopened.historyCount() === 3 && reopened.roots.bar.children.length >= 3, "data survives a restart");
reopened.close();
fs.rmSync(box, { recursive: true, force: true });
console.log(`\n${passed} checks passed`);
