"use strict";
// End-to-end test of NeuralWeb's password manager with generated test accounts on a local test site.
// Windows Hello is never raised: NEURALWEB_TEST_HELLO answers for it in test profiles.
// Usage: node test-passwords.js [--installed]
const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const { spawn, execFileSync } = require("child_process");
const { DatabaseSync } = require("node:sqlite");
const { sleep, waitTarget, attach } = require("../../tools/cdp");

const SP = __dirname;
const OUT = path.join(require("os").tmpdir(), "neural-testler"); // screenshots and throwaway profiles
fs.mkdirSync(OUT, { recursive: true });
const INSTALLED = process.argv.includes("--installed");
const APPDIR = INSTALLED ? path.join(process.env.USERPROFILE, "Neural", "NeuralWeb", "Program", "resources", "app") : path.join(SP, "..", "..", "out", "stage", "apps", "NeuralWeb");
const EXE = INSTALLED ? path.join(process.env.USERPROFILE, "Neural", "NeuralWeb", "Program", "NeuralWeb.exe") : path.join(__dirname, "..", "..", "node_modules", "electron", "dist", "electron.exe");
const ARGS = INSTALLED ? [] : [APPDIR];
const PROC = INSTALLED ? "NeuralWeb" : "electron";
const SNAP = path.join(__dirname, "..", "..", "tools", "snap-window.ps1");
const PORT = 9347;
const box = path.join(OUT, "pw-test-box");
const profile = path.join(box, "profile");
const edge = path.join(box, "Edge User Data");
let passed = 0, failed = 0;
const check = (c, label, extra = "") => { if (c) { passed++; console.log("  ok   " + label); } else { failed++; console.log("  FAIL " + label + (extra ? "  -> " + extra : "")); } };
const snap = (name) => { try { execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", SNAP, "-ProcessName", PROC, "-Out", path.join(OUT, name)], { stdio: "pipe" }); } catch (e) { console.log("  (ekran görüntüsü alınamadı)"); } };
async function waitFor(fn, ms = 10000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = await fn(); if (v) return v; } catch (e) { /* retry */ } await sleep(150); } return null; }

// Generated test accounts; they exist only in this sandbox.
const USER = "test-kullanici-" + crypto.randomBytes(3).toString("hex");
const PASS = "Dn-" + crypto.randomBytes(9).toString("base64url");
const PASS2 = "Dn2-" + crypto.randomBytes(9).toString("base64url");
const EDGE_USER = "edge-hesap";
const EDGE_PASS = "Edge-" + crypto.randomBytes(9).toString("base64url");

fs.rmSync(box, { recursive: true, force: true });
fs.mkdirSync(profile, { recursive: true });

const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const html = (title, body) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body style="font:16px sans-serif;margin:30px">${body}</body></html>`); };
  if (u.pathname === "/login") return html("Giriş", `<h1>Giriş</h1><form action="/welcome" method="post">
      <p><input id="u" name="username" autocomplete="username" style="width:260px;height:28px"></p>
      <p><input id="p" name="password" type="password" style="width:260px;height:28px"></p>
      <p><button id="go" type="submit" style="height:32px">Giriş yap</button></p></form>`);
  if (u.pathname === "/welcome") { req.resume(); return html("Hoş geldin", "<h1>Hoş geldin</h1>"); }
  res.writeHead(404); res.end();
});

/* ---------- a fake Edge profile with one readable, one Edge-locked and one "never" entry ---------- */
function makeEdge(port) {
  fs.mkdirSync(path.join(edge, "Default"), { recursive: true });
  const key = crypto.randomBytes(32);
  const wrapped = execFileSync(path.join(APPDIR, "nwdpapi.exe"), ["protect"], { input: key.toString("base64") }).toString();
  const encryptedKey = Buffer.concat([Buffer.from("DPAPI"), Buffer.from(wrapped, "base64")]).toString("base64");
  fs.writeFileSync(path.join(edge, "Local State"), JSON.stringify({ os_crypt: { encrypted_key: encryptedKey }, profile: { info_cache: { Default: { name: "Test Profili" } } } }));
  fs.writeFileSync(path.join(edge, "Default", "Bookmarks"), JSON.stringify({ roots: { bookmark_bar: { children: [] }, other: { children: [] }, synced: { children: [] } } }));
  const enc = (text) => {
    const nonce = crypto.randomBytes(12);
    const c = crypto.createCipheriv("aes-256-gcm", key, nonce);
    const body = Buffer.concat([c.update(text, "utf8"), c.final()]);
    return Buffer.concat([Buffer.from("v10"), nonce, body, c.getAuthTag()]);
  };
  const db = new DatabaseSync(path.join(edge, "Default", "Login Data"));
  db.exec("CREATE TABLE logins (origin_url VARCHAR NOT NULL, username_value VARCHAR, password_value BLOB, signon_realm VARCHAR NOT NULL, date_created INTEGER NOT NULL, blacklisted_by_user INTEGER NOT NULL)");
  const ins = db.prepare("INSERT INTO logins VALUES (?, ?, ?, ?, ?, ?)");
  const wk = (Date.now() + 11644473600000) * 1000;
  ins.run(`http://edge.localhost:${port}/login`, EDGE_USER, enc(EDGE_PASS), `http://edge.localhost:${port}/`, wk, 0);
  ins.run("https://kilitli.example/", "kilitli", Buffer.concat([Buffer.from("v20"), crypto.randomBytes(40)]), "https://kilitli.example/", wk, 0);
  ins.run("https://asla.example/", "", Buffer.alloc(0), "https://asla.example/", wk, 1);
  db.close();
}

let app = null;
function launch(hello) {
  app = spawn(EXE, [...ARGS, `--remote-debugging-port=${PORT}`], { env: { ...process.env, NEURALWEB_PROFILE: profile, NEURALWEB_EDGE_DIR: edge, NEURALWEB_TEST_HELLO: hello }, stdio: "ignore" });
}

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const SITE = `http://kalkan.localhost:${port}`;
  makeEdge(port);
  launch("verified");
  let ui = await attach(await waitTarget(PORT, (t) => /\/ui\/index\.html\?private=$/.test(t.url)));
  let ov = await attach(await waitTarget(PORT, (t) => t.url.endsWith("/ui/popup.html")));
  const U = (body) => ui.evaluate(`const $ = s => document.querySelector(s); ${body}`);
  const overlayText = () => ov.evaluate(`return document.getElementById("root").textContent;`);
  const clickOverlay = (text) => ov.evaluate(`const b = [...document.querySelectorAll("button")].find(x => x.textContent.trim() === ${JSON.stringify(text)}); if (!b) return false; b.click(); return true;`);
  await waitFor(() => U(`return document.querySelectorAll(".tab").length === 1;`));
  const vaultFile = path.join(profile, "passwords.json");

  async function openLogin(origin) {
    await U(`nw.cmd("navigate", ${JSON.stringify(origin + "/login")}); return 1;`);
    const page = await attach(await waitTarget(PORT, (t) => t.url === origin + "/login"));
    await waitFor(() => page.evaluate(`return document.readyState === "complete";`));
    return page;
  }
  const center = (page, sel) => page.evaluate(`const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 };`);
  async function clickIn(page, sel) { const c = await center(page, sel); await page.click(c.x, c.y); }
  async function submitLogin(page, user, pass) {
    await clickIn(page, "#u");
    await page.evaluate(`document.getElementById("u").select(); return 1;`);
    await page.call("Input.insertText", { text: user });
    await clickIn(page, "#p");
    await page.evaluate(`document.getElementById("p").select(); return 1;`);
    await page.call("Input.insertText", { text: pass });
    await clickIn(page, "#go");
  }

  console.log("kaydetme");
  let page = await openLogin(SITE);
  await clickIn(page, "#u");
  await sleep(500);
  check(!(await ov.evaluate(`return !!document.querySelector(".accounts");`)), "kayıtlı hesap yokken öneri paneli açılmıyor");
  await submitLogin(page, USER, PASS);
  check(await waitFor(async () => /Şifre kaydedilsin mi\?/.test(await overlayText())), "giriş yapınca kaydetme sorusu çıkıyor", await overlayText());
  const prompt = await overlayText();
  check(prompt.includes(USER) && prompt.includes(`kalkan.localhost:${port}`) && !prompt.includes(PASS), "soruda site ve kullanıcı adı var, şifre gizli");
  await sleep(200);
  snap("pw-save-prompt.png");
  await clickOverlay("Kaydet");
  check(await waitFor(() => fs.existsSync(vaultFile) && JSON.parse(fs.readFileSync(vaultFile, "utf8")).logins.length === 1), "şifre kasaya kaydediliyor");
  const raw = fs.readFileSync(vaultFile, "utf8");
  check(!raw.includes(PASS) && raw.includes(USER), "kasa dosyasında şifre açık metin olarak yok (Windows DPAPI ile şifreli)");

  console.log("doldurma");
  page.close();
  page = await openLogin(SITE);
  await clickIn(page, "#u");
  check(await waitFor(async () => (await overlayText()).includes(USER)), "giriş kutusuna tıklayınca kayıtlı hesap öneriliyor", await overlayText());
  await sleep(200);
  snap("pw-accounts.png");
  await ov.evaluate(`document.querySelector(".acc").dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })); return 1;`);
  check(await waitFor(() => page.evaluate(`return document.getElementById("u").value === ${JSON.stringify(USER)} && document.getElementById("p").value === ${JSON.stringify(PASS)};`)), "hesap seçilince kullanıcı adı ve şifre dolduruluyor");
  check(await waitFor(() => ov.evaluate(`return document.getElementById("root").children.length === 0;`)), "seçimden sonra panel kapanıyor");
  await page.evaluate(`document.getElementById("u").value = ""; document.getElementById("p").value = ""; document.getElementById("p").focus(); return 1;`);
  await clickIn(page, "#u");
  await waitFor(async () => (await overlayText()).includes(USER));
  await page.key("ArrowDown", "ArrowDown", 40);
  check(await waitFor(() => ov.evaluate(`return !!document.querySelector(".acc.sel");`)), "aşağı ok tuşu öneriyi seçiyor");
  await page.key("Enter", "Enter", 13, 0, "\r");
  check(await waitFor(() => page.evaluate(`return document.getElementById("p").value === ${JSON.stringify(PASS)};`)), "Enter ile seçilen hesap dolduruluyor");
  await clickIn(page, "#go");
  await sleep(1200);
  check(!/kaydedilsin|güncellensin/.test(await overlayText()), "aynı şifreyle girişte tekrar sorulmuyor");

  console.log("güncelleme ve 'asla'");
  page.close();
  page = await openLogin(SITE);
  await submitLogin(page, USER, PASS2);
  check(await waitFor(async () => /Şifre güncellensin mi\?/.test(await overlayText())), "farklı şifreyle girişte güncelleme soruluyor");
  await clickOverlay("Güncelle");
  check(await waitFor(() => JSON.parse(fs.readFileSync(vaultFile, "utf8")).logins.length === 1), "güncelleme yeni kayıt açmıyor");
  page.close();
  const OTHER = `http://baska.localhost:${port}`;
  page = await openLogin(OTHER);
  await submitLogin(page, "biri", "Baska-Sifre-1");
  check(await waitFor(async () => /Şifre kaydedilsin mi\?/.test(await overlayText())), "başka sitede de soruluyor");
  await clickOverlay("Bu sitede asla");
  await sleep(500);
  page.close();
  page = await openLogin(OTHER);
  await submitLogin(page, "biri", "Baska-Sifre-2");
  await sleep(1500);
  check(!/kaydedilsin/.test(await overlayText()), "'Bu sitede asla' denen sitede bir daha sorulmuyor");
  page.close();

  console.log("gizli pencere");
  await U(`nw.cmd("newPrivate"); return 1;`);
  const pui = await attach(await waitTarget(PORT, (t) => /\/ui\/index\.html\?private=1$/.test(t.url)));
  await waitFor(() => pui.evaluate(`return document.querySelectorAll(".tab").length === 1;`));
  await pui.evaluate(`nw.cmd("navigate", ${JSON.stringify(SITE + "/login")}); return 1;`);
  const ppage = await attach(await waitTarget(PORT, (t) => t.url === SITE + "/login" && t.id !== page.target.id));
  await waitFor(() => ppage.evaluate(`return document.readyState === "complete";`));
  await submitLogin(ppage, "gizli-hesap", "Gizli-Sifre-1");
  await sleep(1500);
  check(!/kaydedilsin|güncellensin/.test(await overlayText()), "gizli pencerede kaydetme sorulmuyor");
  await pui.evaluate(`nw.cmd("closeWindow"); return 1;`);
  pui.close();
  await sleep(500);

  console.log("Edge'den şifreler");
  await U(`nw.cmd("settings", "import"); return 1;`);
  const set = await attach(await waitTarget(PORT, (t) => t.url.startsWith("neural://settings")));
  await waitFor(() => set.evaluate(`return document.getElementById("edge-profile").options.length > 0;`));
  await set.evaluate(`document.getElementById("imp-marks").checked = false; document.getElementById("imp-history").checked = false; document.getElementById("imp-go").click(); return 1;`);
  const res = await waitFor(() => set.evaluate(`const t = document.getElementById("imp-result").textContent; return /aktarıldı/.test(t) ? t : null;`));
  check(/^1 şifre aktarıldı/.test(res || "") && /1 şifreyi Edge kendine kilitlemiş/.test(res || ""), "Edge'deki okunabilir şifre aktarılıyor, kilitli olan bildiriliyor", res);
  const v2 = JSON.parse(fs.readFileSync(vaultFile, "utf8"));
  check(v2.logins.some((l) => l.username === EDGE_USER && l.origin === `http://edge.localhost:${port}`) && v2.never.includes("https://asla.example"), "Edge'den gelen hesap ve 'asla' listesi kasada");
  check(!fs.readFileSync(vaultFile, "utf8").includes(EDGE_PASS), "Edge'den gelen şifre de şifreli saklanıyor");
  set.close();

  console.log("şifreler sayfası");
  await U(`nw.cmd("passwords"); return 1;`);
  let pw = await attach(await waitTarget(PORT, (t) => t.url.startsWith("neural://passwords")));
  check(await waitFor(() => pw.evaluate(`return document.querySelectorAll(".prow").length === 2;`)), "iki kayıtlı hesap listeleniyor");
  check(await pw.evaluate(`return [...document.querySelectorAll(".prow .pass")].every(p => /^•+$/.test(p.textContent));`), "şifreler gizli başlıyor");
  await pw.evaluate(`[...document.querySelectorAll(".prow")].find(r => r.textContent.includes(${JSON.stringify(USER)})).querySelector(".ib").click(); return 1;`);
  check(await waitFor(() => pw.evaluate(`return [...document.querySelectorAll(".prow .pass.shown")].some(p => p.textContent === ${JSON.stringify(PASS2)});`)), "doğrulamadan sonra göz simgesi güncel şifreyi gösteriyor");
  await sleep(200);
  snap("pw-page.png");
  await pw.evaluate(`[...document.querySelectorAll(".prow")].find(r => r.textContent.includes(${JSON.stringify(USER)})).querySelectorAll(".ib")[1].click(); return 1;`);
  await sleep(500);
  const clip = execFileSync("powershell", ["-NoProfile", "-Command", "Get-Clipboard"], { encoding: "utf8" }).trim();
  check(clip === PASS2, "kopyala şifreyi panoya koyuyor");
  execFileSync("powershell", ["-NoProfile", "-Command", "Set-Clipboard -Value ' '"]);
  const fromHistory = await (async () => {
    await U(`nw.cmd("history"); return 1;`);
    const h = await attach(await waitTarget(PORT, (t) => t.url.startsWith("neural://history")));
    await waitFor(() => h.evaluate(`return document.readyState === "complete";`));
    const r = await h.evaluate(`try { await neural.call("pwList"); return "erişti"; } catch (e) { return "engellendi"; }`);
    h.close();
    return r;
  })();
  check(fromHistory === "engellendi", "diğer iç sayfalar bile şifre listesine erişemiyor");
  await U(`nw.cmd("passwords"); return 1;`);
  await pw.evaluate(`[...document.querySelectorAll(".prow")].find(r => r.textContent.includes("edge-hesap")).querySelectorAll(".ib")[3].click(); return 1;`);
  await waitFor(() => pw.evaluate(`return !!document.querySelector("dialog.hud[open]");`));
  await pw.evaluate(`[...document.querySelectorAll("dialog.hud[open] button")].find(b => b.textContent === "Sil").click(); return 1;`);
  check(await waitFor(() => pw.evaluate(`return document.querySelectorAll(".prow").length === 1;`)), "hesap silinebiliyor");

  console.log("Windows Hello reddedince");
  await U(`nw.cmd("quit"); return 1;`).catch(() => {});
  for (let i = 0; i < 40 && app.exitCode === null; i++) await sleep(250);
  ui.close(); ov.close(); pw.close();
  launch("cancel");
  ui = await attach(await waitTarget(PORT, (t) => /\/ui\/index\.html\?private=$/.test(t.url)));
  await waitFor(() => ui.evaluate(`return document.querySelectorAll(".tab").length >= 1;`));
  await ui.evaluate(`nw.cmd("passwords"); return 1;`);
  pw = await attach(await waitTarget(PORT, (t) => t.url.startsWith("neural://passwords")));
  check(await waitFor(() => pw.evaluate(`return document.querySelectorAll(".prow").length === 1;`)), "kayıtlar yeniden açılışta duruyor");
  await pw.evaluate(`document.querySelector(".prow .ib").click(); return 1;`);
  await sleep(800);
  check(await pw.evaluate(`return !document.querySelector(".prow .pass.shown") && /Kimlik doğrulanmadı/.test(document.querySelector(".toast") ? document.querySelector(".toast").textContent : "");`), "doğrulama reddedilince şifre gösterilmiyor");
  const r2 = await pw.evaluate(`const l = (await neural.call("pwList")).logins[0]; return await neural.call("pwCopy", l.id);`);
  check(r2 === false, "doğrulamasız kopyalama yapılmıyor");
  await ui.evaluate(`nw.cmd("quit"); return 1;`).catch(() => {});
  for (let i = 0; i < 40 && app.exitCode === null; i++) await sleep(250);
  server.close();
  fs.rmSync(box, { recursive: true, force: true });
  console.log(`\n${passed} geçti, ${failed} kaldı`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("HATA:", e.stack || e.message); try { app.kill(); } catch (x) { /* gone */ } process.exit(2); });
