"use strict";
// Unit tests of apps\neuraldeck\commands.js on a temp folder tree (plain Node: node tests\neuraldeck\test-commands.js).
const fs = require("fs");
const path = require("path");
const os = require("os");
const C = require("../../apps/neuraldeck/commands");

const HOME = path.join(os.tmpdir(), "neural-testler", "deck-unit", "Ev Klasörü");
let passed = 0, failed = 0;
const check = (cond, label, extra = "") => { if (cond) { passed++; console.log("  ok   " + label); } else { failed++; console.log("  FAIL " + label + (extra ? "  -> " + extra : "")); } };
const j = (x) => JSON.stringify(x);

fs.rmSync(path.dirname(HOME), { recursive: true, force: true });
for (const d of ["Belgeler", "Belgeler\\Proje Ağı", "Resimler", "Masaüstü"]) fs.mkdirSync(path.join(HOME, d), { recursive: true });
fs.writeFileSync(path.join(HOME, "Belgeler", "not.txt"), "x");
fs.writeFileSync(path.join(HOME, "Belgeler", "notlar.md"), "x");
fs.writeFileSync(path.join(HOME, "Resimler", "galata.jpg"), "x");
fs.writeFileSync(path.join(HOME, "Resimler", "liste.txt"), "x");

const ALL = new Set(C.PROGRAMS.map((p) => p.id));
const env = (o = {}) => ({ installed: (id) => (o.installed || ALL).has(id), home: HOME, vars: { USERPROFILE: HOME }, recent: o.recent || [], ans: o.ans || 0, theme: o.theme || "neon" });
const first = (input, o) => C.suggest(input, env(o))[0];

console.log("calculator (the NeuralCalc engine)");
check(first("=12*7").title === "= 84" && first("=12*7").action.type === "copy" && first("=12*7").action.text === "84", "=12*7 → 84, copied", j(first("=12*7")));
check(first("calc 2^10").title === "= 1024" && first("hesap 200+15%").title === "= 230", "calc / hesap, powers and the calculator's percent");
check(first("= sqrt(2)").title === "= 1.41421356237" && first("=pi*2").title === "= 6.28318530718" && first("= 3,5*2").title === "= 7", "sqrt, pi and the Turkish decimal comma");
check(first("= 0-5").action.text === "-5" && first("= 0-5").title === "= −5", "the copied text uses a plain minus");
check(first("= 1/0").disabled && /SIFIRA BÖLME/.test(first("= 1/0").detail), "an error is shown, not run", j(first("= 1/0")));
check(first("= 2*ans", { ans: 21 }).title === "= 42", "ans is the last result");
check(first("12*7").title === "= 84", "a bare expression is calculated too");

console.log("programs and commands");
check(first("").title === "NeuralCalc" && C.suggest("", env()).length >= 6, "empty input lists the programs");
check(first("neuralpad").action.app === "NeuralPad" && first("np-7").action.app === "NeuralPad", "a program by name or model code");
check(first("not defteri").action.app === "NeuralPad" && first("dosya gez").action.app === "NeuralNav", "by its Turkish description");
check(first("nrlvw").action.app === "NeuralView", "fuzzy: letters in order", j(first("nrlvw")));
check(first("goster").action.app === "NeuralView", "without Turkish letters (göster)", j(first("goster")));
const off = C.suggest("", env({ installed: new Set(["NeuralPad", "NeuralNav"]) }));
check(off.find((i) => i.title === "NeuralWeb").disabled && /kurulu değil/.test(off.find((i) => i.title === "NeuralWeb").detail) && !off.find((i) => i.title === "NeuralPad").disabled,
  "programs that are not installed are greyed out");
const ter = C.suggest("ter", env());
check(ter.some((i) => i.title === "term <klasör>" && i.complete === "term "), "a command word completes with Tab", j(ter.map((i) => i.title)));

console.log("folders and files");
let s = C.suggest("nav ~\\Bel", env());
check(s[0].title === path.join(HOME, "Belgeler") + "\\" && s[0].action.app === "NeuralNav" && s[0].complete === `nav ${path.join(HOME, "Belgeler")}\\`, "nav ~\\Bel completes the folder", j(s[0]));
s = C.suggest(`nav ${path.join(HOME, "Belgeler")}`, env());
check(s[0].action.args[0] === path.join(HOME, "Belgeler") && s.some((i) => i.title.startsWith(path.join(HOME, "Belgeler", "Proje Ağı"))), "an existing folder opens, its subfolders follow");
s = C.suggest("gez %USERPROFILE%\\Res", env());
check(s[0].action.args[0] === path.join(HOME, "Resimler"), "%USERPROFILE% is expanded, gez is nav", j(s[0]));
s = C.suggest("nt Masa", env());
check(s[0].action.app === "NeuralTerm" && s[0].action.args[0] === path.join(HOME, "Masaüstü"), "nt <folder> relative to the home folder");
s = C.suggest("nav C:\\yok\\boyle-bir-klasor", env());
check(s.length === 1 && s[0].disabled && s[0].detail === "Klasör bulunamadı", "a missing folder is refused");
s = C.suggest(`pad ${path.join(HOME, "Belgeler")}\\no`, env());
check(s.map((i) => path.basename(i.action.args ? i.action.args[0] : "")).join() === "not.txt,notlar.md" && s.every((i) => i.action.app === "NeuralPad"), "pad completes files", j(s.map((i) => i.title)));
s = C.suggest(`pad ~\\`, env());
check(s.find((i) => /Belgeler\\$/.test(i.title)).action.type === "complete", "a folder in a file command steps inside with Tab");
s = C.suggest(`view ${path.join(HOME, "Resimler")}\\`, env());
check(s.length === 1 && s[0].action.app === "NeuralView" && s[0].action.args[0].endsWith("galata.jpg"), "view lists only pictures", j(s.map((i) => i.title)));
const recent = [{ path: path.join(HOME, "Belgeler", "not.txt"), kind: "file" }, { path: path.join(HOME, "Resimler"), kind: "dir" }, { path: path.join(HOME, "Resimler", "galata.jpg"), kind: "file" }];
s = C.suggest("pad", env({ recent }));
check(s[0].title === "Başlat: NeuralPad" && s[1].action.args[0].endsWith("not.txt") && s.length === 3, "pad alone: start it, or a recent file", j(s.map((i) => i.title)));
s = C.suggest("view ", env({ recent }));
check(s.length === 2 && s[1].action.args[0].endsWith("galata.jpg"), "view: only recent pictures");
s = C.suggest("nav", env({ recent }));
check(s[1].action.args[0] === path.join(HOME, "Resimler"), "nav: recent folders");

console.log("web, search, theme, settings");
check(j(first("web https://example.com/a?b=1").action.args) === j(["--", "https://example.com/a?b=1"]), "web <https address> → NeuralWeb -- address");
check(first("web github.com/yigitcakmakci").action.args[1] === "https://github.com/yigitcakmakci", "a bare host gets https://");
check(first("web javascript:alert(1)").disabled && first("web file:///C:/Windows").disabled && first("web ftp://x.org").disabled, "javascript:, file: and other schemes are refused");
check(first("ara neo istanbul & del").action.args[1] === "https://www.google.com/search?q=neo%20istanbul%20%26%20del", "ara: a Google search, the words encoded", j(first("ara neo istanbul & del")));
check(first("github.com").action.args[1] === "https://github.com", "a bare address opens directly");
check(C.suggest("neo istanbul", env()).some((i) => i.title === "Google'da ara: neo istanbul"), "free text offers a search");
s = C.suggest("tema", env({ theme: "ice" }));
check(s.length === 4 && s.find((i) => i.action.theme === "ice").detail === "Şu anki tema", "tema lists the four themes");
check(first("tema buz").action.theme === "ice" && first("theme daylight").action.theme === "daylight" && first("tema gunduz").action.theme === "daylight", "tema buz / theme daylight / gunduz");
check(first("ayarlar").action.type === "settings" && first("settings").action.type === "settings", "ayarlar / settings");

console.log("only programs of the series, arguments as an array");
const exeOf = (id) => `C:\\Neural\\${id}\\Program\\${id}.exe`;
check(j(C.toSpawn({ type: "launch", app: "NeuralNav", args: ["C:\\a b"] }, exeOf)) === j({ exe: "C:\\Neural\\NeuralNav\\Program\\NeuralNav.exe", args: ["C:\\a b"] }), "a launch is the program's exe and an argument array");
check(C.toSpawn({ type: "launch", app: "cmd", args: ["/c", "calc"] }, exeOf) === null && C.toSpawn({ type: "launch", app: "NeuralPad", args: "x & y" }, exeOf) === null && C.toSpawn({ type: "copy", text: "x" }, exeOf) === null,
  "anything else is refused (another program, a string of arguments, not a launch)");
s = C.suggest("pad not.txt & calc.exe", env());
check(s.every((i) => i.disabled || i.action.type !== "launch" || i.action.args.length <= 1), "shell syntax is just part of a file name");

fs.rmSync(path.dirname(HOME), { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
