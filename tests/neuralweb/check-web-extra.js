"use strict";
// Extra checks on the installed NeuralWeb: links handed over by Windows, a second launch, menus, Google.
const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawn, execFileSync } = require("child_process");
const { sleep, waitTarget, attach } = require("../../tools/cdp");

const SP = __dirname;
const OUT = path.join(require("os").tmpdir(), "neural-testler"); // screenshots and throwaway profiles
fs.mkdirSync(OUT, { recursive: true });
const EXE = path.join(process.env.USERPROFILE, "Neural", "NeuralWeb", "Program", "NeuralWeb.exe");
const SNAP = path.join(__dirname, "..", "..", "tools", "snap-window.ps1");
const PORT = 9343;
const profile = path.join(OUT, "web-extra-profile");
fs.rmSync(profile, { recursive: true, force: true });
let passed = 0, failed = 0;
const check = (c, label, extra = "") => { if (c) { passed++; console.log("  ok   " + label); } else { failed++; console.log("  FAIL " + label + (extra ? "  -> " + extra : "")); } };
const snap = (name) => execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", SNAP, "-ProcessName", "NeuralWeb", "-Out", path.join(OUT, name)], { stdio: "pipe" });
async function waitFor(fn, ms = 10000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = await fn(); if (v) return v; } catch (e) { /* retry */ } await sleep(150); } return null; }

const server = http.createServer((req, res) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(`<!doctype html><title>Dış ${req.url}</title><h1>${req.url}</h1>`); });

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const SITE = `http://localhost:${server.address().port}`;
  const env = { ...process.env, NEURALWEB_PROFILE: profile };
  const app = spawn(EXE, [`--remote-debugging-port=${PORT}`, "--", `${SITE}/ilk`], { env, stdio: "ignore" });
  const ui = await attach(await waitTarget(PORT, (t) => /\/ui\/index\.html\?private=$/.test(t.url)));
  const ov = await attach(await waitTarget(PORT, (t) => t.url.endsWith("/ui/popup.html")));
  const titles = () => ui.evaluate(`return [...document.querySelectorAll(".tab-title")].map(t => t.textContent);`);
  check(await waitFor(async () => (await titles()).includes("Dış /ilk")), "Windows'un verdiği bağlantı açılışta açılıyor", JSON.stringify(await titles()));

  const second = spawn(EXE, ["--", `${SITE}/ikinci`], { env, stdio: "ignore" });
  await new Promise((r) => second.on("exit", r));
  check(await waitFor(async () => (await titles()).includes("Dış /ikinci")), "ikinci açılış aynı pencereye sekme ekliyor", JSON.stringify(await titles()));
  check(await ui.evaluate(`return document.querySelectorAll(".tab").length;`) === 2, "yeni pencere açılmıyor, tek pencerede iki sekme");

  // App menu, opened with a real click on the button.
  const r = await ui.evaluate(`const b = document.getElementById("btn-menu").getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 };`);
  await ui.click(r.x, r.y);
  check(await waitFor(() => ov.evaluate(`return /Yeni gizli pencere/.test(document.getElementById("root").textContent);`)), "menü açılıyor");
  await sleep(400);
  snap("web-extra-menu.png");
  await ov.evaluate(`[...document.querySelectorAll(".mi")].find(b => b.textContent.includes("Tema")).click(); return 1;`);
  check(await waitFor(() => ov.evaluate(`return /Gündüz/.test(document.getElementById("root").textContent) && !!document.querySelector(".mi.back");`)), "alt menü yerinde açılıyor (Tema)");
  await sleep(300);
  snap("web-extra-submenu.png");
  await ui.click(r.x, r.y);
  check(await waitFor(() => ov.evaluate(`return document.getElementById("root").children.length === 0;`)), "menü düğmesine tekrar basınca menü kapanıyor");

  // Google: search from the address bar, and live suggestions.
  await ui.evaluate(`nw.cmd("focusAddress"); return 1;`);
  await waitFor(() => ui.evaluate(`return document.activeElement.id === "omni";`), 3000);
  await ui.call("Input.insertText", { text: "istanbul hava" });
  const sug = await waitFor(() => ov.evaluate(`const n = document.querySelectorAll(".si").length; return n > 2 ? n : null;`), 8000);
  check(!!sug, "Google önerileri geliyor", String(sug));
  await sleep(300);
  snap("web-extra-suggest.png");
  await ui.key("Enter", "Enter", 13, 0, "\r");
  const g = await waitFor(async () => { const t = await ui.evaluate(`return document.getElementById("omni").value;`); return /google\.com\/search\?q=istanbul/.test(t) ? t : null; }, 15000);
  check(!!g, "Enter Google'da arıyor", g || await ui.evaluate(`return document.getElementById("omni").value;`));
  check(await waitFor(async () => /istanbul hava/i.test((await titles()).join(" ")), 15000), "Google sonuç sayfası yükleniyor", JSON.stringify(await titles()));
  await sleep(1500);
  snap("web-extra-google.png");
  check(await ui.evaluate(`return document.getElementById("sec-chip").dataset.sec;`) === "secure", "https sitesi güvenli kilidiyle gösteriliyor");

  await ui.evaluate(`nw.cmd("quit"); return 1;`).catch(() => {});
  for (let i = 0; i < 40 && app.exitCode === null; i++) await sleep(250);
  server.close();
  console.log(`\n${passed} geçti, ${failed} kaldı`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("HATA:", e.stack || e.message); process.exit(2); });
