/* ============================================================
   NeuralSnap — the capture overlay of one display. main.js sends the display's part of the grab (physical pixels,
   RGBA) and the windows on it; the canvas holds those pixels 1:1 and the page maps the cursor to them with the window's
   own scale (picture width / CSS width: the display's scale factor, or the shrink of the small test window), so a
   selection is always in real pixels. Drag: a region (mouse-up confirms; under 4 x 4 is ignored). Click: the window
   under the cursor (none: the display). Enter or Space: the display. Esc or right-click: cancel. Arrow keys move the
   cursor by a pixel (Shift: 10) for exact edges.
   ============================================================ */
'use strict';
(() => {
const $ = (s) => document.querySelector(s);
const T = NeuralI18n.page(window);
const Kit = window.NeuralSnapKit;
const api = window.snapOverlay;
if (!api) return;

const el = {
  shot: $('#shot'), dim: $('#dim'), sel: $('#sel'), crossH: $('#cross-h'), crossV: $('#cross-v'), chip: $('#chip'),
  loupe: $('#loupe'), lens: $('#lens'), xy: $('#lens-xy'), hex: $('#lens-hex'), swatch: $('#lens-swatch'), hint: $('#hint'),
};
const ctx = el.shot.getContext('2d', { alpha: false });
const LENS_CELLS = 15; // pixels across the magnifier
const LENS_CSS = 122;
const DRAG_MIN = 3; // CSS pixels before a press becomes a drag
const MIN_SIZE = 4; // smaller regions are ignored

let f = null; // the frame: { seq, w, h, data, region, origin, windows (local pixels) }
let mode = 'off'; // off | idle | press | drag | done
let p0 = null; // where the press was (picture pixels)
let cur = null; // the cursor (picture pixels, fractional)
let hover = null; // the window under the cursor (local pixels)
let sel = null; // the selection shown (local pixels) and its kind

const sx = () => f.w / Math.max(1, innerWidth);
const sy = () => f.h / Math.max(1, innerHeight);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const hex2 = (n) => n.toString(16).padStart(2, '0').toUpperCase();

/* ---------------- drawing the overlay's parts ---------------- */
function showSel(r, kind) {
  sel = r ? { ...r, kind } : null;
  el.sel.hidden = !r;
  el.dim.hidden = !!r;
  if (!r) { el.chip.hidden = true; return; }
  el.sel.classList.toggle('win', kind === 'window');
  const k = { x: 1 / sx(), y: 1 / sy() };
  const left = r.x * k.x, top = r.y * k.y, width = r.w * k.x, height = r.h * k.y;
  Object.assign(el.sel.style, { left: left + 'px', top: top + 'px', width: width + 'px', height: height + 'px' });
  // the size in physical pixels, next to the selection: below its right end, else above, else inside
  el.chip.textContent = `${r.w} × ${r.h}`;
  el.chip.hidden = false;
  const cw = el.chip.offsetWidth, ch = el.chip.offsetHeight;
  let cx = left + width - cw, cy = top + height + 8;
  if (cy + ch > innerHeight - 4) cy = top - ch - 8;
  if (cy < 4) cy = top + height - ch - 6;
  el.chip.style.left = clamp(cx, 4, innerWidth - cw - 4) + 'px';
  el.chip.style.top = clamp(cy, 4, innerHeight - ch - 4) + 'px';
}
function showCross() {
  if (!cur) { el.crossH.hidden = el.crossV.hidden = true; return; }
  const x = Math.floor(cur.x) / sx(), y = Math.floor(cur.y) / sy();
  el.crossH.hidden = el.crossV.hidden = false;
  el.crossH.style.top = Math.round(y) + 'px';
  el.crossV.style.left = Math.round(x) + 'px';
  // the hint bar steps aside when the cursor comes near it
  const hb = el.hint.getBoundingClientRect();
  if (!el.hint.classList.contains('low') && y < hb.bottom + 30 && x > hb.left - 30 && x < hb.right + 30) el.hint.classList.add('low');
  else if (el.hint.classList.contains('low') && y > innerHeight * 0.4 && y < innerHeight * 0.6) el.hint.classList.remove('low');
}
// The magnifier: the pixels around the cursor, a grid, the cursor's pixel framed; its coordinates and colour.
function showLoupe() {
  if (!cur) { el.loupe.hidden = true; return; }
  const px = clamp(Math.floor(cur.x), 0, f.w - 1), py = clamp(Math.floor(cur.y), 0, f.h - 1);
  const dpr = devicePixelRatio || 1;
  const size = Math.round(LENS_CSS * dpr);
  if (el.lens.width !== size) { el.lens.width = size; el.lens.height = size; }
  const g = el.lens.getContext('2d');
  const half = (LENS_CELLS - 1) / 2;
  const cell = size / LENS_CELLS;
  g.imageSmoothingEnabled = false;
  g.fillStyle = '#000';
  g.fillRect(0, 0, size, size);
  const x0 = px - half, y0 = py - half;
  // only the part that is inside the picture (drawImage does not like source rectangles outside)
  const ix = Math.max(0, x0), iy = Math.max(0, y0), ix2 = Math.min(f.w, x0 + LENS_CELLS), iy2 = Math.min(f.h, y0 + LENS_CELLS);
  if (ix2 > ix && iy2 > iy) g.drawImage(el.shot, ix, iy, ix2 - ix, iy2 - iy, (ix - x0) * cell, (iy - y0) * cell, (ix2 - ix) * cell, (iy2 - iy) * cell);
  g.strokeStyle = 'rgba(6, 6, 11, .35)';
  g.lineWidth = 1;
  g.beginPath();
  for (let i = 1; i < LENS_CELLS; i++) {
    const v = Math.round(i * cell) + 0.5;
    g.moveTo(v, 0); g.lineTo(v, size);
    g.moveTo(0, v); g.lineTo(size, v);
  }
  g.stroke();
  g.strokeStyle = '#fcee0a';
  g.lineWidth = Math.max(1.5, dpr * 1.5);
  g.strokeRect(Math.round(half * cell) + 0.5, Math.round(half * cell) + 0.5, Math.round(cell), Math.round(cell));
  const i = (py * f.w + px) * 4;
  const hex = '#' + hex2(f.data[i]) + hex2(f.data[i + 1]) + hex2(f.data[i + 2]);
  el.xy.textContent = `${f.origin.x + f.region.x + px}, ${f.origin.y + f.region.y + py}`;
  el.hex.textContent = hex;
  el.swatch.style.background = hex;
  el.loupe.hidden = false;
  // near the cursor, on the side where it fits
  const cx = px / sx(), cy = py / sy();
  const lw = el.loupe.offsetWidth, lh = el.loupe.offsetHeight;
  let lx = cx + 22, ly = cy + 22;
  if (lx + lw > innerWidth - 4) lx = cx - lw - 22;
  if (ly + lh > innerHeight - 4) ly = cy - lh - 22;
  el.loupe.style.left = clamp(lx, 4, innerWidth - lw - 4) + 'px';
  el.loupe.style.top = clamp(ly, 4, innerHeight - lh - 4) + 'px';
}

/* ---------------- the cursor and the choice ---------------- */
function dragRect() {
  const x = clamp(Math.round(cur.x), 0, f.w), y = clamp(Math.round(cur.y), 0, f.h);
  return Kit.normRect(p0.x, p0.y, x, y);
}
function update() {
  if (mode === 'drag') showSel(dragRect(), 'rect');
  else if (mode === 'idle' || mode === 'press') {
    hover = cur ? Kit.windowAt(f.windows, cur.x, cur.y) : null;
    showSel(hover, 'window');
  }
  showCross();
  showLoupe();
}
function moveTo(x, y) {
  if (!f || mode === 'off' || mode === 'done') return;
  cur = { x: clamp(x, 0, f.w - 0.001), y: clamp(y, 0, f.h - 0.001) };
  if (mode === 'press' && Math.hypot((cur.x - p0.fx) / sx(), (cur.y - p0.fy) / sy()) > DRAG_MIN) mode = 'drag';
  update();
}
function pick(kind, r) {
  if (!f || mode === 'done') return;
  mode = 'done';
  const g = r ? { x: r.x + f.region.x, y: r.y + f.region.y, w: r.w, h: r.h } : null;
  api.pick(f.seq, kind, g);
}
function cancel() {
  if (!f || mode === 'done') return;
  mode = 'done';
  api.cancel(f.seq);
}

addEventListener('mousemove', (e) => { if (f) moveTo(e.clientX * sx(), e.clientY * sy()); });
addEventListener('mousedown', (e) => {
  if (!f || mode === 'off' || mode === 'done') return;
  e.preventDefault();
  if (e.button === 2) { cancel(); return; }
  if (e.button !== 0) return;
  moveTo(e.clientX * sx(), e.clientY * sy());
  p0 = { x: clamp(Math.round(cur.x), 0, f.w), y: clamp(Math.round(cur.y), 0, f.h), fx: cur.x, fy: cur.y };
  mode = 'press';
});
addEventListener('mouseup', (e) => {
  if (!f || e.button !== 0) return;
  if (mode === 'drag') {
    moveTo(e.clientX * sx(), e.clientY * sy());
    const r = dragRect();
    if (r.w >= MIN_SIZE && r.h >= MIN_SIZE) pick('rect', r);
    else { mode = 'idle'; update(); }
  } else if (mode === 'press') {
    mode = 'idle';
    if (hover) pick('window', hover); else pick('display', null);
  }
});
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('keydown', (e) => {
  if (!f || mode === 'off' || mode === 'done') return;
  const k = e.key;
  if (k === 'Escape') { e.preventDefault(); cancel(); }
  else if (k === 'Enter' || k === ' ') { e.preventDefault(); pick('display', null); }
  else if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown') {
    e.preventDefault();
    const d = e.shiftKey ? 10 : 1;
    const c = cur || { x: f.w / 2, y: f.h / 2 };
    const x = Math.floor(c.x) + 0.5 + (k === 'ArrowLeft' ? -d : k === 'ArrowRight' ? d : 0);
    const y = Math.floor(c.y) + 0.5 + (k === 'ArrowUp' ? -d : k === 'ArrowDown' ? d : 0);
    moveTo(x, y);
  }
});
// The window lost the keyboard while the button was down (another program came up): no drag left hanging.
addEventListener('blur', () => { if (mode === 'press' || mode === 'drag') { mode = 'idle'; if (f) update(); } });

/* ---------------- from main.js ---------------- */
api.onFrame((fr) => {
  const data = new Uint8ClampedArray(fr.pixels.buffer, fr.pixels.byteOffset, fr.pixels.byteLength);
  el.shot.width = fr.w;
  el.shot.height = fr.h;
  ctx.putImageData(new ImageData(data, fr.w, fr.h), 0, 0);
  const off = fr.region;
  const windows = [];
  for (const w of fr.windows || []) {
    const r = Kit.clipRect({ x: w.x - off.x, y: w.y - off.y, w: w.w, h: w.h }, fr.w, fr.h);
    // the window's whole rectangle is taken (it may go on to another display); only the part here is drawn
    if (r) windows.push({ x: w.x - off.x, y: w.y - off.y, w: w.w, h: w.h });
  }
  f = { seq: fr.seq, w: fr.w, h: fr.h, data, region: fr.region, origin: fr.origin || { x: 0, y: 0 }, windows };
  mode = 'idle';
  p0 = cur = hover = null;
  showSel(null);
  showCross();
  el.loupe.hidden = true;
  el.hint.classList.remove('low');
  document.body.classList.remove('idle');
  api.drawn(fr.seq);
});
api.onShown((s) => {
  if (!f) return;
  if (s && s.cursor) moveTo(s.cursor.x * sx(), s.cursor.y * sy());
});
api.onReset(() => {
  mode = 'off';
  f = null;
  p0 = cur = hover = sel = null;
  document.body.classList.add('idle');
  el.shot.width = 1; // the picture goes; nothing of it is shown again
  el.shot.height = 1;
  el.sel.hidden = el.chip.hidden = el.loupe.hidden = el.crossH.hidden = el.crossV.hidden = true;
  let sent = false;
  const done = () => { if (!sent) { sent = true; api.cleared(); } };
  requestAnimationFrame(() => requestAnimationFrame(done));
  setTimeout(done, 100);
});

// For the tests: what the overlay shows, in picture pixels.
window.ovState = () => ({
  mode, seq: f ? f.seq : 0, w: f ? f.w : 0, h: f ? f.h : 0, scale: f ? [sx(), sy()] : null,
  sel: sel ? { x: sel.x, y: sel.y, w: sel.w, h: sel.h, kind: sel.kind } : null,
  chip: el.chip.hidden ? '' : el.chip.textContent,
  loupe: el.loupe.hidden ? null : { xy: el.xy.textContent, hex: el.hex.textContent },
  hint: el.hint.textContent,
});
})();
