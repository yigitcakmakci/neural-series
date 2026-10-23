"use strict";
// Hand-offs between the programs of the series: a picture goes to NeuralView, a note to NeuralPad, a folder (or a
// file's location) to NeuralNav and a web address to NeuralWeb. Anything the series has no program for, or whose
// program is not installed, goes to Windows. Programs start as their exe plus an argument array, never through a shell.
// NEURAL_ROOT names the installation to use (tests); NEURAL_TEST_LAUNCH names a file that receives one JSON line per
// hand-off instead of starting anything or handing it to Windows.
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

// NeuralView's formats (the same list as NeuralNav's "NeuralView ile aç").
const VIEW_EXT = new Set(["jpg", "jpeg", "jpe", "jfif", "png", "gif", "webp", "bmp", "dib", "ico", "svg", "avif"]);
const PAD_EXT = new Set(["txt", "md", "log"]);

const extOf = (p) => path.extname(String(p)).slice(1).toLowerCase();
function programFor(file) {
  const e = extOf(file);
  return VIEW_EXT.has(e) ? "NeuralView" : PAD_EXT.has(e) ? "NeuralPad" : null;
}
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } };

// self: the program making the hand-off (written to the test log); shell: Electron's shell module.
function create({ self, shell, execPath = process.execPath, env = process.env }) {
  // <root>\<Name>\Program\<Name>.exe: NEURAL_ROOT alone when given, else next to this program, else %USERPROFILE%\Neural.
  function exe(name) {
    const at = (r) => path.join(r, name, "Program", `${name}.exe`);
    const tries = env.NEURAL_ROOT ? [at(env.NEURAL_ROOT)]
      : [at(path.resolve(path.dirname(execPath), "..", "..")), at(path.join(env.USERPROFILE || "", "Neural"))];
    return tries.find((p) => fs.existsSync(p)) || null;
  }
  function record(entry) {
    try { fs.appendFileSync(env.NEURAL_TEST_LAUNCH, JSON.stringify({ by: self, ...entry }) + "\n"); } catch (e) { /* the test reports it */ }
    return true;
  }
  // Starts a program of the series with these arguments; false when it is not installed or cannot start.
  function start(name, args) {
    const p = exe(name);
    if (!p) return false;
    const list = args.map(String);
    if (env.NEURAL_TEST_LAUNCH) return record({ program: name, args: list });
    try {
      const c = spawn(p, list, { detached: true, stdio: "ignore" });
      c.on("error", () => {});
      c.unref();
      return true;
    } catch (e) {
      return false;
    }
  }
  // Windows' own handling. Resolves to an error text, empty when it worked.
  async function windows(kind, target) {
    if (env.NEURAL_TEST_LAUNCH) { record({ windows: kind, target }); return ""; }
    try {
      if (kind === "open") return (await shell.openPath(target)) || "";
      if (kind === "show") { shell.showItemInFolder(target); return ""; }
      if (kind === "url") { await shell.openExternal(target); return ""; }
    } catch (e) {
      return e.message || String(e);
    }
    return "";
  }

  // Files, each to its program. NeuralView gets only the first picture (it steps through that folder itself);
  // NeuralPad gets all the notes at once. Resolves to the last error text, empty when everything opened.
  async function openFiles(files) {
    const list = files.map(String);
    const view = list.filter((f) => programFor(f) === "NeuralView");
    const pad = list.filter((f) => programFor(f) === "NeuralPad");
    const rest = list.filter((f) => !programFor(f));
    if (view.length && !start("NeuralView", [view[0]])) rest.unshift(...view);
    if (pad.length && !start("NeuralPad", pad)) rest.unshift(...pad);
    let err = "";
    for (const f of rest) err = (await windows("open", f)) || err;
    return err;
  }
  // A folder opens in NeuralNav; a file opens its folder there with the file selected.
  async function showInNav(p) {
    const s = String(p);
    if (start("NeuralNav", [s])) return "";
    return windows(isDir(s) ? "open" : "show", s);
  }
  async function openUrl(url) {
    const s = String(url);
    if (!/^https?:\/\/[^/\s]/i.test(s)) return "Yalnızca http ve https adresleri açılır.";
    if (start("NeuralWeb", [s])) return "";
    return windows("url", s);
  }
  return { exe, start, openFiles, showInNav, openUrl };
}

module.exports = { create, programFor, VIEW_EXT, PAD_EXT };
