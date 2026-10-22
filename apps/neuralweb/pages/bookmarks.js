"use strict";
let roots = null;
let current = "bar";
let query = "";
let favs = {};

function walk(fn) {
  const go = (n, parent, trail) => { fn(n, parent, trail); if (n.children) for (const c of n.children) go(c, n, [...trail, n]); };
  go(roots.bar, null, []);
  go(roots.other, null, []);
}
function find(id) { let hit = null; walk((n, parent, trail) => { if (!hit && n.id === id) hit = { node: n, parent, trail }; }); return hit; }

async function load() {
  roots = await neural.call("bookmarks");
  const hosts = new Set();
  walk((n) => { if (n.type === "url") hosts.add(hostOf(n.url)); });
  favs = hosts.size ? await neural.call("favicons", [...hosts]) : {};
  if (!find(current)) current = "bar";
  render();
}
function render() { renderTree(); renderList(); }

function renderTree() {
  const box = $("#tree");
  box.replaceChildren();
  const go = (n, depth) => {
    const b = el("button", "node" + (n.id === current && !query ? " on" : ""));
    b.type = "button";
    b.style.paddingLeft = `${10 + depth * 14}px`;
    b.append(icon(ICON.folder), el("span", null, n.title));
    b.addEventListener("click", () => { current = n.id; query = ""; $("#q").value = ""; render(); });
    box.append(b);
    for (const c of n.children) if (c.type === "folder") go(c, depth + 1);
  };
  go(roots.bar, 0);
  go(roots.other, 0);
}

function renderList() {
  const list = $("#list");
  list.replaceChildren();
  let items;
  if (query) {
    const q = query.toLocaleLowerCase("tr-TR");
    items = [];
    walk((n) => { if (n.type === "url" && ((n.title || "").toLocaleLowerCase("tr-TR").includes(q) || n.url.toLocaleLowerCase("tr-TR").includes(q))) items.push(n); });
    $("#crumb").textContent = `“${query}” için ${items.length} sonuç`;
  } else {
    const hit = find(current);
    items = hit.node.children;
    const crumb = $("#crumb");
    crumb.replaceChildren();
    for (const t of hit.trail) crumb.append(`${t.title} / `);
    crumb.append(el("b", null, hit.node.title));
  }
  if (!items.length) list.append(el("div", "empty", query ? "Eşleşen yer imi yok." : "Bu klasör boş."));
  items.forEach((n, i) => list.append(row(n, i, items.length)));
}

function row(n, i, count) {
  const r = el("div", "mrow");
  const main = el("span", "main");
  const title = el(n.type === "url" ? "a" : "span", "title", n.title || n.url);
  if (n.type === "url") {
    title.href = n.url;
    title.title = n.url;
    main.append(title, el("span", "host", prettyUrl(n.url)));
    r.append(favicon(favs[hostOf(n.url)]), main);
  } else {
    title.addEventListener("click", () => { current = n.id; render(); });
    main.append(title, el("span", "host", `${n.children.length} öğe`));
    r.append(icon(ICON.folder, "folder-ic"), main);
  }
  const acts = el("span", "acts");
  if (!query) {
    const hit = find(n.id);
    if (i > 0) acts.append(iconButton(ICON.up, "Yukarı taşı", () => move(n.id, hit.parent.id, i - 1)));
    if (i < count - 1) acts.append(iconButton(ICON.down, "Aşağı taşı", () => move(n.id, hit.parent.id, i + 1)));
  }
  acts.append(iconButton(ICON.edit, "Düzenle", () => edit(n)));
  acts.append(iconButton(ICON.x, "Sil", async () => {
    if (n.type === "folder" && n.children.length && !(await confirmBox("Klasörü sil", `“${n.title}” ve içindeki ${n.children.length} öğe silinecek.`))) return;
    await neural.call("removeBookmark", n.id);
    toast(`“${n.title || n.url}” silindi.`);
  }, "x"));
  r.append(acts);
  return r;
}
async function move(id, parent, index) { await neural.call("moveBookmark", id, parent, index); }

function folderOptions(select, exclude, value) {
  select.replaceChildren();
  const go = (n, depth) => {
    if (n.id === exclude) return;
    const o = el("option", null, `${"  ".repeat(depth)}${n.title}`);
    o.value = n.id;
    select.append(o);
    for (const c of n.children) if (c.type === "folder") go(c, depth + 1);
  };
  go(roots.bar, 0);
  go(roots.other, 0);
  select.value = value;
}
// One dialog for adding and editing; resolves when it closes.
function dialogFor({ title, node, type }) {
  const d = $("#dlg");
  $("#dlg-title").textContent = title;
  $("#f-title").value = node ? node.title : "";
  $("#f-url").value = node && node.url ? node.url : "";
  $("#f-url-wrap").hidden = type === "folder";
  $("#f-url").required = type !== "folder";
  const parent = node ? find(node.id).parent.id : current;
  folderOptions($("#f-parent"), node && node.type === "folder" ? node.id : null, parent);
  d.returnValue = "";
  d.showModal();
  $("#f-title").focus();
  return new Promise((resolve) => d.addEventListener("close", () => resolve(d.returnValue === "ok" ? { title: $("#f-title").value.trim(), url: $("#f-url").value.trim(), parent: $("#f-parent").value, from: parent } : null), { once: true }));
}
async function edit(n) {
  const v = await dialogFor({ title: n.type === "url" ? "Yer imini düzenle" : "Klasörü düzenle", node: n, type: n.type });
  if (!v) return;
  await neural.call("updateBookmark", n.id, { title: v.title, url: n.type === "url" ? v.url : undefined });
  if (v.parent !== v.from) await neural.call("moveBookmark", n.id, v.parent, -1);
}
$("#add-mark").addEventListener("click", async () => {
  const v = await dialogFor({ title: "Yeni yer imi", node: null, type: "url" });
  if (!v || !v.url) return;
  const url = /^[a-z][a-z0-9+.-]*:/i.test(v.url) ? v.url : `https://${v.url}`;
  await neural.call("addBookmark", { parentId: v.parent, title: v.title || url, url });
});
$("#add-folder").addEventListener("click", async () => {
  const v = await dialogFor({ title: "Yeni klasör", node: null, type: "folder" });
  if (!v) return;
  const f = await neural.call("addBookmark", { parentId: v.parent, title: v.title || "Yeni klasör", type: "folder" });
  if (f) current = f.id;
});
let qTimer = 0;
$("#q").addEventListener("input", () => { clearTimeout(qTimer); qTimer = setTimeout(() => { query = $("#q").value.trim(); render(); }, 120); });
window.addEventListener("neural", (e) => { if (e.detail === "bookmarks") load(); });
load();
