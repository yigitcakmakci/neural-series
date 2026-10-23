"use strict";
// NeuralDeck DK-0 commands: what the palette suggests for a line of input, and what running a suggestion does.
// Plain logic over an environment (installed programs, folders, recent items), so it runs in tests without Electron.
// A suggestion can only start a program of the series (with its arguments as an array, never through a shell),
// open an http/https address in NeuralWeb, copy a result, change the series theme or open the settings.
const fs = require("fs");
const path = require("path");
// The NeuralCalc engine: next to this file when installed, in apps\shared when run from source.
const calc = require(fs.existsSync(path.join(__dirname, "calc-engine.js")) ? "./calc-engine" : "../shared/calc-engine");

const PROGRAMS = [
  { id: "NeuralCalc", code: "KX-9", what: "Hesap makinesi", keys: ["calc", "hesap", "hesap makinesi", "calculator"] },
  { id: "NeuralPad", code: "NP-7", what: "Not defteri", keys: ["pad", "not", "not defteri", "notepad"] },
  { id: "NeuralNav", code: "NV-4", what: "Dosya gezgini", keys: ["nav", "gez", "gezgin", "dosya gezgini", "explorer"] },
  { id: "NeuralTerm", code: "NT-5", what: "Terminal", keys: ["term", "nt", "terminal", "komut istemi", "powershell"] },
  { id: "NeuralWeb", code: "NW-1", what: "Web tarayıcısı", keys: ["web", "tarayıcı", "browser", "internet"] },
  { id: "NeuralView", code: "VW-3", what: "Resim görüntüleyici", keys: ["view", "göster", "resim", "görüntüleyici", "fotoğraf"] },
];
const program = (id) => PROGRAMS.find((p) => p.id === id);

// A command is the first word of the input. arg: what follows it.
const COMMANDS = [
  { id: "calc", words: ["calc", "hesap"], app: "NeuralCalc", arg: "math", usage: "= 12*7", title: "Hesapla", what: "NeuralCalc'ın motoruyla; Enter sonucu panoya kopyalar" },
  { id: "nav", words: ["nav", "gez", "explorer"], app: "NeuralNav", arg: "dir", usage: "nav <klasör>", title: "Klasörü NeuralNav'da aç", what: "Tab yolu tamamlar" },
  { id: "term", words: ["term", "nt", "terminal"], app: "NeuralTerm", arg: "dir", usage: "term <klasör>", title: "Klasörde NeuralTerm aç", what: "Tab yolu tamamlar" },
  { id: "pad", words: ["pad", "notepad"], app: "NeuralPad", arg: "file", usage: "pad <dosya>", title: "Dosyayı NeuralPad'de aç", what: "Son açılanlar ve yol tamamlama" },
  { id: "view", words: ["view", "göster", "resim"], app: "NeuralView", arg: "image", usage: "view <resim>", title: "Resmi NeuralView'de aç", what: "Son açılanlar ve yol tamamlama" },
  { id: "web", words: ["web", "url", "site"], app: "NeuralWeb", arg: "url", usage: "web <adres>", title: "Adresi NeuralWeb'de aç", what: "Yalnızca http ve https" },
  { id: "ara", words: ["ara", "search", "google"], app: "NeuralWeb", arg: "words", usage: "ara <kelimeler>", title: "Google'da ara", what: "Sonuçlar NeuralWeb'de açılır" },
  { id: "tema", words: ["tema", "theme"], app: null, arg: "theme", usage: "tema <ad>", title: "Serinin temasını değiştir", what: "Neon, Buz, Alarm, Gündüz" },
  { id: "ayarlar", words: ["ayarlar", "settings"], app: null, arg: null, usage: "ayarlar", title: "NeuralDeck ayarları", what: "Kısayol ve diğerleri" },
];
const THEMES = [
  { id: "neon", name: "Neon", keys: ["neon"] },
  { id: "ice", name: "Buz", keys: ["buz", "ice"] },
  { id: "alarm", name: "Alarm", keys: ["alarm", "kırmızı"] },
  { id: "daylight", name: "Gündüz", keys: ["gündüz", "daylight", "açık"] },
];
const IMAGE = /\.(jpe?g|jpe|jfif|png|gif|webp|bmp|dib|ico|svg|avif)$/i;
const MAX = 8;

/* ---------- matching ---------- */
const FOLD = { ı: "i", İ: "i", ş: "s", ğ: "g", ü: "u", ö: "o", ç: "c" };
const fold = (s) => String(s).toLocaleLowerCase("tr").replace(/[ışğüöçİ]/g, (c) => FOLD[c] || c);
// Subsequence score: prefixes and runs at word starts count most; -1 when the query is not in the text.
function score(query, text) {
  const q = fold(query).trim(), s = fold(text);
  if (!q) return 1;
  if (s === q) return 1000;
  if (s.startsWith(q)) return 800 - s.length;
  let i = 0, run = 0, sc = 0;
  for (let j = 0; j < s.length && i < q.length; j++) {
    if (q[i] === s[j]) {
      run++;
      sc += 10 + run * 6 + (j === 0 || /[\s\-_.\\/]/.test(s[j - 1]) ? 20 : 0);
      i++;
    } else run = 0;
  }
  return i === q.length ? sc - (s.length - q.length) * 0.5 : -1;
}
const best = (query, keys) => Math.max(...keys.map((k) => score(query, k)));

/* ---------- input ---------- */
const MATH = /^[\d\s.,+\-*/^()%!×÷−√πe]+$/i;
function parse(input) {
  const text = String(input || "").replace(/^\s+/, "");
  if (text.startsWith("=")) return { cmd: COMMANDS[0], word: "=", arg: text.slice(1).trim(), text };
  const m = /^(\S+)(?:\s+([\s\S]*))?$/.exec(text);
  if (m) {
    const word = m[1].toLocaleLowerCase("tr");
    const cmd = COMMANDS.find((c) => c.words.includes(word));
    if (cmd) return { cmd, word: m[1], arg: (m[2] || "").trim(), text, spaced: /\s$/.test(text) || m[2] !== undefined };
  }
  return { cmd: null, word: "", arg: text.trim(), text };
}
// The calculator's notation from what people type: 12*7, 2^10, sqrt(2), pi, 3,5 (Turkish decimal comma), ans.
function toCalc(src) {
  return src.replace(/,/g, ".").replace(/sqrt/gi, "√").replace(/\bpi\b/gi, "π").replace(/\bans\b/gi, "ANS")
    .replace(/(\d)\s*[xX]\s*(?=\d)/g, "$1×").replace(/\s+/g, "");
}
const plainNumber = (s) => s.replace(/−/g, "-");

// A typed path: quotes removed, ~ and %VARIABLES% expanded, "C:" taken as the drive, relative to the home folder.
function resolvePath(arg, env) {
  let s = String(arg).trim().replace(/^"+|"+$/g, "");
  if (!s) return "";
  s = s.replace(/%([^%]+)%/g, (all, name) => (env.vars && env.vars[name.toUpperCase()]) || all);
  if (s === "~" || s.startsWith("~\\") || s.startsWith("~/")) s = path.join(env.home, s.slice(1));
  if (/^[a-z]:$/i.test(s)) s += "\\";
  return path.isAbsolute(s) ? path.normalize(s) : path.join(env.home, s);
}
function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } }
function isFile(p) { try { return fs.statSync(p).isFile(); } catch (e) { return false; } }
// Entries of the folder an incomplete path points into, whose names start with its last part.
function completions(arg, env, want) {
  const typed = String(arg).trim().replace(/^"/, "");
  if (!typed) return [];
  const full = resolvePath(typed, env);
  const endsSep = /[\\/]$/.test(typed) || /^[a-z]:$/i.test(typed);
  const dir = endsSep ? full : path.dirname(full);
  const prefix = endsSep ? "" : fold(path.basename(full));
  let names = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return []; }
  return names
    .filter((d) => !d.name.startsWith("$") && fold(d.name).startsWith(prefix))
    .filter((d) => d.isDirectory() || (want !== "dir" && (want !== "image" || IMAGE.test(d.name))))
    .sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name, "tr", { numeric: true }))
    .slice(0, MAX)
    .map((d) => ({ path: path.join(dir, d.name), dir: d.isDirectory() }));
}

// An address for NeuralWeb: http(s) as typed, a bare host name gets https://, any other scheme is refused.
function toUrl(arg) {
  const s = String(arg).trim();
  if (!s) return { ok: true, url: "" };
  if (/^https?:\/\/\S+$/i.test(s)) return { ok: true, url: s };
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^[\w-]+(\.[\w-]+)+:\d+/.test(s)) return { ok: false, reason: "Yalnızca http ve https adresleri açılır." };
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(s) || /^localhost(:\d+)?(\/\S*)?$/i.test(s)) return { ok: true, url: "https://" + s };
  return { ok: false, reason: "Bu bir web adresi değil. Aramak için: ara " + s };
}
const searchUrl = (words) => "https://www.google.com/search?q=" + encodeURIComponent(words);
const looksLikeUrl = (s) => /^https?:\/\/\S+$/i.test(s) || /^[\w-]+(\.[\w-]+)*\.[a-z]{2,}(\/\S*)?$/i.test(s);

/* ---------- suggestions ---------- */
// env: { installed(id), home, vars, recent: [{ path, kind: "dir"|"file" }], ans, theme }
// An item: { title, detail, chip, disabled, complete (text for Tab), action }
function launchItem(env, id, args, title, detail, extra = {}) {
  const p = program(id);
  const ok = env.installed(id);
  return {
    title, detail: ok ? detail : `${detail} · ${p.id} kurulu değil`, chip: p.code, disabled: !ok,
    action: { type: "launch", app: id, args }, ...extra,
  };
}
function pathItems(cmd, arg, env) {
  const p = program(cmd.app);
  const kind = cmd.arg === "dir" ? "dir" : "file";
  const out = [];
  const word = cmd.words[0];
  if (!arg) {
    out.push(launchItem(env, p.id, [], `Başlat: ${p.id}`, p.what));
    for (const r of (env.recent || []).filter((x) => x.kind === kind && (cmd.arg !== "image" || IMAGE.test(x.path))).slice(0, 5)) {
      out.push(launchItem(env, p.id, [r.path], r.path, "Son açılan", { complete: `${word} ${r.path}` }));
    }
    return out;
  }
  const full = resolvePath(arg, env);
  const exists = kind === "dir" ? isDir(full) : isFile(full) && (cmd.arg !== "image" || IMAGE.test(full));
  if (exists) out.push(launchItem(env, p.id, [full], full, cmd.title, { complete: `${word} ${full}` }));
  // An existing folder typed without its trailing \ shows what is inside it as well.
  const inside = isDir(full) && !/[\\/]$/.test(arg) ? completions(arg + "\\", env, cmd.arg) : [];
  const seen = new Set([full.toLowerCase()]);
  for (const c of [...completions(arg, env, cmd.arg), ...inside].slice(0, MAX)) {
    if (seen.has(c.path.toLowerCase())) continue;
    seen.add(c.path.toLowerCase());
    if (c.dir && kind === "file") {
      out.push({ title: c.path + "\\", detail: "Klasör · Tab ile içine gir", chip: "›", disabled: false, complete: `${word} ${c.path}\\`, action: { type: "complete" } });
    } else {
      out.push(launchItem(env, p.id, [c.path], c.dir ? c.path + "\\" : c.path, cmd.title, { complete: `${word} ${c.path}${c.dir ? "\\" : ""}` }));
    }
  }
  if (!out.length) out.push({ title: arg, detail: kind === "dir" ? "Klasör bulunamadı" : cmd.arg === "image" ? "Resim bulunamadı" : "Dosya bulunamadı", chip: "!", disabled: true, action: { type: "none" } });
  return out;
}
function calcItems(arg, env) {
  const out = [];
  if (arg) {
    try {
      const v = calc.evaluate(toCalc(arg), { angle: "DEG", ans: env.ans || 0 });
      const shown = calc.fmt(v);
      out.push({ title: "= " + shown, detail: "Enter: sonucu panoya kopyala", chip: "=", disabled: false, value: v, action: { type: "copy", text: plainNumber(shown), value: v } });
    } catch (e) {
      const err = e && e.code && calc.ERR[e.code];
      out.push({ title: "= …", detail: err ? `${err[1]} (${err[0]})` : "Hesaplanamadı", chip: "=", disabled: true, action: { type: "none" } });
    }
  }
  out.push(launchItem(env, "NeuralCalc", [], "Başlat: NeuralCalc", "Hesap makinesi"));
  return out;
}
function suggest(input, env) {
  const { cmd, arg, text } = parse(input);
  if (cmd) {
    switch (cmd.arg) {
      case "math": return calcItems(arg, env);
      case "dir": case "file": case "image": return pathItems(cmd, arg, env);
      case "url": {
        const u = toUrl(arg);
        if (!u.ok) return [{ title: arg, detail: u.reason, chip: "!", disabled: true, action: { type: "none" } }];
        if (!u.url) return [launchItem(env, "NeuralWeb", [], "Başlat: NeuralWeb", "Web tarayıcısı")];
        return [launchItem(env, "NeuralWeb", ["--", u.url], u.url, cmd.title)];
      }
      case "words":
        if (!arg) return [{ title: "ara <kelimeler>", detail: "Aranacak kelimeleri yaz", chip: "⌕", disabled: true, action: { type: "none" } }];
        return [launchItem(env, "NeuralWeb", ["--", searchUrl(arg)], `Google'da ara: ${arg}`, "Sonuçlar NeuralWeb'de açılır", { chip: "⌕" })];
      case "theme":
        return THEMES.map((t) => ({ t, s: arg ? best(arg, t.keys) : 1 })).filter((x) => x.s >= 0).sort((a, b) => b.s - a.s)
          .map(({ t }) => ({ title: `Tema: ${t.name}`, detail: t.id === env.theme ? "Şu anki tema" : "Bütün Neural programları bu temaya geçer", chip: "◐", disabled: false, complete: `tema ${fold(t.keys[0])}`, action: { type: "theme", theme: t.id } }));
      default:
        return [{ title: "NeuralDeck ayarları", detail: "Kısayol ve diğerleri", chip: "⚙", disabled: false, action: { type: "settings" } }];
    }
  }
  const q = arg;
  const out = [];
  if (q && MATH.test(q) && /\d/.test(q) && /[+\-*/^%!×÷−√]/.test(q)) out.push(...calcItems(q, env).slice(0, 1));
  if (q && looksLikeUrl(q) && env.installed("NeuralWeb")) {
    const u = toUrl(q);
    if (u.ok && u.url) out.push(launchItem(env, "NeuralWeb", ["--", u.url], u.url, "Adresi NeuralWeb'de aç"));
  }
  const ranked = [];
  for (const p of PROGRAMS) {
    const s = q ? best(q, [p.id, p.code, p.what, ...p.keys]) : 500 - PROGRAMS.indexOf(p);
    if (s >= 0) ranked.push({ s, item: launchItem(env, p.id, [], p.id, p.what) });
  }
  for (const c of COMMANDS) {
    if (!q) continue;
    const s = best(q, [...c.words, c.title]);
    if (s < 0) continue;
    const app = c.app && program(c.app);
    const off = app && !env.installed(app.id);
    ranked.push({ s: s - 1, item: { title: c.usage, detail: off ? `${c.title} · ${app.id} kurulu değil` : `${c.title} · ${c.what}`, chip: c.id === "calc" ? "=" : ">_", disabled: !!off, complete: c.id === "calc" ? "= " : `${c.words[0]} `, action: { type: "complete" } } });
  }
  ranked.sort((a, b) => b.s - a.s);
  out.push(...ranked.slice(0, MAX).map((r) => r.item));
  if (q && !looksLikeUrl(q) && !MATH.test(q)) {
    out.push(launchItem(env, "NeuralWeb", ["--", searchUrl(q)], `Google'da ara: ${q}`, "Sonuçlar NeuralWeb'de açılır", { chip: "⌕" }));
  }
  return out.slice(0, MAX + 2);
}

// What a launch action starts: the program's executable and its arguments, nothing else.
function toSpawn(action, exeOf) {
  if (!action || action.type !== "launch" || !program(action.app)) return null;
  if (!Array.isArray(action.args) || action.args.some((a) => typeof a !== "string")) return null;
  return { exe: exeOf(action.app), args: [...action.args] };
}

module.exports = { PROGRAMS, COMMANDS, THEMES, parse, suggest, score, fold, toCalc, toUrl, resolvePath, completions, toSpawn, searchUrl };
