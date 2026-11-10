"use strict";
// The series environment of the end-to-end tests, inherited by the programs they start:
// - they check Turkish texts, so the programs speak Turkish whatever language the user picked for the series: a
//   throwaway series language file (unless NEURAL_LANG_FILE already names one);
// - they never ask GitHub for new versions: a throwaway update state with checking switched off (unless
//   NEURAL_UPDATE_FILE already names one).
// The real %APPDATA%\NeuralSeries is never read or written.
const fs = require("fs");
const path = require("path");
const os = require("os");

function temp(name, content) {
  const file = path.join(os.tmpdir(), "neural-testler", `${name}-${process.pid}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(content));
  process.on("exit", () => { try { fs.unlinkSync(file); } catch (e) { /* already gone */ } });
  return file;
}

module.exports = function useLanguage(language = "tr") {
  if (!process.env.NEURAL_UPDATE_FILE) process.env.NEURAL_UPDATE_FILE = temp("update-off", { enabled: false });
  if (!process.env.NEURAL_LANG_FILE) process.env.NEURAL_LANG_FILE = temp(`language-${language}`, { language, changedAt: Date.now(), by: "test" });
  return process.env.NEURAL_LANG_FILE;
};
