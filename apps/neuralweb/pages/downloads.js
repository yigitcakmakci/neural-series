"use strict";
let query = "";
const fmtWhen = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

function statusOf(d) {
  switch (d.state) {
    case "progressing": return `${size(d.received)}${d.total ? " / " + size(d.total) : ""} · indiriliyor`;
    case "paused": return `Duraklatıldı · ${size(d.received)}${d.total ? " / " + size(d.total) : ""}`;
    case "completed": return size(d.total || d.received);
    case "cancelled": return "İptal edildi";
    default: return "Başarısız oldu";
  }
}
async function render() {
  const all = await neural.call("downloads");
  const q = query.toLocaleLowerCase("tr-TR");
  const items = q ? all.filter((d) => d.filename.toLocaleLowerCase("tr-TR").includes(q) || d.url.toLocaleLowerCase("tr-TR").includes(q)) : all;
  const list = $("#list");
  list.replaceChildren();
  if (!items.length) list.append(el("div", "empty", q ? "Eşleşen indirme yok." : "Henüz bir şey indirmedin."));
  for (const d of items) {
    const live = d.state === "progressing" || d.state === "paused";
    const bad = d.state === "cancelled" || d.state === "interrupted";
    const r = el("div", "drow" + (d.state === "completed" ? " done" : "") + (bad ? " bad" : "") + (d.state === "paused" ? " paused" : ""));
    r.append(el("div", "dic", (d.filename.match(/\.([a-z0-9]{1,5})$/i) || [, "dosya"])[1]));
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
    if (d.state === "progressing") acts.append(iconButton(ICON.pause, "Duraklat", () => act("pause", d)), iconButton(ICON.x, "İptal et", () => act("cancel", d), "x"));
    else if (d.state === "paused") acts.append(iconButton(ICON.play, "Devam et", () => act("resume", d)), iconButton(ICON.x, "İptal et", () => act("cancel", d), "x"));
    else if (d.state === "completed") acts.append(iconButton(ICON.open, "Aç", () => act("open", d)), iconButton(ICON.dir, "Klasörde göster", () => act("show", d)), iconButton(ICON.x, "Listeden kaldır", () => act("remove", d), "x"));
    else acts.append(iconButton(ICON.retry, "Yeniden dene", () => act("retry", d)), iconButton(ICON.x, "Listeden kaldır", () => act("remove", d), "x"));
    r.append(mid, acts);
    list.append(r);
  }
}
function act(action, d) { return neural.call("downloadAction", { action, id: d.id }); }

let timer = 0;
const soon = () => { if (!timer) timer = setTimeout(() => { timer = 0; render(); }, 250); };
$("#q").addEventListener("input", () => { query = $("#q").value.trim(); soon(); });
$("#open-dir").addEventListener("click", () => neural.call("openDownloadsDir"));
$("#clear").addEventListener("click", async () => { await neural.call("clearDownloads"); toast("Liste temizlendi; dosyalar yerinde duruyor."); });
window.addEventListener("neural", (e) => { if (e.detail === "downloads") soon(); });
render();
