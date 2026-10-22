"use strict";
const fmtDate = new Intl.DateTimeFormat("tr-TR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
function tick() {
  const now = new Date();
  $("#clock").textContent = fmtTime.format(now);
  $("#date").textContent = fmtDate.format(now);
}
tick();
setInterval(tick, 1000);

$("#search").addEventListener("submit", (e) => {
  e.preventDefault();
  const q = $("#q").value.trim();
  if (q) neural.call("open", q);
});

async function tiles() {
  const box = $("#tiles");
  const sites = await neural.call("topSites");
  box.replaceChildren();
  if (!sites.length) {
    box.append(el("div", "tiles-empty", "En sık girdiğin siteler burada görünecek."));
    return;
  }
  for (const s of sites) {
    const a = el("a", "tile");
    a.href = s.url;
    a.title = `${s.title}\n${s.host}`;
    const ic = el("span", "ic");
    if (s.favicon) ic.append(favicon(s.favicon));
    else ic.append(el("span", "letter", (s.host.replace(/^www\./, "")[0] || "?").toLocaleUpperCase("tr-TR")));
    a.append(ic, el("span", "t", s.title || s.host), el("span", "h", s.host.replace(/^www\./, "")));
    box.append(a);
  }
}
async function importBanner() {
  $("#import").hidden = !(await neural.call("firstRun"));
}
$("#import-later").addEventListener("click", async () => {
  await neural.call("dismissImport");
  $("#import").hidden = true;
});
async function shieldLine() {
  const sh = await neural.call("shieldInfo");
  const line = $("#shield-line");
  line.hidden = !sh.enabled;
  line.replaceChildren("KALKAN // ");
  if (sh.today) line.append("BUGÜN ", el("b", null, sh.today.toLocaleString("tr-TR")), " REKLAM VE İZLEYİCİ ENGELLENDİ");
  else line.append(el("b", null, "AKTİF"));
}
tiles();
importBanner();
shieldLine();
window.addEventListener("neural", (e) => { if (e.detail === "history") tiles(); if (e.detail === "shield") shieldLine(); });
