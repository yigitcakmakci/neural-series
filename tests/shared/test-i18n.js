"use strict";
// The interface texts of every program, with plain Node:
//   - apps\shared\i18n.js: lookup, placeholders, plural forms;
//   - each apps\<app>\lang\: tr.json and en.json have the same keys and placeholders, no empty text, every key the code
//     uses exists, and the Turkish an HTML page shows before its texts load is the text in tr.json.
//   node tests\shared\test-i18n.js            (add --unused to list keys no code refers to)
const fs = require("fs");
const path = require("path");
const i18n = require("../../apps/shared/i18n");
const language = require("../../apps/shared/language");

const APPS = path.join(__dirname, "..", "..", "apps");
const PROGRAMS = ["neuralcalc", "neuralpad", "neuralnav", "neuralterm", "neuralweb", "neuralview", "neuraldeck", "neuralpulse", "neuralsnap"];
let passed = 0, failed = 0;
const check = (cond, label, extra = "") => { if (cond) { passed++; console.log("  ok   " + label); } else { failed++; console.log("  FAIL " + label + (extra ? "  -> " + extra : "")); } };

console.log("i18n.js");
const t = i18n.create({ lang: "en", dict: { a: "Hello {name}", n: { one: "{n} file", other: "{n} files" }, only: "x" } });
check(t("a", { name: "Neo" }) === "Hello Neo", "fills placeholders");
check(t("a") === "Hello {name}", "a placeholder without a value stays visible");
check(t("n", { n: 1 }) === "1 file" && t("n", { n: 3 }) === "3 files" && t("n", { n: 0 }) === "0 files", "English plural forms");
const tt = i18n.create({ lang: "tr", dict: { n: { other: "{n} dosya" } } });
check(tt("n", { n: 1 }) === "1 dosya" && tt("n", { n: 5 }) === "5 dosya", "Turkish has one form");
check(t("yok.boyle") === "yok.boyle", "a missing key comes back as itself");
check(t.lang === "en" && t.locale === "en-GB" && tt.locale === "tr-TR" && i18n.create({ lang: "xx", dict: {} }).lang === "tr", "language, date format locale, unknown language → Turkish");

// What every program may use without its own key (language.js adds them).
const common = new Set(Object.keys(language.load({ appDir: path.join(__dirname, "yok"), name: "Test", file: path.join(__dirname, "yok.json") }).dict));
const holes = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
const forms = (v) => (v && typeof v === "object" ? Object.values(v) : [v]);
const list = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!["node_modules", "vendor", "fonts", "lang"].includes(e.name)) list(p, out); }
    else if (/\.(js|html)$/.test(e.name)) out.push(p);
  }
  return out;
};
const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const KEY_CALL = /\b[Tt]\(\s*(['"`])([\w.-]+)\1/g; // T('key'), and t('key') in a main process
const PREFIX_CALL = /\b[Tt]\(\s*(['"`])([\w.-]+\.)\1\s*\+/g; // T('theme.' + id)
const PREFIX_TEMPLATE = /\b[Tt]\(\s*`([\w.-]+\.)\$\{/g; // T(`theme.${id}`)
const DATA_KEY = /data-i18n(?:-[a-z-]+)?="([\w.-]+)"/g;
const LITERAL = /(['"`])([\w-]+(?:\.[\w-]+)+)\1/g; // a key picked by a condition: T(x ? 'a.b' : 'a.c')

for (const app of PROGRAMS) {
  console.log(app);
  const dir = path.join(APPS, app);
  let tr = null, en = null;
  try { tr = JSON.parse(fs.readFileSync(path.join(dir, "lang", "tr.json"), "utf8")); en = JSON.parse(fs.readFileSync(path.join(dir, "lang", "en.json"), "utf8")); } catch (e) { check(false, "lang\\tr.json and lang\\en.json read as JSON", e.message); continue; }
  const keys = Object.keys(tr);
  check(keys.length > 0, `lang\\tr.json has texts (${keys.length})`);
  const onlyTr = keys.filter((k) => !(k in en)), onlyEn = Object.keys(en).filter((k) => !(k in tr));
  check(!onlyTr.length && !onlyEn.length, "tr.json and en.json have the same keys", `only tr: ${onlyTr.join(" ")} | only en: ${onlyEn.join(" ")}`);
  const empty = keys.filter((k) => forms(tr[k]).some((v) => typeof v !== "string" || !v.trim()) || (k in en && forms(en[k]).some((v) => typeof v !== "string" || !v.trim())));
  check(!empty.length, "no empty or malformed text", empty.join(" "));
  const badHoles = keys.filter((k) => k in en && new Set([...forms(tr[k]), ...forms(en[k])].map(holes)).size > 1);
  check(!badHoles.length, "the same {placeholders} in both languages", badHoles.join(" "));
  const known = (k) => k in tr || common.has(k);
  const used = new Map(), prefixes = new Set();
  const htmlMismatch = [];
  for (const f of list(dir)) {
    const src = fs.readFileSync(f, "utf8");
    const rel = path.relative(dir, f);
    for (const m of src.matchAll(KEY_CALL)) if (!m[2].endsWith(".")) used.set(m[2], rel);
    for (const m of src.matchAll(PREFIX_CALL)) prefixes.add(m[2]);
    for (const m of src.matchAll(PREFIX_TEMPLATE)) prefixes.add(m[1]);
    for (const m of src.matchAll(DATA_KEY)) used.set(m[1], rel);
    for (const m of src.matchAll(LITERAL)) if (m[2] in tr && !used.has(m[2])) used.set(m[2], rel);
    if (!f.endsWith(".html")) continue;
    // The Turkish shown before the texts load must be tr.json's.
    for (const m of src.matchAll(/<([a-z0-9]+)\b([^>]*?)\bdata-i18n="([\w.-]+)"([^>]*)>([^<]*)</g)) {
      const want = tr[m[3]];
      if (typeof want === "string" && unescape(m[5].trim()) !== want) htmlMismatch.push(`${m[3]}: "${m[5].trim()}"`);
    }
    for (const m of src.matchAll(/<[^>]+>/g)) {
      const tag = m[0];
      for (const [attr, data] of [["title", "data-i18n-title"], ["placeholder", "data-i18n-placeholder"], ["aria-label", "data-i18n-aria-label"]]) {
        const k = (tag.match(new RegExp(`\\s${data}="([\\w.-]+)"`)) || [])[1];
        const v = (tag.match(new RegExp(`\\s${attr}="([^"]*)"`)) || [])[1];
        if (k && typeof tr[k] === "string" && v !== undefined && unescape(v) !== tr[k]) htmlMismatch.push(`${k} (${attr}): "${v}"`);
      }
    }
  }
  const missing = [...used.keys()].filter((k) => !known(k));
  check(!missing.length, `every key the code uses exists (${used.size} used)`, missing.map((k) => `${k} (${used.get(k)})`).join(" "));
  check(!htmlMismatch.length, "the Turkish in the HTML is tr.json's", htmlMismatch.slice(0, 8).join(" | "));
  const unused = keys.filter((k) => !used.has(k) && ![...prefixes].some((p) => k.startsWith(p)));
  if (unused.length && process.argv.includes("--unused")) console.log(`  (keys no code names: ${unused.join(" ")})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
