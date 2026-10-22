"use strict";
// Unit tests of apps\neuralview\meta.js on the generated test images (plain Node: node tests\neuralview\test-meta.js).
const fs = require("fs");
const path = require("path");
const meta = require("../../apps/neuralview/meta");

const FIX = path.join(__dirname, "fixtures");
const read = (name) => fs.readFileSync(path.join(FIX, name));
let passed = 0, failed = 0;
const check = (cond, label, extra = "") => { if (cond) { passed++; console.log("  ok   " + label); } else { failed++; console.log("  FAIL " + label + (extra ? "  -> " + extra : "")); } };
const near = (a, b, eps = 1e-4) => Math.abs(a - b) < eps;

// Removes the EXIF APP1 segment of a JPEG.
function stripExif(b) {
  let i = 2;
  while (i + 4 <= b.length && b[i] === 0xff) {
    const m = b[i + 1], len = b.readUInt16BE(i + 2);
    if (m === 0xe1) return Buffer.concat([b.subarray(0, i), b.subarray(i + 2 + len)]);
    if (m === 0xda) break;
    i += 2 + len;
  }
  return b;
}
// Everything from the first SOS marker on: the compressed pixels.
const scan = (b) => b.subarray(b.indexOf(Buffer.from([0xff, 0xda])));

console.log("formats and sizes");
const expect = {
  "01-galata-gece.jpg": ["JPEG", 1600, 1000], "02-tabela.png": ["PNG", 1000, 640], "03-karakoy-yagmur.webp": ["WebP", 1200, 750],
  "04-sinyal.gif": ["GIF", 96, 60], "05-dikey-yön6.jpg": ["JPEG", 900, 600], "06-devre.bmp": ["BMP", 320, 200],
  "07-amblem.svg": ["SVG", 640, 640], "08-simge.ico": ["ICO", 256, 256], "09-hiz.avif": ["AVIF", 800, 500],
  "10-telefon.heic": ["HEIC", 0, 0], "12 ölçüsüz #1.svg": ["SVG", 400, 300],
};
for (const [name, [fmt, w, h]] of Object.entries(expect)) {
  const m = meta.readMeta(read(name));
  check(m.format === fmt && m.width === w && m.height === h, `${name}: ${fmt} ${w}x${h}`, JSON.stringify({ format: m.format, width: m.width, height: m.height }));
}
check(meta.readMeta(read("04-sinyal.gif")).animated === true, "the two-frame GIF is animated");
check(meta.readMeta(read("02-tabela.png")).animated === false, "a plain PNG is not animated");
check(meta.readMeta(read("notlar.txt")).format === null, "a text file is no image");

console.log("EXIF");
const x = meta.readMeta(read("01-galata-gece.jpg")).exif;
check(x && x.make === "Neural Systems" && x.model === "Neural Systems VW-3 Optik", "camera make and model", JSON.stringify(x));
check(x && near(x.exposure, 1 / 125) && near(x.fNumber, 2.8) && x.iso === 200 && x.focal === 35 && x.focal35 === 52, "exposure, aperture, ISO, focal length");
check(x && x.taken === "2077:10:22 23:41:07" && x.lens === "NS 35mm f/2.8 Siber" && x.flash === 16, "date taken, lens, flash");
check(x && x.gps && near(x.gps.lat, 41.0256) && near(x.gps.lon, 28.9741) && x.gps.alt === 61, "GPS position (Galata Tower)", JSON.stringify(x && x.gps));
check(meta.readMeta(read("05-dikey-yön6.jpg")).exif.orientation === 6, "orientation 6 is read");
check(meta.readMeta(read("02-tabela.png")).exif === null, "no EXIF in the PNG");
// Damaged EXIF must not throw: a TIFF header pointing far outside the block.
const bad = Buffer.from("Exif\0\0MM\0\x2a\x7f\xff\xff\xff", "latin1");
check(meta.parseExif(bad) === null, "an EXIF block with a bad IFD offset gives nothing");

console.log("orientation arithmetic");
const rot = meta.rotateOrientation;
check(rot(1, 1) === 6 && rot(6, 1) === 3 && rot(3, 1) === 8 && rot(8, 1) === 1, "quarter turns clockwise: 1 → 6 → 3 → 8 → 1");
check(rot(1, -1) === 8 && rot(1, 2) === 3 && rot(6, 3) === 1, "counter-clockwise and half turns");
check(rot(2, 1) === 7 && rot(5, 1) === 2 && rot(7, 1) === 4 && rot(4, 1) === 5, "mirrored orientations stay mirrored");

console.log("lossless JPEG rotation");
{ // EXIF with an orientation tag: changed in place
  const src = read("01-galata-gece.jpg");
  const out = meta.setJpegOrientation(src, 6);
  const m = meta.readMeta(out);
  check(out.length === src.length && m.exif.orientation === 6, "existing tag changed in place, size unchanged");
  check(m.exif.gps && near(m.exif.gps.lat, 41.0256) && m.exif.model === "Neural Systems VW-3 Optik", "the other EXIF fields are kept");
  check(scan(out).equals(scan(src)), "compressed pixels untouched");
  check(meta.jpegOrientation(meta.setJpegOrientation(out, 1)) === 1, "and back to 1");
}
{ // no EXIF at all: a new APP1 segment after JFIF
  const src = stripExif(read("01-galata-gece.jpg"));
  check(meta.readMeta(src).exif === null, "(test image without EXIF)");
  const out = meta.setJpegOrientation(src, 8);
  check(meta.jpegOrientation(out) === 8 && out[2] === 0xff && out[3] === 0xe0, "EXIF added, JFIF stays first");
  check(scan(out).equals(scan(src)) && meta.readMeta(out).width === 1600, "pixels and size untouched");
}
{ // EXIF without an orientation tag: IFD0 rewritten at the end of the block, little-endian
  const tiff = Buffer.alloc(8 + 2 + 2 * 12 + 4 + 12);
  tiff.write("II", 0, "latin1"); tiff.writeUInt16LE(42, 2); tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(2, 8);
  tiff.writeUInt16LE(0x010f, 10); tiff.writeUInt16LE(2, 12); tiff.writeUInt32LE(4, 14); tiff.write("ABC\0", 18, "latin1");
  tiff.writeUInt16LE(0x0131, 22); tiff.writeUInt16LE(2, 24); tiff.writeUInt32LE(12, 26); tiff.writeUInt32LE(38, 30);
  tiff.writeUInt32LE(0, 34);
  tiff.write("NeuralTest\0\0", 38, "latin1");
  const seg = Buffer.alloc(10);
  seg.writeUInt16BE(0xffe1, 0); seg.writeUInt16BE(tiff.length + 8, 2); seg.write("Exif\0\0", 4, "latin1");
  const plain = stripExif(read("01-galata-gece.jpg"));
  const at = 4 + plain.readUInt16BE(4);
  const src = Buffer.concat([plain.subarray(0, at), seg, tiff, plain.subarray(at)]);
  const before = meta.readMeta(src).exif;
  check(before && before.make === "ABC" && before.software === "NeuralTest" && !before.orientation, "(test image with EXIF but no orientation)");
  const out = meta.setJpegOrientation(src, 6);
  const after = meta.readMeta(out).exif;
  check(after.orientation === 6 && after.make === "ABC" && after.software === "NeuralTest", "orientation added, other tags kept", JSON.stringify(after));
  check(scan(out).equals(scan(src)), "pixels untouched");
}
let threw = false;
try { meta.setJpegOrientation(read("02-tabela.png"), 6); } catch (e) { threw = true; }
check(threw, "a PNG is refused");

console.log("BMP writer");
{
  const rgba = Buffer.alloc(3 * 2 * 4, 255);
  rgba[0] = 10; rgba[1] = 20; rgba[2] = 30; // top-left pixel
  const b = meta.encodeBmp(3, 2, rgba);
  check(b.toString("latin1", 0, 2) === "BM" && b.readUInt16LE(28) === 24 && b.readUInt32LE(2) === b.length, "opaque pixels: 24-bit BMP");
  const off = b.readUInt32LE(10), stride = 12; // 3 px * 3 bytes = 9, padded to 12
  check(b[off + stride] === 30 && b[off + stride + 1] === 20 && b[off + stride + 2] === 10, "bottom-up rows, BGR order");
  rgba[3] = 128;
  const t = meta.encodeBmp(3, 2, rgba);
  check(t.readUInt16LE(28) === 32 && t.readUInt32LE(14) === 108 && t.readUInt32LE(66) === 0xff000000, "transparency: 32-bit BMP with an alpha mask");
  const m = meta.readMeta(b);
  check(m.format === "BMP" && m.width === 3 && m.height === 2, "read back as 3x2 BMP");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
