/* ============================================================
   NeuralSnap — the picture logic, without Electron or a page: cropping a grab, the file names of captures, the
   annotations (geometry, hit tests, drawing on any 2D canvas context), pixelation and the undo history.
   Coordinates are image pixels everywhere. UMD: main.js requires it, the pages load it with <script> and find
   window.NeuralSnapKit; tests\neuralsnap\test-annotate.js checks it with plain Node.
   ============================================================ */
'use strict';
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NeuralSnapKit = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  /* ---------------- palette and sizes ---------------- */
  const COLORS = [
    { id: 'yellow', hex: '#fcee0a' }, { id: 'cyan', hex: '#00f0ff' }, { id: 'red', hex: '#ff2a4f' },
    { id: 'ink', hex: '#ebe8d8' }, { id: 'black', hex: '#06060b' },
  ];
  // thin / medium / thick, in image pixels
  const WIDTHS = { stroke: [3, 6, 12], highlight: [14, 26, 44], text: [20, 32, 52], block: [10, 16, 24] };
  // The highlighter: multiplied at 35 % (text under it stays dark on light pages), then a faint "screen" pass so it
  // still shows on dark ones (where multiplying alone changes almost nothing).
  const HIGHLIGHT_ALPHA = 0.35;
  const HIGHLIGHT_GLOW = 0.2;
  const OUTLINE_DARK = '#06060b';
  const OUTLINE_LIGHT = '#ebe8d8';

  /* ---------------- rectangles ---------------- */
  const round1 = (v) => Math.round(v * 10) / 10;
  function normRect(x1, y1, x2, y2) {
    const x = Math.min(x1, x2), y = Math.min(y1, y2);
    return { x, y, w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
  }
  // The part of r inside [0, 0, W, H] in whole pixels, or null when nothing is left.
  function clipRect(r, W, H) {
    if (!r) return null;
    const x1 = Math.max(0, Math.round(r.x)), y1 = Math.max(0, Math.round(r.y));
    const x2 = Math.min(W, Math.round(r.x + r.w)), y2 = Math.min(H, Math.round(r.y + r.h));
    return x2 > x1 && y2 > y1 ? { x: x1, y: y1, w: x2 - x1, h: y2 - y1 } : null;
  }
  const inRect = (r, x, y) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
  // The topmost window (the list is in z-order, top first) under a point, or null.
  function windowAt(windows, x, y) {
    for (const w of windows || []) if (inRect(w, x, y)) return w;
    return null;
  }

  /* ---------------- grabs and files ---------------- */
  // r (whole pixels, inside the picture) out of an RGBA picture W pixels wide: a new Uint8Array.
  function crop(src, W, H, r) {
    const out = new Uint8Array(r.w * r.h * 4);
    const row = r.w * 4;
    for (let y = 0; y < r.h; y++) {
      const from = ((r.y + y) * W + r.x) * 4;
      out.set(src.subarray(from, from + row), y * row);
    }
    return out;
  }
  // RGBA <-> BGRA (the same swap both ways), into a new array; opaque: every alpha becomes 255.
  function swapRB(src, opaque = false) {
    const out = new Uint8Array(src.length);
    out.set(src);
    const n = out.length >> 2;
    if (out.byteOffset % 4 === 0) {
      const u = new Uint32Array(out.buffer, out.byteOffset, n);
      const a = opaque ? 0xff000000 : 0;
      for (let i = 0; i < n; i++) {
        const v = u[i];
        u[i] = (v & 0xff00ff00) | ((v & 0xff) << 16) | ((v >>> 16) & 0xff) | a;
      }
    } else {
      for (let i = 0; i < out.length; i += 4) {
        const r = out[i];
        out[i] = out[i + 2];
        out[i + 2] = r;
        if (opaque) out[i + 3] = 255;
      }
    }
    return out;
  }
  const pad2 = (n) => String(n).padStart(2, '0');
  // "NeuralSnap 2026-11-11 16-45-12.png" in local time; n > 1 adds " (n)".
  function captureName(date, n = 1) {
    const d = date;
    const base = `NeuralSnap ${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}-${pad2(d.getMinutes())}-${pad2(d.getSeconds())}`;
    return n > 1 ? `${base} (${n}).png` : `${base}.png`;
  }
  // The first name that is free (exists(name) says whether a file of that name is there already).
  function uniqueName(date, exists) {
    for (let n = 1; n < 10000; n++) {
      const name = captureName(date, n);
      if (!exists(name)) return name;
    }
    return captureName(date, Date.now());
  }

  /* ---------------- pixelation ---------------- */
  // Block size: 10/16/24 pixels by the width picked, at least a twentieth of the area's shorter side.
  function blockSize(w, h, widthIndex) {
    const base = WIDTHS.block[Math.max(0, Math.min(2, widthIndex | 0))];
    return Math.max(base, Math.ceil(Math.min(w, h) / 20));
  }
  // The area r (whole pixels, inside the picture) of an RGBA picture as blocks of their average colour, computed from
  // src (the original capture, so nothing of what is under it survives): a new Uint8ClampedArray, r.w x r.h.
  function pixelate(src, W, H, r, block) {
    const out = new Uint8ClampedArray(r.w * r.h * 4);
    const b = Math.max(1, block | 0);
    for (let by = 0; by < r.h; by += b) {
      const bh = Math.min(b, r.h - by);
      for (let bx = 0; bx < r.w; bx += b) {
        const bw = Math.min(b, r.w - bx);
        let sr = 0, sg = 0, sb = 0, sa = 0;
        for (let y = 0; y < bh; y++) {
          let i = ((r.y + by + y) * W + r.x + bx) * 4;
          for (let x = 0; x < bw; x++, i += 4) { sr += src[i]; sg += src[i + 1]; sb += src[i + 2]; sa += src[i + 3]; }
        }
        const n = bw * bh;
        const cr = Math.round(sr / n), cg = Math.round(sg / n), cb = Math.round(sb / n), ca = Math.round(sa / n);
        for (let y = 0; y < bh; y++) {
          let o = ((by + y) * r.w + bx) * 4;
          for (let x = 0; x < bw; x++, o += 4) { out[o] = cr; out[o + 1] = cg; out[o + 2] = cb; out[o + 3] = ca; }
        }
      }
    }
    return out;
  }

  /* ---------------- shapes ---------------- */
  // The arrow's head grows with the line: a filled triangle whose tip is the end point.
  function arrowHead(x1, y1, x2, y2, width) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const L = Math.min(len, Math.max(10, width * 4 + 6));
    const half = L * 0.55;
    const bx = x2 - ux * L, by = y2 - uy * L;
    return { tip: [x2, y2], left: [bx - uy * half, by + ux * half], right: [bx + uy * half, by - ux * half], base: [bx, by], length: L };
  }
  // Freehand: drops points closer than min to the previous one (the last point always stays).
  function thin(points, min) {
    if (points.length < 3) return points.slice();
    const out = [points[0]];
    for (let i = 1; i < points.length - 1; i++) {
      const p = out[out.length - 1];
      if (Math.hypot(points[i][0] - p[0], points[i][1] - p[1]) >= min) out.push(points[i]);
    }
    out.push(points[points.length - 1]);
    return out;
  }
  // A smooth path through the points: quadratic curves between the middles of the segments.
  function smoothPath(points) {
    const p = points;
    if (!p.length) return [];
    const out = [['M', p[0][0], p[0][1]]];
    if (p.length === 1) { out.push(['L', p[0][0] + 0.01, p[0][1]]); return out; }
    if (p.length === 2) { out.push(['L', p[1][0], p[1][1]]); return out; }
    for (let i = 1; i < p.length - 1; i++) out.push(['Q', p[i][0], p[i][1], (p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2]);
    out.push(['L', p[p.length - 1][0], p[p.length - 1][1]]);
    return out;
  }
  const textFont = (size) => `600 ${size}px "Chakra Petch", "Rajdhani", "Segoe UI", sans-serif`;
  const lineHeight = (size) => Math.round(size * 1.25);
  const outlineWidth = (size) => Math.max(2, Math.round(size * 0.18));
  const linesOf = (text) => String(text || '').split('\n');
  // Width and height of a text annotation on this context (stored on it for hit tests).
  function measureText(ctx, a) {
    ctx.save();
    ctx.font = textFont(a.size);
    let w = 0;
    for (const l of linesOf(a.text)) w = Math.max(w, ctx.measureText(l).width);
    ctx.restore();
    const o = outlineWidth(a.size);
    return { w: Math.ceil(w + o), h: linesOf(a.text).length * lineHeight(a.size) + Math.ceil(o / 2) };
  }

  /* ---------------- bounds, hit tests, moving ---------------- */
  function bounds(a) {
    switch (a.type) {
      case 'arrow': {
        const m = Math.max(a.width / 2, arrowHead(a.x1, a.y1, a.x2, a.y2, a.width).length * 0.55);
        const r = normRect(a.x1, a.y1, a.x2, a.y2);
        return { x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m };
      }
      case 'rect': return { x: a.x - a.width / 2, y: a.y - a.width / 2, w: a.w + a.width, h: a.h + a.width };
      case 'pen': case 'highlight': {
        let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
        for (const [x, y] of a.points) { x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y); }
        const m = a.width / 2;
        return { x: x1 - m, y: y1 - m, w: x2 - x1 + 2 * m, h: y2 - y1 + 2 * m };
      }
      case 'text': return { x: a.x, y: a.y, w: a.w || 0, h: a.h || 0 };
      case 'pixelate': return { x: a.x, y: a.y, w: a.w, h: a.h };
      default: return { x: 0, y: 0, w: 0, h: 0 };
    }
  }
  function distToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2)) : 0;
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }
  function inTriangle(px, py, a, b, c) {
    const s = (p1, p2, p3) => (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1]);
    const p = [px, py];
    const d1 = s(p, a, b), d2 = s(p, b, c), d3 = s(p, c, a);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  }
  // Is (x, y) on the annotation? Outlines (arrow, rectangle, strokes) within tol pixels; texts and pixelated areas
  // anywhere inside.
  function hitTest(a, x, y, tol = 4) {
    switch (a.type) {
      case 'arrow': {
        const h = arrowHead(a.x1, a.y1, a.x2, a.y2, a.width);
        return distToSegment(x, y, a.x1, a.y1, h.base[0], h.base[1]) <= a.width / 2 + tol || inTriangle(x, y, h.tip, h.left, h.right);
      }
      case 'rect': {
        const t = a.width / 2 + tol;
        const near = (v, lo, hi) => v >= lo - t && v <= hi + t;
        const onV = near(y, a.y, a.y + a.h) && (Math.abs(x - a.x) <= t || Math.abs(x - a.x - a.w) <= t);
        const onH = near(x, a.x, a.x + a.w) && (Math.abs(y - a.y) <= t || Math.abs(y - a.y - a.h) <= t);
        return onV || onH;
      }
      case 'pen': case 'highlight': {
        const p = a.points;
        const t = a.width / 2 + tol;
        if (p.length === 1) return Math.hypot(x - p[0][0], y - p[0][1]) <= t;
        for (let i = 1; i < p.length; i++) if (distToSegment(x, y, p[i - 1][0], p[i - 1][1], p[i][0], p[i][1]) <= t) return true;
        return false;
      }
      case 'text': case 'pixelate': {
        const b = bounds(a);
        return x >= b.x - tol && y >= b.y - tol && x <= b.x + b.w + tol && y <= b.y + b.h + tol;
      }
      default: return false;
    }
  }
  // The order things are drawn in: pixelated areas first (straight on the capture), then the rest as added, so
  // whatever is drawn over a pixelated area stays sharp. Indexes into the list.
  function drawOrder(list) {
    const idx = list.map((_, i) => i);
    return [...idx.filter((i) => list[i].type === 'pixelate'), ...idx.filter((i) => list[i].type !== 'pixelate')];
  }
  // The index of the topmost annotation under the point, or -1.
  function topAt(list, x, y, tol = 4) {
    const order = drawOrder(list);
    for (let k = order.length - 1; k >= 0; k--) if (hitTest(list[order[k]], x, y, tol)) return order[k];
    return -1;
  }
  // A moved copy.
  function move(a, dx, dy) {
    const b = JSON.parse(JSON.stringify(a));
    switch (b.type) {
      case 'arrow': b.x1 = round1(b.x1 + dx); b.y1 = round1(b.y1 + dy); b.x2 = round1(b.x2 + dx); b.y2 = round1(b.y2 + dy); break;
      case 'pen': case 'highlight': b.points = b.points.map(([x, y]) => [round1(x + dx), round1(y + dy)]); break;
      case 'pixelate': b.x = Math.round(b.x + dx); b.y = Math.round(b.y + dy); break;
      default: b.x = round1(b.x + dx); b.y = round1(b.y + dy);
    }
    return b;
  }

  /* ---------------- drawing ---------------- */
  // One annotation on a 2D context whose transform maps image pixels. opts.pixels(a) gives the pixelated area of a
  // 'pixelate' annotation as something drawImage takes (the page computes it with pixelate() from the capture).
  function draw(ctx, a, opts = {}) {
    ctx.save();
    switch (a.type) {
      case 'pixelate': {
        const img = opts.pixels ? opts.pixels(a) : null;
        if (img) { ctx.imageSmoothingEnabled = false; ctx.drawImage(img, a.x, a.y, a.w, a.h); }
        break;
      }
      case 'rect':
        ctx.strokeStyle = a.color;
        ctx.lineWidth = a.width;
        ctx.lineJoin = 'miter';
        ctx.strokeRect(a.x, a.y, a.w, a.h);
        break;
      case 'arrow': {
        const h = arrowHead(a.x1, a.y1, a.x2, a.y2, a.width);
        ctx.strokeStyle = a.color;
        ctx.fillStyle = a.color;
        ctx.lineWidth = a.width;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(a.x1, a.y1);
        // the shaft ends inside the head, so no round cap shows past its base
        ctx.lineTo(h.base[0] + (a.x2 - h.base[0]) * 0.3, h.base[1] + (a.y2 - h.base[1]) * 0.3);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(h.tip[0], h.tip[1]);
        ctx.lineTo(h.left[0], h.left[1]);
        ctx.lineTo(h.right[0], h.right[1]);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 'pen': case 'highlight': {
        ctx.strokeStyle = a.color;
        ctx.lineWidth = a.width;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        if (a.type === 'highlight') { ctx.globalAlpha = HIGHLIGHT_ALPHA; ctx.globalCompositeOperation = 'multiply'; }
        ctx.beginPath();
        for (const s of smoothPath(a.points)) {
          if (s[0] === 'M') ctx.moveTo(s[1], s[2]);
          else if (s[0] === 'L') ctx.lineTo(s[1], s[2]);
          else ctx.quadraticCurveTo(s[1], s[2], s[3], s[4]);
        }
        ctx.stroke();
        if (a.type === 'highlight') { ctx.globalAlpha = HIGHLIGHT_GLOW; ctx.globalCompositeOperation = 'screen'; ctx.stroke(); }
        break;
      }
      case 'text': {
        ctx.font = textFont(a.size);
        ctx.textBaseline = 'top';
        ctx.lineJoin = 'round';
        ctx.lineWidth = outlineWidth(a.size);
        ctx.strokeStyle = a.color === COLORS[4].hex ? OUTLINE_LIGHT : OUTLINE_DARK;
        ctx.fillStyle = a.color;
        const lh = lineHeight(a.size);
        const o = ctx.lineWidth / 2;
        linesOf(a.text).forEach((l, i) => {
          ctx.strokeText(l, a.x + o, a.y + o + i * lh);
          ctx.fillText(l, a.x + o, a.y + o + i * lh);
        });
        break;
      }
      default: break;
    }
    ctx.restore();
  }
  // Every annotation, in drawing order; skip: an index not to draw (the text being edited).
  function render(ctx, list, opts = {}) {
    for (const i of drawOrder(list)) if (i !== opts.skip) draw(ctx, list[i], opts);
  }

  /* ---------------- undo history ---------------- */
  // Snapshots of the annotation list; every change is one step. saved: the step that matches the file on disk.
  class History {
    constructor(initial = [], limit = 200) {
      this.steps = [JSON.stringify(initial)];
      this.at = 0;
      this.saved = 0;
      this.limit = limit;
    }
    get state() { return JSON.parse(this.steps[this.at]); }
    commit(state) {
      const s = JSON.stringify(state);
      if (s === this.steps[this.at]) return false;
      this.steps.splice(this.at + 1);
      if (this.saved > this.at) this.saved = -1; // the saved step was undone and is now gone
      this.steps.push(s);
      if (this.steps.length > this.limit) { this.steps.shift(); this.saved--; }
      this.at = this.steps.length - 1;
      return true;
    }
    get canUndo() { return this.at > 0; }
    get canRedo() { return this.at < this.steps.length - 1; }
    undo() { if (this.canUndo) this.at--; return this.state; }
    redo() { if (this.canRedo) this.at++; return this.state; }
    markSaved() { this.saved = this.at; }
    get dirty() { return this.saved !== this.at; }
  }

  return {
    COLORS, WIDTHS, HIGHLIGHT_ALPHA, HIGHLIGHT_GLOW,
    normRect, clipRect, inRect, windowAt,
    crop, swapRB, captureName, uniqueName,
    blockSize, pixelate,
    arrowHead, thin, smoothPath, textFont, lineHeight, outlineWidth, measureText,
    bounds, distToSegment, hitTest, drawOrder, topAt, move,
    draw, render, History,
  };
});
