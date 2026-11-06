"use strict";
// The end-to-end tests check Turkish texts, so the programs they start speak Turkish whatever language the user
// picked for the series: a throwaway series language file (unless NEURAL_LANG_FILE already names one), which the
// programs started by the test inherit through the environment. The real %APPDATA%\NeuralSeries is never read.
const fs = require("fs");
const path = require("path");
const os = require("os");

module.exports = function useLanguage(language = "tr") {
  if (process.env.NEURAL_LANG_FILE) return process.env.NEURAL_LANG_FILE;
  const file = path.join(os.tmpdir(), "neural-testler", `language-${language}-${process.pid}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ language, changedAt: Date.now(), by: "test" }));
  process.on("exit", () => { try { fs.unlinkSync(file); } catch (e) { /* already gone */ } });
  process.env.NEURAL_LANG_FILE = file;
  return file;
};
