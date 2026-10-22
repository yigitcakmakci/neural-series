"use strict";
// End-to-end test of NeuralWeb's shield (ad and tracker blocker) with the real filter lists plus a test list.
// Usage: node test-shield.js [--installed]
const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawn, execFileSync } = require("child_process");
const { sleep, waitTarget, attach } = require("../../tools/cdp");

const SP = __dirname;
const OUT = path.join(require("os").tmpdir(), "neural-testler"); // screenshots and throwaway profiles
fs.mkdirSync(OUT, { recursive: true });
const INSTALLED = process.argv.includes("--installed");
const EXE = INSTALLED ? path.join(process.env.USERPROFILE, "Neural", "NeuralWeb", "Program", "NeuralWeb.exe") : path.join(__dirname, "..", "..", "node_modules", "electron", "dist", "electron.exe");
const ARGS = INSTALLED ? [] : [path.join(SP, "..", "..", "out", "stage", "apps", "NeuralWeb")];
const PROC = INSTALLED ? "NeuralWeb" : "electron";
const SNAP = path.join(__dirname, "..", "..", "tools", "snap-window.ps1");
const PORT = 9345;
const profile = path.join(OUT, "shield-test-profile");
let passed = 0, failed = 0;
const check = (c, label, extra = "") => { if (c) { passed++; console.log("  ok   " + label); } else { failed++; console.log("  FAIL " + label + (extra ? "  -> " + extra : "")); } };
const snap = (name) => { try { execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", SNAP, "-ProcessName", PROC, "-Out", path.join(OUT, name)], { stdio: "pipe" }); } catch (e) { console.log("  (ekran görüntüsü alınamadı)"); } };
async function waitFor(fn, ms = 10000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = await fn(); if (v) return v; } catch (e) { /* retry */ } await sleep(150); } return null; }
fs.rmSync(profile, { recursive: true, force: true });

let adHits = 0;
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const port = server.address().port;
  const html = (title, body) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body style="font:16px sans-serif;margin:20px">${body}</body></html>`); };
  switch (u.pathname) {
    // Real ad and tracker addresses: blocked before any request leaves the machine.
    case "/": return html("Kalkan Gerçek", `<h1>Gerçek listeler</h1>
      <script src="https://www.google-analytics.com/analytics.js"></script>
      <script src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"></script>
      <img src="https://securepubads.g.doubleclick.net/pagead/ad.gif" width="1" height="1">
      <ins class="adsbygoogle" data-ad-client="ca-pub-0000000000000000" data-ad-slot="1" style="display:block;height:90px;background:#f0f">ADSENSE KUTUSU</ins>`);
    // Only local addresses, so turning the shield off here never reaches a real ad server.
    case "/local": return html("Kalkan Yerel", `<h1>Yerel test</h1>
      <div class="neural-test-ad" style="height:60px;background:#f80">TEST REKLAMI</div>
      <p>İçerik burada.</p>
      <script src="http://127.0.0.1:${port}/neural-test-ad.js"></script>`);
    case "/neural-test-ad.js": adHits++; res.writeHead(200, { "content-type": "text/javascript" }); return res.end("window.__adLoaded = true;");
    case "/filters.txt": res.writeHead(200, { "content-type": "text/plain" }); return res.end("! NeuralWeb test\n/neural-test-ad.js\n##.neural-test-ad\n");
    default: res.writeHead(404); return res.end("yok");
  }
});

let app = null;
function launch(env) {
  app = spawn(EXE, [...ARGS, `--remote-debugging-port=${PORT}`], { env: { ...process.env, NEURALWEB_PROFILE: profile, ...env }, stdio: "ignore" });
}

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const SITE = `http://localhost:${server.address().port}`;
  // Pages live on a name with a domain part: hiding rules need one (bare "localhost" has none, real sites always do).
  const PAGE = `http://kalkan.localhost:${server.address().port}`;
  const env = { NEURALWEB_SHIELD_EXTRA_LISTS: `${SITE}/filters.txt` };
  launch(env);
  let ui = await attach(await waitTarget(PORT, (t) => /\/ui\/index\.html\?private=$/.test(t.url)));
  let ov = await attach(await waitTarget(PORT, (t) => t.url.endsWith("/ui/popup.html")));
  const U = (body) => ui.evaluate(`const $ = s => document.querySelector(s); ${body}`);
  const overlayText = () => ov.evaluate(`return document.getElementById("root").textContent;`);
  await waitFor(() => U(`return document.querySelectorAll(".tab").length === 1;`));

  console.log("listeler");
  const ntp = await attach(await waitTarget(PORT, (t) => t.url.startsWith("neural://newtab")));
  const t0 = Date.now();
  const info = await waitFor(() => ntp.evaluate(`const i = await neural.call("shieldInfo"); return i.ready ? i : null;`), 60000);
  check(!!info, `engelleme listeleri indirilip kuruluyor (${((Date.now() - t0) / 1000).toFixed(1)} sn)`);
  check(info && info.rules > 100000, "yüz binden fazla kural yüklü", info && String(info.rules));
  check(fs.existsSync(path.join(profile, "shield-engine.bin")), "hazır motor diske kaydediliyor");
  ntp.close();

  console.log("gerçek reklam ve izleyiciler");
  await U(`nw.cmd("navigate", ${JSON.stringify(PAGE + "/")}); return 1;`);
  const real = await attach(await waitTarget(PORT, (t) => t.url === PAGE + "/"));
  await waitFor(() => real.evaluate(`return document.readyState === "complete";`));
  const n = await waitFor(() => U(`const b = $("#shield-badge"); return !b.hidden && +b.textContent >= 3 ? b.textContent : null;`));
  check(!!n, "analytics, AdSense ve DoubleClick istekleri engelleniyor (rozet ≥ 3)", n || await U(`return $("#shield-badge").textContent;`));
  check(await real.evaluate(`return typeof window.ga === "undefined" && typeof window.adsbygoogle?.loaded === "undefined";`), "izleme ve reklam betikleri sayfada çalışmadı");
  check(await waitFor(() => real.evaluate(`return getComputedStyle(document.querySelector(".adsbygoogle")).display === "none";`)), "AdSense kutusu sayfada gizleniyor");
  check(await U(`return $("#btn-shield").dataset.state === "on" && $("#btn-shield").classList.contains("hit");`), "kalkan simgesi etkin ve renkli");
  real.close();

  console.log("yerel test reklamı");
  await U(`nw.cmd("navigate", ${JSON.stringify(PAGE + "/local")}); return 1;`);
  let page = await attach(await waitTarget(PORT, (t) => t.url === PAGE + "/local"));
  await waitFor(() => page.evaluate(`return document.readyState === "complete";`));
  check(adHits === 0 && await page.evaluate(`return window.__adLoaded !== true;`), "listedeki betik hiç istenmiyor", `sunucuya ulaşan istek: ${adHits}`);
  check(await waitFor(() => page.evaluate(`return getComputedStyle(document.querySelector(".neural-test-ad")).display === "none";`)), "listedeki öğe gizleniyor");
  check(await waitFor(() => U(`return $("#shield-badge").textContent === "1";`)), "sayaç yeni sayfada sıfırdan başlıyor (1)", await U(`return $("#shield-badge").textContent;`));

  console.log("kalkan paneli");
  const r = await U(`const b = $("#btn-shield").getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 };`);
  await ui.click(r.x, r.y);
  check(await waitFor(async () => /Kalkan · kalkan\.localhost/.test(await overlayText())), "kalkan simgesine basınca panel açılıyor", await overlayText());
  check(/127\.0\.0\.1/.test(await overlayText()) && /Bu sitede kalkan/.test(await overlayText()), "panel engellenen adresi ve site anahtarını gösteriyor");
  await sleep(300);
  snap("shield-popup.png");
  await ov.evaluate(`document.querySelector(".sh-switch").click(); return 1;`);
  check(await waitFor(() => U(`return $("#btn-shield").dataset.state === "site";`)), "site için kapatılınca simge çizgili oluyor");
  check(await waitFor(async () => /Bu sitede kapalı/.test(await overlayText()) && /Panel kapanınca/.test(await overlayText())), "panel açık kalıyor ve yenileneceğini söylüyor", await overlayText());
  await sleep(300);
  snap("shield-popup-off.png");
  check(adHits === 0, "panel açıkken sayfa yenilenmiyor");
  await U(`nw.popupClose(); return 1;`);
  check(await waitFor(() => adHits === 1), "panel kapanınca sayfa yenileniyor ve bu sitede reklam yükleniyor", `istek: ${adHits}`);
  page.close();
  page = await attach(await waitTarget(PORT, (t) => t.url === PAGE + "/local"));
  check(await waitFor(() => page.evaluate(`return window.__adLoaded === true && getComputedStyle(document.querySelector(".neural-test-ad")).display !== "none";`)), "bu sitede öğeler de gizlenmiyor");
  await ui.click(r.x, r.y);
  check(await waitFor(async () => /Bu sitede kapalı/.test(await overlayText())), "panel yeniden açılınca 'Bu sitede kapalı' diyor");
  await ov.evaluate(`document.querySelector(".sh-switch").click(); return 1;`);
  await waitFor(() => U(`return $("#btn-shield").dataset.state === "on";`));
  await U(`nw.popupClose(); return 1;`);
  check(await waitFor(() => U(`return $("#btn-shield").dataset.state === "on" && $("#shield-badge").textContent === "1";`)), "yeniden açınca sayfa yenilenip yine engelleniyor");
  check(adHits === 1, "yeniden açıkken sunucuya yeni istek gitmiyor", `istek: ${adHits}`);

  console.log("ayarlar");
  await U(`nw.cmd("settings", "shield"); return 1;`);
  const set = await attach(await waitTarget(PORT, (t) => t.url.startsWith("neural://settings")));
  check(await waitFor(() => set.evaluate(`return /kural/.test(document.getElementById("sh-lists").textContent) && document.getElementById("sh-on").checked;`)), "ayarlarda listeler ve açık anahtar görünüyor", await set.evaluate(`return document.getElementById("sh-lists").textContent;`));
  check(await set.evaluate(`return /Bugün [1-9]/.test(document.getElementById("sh-stats").textContent);`), "engellenen sayısı ayarlarda", await set.evaluate(`return document.getElementById("sh-stats").textContent;`));
  await sleep(500);
  snap("shield-settings.png");
  await set.evaluate(`document.getElementById("sh-on").click(); return 1;`);
  check(await waitFor(() => set.evaluate(`return !document.getElementById("sh-on").checked;`)), "kalkan tamamen kapatılabiliyor");
  await U(`nw.cmd("selectIndex", 0); return 1;`);
  check(await waitFor(() => U(`return $("#btn-shield").dataset.state === "off";`)), "kapalıyken simge kapalı görünüyor");
  await U(`nw.cmd("reload"); return 1;`);
  check(await waitFor(() => adHits === 2), "kapalıyken reklam yükleniyor", `istek: ${adHits}`);
  await U(`nw.cmd("selectIndex", 1); return 1;`);
  await set.evaluate(`document.getElementById("sh-on").click(); return 1;`);
  check(await waitFor(() => set.evaluate(`return document.getElementById("sh-on").checked;`)), "kalkan yeniden açılıyor");
  set.close();
  await U(`nw.cmd("selectIndex", 0); return 1;`);
  await U(`nw.cmd("reload"); return 1;`);
  await sleep(1500);
  check(adHits === 2, "açılınca yine engelliyor", `istek: ${adHits}`);

  console.log("gizli pencere");
  const totalBefore = JSON.parse(fs.readFileSync(path.join(profile, "settings.json"), "utf8")).shield.total;
  await U(`nw.cmd("newPrivate"); return 1;`);
  const pui = await attach(await waitTarget(PORT, (t) => /\/ui\/index\.html\?private=1$/.test(t.url)));
  await waitFor(() => pui.evaluate(`return document.querySelectorAll(".tab").length === 1;`));
  await pui.evaluate(`nw.cmd("navigate", ${JSON.stringify(PAGE + "/local")}); return 1;`);
  check(await waitFor(() => pui.evaluate(`const b = document.getElementById("shield-badge"); return !b.hidden && b.textContent === "1";`)), "gizli pencerede de engelleniyor");
  check(adHits === 2, "gizli pencerede reklam sunucuya ulaşmıyor", `istek: ${adHits}`);
  await sleep(1000);
  const totalAfter = JSON.parse(fs.readFileSync(path.join(profile, "settings.json"), "utf8")).shield.total;
  check(totalAfter === totalBefore, "gizli penceredeki engeller sayaca yazılmıyor", `${totalBefore} → ${totalAfter}`);
  await pui.evaluate(`nw.cmd("closeWindow"); return 1;`);
  pui.close();

  console.log("yeniden açılış");
  await sleep(600);
  await U(`nw.cmd("quit"); return 1;`).catch(() => {});
  for (let i = 0; i < 40 && app.exitCode === null; i++) await sleep(250);
  ui.close(); ov.close();
  launch({}); // no extra list this time: the cached engine must be used, without downloading
  ui = await attach(await waitTarget(PORT, (t) => /\/ui\/index\.html\?private=$/.test(t.url)));
  const started = Date.now();
  await waitFor(() => ui.evaluate(`return document.querySelectorAll(".tab").length >= 1;`));
  await ui.evaluate(`nw.cmd("newTab"); return 1;`);
  const ntp2 = await attach(await waitTarget(PORT, (t) => t.url.startsWith("neural://newtab")));
  const i2 = await waitFor(() => ntp2.evaluate(`const i = await neural.call("shieldInfo"); return i.ready && !i.updating ? i : null;`), 5000);
  check(!!i2 && Date.now() - started < 5000, "kayıtlı motor açılışta indirmeden yükleniyor");
  check(await waitFor(() => ntp2.evaluate(`return /BUGÜN [0-9.]+ REKLAM/.test(document.getElementById("shield-line").textContent);`)), "yeni sekme bugünkü engel sayısını gösteriyor", await ntp2.evaluate(`return document.getElementById("shield-line").textContent;`));
  await sleep(400);
  snap("shield-ntp.png");
  ntp2.close();
  await ui.evaluate(`nw.cmd("quit"); return 1;`).catch(() => {});
  for (let i = 0; i < 40 && app.exitCode === null; i++) await sleep(250);
  ui.close();
  server.close();
  fs.rmSync(profile, { recursive: true, force: true });
  console.log(`\n${passed} geçti, ${failed} kaldı`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("HATA:", e.stack || e.message); try { app.kill(); } catch (x) { /* gone */ } process.exit(2); });
