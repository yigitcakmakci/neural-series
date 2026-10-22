"use strict";
// NeuralWeb's password vault. Logins live in one JSON file; every password is encrypted with Windows DPAPI
// (Electron's safeStorage), so only this Windows user on this computer can read them. Plain passwords exist
// only in this process's memory, on their way to a page that is filled or to the user's own passwords page.
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");
const { DatabaseSync } = require("node:sqlite");
const { safeStorage } = require("electron");

const WEBKIT_EPOCH_OFFSET = 11644473600000;
const originOf = (url) => {
  try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? u.origin : ""; } catch (e) { return ""; }
};
const newId = () => crypto.randomBytes(8).toString("hex");

function run(exe, args, input) {
  return new Promise((resolve, reject) => {
    const child = execFile(exe, args, { windowsHide: true, maxBuffer: 1 << 20 }, (err, stdout) => {
      if (err) reject(err); else resolve(String(stdout).trim());
    });
    if (input != null) child.stdin.end(input);
  });
}

class Vault {
  constructor(dir, helpers) {
    this.file = path.join(dir, "passwords.json");
    this.helpers = helpers; // { dpapi: path to nwdpapi.exe, hello: path to nwhello.exe }
    try { this.data = JSON.parse(fs.readFileSync(this.file, "utf8")); } catch (e) { this.data = {}; }
    this.data = { logins: [], never: [], ...this.data };
    this.verifiedUntil = 0;
  }
  save() {
    const tmp = this.file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }
  encrypt(password) { return safeStorage.encryptString(String(password)).toString("base64"); }
  decrypt(login) { return safeStorage.decryptString(Buffer.from(login.password, "base64")); }

  /* ---------- logins ---------- */
  // What pages and lists may see: never the password.
  view(l) { return { id: l.id, origin: l.origin, username: l.username, created: l.created, used: l.used || 0, times: l.times || 0 }; }
  list() { return this.data.logins.map((l) => this.view(l)).sort((a, b) => a.origin.localeCompare(b.origin) || a.username.localeCompare(b.username)); }
  forOrigin(origin) { return this.data.logins.filter((l) => l.origin === origin).sort((a, b) => (b.used || 0) - (a.used || 0)); }
  get(id) { return this.data.logins.find((l) => l.id === id) || null; }
  find(origin, username) { return this.data.logins.find((l) => l.origin === origin && l.username === username) || null; }
  // Saves or updates; returns "added", "updated" or "same".
  upsert({ origin, username, password, created }) {
    if (!origin || !password) return null;
    const user = String(username || "");
    const hit = this.find(origin, user);
    if (hit) {
      if (this.decrypt(hit) === password) return "same";
      hit.password = this.encrypt(password);
      hit.changed = Date.now();
      this.save();
      return "updated";
    }
    this.data.logins.push({ id: newId(), origin, username: user, password: this.encrypt(password), created: created || Date.now(), used: 0, times: 0 });
    this.data.never = this.data.never.filter((o) => o !== origin);
    this.save();
    return "added";
  }
  update(id, { username, password }) {
    const l = this.get(id);
    if (!l) return false;
    if (typeof username === "string") l.username = username;
    if (typeof password === "string" && password) l.password = this.encrypt(password);
    l.changed = Date.now();
    this.save();
    return true;
  }
  remove(id) {
    const before = this.data.logins.length;
    this.data.logins = this.data.logins.filter((l) => l.id !== id);
    this.save();
    return this.data.logins.length < before;
  }
  touch(id) {
    const l = this.get(id);
    if (!l) return;
    l.used = Date.now();
    l.times = (l.times || 0) + 1;
    this.save();
  }
  isNever(origin) { return this.data.never.includes(origin); }
  setNever(origin, on) {
    this.data.never = this.data.never.filter((o) => o !== origin);
    if (on) this.data.never.push(origin);
    this.save();
  }

  /* ---------- Windows Hello before a password is shown or copied ---------- */
  // One check covers a minute, as in Chrome.
  async verify(hwnd) {
    if (Date.now() < this.verifiedUntil) return true;
    let ok;
    const test = process.env.NEURALWEB_PROFILE && process.env.NEURALWEB_TEST_HELLO; // tests never raise the real dialog
    if (test) ok = test === "verified";
    else {
      ok = await new Promise((resolve) => {
        execFile(this.helpers.hello, [String(hwnd), "NeuralWeb: kaydedilmiş şifreyi görmek için kimliğini doğrula"], { windowsHide: true }, (err) => {
          // 0 verified; 2 means Windows Hello is not set up, then the Windows sign-in itself is the only lock
          resolve(!err || err.code === 2);
        });
      });
    }
    if (ok) this.verifiedUntil = Date.now() + 60e3;
    return ok;
  }

  /* ---------- imports ---------- */
  // Edge keeps passwords in "Login Data", encrypted with AES-GCM under a key that DPAPI protects in "Local State".
  // Passwords Edge locked to itself ("v20", app-bound encryption) cannot be read by another program.
  async importEdge(edgeDir, profile) {
    const result = { added: 0, same: 0, kept: 0, locked: 0, never: 0, errors: [] };
    let key;
    try {
      const state = JSON.parse(fs.readFileSync(path.join(edgeDir, "Local State"), "utf8"));
      const wrapped = Buffer.from(state.os_crypt.encrypted_key, "base64");
      if (wrapped.subarray(0, 5).toString() !== "DPAPI") throw new Error("anahtar biçimi tanınmadı");
      key = Buffer.from(await run(this.helpers.dpapi, ["unprotect"], wrapped.subarray(5).toString("base64")), "base64");
    } catch (e) {
      result.errors.push("Edge'in şifre anahtarı okunamadı.");
      return result;
    }
    const tmp = path.join(os.tmpdir(), `neuralweb-edge-logins-${process.pid}.sqlite`);
    try {
      fs.copyFileSync(path.join(edgeDir, profile, "Login Data"), tmp);
      const db = new DatabaseSync(tmp, { readOnly: true });
      const rows = db.prepare(`SELECT origin_url, username_value, password_value, blacklisted_by_user,
        (date_created / 1000 - ${WEBKIT_EPOCH_OFFSET}) AS created FROM logins`).all();
      db.close();
      for (const r of rows) {
        const origin = originOf(r.origin_url);
        if (!origin) continue;
        if (r.blacklisted_by_user) { if (!this.isNever(origin)) { this.data.never.push(origin); result.never += 1; } continue; }
        const blob = Buffer.from(r.password_value || []);
        const tag = blob.subarray(0, 3).toString();
        let password;
        try {
          if (tag === "v10" || tag === "v11") {
            const d = crypto.createDecipheriv("aes-256-gcm", key, blob.subarray(3, 15));
            d.setAuthTag(blob.subarray(blob.length - 16));
            password = Buffer.concat([d.update(blob.subarray(15, blob.length - 16)), d.final()]).toString("utf8");
          } else if (tag === "v20") { result.locked += 1; continue; }
          else if (blob.length) password = Buffer.from(await run(this.helpers.dpapi, ["unprotect"], blob.toString("base64")), "base64").toString("utf8");
        } catch (e) { result.locked += 1; continue; }
        if (!password) continue;
        const existing = this.find(origin, r.username_value || "");
        if (existing) { if (this.decrypt(existing) === password) result.same += 1; else result.kept += 1; continue; }
        this.upsert({ origin, username: r.username_value, password, created: r.created > 0 ? r.created : Date.now() });
        result.added += 1;
      }
      this.save();
    } catch (e) {
      result.errors.push(e.code === "EBUSY" ? "Edge açıkken şifre dosyası kopyalanamadı; Edge'i kapatıp yeniden dene." : e.code === "ENOENT" ? "Bu Edge profilinde şifre dosyası yok." : "Şifreler okunamadı.");
    } finally {
      key.fill(0);
      try { fs.rmSync(tmp, { force: true }); } catch (e) { /* temp file */ }
    }
    return result;
  }
  // A CSV exported from Edge, Chrome or Firefox (name,url,username,password,…).
  importCsv(text) {
    const result = { added: 0, same: 0, kept: 0, skipped: 0 };
    const rows = parseCsv(text);
    const head = (rows.shift() || []).map((h) => h.trim().toLowerCase());
    const col = (names) => head.findIndex((h) => names.includes(h));
    const iu = col(["url", "origin", "web site", "website"]);
    const in_ = col(["username", "user", "login", "kullanıcı adı"]);
    const ip = col(["password", "şifre", "parola"]);
    if (iu < 0 || ip < 0) throw new Error("Dosyada url ve password sütunları yok.");
    for (const r of rows) {
      const origin = originOf((r[iu] || "").trim());
      const password = r[ip] || "";
      if (!origin || !password) { result.skipped += 1; continue; }
      const username = in_ >= 0 ? r[in_] || "" : "";
      const existing = this.find(origin, username);
      if (existing) { if (this.decrypt(existing) === password) result.same += 1; else result.kept += 1; continue; }
      this.upsert({ origin, username, password });
      result.added += 1;
    }
    return result;
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  const s = String(text).replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== "")) rows.push(row);
  return rows;
}

module.exports = { Vault, originOf, parseCsv };
