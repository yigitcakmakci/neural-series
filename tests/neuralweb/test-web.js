"use strict";
// End-to-end test of NeuralWeb against a local test server, through the DevTools protocol.
// Usage: node test-web.js            (scratch copy, via Electron)
//        node test-web.js --installed (the installed NeuralWeb.exe)
const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawn, execFileSync } = require("child_process");
const { DatabaseSync } = require("node:sqlite");
const { sleep, targets, waitTarget, attach } = require("../../tools/cdp");

const SP = __dirname;
const OUT = path.join(require("os").tmpdir(), "neural-testler"); // screenshots and throwaway profiles
fs.mkdirSync(OUT, { recursive: true });
const INSTALLED = process.argv.includes("--installed");
const EXE = INSTALLED ? path.join(process.env.USERPROFILE, "Neural", "NeuralWeb", "Program", "NeuralWeb.exe") : path.join(__dirname, "..", "..", "node_modules", "electron", "dist", "electron.exe");
const ARGS = INSTALLED ? [] : [path.join(SP, "..", "..", "out", "stage", "apps", "NeuralWeb")];
const PROC = INSTALLED ? "NeuralWeb" : "electron";
const SNAP = path.join(__dirname, "..", "..", "tools", "snap-window.ps1");
const PORT = 9341;
const box = path.join(OUT, "web-test-box");
const profile = path.join(box, "profile");
const dlDir = path.join(box, "indirilenler");
const edge = path.join(box, "Edge User Data");
let passed = 0, failed = 0;
const check = (cond, label, extra = "") => { if (cond) { passed++; console.log("  ok   " + label); } else { failed++; console.log("  FAIL " + label + (extra ? "  -> " + extra : "")); } };
const snap = (name) => { try { execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", SNAP, "-ProcessName", PROC, "-Out", path.join(OUT, name)], { stdio: "pipe" }); } catch (e) { console.log("  (ekran görüntüsü alınamadı)"); } };

/* ---------- sandbox: profile with downloads in the box, fake Edge profile ---------- */
fs.rmSync(box, { recursive: true, force: true });
fs.mkdirSync(profile, { recursive: true });
fs.mkdirSync(dlDir, { recursive: true });
fs.writeFileSync(path.join(profile, "settings.json"), JSON.stringify({ downloadDir: dlDir }));
fs.mkdirSync(path.join(edge, "Default"), { recursive: true });
fs.writeFileSync(path.join(edge, "Local State"), JSON.stringify({ profile: { info_cache: { Default: { name: "Test Profili" } } } }));
const wk = (ms) => (ms + 11644473600000) * 1000;
fs.writeFileSync(path.join(edge, "Default", "Bookmarks"), JSON.stringify({ roots: {
  bookmark_bar: { type: "folder", children: [{ type: "url", name: "Ekşi Sözlük", url: "https://eksisozluk.com/" }, { type: "folder", name: "İş", children: [{ type: "url", name: "GitHub", url: "https://github.com/" }] }] },
  other: { type: "folder", children: [{ type: "url", name: "Hacker News", url: "https://news.ycombinator.com/" }] },
  synced: { type: "folder", children: [] },
} }));
const h = new DatabaseSync(path.join(edge, "Default", "History"));
h.exec("CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT, title TEXT, visit_count INTEGER, typed_count INTEGER, last_visit_time INTEGER, hidden INTEGER)");
const ins = h.prepare("INSERT INTO urls (url, title, visit_count, typed_count, last_visit_time, hidden) VALUES (?, ?, ?, 0, ?, 0)");
ins.run("https://www.youtube.com/watch?v=1", "Müzik videosu", 40, wk(Date.now() - 3600e3));
ins.run("https://edge-only.example/", "Sadece Edge", 3, wk(Date.now() - 7200e3));
h.close();

/* ---------- local test site ---------- */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const html = (title, body) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><link rel="icon" href="/favicon.png"></head><body style="font:16px sans-serif;margin:20px">${body}</body></html>`); };
  switch (u.pathname) {
    case "/": return html("Neural Test Ana", `<h1>Neural ana sayfa</h1><p>neural kelimesi burada iki kez geçiyor: neural.</p><p><a id="l2" href="/page2" style="font-size:22px">İkinci sayfa</a></p><p><a id="dl" href="/download">indir</a></p>`);
    case "/page2": return html("Sayfa İki", `<h1>İki</h1><a id="home" href="/">Ana</a>`);
    case "/page3": return html("Sayfa Üç", "<h1>Üç</h1>");
    case "/secret": return html("Yalnız Gizli", "<h1>Gizli</h1>");
    case "/unload": return html("Ayrılma Testi", `<h1>Çıkış testi</h1><script>addEventListener('beforeunload', e => { e.preventDefault(); e.returnValue = ''; });</script>`);
    case "/download":
      res.writeHead(200, { "content-type": "application/octet-stream", "content-disposition": 'attachment; filename="neural-test.bin"', "content-length": 4096 });
      return res.end(Buffer.alloc(4096, 7));
    case "/favicon.png": res.writeHead(200, { "content-type": "image/png" }); return res.end(PNG);
    default: res.writeHead(404); return res.end("yok");
  }
});

let app = null;
function launch() {
  app = spawn(EXE, [...ARGS, `--remote-debugging-port=${PORT}`], { env: { ...process.env, NEURALWEB_PROFILE: profile, NEURALWEB_EDGE_DIR: edge }, stdio: "ignore" });
  return app;
}
// Real keystrokes (DevTools key events skip Electron's shortcut layer); sent only while NeuralWeb is in front.
function realKeys(k) {
  let out;
  try { out = execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(SP, "..", "..", "tools", "sendkeys-to.ps1"), "-ProcessId", String(app.pid), "-Keys", k], { encoding: "utf8" }).trim(); }
  catch (e) { out = String(e.stdout || e.message).trim(); }
  if (out !== "SENT") console.log(`  (tuşlar gönderilemedi: ${k} → ${out})`);
  return out === "SENT";
}
async function waitFor(fn, ms = 10000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { const v = await fn(); if (v) return v; } catch (e) { /* keep waiting */ } await sleep(150); }
  return null;
}

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const SITE = `http://localhost:${server.address().port}`;
  launch();
  const uiT = await waitTarget(PORT, (t) => /\/ui\/index\.html\?private=$/.test(t.url));
  const ui = await attach(uiT);
  const ov = await attach(await waitTarget(PORT, (t) => t.url.endsWith("/ui/popup.html")));
  const U = (body) => ui.evaluate(`const $ = s => document.querySelector(s); const $$ = s => [...document.querySelectorAll(s)]; ${body}`);
  const O = (body) => ov.evaluate(`const $ = s => document.querySelector(s); const $$ = s => [...document.querySelectorAll(s)]; ${body}`);
  const tabTarget = (match) => waitTarget(PORT, (t) => match(t.url));
  const typeOmni = async (text, enter = true) => {
    await U(`nw.cmd("focusAddress"); return 1;`);
    await waitFor(() => U(`return document.activeElement && document.activeElement.id === "omni";`), 3000);
    await U(`$("#omni").select(); return 1;`);
    await ui.call("Input.insertText", { text });
    if (enter) { await sleep(350); await ui.key("Enter", "Enter", 13, 0, "\r"); }
  };
  const activeTitle = () => U(`const t = $('.tab[aria-selected="true"] .tab-title'); return t && t.textContent;`);
  const overlayText = () => O(`return document.getElementById("root").textContent;`);
  const clickOverlay = (text) => O(`const b = $$("button, .si").find(x => x.textContent.trim().startsWith(${JSON.stringify(text)})); if (!b) return false; b.click(); return true;`);
  const tabsCount = () => U(`return $$(".tab").length;`);

  console.log("açılış");
  await waitFor(async () => (await tabsCount()) === 1);
  const ntp = await attach(await tabTarget((u) => u.startsWith("neural://newtab")));
  check(await waitFor(() => ntp.evaluate(`return !document.getElementById("import").hidden;`)), "ilk açılışta yeni sekme sayfası Edge aktarma önerisini gösteriyor");
  check(await waitFor(() => U(`return document.activeElement.id === "omni";`)), "yeni sekmede imleç adres çubuğunda");
  check(await ntp.evaluate(`return typeof window.neural === "object";`), "NeuralWeb'in kendi sayfası köprüye erişebiliyor");
  ntp.close();

  console.log("adres çubuğu ve gezinme");
  await typeOmni(`localhost:${server.address().port}/`);
  check(await waitFor(async () => (await activeTitle()) === "Neural Test Ana"), "adres çubuğuna yazılan adres açılıyor", await activeTitle());
  const page = await attach(await tabTarget((u) => u === SITE + "/"));
  check(await page.evaluate(`return typeof window.neural === "undefined";`), "web sayfaları NeuralWeb köprüsünü göremiyor");
  check(await waitFor(() => U(`return !!$('.tab[aria-selected="true"] .tab-icon img');`)), "sitenin simgesi sekmede görünüyor");
  check(await U(`return $("#sec-chip").dataset.sec;`) === "insecure", "http sitesi 'güvenli değil' olarak işaretleniyor");
  // A real click: script clicks carry no user gesture, and Chromium then skips the page on Back.
  const l2 = await page.evaluate(`const b = document.getElementById("l2").getBoundingClientRect(); return { x: b.left + 10, y: b.top + 8 };`);
  await page.click(l2.x, l2.y);
  check(await waitFor(async () => (await activeTitle()) === "Sayfa İki"), "sayfadaki bağlantı çalışıyor");
  check(await U(`return !$("#btn-back").disabled;`), "geri düğmesi etkin");
  const p2 = await attach(await tabTarget((u) => u === SITE + "/page2"));
  await p2.evaluate(`document.body.focus(); return 1;`);
  realKeys("%{LEFT}");
  check(await waitFor(async () => (await activeTitle()) === "Neural Test Ana"), "Alt+Sol ile geri gidiliyor");
  p2.close();

  console.log("güvenlik");
  const page1 = await attach(await tabTarget((u) => u === SITE + "/"));
  await page1.evaluate(`location.href = "neural://settings/"; return 1;`);
  await sleep(800);
  check(await page1.evaluate(`return location.href;`) === SITE + "/", "web sayfası neural:// sayfalarına geçemiyor");

  console.log("öneriler");
  await typeOmni("Sayfa", false);
  check(await waitFor(async () => /Sayfa İki/.test(await overlayText())), "yazarken geçmişten öneri çıkıyor", await overlayText());
  check(/Google'da ara/.test(await overlayText()), "ilk öneri Google araması");
  await ui.key("Escape", "Escape", 27);
  await sleep(300);
  await typeOmni("localh", false);
  const inline = await waitFor(() => U(`const o = $("#omni"); return o.value.startsWith("localhost:") && o.selectionStart === 6 ? o.value : null;`));
  check(!!inline, "adres satır içinde tamamlanıyor (localh → localhost:…)", inline);
  await ui.key("Escape", "Escape", 27);
  await ui.key("Escape", "Escape", 27);

  console.log("sekmeler");
  await U(`nw.cmd("newTab"); return 1;`);
  check(await waitFor(async () => (await tabsCount()) === 2), "Ctrl+T yeni sekme açıyor");
  const fresh = await attach(await tabTarget((u) => u.startsWith("neural://newtab")));
  await waitFor(() => U(`return document.activeElement.id === "omni";`), 3000);
  realKeys("^w");
  fresh.close();
  check(await waitFor(async () => (await tabsCount()) === 1), "Ctrl+W sekmeyi kapatıyor");
  await U(`nw.cmd("selectIndex", 0); return 1;`);

  console.log("yer imi");
  realKeys("^d");
  check(await waitFor(async () => /Yer imi eklendi/.test(await overlayText())), "Ctrl+D yer imi penceresini açıyor", await overlayText());
  await clickOverlay("Bitti");
  check(await waitFor(() => U(`return $$("#bm-items .bm").some(b => b.textContent === "Neural Test Ana");`)), "sayfa yer imleri çubuğunda");
  check(await U(`return $("#star").classList.contains("on");`), "yıldız dolu görünüyor");

  console.log("sayfada bul");
  realKeys("^f");
  check(await waitFor(() => U(`return !$("#findbar").hidden && document.activeElement.id === "find-input";`)), "Ctrl+F bulma çubuğunu açıyor");
  await ui.call("Input.insertText", { text: "neural" });
  const count = await waitFor(() => U(`const c = $("#find-count").textContent; return /\\/[1-9]/.test(c) ? c : null;`));
  check(!!count, "eşleşmeler sayılıyor", count);
  await ui.key("Escape", "Escape", 27);
  check(await waitFor(() => U(`return $("#findbar").hidden;`)), "Esc bulma çubuğunu kapatıyor");

  console.log("yakınlaştırma");
  realKeys("^{ADD}"); // Ctrl+Shift+0 ("=" on a Turkish keyboard) is a Windows language hotkey here
  check(await waitFor(() => U(`return !$("#zoom-chip").hidden && $("#zoom-chip").textContent;`)) === "%110", "Ctrl++ sayfayı %110 yapıyor");
  realKeys("^0");
  check(await waitFor(() => U(`return $("#zoom-chip").hidden;`)), "Ctrl+0 yakınlaştırmayı sıfırlıyor");

  console.log("sağ tık menüsü");
  const r = await page1.evaluate(`const b = document.getElementById("l2").getBoundingClientRect(); return { x: b.left + 10, y: b.top + 8 };`);
  await page1.click(r.x, r.y, { button: "right" });
  check(await waitFor(async () => /Bağlantıyı yeni sekmede aç/.test(await overlayText())), "bağlantıda sağ tık menüsü açılıyor", await overlayText());
  await clickOverlay("Bağlantıyı yeni sekmede aç");
  check(await waitFor(async () => (await tabsCount()) === 2), "bağlantı yeni sekmede açılıyor");
  check(await waitFor(() => U(`return $$(".tab-title").map(t => t.textContent).includes("Sayfa İki");`)), "yeni sekme doğru sayfayı yüklüyor");
  await page1.evaluate(`window.open("/page3"); return 1;`);
  check(await waitFor(async () => (await tabsCount()) === 3), "window.open yeni sekme açıyor");
  await U(`const ids = $$(".tab").map(t => +t.dataset.id); nw.cmd("closeOthers", ids[0]); return 1;`);
  await waitFor(async () => (await tabsCount()) === 1);
  realKeys("^+t");
  check(await waitFor(async () => (await tabsCount()) === 2), "Ctrl+Shift+T kapatılan sekmeyi geri açıyor");
  await U(`const ids = $$(".tab").map(t => +t.dataset.id); nw.cmd("closeOthers", ids[0]); return 1;`);
  await waitFor(async () => (await tabsCount()) === 1);

  console.log("izin isteği");
  await page1.evaluate(`window.__geo = "bekliyor"; navigator.geolocation.getCurrentPosition(() => window.__geo = "izin", (e) => window.__geo = "red:" + e.code); return 1;`);
  check(await waitFor(async () => /konumunu öğrenmek/.test(await overlayText())), "konum isteği Neural izin penceresi açıyor", await overlayText());
  await clickOverlay("Engelle");
  check(await waitFor(() => page1.evaluate(`return window.__geo === "red:1";`)), "Engelle sayfaya red olarak dönüyor");
  check(await waitFor(() => fs.existsSync(path.join(profile, "settings.json")) && /"geolocation":"block"/.test(fs.readFileSync(path.join(profile, "settings.json"), "utf8"))), "karar site için kaydediliyor");

  console.log("indirme");
  await page1.evaluate(`document.getElementById("dl").click(); return 1;`);
  const file = path.join(dlDir, "neural-test.bin");
  check(await waitFor(() => fs.existsSync(file) && fs.statSync(file).size === 4096), "dosya indirme klasörüne iniyor");
  check(await waitFor(() => { try { return /ZoneId=3/.test(fs.readFileSync(file + ":Zone.Identifier", "utf8")); } catch (e) { return false; } }), "dosyaya internetten geldiği işareti yazılıyor (SmartScreen)");
  check(await waitFor(async () => /neural-test\.bin/.test(await overlayText())), "indirme paneli kendiliğinden açılıyor", await overlayText());
  snap("web-test-download.png");
  await page1.evaluate(`document.getElementById("dl").click(); return 1;`);
  check(await waitFor(() => fs.existsSync(path.join(dlDir, "neural-test (1).bin"))), "aynı adlı dosya üzerine yazılmıyor: 'neural-test (1).bin'");

  console.log("hata sayfası");
  const closed = await new Promise((r) => { const t = http.createServer(); t.listen(0, "127.0.0.1", () => { const p = t.address().port; t.close(() => r(p)); }); });
  await typeOmni(`http://127.0.0.1:${closed}/`);
  check(await waitFor(() => U(`return !$("#errpanel").hidden && $("#err-title").textContent;`)) === "Bu siteye ulaşılamıyor", "ulaşılamayan site Neural hata panelini gösteriyor");
  check(await waitFor(() => U(`return $("#omni").value.includes(":${closed}");`)), "adres çubuğu açılamayan adresi gösteriyor", await U(`return $("#omni").value;`));
  check(await activeTitle() === "127.0.0.1", "hata sekmesinin adı sitenin adı oluyor", await activeTitle());
  snap("web-test-error.png");
  await U(`nw.cmd("back"); return 1;`);
  check(await waitFor(() => U(`return $("#errpanel").hidden;`)), "geri gidince hata paneli kalkıyor");

  console.log("geçmiş sayfası");
  realKeys("^h");
  const hist = await attach(await tabTarget((u) => u.startsWith("neural://history")));
  const rows = await waitFor(() => hist.evaluate(`const t = [...document.querySelectorAll(".row .title")].map(a => a.textContent); return t.length >= 2 ? t : null;`));
  check(rows && rows.includes("Neural Test Ana") && rows.includes("Sayfa İki"), "geçmiş sayfası ziyaretleri listeliyor", JSON.stringify(rows));
  check(await hist.evaluate(`return /^Bugün/.test(document.querySelector(".day").textContent);`), "kayıtlar gün başlığıyla gruplanıyor");
  snap("web-test-history.png");
  hist.close();

  console.log("Edge'den aktarma");
  await U(`nw.cmd("settings", "import"); return 1;`);
  const set = await attach(await tabTarget((u) => u.startsWith("neural://settings")));
  check(await waitFor(() => set.evaluate(`return document.getElementById("edge-profile").options[0].textContent;`)) === "Test Profili", "Edge profilleri listeleniyor");
  await set.evaluate(`document.getElementById("imp-passwords").checked = false; document.getElementById("imp-go").click(); return 1;`);
  const res = await waitFor(() => set.evaluate(`const t = document.getElementById("imp-result").textContent; return /aktarıldı/.test(t) ? t : null;`));
  check(res === "3 yer imi ve 2 geçmiş kaydı aktarıldı.", "yer imleri ve geçmiş aktarılıyor", res);
  check(await waitFor(() => U(`return $$("#bm-items .bm").some(b => b.textContent === "Ekşi Sözlük");`)), "aktarılan yer imleri çubukta görünüyor");
  await set.evaluate(`document.querySelectorAll(".theme-card")[2].click(); return 1;`);
  check(await waitFor(() => U(`return document.documentElement.classList.contains("theme-alarm");`)), "tema değişince pencere de değişiyor");
  check(await waitFor(() => set.evaluate(`return document.documentElement.classList.contains("theme-alarm");`)), "tema iç sayfalara da uygulanıyor");
  snap("web-test-settings.png");
  await set.evaluate(`document.querySelectorAll(".theme-card")[0].click(); return 1;`);
  set.close();

  console.log("gizli pencere");
  await U(`nw.cmd("newPrivate"); return 1;`);
  const pui = await attach(await waitTarget(PORT, (t) => /\/ui\/index\.html\?private=1$/.test(t.url)));
  check(await waitFor(() => pui.evaluate(`return document.documentElement.classList.contains("private") && !document.getElementById("st-private").hidden;`)), "gizli pencere ayrı görünüyor (GİZLİ)");
  await waitFor(() => pui.evaluate(`return document.querySelectorAll(".tab").length === 1;`));
  await pui.evaluate(`nw.cmd("navigate", ${JSON.stringify(SITE + "/secret")}); return 1;`);
  check(await waitFor(() => pui.evaluate(`const t = document.querySelector(".tab-title"); return t && t.textContent === "Yalnız Gizli";`)), "gizli pencerede sayfa açılıyor");
  check(await waitFor(() => pui.evaluate(`return document.getElementById("omni").value.endsWith("/secret");`)), "gizli pencerenin adres çubuğu açık sayfayı gösteriyor", await pui.evaluate(`return document.getElementById("omni").value;`));
  snap("web-test-private.png");
  await pui.evaluate(`nw.cmd("closeWindow"); return 1;`);
  pui.close();
  await sleep(800);
  await U(`nw.cmd("history"); return 1;`);
  const hist2 = await attach(await tabTarget((u) => u.startsWith("neural://history")));
  await sleep(600);
  check(await hist2.evaluate(`return ![...document.querySelectorAll(".row .title")].some(a => a.textContent === "Yalnız Gizli");`), "gizli pencerede gezilen sayfa geçmişe yazılmıyor");
  hist2.close();

  console.log("ayrılma uyarısı");
  await U(`nw.cmd("navigate", ${JSON.stringify(SITE + "/unload")}); return 1;`);
  await waitFor(async () => (await activeTitle()) === "Ayrılma Testi");
  const ul = await attach(await tabTarget((u) => u === SITE + "/unload"));
  await ul.click(50, 50);
  await sleep(200);
  const before = await tabsCount();
  await U(`nw.cmd("closeTab"); return 1;`);
  check(await waitFor(async () => /ayrılmak istiyor musun/.test(await overlayText())), "kaydedilmemiş değişiklik uyarısı Neural penceresiyle soruluyor", await overlayText());
  await clickOverlay("Ayrıl");
  check(await waitFor(async () => (await tabsCount()) === before - 1), "Ayrıl deyince sekme kapanıyor");
  ul.close();

  console.log("oturumun geri gelmesi");
  await U(`nw.cmd("navigate", ${JSON.stringify(SITE + "/page2")}); return 1;`);
  await waitFor(async () => (await activeTitle()) === "Sayfa İki");
  await U(`nw.cmd("openUrlNewTab", ${JSON.stringify(SITE + "/")}); return 1;`);
  await waitFor(async () => (await tabsCount()) === 3);
  const beforeTabs = await U(`return $$(".tab-title").map(t => t.textContent);`);
  await U(`nw.cmd("quit"); return 1;`).catch(() => {});
  for (let i = 0; i < 40 && app.exitCode === null; i++) await sleep(250);
  check(app.exitCode !== null, "Çıkış uygulamayı kapatıyor");
  [ui, ov, page, page1].forEach((c) => { try { c.close(); } catch (e) { /* closed */ } });
  launch();
  const ui2 = await attach(await waitTarget(PORT, (t) => /\/ui\/index\.html\?private=$/.test(t.url)));
  await waitFor(() => ui2.evaluate(`return document.querySelectorAll(".tab").length === ${beforeTabs.length};`));
  await sleep(1500);
  const afterTabs = await ui2.evaluate(`return [...document.querySelectorAll(".tab-title")].map(t => t.textContent);`);
  check(afterTabs.length === beforeTabs.length, "yeniden açılınca sekmeler geri geliyor", `${JSON.stringify(beforeTabs)} → ${JSON.stringify(afterTabs)}`);
  check(await ui2.evaluate(`return document.querySelectorAll("#bm-items .bm").length >= 3;`), "yer imleri kalıcı");
  snap("web-test-restored.png");
  await ui2.evaluate(`nw.cmd("quit"); return 1;`).catch(() => {});
  for (let i = 0; i < 40 && app.exitCode === null; i++) await sleep(250);
  ui2.close();
  server.close();
  console.log(`\n${passed} geçti, ${failed} kaldı`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("HATA:", e.stack || e.message); try { app.kill(); } catch (x) { /* gone */ } process.exit(2); });
