"use strict";
// NeuralNav file operations. Plain Node (no Electron), so it can be tested on its own.
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const { spawn } = require("child_process");

const ATTR_HIDDEN = 0x2;
const ATTR_SYSTEM = 0x4;
const ATTR_REPARSE = 0x400;

/* ---------- errors ---------- */
function describe(err) {
  switch (err && err.code) {
    case "ENOENT": return "Öğe bulunamadı.";
    case "EACCES":
    case "EPERM": return "Erişim izni yok.";
    case "EBUSY": return "Öğe başka bir program tarafından kullanılıyor.";
    case "ENOTEMPTY": return "Klasör boş değil.";
    case "EEXIST": return "Aynı adlı bir öğe zaten var.";
    case "ENOSPC": return "Diskte yer kalmadı.";
    case "EXDEV": return "Sürücüler arasında taşınamadı.";
    case "ENAMETOOLONG": return "Yol çok uzun.";
    case "ENOTDIR": return "Bu bir klasör değil.";
    default: return (err && err.message) || "Bilinmeyen hata.";
  }
}
const fail = (code, message) => Object.assign(new Error(message), { code });
const abortError = () => Object.assign(new Error("İptal edildi."), { name: "AbortError" });
const check = (signal) => { if (signal && signal.aborted) throw abortError(); };

/* ---------- paths and names ---------- */
const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const sameRoot = (a, b) => path.parse(path.resolve(a)).root.toLowerCase() === path.parse(path.resolve(b)).root.toLowerCase();
function isInside(child, parent) {
  const rel = path.relative(parent.toLowerCase(), child.toLowerCase());
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}
async function lstatOrNull(p) { try { return await fsp.lstat(p); } catch (e) { return null; } }
function splitName(name, isDir) {
  if (isDir) return [name, ""];
  const i = name.lastIndexOf(".");
  return i > 0 ? [name.slice(0, i), name.slice(i)] : [name, ""];
}

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
function invalidName(name) {
  if (!name || !name.trim()) return "Ad boş olamaz.";
  if (/[\\/:*?"<>|\x00-\x1f]/.test(name)) return 'Ad şu karakterleri içeremez: \\ / : * ? " < > |';
  if (/[. ]$/.test(name)) return "Ad nokta ya da boşlukla bitemez.";
  if (RESERVED.test(name)) return "Bu ad Windows tarafından ayrılmış.";
  if (name.length > 255) return "Ad çok uzun.";
  return "";
}

// "Yeni klasör" (New folder), "Yeni klasör (2)", ...
async function uniqueName(dir, name, isDir) {
  if (!(await lstatOrNull(path.join(dir, name)))) return name;
  const [base, ext] = splitName(name, isDir);
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})${ext}`;
    if (!(await lstatOrNull(path.join(dir, candidate)))) return candidate;
  }
}
// Explorer's copy names on Turkish Windows: "file - Kopya.txt", "file - Kopya (2).txt"
async function uniqueCopyName(dir, name, isDir) {
  const [base, ext] = splitName(name, isDir);
  const first = `${base} - Kopya${ext}`;
  if (!(await lstatOrNull(path.join(dir, first)))) return first;
  for (let n = 2; ; n++) {
    const candidate = `${base} - Kopya (${n})${ext}`;
    if (!(await lstatOrNull(path.join(dir, candidate)))) return candidate;
  }
}

/* ---------- helper process (attributes, drives, file clipboard) ---------- */
class Helper {
  constructor(exe) {
    this.exe = exe;
    this.proc = null;
    this.seq = 0;
    this.pending = new Map();
    this.buf = "";
    this.broken = false;
  }
  start() {
    if (this.proc) return true;
    if (this.broken || !fs.existsSync(this.exe)) return false;
    let p;
    try {
      p = spawn(this.exe, [], { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
    } catch (e) {
      this.broken = true;
      return false;
    }
    p.stdout.setEncoding("utf8");
    p.stdout.on("data", (d) => {
      this.buf += d;
      let i;
      while ((i = this.buf.indexOf("\n")) >= 0) {
        const line = this.buf.slice(0, i);
        this.buf = this.buf.slice(i + 1);
        this.onLine(line);
      }
    });
    p.on("error", () => { this.broken = true; });
    p.on("exit", () => {
      this.proc = null;
      this.buf = "";
      for (const r of this.pending.values()) { clearTimeout(r.timer); r.reject(new Error("helper exited")); }
      this.pending.clear();
    });
    this.proc = p;
    return true;
  }
  onLine(line) {
    const t = line.indexOf("\t");
    if (t < 0) return;
    const r = this.pending.get(line.slice(0, t));
    if (!r) return;
    this.pending.delete(line.slice(0, t));
    clearTimeout(r.timer);
    let v;
    try { v = JSON.parse(line.slice(t + 1)); } catch (e) { r.reject(e); return; }
    if (v && typeof v === "object" && !Array.isArray(v) && typeof v.error === "string") r.reject(fail(v.code || "EIO", v.error));
    else r.resolve(v);
  }
  call(cmd, ...args) {
    if (!this.start()) return Promise.reject(Object.assign(new Error("helper unavailable"), { code: "NOHELPER" }));
    const id = String(++this.seq);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Object.assign(new Error("helper timeout"), { code: "NOHELPER" }));
      }, cmd === "list" ? 60000 : 15000);
      this.pending.set(id, { resolve, reject, timer });
      this.proc.stdin.write([id, cmd, ...args].join("\t") + "\n");
    });
  }
  stop() { if (this.proc) this.proc.kill(); }
}

/* ---------- listing ---------- */
const SYSTEM_NAMES = new Set(["desktop.ini", "thumbs.db", "$recycle.bin", "system volume information", "pagefile.sys", "hiberfil.sys", "swapfile.sys", "dumpstack.log.tmp"]);

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// Node-only listing for when the helper is unavailable; attributes are guessed from well-known names.
async function listNode(dir) {
  const dirents = await fsp.readdir(dir, { withFileTypes: true });
  return mapLimit(dirents, 32, async (d) => {
    const full = path.join(dir, d.name);
    let a = SYSTEM_NAMES.has(d.name.toLowerCase()) ? ATTR_HIDDEN | ATTR_SYSTEM : 0;
    try {
      const st = await fsp.lstat(full);
      if (st.isSymbolicLink()) a |= ATTR_REPARSE;
      const isDir = st.isDirectory() || (st.isSymbolicLink() && d.isDirectory());
      return { n: d.name, d: isDir ? 1 : 0, s: isDir ? 0 : st.size, m: Math.round(st.mtimeMs), c: Math.round(st.birthtimeMs), a };
    } catch (e) {
      return { n: d.name, d: d.isDirectory() ? 1 : 0, s: 0, m: 0, c: 0, a };
    }
  });
}

async function listDir(helper, dir) {
  if (helper) {
    try { return await helper.call("list", dir); }
    catch (e) { if (e.code !== "NOHELPER") throw e; }
  }
  return listNode(dir);
}

/* ---------- copy / move ---------- */
async function measure(p, acc, signal) {
  check(signal);
  const st = await lstatOrNull(p);
  if (!st) return;
  if (st.isDirectory() && !st.isSymbolicLink()) {
    let names = [];
    try { names = await fsp.readdir(p); } catch (e) { return; }
    for (const n of names) await measure(path.join(p, n), acc, signal);
  } else {
    acc.files += 1;
    acc.bytes += st.size;
  }
}

// Copies or moves `sources` into `destDir`. `ask(conflict)` resolves to { action: 'replace'|'skip'|'keep'|'cancel', all }.
// For folders 'replace' means merge. Returns the top-level items created and per-item errors.
async function transfer({ op, sources, destDir, ask, progress, signal }) {
  destDir = path.resolve(destDir);
  const dst = await lstatOrNull(destDir);
  if (!dst || !dst.isDirectory()) throw fail("ENOTDIR", "Hedef bir klasör değil.");

  const result = { op, done: [], pairs: [], skipped: 0, errors: [] };
  const remembered = { file: null, dir: null };
  const totals = { files: 0, bytes: 0 };
  const state = { files: 0, bytes: 0, current: "" };
  const tick = (bytes, name) => {
    state.files += 1;
    state.bytes += bytes;
    state.current = name;
    if (progress) progress({ doneFiles: state.files, doneBytes: state.bytes, totalFiles: totals.files, totalBytes: totals.bytes, current: name });
  };

  const items = [];
  for (const raw of sources) {
    const src = path.resolve(raw);
    const st = await lstatOrNull(src);
    if (!st) { result.errors.push({ path: src, message: "Öğe bulunamadı." }); continue; }
    const isDir = st.isDirectory() && !st.isSymbolicLink();
    if (isDir && isInside(destDir, src) && !samePath(path.dirname(src), destDir)) {
      result.errors.push({ path: src, message: "Hedef klasör, kaynak klasörün içinde." });
      continue;
    }
    if (op === "move" && samePath(path.dirname(src), destDir)) { result.skipped += 1; continue; }
    items.push({ src, isDir });
  }

  for (const it of items) {
    if (op === "copy" || !sameRoot(it.src, destDir)) await measure(it.src, totals, signal);
    else totals.files += 1;
  }

  async function decide(src, dest, isDir, destStat) {
    const kind = isDir ? "dir" : "file";
    if (remembered[kind]) return remembered[kind];
    const srcStat = await lstatOrNull(src);
    const d = await ask({
      src, dest, isDir,
      srcSize: srcStat ? srcStat.size : 0, srcMtime: srcStat ? srcStat.mtimeMs : 0,
      destSize: destStat.size, destMtime: destStat.mtimeMs,
    });
    const action = (d && d.action) || "cancel";
    if (action === "cancel") throw abortError();
    if (d.all) remembered[kind] = action;
    return action;
  }

  async function place(src, dest, top) {
    check(signal);
    const sst = await fsp.lstat(src);
    const isDir = sst.isDirectory() && !sst.isSymbolicLink();
    let existing = await lstatOrNull(dest);
    if (existing && samePath(src, dest)) { result.skipped += 1; return null; }
    if (existing) {
      const existingIsDir = existing.isDirectory() && !existing.isSymbolicLink();
      if (existingIsDir !== isDir) {
        result.errors.push({ path: src, message: `Hedefte aynı adlı bir ${existingIsDir ? "klasör" : "dosya"} var.` });
        return null;
      }
      const action = await decide(src, dest, isDir, existing);
      if (action === "skip") {
        result.skipped += 1;
        if (op === "copy") { const acc = { files: 0, bytes: 0 }; await measure(src, acc, signal); state.files += acc.files; state.bytes += acc.bytes; }
        return null;
      }
      if (action === "keep") {
        dest = path.join(path.dirname(dest), await uniqueName(path.dirname(dest), path.basename(dest), isDir));
        existing = null;
      }
    }

    if (op === "move" && sameRoot(src, dest) && (!existing || !isDir)) {
      await fsp.rename(src, dest);
      tick(isDir ? 0 : sst.size, path.basename(src));
      return dest;
    }

    if (isDir) {
      if (!existing) await fsp.mkdir(dest);
      for (const n of await fsp.readdir(src)) {
        try { await place(path.join(src, n), path.join(dest, n), false); }
        catch (e) { if (e.name === "AbortError") throw e; result.errors.push({ path: path.join(src, n), message: describe(e) }); }
      }
      if (op === "move") { try { await fsp.rmdir(src); } catch (e) { /* items that were skipped stay behind */ } }
    } else if (sst.isSymbolicLink()) {
      const target = await fsp.readlink(src);
      if (existing) await fsp.unlink(dest);
      const targetStat = await fsp.stat(src).catch(() => null);
      await fsp.symlink(target, dest, targetStat && targetStat.isDirectory() ? "junction" : "file");
      if (op === "move") await fsp.unlink(src);
      tick(0, path.basename(src));
    } else {
      await fsp.copyFile(src, dest);
      if (op === "move") await fsp.unlink(src);
      tick(sst.size, path.basename(src));
    }
    return dest;
  }

  for (const it of items) {
    check(signal);
    let dest = path.join(destDir, path.basename(it.src));
    if (op === "copy" && samePath(path.dirname(it.src), destDir)) {
      dest = path.join(destDir, await uniqueCopyName(destDir, path.basename(it.src), it.isDir));
    }
    try {
      const made = await place(it.src, dest, true);
      if (made) { result.done.push(made); result.pairs.push([it.src, made]); }
    } catch (e) {
      if (e.name === "AbortError") { result.cancelled = true; break; }
      result.errors.push({ path: it.src, message: describe(e) });
    }
  }
  return result;
}

/* ---------- search and folder size ---------- */
function makeMatcher(query) {
  const q = query.trim().toLocaleLowerCase("tr-TR");
  if (/[*?]/.test(q)) {
    const re = new RegExp("^" + q.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$", "i");
    return (name) => re.test(name.toLocaleLowerCase("tr-TR"));
  }
  return (name) => name.toLocaleLowerCase("tr-TR").includes(q);
}

// Breadth-first, so nearer matches come first. Results arrive in batches through onBatch.
async function search({ root, query, signal, onBatch, limit = 5000, skipHidden = true }) {
  const match = makeMatcher(query);
  const queue = [path.resolve(root)];
  let batch = [];
  let found = 0;
  let last = Date.now();
  const flush = (force) => {
    if (batch.length && (force || batch.length >= 200 || Date.now() - last > 250)) {
      onBatch(batch);
      batch = [];
      last = Date.now();
    }
  };
  while (queue.length) {
    check(signal);
    const dir = queue.shift();
    let dirents;
    try { dirents = await fsp.readdir(dir, { withFileTypes: true }); } catch (e) { continue; }
    for (const d of dirents) {
      if (skipHidden && SYSTEM_NAMES.has(d.name.toLowerCase())) continue;
      const full = path.join(dir, d.name);
      if (match(d.name)) {
        const st = await lstatOrNull(full);
        const isDir = d.isDirectory();
        batch.push({ path: full, n: d.name, d: isDir ? 1 : 0, s: st && !isDir ? st.size : 0, m: st ? Math.round(st.mtimeMs) : 0, c: st ? Math.round(st.birthtimeMs) : 0, a: 0 });
        if (++found >= limit) { flush(true); return { found, truncated: true }; }
      }
      if (d.isDirectory() && !d.isSymbolicLink()) queue.push(full);
    }
    flush(false);
  }
  flush(true);
  return { found, truncated: false };
}

async function folderSize(p, { signal, onProgress } = {}) {
  const acc = { bytes: 0, files: 0, dirs: 0 };
  let last = 0;
  async function walk(dir) {
    check(signal);
    let dirents;
    try { dirents = await fsp.readdir(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const d of dirents) {
      const full = path.join(dir, d.name);
      if (d.isDirectory() && !d.isSymbolicLink()) { acc.dirs += 1; await walk(full); }
      else {
        const st = await lstatOrNull(full);
        acc.files += 1;
        acc.bytes += st ? st.size : 0;
      }
      if (onProgress && Date.now() - last > 200) { last = Date.now(); onProgress({ ...acc }); }
    }
  }
  await walk(path.resolve(p));
  return acc;
}

module.exports = {
  ATTR_HIDDEN, ATTR_SYSTEM, ATTR_REPARSE,
  Helper, listDir, listNode, transfer, search, folderSize,
  uniqueName, uniqueCopyName, invalidName, describe, samePath, sameRoot, isInside, lstatOrNull,
};
