"use strict";
// NeuralView VW-3 image metadata: the format and size from the file's own header, EXIF (camera, exposure, GPS) from
// JPEG, PNG and WebP files, and lossless JPEG rotation through the EXIF orientation tag. Plain Node, no dependencies;
// every read is bounds-checked, because the bytes come from arbitrary files.

const FORMATS = {
  jpeg: "JPEG", png: "PNG", gif: "GIF", webp: "WebP", bmp: "BMP", ico: "ICO", svg: "SVG", avif: "AVIF", heic: "HEIC",
};

/* ---------- format and dimensions ---------- */
function sniff(b) {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 8 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a) return "png";
  if (b.length >= 6 && b.toString("latin1", 0, 6).match(/^GIF8[79]a$/)) return "gif";
  if (b.length >= 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return "webp";
  if (b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d) return "bmp";
  if (b.length >= 4 && b.readUInt32BE(0) === 0x00000100) return "ico";
  if (b.length >= 12 && b.toString("latin1", 4, 8) === "ftyp") {
    const brands = b.toString("latin1", 8, Math.min(b.length, 64));
    if (/avi[fs]/.test(brands)) return "avif";
    if (/hei[cfsx]|mif1|msf1|heim|hevc/.test(brands)) return "heic";
  }
  const head = b.toString("utf8", 0, Math.min(b.length, 1024)).replace(/^﻿/, "").trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head)) return "svg";
  return null;
}

function jpegSize(b) {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m === 0xff) { i++; continue; }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    if (m === 0xd9 || m === 0xda) break;
    const len = b.readUInt16BE(i + 2);
    // SOF0-SOF15 except DHT (C4), JPG (C8) and DAC (CC)
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
    i += 2 + len;
  }
  return null;
}

function webpInfo(b) {
  const out = { width: 0, height: 0, animated: false, exif: null };
  for (let i = 12; i + 8 <= b.length;) {
    const id = b.toString("latin1", i, i + 4);
    const len = b.readUInt32LE(i + 4);
    const d = i + 8;
    if (d + len > b.length) break;
    if (id === "VP8X" && len >= 10) {
      out.animated = !!(b[d] & 0x02);
      out.width = 1 + b.readUIntLE(d + 4, 3);
      out.height = 1 + b.readUIntLE(d + 7, 3);
    } else if (id === "VP8 " && len >= 10 && !out.width) {
      out.width = b.readUInt16LE(d + 6) & 0x3fff;
      out.height = b.readUInt16LE(d + 8) & 0x3fff;
    } else if (id === "VP8L" && len >= 5 && !out.width) {
      const bits = b.readUInt32LE(d + 1);
      out.width = (bits & 0x3fff) + 1;
      out.height = ((bits >> 14) & 0x3fff) + 1;
    } else if (id === "EXIF") {
      out.exif = b.subarray(d, d + len);
    }
    i = d + len + (len & 1);
  }
  return out;
}

// Counts the image descriptors of a GIF, skipping its color tables and data sub-blocks.
function gifFrames(b) {
  if (b.length < 13) return 0;
  let i = 13;
  if (b[10] & 0x80) i += 3 * (2 << (b[10] & 7));
  let frames = 0;
  const skipBlocks = () => { while (i < b.length && b[i] !== 0) i += b[i] + 1; i++; };
  while (i < b.length) {
    const t = b[i];
    if (t === 0x2c) {
      frames++;
      if (i + 10 > b.length) break;
      const packed = b[i + 9];
      i += 10;
      if (packed & 0x80) i += 3 * (2 << (packed & 7));
      i++; // LZW minimum code size
      skipBlocks();
    } else if (t === 0x21) {
      i += 2;
      skipBlocks();
    } else break; // 0x3B trailer or garbage
    if (frames > 1) break; // only "animated or not" matters
  }
  return frames;
}

function svgSize(b) {
  const head = b.toString("utf8", 0, Math.min(b.length, 4096));
  const tag = head.match(/<svg\b[^>]*>/i);
  if (!tag) return null;
  const attr = (n) => { const m = tag[0].match(new RegExp(`\\s${n}\\s*=\\s*["']\\s*([\\d.]+)(px)?\\s*["']`, "i")); return m ? parseFloat(m[1]) : 0; };
  let width = attr("width"), height = attr("height");
  const vb = tag[0].match(/viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  if ((!width || !height) && vb) { width = width || parseFloat(vb[1]); height = height || parseFloat(vb[2]); }
  return width && height ? { width: Math.round(width), height: Math.round(height) } : null;
}

function headerSize(fmt, b) {
  try {
    switch (fmt) {
      case "jpeg": return jpegSize(b);
      case "png": return b.length >= 24 ? { width: b.readUInt32BE(16), height: b.readUInt32BE(20) } : null;
      case "gif": return b.length >= 10 ? { width: b.readUInt16LE(6), height: b.readUInt16LE(8) } : null;
      case "bmp": return b.length >= 26 ? { width: Math.abs(b.readInt32LE(18)), height: Math.abs(b.readInt32LE(22)) } : null;
      case "ico": { // the largest picture of the icon, the one a viewer shows
        let best = null;
        for (let k = 0, n = b.readUInt16LE(4); k < n && 6 + k * 16 + 16 <= b.length; k++) {
          const width = b[6 + k * 16] || 256, height = b[7 + k * 16] || 256;
          if (!best || width * height > best.width * best.height) best = { width, height };
        }
        return best;
      }
      case "svg": return svgSize(b);
      case "avif":
      case "heic": { // the image spatial extents property of the primary item
        const at = b.indexOf("ispe", 0, "latin1");
        return at > 0 && at + 16 <= b.length ? { width: b.readUInt32BE(at + 8), height: b.readUInt32BE(at + 12) } : null;
      }
      default: return null;
    }
  } catch (e) { return null; }
}

/* ---------- TIFF / EXIF ---------- */
const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };
const MAX_ENTRIES = 512;

// The TIFF structure inside an EXIF block: byte order, IFD0 and the EXIF and GPS sub-IFDs.
class Tiff {
  constructor(buf) {
    this.b = buf;
    const bo = buf.toString("latin1", 0, 2);
    if (bo !== "II" && bo !== "MM") throw new Error("not TIFF");
    this.le = bo === "II";
    if (this.u16(2) !== 42) throw new Error("not TIFF");
  }
  u16(o) { return this.le ? this.b.readUInt16LE(o) : this.b.readUInt16BE(o); }
  u32(o) { return this.le ? this.b.readUInt32LE(o) : this.b.readUInt32BE(o); }
  i32(o) { return this.le ? this.b.readInt32LE(o) : this.b.readInt32BE(o); }
  ifd(offset) {
    const tags = new Map();
    if (!offset || offset + 2 > this.b.length) return tags;
    const n = Math.min(this.u16(offset), MAX_ENTRIES);
    for (let k = 0; k < n; k++) {
      const e = offset + 2 + k * 12;
      if (e + 12 > this.b.length) break;
      const tag = this.u16(e), type = this.u16(e + 2), count = this.u32(e + 4);
      const size = (TYPE_SIZE[type] || 0) * count;
      if (!size || size > 1 << 20) continue;
      const at = size <= 4 ? e + 8 : this.u32(e + 8);
      if (at + size > this.b.length) continue;
      tags.set(tag, { type, count, at, entry: e });
    }
    return tags;
  }
  value(t) {
    if (!t) return undefined;
    const { type, count, at } = t;
    const one = (o) => {
      switch (type) {
        case 1: case 7: return this.b[o];
        case 6: return this.b.readInt8(o);
        case 3: return this.u16(o);
        case 8: return this.le ? this.b.readInt16LE(o) : this.b.readInt16BE(o);
        case 4: return this.u32(o);
        case 9: return this.i32(o);
        case 5: { const d = this.u32(o + 4); return d ? this.u32(o) / d : 0; }
        case 10: { const d = this.i32(o + 4); return d ? this.i32(o) / d : 0; }
        default: return undefined;
      }
    };
    if (type === 2) return this.b.toString("latin1", at, at + count).replace(/\0[\s\S]*$/, "").trim();
    if (count === 1) return one(at);
    const out = [];
    for (let k = 0; k < Math.min(count, 64); k++) out.push(one(at + k * TYPE_SIZE[type]));
    return out;
  }
}

const utf8 = (s) => (typeof s === "string" ? Buffer.from(s, "latin1").toString("utf8") : s);

// EXIF from a TIFF block (a leading "Exif\0\0" is skipped). Returns null when there is nothing readable.
function parseExif(block) {
  if (!block || block.length < 8) return null;
  if (block.toString("latin1", 0, 6) === "Exif\0\0") block = block.subarray(6);
  let t;
  try { t = new Tiff(block); } catch (e) { return null; }
  const ifd0 = t.ifd(t.u32(4));
  const v = (ifd, tag) => t.value(ifd.get(tag));
  const exifIfd = t.ifd(v(ifd0, 0x8769));
  const gpsIfd = t.ifd(v(ifd0, 0x8825));
  const out = {
    make: utf8(v(ifd0, 0x010f)), model: utf8(v(ifd0, 0x0110)), orientation: v(ifd0, 0x0112),
    software: utf8(v(ifd0, 0x0131)), artist: utf8(v(ifd0, 0x013b)), copyright: utf8(v(ifd0, 0x8298)),
    description: utf8(v(ifd0, 0x010e)), modified: v(ifd0, 0x0132),
    taken: v(exifIfd, 0x9003), exposure: v(exifIfd, 0x829a), fNumber: v(exifIfd, 0x829d), iso: v(exifIfd, 0x8827),
    focal: v(exifIfd, 0x920a), focal35: v(exifIfd, 0xa405), flash: v(exifIfd, 0x9209), lens: utf8(v(exifIfd, 0xa434)),
    gps: null,
  };
  if (Array.isArray(out.iso)) out.iso = out.iso[0];
  const coord = (val, ref) => {
    if (!Array.isArray(val) || val.length < 3 || val.some((x) => !Number.isFinite(x))) return null;
    const d = val[0] + val[1] / 60 + val[2] / 3600;
    return /^[SW]/i.test(String(ref || "")) ? -d : d;
  };
  if (gpsIfd.size) {
    const lat = coord(v(gpsIfd, 0x0002), v(gpsIfd, 0x0001));
    const lon = coord(v(gpsIfd, 0x0004), v(gpsIfd, 0x0003));
    const altRaw = v(gpsIfd, 0x0006);
    const alt = Number.isFinite(altRaw) ? (v(gpsIfd, 0x0005) === 1 ? -altRaw : altRaw) : null;
    // Any GPS directory counts as location data, even one without readable coordinates.
    out.gps = { lat, lon, alt };
  }
  for (const k of Object.keys(out)) if (out[k] === undefined || out[k] === null || out[k] === "") delete out[k];
  return Object.keys(out).length ? out : null;
}

// The EXIF block of a JPEG: { start, end } of the APP1 segment and the TIFF data inside it.
function jpegExifSegment(b) {
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1];
    if (m === 0xff) { i++; continue; }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    if (m === 0xda || m === 0xd9) return null;
    const len = b.readUInt16BE(i + 2);
    if (m === 0xe1 && len >= 8 && b.toString("latin1", i + 4, i + 10) === "Exif\0\0") {
      return { start: i, end: i + 2 + len, tiff: b.subarray(i + 10, Math.min(b.length, i + 2 + len)) };
    }
    i += 2 + len;
  }
  return null;
}

function pngExif(b) {
  for (let i = 8; i + 12 <= b.length;) {
    const len = b.readUInt32BE(i);
    const id = b.toString("latin1", i + 4, i + 8);
    if (id === "eXIf" && i + 8 + len <= b.length) return b.subarray(i + 8, i + 8 + len);
    if (id === "IEND") break;
    i += 12 + len;
  }
  return null;
}

/* ---------- everything the info panel shows ---------- */
function readMeta(buf) {
  const fmt = sniff(buf);
  const out = { format: fmt ? FORMATS[fmt] : null, kind: fmt, width: 0, height: 0, animated: false, exif: null };
  if (!fmt) return out;
  const size = headerSize(fmt, buf);
  if (size) Object.assign(out, size);
  try {
    if (fmt === "jpeg") { const s = jpegExifSegment(buf); if (s) out.exif = parseExif(s.tiff); }
    else if (fmt === "png") { out.exif = parseExif(pngExif(buf)); out.animated = buf.includes("acTL", 8, "latin1") && buf.indexOf("acTL", 8, "latin1") < buf.indexOf("IDAT", 8, "latin1"); }
    else if (fmt === "webp") { const w = webpInfo(buf); Object.assign(out, { width: w.width, height: w.height, animated: w.animated }); out.exif = parseExif(w.exif); }
    else if (fmt === "gif") out.animated = gifFrames(buf) > 1;
  } catch (e) { /* damaged metadata: show what the header gave */ }
  return out;
}

/* ---------- lossless JPEG rotation (EXIF orientation) ---------- */
// Orientation n displays the stored pixels as: flip horizontally if f, then rotate k quarter turns clockwise.
const ORIENT_FK = { 1: [0, 0], 2: [1, 0], 3: [0, 2], 4: [1, 2], 5: [1, 3], 6: [0, 1], 7: [1, 1], 8: [0, 3] };
function rotateOrientation(orientation, quarterTurns) {
  const [f, k] = ORIENT_FK[orientation] || ORIENT_FK[1];
  const k2 = (((k + quarterTurns) % 4) + 4) % 4;
  return Number(Object.keys(ORIENT_FK).find((n) => ORIENT_FK[n][0] === f && ORIENT_FK[n][1] === k2));
}

function jpegOrientation(b) {
  const s = jpegExifSegment(b);
  const e = s && parseExif(s.tiff);
  return (e && ORIENT_FK[e.orientation]) ? e.orientation : 1;
}

// A JPEG with its orientation set to `value`. The pixels are not touched. An existing tag is changed in place; a
// missing one is added with a rewritten IFD0 at the end of the EXIF block (the old one stays, unreferenced, so no
// other offset moves); a file without EXIF gets a minimal APP1 segment after its JFIF/APP0 header.
function setJpegOrientation(b, value) {
  if (sniff(b) !== "jpeg") throw new Error("not a JPEG file");
  const s = jpegExifSegment(b);
  if (s) {
    const t = new Tiff(Buffer.from(s.tiff));
    const ifd0At = t.u32(4);
    const ifd0 = t.ifd(ifd0At);
    const tag = ifd0.get(0x0112);
    const tiff = t.b;
    if (tag && (tag.type === 3 || tag.type === 4) && tag.count >= 1) {
      if (tag.type === 3) (t.le ? tiff.writeUInt16LE(value, tag.at) : tiff.writeUInt16BE(value, tag.at));
      else (t.le ? tiff.writeUInt32LE(value, tag.at) : tiff.writeUInt32BE(value, tag.at));
      return Buffer.concat([b.subarray(0, s.start + 10), tiff, b.subarray(s.start + 10 + tiff.length)]);
    }
    // Copy IFD0 with one more entry (entries stay sorted by tag) to the end of the TIFF data.
    const n = Math.min(t.u16(ifd0At), MAX_ENTRIES);
    if (ifd0At + 2 + n * 12 + 4 > tiff.length) throw new Error("damaged EXIF data");
    const entries = [];
    for (let k = 0; k < n; k++) entries.push(tiff.subarray(ifd0At + 2 + k * 12, ifd0At + 14 + k * 12));
    const extra = Buffer.alloc(12);
    const w16 = (buf, v, o) => (t.le ? buf.writeUInt16LE(v, o) : buf.writeUInt16BE(v, o));
    const w32 = (buf, v, o) => (t.le ? buf.writeUInt32LE(v, o) : buf.writeUInt32BE(v, o));
    w16(extra, 0x0112, 0); w16(extra, 3, 2); w32(extra, 1, 4); w16(extra, value, 8);
    const tagOf = (e) => (t.le ? e.readUInt16LE(0) : e.readUInt16BE(0));
    const pos = entries.findIndex((e) => tagOf(e) > 0x0112);
    entries.splice(pos < 0 ? entries.length : pos, 0, extra);
    const pad = tiff.length & 1;
    const at = tiff.length + pad;
    const ifd = Buffer.alloc(2 + entries.length * 12 + 4);
    w16(ifd, entries.length, 0);
    entries.forEach((e, k) => e.copy(ifd, 2 + k * 12));
    tiff.copy(ifd, 2 + entries.length * 12, ifd0At + 2 + n * 12, ifd0At + 2 + n * 12 + 4); // next IFD (thumbnail)
    const header = Buffer.from(tiff.subarray(0, 8));
    w32(header, at, 4);
    const newTiff = Buffer.concat([header, tiff.subarray(8), Buffer.alloc(pad), ifd]);
    if (newTiff.length + 8 > 0xffff) throw new Error("EXIF block too large");
    const seg = Buffer.alloc(10);
    seg.writeUInt16BE(0xffe1, 0); seg.writeUInt16BE(newTiff.length + 8, 2); seg.write("Exif\0\0", 4, "latin1");
    return Buffer.concat([b.subarray(0, s.start), seg, newTiff, b.subarray(s.end)]);
  }
  // No EXIF: big-endian TIFF with one IFD0 entry.
  const tiff = Buffer.alloc(8 + 2 + 12 + 4);
  tiff.write("MM", 0, "latin1"); tiff.writeUInt16BE(42, 2); tiff.writeUInt32BE(8, 4);
  tiff.writeUInt16BE(1, 8);
  tiff.writeUInt16BE(0x0112, 10); tiff.writeUInt16BE(3, 12); tiff.writeUInt32BE(1, 14); tiff.writeUInt16BE(value, 18);
  const seg = Buffer.alloc(10);
  seg.writeUInt16BE(0xffe1, 0); seg.writeUInt16BE(tiff.length + 8, 2); seg.write("Exif\0\0", 4, "latin1");
  let at = 2;
  if (b[2] === 0xff && b[3] === 0xe0) at = 4 + b.readUInt16BE(4); // keep JFIF first
  return Buffer.concat([b.subarray(0, at), seg, tiff, b.subarray(at)]);
}

/* ---------- 24/32-bit BMP from RGBA pixels (for saving a rotated BMP) ---------- */
function encodeBmp(width, height, rgba) {
  const opaque = (() => { for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 255) return false; return true; })();
  const bpp = opaque ? 24 : 32;
  const stride = Math.ceil((width * bpp) / 32) * 4;
  const headerSize = opaque ? 40 : 108; // BITMAPINFOHEADER, or BITMAPV4HEADER with an alpha mask
  const offset = 14 + headerSize;
  const out = Buffer.alloc(offset + stride * height);
  out.write("BM", 0, "latin1");
  out.writeUInt32LE(out.length, 2);
  out.writeUInt32LE(offset, 10);
  out.writeUInt32LE(headerSize, 14);
  out.writeInt32LE(width, 18);
  out.writeInt32LE(height, 22); // bottom-up
  out.writeUInt16LE(1, 26);
  out.writeUInt16LE(bpp, 28);
  out.writeUInt32LE(opaque ? 0 : 3, 30); // BI_RGB or BI_BITFIELDS
  out.writeUInt32LE(stride * height, 34);
  out.writeInt32LE(2835, 38); out.writeInt32LE(2835, 42); // 72 dpi
  if (!opaque) {
    out.writeUInt32LE(0x00ff0000, 54); out.writeUInt32LE(0x0000ff00, 58); out.writeUInt32LE(0x000000ff, 62); out.writeUInt32LE(0xff000000, 66);
    out.write("BGRs", 70, "latin1"); // LCS_sRGB
  }
  for (let y = 0; y < height; y++) {
    let o = offset + (height - 1 - y) * stride;
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      out[o++] = rgba[p + 2]; out[o++] = rgba[p + 1]; out[o++] = rgba[p];
      if (!opaque) out[o++] = rgba[p + 3];
    }
  }
  return out;
}

module.exports = { sniff, readMeta, parseExif, jpegOrientation, setJpegOrientation, rotateOrientation, encodeBmp, FORMATS };
