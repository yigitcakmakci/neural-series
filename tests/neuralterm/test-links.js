"use strict";
// Unit tests of apps\neuralterm\links.js (paths and web addresses in the terminal output) with plain Node.
//   node tests\neuralterm\test-links.js
const L = require("../../apps/neuralterm/links");

let passed = 0, failed = 0;
const check = (cond, label, extra = "") => { if (cond) { passed++; console.log("  ok   " + label); } else { failed++; console.log("  FAIL " + label + (extra ? "  -> " + extra : "")); } };
const cand = (text, start) => L.find(text).paths.find((c) => c.start === start);
// What main.js would answer for a set of paths that "exist" (relative ones against base).
function links(text, existing, base = "C:\\Kutu") {
  const f = L.find(text);
  const hits = f.paths.map((c) => {
    let best = null;
    for (const v of c.variants) {
      const p = /^([A-Za-z]:[\\/]|\\\\)/.test(v) ? v : base + "\\" + v.replace(/^\.\\/, "");
      if (existing.includes(p) && (!best || v.length > best.text.length)) best = { text: v, path: p, isDir: true };
    }
    return best;
  });
  return f.urls.concat(L.choose(f.paths, hits)).sort((a, b) => a.start - b.start).map((l) => text.slice(l.start, l.end) + "=>" + l.target);
}

console.log("web addresses");
let u = L.urls("Bkz. https://example.com/yol?x=1. ve (http://a.test/b) sonra");
check(u.length === 2 && u[0].target === "https://example.com/yol?x=1" && u[1].target === "http://a.test/b", "sentence punctuation and an outer bracket are not part of the address", JSON.stringify(u));
u = L.urls("https://tr.wikipedia.org/wiki/Galata_(semt) okuyun");
check(u.length === 1 && u[0].target === "https://tr.wikipedia.org/wiki/Galata_(semt)", "a bracket the address opened stays", JSON.stringify(u));
check(L.urls("ftp://x.test/ file://C:/x http:// javascript:alert(1)").length === 0, "only http and https, with a host");
check(L.find("https://x.test/C:\\a").paths.every((c) => c.start < 0), "no paths are looked for inside an address");

console.log("absolute paths");
let c = cand("Kaydedildi: C:\\Users\\Neo\\Belgeler\\rapor 1.txt. Tamam.", 12);
check(c && c.kind === "abs" && ["C:\\Users\\Neo\\Belgeler\\rapor", "C:\\Users\\Neo\\Belgeler\\rapor 1.txt.", "C:\\Users\\Neo\\Belgeler\\rapor 1.txt"].every((v) => c.variants.includes(v)), "a path with a space: every word end is a candidate, with and without the full stop", JSON.stringify(c && c.variants));
check(links("Kaydedildi: C:\\Users\\Neo\\Belgeler\\rapor 1.txt. Tamam.", ["C:\\Users\\Neo\\Belgeler\\rapor 1.txt"]).join() === "C:\\Users\\Neo\\Belgeler\\rapor 1.txt=>C:\\Users\\Neo\\Belgeler\\rapor 1.txt", "the longest existing spelling wins; the full stop is left out");
check(links("PS C:\\Program Files (x86)\\Neural> dir", ["C:\\Program Files (x86)\\Neural"]).join() === "C:\\Program Files (x86)\\Neural=>C:\\Program Files (x86)\\Neural", "a prompt: the path ends at '>' and keeps its brackets");
check(links("app.js hatası: C:\\src\\app.js:12:5", ["C:\\src\\app.js"]).join() === "C:\\src\\app.js=>C:\\src\\app.js", "file:line:column stops at the colon");
check(links("Cannot find path 'C:\\yok\\boyle' because it does not exist.", []).length === 0, "a path that does not exist is not a link");
c = cand("ağ: \\\\sunucu\\paylasim\\dosya.txt", 4);
check(c && c.kind === "abs" && c.variants[0] === "\\\\sunucu\\paylasim\\dosya.txt", "a network share (\\\\server\\share)", JSON.stringify(c));
check(!L.find("abcC:\\x").paths.some((x) => x.kind === "abs"), "a drive letter inside a word is not a drive");
check(cand("D:/oyunlar/kayit", 0)?.variants[0] === "D:/oyunlar/kayit", "forward slashes work too");

console.log("relative paths and the line's folder");
check(cand("dosya .\\alt\\not.txt hazır", 6)?.kind === "rel", ".\\ starts a relative path");
check(links("Çıktı: .\\cikti\\rapor.md hazır", ["C:\\Kutu\\cikti\\rapor.md"]).join() === ".\\cikti\\rapor.md=>C:\\Kutu\\cikti\\rapor.md", "a relative path resolves against the line's folder");
check(links("d-----   23.10.2026   12:00   Yeni Klasör", ["C:\\Kutu\\Yeni Klasör"]).join() === "Yeni Klasör=>C:\\Kutu\\Yeni Klasör", "a name in a dir listing, with a space in it");
check(links("PS C:\\Kutu> cd Belgeler", ["C:\\Kutu", "C:\\Kutu\\Belgeler"]).join(" ; ") === "C:\\Kutu=>C:\\Kutu ; Belgeler=>C:\\Kutu\\Belgeler", "the prompt's folder and a name typed after it");
check(!L.find("12:00 ... . ..").paths.some((x) => x.variants.some((v) => /^\.+$/.test(v) || v.includes(":"))), "dots alone and colons are never names");
check(L.paths("a b c d e f g h i j k l m n o p q r s t u v w x y z a b c d e f g h i j").length === 30, "at most 30 plain words per line");
check(L.baseDir(["d-----  Kaynak", "    Directory: C:\\Users\\Neo\\Neural", "", "PS C:\\Users\\Neo> dir Neural"]) === "C:\\Users\\Neo\\Neural", "the folder: PowerShell's Directory: header above the line");
check(L.baseDir(["    Dizin: C:\\Kullanıcılar\\Neo"]) === "C:\\Kullanıcılar\\Neo", "the Turkish 'Dizin:' header too");
check(L.baseDir(["çıktı", "C:\\Windows\\System32>dir"]) === "C:\\Windows\\System32", "Komut İstemi's prompt");
check(L.baseDir(["PS C:\\> ls"]) === "C:\\", "the root of a drive stays C:\\");
check(L.baseDir(["yalnızca metin", "neo@pc MINGW64 ~/x"]) === null, "no prompt: no folder (NeuralTerm uses the tab's start folder)");

console.log("overlaps");
const hits = [{ text: "C:\\a b", path: "C:\\a b" }, { text: "b", path: "C:\\Kutu\\b" }];
const ch = L.choose([{ start: 0 }, { start: 5 }], hits);
check(ch.length === 1 && ch[0].end === 6, "a word inside an earlier link is not a second link", JSON.stringify(ch));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
