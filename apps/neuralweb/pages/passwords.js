"use strict";
const KEY = "M10.5 2.5a3 3 0 1 1-2.6 4.5L3 11.9V13.5h1.6v-1.2h1.2V11h1.2l1.4-1.4A3 3 0 0 1 10.5 2.5zM11 5h.01";
const EYE = "M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8zM8 6a2 2 0 1 1 0 4a2 2 0 0 1 0-4z";
const COPY = "M5.5 5.5h7v8h-7zM3.5 10.5v-8h7";
let data = { logins: [], never: [], offer: true };
let query = "";
const shown = new Map(); // id → timer of a password currently shown

async function load() {
  data = await neural.call("pwList");
  $("#offer").checked = data.offer;
  const hosts = [...new Set(data.logins.map((l) => hostOf(l.origin)))];
  const icons = hosts.length ? await neural.call("favicons", hosts) : {};
  render(icons);
}
function render(icons) {
  for (const timer of shown.values()) clearTimeout(timer);
  shown.clear();
  const list = $("#list");
  list.replaceChildren();
  const q = query.toLocaleLowerCase(T.locale);
  const items = data.logins.filter((l) => !q || l.origin.toLocaleLowerCase(T.locale).includes(q) || l.username.toLocaleLowerCase(T.locale).includes(q));
  if (!items.length) list.append(el("div", "empty", T(q ? "pw.no-match" : "pw.empty")));
  for (const l of items) list.append(row(l, icons[hostOf(l.origin)]));
  const never = $("#never");
  never.replaceChildren();
  if (!data.never.length) never.append(el("div", "empty", T("pw.never.empty")));
  for (const origin of data.never) {
    const r = el("div", "never");
    const b = el("button", "btn", T("dlg.remove"));
    b.type = "button";
    b.addEventListener("click", () => neural.call("pwNeverRemove", origin));
    r.append(el("span", null, origin.replace(/^https:\/\//, "")), b);
    never.append(r);
  }
}
function row(l, fav) {
  const r = el("div", "prow");
  const site = el("a", "site", l.origin.replace(/^https:\/\//, ""));
  site.href = l.origin;
  site.title = l.origin;
  const pass = el("span", "pass", "••••••••••");
  const hide = () => { clearTimeout(shown.get(l.id)); shown.delete(l.id); pass.textContent = "••••••••••"; pass.classList.remove("shown"); eye.title = T("pw.reveal"); };
  const eye = iconButton(EYE, T("pw.reveal"), async () => {
    if (shown.has(l.id)) return hide();
    const p = await neural.call("pwReveal", l.id);
    if (p == null) { toast(T("pw.not-verified.show")); return; }
    pass.textContent = p;
    pass.classList.add("shown");
    eye.title = T("pw.conceal");
    shown.set(l.id, setTimeout(hide, 30e3)); // shown for at most half a minute
  });
  const copy = iconButton(COPY, T("pw.copy"), async () => {
    toast(T((await neural.call("pwCopy", l.id)) ? "pw.copied" : "pw.not-verified.copy"));
  });
  const edit = iconButton(ICON.edit, T("dlg.edit"), () => editLogin(l));
  const del = iconButton(ICON.x, T("dlg.delete"), async () => {
    const site = l.origin.replace(/^https:\/\//, "");
    if (!(await confirmBox(T("pw.delete"), l.username ? T("pw.delete.text", { site, user: l.username }) : T("pw.delete.text-nouser", { site })))) return;
    await neural.call("pwRemove", l.id);
    toast(T("pw.deleted"));
  }, "x");
  const acts = el("span", "acts");
  acts.append(eye, copy, edit, del);
  r.append(favicon(fav), site, el("span", "user", l.username || T("pw.no-username")), pass, acts);
  return r;
}

function dialogFor({ title, login }) {
  const d = $("#dlg");
  $("#dlg-title").textContent = title;
  $("#f-site-wrap").hidden = !!login;
  $("#f-site").required = !login;
  $("#f-site").value = "";
  $("#f-user").value = login ? login.username : "";
  $("#f-pass").value = "";
  $("#f-pass").type = "password";
  $("#f-pass").required = !login;
  $("#f-pass-label").textContent = T(login ? "pw.new-pass.keep" : "pw.password");
  d.returnValue = "";
  d.showModal();
  (login ? $("#f-user") : $("#f-site")).focus();
  return new Promise((resolve) => d.addEventListener("close", () => resolve(d.returnValue === "ok" ? { site: $("#f-site").value.trim(), username: $("#f-user").value.trim(), password: $("#f-pass").value } : null), { once: true }));
}
$("#f-eye").addEventListener("click", () => {
  const p = $("#f-pass");
  p.type = p.type === "password" ? "text" : "password";
  $("#f-eye").textContent = T(p.type === "password" ? "pw.show" : "pw.hide");
});
async function editLogin(l) {
  const v = await dialogFor({ title: T("pw.edit"), login: l });
  if (!v) return;
  await neural.call("pwUpdate", l.id, { username: v.username, password: v.password || undefined });
  toast(T("pw.saved"));
}
$("#add").addEventListener("click", async () => {
  const v = await dialogFor({ title: T("pw.add"), login: null });
  if (!v) return;
  toast(T((await neural.call("pwAdd", { url: v.site, username: v.username, password: v.password })) ? "pw.added" : "pw.bad-site"));
});
$("#offer").addEventListener("change", (e) => neural.call("setSetting", "passwordsOffer", e.target.checked));

$("#csv").addEventListener("click", async () => {
  const r = await neural.call("pwImportCsv");
  if (!r) return;
  const box = $("#csv-result");
  box.replaceChildren();
  box.hidden = false;
  const inner = el("div", "csv");
  if (r.error) inner.append(el("p", "warn", r.error));
  else {
    inner.append(el("p", null, `${T("pw.csv.added", { file: r.file, n: r.added })}${r.same ? T("pw.csv.same", { n: r.same }) : ""}${r.kept ? T("pw.csv.kept", { n: r.kept }) : ""}${r.skipped ? T("pw.csv.skipped", { n: r.skipped }) : ""}.`));
    inner.append(el("p", "warn", T("pw.csv.warn")));
    const btns = el("div", "row-btns");
    const trash = el("button", "btn danger", T("pw.csv.trash"));
    trash.type = "button";
    trash.addEventListener("click", async () => {
      if (await neural.call("pwTrashCsv")) { trash.disabled = true; toast(T("pw.csv.trashed")); }
      else toast(T("pw.csv.trash-failed"));
    });
    btns.append(trash);
    inner.append(btns);
  }
  const panel = el("div", "panel");
  const pin = el("div", "panel-in");
  pin.append(inner);
  panel.append(pin);
  box.append(panel);
});

let qTimer = 0;
$("#q").addEventListener("input", () => { clearTimeout(qTimer); qTimer = setTimeout(() => { query = $("#q").value.trim(); load(); }, 120); });
window.addEventListener("neural", (e) => { if (e.detail === "passwords" || e.detail === "settings") load(); });
load();
