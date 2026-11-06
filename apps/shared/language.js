"use strict";
// The series language: %APPDATA%\NeuralSeries\language.json = { language, changedAt, by }, which every Neural program
// reads once at startup. A program writes it only when the user picks another language there (or the setup does);
// the change shows the next time each program starts. Without the file, Windows' display language decides.
// NEURAL_LANG_FILE points tests at another file.
// build.ps1 copies this file next to each program's main.js; from source it is loaded from apps\shared.
const fs = require("fs");
const path = require("path");
const i18n = require(fs.existsSync(path.join(__dirname, "i18n.js")) ? "./i18n" : "../shared/i18n");

const LANGUAGES = [{ id: "tr", name: "Türkçe" }, { id: "en", name: "English" }];
const IDS = LANGUAGES.map((l) => l.id);
// The same in every program: the menu and the note after a change, in the language picked.
const COMMON = {
  tr: {
    "lang.menu": "Dil · Language",
    "lang.changed": "Dil Türkçe olarak ayarlandı. Neural programları yeniden açıldıklarında Türkçe görünecek.",
    "handoff.only-http": "Yalnızca http ve https adresleri açılır.",
  },
  en: {
    "lang.menu": "Language · Dil",
    "lang.changed": "The language is now English. The Neural apps switch to it the next time they start.",
    "handoff.only-http": "Only http and https addresses can be opened.",
  },
};

function defaultFile(env = process.env) {
  if (env.NEURAL_LANG_FILE) return path.resolve(env.NEURAL_LANG_FILE);
  return path.join(require("electron").app.getPath("appData"), "NeuralSeries", "language.json");
}
// Windows' display language: Turkish for a Turkish Windows, English for any other.
function detect(systemLanguages) {
  return /^tr(\b|-|_)/i.test(String((systemLanguages || [])[0] || "")) ? "tr" : "en";
}
function read(file) {
  try {
    const v = JSON.parse(fs.readFileSync(file, "utf8"));
    return v && IDS.includes(v.language) ? v.language : null;
  } catch (e) {
    return null;
  }
}
// Through a temporary file and a rename, as theme.json.
function write(file, language, by) {
  if (!IDS.includes(language)) return false;
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify({ language, changedAt: Date.now(), by: `${by}:${process.pid}` }));
    fs.renameSync(tmp, file);
    return true;
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (x) { /* never written */ }
    return false;
  }
}
function readDict(dir, id) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, "lang", `${id}.json`), "utf8")); } catch (e) { return {}; }
}

// appDir: the folder with lang\; name: the program ("NeuralTerm"). systemLanguages: app.getPreferredSystemLanguages().
function load({ appDir, name, file = defaultFile(), systemLanguages = [] }) {
  const lang = read(file) || detect(systemLanguages);
  const dict = Object.assign({}, COMMON.tr, readDict(appDir, "tr"), lang === "tr" ? {} : COMMON[lang], lang === "tr" ? {} : readDict(appDir, lang));
  const t = i18n.create({ lang, dict });
  return {
    lang, dict, t, file, languages: LANGUAGES,
    // The user picked a language here: written for every program, shown from their next start. Resolves to the note.
    set(id) {
      if (!IDS.includes(id) || !write(file, id, name)) return null;
      return COMMON[id]["lang.changed"];
    },
    // The page asks for its texts once (synchronously, before it draws) and may change the language.
    wire(ipcMain) {
      ipcMain.on("neural:lang", (e) => { e.returnValue = { lang, dict, languages: LANGUAGES }; });
      ipcMain.handle("neural:lang-set", (_e, id) => this.set(String(id)));
    },
  };
}

module.exports = { load, detect, read, write, defaultFile, LANGUAGES };
