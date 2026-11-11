"use strict";
// NeuralSnap's screen grabber, with plain Node: compiles apps\neuralsnap\sngrab.cs with the C# compiler that ships with
// Windows into a throwaway folder (never out\), then checks the one-shot mode (--once <file>) and the persistent mode
// (grab twice, then the end of stdin ends it), the JSON answers and the grab files.
//   node tests\neuralsnap\test-grab.js
// Privacy: a grab is a picture of the user's real screen. This test only looks at its size and whether its pixels vary
// (a sample of them, never kept, printed or shown), and deletes every grab file right after that.
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn, execFileSync } = require("child_process");

const SRC = path.join(__dirname, "..", "..", "apps", "neuralsnap", "sngrab.cs");
const CSC = path.join(process.env.SystemRoot || "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
const DIR = path.join(os.tmpdir(), "neural-testler", `sngrab-${process.pid}`);
const EXE = path.join(DIR, "sngrab.exe");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
const check = (cond, label, extra = "") => { if (cond) { passed++; console.log("  ok   " + label); } else { failed++; console.log("  FAIL " + label + (extra ? "  -> " + extra : "")); } };
const j = (x) => JSON.stringify(x);
const isInt = (v) => Number.isInteger(v);
const started = [];
const grabFiles = new Set();
const parse = (text) => { try { return JSON.parse(text); } catch (e) { return null; } };
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

// Removes a grab file at once (it is the user's screen).
function drop(file) {
  try { fs.rmSync(file, { force: true }); } catch (e) { /* retried at the end */ }
  if (!fs.existsSync(file)) grabFiles.delete(file);
}

// The answer's shape: the virtual screen is the bounding box of the monitors, windows have sizes and no titles.
function shape(g, label) {
  const bad = [];
  if (!g || g.ok !== true) return check(false, `${label}: ok`, j(g));
  if (g.format !== "rgba") bad.push("format");
  if (![g.x, g.y, g.w, g.h, g.ms].every(isInt) || g.w <= 0 || g.h <= 0 || g.ms < 0) bad.push("x/y/w/h/ms");
  const mons = g.monitors || [];
  if (!mons.length || !mons.every((m) => [m.x, m.y, m.w, m.h, m.dpi].every(isInt) && m.w > 0 && m.h > 0 && m.dpi >= 96 && typeof m.primary === "boolean")) bad.push("monitors");
  if (mons.filter((m) => m.primary).length !== 1) bad.push("one primary monitor");
  const primary = mons.find((m) => m.primary);
  if (primary && (primary.x !== 0 || primary.y !== 0)) bad.push("primary at 0,0");
  const left = Math.min(...mons.map((m) => m.x)), top = Math.min(...mons.map((m) => m.y));
  const right = Math.max(...mons.map((m) => m.x + m.w)), bottom = Math.max(...mons.map((m) => m.y + m.h));
  if (left !== g.x || top !== g.y || right - left !== g.w || bottom - top !== g.h) bad.push(`virtual screen ${g.x},${g.y} ${g.w}x${g.h} vs monitors ${left},${top} ${right - left}x${bottom - top}`);
  const wins = g.windows || [];
  if (!Array.isArray(g.windows) || !wins.every((w) => [w.x, w.y, w.w, w.h, w.pid].every(isInt) && w.w > 1 && w.h > 1 && w.pid >= 0)) bad.push("windows");
  if (wins.some((w) => Object.keys(w).some((k) => !["x", "y", "w", "h", "pid"].includes(k)))) bad.push("windows carry only x, y, w, h, pid (no title)");
  check(!bad.length, `${label}: the answer has the documented fields and sane values`, bad.join("; "));
}

// The file: exactly w*h*4 bytes; a sample of pixels is opaque and not all one colour. Then the file is deleted.
function inspect(g, label) {
  let size = -1, opaque = false, colours = 0;
  try {
    size = fs.statSync(g.file).size;
    const fd = fs.openSync(g.file, "r");
    try {
      const n = g.w * g.h;
      const picks = 4000;
      const px = Buffer.alloc(4);
      const seen = new Set();
      opaque = true;
      for (let i = 0; i < picks; i++) {
        const at = Math.floor(((i * 2654435761) % 4294967296) / 4294967296 * n); // spread over the screen
        fs.readSync(fd, px, 0, 4, at * 4);
        if (px[3] !== 255) opaque = false;
        seen.add(px.readUInt32LE(0));
      }
      colours = seen.size;
    } finally {
      fs.closeSync(fd);
    }
  } catch (e) { /* reported below */ }
  drop(g.file);
  check(size === g.w * g.h * 4, `${label}: the file holds ${g.w} x ${g.h} pixels, 4 bytes each`, `${size} bytes`);
  check(opaque, `${label}: every sampled pixel is opaque (A = 255)`);
  check(colours > 1, `${label}: the pixels are not all one colour (${colours} colours in a sample of 4000)`, "a full-screen game in exclusive mode can make GDI see one colour");
  check(!fs.existsSync(g.file), `${label}: the grab file is deleted right away`);
}

// One helper process: lines out, a promise per command.
function persistent() {
  const p = spawn(EXE, [], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  started.push(p);
  const lines = [];
  const waiting = [];
  let buf = "";
  p.stdout.setEncoding("utf8");
  p.stdout.on("data", (d) => {
    buf += d;
    for (let i; (i = buf.indexOf("\n")) >= 0; buf = buf.slice(i + 1)) {
      const line = buf.slice(0, i);
      lines.push(line);
      if (waiting.length) waiting.shift()(line);
    }
  });
  const ask = (cmd) => new Promise((res) => { waiting.push(res); p.stdin.write(cmd + "\n"); setTimeout(() => res(null), 5000); });
  return { p, ask, lines };
}

(async () => {
  try {
    console.log("compile");
    fs.rmSync(DIR, { recursive: true, force: true });
    fs.mkdirSync(DIR, { recursive: true });
    let compiled = "";
    try { compiled = execFileSync(CSC, ["/nologo", "/optimize+", "/target:exe", "/platform:x64", `/out:${EXE}`, SRC], { encoding: "utf8" }); } catch (e) { compiled = String(e.stdout || e.message); }
    check(fs.existsSync(EXE), "sngrab.cs compiles with csc (C# 5, .NET Framework) into a temp folder", compiled.trim());
    if (!fs.existsSync(EXE)) throw new Error("no helper to test");

    console.log("--once <file>");
    const once = path.join(DIR, "grab-once.raw");
    grabFiles.add(once);
    const t0 = Date.now();
    const out = await new Promise((res) => {
      const p = spawn(EXE, ["--once", once], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      started.push(p);
      let o = "";
      p.stdout.on("data", (d) => { o += d; });
      p.on("exit", (code) => res({ o, code, ms: Date.now() - t0 }));
    });
    const g1 = parse(out.o);
    check(out.code === 0 && g1 && out.o.trim().split("\n").length === 1, "prints one JSON line and exits", out.o.slice(0, 200));
    check(/^[\x20-\x7e]*\n?$/.test(out.o), "the output is plain ASCII");
    shape(g1, "--once");
    check(g1 && g1.file.toLowerCase() === once.toLowerCase(), "names the file it wrote");
    if (g1 && g1.ok) {
      const mons = g1.monitors.map((m) => `${m.w}x${m.h}@${m.dpi}dpi${m.primary ? " (primary)" : ""} at ${m.x},${m.y}`).join(", ");
      console.log(`       (virtual screen ${g1.w} x ${g1.h} at ${g1.x},${g1.y}; ${g1.monitors.length} monitor(s): ${mons}; ${g1.windows.length} windows; grab ${g1.ms} ms, whole run ${out.ms} ms)`);
      inspect(g1, "--once");
    }

    console.log("persistent: grab, grab, end of stdin");
    const h = persistent();
    const times = [];
    let last = null;
    for (let i = 1; i <= 2; i++) {
      const f = path.join(DIR, `grab ${i} ş.raw`); // a space and a Turkish letter in the path
      grabFiles.add(f);
      const a = Date.now();
      const line = await h.ask(`grab ${f}`);
      const wall = Date.now() - a;
      const g = parse(line);
      shape(g, `grab ${i}`);
      check(g && g.file === f, `grab ${i}: the file name comes back as sent (UTF-8 in, \\u escapes out)`, g && g.file);
      if (g && g.ok) { times.push({ ms: g.ms, wall }); inspect(g, `grab ${i}`); last = g; }
    }
    // More grabs for the timing only: each file is deleted as soon as the answer is in, unread.
    for (let i = 3; i <= 8; i++) {
      const f = path.join(DIR, `grab-${i}.raw`);
      grabFiles.add(f);
      const a = Date.now();
      const g = parse(await h.ask(`grab ${f}`));
      const wall = Date.now() - a;
      if (g && g.ok) times.push({ ms: g.ms, wall });
      drop(f);
    }
    const bad = parse(await h.ask("grab"));
    const unknown = parse(await h.ask("dance"));
    check(bad && bad.ok === false && unknown && unknown.ok === false && unknown.error === "unknown command", "a command without a file, or an unknown one: {ok:false, error}", j([bad, unknown]));
    const ms = median(times.map((t) => t.ms)), wall = median(times.map((t) => t.wall));
    const size = last ? `${last.w} x ${last.h}` : "?";
    console.log(`       grab times (${size}): helper ${times.map((t) => t.ms).join(", ")} ms; with the round trip ${times.map((t) => t.wall).join(", ")} ms`);
    check(times.length >= 6 && ms < 200, `a grab of ${size} takes ${ms} ms (median of ${times.length}; target under ~80 ms ${ms < 80 ? "met" : "NOT met"}), ${wall} ms with the round trip`);
    // How long main.js needs to read a grab back (the same size; the file holds zeros, not the screen).
    if (last) {
      const f = path.join(DIR, "readback.raw");
      fs.writeFileSync(f, Buffer.alloc(last.w * last.h * 4));
      const reads = [];
      for (let i = 0; i < 5; i++) { const a = process.hrtime.bigint(); fs.readFileSync(f); reads.push(Number(process.hrtime.bigint() - a) / 1e6); }
      fs.rmSync(f, { force: true });
      console.log(`       reading ${(last.w * last.h * 4 / 1048576).toFixed(1)} MB back in Node: ${median(reads).toFixed(1)} ms (median of 5)`);
    }
    const t2 = Date.now();
    h.p.stdin.end();
    for (let i = 0; i < 40 && h.p.exitCode === null; i++) await sleep(25);
    check(h.p.exitCode === 0 && Date.now() - t2 < 1000, `closing stdin ends it (${Date.now() - t2} ms)`, `exit ${h.p.exitCode}`);

    console.log("quit");
    const q = persistent();
    q.p.stdin.write("quit\n");
    for (let i = 0; i < 40 && q.p.exitCode === null; i++) await sleep(25);
    check(q.p.exitCode === 0, "quit ends it");
  } catch (e) {
    failed++;
    console.log("  FAIL " + (e.stack || e.message));
  } finally {
    for (const p of started) if (p.exitCode === null) { try { p.kill(); } catch (e) { /* gone */ } }
    await sleep(200);
    for (const f of grabFiles) drop(f);
    check(![...grabFiles].some((f) => fs.existsSync(f)), "no grab file is left");
    try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (e) { /* still in use */ }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
