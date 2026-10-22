"use strict";
// Helpers shared by NeuralWeb's own pages. `neural` is the bridge the preload gives only to neural:// pages.
const $ = (s, r = document) => r.querySelector(s);
const ICON = {
  globe: "M8 2a6 6 0 1 1 0 12A6 6 0 0 1 8 2zM2 8h12M8 2c-2.2 2.4-2.2 9.6 0 12M8 2c2.2 2.4 2.2 9.6 0 12",
  folder: "M2 4h4.5l1.5 1.5H14V13H2z",
  search: "M7 3a4 4 0 1 1 0 8a4 4 0 0 1 0-8zM10 10l3.5 3.5",
  x: "M4 4l8 8M12 4l-8 8",
  up: "M4 10l4-4 4 4",
  down: "M4 6l4 4 4-4",
  edit: "M3 13l1-3.5L10.5 3 13 5.5 6.5 12zM9 4.5L11.5 7",
  dir: "M2 4h4.5l1.5 1.5H14V13H2zM8 7.5v4M6 9.5l2 2 2-2",
  open: "M9 3h4v4M13 3L7.5 8.5M11 9.5V13H3V5h3.5",
  pause: "M5.5 3.5v9M10.5 3.5v9",
  play: "M5 3l8 5-8 5z",
  retry: "M13 4.5V8h-3.5M12.6 7.6A5 5 0 1 0 11 11.6",
  plus: "M8 3v10M3 8h10",
};
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
function icon(d, cls) {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 16 16");
  s.setAttribute("aria-hidden", "true");
  if (cls) s.setAttribute("class", cls);
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", d);
  s.append(p);
  return s;
}
function favicon(data) {
  if (!data) return icon(ICON.globe, "fav");
  const img = el("img", "fav");
  img.alt = "";
  img.src = data;
  img.addEventListener("error", () => img.replaceWith(icon(ICON.globe, "fav")), { once: true });
  return img;
}
function iconButton(d, title, onClick, extra = "") {
  const b = el("button", "ib " + extra);
  b.type = "button";
  b.title = title;
  b.setAttribute("aria-label", title);
  b.append(icon(d));
  b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); onClick(); });
  return b;
}
function prettyUrl(u) {
  if (!u) return "";
  let s = u;
  try { s = decodeURI(u); } catch (e) { /* keep encoded */ }
  return s.replace(/^https:\/\//i, "").replace(/^([^/?#]+)\/$/, "$1");
}
const hostOf = (u) => { try { return new URL(u).hostname; } catch (e) { return ""; } };
function size(n) {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toLocaleString("tr-TR", { maximumFractionDigits: n < 10 && i ? 1 : 0 })} ${u[i]}`;
}
const fmtDay = new Intl.DateTimeFormat("tr-TR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const fmtTime = new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" });
function dayLabel(ms) {
  const d = new Date(ms);
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const diff = Math.round((start - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
  if (diff === 0) return `Bugün · ${fmtDay.format(d)}`;
  if (diff === 1) return `Dün · ${fmtDay.format(d)}`;
  return fmtDay.format(d);
}
const timeLabel = (ms) => fmtTime.format(new Date(ms));
let toastTimer = 0;
function toast(text) {
  let t = $(".toast");
  if (!t) { t = el("div", "toast"); t.setAttribute("role", "status"); document.body.append(t); }
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}
// A yes/no question in a Neural dialog; resolves true for yes.
function confirmBox(title, text, yes = "Sil") {
  return new Promise((resolve) => {
    const d = el("dialog", "hud");
    const f = el("form");
    f.method = "dialog";
    const body = el("div", "body");
    const content = el("div", "content");
    content.append(el("p", null, text));
    const btns = el("div", "btns");
    const ok = el("button", "btn danger", yes);
    ok.value = "ok";
    const no = el("button", "btn primary", "Vazgeç");
    no.value = "cancel";
    btns.append(ok, no);
    body.append(el("h2", null, title), content, btns);
    f.append(body);
    d.append(f);
    document.body.append(d);
    d.addEventListener("close", () => { resolve(d.returnValue === "ok"); d.remove(); });
    d.showModal();
    no.focus();
  });
}

const neuralReady = (async () => {
  try {
    const s = await neural.call("settings");
    document.documentElement.className = `theme-${s.theme}${s.priv ? " private" : ""}`;
    return s;
  } catch (e) { return null; }
})();
neural.on(({ topic }) => {
  if (topic === "settings") neural.call("settings").then((s) => { document.documentElement.className = `theme-${s.theme}${s.priv ? " private" : ""}`; });
  window.dispatchEvent(new CustomEvent("neural", { detail: topic }));
});
