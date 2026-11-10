"use strict";
const THEMES = [
  ["neon", "#fcee0a", "#0c0d15", "#00f0ff"],
  ["ice", "#00f0ff", "#0a1018", "#ff4fd8"],
  ["alarm", "#ff2a4f", "#110a0d", "#fcee0a"],
  ["daylight", "#0a0a0c", "#fcee0a", "#007f8c"],
].map(([id, ...colors]) => [id, T("theme." + id), ...colors]);
const PERM_LABEL = { media: "perm.media", geolocation: "perm.geolocation", notifications: "perm.notifications", "clipboard-read": "perm.clipboard", midi: "perm.midi", midiSysex: "perm.midi-sysex" };
let s = null;

async function load() {
  s = await neural.call("settings");
  renderThemes();
  $("#show-bar").checked = !!s.showBookmarksBar;
  $("#sync-theme").checked = s.syncTheme !== false;
  for (const r of document.querySelectorAll('input[name="startup"]')) r.checked = r.value === s.startup;
  $("#dl-dir").textContent = s.downloadDir;
  $("#ask-path").checked = !!s.askDownloadPath;
  renderPermissions();
  $("#versions").textContent = `${T("set.version", { version: s.versions.app })} · Chromium ${s.versions.chrome} · Electron ${s.versions.electron}`;
}
function renderThemes() {
  const box = $("#themes");
  box.replaceChildren();
  for (const [id, name, band, panel, acc] of THEMES) {
    const b = el("button", "theme-card");
    b.type = "button";
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(s.theme === id));
    b.style.setProperty("--c-band", band);
    b.style.setProperty("--c-panel", panel);
    b.style.setProperty("--c-acc", acc);
    const sw = el("span", "sw4");
    sw.append(el("i"), el("i"), el("i"));
    b.append(sw, el("b", null, name));
    b.addEventListener("click", async () => { await neural.call("setSetting", "theme", id); s.theme = id; renderThemes(); });
    box.append(b);
  }
}
function renderPermissions() {
  const box = $("#perm-list");
  box.replaceChildren();
  const sites = Object.entries(s.permissions || {}).filter(([, p]) => Object.keys(p).length);
  if (!sites.length) { box.append(el("div", "empty", T("set.perms.empty"))); return; }
  for (const [origin, perms] of sites) {
    const site = el("div", "perm-site");
    site.append(el("h3", null, origin.replace(/^https:\/\//, "")));
    for (const [perm, value] of Object.entries(perms)) {
      const item = el("div", "perm-item");
      const rm = el("button", "btn", T("dlg.remove"));
      rm.type = "button";
      rm.addEventListener("click", async () => { s.permissions = await neural.call("revokePermission", origin, perm); renderPermissions(); toast(T("set.perms.removed")); });
      item.append(el("span", null, PERM_LABEL[perm] ? T(PERM_LABEL[perm]) : perm), el("span", "v" + (value === "block" ? " block" : ""), T(value === "allow" ? "perm.allowed" : "perm.blocked")), rm);
      site.append(item);
    }
    box.append(site);
  }
}

$("#show-bar").addEventListener("change", (e) => neural.call("setSetting", "showBookmarksBar", e.target.checked));
$("#sync-theme").addEventListener("change", async (e) => { await neural.call("setSetting", "syncTheme", e.target.checked); load(); });
for (const r of document.querySelectorAll('input[name="startup"]')) r.addEventListener("change", () => { if (r.checked) neural.call("setSetting", "startup", r.value); });
$("#ask-path").addEventListener("change", (e) => neural.call("setSetting", "askDownloadPath", e.target.checked));
$("#dl-change").addEventListener("click", async () => { $("#dl-dir").textContent = await neural.call("chooseDownloadDir"); });
$("#default-go").addEventListener("click", () => neural.call("openDefaultApps"));
$("#default-text").replaceChildren(...rich(T("set.default.text"), { button: el("b", null, T("set.default.button")) }));

/* ---------- language: the whole series, shown from each program's next start ---------- */
const languages = NeuralI18n.languageChoices(window, (note) => { $("#lang-note").textContent = note; toast(note); });
function renderLanguages() {
  const box = $("#langs");
  box.replaceChildren();
  for (const l of languages()) {
    const b = el("button", "btn" + (l.checked() ? " primary" : ""), l.label);
    b.type = "button";
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(l.checked()));
    b.addEventListener("click", async () => { await l.pick(); renderLanguages(); });
    box.append(b);
  }
}
renderLanguages();

/* ---------- new versions of the series (update-check.js): the switch, and the newer version's page ---------- */
const upd = NeuralI18n.updates(window, T);
async function renderUpdates() {
  await upd.refresh();
  $("#check-updates").checked = upd.enabled();
  $("#update-new").hidden = !upd.latest();
  $("#update-new-label").textContent = upd.latestLabel();
}
$("#check-updates").addEventListener("change", async () => { if ($("#check-updates").checked !== upd.enabled()) await upd.toggle(); renderUpdates(); });
$("#update-open").addEventListener("click", () => upd.open());
renderUpdates();

/* ---------- shield ---------- */
const fmtStamp = new Intl.DateTimeFormat(T.locale, { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
async function loadShield(info) {
  const sh = info || await neural.call("shieldInfo");
  $("#sh-on").checked = sh.enabled;
  $("#sh-stats").textContent = T("set.shield.stats.text", { today: sh.today.toLocaleString(T.locale), total: sh.total.toLocaleString(T.locale) });
  const lists = $("#sh-lists");
  lists.classList.toggle("bad", !!sh.error && !sh.updating);
  if (sh.updating) lists.textContent = T("set.shield.lists.loading");
  else if (sh.error && !sh.ready) lists.textContent = T("set.shield.lists.failed", { error: sh.error });
  else if (sh.ready) lists.textContent = T("set.shield.lists.ready", { rules: sh.rules.toLocaleString(T.locale), when: sh.updated ? fmtStamp.format(new Date(sh.updated)) : "—", failed: sh.error ? T("set.shield.lists.last-failed", { error: sh.error }) : "" });
  else lists.textContent = T("set.shield.lists.none");
  $("#sh-update").disabled = sh.updating;
  const box = $("#sh-allow");
  box.replaceChildren();
  if (!sh.allow.length) box.append(el("div", "empty", T("set.shield.allow.empty")));
  for (const host of sh.allow) {
    const row = el("div", "allow-row");
    const b = el("button", "btn", T("dlg.remove"));
    b.type = "button";
    b.addEventListener("click", async () => { loadShield(await neural.call("shieldAllow", host, false)); toast(T("set.shield.allow.removed", { host })); });
    row.append(el("span", null, host), b);
    box.append(row);
  }
}
$("#sh-on").addEventListener("change", async (e) => loadShield(await neural.call("shieldSet", e.target.checked)));
$("#sh-update").addEventListener("click", async () => {
  $("#sh-update").disabled = true;
  const info = await neural.call("shieldUpdate");
  loadShield(info);
  toast(info.error ? T("set.shield.update-failed", { error: info.error }) : T("set.shield.updated"));
});

/* ---------- Edge import ---------- */
async function loadProfiles() {
  const sel = $("#edge-profile");
  const profiles = await neural.call("edgeProfiles");
  sel.replaceChildren();
  for (const p of profiles) { const o = el("option", null, p.name); o.value = p.dir; sel.append(o); }
  if (!profiles.length) {
    const o = el("option", null, T("imp.no-profile"));
    o.value = "";
    sel.append(o);
    sel.disabled = true;
    $("#imp-go").disabled = true;
  }
}
$("#imp-go").addEventListener("click", async () => {
  const btn = $("#imp-go");
  const out = $("#imp-result");
  const bookmarks = $("#imp-marks").checked;
  const history = $("#imp-history").checked;
  const passwords = $("#imp-passwords").checked;
  if (!bookmarks && !history && !passwords) { out.className = "result bad"; out.textContent = T("imp.nothing"); return; }
  btn.disabled = true;
  out.className = "result";
  out.textContent = T("imp.running");
  try {
    const r = await neural.call("importEdge", { profile: $("#edge-profile").value, bookmarks, history, passwords });
    const parts = [];
    const count = (key, n) => T(key, { n, num: n.toLocaleString(T.locale) });
    if (bookmarks) parts.push(count("imp.n-bookmarks", r.bookmarks));
    if (history) parts.push(count("imp.n-history", r.history));
    const errors = [...r.errors];
    const notes = [];
    if (passwords && r.passwords) {
      const p = r.passwords;
      parts.push(count("imp.n-passwords", p.added));
      if (p.same) notes.push(T("imp.note.same", { n: p.same }));
      if (p.kept) notes.push(T("imp.note.kept", { n: p.kept }));
      if (p.locked) notes.push(T("imp.note.locked", { n: p.locked }));
      errors.push(...p.errors);
    }
    const list = parts.length > 1 ? T("imp.and", { a: parts.slice(0, -1).join(", "), b: parts[parts.length - 1] }) : parts[0];
    out.textContent = `${T("imp.done", { list })}${notes.length ? " " + notes.join("; ") + "." : ""}${errors.length ? " " + errors.join(" ") : ""}`;
    if (errors.length) out.className = "result bad";
  } catch (e) {
    out.className = "result bad";
    out.textContent = T("imp.failed");
  }
  btn.disabled = false;
});

/* ---------- clear browsing data ---------- */
$("#clear-go").addEventListener("click", async () => {
  const what = { history: $("#c-history").checked, cookies: $("#c-cookies").checked, cache: $("#c-cache").checked, downloads: $("#c-downloads").checked };
  if (!Object.values(what).some(Boolean)) { $("#clear-result").className = "result bad"; $("#clear-result").textContent = T("set.clear.nothing"); return; }
  if (!(await confirmBox(T("set.clear.go"), T("set.clear.confirm"), T("set.clear.yes")))) return;
  $("#clear-go").disabled = true;
  await neural.call("clearData", what);
  $("#clear-go").disabled = false;
  $("#clear-result").className = "result";
  $("#clear-result").textContent = T("set.clear.done");
});

/* ---------- section list follows the scroll; #anchors open a section ---------- */
const links = [...document.querySelectorAll(".side a")];
function mark(id) { for (const a of links) a.classList.toggle("on", a.getAttribute("href") === "#" + id); }
const seen = new Map();
const io = new IntersectionObserver((entries) => {
  for (const e of entries) seen.set(e.target.id, e.isIntersecting);
  const first = [...document.querySelectorAll(".sections section")].find((x) => seen.get(x.id));
  if (first) mark(first.id);
}, { rootMargin: "-10% 0px -60% 0px" });
for (const sec of document.querySelectorAll(".sections section")) io.observe(sec);
function openHash() {
  const id = location.hash.slice(1);
  const sec = id && document.getElementById(id);
  if (!sec) return;
  sec.scrollIntoView({ block: "start" });
  sec.classList.remove("flash");
  void sec.offsetWidth;
  sec.classList.add("flash");
  mark(id);
}
window.addEventListener("hashchange", openHash);
window.addEventListener("neural", (e) => { if (e.detail === "settings") load(); if (e.detail === "shield") loadShield(); });
Promise.all([load(), loadProfiles(), loadShield()]).then(openHash);
