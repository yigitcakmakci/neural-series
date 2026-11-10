"use strict";
// NeuralPulse's measuring helper, with plain Node: compiles apps\neuralpulse\plsensor.cs with the C# compiler that ships
// with Windows into a throwaway folder (never out\), then checks the one-shot mode (--once, --top), the invented data
// (--demo) and the streaming mode (a line a second, pause, resume, and the end when stdin closes).
//   node tests\neuralpulse\test-sensor.js
// It only reads: it starts the helper and nothing else, and ends nothing but the helpers it started.
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn, execFileSync } = require("child_process");

const SRC = path.join(__dirname, "..", "..", "apps", "neuralpulse", "plsensor.cs");
const CSC = path.join(process.env.SystemRoot || "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
const DIR = path.join(os.tmpdir(), "neural-testler", `plsensor-${process.pid}`);
const EXE = path.join(DIR, "plsensor.exe");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
const check = (cond, label, extra = "") => { if (cond) { passed++; console.log("  ok   " + label); } else { failed++; console.log("  FAIL " + label + (extra ? "  -> " + extra : "")); } };
const j = (x) => JSON.stringify(x);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const pct = (v) => isNum(v) && v >= 0 && v <= 100;
const started = [];

// One run of the helper with these arguments: { out, ms, code }.
function run(args) {
  return new Promise((res) => {
    const t0 = Date.now();
    const p = spawn(EXE, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    started.push(p);
    let out = "", err = "";
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { err += d; });
    p.on("exit", (code) => res({ out, err, code, ms: Date.now() - t0 }));
  });
}
function parse(text) {
  try { return JSON.parse(text); } catch (e) { return null; }
}

// The shape every sample has, whatever the source.
function shape(s, label) {
  const bad = [];
  if (!s || typeof s !== "object") return check(false, `${label}: a JSON object`);
  if (!isNum(s.t) || Math.abs(s.t - Date.now()) > 120000) bad.push("t");
  if (!s.cpu || !pct(s.cpu.total) || !Array.isArray(s.cpu.cores) || !s.cpu.cores.length || !s.cpu.cores.every(pct)) bad.push("cpu");
  const m = s.mem;
  if (!m || ![m.total, m.used, m.commit, m.commitLimit].every((v) => Number.isInteger(v) && v > 0) || m.used > m.total || m.commit > m.commitLimit) bad.push("mem");
  if (!Array.isArray(s.disks) || !s.disks.every((d) => typeof d.name === "string" && /^\d+\b/.test(d.name) && !/_total/i.test(d.name) && Number.isInteger(d.read) && d.read >= 0 && Number.isInteger(d.write) && d.write >= 0 && pct(d.busy))) bad.push("disks");
  if (!Array.isArray(s.net) || !s.net.every((n) => typeof n.name === "string" && n.name && Number.isInteger(n.rx) && n.rx >= 0 && Number.isInteger(n.tx) && n.tx >= 0)) bad.push("net");
  if (s.gpu !== null && !(s.gpu && pct(s.gpu.util) && Number.isInteger(s.gpu.used) && s.gpu.used >= 0 && (s.gpu.total === null || (Number.isInteger(s.gpu.total) && s.gpu.total > 0)))) bad.push("gpu");
  if (!Array.isArray(s.procs) || !s.procs.every((p) => Number.isInteger(p.pid) && p.pid > 0 && typeof p.name === "string" && p.name && pct(p.cpu) && Number.isInteger(p.mem) && p.mem >= 0 && (p.path === null || (typeof p.path === "string" && path.isAbsolute(p.path))))) bad.push("procs");
  else if (new Set(s.procs.map((p) => p.pid)).size !== s.procs.length) bad.push("procs (a pid twice)");
  check(!bad.length, `${label}: the sample has the documented fields and sane values`, bad.join(", "));
}

(async () => {
  try {
    console.log("compile");
    fs.rmSync(DIR, { recursive: true, force: true });
    fs.mkdirSync(DIR, { recursive: true });
    let compiled = "";
    try { compiled = execFileSync(CSC, ["/nologo", "/optimize+", "/target:exe", "/platform:x64", `/out:${EXE}`, SRC], { encoding: "utf8" }); } catch (e) { compiled = String(e.stdout || e.message); }
    check(fs.existsSync(EXE), "plsensor.cs compiles with csc (C# 5, .NET Framework) into a temp folder", compiled.trim());
    if (!fs.existsSync(EXE)) throw new Error("no helper to test");

    console.log("--once");
    let r = await run(["--once"]);
    let s = parse(r.out);
    check(r.code === 0 && s && r.out.trim().split("\n").length === 1, "prints one JSON object and exits", r.err || r.out.slice(0, 200));
    shape(s, "--once");
    check(r.ms < 1600, `takes about a second (${r.ms} ms; NeuralDeck waits for it)`);
    check(s.cpu.cores.length === os.cpus().length, `one value per logical processor (${s.cpu.cores.length})`);
    check(s.mem.total === os.totalmem(), "memory total is the physical memory", `${s.mem.total} vs ${os.totalmem()}`);
    check(s.procs.length > 30, `lists the processes (${s.procs.length})`);
    check(!s.procs.some((p) => p.name === "Idle" || p.name === "System Idle Process"), "without the idle process");
    const me = s.procs.find((p) => p.pid === process.pid);
    check(me && me.name === "node" && me.path && me.path.toLowerCase() === process.execPath.toLowerCase() && me.mem > 1 << 20,
      "this test's own process: name without .exe, its path, its memory", j(me));
    const sys = s.procs.find((p) => p.pid === 4);
    check(sys && sys.name === "System" && sys.path === null, "the System process (pid 4) is there, without a path", j(sys));
    check(s.procs.some((p) => p.path === null) && s.procs.some((p) => p.path), "paths where Windows allows, null where it does not");
    check(/^[\x20-\x7e]*\n?$/.test(r.out), "the output is plain ASCII (other characters as \\u escapes)");
    console.log(`       (cpu ${s.cpu.total} %, ${s.disks.length} disk(s): ${s.disks.map((d) => d.name).join(", ")}; ${s.net.length} network interface(s); gpu ${s.gpu ? `${s.gpu.util} %, ${s.gpu.name}` : "none"})`);
    const realNames = new Set(s.procs.map((p) => p.name.toLowerCase()));
    const realDisks = new Set(s.disks.map((d) => d.name));
    const realNets = new Set(s.net.map((n) => n.name));

    console.log("--once --top 3");
    r = await run(["--once", "--top", "3"]);
    s = parse(r.out);
    shape(s, "--top 3");
    const order = s.procs.every((p, i, a) => i === 0 || a[i - 1].cpu > p.cpu || (a[i - 1].cpu === p.cpu && a[i - 1].mem >= p.mem));
    check(s.procs.length === 3 && order, "only the three busiest processes, by CPU then memory", j(s.procs.map((p) => [p.name, p.cpu, p.mem])));

    console.log("--demo --once");
    r = await run(["--demo", "--once"]);
    s = parse(r.out);
    shape(s, "--demo");
    const again = parse((await run(["--once", "--demo"])).out);
    const strip = (x) => j({ ...x, t: 0 });
    check(again && strip(again) === strip(s), "the same data on every run (only the time differs)");
    check(r.ms < 1000, `answers at once (${r.ms} ms)`);
    check(s.procs.length >= 30 && !s.procs.some((p) => realNames.has(p.name.toLowerCase())), "invented process names, none of this computer's", j(s.procs.filter((p) => realNames.has(p.name.toLowerCase()))));
    check(!s.disks.some((d) => realDisks.has(d.name)) && !s.net.some((n) => realNets.has(n.name)) && s.gpu && s.gpu.total > 0, "invented disks, network interfaces and GPU", j({ disks: s.disks.map((d) => d.name), net: s.net.map((n) => n.name), gpu: s.gpu }));
    check(s.procs.every((p) => p.path === null || /^C:\\Neural\\Demo\\/.test(p.path)), "invented paths");

    console.log("streaming");
    const p = spawn(EXE, [], { stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
    started.push(p);
    const lines = [];
    let buf = "";
    p.stdout.on("data", (d) => {
      buf += d;
      for (let i; (i = buf.indexOf("\n")) >= 0; buf = buf.slice(i + 1)) lines.push({ at: Date.now(), s: parse(buf.slice(0, i)) });
    });
    let exitedAt = 0;
    p.on("exit", () => { exitedAt = Date.now(); });
    const waitLines = async (n, ms) => { const t0 = Date.now(); while (lines.length < n && Date.now() - t0 < ms) await sleep(50); return lines.length >= n; };
    check(await waitLines(4, 8000), "a line comes every second", `${lines.length} lines`);
    lines.forEach((l, i) => i === 0 || shape(l.s, `line ${i + 1}`));
    const gaps = lines.slice(1, 4).map((l, i) => l.at - lines[i].at);
    check(gaps.every((g) => g > 700 && g < 1400), "about 1000 ms apart", j(gaps));
    p.stdin.write("pause\n");
    await sleep(300);
    const paused = lines.length;
    await sleep(2500);
    check(lines.length === paused, "pause: no more lines", `${lines.length - paused} more`);
    p.stdin.write("resume\n");
    const t1 = Date.now();
    check(await waitLines(paused + 1, 3000), `resume: lines again (after ${Date.now() - t1} ms)`);
    await waitLines(paused + 6, 8000);
    const self = lines.slice(-5).map((l) => (l.s.procs.find((x) => x.pid === p.pid) || {}).cpu).filter(isNum);
    const avg = self.reduce((a, b) => a + b, 0) / Math.max(1, self.length);
    check(self.length && avg < 1.5, `the helper itself stays light (${avg.toFixed(2)} % of the CPU on average)`, j(self));
    const t2 = Date.now();
    p.stdin.end();
    for (let i = 0; i < 40 && !exitedAt; i++) await sleep(50);
    check(exitedAt && exitedAt - t2 < 1000, `closing stdin ends it (${exitedAt ? exitedAt - t2 : "-"} ms)`);

    console.log("streaming --demo");
    const d = spawn(EXE, ["--demo"], { stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
    started.push(d);
    const dl = [];
    let db = "";
    d.stdout.on("data", (x) => { db += x; for (let i; (i = db.indexOf("\n")) >= 0; db = db.slice(i + 1)) dl.push(parse(db.slice(0, i))); });
    await sleep(1500);
    const ts = dl.map((x) => x && x.t);
    check(dl.length >= 60 && ts.every((t, i) => i === 0 || t > ts[i - 1]), `a minute of history at once, then live (${dl.length} lines, times rising)`);
    check(dl[59] && strip(dl[0]) === strip(s), "its first sample is the --once sample");
    d.stdin.write("quit\n");
    await sleep(800);
    check(d.exitCode !== null, "quit ends it");
  } catch (e) {
    failed++;
    console.log("  FAIL " + (e.stack || e.message));
  } finally {
    for (const p of started) if (p.exitCode === null) { try { p.kill(); } catch (e) { /* gone */ } }
    await sleep(300);
    try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (e) { /* still in use */ }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
