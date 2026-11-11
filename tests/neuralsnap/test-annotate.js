"use strict";
// NeuralSnap's picture logic (apps\neuralsnap\annotate.js), with plain Node: cropping and the colour order of grabs,
// capture file names, rectangles and windows, pixelation, arrows, freehand paths, bounds and hit tests, drawing (on a
// recording fake canvas) and the undo history.
//   node tests\neuralsnap\test-annotate.js
const Kit = require("../../apps/neuralsnap/annotate");

let passed = 0, failed = 0;
const check = (cond, label, extra = "") => { if (cond) { passed++; console.log("  ok   " + label); } else { failed++; console.log("  FAIL " + label + (extra ? "  -> " + extra : "")); } };
const j = (x) => JSON.stringify(x);

// A test picture: every pixel's colour says where it is (R = x, G = y, B = x ^ y, A = 255).
function picture(W, H) {
  const p = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; p[i] = x & 255; p[i + 1] = y & 255; p[i + 2] = (x ^ y) & 255; p[i + 3] = 255; }
  return p;
}
const px = (p, W, x, y) => [...p.subarray((y * W + x) * 4, (y * W + x) * 4 + 4)];

console.log("crop and colour order");
{
  const W = 50, H = 40, src = picture(W, H);
  const r = { x: 7, y: 5, w: 20, h: 9 };
  const c = Kit.crop(src, W, H, r);
  let same = c.length === r.w * r.h * 4;
  for (let y = 0; y < r.h && same; y++) for (let x = 0; x < r.w && same; x++) same = j(px(c, r.w, x, y)) === j(px(src, W, r.x + x, r.y + y));
  check(same, "crop copies exactly the rectangle, row by row");
  const whole = Kit.crop(src, W, H, { x: 0, y: 0, w: W, h: H });
  check(Buffer.compare(Buffer.from(whole), Buffer.from(src)) === 0, "a crop of the whole picture is the picture");
  const buf = Buffer.from(src); // main.js crops Node Buffers too
  check(Buffer.compare(Buffer.from(Kit.crop(buf, W, H, r)), Buffer.from(c)) === 0, "it works on a Buffer as well");
  const bgra = Kit.swapRB(new Uint8Array([10, 20, 30, 40, 1, 2, 3, 4]));
  check(j([...bgra]) === j([30, 20, 10, 40, 3, 2, 1, 4]), "swapRB swaps red and blue, keeps green and alpha");
  check(j([...Kit.swapRB(new Uint8Array([10, 20, 30, 0]), true)]) === j([30, 20, 10, 255]), "opaque: alpha becomes 255 (GDI leaves it undefined)");
  const odd = new Uint8Array(9).subarray(1); // not 4-byte aligned
  odd.set([1, 2, 3, 4, 5, 6, 7, 8]);
  check(j([...Kit.swapRB(odd, true)]) === j([3, 2, 1, 255, 7, 6, 5, 255]), "also on an unaligned view");
  check(j([...Kit.swapRB(Kit.swapRB(src))]) === j([...src]), "twice is the original");
}

console.log("rectangles and windows");
check(j(Kit.normRect(30, 40, 10, 5)) === j({ x: 10, y: 5, w: 20, h: 35 }), "normRect: any two corners");
check(j(Kit.clipRect({ x: -5, y: 10, w: 20, h: 100 }, 50, 40)) === j({ x: 0, y: 10, w: 15, h: 30 }), "clipRect keeps the part inside, in whole pixels");
check(Kit.clipRect({ x: 60, y: 0, w: 5, h: 5 }, 50, 40) === null && Kit.clipRect({ x: 5, y: 5, w: 0, h: 5 }, 50, 40) === null, "nothing inside: null");
{
  const wins = [{ x: 10, y: 10, w: 30, h: 20 }, { x: 0, y: 0, w: 100, h: 100 }];
  check(Kit.windowAt(wins, 15, 15) === wins[0] && Kit.windowAt(wins, 50, 50) === wins[1] && Kit.windowAt(wins, 150, 5) === null, "windowAt: the topmost window under the point (z-order, top first)");
  check(Kit.windowAt(wins, 40, 15) === wins[1], "a rectangle's right edge is outside it");
}

console.log("file names");
{
  const d = new Date(2026, 10, 11, 16, 45, 12);
  check(Kit.captureName(d) === "NeuralSnap 2026-11-11 16-45-12.png", "NeuralSnap YYYY-MM-DD HH-MM-SS.png in local time", Kit.captureName(d));
  check(Kit.captureName(new Date(2026, 0, 2, 3, 4, 5)) === "NeuralSnap 2026-01-02 03-04-05.png", "with leading zeros");
  const taken = new Set(["NeuralSnap 2026-11-11 16-45-12.png", "NeuralSnap 2026-11-11 16-45-12 (2).png"]);
  check(Kit.uniqueName(d, (n) => taken.has(n)) === "NeuralSnap 2026-11-11 16-45-12 (3).png", "a name that is taken gets \" (2)\", \" (3)\", …");
  check(Kit.uniqueName(d, () => false) === "NeuralSnap 2026-11-11 16-45-12.png", "a free name stays as it is");
}

console.log("pixelation");
{
  check(Kit.blockSize(100, 60, 0) === 10 && Kit.blockSize(100, 60, 1) === 16 && Kit.blockSize(100, 60, 2) === 24, "block size 10 / 16 / 24 by the width picked");
  check(Kit.blockSize(1000, 600, 0) === 30 && Kit.blockSize(2000, 500, 2) === 25, "at least a twentieth of the shorter side");
  const W = 64, H = 48, src = picture(W, H);
  const r = { x: 4, y: 6, w: 33, h: 21 };
  const b = 10;
  const out = Kit.pixelate(src, W, H, r, b);
  check(out.length === r.w * r.h * 4 && out instanceof Uint8ClampedArray, "the area's size, as canvas pixels");
  // each block is the exact average of the original pixels under it
  let exact = true;
  for (let by = 0; by < r.h && exact; by += b) for (let bx = 0; bx < r.w && exact; bx += b) {
    const bw = Math.min(b, r.w - bx), bh = Math.min(b, r.h - by);
    const sum = [0, 0, 0, 0];
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) px(src, W, r.x + bx + x, r.y + by + y).forEach((v, k) => { sum[k] += v; });
    const want = sum.map((s) => Math.round(s / (bw * bh)));
    for (let y = 0; y < bh && exact; y++) for (let x = 0; x < bw && exact; x++) exact = j(px(out, r.w, bx + x, by + y)) === j(want);
  }
  check(exact, "every block is the average colour of the original pixels under it (partial blocks at the edges too)");
  const colours = new Set();
  for (let i = 0; i < out.length; i += 4) colours.add((out[i] << 16) | (out[i + 1] << 8) | out[i + 2]);
  check(colours.size <= Math.ceil(r.w / b) * Math.ceil(r.h / b), `few distinct colours: ${colours.size} for ${Math.ceil(r.w / b) * Math.ceil(r.h / b)} blocks`);
  let differs = 0;
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) if (j(px(out, r.w, x, y)) !== j(px(src, W, r.x + x, r.y + y))) differs++;
  check(differs > r.w * r.h * 0.9, "almost every pixel differs from the original");
  const again = Kit.pixelate(src, W, H, r, b);
  check(Buffer.compare(Buffer.from(again), Buffer.from(out)) === 0, "the same area gives the same blocks (it only depends on the capture)");
}

console.log("arrows and paths");
{
  const h1 = Kit.arrowHead(0, 0, 100, 0, 3), h2 = Kit.arrowHead(0, 0, 100, 0, 12);
  check(h1.tip[0] === 100 && h1.tip[1] === 0 && h1.base[1] === 0 && h1.base[0] < 100, "the head's tip is the end point, its base on the line");
  check(h2.length > h1.length && Math.abs(h2.left[1] - h2.right[1]) > Math.abs(h1.left[1] - h1.right[1]), "a thicker arrow has a bigger head", j([h1.length, h2.length]));
  const short = Kit.arrowHead(0, 0, 5, 0, 12);
  check(short.length <= 5, "a short arrow's head is never longer than the arrow");
  const pts = [[0, 0], [0.2, 0], [0.4, 0.1], [5, 5], [5.1, 5], [10, 10]];
  const th = Kit.thin(pts, 1);
  check(th[0] === pts[0] && th[th.length - 1] === pts[pts.length - 1] && th.length === 3, "thin drops points closer than the minimum, keeps both ends", j(th));
  const path = Kit.smoothPath([[0, 0], [10, 0], [10, 10], [20, 10]]);
  check(path[0][0] === "M" && path.slice(1, -1).every((s) => s[0] === "Q") && path[path.length - 1][0] === "L" && j(path[path.length - 1]) === j(["L", 20, 10]), "smoothPath: a move, quadratic curves through the middles, a line to the end", j(path));
  check(j(Kit.smoothPath([[1, 2], [3, 4]])) === j([["M", 1, 2], ["L", 3, 4]]), "two points: a straight line");
}

console.log("bounds, hit tests, moving");
{
  const arrow = { type: "arrow", x1: 10, y1: 10, x2: 110, y2: 10, color: "#fff", width: 4 };
  const rect = { type: "rect", x: 20, y: 20, w: 60, h: 40, color: "#fff", width: 6 };
  const pen = { type: "pen", points: [[0, 100], [50, 100], [50, 150]], color: "#fff", width: 6 };
  const hl = { type: "highlight", points: [[200, 200], [300, 200]], color: "#ff0", width: 26 };
  const text = { type: "text", x: 150, y: 30, text: "NEO", color: "#fff", size: 32, w: 70, h: 40 };
  const pix = { type: "pixelate", x: 100, y: 100, w: 50, h: 30, block: 10 };
  check(Kit.hitTest(arrow, 60, 11, 2) && Kit.hitTest(arrow, 108, 10, 0) && !Kit.hitTest(arrow, 60, 30, 2), "arrow: on the line and in the head, not beside it");
  check(Kit.hitTest(rect, 20, 40, 1) && Kit.hitTest(rect, 50, 61, 1) && !Kit.hitTest(rect, 50, 40, 1), "rectangle: its outline, not its inside (what is inside stays clickable)");
  check(Kit.hitTest(pen, 50, 125, 1) && !Kit.hitTest(pen, 25, 125, 1), "pen: along the stroke");
  check(Kit.hitTest(hl, 250, 210, 0) && !Kit.hitTest(hl, 250, 220, 0), "highlighter: its width counts");
  check(Kit.hitTest(text, 160, 50, 0) && !Kit.hitTest(text, 240, 50, 0) && Kit.hitTest(pix, 140, 120, 0), "text and pixelated area: anywhere inside");
  const b = Kit.bounds(rect);
  check(j(b) === j({ x: 17, y: 17, w: 66, h: 46 }), "a rectangle's bounds include its stroke", j(b));
  const pb = Kit.bounds(pen);
  check(j(pb) === j({ x: -3, y: 97, w: 56, h: 56 }), "a stroke's bounds", j(pb));
  const list = [pix, rect, text];
  check(Kit.topAt(list, 120, 120, 2) === 0, "topAt finds the pixelated area");
  const over = { type: "rect", x: 95, y: 95, w: 60, h: 40, color: "#fff", width: 10 };
  check(j(Kit.drawOrder([over, pix])) === j([1, 0]) && Kit.topAt([over, pix], 100, 110, 2) === 0, "pixelated areas are drawn first, so what lies over them is on top");
  check(Kit.topAt(list, 400, 400, 2) === -1, "nothing there: -1");
  const m = Kit.move(arrow, 5.04, -2);
  check(m !== arrow && m.x1 === 15 && m.y1 === 8 && m.x2 === 115 && arrow.x1 === 10, "move: a moved copy, the original untouched");
  check(j(Kit.move(pen, 1, 1).points) === j([[1, 101], [51, 101], [51, 151]]), "a stroke moves with all its points");
  check(Kit.move(pix, 2.6, 0.4).x === 103 && Kit.move(pix, 2.6, 0.4).y === 100, "a pixelated area stays on whole pixels");
}

console.log("drawing (on a recording canvas)");
{
  const calls = [];
  const ctx = new Proxy({ state: {} }, {
    get(t, k) {
      if (k in t.state) return t.state[k];
      if (k === "measureText") return (s) => ({ width: s.length * 10 });
      return (...a) => calls.push([k, ...a]);
    },
    set(t, k, v) { t.state[k] = v; calls.push(["set", k, v]); return true; },
  });
  const pix = { type: "pixelate", x: 5, y: 6, w: 7, h: 8, block: 10 };
  const marker = { tag: "pixels" };
  const list = [{ type: "rect", x: 1, y: 2, w: 3, h: 4, color: "#ff2a4f", width: 6 }, pix, { type: "highlight", points: [[0, 0], [10, 0]], color: "#fcee0a", width: 14 }, { type: "text", x: 0, y: 0, text: "A\nBC", color: "#06060b", size: 20 }];
  Kit.render(ctx, list, { pixels: (a) => (a === pix ? marker : null) });
  const names = calls.map((c) => c[0]);
  const first = names.indexOf("drawImage");
  check(first >= 0 && first < names.indexOf("strokeRect") && calls[first][1] === marker && j(calls[first].slice(2)) === j([5, 6, 7, 8]), "the pixelated area is drawn first, from what pixels() gives, at its place");
  check(calls.some((c) => c[0] === "set" && c[1] === "imageSmoothingEnabled" && c[2] === false), "without smoothing (blocks stay sharp)");
  check(calls.some((c) => c[0] === "set" && c[1] === "globalAlpha" && c[2] === Kit.HIGHLIGHT_ALPHA) && calls.some((c) => c[0] === "set" && c[1] === "globalCompositeOperation" && c[2] === "multiply"), "the highlighter: about 35 % alpha, multiplied");
  const hl = calls.findIndex((c) => c[0] === "set" && c[1] === "globalCompositeOperation" && c[2] === "screen");
  check(hl > 0 && calls.slice(hl).findIndex((c) => c[0] === "stroke") >= 0 && calls.some((c) => c[0] === "set" && c[1] === "globalAlpha" && c[2] === Kit.HIGHLIGHT_GLOW), "then the same stroke again, faintly screened (so it shows on dark pages too)");
  const texts = calls.filter((c) => c[0] === "fillText");
  check(texts.length === 2 && texts[0][1] === "A" && texts[1][1] === "BC" && texts[1][3] > texts[0][3], "a text: one line after another");
  check(calls.filter((c) => c[0] === "strokeText").length === 2 && calls.some((c) => c[0] === "set" && c[1] === "strokeStyle" && c[2] === "#ebe8d8"), "with an outline (light for black text, dark otherwise)");
  check(calls.filter((c) => c[0] === "save").length === calls.filter((c) => c[0] === "restore").length && calls.filter((c) => c[0] === "save").length === 4, "every annotation in its own save/restore");
  const n = calls.length;
  Kit.render(ctx, list, { pixels: () => null, skip: 3 });
  check(!calls.slice(n).some((c) => c[0] === "fillText"), "skip leaves one out (the text being edited)");
  const m = Kit.measureText(ctx, { type: "text", text: "AB\nCDEF", size: 20 });
  check(m.w >= 40 && m.h >= 2 * Kit.lineHeight(20), "measureText: the widest line, every line", j(m));
}

console.log("history");
{
  const h = new Kit.History([]);
  check(!h.canUndo && !h.canRedo && !h.dirty, "starts clean, nothing to undo");
  h.commit([{ type: "rect", x: 1 }]);
  h.commit([{ type: "rect", x: 1 }, { type: "arrow", x1: 2 }]);
  check(h.canUndo && h.dirty && h.state.length === 2, "each change is a step");
  check(h.commit(h.state) === false, "the same state again is not a step");
  check(h.undo().length === 1 && h.undo().length === 0 && !h.canUndo && h.canRedo && !h.dirty, "undo back to the start (clean again)");
  check(h.redo().length === 1 && h.dirty, "redo");
  h.markSaved();
  check(!h.dirty, "saved: clean");
  h.commit([{ type: "pen" }]);
  check(h.dirty && !h.canRedo, "a new change after an undo drops the redo steps");
  h.undo();
  check(!h.dirty, "undoing it comes back to the saved step");
  const s = h.state;
  s.push({ type: "x" });
  check(h.state.length === 1, "a state handed out is a copy");
  const small = new Kit.History([], 3);
  for (let i = 1; i <= 5; i++) small.commit([i]);
  check(small.steps.length === 3 && j(small.state) === j([5]) && j(small.undo()) === j([4]) && j(small.undo()) === j([3]) && !small.canUndo, "the oldest steps go beyond the limit");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
