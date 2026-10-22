"use strict";
// Links and server redirects must reach their destination (the tab must not just reload the current page).
// Usage: node test-redirect.js [--installed]
const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");
const { sleep, waitTarget, attach } = require("../../tools/cdp");

const SP = __dirname;
const OUT = path.join(require("os").tmpdir(), "neural-testler"); // screenshots and throwaway profiles
fs.mkdirSync(OUT, { recursive: true });
const INSTALLED = process.argv.includes("--installed");
const EXE = INSTALLED ? path.join(process.env.USERPROFILE, "Neural", "NeuralWeb", "Program", "NeuralWeb.exe") : path.join(__dirname, "..", "..", "node_modules", "electron", "dist", "electron.exe");
const ARGS = INSTALLED ? [] : [path.join(SP, "..", "..", "out", "stage", "apps", "NeuralWeb")];
const PORT = 9352;
const profile = path.join(OUT, "redirect-test-profile");
let passed = 0, failed = 0;
const check = (c, label, extra = "") => { if (c) { passed++; console.log("  ok   " + label); } else { failed++; console.log("  FAIL " + label + (extra ? "  -> " + extra : "")); } };
async function waitFor(fn, ms = 10000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = await fn(); if (v) return v; } catch (e) { /* retry */ } await sleep(150); } return null; }
fs.rmSync(profile, { recursive: true, force: true });

const hits = [];
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const host = (req.headers.host || "").split(":")[0];
  hits.push(host + u.pathname);
  const port = server.address().port;
  if (u.pathname === "/hop1") { res.writeHead(302, { location: "/hop2" }); return res.end(); }
  if (u.pathname === "/hop2") { res.writeHead(302, { location: `http://hedef.localhost:${port}/son` }); return res.end(); }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><meta charset="utf-8"><title>${host}${u.pathname}</title>
    <p><a id="go" href="http://kaynak.localhost:${port}/hop1" style="font-size:24px">iki yönlendirmeli bağlantı</a></p>`);
});

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const app = spawn(EXE, [...ARGS, `--remote-debugging-port=${PORT}`], { env: { ...process.env, NEURALWEB_PROFILE: profile }, stdio: "ignore" });
  const ui = await attach(await waitTarget(PORT, (t) => /\/ui\/index\.html\?private=$/.test(t.url)));
  const title = () => ui.evaluate(`const t = document.querySelector(".tab-title"); return t && t.textContent;`);
  await waitFor(() => ui.evaluate(`return document.querySelectorAll(".tab").length === 1;`));

  console.log("adres çubuğundan yönlendirme zinciri");
  await ui.evaluate(`nw.cmd("navigate", "http://kaynak.localhost:${port}/hop1"); return 1;`);
  check(await waitFor(async () => (await title()) === "hedef.localhost/son"), "iki yönlendirmeden sonra hedef sayfa açılıyor", await title());

  console.log("bağlantıdan yönlendirme zinciri");
  await ui.evaluate(`nw.cmd("navigate", "http://baslangic.localhost:${port}/"); return 1;`);
  await waitFor(async () => (await title()) === "baslangic.localhost/");
  const page = await attach(await waitTarget(PORT, (t) => t.url === `http://baslangic.localhost:${port}/`));
  await waitFor(() => page.evaluate(`return document.readyState === "complete";`));
  const before = hits.filter((h) => h === "baslangic.localhost/").length;
  const c = await page.evaluate(`const b = document.getElementById("go").getBoundingClientRect(); return { x: b.left + 10, y: b.top + b.height / 2 };`);
  await page.click(c.x, c.y);
  check(await waitFor(async () => (await title()) === "hedef.localhost/son"), "bağlantı tıklaması yönlendirmelerden geçip hedefe varıyor", await title());
  await sleep(500);
  check(hits.filter((h) => h === "baslangic.localhost/").length === before, "başlangıç sayfası yeniden yüklenmiyor", JSON.stringify(hits.slice(-6)));

  await ui.evaluate(`nw.cmd("quit"); return 1;`).catch(() => {});
  for (let i = 0; i < 40 && app.exitCode === null; i++) await sleep(250);
  server.close();
  for (let i = 0; i < 20; i++) { try { fs.rmSync(profile, { recursive: true, force: true }); break; } catch (e) { await sleep(300); } }
  console.log(`\n${passed} geçti, ${failed} kaldı`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("HATA:", e.stack || e.message); process.exit(2); });
