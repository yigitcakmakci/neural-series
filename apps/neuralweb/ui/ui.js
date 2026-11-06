"use strict";
// NeuralWeb window chrome. The main process owns tabs and pages; this draws them, takes input,
// and reports where the page area is so the tab's view can be laid over it.
const $ = (s) => document.querySelector(s);
const root = document.documentElement;
// Interface texts in the series language (lang\*.json through language.js and i18n.js).
const T = NeuralI18n.page(window);
const PRIV = new URLSearchParams(location.search).get("private") === "1";
const THEMES = ["neon", "ice", "alarm", "daylight"].map((id) => [id, T("theme." + id)]);
const ICON = {
  globe: "M8 2a6 6 0 1 1 0 12A6 6 0 0 1 8 2zM2 8h12M8 2c-2.2 2.4-2.2 9.6 0 12M8 2c2.2 2.4 2.2 9.6 0 12",
  folder: "M2 4h4.5l1.5 1.5H14V13H2z",
  audio: "M2.5 6h2.5L8.5 3v10L5 10H2.5zM11 5.5a3.5 3.5 0 0 1 0 5",
  muted: "M2.5 6h2.5L8.5 3v10L5 10H2.5zM10.5 6l3.5 4M14 6l-3.5 4",
  close: "M4 4l8 8M12 4l-8 8",
  warn: "M8 2.5l6 11H2zM8 6.5v3.5M8 11.5v.5",
};

let state = { tabs: [], activeId: null, theme: "neon", showBar: true };
let marks = { bar: [], other: [] };
let openKind = null; // kind of the popup on screen, whoever opened it
const activeTab = () => state.tabs.find((t) => t.id === state.activeId) || null;
const rectOf = (node) => { const r = node.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; };
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
function icon(d) {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 16 16");
  s.setAttribute("aria-hidden", "true");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", d);
  s.append(p);
  return s;
}
function favicon(data) {
  if (!data) return icon(ICON.globe);
  const img = el("img");
  img.alt = "";
  img.src = data;
  img.addEventListener("error", () => img.replaceWith(icon(ICON.globe)), { once: true });
  return img;
}
const isGoogleSearch = (u) => /^https:\/\/www\.google\.com\/search\?q=/.test(u || "");
const googleUrl = (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}&ie=UTF-8`;
function prettyUrl(u) {
  if (!u) return "";
  let s = u;
  try { s = decodeURI(u); } catch (e) { /* keep encoded */ }
  return s.replace(/^https:\/\//i, "").replace(/^([^/?#]+)\/$/, "$1");
}

if (PRIV) {
  root.classList.add("private");
  $("#brand-name").textContent = T("brand.private");
  $("#st-private").hidden = false;
}

/* ============================================================ popups (drawn by the overlay view) */
let popSeq = 0;
let pop = null; // { token, kind, owner, onPick, onClose }
function openPopup(spec, owner, onPick, onClose) {
  if (pop) { const old = pop; pop = null; old.onClose && old.onClose("replaced"); }
  const token = ++popSeq;
  pop = { token, kind: spec.kind, owner, onPick, onClose };
  nw.popup(token, spec);
  return token;
}
function closePopup() { if (pop) nw.popupClose(); }
nw.on("popup:picked", ({ token, value, open }) => {
  if (!pop || pop.token !== token) return;
  const p = pop;
  if (!open) pop = null;
  if (p.onPick) p.onPick(value);
  if (!open && p.onClose) p.onClose("pick");
});
nw.on("popup:closed", ({ token, reason }) => {
  if (!pop || pop.token !== token) return;
  const p = pop;
  pop = null;
  if (p.onClose) p.onClose(reason);
});
nw.on("popup-state", (kind) => { openKind = kind; });
// A second click on the button that opened a popup closes it instead of reopening it.
function toggler(btn, kind, open) {
  let wasOpen = false;
  btn.addEventListener("mousedown", (e) => {
    wasOpen = openKind === kind && (!pop || pop.owner === btn);
    if (e.button === 0) e.preventDefault();
  });
  btn.addEventListener("click", (e) => {
    if (wasOpen) { wasOpen = false; closePopup(); return; }
    open(e);
  });
}

// Menus: defs are { label, key, checked, disabled, danger, icon, sub, run } or "-".
function showMenu(owner, defs, opts = {}) {
  const acts = new Map();
  let n = 0;
  const conv = (list) => list.map((d) => {
    if (d === "-") return "-";
    const item = { label: d.label, key: d.key, checked: d.checked, disabled: d.disabled, danger: d.danger, icon: d.icon, type: d.type, zoom: d.zoom };
    if (d.sub) item.sub = conv(d.sub);
    else if (d.run) { item.id = "m" + (++n); acts.set(item.id, d.run); }
    return item;
  });
  if (owner) owner.classList.add("open");
  openPopup({ kind: "menu", data: { items: conv(defs) }, anchor: opts.anchor || rectOf(owner), align: opts.align || "left", at: opts.at, width: opts.width || 0 }, owner,
    (id) => {
      if (id === "zoom:in") return nw.cmd("zoomIn");
      if (id === "zoom:out") return nw.cmd("zoomOut");
      if (id === "zoom:full") return nw.cmd("fullscreen");
      const f = acts.get(id);
      if (f) f();
    },
    () => { if (owner) owner.classList.remove("open"); });
}

/* ============================================================ tabs */
const tabEls = new Map();
let drag = null;
let renderPending = false;

function makeTab(id) {
  const t = el("div", "tab");
  t.setAttribute("role", "tab");
  t.dataset.id = id;
  const ic = el("span", "tab-icon");
  const title = el("span", "tab-title");
  const audio = el("button", "tab-audio");
  audio.type = "button";
  audio.tabIndex = -1;
  const close = el("button", "tab-close");
  close.type = "button";
  close.tabIndex = -1;
  close.title = T("tab.close");
  close.append(icon(ICON.close));
  t.append(ic, title, audio, close);
  close.addEventListener("click", (e) => { e.stopPropagation(); nw.cmd("closeTab", id); });
  close.addEventListener("pointerdown", (e) => e.stopPropagation());
  audio.addEventListener("click", (e) => { e.stopPropagation(); nw.cmd("muteTab", id); });
  audio.addEventListener("pointerdown", (e) => e.stopPropagation());
  t.addEventListener("mousedown", (e) => { if (e.button === 1) e.preventDefault(); });
  t.addEventListener("auxclick", (e) => { if (e.button === 1) nw.cmd("closeTab", id); });
  t.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const tab = state.tabs.find((x) => x.id === id);
    if (tab) tabMenu(tab, e.clientX, e.clientY);
  });
  t.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    nw.cmd("selectTab", id);
    drag = { id, el: t, x: e.clientX, moved: false };
    t.setPointerCapture(e.pointerId);
  });
  t.addEventListener("pointermove", (e) => {
    if (!drag || drag.el !== t) return;
    if (!drag.moved && Math.abs(e.clientX - drag.x) < 6) return;
    drag.moved = true;
    t.classList.add("dragging");
    const pinned = t.classList.contains("pinned");
    const prev = t.previousElementSibling;
    const next = t.nextElementSibling;
    if (next && next.classList.contains("pinned") === pinned) {
      const r = next.getBoundingClientRect();
      if (e.clientX > r.left + r.width / 2) next.after(t);
    }
    if (prev && prev.classList.contains("pinned") === pinned) {
      const r = prev.getBoundingClientRect();
      if (e.clientX < r.left + r.width / 2) prev.before(t);
    }
  });
  const end = () => {
    if (!drag || drag.el !== t) return;
    const moved = drag.moved;
    drag = null;
    t.classList.remove("dragging");
    if (moved) nw.cmd("moveTab", { id, index: [...$("#tabs").children].indexOf(t) });
    if (renderPending) render();
  };
  t.addEventListener("pointerup", end);
  t.addEventListener("lostpointercapture", end);
  return t;
}

function updateTab(node, t) {
  node.setAttribute("aria-selected", String(t.id === state.activeId));
  node.classList.toggle("pinned", !!t.pinned);
  node.classList.toggle("crashed", !!(t.crashed || t.error));
  node.title = t.url ? `${t.title}\n${prettyUrl(t.url)}` : t.title;
  const [ic, title, audio] = node.children;
  if (title.textContent !== t.title) title.textContent = t.title;
  const key = t.loading ? "loading" : t.crashed || t.error ? "warn" : t.favicon ? "fav:" + t.favicon.length + t.favicon.slice(-24) : t.internal ? "nw" : "globe";
  if (ic.dataset.key !== key) {
    ic.dataset.key = key;
    ic.replaceChildren(
      key === "loading" ? el("span", "spinner") :
      key === "warn" ? icon(ICON.warn) :
      key === "nw" ? el("span", "glyph", "NW") :
      favicon(t.favicon));
  }
  audio.hidden = !(t.audible || t.muted);
  audio.title = T(t.muted ? "tab.unmute" : "tab.mute");
  const ak = t.muted ? "muted" : "audio";
  if (audio.dataset.key !== ak) { audio.dataset.key = ak; audio.replaceChildren(icon(ICON[ak])); }
}

function renderTabs() {
  const box = $("#tabs");
  const ids = new Set(state.tabs.map((t) => t.id));
  for (const [id, node] of tabEls) if (!ids.has(id)) { node.remove(); tabEls.delete(id); }
  state.tabs.forEach((t, i) => {
    let node = tabEls.get(t.id);
    if (!node) { node = makeTab(t.id); tabEls.set(t.id, node); }
    updateTab(node, t);
    if (box.children[i] !== node) box.insertBefore(node, box.children[i] || null);
  });
}
function revealActiveTab() {
  const node = tabEls.get(state.activeId);
  if (node) node.scrollIntoView({ block: "nearest", inline: "nearest" });
}
$("#tabs").addEventListener("wheel", (e) => { $("#tabs").scrollLeft += e.deltaY || e.deltaX; }, { passive: true });
$("#tab-new").addEventListener("click", () => nw.cmd("newTab"));
$(".tabstrip").addEventListener("dblclick", (e) => { if (e.target === $("#tabs") || e.target === $(".tabstrip")) nw.cmd("newTab"); });

function tabMenu(t, x, y) {
  const i = state.tabs.findIndex((s) => s.id === t.id);
  showMenu(null, [
    { label: T("tab.new-tab"), key: "Ctrl+T", run: () => nw.cmd("newTab") },
    "-",
    { label: T("nav.reload"), key: "Ctrl+R", run: () => nw.cmd("reloadTab", t.id) },
    { label: T("tab.duplicate"), run: () => nw.cmd("duplicateTab", t.id) },
    { label: T(t.pinned ? "tab.unpin" : "tab.pin"), run: () => nw.cmd("pinTab", t.id) },
    { label: T(t.muted ? "tab.unmute" : "tab.mute"), run: () => nw.cmd("muteTab", t.id) },
    "-",
    { label: T("win.close"), key: "Ctrl+W", run: () => nw.cmd("closeTab", t.id) },
    { label: T("tab.close-others"), disabled: state.tabs.length < 2, run: () => nw.cmd("closeOthers", t.id) },
    { label: T("tab.close-right"), disabled: i === state.tabs.length - 1, run: () => nw.cmd("closeRight", t.id) },
    "-",
    { label: T("tab.reopen"), key: "Ctrl+Shift+T", run: () => nw.cmd("reopenTab") },
  ], { anchor: { x, y, width: 0, height: 0 }, at: "point" });
}

/* ============================================================ toolbar */
$("#btn-back").addEventListener("click", () => nw.cmd("back"));
$("#btn-forward").addEventListener("click", () => nw.cmd("forward"));
$("#btn-reload").addEventListener("click", (e) => {
  const t = activeTab();
  if (t && t.loading) nw.cmd("stop");
  else nw.cmd(e.ctrlKey || e.shiftKey ? "hardReload" : "reload");
});
$("#btn-home").addEventListener("click", () => nw.cmd("home"));
for (const b of document.querySelectorAll(".toolbar .tb")) b.addEventListener("mousedown", (e) => { if (e.button === 0) e.preventDefault(); });
toggler($("#btn-menu"), "menu", () => showMenu($("#btn-menu"), appMenu(), { align: "right", width: 300 }));
toggler($("#btn-downloads"), "downloads", () => nw.cmd("downloadsPopup"));
toggler($("#btn-shield"), "shield", () => nw.cmd("shieldPopup"));
toggler($("#sec-chip"), "siteinfo", () => nw.cmd("siteInfo"));
toggler($("#zoom-chip"), "menu", () => {
  const t = activeTab();
  showMenu($("#zoom-chip"), [{ type: "zoom", label: T("zoom.label"), zoom: t ? t.zoom : 100 }, "-", { label: T("zoom.reset"), key: "Ctrl+0", run: () => nw.cmd("zoomReset") }], { align: "right", width: 260 });
});
$("#star").addEventListener("click", () => starFlow());

function appMenu() {
  const t = activeTab();
  const web = !!(t && /^https?:/i.test(t.url));
  return [
    { label: T("tab.new-tab"), key: "Ctrl+T", run: () => nw.cmd("newTab") },
    { label: T("menu.new-window"), key: "Ctrl+N", run: () => nw.cmd("newWindow") },
    { label: T("menu.new-private"), key: "Ctrl+Shift+N", run: () => nw.cmd("newPrivate") },
    "-",
    { label: T("page.history"), key: "Ctrl+H", run: () => nw.cmd("history") },
    { label: T("page.downloads"), key: "Ctrl+J", run: () => nw.cmd("downloads") },
    { label: T("page.passwords"), run: () => nw.cmd("passwords") },
    { label: T("page.bookmarks"), sub: [
      { label: T(t && t.bookmarked ? "menu.bm-edit" : "menu.bm-add"), key: "Ctrl+D", disabled: !t || !t.url, run: starFlow },
      { label: T("menu.show-bar"), key: "Ctrl+Shift+B", checked: !!state.showBar, run: () => nw.cmd("toggleBar") },
      { label: T("menu.bm-manager"), key: "Ctrl+Shift+O", run: () => nw.cmd("bookmarksManager") },
    ] },
    "-",
    { type: "zoom", label: T("zoom.label"), zoom: t ? t.zoom : 100 },
    "-",
    { label: T("menu.print"), key: "Ctrl+P", disabled: !t, run: () => nw.cmd("print") },
    { label: T("menu.find"), key: "Ctrl+F", run: () => nw.cmd("find") },
    { label: T("menu.theme"), sub: [
      ...THEMES.map(([id, name]) => ({ label: name, checked: state.theme === id, run: () => nw.cmd("theme", id) })),
      "-",
      { label: T("menu.theme-sync"), checked: state.syncTheme !== false, run: () => nw.cmd("syncTheme") },
    ] },
    { label: T("menu.more-tools"), sub: [
      { label: T("menu.view-source"), key: "Ctrl+U", disabled: !web, run: () => nw.cmd("viewSource") },
      { label: T("menu.devtools"), key: "F12", run: () => nw.cmd("devtools") },
      { label: T("menu.clear-data"), key: "Ctrl+Shift+Del", run: () => nw.cmd("settings", "privacy") },
    ] },
    "-",
    { label: T("page.settings"), run: () => nw.cmd("settings") },
    { label: T("menu.import"), run: () => nw.cmd("settings", "import") },
    { label: T("menu.about"), run: () => nw.cmd("settings", "about") },
    "-",
    { label: T("menu.quit"), run: () => nw.cmd("quit") },
  ];
}

/* ============================================================ omnibox */
const omni = $("#omni");
let omniDirty = false; // the user has edited the text since it last showed the tab's address
let typed = "";
let selectOnUp = false;
// activeElement stays on the bar when another view (the page) takes the keyboard, so track real focus.
let omniFocused = false;
const sug = { items: [], sel: 0, seq: 0, local: [], remote: [], resolved: "", inline: null, allowInline: false, timer: 0 };
const suggestOpen = () => !!(pop && pop.kind === "suggest");

function syncOmni(force) {
  if (omniDirty && !force) return;
  const t = activeTab();
  const url = t ? t.url : "";
  if (!omniFocused) { omni.value = prettyUrl(url); return; }
  if (omni.value === url) return;
  const all = omni.selectionStart === 0 && omni.selectionEnd === omni.value.length;
  omni.value = url;
  if (all) omni.select();
}
omni.addEventListener("mousedown", () => { selectOnUp = !omniFocused; });
omni.addEventListener("mouseup", (e) => { if (selectOnUp) { e.preventDefault(); omni.select(); } selectOnUp = false; });
omni.addEventListener("focus", () => {
  omniFocused = true;
  root.classList.add("omni-focus");
  if (!omniDirty) { const t = activeTab(); omni.value = t ? t.url : ""; }
  omni.select();
});
omni.addEventListener("blur", () => {
  omniFocused = false;
  root.classList.remove("omni-focus");
  setTimeout(() => { if (!omniFocused && suggestOpen()) closePopup(); }, 250);
  if (!omniDirty) syncOmni(true);
});
omni.addEventListener("input", (e) => {
  omniDirty = true;
  typed = omni.value;
  sug.allowInline = !(e.inputType || "").startsWith("delete") && omni.selectionStart === omni.value.length;
  querySuggest();
});
omni.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    if (!suggestOpen() || !sug.items.length) return;
    e.preventDefault();
    const n = sug.items.length;
    sug.sel = (sug.sel + (e.key === "ArrowDown" ? 1 : -1) + n) % n;
    const it = sug.items[sug.sel];
    omni.value = sug.sel === 0 ? (sug.inline ? sug.inline.text : typed) : it.kind === "search" ? it.query : it.url;
    nw.popupUpdate({ items: sug.items, sel: sug.sel });
  } else if (e.key === "Enter") {
    e.preventDefault();
    commit(e.altKey ? "tab" : "", suggestOpen() ? sug.sel : null);
  } else if (e.key === "Escape") {
    revertOmni();
  }
});
omni.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  const hasSel = omni.selectionStart !== omni.selectionEnd;
  showMenu(null, [
    { label: T("edit.undo"), key: "Ctrl+Z", run: () => nw.cmd("editUI", "undo") },
    "-",
    { label: T("edit.cut"), key: "Ctrl+X", disabled: !hasSel, run: () => nw.cmd("editUI", "cut") },
    { label: T("edit.copy"), key: "Ctrl+C", disabled: !hasSel, run: () => nw.cmd("editUI", "copy") },
    { label: T("edit.paste"), key: "Ctrl+V", run: () => nw.cmd("editUI", "paste") },
    { label: T("omni.paste-go"), run: () => { omniDirty = false; nw.cmd("pasteGo"); } },
    "-",
    { label: T("edit.select-all"), key: "Ctrl+A", run: () => nw.cmd("editUI", "selectAll") },
  ], { anchor: { x: e.clientX, y: e.clientY, width: 0, height: 0 }, at: "point" });
});
nw.on("focus-omnibox", () => { omni.focus(); omni.select(); });
nw.on("popup:closed", ({ reason }) => { if (reason === "escape" && omniFocused) revertOmni(); });

function revertOmni() {
  omniDirty = false;
  sug.seq++;
  const t = activeTab();
  omni.value = t ? t.url : "";
  omni.select();
  if (suggestOpen()) closePopup();
}
const bare = (u) => u.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
async function querySuggest() {
  const text = typed;
  const seq = ++sug.seq;
  clearTimeout(sug.timer);
  if (!text.trim()) { sug.items = []; sug.inline = null; if (suggestOpen()) closePopup(); return; }
  const [res, resolved] = await Promise.all([nw.suggest(text), nw.resolve(text)]);
  if (seq !== sug.seq) return;
  sug.local = res.local || [];
  sug.remote = [];
  sug.resolved = resolved || googleUrl(text);
  buildSuggest(text);
  sug.timer = setTimeout(async () => {
    const remote = await nw.suggestRemote(text);
    if (seq !== sug.seq) return;
    sug.remote = remote || [];
    buildSuggest(text);
  }, 70);
}
function inlineFor(text) {
  if (!sug.allowInline || /\s/.test(text)) return null;
  const low = text.toLocaleLowerCase(T.locale);
  for (const s of sug.local) {
    let host;
    try { host = new URL(s.url).host; } catch (e) { continue; }
    // No slash typed: complete to the site; otherwise to the whole address.
    const cands = text.includes("/") ? [bare(s.url), s.url.replace(/^https?:\/\//i, "")] : [host.replace(/^www\./i, ""), host];
    for (const c of cands) {
      if (c.length > text.length && c.toLocaleLowerCase(T.locale).startsWith(low)) {
        const url = text.includes("/") ? s.url : `${new URL(s.url).protocol}//${host}/`;
        return { url, text: text + c.slice(text.length), title: s.title };
      }
    }
  }
  return null;
}
function buildSuggest(text) {
  const inline = inlineFor(text);
  sug.inline = inline;
  if (inline && omni.value === text) {
    omni.value = inline.text;
    omni.setSelectionRange(text.length, inline.text.length);
  }
  const first = inline ? { kind: "url", url: inline.url, main: inline.text, sub: inline.title || "" }
    : isGoogleSearch(sug.resolved) ? { kind: "search", query: text, main: text, sub: T("omni.search-google") }
    : { kind: "url", url: sug.resolved, main: text, sub: T("omni.go") };
  const items = [first];
  const seen = new Set([first.url]);
  for (const s of sug.local) {
    if (seen.has(s.url)) continue;
    seen.add(s.url);
    items.push({ kind: s.type, url: s.url, main: s.title || bare(s.url), sub: prettyUrl(s.url) });
  }
  const queries = new Set([text.trim().toLocaleLowerCase(T.locale)]);
  for (const q of sug.remote) {
    if (items.length >= 9) break;
    const k = q.toLocaleLowerCase(T.locale);
    if (queries.has(k)) continue;
    queries.add(k);
    items.push({ kind: "search", query: q, main: q, sub: "" });
  }
  sug.items = items;
  sug.sel = 0;
  if (!omniFocused) return;
  const data = { items, sel: 0 };
  if (suggestOpen()) nw.popupUpdate(data);
  else {
    const r = rectOf($("#omnibox"));
    openPopup({ kind: "suggest", data, anchor: r, width: Math.round(r.width), focus: false }, $("#omnibox"), (i) => commit("", i), null);
  }
}
function commit(how, index) {
  const it = index != null ? sug.items[index] : null;
  let target;
  if (!omniDirty) { const t = activeTab(); target = t && t.url ? t.url : omni.value.trim(); }
  else if (it && (index > 0 || sug.inline || it.kind === "search")) target = it.kind === "search" ? googleUrl(it.query) : it.url;
  else target = omni.value.trim();
  if (!target) return;
  sug.seq++;
  if (suggestOpen()) closePopup();
  omniDirty = false;
  omni.value = prettyUrl(target);
  nw.cmd(how === "tab" ? "openUrlNewTab" : "navigate", target);
}

/* ---------- star: add or edit the current page's bookmark ---------- */
function walkMarks(fn) {
  const go = (list, parent) => { for (const n of list) { fn(n, parent); if (n.type === "folder") go(n.children, n.id); } };
  go(marks.bar, "bar");
  go(marks.other, "other");
}
function findMark(url) {
  let hit = null;
  walkMarks((n, parent) => { if (!hit && n.type === "url" && n.url === url) hit = { node: n, parent }; });
  return hit;
}
function folderOptions(exclude) {
  const out = [{ value: "bar", label: T("bm.bar") }];
  const go = (list, depth) => {
    for (const n of list) if (n.type === "folder" && n.id !== exclude) { out.push({ value: n.id, label: "· ".repeat(depth) + n.title }); go(n.children, depth + 1); }
  };
  go(marks.bar, 1);
  out.push({ value: "other", label: T("bm.other") });
  go(marks.other, 1);
  return out;
}
async function starFlow() {
  const t = activeTab();
  if (!t || !t.url) return;
  let hit = findMark(t.url);
  let created = false;
  if (!hit) {
    const node = await nw.bookmark("add", { parentId: "bar", title: t.title, url: t.url });
    if (!node) return;
    hit = { node, parent: "bar" };
    created = true;
  }
  const star = $("#star");
  openPopup({
    kind: "prompt", anchor: rectOf(star), align: "right", width: 340,
    data: {
      title: T(created ? "bm.added" : "bm.edit"), icon: "star",
      fields: [
        { id: "title", label: T("bm.name"), value: hit.node.title },
        { id: "parent", label: T("bm.folder"), type: "select", value: hit.parent, options: folderOptions() },
      ],
      buttons: [{ id: "remove", label: T("dlg.remove") }, { id: "done", label: T("bm.done"), primary: true }],
    },
  }, star, async (v) => {
    if (!v) return;
    if (v.button === "remove") { await nw.bookmark("remove", hit.node.id); return; }
    if (v.values.title && v.values.title !== hit.node.title) await nw.bookmark("update", hit.node.id, { title: v.values.title });
    if (v.values.parent && v.values.parent !== hit.parent) await nw.bookmark("move", hit.node.id, v.values.parent, -1);
  }, null);
}
nw.on("star", () => starFlow());

/* ============================================================ bookmarks bar */
const urlsIn = (n) => { const out = []; const go = (x) => { if (x.type === "url") out.push(x.url); else for (const c of x.children) go(c); }; go(n); return out; };
function openMark(url, how) { nw.bookmarkOpen(url, how); }
function markDefs(list) {
  const defs = list.map((n) => n.type === "folder"
    ? { label: n.title, icon: "folder", sub: markDefs(n.children) }
    : { label: n.title || n.url, icon: n.favicon || "globe", run: () => openMark(n.url, "") });
  if (!defs.length) defs.push({ label: T("bm.empty"), disabled: true });
  const urls = list.filter((n) => n.type === "url").map((n) => n.url);
  if (urls.length > 1) defs.push("-", { label: T("bm.open-all-n", { n: urls.length }), run: () => urls.forEach((u) => openMark(u, "tab")) });
  return defs;
}
function editMark(n) {
  const fields = [{ id: "title", label: T("bm.name"), value: n.title }];
  if (n.type === "url") fields.push({ id: "url", label: T("bm.address"), value: n.url });
  openPopup({
    kind: "prompt", anchor: rectOf($("#omnibox")), width: 380,
    data: { title: T(n.type === "url" ? "bm.edit" : "bm.rename-folder"), icon: "star", fields, buttons: [{ id: "cancel", label: T("dlg.cancel") }, { id: "save", label: T("dlg.save"), primary: true }] },
  }, null, (v) => {
    if (v && v.button === "save") nw.bookmark("update", n.id, { title: v.values.title, url: v.values.url });
  }, null);
}
function markMenu(b, n) {
  const del = { label: T("dlg.delete"), danger: true, run: () => nw.bookmark("remove", n.id) };
  showMenu(b, n.type === "url" ? [
    { label: T("dlg.open"), run: () => openMark(n.url, "") },
    { label: T("bm.open-tab"), run: () => openMark(n.url, "tab") },
    { label: T("bm.open-window"), run: () => openMark(n.url, "window") },
    { label: T("bm.open-private"), run: () => openMark(n.url, "private") },
    "-",
    { label: T("bm.edit-menu"), run: () => editMark(n) },
    del,
    "-",
    { label: T("menu.bm-manager"), run: () => nw.cmd("bookmarksManager") },
  ] : [
    { label: T("bm.open-all"), disabled: !urlsIn(n).length, run: () => urlsIn(n).forEach((u) => openMark(u, "tab")) },
    "-",
    { label: T("bm.rename"), run: () => editMark(n) },
    del,
    "-",
    { label: T("menu.bm-manager"), run: () => nw.cmd("bookmarksManager") },
  ]);
}
function markButton(n) {
  const b = el("button", "bm");
  b.type = "button";
  b.dataset.id = n.id;
  b.title = n.type === "url" ? `${n.title}\n${n.url}` : n.title;
  b.append(n.type === "folder" ? icon(ICON.folder) : favicon(n.favicon), el("span", null, n.title || n.url));
  if (n.type === "folder") toggler(b, "menu", () => showMenu(b, markDefs(n.children)));
  else {
    b.addEventListener("mousedown", (e) => { if (e.button === 1) e.preventDefault(); });
    b.addEventListener("click", (e) => openMark(n.url, e.ctrlKey ? "tab" : e.shiftKey ? "window" : ""));
    b.addEventListener("auxclick", (e) => { if (e.button === 1) openMark(n.url, "tab"); });
  }
  b.addEventListener("contextmenu", (e) => { e.preventDefault(); markMenu(b, n); });
  return b;
}
function renderBar() {
  const box = $("#bm-items");
  box.replaceChildren(...marks.bar.map(markButton));
  if (!marks.bar.length) box.append(el("span", "bm-empty", T("bm.bar-empty")));
  $("#bm-other").hidden = !marks.other.length;
  fitBar();
}
let overflowIds = [];
function fitBar() {
  const box = $("#bm-items");
  const items = [...box.querySelectorAll(".bm")];
  for (const b of items) b.classList.remove("off");
  const limit = box.clientWidth;
  overflowIds = [];
  for (const b of items) if (b.offsetLeft + b.offsetWidth > limit) { b.classList.add("off"); overflowIds.push(b.dataset.id); }
  $("#bm-more").hidden = !overflowIds.length;
}
new ResizeObserver(() => fitBar()).observe($("#bmbar"));
toggler($("#bm-more"), "menu", () => showMenu($("#bm-more"), markDefs(marks.bar.filter((n) => overflowIds.includes(n.id))), { align: "right" }));
toggler($("#bm-other"), "menu", () => showMenu($("#bm-other"), markDefs(marks.other), { align: "right" }));
nw.on("bookmarks", (data) => {
  marks = data;
  renderBar();
  const t = activeTab();
  $("#star").classList.toggle("on", !!(t && t.url && findMark(t.url)));
});

/* ============================================================ find in page */
const findInput = $("#find-input");
function openFind() {
  const bar = $("#findbar");
  const wasOpen = !bar.hidden;
  bar.hidden = false;
  findInput.focus();
  findInput.select();
  if (findInput.value) nw.cmd("findText", { text: findInput.value, next: wasOpen });
}
function closeFind() {
  if ($("#findbar").hidden) return;
  $("#findbar").hidden = true;
  $("#findbar").classList.remove("miss");
  $("#find-count").textContent = "";
  nw.cmd("findStop");
  nw.cmd("focusPage");
}
nw.on("find-open", openFind);
findInput.addEventListener("input", () => {
  if (findInput.value) nw.cmd("findText", { text: findInput.value });
  else { nw.cmd("findText", { text: "" }); $("#find-count").textContent = ""; $("#findbar").classList.remove("miss"); }
});
findInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); if (findInput.value) nw.cmd("findText", { text: findInput.value, next: true, forward: !e.shiftKey }); }
  else if (e.key === "Escape") { e.preventDefault(); closeFind(); }
});
$("#find-next").addEventListener("click", () => { if (findInput.value) nw.cmd("findText", { text: findInput.value, next: true, forward: true }); });
$("#find-prev").addEventListener("click", () => { if (findInput.value) nw.cmd("findText", { text: findInput.value, next: true, forward: false }); });
$("#find-close").addEventListener("click", closeFind);
nw.on("find-result", ({ active, matches }) => {
  $("#find-count").textContent = `${matches ? active : 0}/${matches}`;
  $("#findbar").classList.toggle("miss", !matches && !!findInput.value);
});

/* ============================================================ error / crash panel */
// Chromium's network error codes: the title and the explanation of the error panel, as text keys.
const ERRORS = {
  "-105": ["err.unreachable", "err.text.105"],
  "-137": ["err.unreachable", "err.text.137"],
  "-106": ["err.offline", "err.text.106"],
  "-102": ["err.unreachable", "err.text.102"],
  "-118": ["err.timeout", "err.text.118"],
  "-7": ["err.timeout", "err.text.7"],
  "-101": ["err.reset", "err.text.101"],
  "-100": ["err.closed", "err.text.100"],
  "-109": ["err.unreachable", "err.text.109"],
  "-21": ["err.network-changed", "err.text.21"],
  "-310": ["err.broken", "err.text.310"],
  "-324": ["err.broken", "err.text.324"],
  "-6": ["err.file", "err.text.6"],
  "-300": ["err.invalid", "err.text.300"],
  "-301": ["err.unsupported", "err.text.301"],
  "-10": ["err.denied", "err.text.10"],
  "-20": ["err.denied", "err.text.20"],
  "-312": ["err.blocked-port", "err.text.312"],
};
let advOpen = false;
function renderError(t) {
  const show = !!(t && (t.error || t.crashed));
  $("#errpanel").hidden = !show;
  if (!show) { advOpen = false; return; }
  let code, title, text, url = "";
  if (t.crashed) {
    code = T("err.crash.code");
    title = T("err.crash");
    text = T("err.crash.text");
    url = t.url;
  } else {
    const e = t.error;
    code = e.desc || T("err.code", { code: e.code });
    url = e.url;
    const [tk, xk] = e.cert ? ["err.cert", "err.cert.text"] : ERRORS[String(e.code)] || ["err.generic", "err.generic.text"];
    title = T(tk);
    text = T(xk);
  }
  $("#err-code").textContent = code;
  $("#err-title").textContent = title;
  $("#err-text").textContent = text;
  $("#err-url").textContent = prettyUrl(url);
  $("#err-retry").textContent = T(t.crashed ? "nav.reload" : t.error && t.error.cert ? "err.back-to-safety" : "err.retry");
  const cert = !!(t.error && t.error.cert);
  $("#err-adv-btn").hidden = !cert;
  $("#err-adv").hidden = !(cert && advOpen);
  $("#err-adv-text").textContent = T("err.cert.adv", { desc: t.error ? t.error.desc : "" });
}
$("#err-retry").addEventListener("click", () => {
  const t = activeTab();
  if (t && t.error && t.error.cert) nw.cmd(t.canBack ? "back" : "home");
  else nw.cmd("reload");
});
$("#err-adv-btn").addEventListener("click", () => { advOpen = !advOpen; renderError(activeTab()); });
$("#err-proceed").addEventListener("click", () => nw.cmd("certProceed"));

/* ============================================================ downloads button */
nw.on("downloads", (d) => {
  const b = $("#btn-downloads");
  b.classList.toggle("active", d.active > 0);
  b.classList.toggle("unknown", d.active > 0 && d.progress < 0);
  b.querySelector(".ring circle").style.strokeDasharray = d.progress > 0 ? `${Math.round(d.progress * 100)} 100` : "";
  $("#dl-badge").hidden = d.active < 2;
  $("#dl-badge").textContent = d.active;
  b.title = d.active ? T("dl.button.active", { n: d.active }) : T("dl.button");
});

/* ============================================================ state */
let lastActive = null;
function render() {
  if (drag && drag.moved) { renderPending = true; return; }
  renderPending = false;
  const t = activeTab();
  for (const [id] of THEMES) root.classList.toggle("theme-" + id, state.theme === id);
  root.classList.toggle("no-bar", !state.showBar);
  root.classList.toggle("loading", !!(t && t.loading));
  renderTabs();
  if (state.activeId !== lastActive) {
    lastActive = state.activeId;
    omniDirty = false;
    sug.seq++;
    if (suggestOpen()) closePopup();
    if (!$("#findbar").hidden) { $("#findbar").hidden = true; $("#find-count").textContent = ""; }
    advOpen = false;
    syncOmni(true);
    revealActiveTab();
  } else syncOmni(false);
  $("#btn-back").disabled = !(t && t.canBack);
  $("#btn-forward").disabled = !(t && t.canForward);
  $("#btn-reload").title = T(t && t.loading ? "nav.stop.title" : "nav.reload.title");
  const sec = !t || !t.url ? "empty" : t.security;
  const chip = $("#sec-chip");
  chip.dataset.sec = sec;
  $("#sec-label").textContent = sec === "insecure" ? T("sec.not-secure") : sec === "internal" ? "NW" : "";
  chip.title = T({ secure: "sec.secure", insecure: "sec.insecure", internal: "sec.internal", file: "sec.file", empty: "omni.placeholder", other: "site.info" }[sec] || "site.info");
  const zoom = t ? t.zoom : 100;
  $("#zoom-chip").hidden = zoom === 100;
  $("#zoom-chip").textContent = T("zoom.pct", { n: zoom });
  $("#st-zoom").hidden = zoom === 100;
  $("#st-zoom").textContent = T("status.zoom", { n: zoom });
  $("#st-sec").textContent = { secure: "HTTPS", insecure: "HTTP", internal: "NW-1", file: T("status.file"), empty: T("status.ready"), other: "—" }[sec] || "—";
  $("#star").disabled = !t || !t.url;
  $("#star").classList.toggle("on", !!(t && t.url && (t.bookmarked || findMark(t.url))));
  $("#star").title = T(t && t.bookmarked ? "star.edit" : "star.add");
  renderShield(t);
  setStatus();
  renderError(t);
  if (pop && pop.kind === "menu") nw.popupUpdate({ zoom });
}
function renderShield(t) {
  const b = $("#btn-shield");
  const st = t ? t.shield : "na";
  const n = t ? t.blocked : 0;
  b.dataset.state = st;
  b.classList.toggle("hit", st === "on" && n > 0);
  const badge = $("#shield-badge");
  badge.hidden = !(st === "on" && n > 0);
  badge.textContent = n > 99 ? "99+" : String(n);
  b.title = st === "on" ? (n ? T("shield.title.blocked", { n }) : T("shield.title.on"))
    : T(st === "site" ? "shield.title.site" : st === "off" ? "shield.title.off" : "shield.title.na");
}
let hoverUrl = "";
function setStatus() {
  const t = activeTab();
  const s = $("#st-status");
  root.classList.toggle("hovering", !!hoverUrl);
  s.textContent = hoverUrl ? prettyUrl(hoverUrl) : t && t.loading ? T("status.loading", { url: prettyUrl(t.url) || "…" }) : t && t.url ? prettyUrl(t.url) : T("status.idle");
}
nw.on("state", (s) => { state = s; render(); });
nw.on("hover", (url) => { hoverUrl = url || ""; setStatus(); });
nw.on("maximized", (on) => root.classList.toggle("is-max", on));
nw.on("fullscreen", (on) => { root.classList.toggle("is-full", on); scheduleLayout(); });

/* ============================================================ window: buttons, resize, layout */
for (const id of ["win-min", "win-max", "win-close"]) $("#" + id).addEventListener("mousedown", (e) => e.preventDefault());
$("#win-min").addEventListener("click", () => nw.cmd("minimize"));
$("#win-max").addEventListener("click", () => nw.cmd("toggleMax"));
$("#win-close").addEventListener("click", () => nw.cmd("closeWindow"));
for (const h of document.querySelectorAll(".rz")) {
  h.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    h.setPointerCapture(e.pointerId);
    nw.resizeStart(h.dataset.edge);
    const end = () => { h.removeEventListener("pointerup", end); h.removeEventListener("lostpointercapture", end); nw.resizeEnd(); };
    h.addEventListener("pointerup", end);
    h.addEventListener("lostpointercapture", end);
  });
}
document.addEventListener("contextmenu", (e) => { if (!e.defaultPrevented) e.preventDefault(); });

let layoutQueued = false;
function reportLayout() {
  layoutQueued = false;
  nw.layout({
    viewport: rectOf($("#viewport")),
    anchors: { omnibox: rectOf($("#omnibox")), downloads: rectOf($("#btn-downloads")), menu: rectOf($("#btn-menu")), security: rectOf($("#sec-chip")), shield: rectOf($("#btn-shield")) },
  });
}
function scheduleLayout() { if (!layoutQueued) { layoutQueued = true; setTimeout(reportLayout, 0); } }
new ResizeObserver(scheduleLayout).observe($("#viewport"));
new ResizeObserver(scheduleLayout).observe($("#omnibox"));
window.addEventListener("resize", scheduleLayout);
document.fonts.ready.then(() => { scheduleLayout(); fitBar(); });
reportLayout();
