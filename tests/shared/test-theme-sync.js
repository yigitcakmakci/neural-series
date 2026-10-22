"use strict";
// Unit tests of apps\shared\theme-sync.js with plain Node on a temp file: two "programs" in one process.
//   node tests\shared\test-theme-sync.js
const fs = require("fs");
const path = require("path");
const os = require("os");
const { ThemeSync } = require("../../apps/shared/theme-sync");

const DIR = path.join(os.tmpdir(), "neural-testler", "theme-unit");
const FILE = path.join(DIR, "alt", "theme.json"); // the folder does not exist yet
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
const check = (cond, label, extra = "") => { if (cond) { passed++; console.log("  ok   " + label); } else { failed++; console.log("  FAIL " + label + (extra ? "  -> " + extra : "")); } };

fs.rmSync(DIR, { recursive: true, force: true });
const seen = { A: [], B: [] };
const mk = (name) => new ThemeSync({ name, file: FILE, onChange: (t) => seen[name].push(t) });

(async () => {
  console.log("reading and writing");
  const a = mk("A"), b = mk("B");
  check(a.read() === null, "no file: nothing to read");
  a.start(); b.start();
  check(fs.existsSync(path.dirname(FILE)), "start creates the folder");
  check(a.write("ice") && a.read().theme === "ice" && a.read().by === `A:${process.pid}`, "write then read: { theme, changedAt, by }");
  check(!a.write("pink") && a.read().theme === "ice", "an unknown theme is refused");
  check(fs.readdirSync(path.dirname(FILE)).length === 1, "no temporary file is left behind", fs.readdirSync(path.dirname(FILE)).join(","));
  fs.writeFileSync(FILE, "{ yarım");
  check(a.read() === null, "a damaged file reads as nothing");

  console.log("following");
  seen.A.length = 0; seen.B.length = 0;
  a.write("alarm");
  await sleep(600);
  check(seen.B.join() === "alarm" && seen.A.length === 0, "B follows A; A ignores its own write", JSON.stringify(seen));
  b.write("daylight");
  await sleep(600);
  check(seen.A.join() === "daylight", "A follows B", JSON.stringify(seen));

  console.log("the file is the truth");
  seen.A.length = 0; seen.B.length = 0;
  const now = a.read().changedAt;
  // Two writers racing: the one whose rename lands last may carry the older changedAt; it still wins.
  fs.writeFileSync(FILE, JSON.stringify({ theme: "neon", changedAt: now - 5000, by: "Rakip:1" }));
  await sleep(600);
  check(seen.A.join() === "neon" && seen.B.join() === "neon", "the state that landed last is followed even with an older changedAt", JSON.stringify(seen));
  const w = b.write("ice");
  check(w && a.read().changedAt > now, "the next write is later than everything seen");
  await sleep(600);
  check(seen.A.join() === "neon,ice", "and is followed", JSON.stringify(seen));
  b.check(); a.check();
  check(seen.A.length === 2 && seen.B.length === 1, "the same state is never applied twice");

  console.log("rapid and simultaneous changes");
  seen.A.length = 0; seen.B.length = 0;
  for (const t of ["neon", "ice", "alarm", "daylight", "neon", "alarm"]) { a.write(t); b.write(t === "neon" ? "ice" : "neon"); }
  await sleep(800);
  const final = a.read();
  check(final && final.theme === "neon" && final.by.startsWith("B:"), "the last write wins", JSON.stringify(final));
  const after = fs.statSync(FILE).mtimeMs;
  await sleep(1200);
  check(fs.statSync(FILE).mtimeMs === after, "followers never write back: the file stays still");
  check(seen.A.length <= 6 && seen.B.length <= 6, "debounced: at most one event per write", JSON.stringify(seen));
  check(a.last.changedAt === final.changedAt && b.last.changedAt === final.changedAt, "both programs end on the same state");

  console.log("polling when the folder cannot be watched");
  const c = new ThemeSync({ name: "C", file: FILE, onChange: (t) => seen.C.push(t) });
  seen.C = [];
  c.last = a.read();
  c.poll();
  a.write("daylight");
  await sleep(1500);
  check(seen.C.join() === "daylight", "the 1 s poll picks up the change", JSON.stringify(seen.C));

  a.stop(); b.stop(); c.stop();
  fs.rmSync(DIR, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
