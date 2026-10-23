"use strict";
// Unit tests of apps\shared\handoff.js with plain Node: a fake installation, the test log and a fake Windows shell.
// Nothing is started and nothing is handed to Windows.
//   node tests\shared\test-handoff.js
const fs = require("fs");
const path = require("path");
const os = require("os");
const { create, programFor } = require("../../apps/shared/handoff");

const DIR = path.join(os.tmpdir(), "neural-testler", "handoff-unit");
const ROOT = path.join(DIR, "Neural");
const LOG = path.join(DIR, "launch.jsonl");
let passed = 0, failed = 0;
const check = (cond, label, extra = "") => { if (cond) { passed++; console.log("  ok   " + label); } else { failed++; console.log("  FAIL " + label + (extra ? "  -> " + extra : "")); } };

fs.rmSync(DIR, { recursive: true, force: true });
const install = (root, name) => { const p = path.join(root, name, "Program", `${name}.exe`); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, ""); return p; };
for (const n of ["NeuralView", "NeuralPad", "NeuralNav", "NeuralWeb"]) install(ROOT, n);
const box = path.join(DIR, "kutu");
fs.mkdirSync(path.join(box, "Klasör"), { recursive: true });
const lines = () => { try { return fs.readFileSync(LOG, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse); } catch (e) { return []; } };
const take = () => { const l = lines(); fs.rmSync(LOG, { force: true }); return l; };
// Electron's shell, as far as handoff.js uses it.
const shellCalls = [];
const fakeShell = {
  openPath: async (p) => { shellCalls.push(["open", p]); return ""; },
  showItemInFolder: (p) => { shellCalls.push(["show", p]); },
  openExternal: async (u) => { shellCalls.push(["url", u]); },
};

(async () => {
  console.log("which program opens a file");
  check(programFor("C:\\a\\Tatil.JPG") === "NeuralView" && programFor("x.webp") === "NeuralView" && programFor("y.svg") === "NeuralView", "pictures go to NeuralView (any letter case)");
  check(programFor("not.txt") === "NeuralPad" && programFor("README.md") === "NeuralPad" && programFor("kayit.log") === "NeuralPad", ".txt, .md and .log go to NeuralPad");
  check(programFor("belge.pdf") === null && programFor("ayar.json") === null && programFor("klasor") === null, "the rest goes to Windows");

  console.log("where the programs are");
  const h = create({ self: "Test", shell: fakeShell, env: { NEURAL_ROOT: ROOT, NEURAL_TEST_LAUNCH: LOG } });
  check(h.exe("NeuralView") === path.join(ROOT, "NeuralView", "Program", "NeuralView.exe"), "NEURAL_ROOT names the installation");
  check(h.exe("NeuralTerm") === null, "a program missing there is not installed");
  const other = path.join(DIR, "Diger");
  const ownExe = install(other, "NeuralNav");
  install(other, "NeuralTerm");
  const local = create({ self: "Test", shell: fakeShell, execPath: ownExe, env: { USERPROFILE: path.join(DIR, "yok") } });
  check(local.exe("NeuralTerm") === path.join(other, "NeuralTerm", "Program", "NeuralTerm.exe"), "without NEURAL_ROOT: next to the program itself");
  const fallback = create({ self: "Test", shell: fakeShell, execPath: path.join(DIR, "a", "b", "c.exe"), env: { USERPROFILE: DIR } });
  check(fallback.exe("NeuralWeb") === path.join(DIR, "Neural", "NeuralWeb", "Program", "NeuralWeb.exe"), "then %USERPROFILE%\\Neural");
  const strict = create({ self: "Test", shell: fakeShell, execPath: ownExe, env: { NEURAL_ROOT: path.join(DIR, "bos"), USERPROFILE: DIR } });
  check(strict.exe("NeuralTerm") === null && strict.exe("NeuralWeb") === null, "a NEURAL_ROOT without the program does not fall back");

  console.log("hand-offs with every program installed (test log)");
  take();
  const pic = path.join(box, "resim.png"), pic2 = path.join(box, "ikinci.jpg"), note = path.join(box, "not.txt"), md = path.join(box, "oku.md"), pdf = path.join(box, "belge.pdf");
  check(await h.openFiles([pic]) === "", "opening resolves without an error");
  let l = take();
  check(l.length === 1 && l[0].by === "Test" && l[0].program === "NeuralView" && l[0].args[0] === pic, "a picture starts NeuralView with it", JSON.stringify(l));
  await h.openFiles([pic, note, pic2, md, pdf]);
  l = take();
  const view = l.filter((x) => x.program === "NeuralView"), pad = l.filter((x) => x.program === "NeuralPad"), win = l.filter((x) => x.windows);
  check(view.length === 1 && view[0].args.length === 1 && view[0].args[0] === pic, "several pictures: NeuralView gets the first one only", JSON.stringify(view));
  check(pad.length === 1 && pad[0].args.join("|") === [note, md].join("|"), "several notes: one NeuralPad with all of them", JSON.stringify(pad));
  check(win.length === 1 && win[0].windows === "open" && win[0].target === pdf, "the PDF goes to Windows' own program", JSON.stringify(win));
  await h.showInNav(path.join(box, "Klasör"));
  await h.showInNav(note);
  l = take();
  check(l.length === 2 && l.every((x) => x.program === "NeuralNav") && l[0].args[0] === path.join(box, "Klasör") && l[1].args[0] === note, "a folder and a file's location go to NeuralNav", JSON.stringify(l));
  check(await h.openUrl("https://example.com/a?b=1") === "" && take()[0].args[0] === "https://example.com/a?b=1", "a web address goes to NeuralWeb");
  check(/http/.test(await h.openUrl("file:///C:/Windows")) && /http/.test(await h.openUrl("javascript:alert(1)")) && take().length === 0, "only http and https addresses are opened");
  check(h.start("NeuralTerm", ["C:\\"]) === false && take().length === 0, "a program that is not installed is not started");

  console.log("nothing installed: Windows does it (fake shell, no test log)");
  const bare = create({ self: "Test", shell: fakeShell, env: { NEURAL_ROOT: path.join(DIR, "bos") } });
  shellCalls.length = 0;
  await bare.openFiles([pic, note]);
  check(shellCalls.length === 2 && shellCalls.every((c) => c[0] === "open") && shellCalls.map((c) => c[1]).sort().join("|") === [pic, note].sort().join("|"), "pictures and notes open with their Windows programs", JSON.stringify(shellCalls));
  shellCalls.length = 0;
  await bare.showInNav(path.join(box, "Klasör"));
  await bare.showInNav(note);
  check(JSON.stringify(shellCalls) === JSON.stringify([["open", path.join(box, "Klasör")], ["show", note]]), "a folder opens in Explorer; a file is shown in its folder", JSON.stringify(shellCalls));
  shellCalls.length = 0;
  await bare.openUrl("http://localhost:8080/");
  check(JSON.stringify(shellCalls) === JSON.stringify([["url", "http://localhost:8080/"]]), "a web address goes to the default browser", JSON.stringify(shellCalls));
  check(!fs.existsSync(LOG), "no test log without NEURAL_TEST_LAUNCH");
  const failing = create({ self: "Test", shell: { openPath: async () => "Bu dosyayı açacak program yok." }, env: { NEURAL_ROOT: path.join(DIR, "bos") } });
  check(await failing.openFiles([pdf]) === "Bu dosyayı açacak program yok.", "Windows' error text comes back to the program");

  fs.rmSync(DIR, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("ERROR:", e.stack); process.exit(2); });
