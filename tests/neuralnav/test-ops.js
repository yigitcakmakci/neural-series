"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const ops = require(path.join(__dirname, "..", "..", "apps", "neuralnav", "ops.js"));

const box = path.join(__dirname, "ops-sandbox");
fs.rmSync(box, { recursive: true, force: true });
const mk = (rel, text) => { const p = path.join(box, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); if (text !== undefined) fs.writeFileSync(p, text); return p; };
mk("src/a.txt", "AAA");
mk("src/sub/b.txt", "BBBB");
mk("src/sub/deep/c.txt", "C");
mk("dest/a.txt", "old");
fs.mkdirSync(path.join(box, "dest2"), { recursive: true });

let passed = 0;
const ok = (cond, label) => { assert.ok(cond, label); passed++; console.log("  ok  " + label); };

(async () => {
  const helper = new ops.Helper(path.join(__dirname, "..", "..", "out", "stage", "apps", "NeuralNav", "nvhelper.exe"));
  const asks = [];
  const answer = (action, all) => async (c) => { asks.push(c); return { action, all }; };

  // names
  ok(await ops.uniqueName(path.join(box, "dest"), "a.txt", false) === "a (2).txt", "uniqueName adds (2)");
  ok(await ops.uniqueCopyName(path.join(box, "src"), "a.txt", false) === "a - Kopya.txt", "uniqueCopyName gives '- Kopya'");
  ok(ops.invalidName("a:b") !== "" && ops.invalidName("CON") !== "" && ops.invalidName("x.") !== "" && ops.invalidName("ok.txt") === "", "invalidName rules");

  // copy with conflict -> keep both
  let r = await ops.transfer({ op: "copy", sources: [path.join(box, "src/a.txt")], destDir: path.join(box, "dest"), ask: answer("keep", false) });
  ok(r.done.length === 1 && path.basename(r.done[0]) === "a (2).txt" && fs.readFileSync(path.join(box, "dest/a.txt"), "utf8") === "old", "copy conflict 'keep' writes a (2).txt and leaves the original");
  ok(asks.length === 1 && asks[0].srcSize === 3 && asks[0].destSize === 3, "conflict carries sizes");

  // copy with conflict -> replace
  r = await ops.transfer({ op: "copy", sources: [path.join(box, "src/a.txt")], destDir: path.join(box, "dest"), ask: answer("replace", false) });
  ok(fs.readFileSync(path.join(box, "dest/a.txt"), "utf8") === "AAA", "copy conflict 'replace' overwrites");

  // copy folder, then copy again with merge (replace for all)
  let progressCalls = 0;
  r = await ops.transfer({ op: "copy", sources: [path.join(box, "src/sub")], destDir: path.join(box, "dest"), ask: answer("replace", true), progress: () => progressCalls++ });
  ok(fs.readFileSync(path.join(box, "dest/sub/deep/c.txt"), "utf8") === "C" && progressCalls === 2, "copy folder recursively with progress");
  fs.writeFileSync(path.join(box, "src/sub/new.txt"), "N");
  asks.length = 0;
  r = await ops.transfer({ op: "copy", sources: [path.join(box, "src/sub")], destDir: path.join(box, "dest"), ask: answer("replace", true) });
  ok(fs.existsSync(path.join(box, "dest/sub/new.txt")) && asks.length === 2 && asks[0].isDir && !asks[1].isDir && r.errors.length === 0,
    "folder conflict merges; 'apply to all' is remembered separately for folders and files");

  // copy into the same folder -> '- Kopya'
  r = await ops.transfer({ op: "copy", sources: [path.join(box, "src/a.txt"), path.join(box, "src/sub")], destDir: path.join(box, "src"), ask: answer("cancel") });
  ok(r.done.map((p) => path.basename(p)).join("|") === "a - Kopya.txt|sub - Kopya", "copy into same folder makes '- Kopya' names");

  // move (same drive -> rename) and undo-style move back
  r = await ops.transfer({ op: "move", sources: [path.join(box, "dest/sub")], destDir: path.join(box, "dest2"), ask: answer("cancel") });
  ok(!fs.existsSync(path.join(box, "dest/sub")) && fs.existsSync(path.join(box, "dest2/sub/deep/c.txt")), "move folder on same drive");
  ok(r.pairs.length === 1 && ops.samePath(r.pairs[0][1], path.join(box, "dest2/sub")), "move reports source/destination pairs");

  // move into same folder is a no-op; folder into itself is refused
  r = await ops.transfer({ op: "move", sources: [path.join(box, "src/a.txt")], destDir: path.join(box, "src"), ask: answer("cancel") });
  ok(r.skipped === 1 && fs.existsSync(path.join(box, "src/a.txt")), "move into the same folder does nothing");
  r = await ops.transfer({ op: "move", sources: [path.join(box, "src")], destDir: path.join(box, "src/sub/deep"), ask: answer("cancel") });
  ok(r.errors.length === 1 && /içinde/.test(r.errors[0].message) && fs.existsSync(path.join(box, "src/a.txt")), "folder into its own subfolder is refused");

  // move with skip keeps the source
  r = await ops.transfer({ op: "move", sources: [path.join(box, "src/a.txt")], destDir: path.join(box, "dest"), ask: answer("skip") });
  ok(r.skipped === 1 && fs.existsSync(path.join(box, "src/a.txt")), "move conflict 'skip' leaves the source in place");

  // cancel from the conflict dialog
  r = await ops.transfer({ op: "copy", sources: [path.join(box, "src/a.txt")], destDir: path.join(box, "dest"), ask: answer("cancel") });
  ok(r.cancelled === true, "cancel stops the job");

  // search and size
  const hits = [];
  const s = await ops.search({ root: box, query: "c.txt", onBatch: (b) => hits.push(...b) });
  ok(s.found >= 2 && hits.every((h) => h.n === "c.txt"), "search finds c.txt in nested folders");
  const wild = [];
  await ops.search({ root: box, query: "*.txt", onBatch: (b) => wild.push(...b) });
  ok(wild.length >= 8 && wild.every((h) => h.n.endsWith(".txt")), "wildcard search");
  const size = await ops.folderSize(path.join(box, "src"));
  ok(size.files >= 5 && size.bytes > 0 && size.dirs >= 2, "folder size counts files and folders");

  // listing: helper and Node fallback agree on names
  const viaHelper = await ops.listDir(helper, path.join(box, "src"));
  const viaNode = await ops.listNode(path.join(box, "src"));
  ok(viaHelper.map((e) => e.n).sort().join() === viaNode.map((e) => e.n).sort().join(), "helper listing matches Node listing");
  let err = null;
  try { await ops.listDir(helper, path.join(box, "nope")); } catch (e) { err = e; }
  ok(err && err.code === "ENOENT", "missing folder reports ENOENT");
  helper.stop();

  fs.rmSync(box, { recursive: true, force: true });
  console.log(`\n${passed} checks passed`);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
