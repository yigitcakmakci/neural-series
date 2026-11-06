"use strict";
let query = "";
const fmtWhen = new Intl.DateTimeFormat(T.locale, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

function statusOf(d) {
  switch (d.state) {
    case "progressing": return `${size(d.received)}${d.total ? " / " + size(d.total) : ""} · ${T("dl.downloading")}`;
    case "paused": return `${T("dl.paused")} · ${size(d.received)}${d.total ? " / " + size(d.total) : ""}`;
    case "completed": return size(d.total || d.received);
    case "cancelled": return T("dl.cancelled");
    default: return T("dl.failed");
  }
}
async function render() {
  const all = await neural.call("downloads");
  const q = query.toLocaleLowerCase(T.locale);
  const items = q ? all.filter((d) => d.filename.toLocaleLowerCase(T.locale).includes(q) || d.url.toLocaleLowerCase(T.locale).includes(q)) : all;
  const list = $("#list");
  list.replaceChildren();
  if (!items.length) list.append(el("div", "empty", T(q ? "dl.no-match" : "dl.none-page")));
  for (const d of items) {
    const live = d.state === "progressing" || d.state === "paused";
    const bad = d.state === "cancelled" || d.state === "interrupted";
    const r = el("div", "drow" + (d.state === "completed" ? " done" : "") + (bad ? " bad" : "") + (d.state === "paused" ? " paused" : ""));
    r.append(el("div", "dic", (d.filename.match(/\.([a-z0-9]{1,5})$/i) || [, T("dl.file")])[1]));
    const mid = el("div");
    const name = el("div", "dname", d.filename);
    name.title = d.path || d.filename;
    if (d.state === "completed") name.addEventListener("click", () => act("open", d));
    const meta = el("div", "dmeta");
    const src = el("a", null, prettyUrl(d.url));
    src.href = /^https?:/i.test(d.url) ? d.url : "#";
    src.title = d.url;
    meta.append(`${statusOf(d)} · ${fmtWhen.format(new Date(d.start))} · `, src);
    mid.append(name, meta);
    if (live) {
      const bar = el("div", "dbar");
      const fill = el("i");
      fill.style.width = d.total ? `${Math.min(100, (d.received / d.total) * 100)}%` : "8%";
      bar.append(fill);
      mid.append(bar);
    }
    const acts = el("div", "dacts");
    if (d.state === "progressing") acts.append(iconButton(ICON.pause, T("dl.pause"), () => act("pause", d)), iconButton(ICON.x, T("dl.cancel"), () => act("cancel", d), "x"));
    else if (d.state === "paused") acts.append(iconButton(ICON.play, T("dl.resume"), () => act("resume", d)), iconButton(ICON.x, T("dl.cancel"), () => act("cancel", d), "x"));
    else if (d.state === "completed") acts.append(iconButton(ICON.open, T("dlg.open"), () => act("open", d)), iconButton(ICON.dir, T("dl.show"), () => act("show", d)), iconButton(ICON.x, T("dl.remove"), () => act("remove", d), "x"));
    else acts.append(iconButton(ICON.retry, T("dl.retry"), () => act("retry", d)), iconButton(ICON.x, T("dl.remove"), () => act("remove", d), "x"));
    r.append(mid, acts);
    list.append(r);
  }
}
function act(action, d) { return neural.call("downloadAction", { action, id: d.id }); }

let timer = 0;
const soon = () => { if (!timer) timer = setTimeout(() => { timer = 0; render(); }, 250); };
$("#q").addEventListener("input", () => { query = $("#q").value.trim(); soon(); });
$("#open-dir").addEventListener("click", () => neural.call("openDownloadsDir"));
$("#clear").addEventListener("click", async () => { await neural.call("clearDownloads"); toast(T("dl.cleared")); });
window.addEventListener("neural", (e) => { if (e.detail === "downloads") soon(); });
render();
