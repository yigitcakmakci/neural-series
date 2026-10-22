"use strict";
// Draws the NeuralView test images into tests\neuralview\fixtures: one file per supported format, a JPEG with
// camera and GPS EXIF data, one stored sideways (EXIF orientation 6), a fake HEIC, a damaged PNG and a text file.
// Every picture is generated here (canvas, WebCodecs AV1 for AVIF), so nothing personal or downloaded is involved.
//   node_modules\electron\dist\electron.exe tests\neuralview\make-fixtures.js
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");
const meta = require("../../apps/neuralview/meta");

const OUT = path.join(__dirname, "fixtures");

/* ---------- EXIF (big-endian TIFF) ---------- */
// entries: [tag, type, value]; ASCII takes a string, RATIONAL an array of [numerator, denominator], others numbers.
function tiffBlock(ifds) {
  const SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8 };
  const count = (type, v) => (type === 2 ? Buffer.byteLength(v, "utf8") + 1 : v.length);
  const dataLen = (e) => { const n = SIZE[e[1]] * count(e[1], e[2]); return n > 4 ? n + (n & 1) : 0; };
  const sizes = ifds.map((ifd) => 2 + ifd.length * 12 + 4 + ifd.reduce((s, e) => s + dataLen(e), 0));
  const starts = [];
  let at = 8;
  for (const s of sizes) { starts.push(at); at += s; }
  const b = Buffer.alloc(at);
  b.write("MM", 0, "latin1"); b.writeUInt16BE(42, 2); b.writeUInt32BE(8, 4);
  ifds.forEach((ifd, k) => {
    // Pointer tags to the sub-IFDs are filled in from their positions.
    for (const e of ifd) if (e[2] === "@exif") e[2] = [starts[1]]; else if (e[2] === "@gps") e[2] = [starts[2]];
    let o = starts[k];
    let data = o + 2 + ifd.length * 12 + 4;
    b.writeUInt16BE(ifd.length, o); o += 2;
    for (const [tag, type, v] of ifd) {
      const n = count(type, v);
      b.writeUInt16BE(tag, o); b.writeUInt16BE(type, o + 2); b.writeUInt32BE(n, o + 4);
      const bytes = SIZE[type] * n;
      let w = bytes > 4 ? data : o + 8;
      if (bytes > 4) { b.writeUInt32BE(data, o + 8); data += bytes + (bytes & 1); }
      if (type === 2) b.write(v + "\0", w, "utf8");
      else for (const x of v) {
        if (type === 1) b[w] = x; else if (type === 3) b.writeUInt16BE(x, w); else if (type === 4) b.writeUInt32BE(x, w);
        else { b.writeUInt32BE(x[0], w); b.writeUInt32BE(x[1], w + 4); }
        w += SIZE[type];
      }
      o += 12;
    }
    b.writeUInt32BE(0, o);
  });
  return b;
}
function withExif(jpeg, tiff) {
  const seg = Buffer.alloc(10);
  seg.writeUInt16BE(0xffe1, 0); seg.writeUInt16BE(tiff.length + 8, 2); seg.write("Exif\0\0", 4, "latin1");
  const at = jpeg[3] === 0xe0 ? 4 + jpeg.readUInt16BE(4) : 2;
  return Buffer.concat([jpeg.subarray(0, at), seg, tiff, jpeg.subarray(at)]);
}
// Galata Tower: 41°01'32.16" N, 28°58'26.76" E, a public landmark.
const CAMERA_EXIF = tiffBlock([
  [[0x010f, 2, "Neural Systems"], [0x0110, 2, "Neural Systems VW-3 Optik"], [0x0112, 3, [1]], [0x0131, 2, "NeuralView test"],
    [0x0132, 2, "2077:10:22 23:41:07"], [0x8769, 4, "@exif"], [0x8825, 4, "@gps"]],
  [[0x829a, 5, [[1, 125]]], [0x829d, 5, [[28, 10]]], [0x8827, 3, [200]], [0x9003, 2, "2077:10:22 23:41:07"],
    [0x9209, 3, [16]], [0x920a, 5, [[35, 1]]], [0xa405, 3, [52]], [0xa434, 2, "NS 35mm f/2.8 Siber"]],
  [[0x0000, 1, [2, 3, 0, 0]], [0x0001, 2, "N"], [0x0002, 5, [[41, 1], [1, 1], [3216, 100]]], [0x0003, 2, "E"],
    [0x0004, 5, [[28, 1], [58, 1], [2676, 100]]], [0x0005, 1, [0]], [0x0006, 5, [[61, 1]]]],
]);

/* ---------- GIF (animated, 4 colors, uncompressed LZW: a clear code after every two pixels) ---------- */
function gif(width, height, palette, frames, delayCs) {
  const bytes = [];
  const u16 = (v) => bytes.push(v & 255, v >> 8);
  bytes.push(...Buffer.from("GIF89a", "latin1"));
  u16(width); u16(height);
  bytes.push(0xf1, 0, 0); // global color table, 4 entries
  for (const [r, g, b] of palette) bytes.push(r, g, b);
  bytes.push(0x21, 0xff, 11, ...Buffer.from("NETSCAPE2.0", "latin1"), 3, 1, 0, 0, 0); // loop forever
  for (const px of frames) {
    bytes.push(0x21, 0xf9, 4, 0x04, delayCs & 255, delayCs >> 8, 0, 0);
    bytes.push(0x2c); u16(0); u16(0); u16(width); u16(height); bytes.push(0);
    bytes.push(2); // LZW minimum code size; codes are 3 bits: 0-3 pixels, 4 clear, 5 end
    const codes = [];
    for (let i = 0; i < px.length; i++) { if (i % 2 === 0) codes.push(4); codes.push(px[i]); }
    codes.push(5);
    const data = [];
    let acc = 0, n = 0;
    for (const c of codes) { acc |= c << n; n += 3; while (n >= 8) { data.push(acc & 255); acc >>= 8; n -= 8; } }
    if (n) data.push(acc & 255);
    for (let i = 0; i < data.length; i += 255) { const part = data.slice(i, i + 255); bytes.push(part.length, ...part); }
    bytes.push(0);
  }
  bytes.push(0x3b);
  return Buffer.from(bytes);
}

/* ---------- AVIF: one AV1 key frame in a minimal HEIF container ---------- */
const box = (type, ...parts) => { const body = Buffer.concat(parts); const h = Buffer.alloc(8); h.writeUInt32BE(8 + body.length, 0); h.write(type, 4, "latin1"); return Buffer.concat([h, body]); };
const full = (type, version, flags, ...parts) => { const vf = Buffer.alloc(4); vf.writeUInt32BE((version << 24) | flags, 0); return box(type, vf, ...parts); };
const u8 = (...v) => Buffer.from(v);
const u16b = (v) => { const b = Buffer.alloc(2); b.writeUInt16BE(v, 0); return b; };
const u32b = (v) => { const b = Buffer.alloc(4); b.writeUInt32BE(v, 0); return b; };
const str = (s) => Buffer.from(s, "latin1");
// The OBUs of the key frame without temporal delimiters, and the profile/level from its sequence header.
function av1Obus(chunk) {
  const out = [];
  let profile = 0, level = 0, tier = 0;
  for (let i = 0; i < chunk.length;) {
    const h = chunk[i];
    const type = (h >> 3) & 15, ext = (h >> 2) & 1, hasSize = (h >> 1) & 1;
    let j = i + 1 + ext, size = 0, shift = 0;
    if (!hasSize) throw new Error("AV1 OBU without a size field");
    for (;;) { const b = chunk[j++]; size |= (b & 127) << shift; shift += 7; if (!(b & 128)) break; }
    const end = j + size;
    if (type === 1) { // sequence header: seq_profile(3) still(1) reduced(1) ...
      let bit = j * 8;
      const read = (n) => { let v = 0; for (let k = 0; k < n; k++, bit++) v = (v << 1) | ((chunk[bit >> 3] >> (7 - (bit & 7))) & 1); return v; };
      profile = read(3); read(1);
      if (read(1)) level = read(5);
      else {
        if (read(1)) throw new Error("AV1 timing info is not handled");
        read(1); // initial_display_delay_present_flag (no timing info: not followed by more)
        read(5); read(12); level = read(5); if (level > 7) tier = read(1);
      }
    }
    if (type !== 2) out.push(chunk.subarray(i, end));
    i = end;
  }
  return { data: Buffer.concat(out), profile, level, tier };
}
function avif(width, height, chunk) {
  const { data, profile, level, tier } = av1Obus(chunk);
  const ftyp = box("ftyp", str("avif"), u32b(0), str("avif"), str("mif1"), str("miaf"));
  const metaBox = (offset) => full("meta", 0, 0,
    full("hdlr", 0, 0, u32b(0), str("pict"), Buffer.alloc(12), u8(0)),
    full("pitm", 0, 0, u16b(1)),
    full("iloc", 0, 0, u8(0x44, 0x00), u16b(1), u16b(1), u16b(0), u16b(1), u32b(offset), u32b(data.length)),
    full("iinf", 0, 0, u16b(1), full("infe", 2, 0, u16b(1), u16b(0), str("av01"), u8(0))),
    box("iprp",
      box("ipco",
        full("ispe", 0, 0, u32b(width), u32b(height)),
        box("av1C", u8(0x81, (profile << 5) | level, (tier << 7) | 0x0c, 0)), // 8-bit 4:2:0
        full("pixi", 0, 0, u8(3, 8, 8, 8))),
      full("ipma", 0, 0, u32b(1), u16b(1), u8(3, 0x01, 0x82, 0x03))));
  const offset = ftyp.length + metaBox(0).length + 8;
  return Buffer.concat([ftyp, metaBox(offset), box("mdat", data)]);
}

/* ---------- the pictures, drawn in a hidden page ---------- */
const PAGE = `
const rnd = (() => { let s = 20771022; return () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296); })();
const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; };
const b64 = async (blob) => { const a = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < a.length; i += 32768) s += String.fromCharCode(...a.subarray(i, i + 32768)); return btoa(s); };
const blob = (c, type, q) => new Promise((r) => c.toBlob(r, type, q));

function skyline(g, w, h, opts) {
  const sky = g.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, opts.top); sky.addColorStop(.62, opts.mid); sky.addColorStop(1, '#05070c');
  g.fillStyle = sky; g.fillRect(0, 0, w, h);
  g.fillStyle = opts.sun; g.beginPath(); g.arc(w * .72, h * .3, h * .11, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(5,7,12,.55)'; for (let y = h * .24; y < h * .38; y += h * .022) g.fillRect(w * .6, y, w * .25, h * .006);
  const base = h * .74;
  for (let layer = 0; layer < 2; layer++) {
    let x = -20;
    while (x < w) {
      const bw = 40 + rnd() * 90 * (w / 1600), bh = (layer ? 120 : 200) * (h / 1000) + rnd() * 260 * (h / 1000);
      g.fillStyle = layer ? '#0b0d18' : '#141725';
      g.fillRect(x, base - bh, bw, bh + h);
      for (let wy = base - bh + 10; wy < base - 8; wy += 14) for (let wx = x + 6; wx < x + bw - 8; wx += 12)
        if (rnd() < (layer ? .18 : .1)) { g.fillStyle = rnd() < .7 ? '#fcee0a' : '#00f0ff'; g.globalAlpha = .35 + rnd() * .6; g.fillRect(wx, wy, 5, 7); g.globalAlpha = 1; }
      x += bw + 4;
    }
  }
  // the tower
  const tx = w * .3, tw = w * .05;
  g.fillStyle = '#05070c';
  g.fillRect(tx, base - h * .42, tw, h * .42 + 4);
  g.beginPath(); g.moveTo(tx - 6, base - h * .42); g.lineTo(tx + tw / 2, base - h * .55); g.lineTo(tx + tw + 6, base - h * .42); g.fill();
  g.fillStyle = '#ff2a4f'; g.fillRect(tx + tw / 2 - 3, base - h * .555, 6, 6);
  // water and the grid
  g.fillStyle = '#05070c'; g.fillRect(0, base, w, h - base);
  g.strokeStyle = 'rgba(0,240,255,.35)'; g.lineWidth = 1;
  for (let i = 0; i < 18; i++) { const y = base + (h - base) * Math.pow(i / 18, 1.8); g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  for (let i = -20; i <= 20; i++) { g.beginPath(); g.moveTo(w / 2 + i * 30, base); g.lineTo(w / 2 + i * w * .12, h); g.stroke(); }
  g.fillStyle = '#fcee0a'; g.font = '700 ' + Math.round(h * .045) + 'px "Segoe UI", sans-serif';
  g.fillText(opts.title, w * .05, h * .1);
  g.fillStyle = '#00f0ff'; g.font = Math.round(h * .024) + 'px Consolas, monospace';
  g.fillText(opts.sub, w * .05, h * .1 + h * .045);
}

window.makeAll = async () => {
  const out = {};
  // 1. JPEG, EXIF added in the main process
  { const [c, g] = canvas(1600, 1000); skyline(g, 1600, 1000, { top: '#2a0b3d', mid: '#ff2a4f', sun: '#fcee0a', title: 'NEO-İSTANBUL // GALATA', sub: '23:41 · 2077-10-22 · VW-3' }); out.galata = await b64(await blob(c, 'image/jpeg', .9)); }
  // 2. PNG with transparency: a neon sign
  { const [c, g] = canvas(1000, 640);
    g.lineJoin = 'miter'; g.shadowColor = '#00f0ff'; g.shadowBlur = 24; g.strokeStyle = '#00f0ff'; g.lineWidth = 14;
    g.strokeRect(80, 80, 840, 480);
    g.shadowColor = '#fcee0a'; g.fillStyle = '#fcee0a'; g.font = '700 150px "Segoe UI", sans-serif'; g.textAlign = 'center'; g.fillText('AÇIK', 500, 330);
    g.shadowColor = '#ff2a4f'; g.fillStyle = '#ff2a4f'; g.font = '700 64px Consolas, monospace'; g.fillText('24 / 7 · KARAKÖY', 500, 460);
    out.tabela = await b64(await blob(c, 'image/png')); }
  // 3. WebP: rain over the bridge
  { const [c, g] = canvas(1200, 750); skyline(g, 1200, 750, { top: '#061a2a', mid: '#00818c', sun: '#ff4fd8', title: 'KARAKÖY // YAĞMUR', sub: 'SİNYAL 94% · NEM 88%' });
    g.strokeStyle = 'rgba(200,240,255,.35)'; g.lineWidth = 1.2; for (let i = 0; i < 700; i++) { const x = rnd() * 1300 - 100, y = rnd() * 750; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 8, y + 26); g.stroke(); }
    out.yagmur = await b64(await blob(c, 'image/webp', .9)); }
  // 4. stored sideways: a portrait picture turned a quarter left, shown upright through EXIF orientation 6
  { const [p, pg] = canvas(600, 900); skyline(pg, 600, 900, { top: '#1a0f00', mid: '#fcee0a', sun: '#ff2a4f', title: 'YÖN 6', sub: 'EXIF ile dik durur' });
    const [c, g] = canvas(900, 600); g.translate(0, 600); g.rotate(-Math.PI / 2); g.drawImage(p, 0, 0);
    out.dikey = await b64(await blob(c, 'image/jpeg', .9)); }
  // 5. raw pixels for the BMP (a circuit board)
  { const [c, g] = canvas(320, 200); g.fillStyle = '#0c0d15'; g.fillRect(0, 0, 320, 200);
    g.strokeStyle = '#fcee0a'; g.lineWidth = 3; for (let i = 0; i < 14; i++) { g.beginPath(); let x = rnd() * 320, y = rnd() * 200; g.moveTo(x, y); for (let k = 0; k < 4; k++) { if (k % 2) y = rnd() * 200; else x = rnd() * 320; g.lineTo(x, y); } g.stroke(); }
    g.fillStyle = '#00f0ff'; for (let i = 0; i < 24; i++) g.fillRect(rnd() * 310, rnd() * 190, 10, 10);
    const d = g.getImageData(0, 0, 320, 200); let s = ''; for (let i = 0; i < d.data.length; i += 32768) s += String.fromCharCode(...d.data.subarray(i, i + 32768)); out.devre = btoa(s); }
  // 6. AVIF through WebCodecs (AV1)
  try {
    const [c, g] = canvas(800, 500); skyline(g, 800, 500, { top: '#001a12', mid: '#00f0ff', sun: '#fcee0a', title: 'HIZ // AVIF', sub: 'AV1 · 800×500' });
    const config = { codec: 'av01.0.04M.08', width: 800, height: 500, bitrate: 4000000 };
    const sup = await VideoEncoder.isConfigSupported(config);
    if (!sup.supported) throw new Error('AV1 encoding is not supported');
    const chunks = [];
    const enc = new VideoEncoder({ output: (ch) => { const a = new Uint8Array(ch.byteLength); ch.copyTo(a); chunks.push(a); }, error: (e) => { throw e; } });
    enc.configure(config);
    const f = new VideoFrame(c, { timestamp: 0 });
    enc.encode(f, { keyFrame: true }); f.close();
    await enc.flush(); enc.close();
    let s = ''; for (let i = 0; i < chunks[0].length; i += 32768) s += String.fromCharCode(...chunks[0].subarray(i, i + 32768)); out.avif = btoa(s);
  } catch (e) { out.avifError = String(e && e.message || e); }
  return out;
};
`;

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640" viewBox="0 0 640 640">
  <rect width="640" height="640" fill="#0c0d15"/>
  <path d="M40 40H520L600 120V600H120L40 520Z" fill="none" stroke="#fcee0a" stroke-width="16"/>
  <path d="M160 440L260 260L340 380L400 300L480 440Z" fill="#fcee0a"/>
  <rect x="404" y="176" width="64" height="64" fill="#00f0ff"/>
  <text x="320" y="540" fill="#00f0ff" font-family="Consolas, monospace" font-size="40" text-anchor="middle">NEURAL SYSTEMS</text>
</svg>
`;
const SVG_NO_SIZE = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">
  <rect width="400" height="300" fill="#141725"/>
  <circle cx="200" cy="150" r="90" fill="none" stroke="#ff2a4f" stroke-width="12"/>
  <path d="M150 150h100M200 100v100" stroke="#00f0ff" stroke-width="12"/>
</svg>
`;

app.on("window-all-closed", () => {});
app.whenReady().then(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({ width: 400, height: 300, show: false, webPreferences: { offscreen: true } });
  // WebCodecs needs a secure context, which a file:// page is and a data: URL is not.
  const blank = path.join(require("os").tmpdir(), "neuralview-fixtures.html");
  fs.writeFileSync(blank, "<meta charset=utf-8><body>");
  await win.loadFile(blank);
  await win.webContents.executeJavaScript(PAGE + ";0");
  const r = await win.webContents.executeJavaScript("makeAll()");
  const bin = (k) => Buffer.from(r[k], "base64");
  const put = (name, data) => { fs.writeFileSync(path.join(OUT, name), data); console.log(`${name}: ${data.length} bytes`); };

  put("01-galata-gece.jpg", withExif(bin("galata"), CAMERA_EXIF));
  put("02-tabela.png", bin("tabela"));
  put("03-karakoy-yagmur.webp", bin("yagmur"));
  put("04-sinyal.gif", gif(96, 60, [[12, 13, 21], [252, 238, 10], [0, 240, 255], [255, 42, 79]], [0, 1].map((f) => {
    const px = [];
    for (let y = 0; y < 60; y++) for (let x = 0; x < 96; x++) px.push(((x >> 3) + (y >> 3) + f) % 2 ? (f ? 2 : 1) : (y > 44 ? 3 : 0));
    return px;
  }), 50));
  put("05-dikey-yön6.jpg", meta.setJpegOrientation(bin("dikey"), 6));
  put("06-devre.bmp", meta.encodeBmp(320, 200, bin("devre")));
  put("07-amblem.svg", Buffer.from(SVG, "utf8"));
  put("08-simge.ico", fs.readFileSync(path.join(__dirname, "..", "..", "apps", "neuralview", "neuralview.ico")));
  if (r.avif) put("09-hiz.avif", avif(800, 500, bin("avif")));
  else console.log(`09-hiz.avif: skipped (${r.avifError})`);
  // Not decodable on purpose: a HEIC header with no picture, and a PNG cut short after its header.
  put("10-telefon.heic", Buffer.concat([u32b(24), str("ftypheic"), u32b(0), str("mif1heic"), Buffer.alloc(64, 0x5a)]));
  put("11-bozuk.png", Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(48, 0xee)]));
  put("12 ölçüsüz #1.svg", Buffer.from(SVG_NO_SIZE, "utf8"));
  put("notlar.txt", Buffer.from("Bu bir resim değil; NeuralView listesinde görünmemeli.\r\n", "utf8"));
  win.destroy();
  app.quit();
}).catch((e) => { console.error(e); app.exit(1); });
