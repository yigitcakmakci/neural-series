"use strict";
// Unit tests of apps\shared\language.js (the series language file and Windows' language) with plain Node.
//   node tests\shared\test-language.js
const fs = require("fs");
const path = require("path");
const os = require("os");
const language = require("../../apps/shared/language");

const DIR = path.join(os.tmpdir(), "neural-testler", "language-unit");
const FILE = path.join(DIR, "NeuralSeries", "language.json"); // the folder does not exist yet
const APP = path.join(DIR, "app");
let passed = 0, failed = 0;
const check = (cond, label, extra = "") => { if (cond) { passed++; console.log("  ok   " + label); } else { failed++; console.log("  FAIL " + label + (extra ? "  -> " + extra : "")); } };

fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(path.join(APP, "lang"), { recursive: true });
fs.writeFileSync(path.join(APP, "lang", "tr.json"), JSON.stringify({ hello: "Merhaba {name}", only_tr: "Yalnız Türkçe" }));
fs.writeFileSync(path.join(APP, "lang", "en.json"), JSON.stringify({ hello: "Hello {name}" }));

console.log("Windows' language");
check(language.detect(["tr-TR"]) === "tr" && language.detect(["tr"]) === "tr" && language.detect(["TR-tr", "en-US"]) === "tr", "a Turkish Windows → Turkish");
check(language.detect(["en-US", "tr-TR"]) === "en" && language.detect(["de-DE"]) === "en" && language.detect([]) === "en" && language.detect(["trk"]) === "en", "any other (or none) → English");

console.log("no file yet");
let L = language.load({ appDir: APP, name: "Test", file: FILE, systemLanguages: ["tr-TR"] });
check(L.lang === "tr" && L.t("hello", { name: "Neo" }) === "Merhaba Neo", "Turkish Windows: Turkish texts");
check(!fs.existsSync(FILE), "reading never writes the file");
L = language.load({ appDir: APP, name: "Test", file: FILE, systemLanguages: ["en-GB"] });
check(L.lang === "en" && L.t("hello", { name: "Neo" }) === "Hello Neo", "English Windows: English texts");
check(L.t("only_tr") === "Yalnız Türkçe", "a text missing in English falls back to Turkish");
check(L.t("lang.menu") === "Language · Dil" && L.languages.map((l) => l.name).join() === "Türkçe,English", "the shared language menu texts");

console.log("picking a language");
const note = L.set("tr");
check(/Türkçe/.test(note || ""), "set() answers with the note in the language picked", note);
const saved = JSON.parse(fs.readFileSync(FILE, "utf8"));
check(saved.language === "tr" && Number.isFinite(saved.changedAt) && /^Test:\d+$/.test(saved.by), "writes { language, changedAt, by }", JSON.stringify(saved));
check(fs.readdirSync(path.dirname(FILE)).length === 1, "no temporary file is left behind");
check(L.lang === "en" && L.t("hello", { name: "Neo" }) === "Hello Neo", "the running program keeps its language until it starts again");
L = language.load({ appDir: APP, name: "Test", file: FILE, systemLanguages: ["en-US"] });
check(L.lang === "tr", "the file wins over Windows' language at the next start");
check(L.set("de") === null && language.read(FILE) === "tr", "an unknown language is refused");
fs.writeFileSync(FILE, "{ yarım");
check(language.read(FILE) === null && language.load({ appDir: APP, name: "Test", file: FILE, systemLanguages: ["en-US"] }).lang === "en", "a damaged file reads as nothing: Windows decides");
const handled = new Map();
language.load({ appDir: APP, name: "Test", file: FILE, systemLanguages: ["en-US"] }).wire({ on: (c, f) => handled.set(c, f), handle: (c, f) => handled.set(c, f) });
const ev = {};
handled.get("neural:lang")(ev);
check(ev.returnValue && ev.returnValue.lang === "en" && ev.returnValue.dict.hello === "Hello {name}" && ev.returnValue.languages.length === 2, "neural:lang hands the page its texts");
check(/English/.test(handled.get("neural:lang-set")({}, "en") || "") && language.read(FILE) === "en", "neural:lang-set writes the choice");

fs.rmSync(DIR, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
