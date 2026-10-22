"use strict";
const THEMES = [
  ["neon", "Neon", "#fcee0a", "#0c0d15", "#00f0ff"],
  ["ice", "Buz", "#00f0ff", "#0a1018", "#ff4fd8"],
  ["alarm", "Alarm", "#ff2a4f", "#110a0d", "#fcee0a"],
  ["daylight", "Gündüz", "#0a0a0c", "#fcee0a", "#007f8c"],
];
const PERM_LABEL = { media: "Kamera ve mikrofon", geolocation: "Konum", notifications: "Bildirimler", "clipboard-read": "Pano okuma", midi: "MIDI cihazları", midiSysex: "MIDI (tam erişim)" };
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
  $("#versions").textContent = `Sürüm ${s.versions.app} · Chromium ${s.versions.chrome} · Electron ${s.versions.electron}`;
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
  if (!sites.length) { box.append(el("div", "empty", "Henüz hiçbir siteye izin vermedin ya da engellemedin. Bir site kamera, konum veya bildirim istediğinde verdiğin cevaplar burada listelenir.")); return; }
  for (const [origin, perms] of sites) {
    const site = el("div", "perm-site");
    site.append(el("h3", null, origin.replace(/^https:\/\//, "")));
    for (const [perm, value] of Object.entries(perms)) {
      const item = el("div", "perm-item");
      const rm = el("button", "btn", "Kaldır");
      rm.type = "button";
      rm.addEventListener("click", async () => { s.permissions = await neural.call("revokePermission", origin, perm); renderPermissions(); toast("İzin kaldırıldı; site bir dahaki sefere yeniden soracak."); });
      item.append(el("span", null, PERM_LABEL[perm] || perm), el("span", "v" + (value === "block" ? " block" : ""), value === "allow" ? "İZİN VERİLDİ" : "ENGELLENDİ"), rm);
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

/* ---------- shield ---------- */
const fmtStamp = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
async function loadShield(info) {
  const sh = info || await neural.call("shieldInfo");
  $("#sh-on").checked = sh.enabled;
  $("#sh-stats").textContent = `Bugün ${sh.today.toLocaleString("tr-TR")} · Bugüne kadar ${sh.total.toLocaleString("tr-TR")}`;
  const lists = $("#sh-lists");
  lists.classList.toggle("bad", !!sh.error && !sh.updating);
  if (sh.updating) lists.textContent = "Listeler indiriliyor ve hazırlanıyor…";
  else if (sh.error && !sh.ready) lists.textContent = `Listeler indirilemedi: ${sh.error}`;
  else if (sh.ready) lists.textContent = `EasyList, EasyPrivacy, uBlock Origin ve Peter Lowe · ${sh.rules.toLocaleString("tr-TR")} kural · son güncelleme ${sh.updated ? fmtStamp.format(new Date(sh.updated)) : "—"}${sh.error ? " · son deneme başarısız: " + sh.error : ""} · birkaç günde bir kendiliğinden yenilenir`;
  else lists.textContent = "Listeler henüz indirilmedi.";
  $("#sh-update").disabled = sh.updating;
  const box = $("#sh-allow");
  box.replaceChildren();
  if (!sh.allow.length) box.append(el("div", "empty", "Kalkanı kapattığın site yok. Bir sitede kapatmak için araç çubuğundaki kalkan simgesine bas."));
  for (const host of sh.allow) {
    const row = el("div", "allow-row");
    const b = el("button", "btn", "Kaldır");
    b.type = "button";
    b.addEventListener("click", async () => { loadShield(await neural.call("shieldAllow", host, false)); toast(`Kalkan ${host} için yeniden açık.`); });
    row.append(el("span", null, host), b);
    box.append(row);
  }
}
$("#sh-on").addEventListener("change", async (e) => loadShield(await neural.call("shieldSet", e.target.checked)));
$("#sh-update").addEventListener("click", async () => {
  $("#sh-update").disabled = true;
  const info = await neural.call("shieldUpdate");
  loadShield(info);
  toast(info.error ? `Güncellenemedi: ${info.error}` : "Engelleme listeleri güncellendi.");
});

/* ---------- Edge import ---------- */
async function loadProfiles() {
  const sel = $("#edge-profile");
  const profiles = await neural.call("edgeProfiles");
  sel.replaceChildren();
  for (const p of profiles) { const o = el("option", null, p.name); o.value = p.dir; sel.append(o); }
  if (!profiles.length) {
    const o = el("option", null, "Edge profili bulunamadı");
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
  if (!bookmarks && !history && !passwords) { out.className = "result bad"; out.textContent = "Aktarılacak bir şey seçmedin."; return; }
  btn.disabled = true;
  out.className = "result";
  out.textContent = "Aktarılıyor…";
  try {
    const r = await neural.call("importEdge", { profile: $("#edge-profile").value, bookmarks, history, passwords });
    const parts = [];
    if (bookmarks) parts.push(`${r.bookmarks.toLocaleString("tr-TR")} yer imi`);
    if (history) parts.push(`${r.history.toLocaleString("tr-TR")} geçmiş kaydı`);
    const errors = [...r.errors];
    const notes = [];
    if (passwords && r.passwords) {
      const p = r.passwords;
      parts.push(`${p.added.toLocaleString("tr-TR")} şifre`);
      if (p.same) notes.push(`${p.same} şifre zaten vardı`);
      if (p.kept) notes.push(`${p.kept} hesapta NeuralWeb'deki şifre korundu`);
      if (p.locked) notes.push(`${p.locked} şifreyi Edge kendine kilitlemiş; onları Edge'den CSV olarak dışa aktarıp Şifreler sayfasından içe aktarabilirsin`);
      errors.push(...p.errors);
    }
    const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} ve ${parts[parts.length - 1]}` : parts[0];
    out.textContent = `${list} aktarıldı.${notes.length ? " " + notes.join("; ") + "." : ""}${errors.length ? " " + errors.join(" ") : ""}`;
    if (errors.length) out.className = "result bad";
  } catch (e) {
    out.className = "result bad";
    out.textContent = "Aktarma başarısız oldu.";
  }
  btn.disabled = false;
});

/* ---------- clear browsing data ---------- */
$("#clear-go").addEventListener("click", async () => {
  const what = { history: $("#c-history").checked, cookies: $("#c-cookies").checked, cache: $("#c-cache").checked, downloads: $("#c-downloads").checked };
  if (!Object.values(what).some(Boolean)) { $("#clear-result").className = "result bad"; $("#clear-result").textContent = "Temizlenecek bir şey seçmedin."; return; }
  if (!(await confirmBox("Verileri temizle", "Seçtiğin veriler bu bilgisayardaki NeuralWeb profilinden silinecek. Bu geri alınamaz.", "Temizle"))) return;
  $("#clear-go").disabled = true;
  await neural.call("clearData", what);
  $("#clear-go").disabled = false;
  $("#clear-result").className = "result";
  $("#clear-result").textContent = "Temizlendi.";
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
