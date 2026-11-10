"use strict";
// The release notes and title for a version, from CHANGELOG.md and the built setup (its SHA-256). GitHub Actions
// runs it for every build (the notes go to the run summary) and uses it for the draft release of a version tag.
//   node tools\release-notes.js --setup out\Neural-Setup-1.6.0.exe [--tag v1.6.0] [--notes notes.md] [--title title.txt]
// A tag that does not match package.json's version is refused, so a release can never carry another version's setup.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const REPO = "https://github.com/yigitcakmakci/neural-series";

// The CHANGELOG section of a version: { codename, date, body } or null.
function section(changelog, version) {
  const lines = changelog.replace(/\r\n/g, "\n").split("\n");
  const esc = version.replace(/\./g, "\\.");
  const start = lines.findIndex((l) => new RegExp(`^## ${esc} "([^"]+)" \\(([^)]+)\\)\\s*$`).test(l));
  if (start < 0) return null;
  const [, codename, date] = lines[start].match(/"([^"]+)" \(([^)]+)\)/);
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  if (end < 0) end = lines.length;
  return { codename, date, body: lines.slice(start + 1, end).join("\n").trim() };
}

function notes({ version, codename, body, sha256, runUrl }) {
  const setup = `Neural-Setup-${version}.exe`;
  return `## Neural Series ${version} · codename "${codename}"

${body}

### Update or install

- **Updating from any 1.x release:** run \`${setup}\`. It finds the existing installation and keeps your options,
  settings and personal data.
- **New install:** Windows 10 or 11, 64-bit, about 1.7 GB of disk space. The setup is not code-signed, so SmartScreen
  may warn you: choose **More info → Run anyway**.

The [README](${REPO}#readme) has the user guide.

### Verify the download

\`\`\`powershell
Get-FileHash .\\${setup} -Algorithm SHA256
\`\`\`

SHA-256: \`${sha256}\`

Built from this tag with \`build.ps1\`${runUrl ? ` on GitHub Actions ([build log](${runUrl}))` : ""}. Full list of changes:
[changelog](${REPO}/blob/main/CHANGELOG.md).

> Neural Series is a personal fan project born from a love of the cyberpunk genre: a fantasy, not a product.
`;
}

function main(argv, env = process.env) {
  const arg = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
  const tag = arg("tag") || `v${version}`;
  if (tag !== `v${version}`) throw new Error(`the tag ${tag} does not match package.json's version ${version}`);
  const setup = arg("setup");
  if (!setup || !fs.existsSync(setup)) throw new Error(`the setup is missing: ${setup}`);
  if (path.basename(setup) !== `Neural-Setup-${version}.exe`) throw new Error(`the setup ${path.basename(setup)} is not version ${version}'s`);
  const s = section(fs.readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8"), version);
  if (!s) throw new Error(`CHANGELOG.md has no section for ${version} (## ${version} "Codename" (date))`);
  const sha256 = crypto.createHash("sha256").update(fs.readFileSync(setup)).digest("hex").toUpperCase();
  const runUrl = env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : "";
  const text = notes({ version, codename: s.codename, body: s.body, sha256, runUrl });
  const title = `v${version} · ${s.codename}`;
  if (arg("notes")) fs.writeFileSync(arg("notes"), text);
  if (arg("title")) fs.writeFileSync(arg("title"), title);
  return { title, text, sha256 };
}

module.exports = { section, notes, main };

if (require.main === module) {
  try {
    const r = main(process.argv.slice(2));
    console.log(r.title);
    console.log(`SHA-256: ${r.sha256}`);
  } catch (e) {
    console.error(`release-notes: ${e.message}`);
    process.exit(1);
  }
}
