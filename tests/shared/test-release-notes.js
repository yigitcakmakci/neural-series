"use strict";
// Unit tests of tools\release-notes.js with plain Node: the CHANGELOG section, the notes, and the checks that keep a
// release from carrying another version's setup.
//   node tests\shared\test-release-notes.js
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { section, main } = require("../../tools/release-notes");

const DIR = path.join(os.tmpdir(), "neural-testler", "release-notes-unit");
const ROOT = path.join(__dirname, "..", "..");
let passed = 0, failed = 0;
const check = (cond, label, extra = "") => { if (cond) { passed++; console.log("  ok   " + label); } else { failed++; console.log("  FAIL " + label + (extra ? "  -> " + extra : "")); } };
const throws = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(e.message); } };

fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const version = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;

console.log("CHANGELOG sections");
const log = "# Changelog\r\n\r\n## Unreleased\r\n\r\n- next\r\n\r\n## 1.6.0 \"Moda\" (2026-12-01)\r\n\r\nNew things.\r\n\r\n### New\r\n\r\n- one\r\n\r\n## 1.5.0 \"Beyoglu\" (2026-11-06)\r\n\r\nOlder.\r\n";
const s = section(log, "1.6.0");
check(s && s.codename === "Moda" && s.date === "2026-12-01", "finds the version's heading, codename and date", JSON.stringify(s));
check(s && s.body === "New things.\n\n### New\n\n- one", "the body ends at the next version (CRLF read as LF)", JSON.stringify(s && s.body));
check(section(log, "1.5.0").body === "Older.", "the last section runs to the end of the file");
check(section(log, "1.6") === null && section(log, "1.7.0") === null && section(log, "1x6x0") === null, "no section for another version (dots are literal)");
const real = section(fs.readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8"), version);
check(real && real.codename && real.body.length > 50, `the real CHANGELOG has a section for ${version} ("${real && real.codename}")`);

console.log("notes for the built setup");
const setup = path.join(DIR, `Neural-Setup-${version}.exe`);
fs.writeFileSync(setup, "not really a setup");
const want = crypto.createHash("sha256").update("not really a setup").digest("hex").toUpperCase();
const notesFile = path.join(DIR, "notes.md"), titleFile = path.join(DIR, "title.txt");
const r = main(["--setup", setup, "--tag", `v${version}`, "--notes", notesFile, "--title", titleFile], { GITHUB_RUN_ID: "42", GITHUB_SERVER_URL: "https://github.com", GITHUB_REPOSITORY: "o/r" });
check(r.sha256 === want && fs.readFileSync(notesFile, "utf8").includes(`SHA-256: \`${want}\``), "the notes carry the setup's SHA-256");
check(fs.readFileSync(titleFile, "utf8") === `v${version} · ${real.codename}`, "the title is v<version> · <codename>", fs.readFileSync(titleFile, "utf8"));
const text = fs.readFileSync(notesFile, "utf8");
check(text.startsWith(`## Neural Series ${version} · codename "${real.codename}"`) && text.includes(real.body.split("\n")[0]), "the notes start with the version and hold the CHANGELOG text");
check(text.includes(`Get-FileHash .\\Neural-Setup-${version}.exe`) && text.includes("https://github.com/o/r/actions/runs/42"), "how to check the download, and the build log");
check(main(["--setup", setup]).title === `v${version} · ${real.codename}`, "without --tag it uses package.json's version");

console.log("refusals");
check(throws(() => main(["--setup", setup, "--tag", "v0.0.1"]), /does not match/), "a tag of another version");
check(throws(() => main(["--setup", path.join(DIR, "yok.exe")]), /missing/), "a missing setup");
const other = path.join(DIR, "Neural-Setup-0.0.1.exe");
fs.writeFileSync(other, "x");
check(throws(() => main(["--setup", other]), /is not version/), "another version's setup file");

fs.rmSync(DIR, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
