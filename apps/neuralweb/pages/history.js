"use strict";
const PAGE = 150;
let query = "";
let offset = 0;
let lastDay = "";
let loading = false;
let seq = 0;

async function load(reset) {
  if (loading && !reset) return;
  const mine = reset ? ++seq : seq;
  loading = true;
  if (reset) { offset = 0; lastDay = ""; }
  const rows = await neural.call("history", { query, limit: PAGE, offset });
  const hosts = [...new Set(rows.map((r) => r.host).filter(Boolean))];
  const icons = hosts.length ? await neural.call("favicons", hosts) : {};
  if (mine !== seq) return;
  const list = $("#list");
  if (reset) list.replaceChildren();
  offset += rows.length;
  for (const r of rows) {
    const day = dayLabel(r.time);
    if (day !== lastDay) { lastDay = day; list.append(el("div", "day", day)); }
    list.append(row(r, icons[r.host]));
  }
  if (!list.children.length) list.append(el("div", "empty", query ? `“${query}” ile eşleşen kayıt yok.` : "Tarama geçmişin boş."));
  $("#more").hidden = rows.length < PAGE;
  loading = false;
}
function row(r, fav) {
  const item = el("div", "row");
  const a = el("a", "title", r.title || prettyUrl(r.url));
  a.href = r.url;
  a.title = r.url;
  const main = el("span", "main");
  main.append(a, el("span", "host", r.host));
  const acts = el("span", "acts");
  acts.append(iconButton(ICON.x, "Geçmişten kaldır", async () => {
    await neural.call("removeHistory", r.url);
    const prev = item.previousElementSibling;
    item.remove();
    if (prev && prev.classList.contains("day") && (!prev.nextElementSibling || prev.nextElementSibling.classList.contains("day"))) prev.remove();
  }, "x"));
  item.append(el("span", "time", timeLabel(r.time)), favicon(fav), main, acts);
  return item;
}

let qTimer = 0;
$("#q").addEventListener("input", () => {
  clearTimeout(qTimer);
  qTimer = setTimeout(() => { query = $("#q").value.trim(); load(true); }, 180);
});
$("#more").addEventListener("click", () => load(false));
new IntersectionObserver((e) => { if (e[0].isIntersecting && !$("#more").hidden) load(false); }).observe($("#more"));
$("#clear").addEventListener("click", async () => {
  if (!(await confirmBox("Tüm geçmişi sil", "Tarama geçmişinin tamamı silinecek. Bu geri alınamaz."))) return;
  await neural.call("clearHistory");
  toast("Tarama geçmişi silindi.");
  load(true);
});
window.addEventListener("neural", (e) => { if (e.detail === "history") load(true); });
load(true);
$("#q").focus();
