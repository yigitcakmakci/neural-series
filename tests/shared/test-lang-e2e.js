"use strict";
// Opens each staged program in English (a series language file in a throwaway folder) and reads every text on its
// page: the visible text, the hidden dialogs, tooltips, placeholders and labels. Turkish words or raw text keys left
// there are interface text that did not move to the language files. Then once in Turkish: no raw keys either.
//   node tests\shared\test-lang-e2e.js                     (every program in out\stage)
//   node tests\shared\test-lang-e2e.js NeuralTerm NeuralPad (only these)
//   node tests\shared\test-lang-e2e.js --source NeuralPad   (from apps\<app>, without a build)
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn, execFileSync } = require("child_process");
const { sleep, waitTarget, attach } = require("../../tools/cdp");

const ROOT = path.join(__dirname, "..", "..");
const SOURCE = process.argv.includes("--source");
const STAGE = path.join(ROOT, "out", "stage", "apps");
const dirOf = (name) => (SOURCE ? path.join(ROOT, "apps", name.toLowerCase()) : path.join(STAGE, name));
const ELECTRON = path.join(ROOT, "node_modules", "electron", "dist", "electron.exe");
const BOX = path.join(os.tmpdir(), "neural-testler", "lang-e2e");
const ALL = ["NeuralCalc", "NeuralPad", "NeuralNav", "NeuralTerm", "NeuralWeb", "NeuralView", "NeuralDeck"];
const ONLY = process.argv.slice(2).filter((a) => !a.startsWith("-"));
// Words that stay Turkish in English on purpose (the language's own name, NeuralDeck's Turkish command words, ...).
const ALLOWED = new Set(["Türkçe", "Dil"]);
// The page each program opens first (NeuralWeb also has its UI page; the tab pages are checked by its own test).
const PAGE = { NeuralWeb: (u) => /\/ui\/index\.html/.test(u) };
let passed = 0, failed = 0;
const check = (cond, label, extra = "") => { if (cond) { passed++; console.log("  ok   " + label); } else { failed++; console.log("  FAIL " + label + (extra ? "  -> " + extra : "")); } };

fs.rmSync(BOX, { recursive: true, force: true });
fs.mkdirSync(BOX, { recursive: true });

// Every text of the page, hidden ones included, minus what the user put there (inputs' values, editors).
const READ = `
  const out = [];
  const skip = (el) => el.closest('textarea, input, [contenteditable="true"], .xterm-rows, .cm-content, .editor');
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = walk.nextNode());) if (n.nodeValue.trim() && !skip(n.parentElement) && !n.parentElement.closest('script, style')) out.push(n.nodeValue.trim());
  for (const el of document.querySelectorAll('[title], [placeholder], [aria-label]')) for (const a of ['title', 'placeholder', 'aria-label']) if (el.getAttribute(a)) out.push(el.getAttribute(a));
  out.push(document.title);
  return { texts: out, lang: document.documentElement.lang };`;

async function open(name, lang, port) {
  const dir = dirOf(name);
  const work = path.join(BOX, `${name}-${lang}`);
  fs.mkdirSync(work, { recursive: true });
  const langFile = path.join(work, "language.json");
  fs.writeFileSync(langFile, JSON.stringify({ language: lang, changedAt: Date.now(), by: "test" }));
  const updateOff = path.join(work, "update.json"); // never ask GitHub from a test
  fs.writeFileSync(updateOff, JSON.stringify({ enabled: false }));
  const profile = path.join(work, "profile");
  fs.mkdirSync(profile, { recursive: true });
  // NeuralDeck stays clear of the real one's shortcut and stays open; the others get their profile variables.
  fs.writeFileSync(path.join(profile, "settings.json"), JSON.stringify({ shortcut: "Ctrl+Alt+Shift+F12" }));
  const env = {
    ...process.env, NEURAL_LANG_FILE: langFile, NEURAL_THEME_FILE: path.join(work, "theme.json"), NEURAL_ROOT: path.join(work, "Neural"),
    NEURAL_UPDATE_FILE: updateOff,
    NEURALWEB_PROFILE: profile, NEURALWEB_EDGE_DIR: path.join(work, "edge"), NEURALVIEW_PROFILE: profile, NEURALDECK_PROFILE: profile, NEURALDECK_KEEP_OPEN: "1",
  };
  const proc = spawn(ELECTRON, [dir, `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`], { env, stdio: "ignore" });
  const target = await waitTarget(port, (t) => (PAGE[name] ? PAGE[name](t.url) : /^file:/.test(t.url)), 30000);
  const page = await attach(target);
  await sleep(1500);
  return { proc, page };
}
function stop(proc) {
  try { execFileSync("taskkill", ["/T", "/F", "/PID", String(proc.pid)], { stdio: "ignore" }); } catch (e) { /* gone */ }
}

(async () => {
  let port = 9361;
  for (const name of ALL.filter((a) => !ONLY.length || ONLY.includes(a))) {
    console.log(name);
    const keys = new Set(Object.keys(JSON.parse(fs.readFileSync(path.join(dirOf(name), "lang", "tr.json"), "utf8"))));
    const rawKeys = (texts) => texts.filter((s) => keys.has(s) || [...keys].some((k) => k.includes(".") && new RegExp(`(^|\\s)${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|\\s)`).test(s)));
    for (const lang of ["en", "tr"]) {
      let app = null;
      try {
        app = await open(name, lang, port++);
        const r = await app.page.evaluate(READ);
        check(r.lang === lang, `${lang}: the page says it is ${lang}`, r.lang);
        const raw = rawKeys(r.texts);
        check(!raw.length, `${lang}: no raw text keys on the page`, raw.slice(0, 6).join(" | "));
        if (lang === "en") {
          const words = [...new Set(r.texts.join(" ").split(/[^\p{L}'’]+/u).filter((w) => /[çğıöşüÇĞİÖŞÜ]/.test(w) && !ALLOWED.has(w)))];
          check(!words.length, `en: no Turkish words left (${r.texts.length} texts read)`, words.slice(0, 20).join(" "));
        }
        app.page.close();
      } catch (e) {
        check(false, `${lang}: opens`, e.message);
      } finally {
        if (app) stop(app.proc);
      }
      await sleep(500);
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
