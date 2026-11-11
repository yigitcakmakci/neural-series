/* ============================================================
   NeuralSnap — the editor. main.js sends a capture as RGBA pixels; the page keeps them untouched (doc.data) and draws
   the annotations over them as objects (annotate.js) until something leaves the editor: copy, save, save as,
   NeuralView and pin export the picture at its full resolution with every annotation, as PNG.
   ============================================================ */
'use strict';
(async () => {

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const readJSON = (k) => { try { return JSON.parse(localStorage.getItem(k)) || null; } catch { return null; } };
const snap = window.snap;
const Kit = window.NeuralSnapKit;
// Interface texts in the series language (lang\*.json through language.js and i18n.js).
const T = NeuralI18n.page(window);
const root = document.documentElement;
if (!snap) { document.body.textContent = T.has('app.desktop-only') ? T('app.desktop-only') : 'NeuralSnap yalnızca masaüstü uygulaması olarak çalışır.'; return; }

// What main.js sends before the page is ready waits here.
let ready = false;
const early = [];
const later = (fn) => (payload) => { if (ready) fn(payload); else early.push(() => fn(payload)); };
snap.onOpen(later((d) => openDoc(d)));
snap.onOpenSettings(later(() => openSettings()));
snap.onConfirmQuit(later(() => confirmQuit()));
snap.onShortcut((s) => { shortcut = s || shortcut; renderShortcut(); });
snap.onMaximized((on) => root.classList.toggle('is-max', on));

const el = {
  stage: $('#stage'), view: $('#view'), text: $('#text-edit'), empty: $('#empty'), emptyKey: $('#empty-key'), recent: $('#recent'), recentWrap: $('#recent-wrap'),
  toast: $('#toast'), popups: $('#popups'), size: $('#st-size'), zoom: $('#st-zoom'), tool: $('#st-tool'), file: $('#st-file'),
};

/* ---------------- Settings (this page) ---------------- */
const SETTINGS_KEY = 'neuralsnap.settings';
const THEMES = ['neon', 'ice', 'alarm', 'daylight'].map((id) => ({ id, name: T('theme.' + id) }));
const TOOLS = ['select', 'arrow', 'rect', 'pen', 'text', 'highlight', 'pixelate'];
const TOOL_KEYS = { v: 'select', a: 'arrow', r: 'rect', p: 'pen', t: 'text', h: 'highlight', b: 'pixelate' };
const S = Object.assign({ theme: 'neon', syncTheme: true, tool: 'arrow', color: 2, width: 1 }, readJSON(SETTINGS_KEY));
if (!TOOLS.includes(S.tool)) S.tool = 'arrow';
if (!(S.color >= 0 && S.color < Kit.COLORS.length)) S.color = 2;
if (!(S.width >= 0 && S.width <= 2)) S.width = 1;
const saveSettings = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(S)); } catch { /* storage unavailable */ } };

function applyTheme() { for (const t of THEMES) root.classList.toggle('theme-' + t.id, t.id === S.theme); }
function setTheme(id) { S.theme = id; saveSettings(); applyTheme(); snap.themeSet(id); }
// The series theme: another Neural program changed it, or the setting changed there.
snap.onThemeApply((id) => {
  if (!THEMES.some((t) => t.id === id) || id === S.theme) return;
  S.theme = id;
  saveSettings();
  applyTheme();
});
snap.onThemeSyncState((on) => { S.syncTheme = !!on; saveSettings(); });
function toggleThemeSync() { S.syncTheme = !S.syncTheme; saveSettings(); snap.themeSync(S.syncTheme, S.theme); }

const P0 = new Intl.NumberFormat(T.locale, { style: 'percent', maximumFractionDigits: 0 });
const N0 = new Intl.NumberFormat(T.locale, { maximumFractionDigits: 0 });

/* ---------------- The picture and its annotations ---------------- */
let doc = null; // { id, w, h, data: ImageData (the capture, never changed), base: canvas, file, name, hist }
let list = []; // the annotations now (image pixels)
let sel = -1; // the selected annotation (select tool)
let draft = null; // the annotation being drawn
let drag = null; // { kind: 'draw' | 'move' | 'pan' | 'text', ... }
let editing = null; // a text being typed: { index (-1: new), a }
let busy = false;
let spaceDown = false;
const view = { s: 1, ox: 0, oy: 0, fit: true }; // CSS pixels per image pixel, the picture's place on the stage
const pixCache = new Map();
const MAX_ZOOM = 16, MIN_ZOOM = 0.05;
const color = () => Kit.COLORS[S.color].hex;
const dpr = () => window.devicePixelRatio || 1;
const zoom = () => view.s * dpr(); // 1 = one picture pixel on one screen pixel
const r1 = (v) => Math.round(v * 10) / 10;

// The pixelated area of a 'pixelate' annotation, from the capture itself.
function pixelsOf(a) {
  const r = Kit.clipRect(a, doc.w, doc.h);
  if (!r) return null;
  const key = `${r.x},${r.y},${r.w},${r.h},${a.block}`;
  let c = pixCache.get(key);
  if (!c) {
    const px = Kit.pixelate(doc.data.data, doc.w, doc.h, r, a.block);
    c = document.createElement('canvas');
    c.width = r.w;
    c.height = r.h;
    c.getContext('2d').putImageData(new ImageData(px, r.w, r.h), 0, 0);
    pixCache.set(key, c);
    if (pixCache.size > 40) pixCache.delete(pixCache.keys().next().value);
  } else { pixCache.delete(key); pixCache.set(key, c); }
  return c;
}

/* ---------------- Drawing the view ---------------- */
let raf = 0;
const redraw = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; paint(); }); };
function paint() {
  const c = el.view, W = el.stage.clientWidth, H = el.stage.clientHeight, d = dpr();
  const cw = Math.max(1, Math.round(W * d)), ch = Math.max(1, Math.round(H * d));
  if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
  const g = c.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, cw, ch);
  if (!doc) { $('#act-delete').disabled = true; return; }
  const k = d * view.s, x0 = d * view.ox, y0 = d * view.oy;
  g.save();
  g.shadowColor = 'rgba(0, 0, 0, .7)';
  g.shadowBlur = 22 * d;
  g.fillStyle = '#000';
  g.fillRect(x0, y0, doc.w * k, doc.h * k);
  g.restore();
  g.setTransform(k, 0, 0, k, x0, y0);
  g.imageSmoothingEnabled = k < 1;
  g.imageSmoothingQuality = 'high';
  g.drawImage(doc.base, 0, 0);
  g.imageSmoothingEnabled = true;
  const shown = draft ? [...list, draft] : list;
  Kit.render(g, shown, { pixels: pixelsOf, skip: editing ? editing.index : -1 });
  g.setTransform(1, 0, 0, 1, 0, 0);
  // the selection, and the area a pixelation will take
  const outline = (b, col, dash) => {
    g.save();
    g.strokeStyle = col;
    g.lineWidth = Math.max(1, d);
    g.setLineDash(dash.map((v) => v * d));
    g.strokeRect(Math.round(x0 + b.x * k) - 0.5, Math.round(y0 + b.y * k) - 0.5, Math.round(b.w * k) + 1, Math.round(b.h * k) + 1);
    g.restore();
  };
  $('#act-delete').disabled = !(sel >= 0 && list[sel]);
  if (sel >= 0 && list[sel] && !editing) { const b = Kit.bounds(list[sel]); outline({ x: b.x - 3 / view.s, y: b.y - 3 / view.s, w: b.w + 6 / view.s, h: b.h + 6 / view.s }, '#00f0ff', [5, 4]); }
  if (draft && draft.type === 'pixelate') outline(draft, '#fcee0a', [3, 3]);
}

/* ---------------- Zoom and pan ---------------- */
function clampView() {
  if (!doc) return;
  const W = el.stage.clientWidth, H = el.stage.clientHeight, iw = doc.w * view.s, ih = doc.h * view.s, m = 24;
  view.ox = iw <= W - 2 * m ? (W - iw) / 2 : Math.min(m, Math.max(W - iw - m, view.ox));
  view.oy = ih <= H - 2 * m ? (H - ih) / 2 : Math.min(m, Math.max(H - ih - m, view.oy));
}
function fitView() {
  if (!doc) return;
  const W = el.stage.clientWidth, H = el.stage.clientHeight;
  view.s = Math.max(1e-3, Math.min(1 / dpr(), (W - 48) / doc.w, (H - 48) / doc.h));
  view.fit = true;
  clampView();
  afterView();
}
// z: 1 = 100 % (picture pixels on screen pixels); (ax, ay): the stage point that stays put
function zoomTo(z, ax, ay) {
  if (!doc) return;
  const W = el.stage.clientWidth, H = el.stage.clientHeight;
  if (ax === undefined) { ax = W / 2; ay = H / 2; }
  const s = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z)) / dpr();
  const ix = (ax - view.ox) / view.s, iy = (ay - view.oy) / view.s;
  view.s = s;
  view.ox = ax - ix * s;
  view.oy = ay - iy * s;
  view.fit = false;
  clampView();
  afterView();
}
const STEPS = [0.05, 0.1, 0.15, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16];
function zoomStep(dir) {
  const z = zoom();
  const next = dir > 0 ? STEPS.find((s) => s > z * 1.01) : [...STEPS].reverse().find((s) => s < z / 1.01);
  zoomTo(next || z);
}
function afterView() {
  if (editing) placeTextEditor();
  redraw();
  renderStatus();
}
new ResizeObserver(() => { if (!doc) return; if (view.fit) fitView(); else { clampView(); afterView(); } }).observe(el.stage);

/* ---------------- Opening a capture ---------------- */
async function openDoc(d) {
  if (!d || !d.rgba || !(d.w > 0) || !(d.h > 0)) return;
  if (editing) commitText();
  if (doc && doc.hist.dirty) {
    const a = await askUnsaved('capture');
    if (a === 'cancel') { toast(T('toast.kept'), 4000); return; }
    if (a === 'save' && !(await act('save'))) return;
  }
  const data = new ImageData(new Uint8ClampedArray(d.rgba.buffer, d.rgba.byteOffset, d.rgba.byteLength), d.w, d.h);
  const base = document.createElement('canvas');
  base.width = d.w;
  base.height = d.h;
  base.getContext('2d').putImageData(data, 0, 0);
  doc = { id: d.id, w: d.w, h: d.h, data, base, file: d.file || null, name: d.name || '', hist: new Kit.History([]) };
  list = [];
  sel = -1;
  draft = null;
  drag = null;
  pixCache.clear();
  el.empty.hidden = true;
  el.stage.hidden = false;
  root.classList.add('has-doc');
  snap.setDirty(false);
  fitView();
  renderAll();
  if (d.error) toast(d.error, 7000, true);
}

/* ---------------- Changes and the history ---------------- */
function commit() {
  if (doc && doc.hist.commit(list)) afterChange();
}
function afterChange() {
  if (sel >= list.length) sel = -1;
  snap.setDirty(doc.hist.dirty);
  renderAll();
  redraw();
}
function undo() {
  if (!doc || !doc.hist.canUndo) return;
  cancelDraft();
  list = doc.hist.undo();
  sel = -1;
  afterChange();
}
function redo() {
  if (!doc || !doc.hist.canRedo) return;
  cancelDraft();
  list = doc.hist.redo();
  sel = -1;
  afterChange();
}
function deleteSelected() {
  if (!doc || sel < 0 || !list[sel]) return;
  list = list.filter((_, i) => i !== sel);
  sel = -1;
  commit();
}
function cancelDraft() {
  if (drag && drag.kind === 'move' && drag.orig) list[drag.index] = drag.orig;
  draft = null;
  drag = null;
  redraw();
}

/* ---------------- Tools: the pointer on the stage ---------------- */
function toImage(e) {
  const r = el.stage.getBoundingClientRect();
  return { x: (e.clientX - r.left - view.ox) / view.s, y: (e.clientY - r.top - view.oy) / view.s };
}
const inside = (p) => ({ x: Math.max(0, Math.min(doc.w, p.x)), y: Math.max(0, Math.min(doc.h, p.y)) });
// Shift: lines at multiples of 45°, squares
function snap45(ax, ay, p) {
  const dx = p.x - ax, dy = p.y - ay, len = Math.hypot(dx, dy);
  const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  return { x: ax + Math.cos(ang) * len, y: ay + Math.sin(ang) * len };
}
// A pixelated area stays inside the picture, in whole pixels.
function keepInside(a) {
  if (a.type !== 'pixelate') return a;
  a.x = Math.max(0, Math.min(doc.w - a.w, Math.round(a.x)));
  a.y = Math.max(0, Math.min(doc.h - a.h, Math.round(a.y)));
  return a;
}

el.stage.addEventListener('pointerdown', (e) => {
  if (!doc || busy) return;
  if (editing) { commitText(); if (S.tool === 'text') { e.preventDefault(); return; } }
  if (e.button === 1 || (e.button === 0 && spaceDown)) {
    e.preventDefault();
    drag = { kind: 'pan', x: e.clientX, y: e.clientY, ox: view.ox, oy: view.oy };
    el.stage.classList.add('panning');
    el.stage.setPointerCapture(e.pointerId);
    return;
  }
  if (e.button !== 0) return;
  const p = toImage(e);
  const q = inside(p);
  const width = Kit.WIDTHS.stroke[S.width];
  switch (S.tool) {
    case 'select': {
      const hit = Kit.topAt(list, p.x, p.y, 5 / view.s);
      sel = hit;
      if (hit >= 0) drag = { kind: 'move', index: hit, start: p, orig: list[hit], moved: false };
      redraw();
      break;
    }
    case 'arrow': draft = { type: 'arrow', x1: r1(q.x), y1: r1(q.y), x2: r1(q.x), y2: r1(q.y), color: color(), width }; drag = { kind: 'draw', ax: q.x, ay: q.y }; break;
    case 'rect': draft = { type: 'rect', x: r1(q.x), y: r1(q.y), w: 0, h: 0, color: color(), width }; drag = { kind: 'draw', ax: q.x, ay: q.y }; break;
    case 'pen': case 'highlight':
      draft = { type: S.tool, points: [[r1(q.x), r1(q.y)]], color: color(), width: S.tool === 'pen' ? width : Kit.WIDTHS.highlight[S.width] };
      drag = { kind: 'draw', ax: q.x, ay: q.y };
      break;
    case 'pixelate': draft = { type: 'pixelate', x: Math.round(q.x), y: Math.round(q.y), w: 0, h: 0, block: Kit.WIDTHS.block[S.width] }; drag = { kind: 'draw', ax: Math.round(q.x), ay: Math.round(q.y) }; break;
    case 'text': {
      // a click on a text edits it; elsewhere a new one starts where the click was (on pointer-up, so it keeps the focus)
      const hit = Kit.topAt(list, p.x, p.y, 3 / view.s);
      drag = { kind: 'text', at: q, hit: hit >= 0 && list[hit].type === 'text' ? hit : -1 };
      break;
    }
    default: break;
  }
  if (drag) el.stage.setPointerCapture(e.pointerId);
  e.preventDefault();
});

el.stage.addEventListener('pointermove', (e) => {
  if (!doc) return;
  if (!drag) {
    if (S.tool === 'select') { const p = toImage(e); el.stage.classList.toggle('over-item', Kit.topAt(list, p.x, p.y, 5 / view.s) >= 0); }
    return;
  }
  if (drag.kind === 'pan') {
    view.ox = drag.ox + e.clientX - drag.x;
    view.oy = drag.oy + e.clientY - drag.y;
    view.fit = false;
    clampView();
    afterView();
    return;
  }
  const p = toImage(e);
  if (drag.kind === 'move') {
    const dx = p.x - drag.start.x, dy = p.y - drag.start.y;
    if (!drag.moved && Math.hypot(dx, dy) * view.s < 2) return;
    drag.moved = true;
    list[drag.index] = keepInside(Kit.move(drag.orig, dx, dy));
    redraw();
    return;
  }
  if (drag.kind !== 'draw' || !draft) return;
  let q = inside(p);
  switch (draft.type) {
    case 'arrow':
      if (e.shiftKey) q = inside(snap45(drag.ax, drag.ay, q));
      draft.x2 = r1(q.x); draft.y2 = r1(q.y);
      break;
    case 'rect': {
      if (e.shiftKey) { const s = Math.max(Math.abs(q.x - drag.ax), Math.abs(q.y - drag.ay)); q = inside({ x: drag.ax + Math.sign(q.x - drag.ax) * s, y: drag.ay + Math.sign(q.y - drag.ay) * s }); }
      const r = Kit.normRect(drag.ax, drag.ay, q.x, q.y);
      Object.assign(draft, { x: r1(r.x), y: r1(r.y), w: r1(r.w), h: r1(r.h) });
      break;
    }
    case 'pen': case 'highlight': {
      if (draft.type === 'highlight' && e.shiftKey) { draft.points = [draft.points[0], [r1(q.x), r1(q.y)]]; break; }
      const last = draft.points[draft.points.length - 1];
      if (Math.hypot(q.x - last[0], q.y - last[1]) * view.s >= 1) draft.points.push([r1(q.x), r1(q.y)]);
      break;
    }
    case 'pixelate': {
      const r = Kit.clipRect(Kit.normRect(drag.ax, drag.ay, Math.round(q.x), Math.round(q.y)), doc.w, doc.h) || { x: drag.ax, y: drag.ay, w: 0, h: 0 };
      Object.assign(draft, r, { block: Kit.blockSize(r.w, r.h, S.width) });
      break;
    }
    default: break;
  }
  redraw();
});

function endPointer(e) {
  if (!drag || !doc) return;
  const d = drag;
  drag = null;
  el.stage.classList.remove('panning');
  if (d.kind === 'move') { if (d.moved) commit(); return; }
  if (d.kind === 'text') {
    if (e && e.type === 'pointerup') startText(d.hit >= 0 ? null : d.at, d.hit);
    return;
  }
  if (d.kind !== 'draw' || !draft) return;
  const a = draft;
  draft = null;
  let ok = false;
  if (a.type === 'arrow') ok = Math.hypot(a.x2 - a.x1, a.y2 - a.y1) >= 3;
  else if (a.type === 'rect') ok = a.w >= 2 && a.h >= 2;
  else if (a.type === 'pixelate') ok = a.w >= 4 && a.h >= 4;
  else if (a.type === 'pen' || a.type === 'highlight') {
    a.points = Kit.thin(a.points, 0.75);
    if (a.points.length === 1) a.points.push([r1(a.points[0][0] + 0.1), a.points[0][1]]); // a dot
    ok = true;
  }
  if (ok) { list = [...list, a]; commit(); } else redraw();
}
el.stage.addEventListener('pointerup', endPointer);
el.stage.addEventListener('pointercancel', () => cancelDraft());
el.stage.addEventListener('lostpointercapture', (e) => { if (drag && drag.kind !== 'text') endPointer(e); });
el.stage.addEventListener('dblclick', (e) => {
  if (!doc || S.tool !== 'select') return;
  const p = toImage(e);
  const hit = Kit.topAt(list, p.x, p.y, 5 / view.s);
  if (hit >= 0 && list[hit].type === 'text') startText(null, hit);
});
el.stage.addEventListener('contextmenu', (e) => e.preventDefault());
el.stage.addEventListener('wheel', (e) => {
  if (!doc) return;
  e.preventDefault();
  const r = el.stage.getBoundingClientRect();
  if (e.ctrlKey) { zoomTo(zoom() * Math.pow(1.0018, -e.deltaY), e.clientX - r.left, e.clientY - r.top); return; }
  view.ox -= e.shiftKey ? e.deltaY : e.deltaX;
  view.oy -= e.shiftKey ? 0 : e.deltaY;
  view.fit = false;
  clampView();
  afterView();
}, { passive: false });

/* ---------------- Text ---------------- */
let measureCtx = null;
function measure(a) {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  return Kit.measureText(measureCtx, a);
}
function placeTextEditor() {
  const a = editing.a, ta = el.text;
  const o = Kit.outlineWidth(a.size) / 2;
  ta.style.left = (view.ox + (a.x + o) * view.s) + 'px';
  ta.style.top = (view.oy + (a.y + o) * view.s) + 'px';
  ta.style.fontSize = (a.size * view.s) + 'px';
  ta.style.lineHeight = (Kit.lineHeight(a.size) * view.s) + 'px';
  ta.style.color = a.color;
  ta.style.width = '1px';
  ta.style.height = '1px';
  ta.style.width = Math.max(40, ta.scrollWidth + 6) + 'px';
  ta.style.height = ta.scrollHeight + 'px';
}
function startText(at, index = -1) {
  if (!doc) return;
  const a = index >= 0 ? { ...list[index] } : { type: 'text', x: r1(at.x), y: r1(at.y), text: '', color: color(), size: Kit.WIDTHS.text[S.width] };
  editing = { index, a };
  sel = -1;
  el.text.value = a.text;
  el.text.hidden = false;
  placeTextEditor();
  el.text.focus();
  el.text.setSelectionRange(a.text.length, a.text.length);
  redraw();
}
function commitText() {
  if (!editing) return;
  const { index, a } = editing;
  editing = null;
  const text = el.text.value.replace(/\s+$/, '');
  el.text.hidden = true;
  if (index >= 0) {
    if (!text) list = list.filter((_, i) => i !== index);
    else if (text !== list[index].text) list = list.map((x, i) => (i === index ? { ...a, text, ...measure({ ...a, text }) } : x));
  } else if (text) list = [...list, { ...a, text, ...measure({ ...a, text }) }];
  commit();
  redraw();
}
function cancelText() {
  if (!editing) return;
  editing = null;
  el.text.hidden = true;
  redraw();
}
el.text.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitText(); }
  else if (e.key === 'Escape') { e.preventDefault(); cancelText(); }
});
el.text.addEventListener('input', () => { if (editing) { editing.a.text = el.text.value; placeTextEditor(); } });
el.text.addEventListener('blur', () => { if (editing) commitText(); });

/* ---------------- Tool, colour, width ---------------- */
function setTool(t) {
  if (!TOOLS.includes(t)) return;
  if (editing) commitText();
  cancelDraft();
  S.tool = t;
  if (t !== 'select') sel = -1;
  saveSettings();
  renderTools();
  renderStatus();
  redraw();
}
function setColor(i) {
  S.color = i;
  saveSettings();
  // the selected annotation takes the colour too (one step)
  if (sel >= 0 && list[sel] && list[sel].type !== 'pixelate') { list = list.map((a, k) => (k === sel ? { ...a, color: color() } : a)); commit(); }
  if (editing) { editing.a.color = color(); placeTextEditor(); }
  renderTools();
}
function setWidth(i) {
  S.width = i;
  saveSettings();
  renderTools();
}
for (const b of document.querySelectorAll('.tool')) b.addEventListener('click', () => setTool(b.dataset.tool));
for (const b of document.querySelectorAll('.swatch')) b.addEventListener('click', () => setColor(+b.dataset.color));
for (const b of document.querySelectorAll('.width')) b.addEventListener('click', () => setWidth(+b.dataset.width));
for (const b of document.querySelectorAll('.tbtn')) b.addEventListener('mousedown', (e) => e.preventDefault()); // the text keeps the keyboard

/* ---------------- What leaves the editor ---------------- */
function exportCanvas() {
  const c = document.createElement('canvas');
  c.width = doc.w;
  c.height = doc.h;
  const g = c.getContext('2d');
  g.putImageData(doc.data, 0, 0);
  Kit.render(g, list, { pixels: pixelsOf });
  return c;
}
async function exportPng() {
  const c = exportCanvas();
  const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}
// copy, save, saveAs, view (NeuralView), pin; resolves to true when it worked
async function act(kind) {
  if (!doc || busy) return false;
  if (editing) commitText();
  busy = true;
  try {
    const png = await exportPng();
    const r = await snap.exportAs(kind, doc.id, png, doc.hist.dirty);
    if (!r || !r.ok) { if (r && r.error) toast(r.error, 7000, true); return false; }
    if (r.file) { doc.file = r.file; doc.name = r.name || doc.name; }
    if (r.saved) { doc.hist.markSaved(); snap.setDirty(false); }
    if (r.toast) toast(r.toast);
    renderAll();
    return true;
  } catch (e) {
    toast(String(e.message || e), 7000, true);
    return false;
  } finally {
    busy = false;
  }
}
async function newCapture() {
  if (editing) commitText();
  const r = await snap.capture();
  if (r && !r.ok && r.error) toast(r.error, 7000, true);
}
const ACTIONS = { undo, redo, delete: deleteSelected, copy: () => act('copy'), save: () => act('save'), saveAs: () => act('saveAs'), view: () => act('view'), pin: () => act('pin'), new: newCapture };
for (const b of document.querySelectorAll('[data-act]')) b.addEventListener('click', () => ACTIONS[b.dataset.act]());
$('#empty-new').addEventListener('click', newCapture);
$('#empty-folder').addEventListener('click', openFolder);
async function openFolder() {
  const err = await snap.openFolder();
  if (err) toast(err, 6000, true);
}

/* ---------------- Rendering the chrome ---------------- */
function renderTools() {
  for (const b of document.querySelectorAll('.tool')) b.setAttribute('aria-pressed', String(b.dataset.tool === S.tool));
  for (const b of document.querySelectorAll('.swatch')) b.setAttribute('aria-pressed', String(+b.dataset.color === S.color));
  for (const b of document.querySelectorAll('.width')) b.setAttribute('aria-pressed', String(+b.dataset.width === S.width));
  el.stage.dataset.tool = S.tool;
  el.stage.classList.toggle('over-item', false);
}
function renderActions() {
  const has = !!doc;
  for (const b of document.querySelectorAll('[data-act]')) if (b.dataset.act !== 'new') b.disabled = !has;
  $('#act-undo').disabled = !has || !doc.hist.canUndo;
  $('#act-redo').disabled = !has || !doc.hist.canRedo;
  $('#act-delete').disabled = !has || !(sel >= 0 && list[sel]);
}
function renderStatus() {
  el.size.textContent = doc ? T('status.size', { w: N0.format(doc.w), h: N0.format(doc.h) }) : '';
  el.zoom.textContent = doc ? T('status.zoom', { v: P0.format(zoom()) }) : '';
  el.tool.textContent = T('tool.' + S.tool);
  el.file.textContent = doc ? doc.name || T('status.unsaved') : T('status.none');
  el.file.title = doc && doc.file ? doc.file : '';
  el.file.classList.toggle('dirty', !!doc && doc.hist.dirty);
  el.file.classList.toggle('none', !doc || !doc.name);
}
function renderAll() { renderTools(); renderActions(); renderStatus(); }
let shortcut = { accel: '', ok: true, error: '' };
function renderShortcut() {
  el.emptyKey.textContent = shortcut.ok ? shortcut.accel : '';
  // a shortcut that could not be registered is said on the empty screen too (and in the settings)
  const warn = $('#empty-warn');
  warn.hidden = shortcut.ok || recording;
  warn.textContent = warn.hidden ? '' : shortcut.error || T('err.shortcut-taken', { accel: shortcut.accel });
  $('#act-new').title = T('act.new.tip') + (shortcut.ok ? ` · ${shortcut.accel}` : '');
  const b = $('#set-shortcut');
  if (!recording) b.textContent = shortcut.accel || '—';
}
async function renderRecent() {
  if (doc) return;
  const items = await snap.recent();
  el.recentWrap.hidden = !items.length;
  el.recent.replaceChildren(...items.map((r) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'thumb';
    b.title = r.name;
    b.innerHTML = `<img alt="" loading="lazy" decoding="async"><span>${esc(r.name)}</span>`;
    $('img', b).src = r.url;
    b.addEventListener('click', async () => { if (!(await snap.openFile(r.path))) toast(T('err.open', { name: r.name }), 6000, true); });
    return b;
  }));
}

/* ---------------- Toasts, menus, dialogs ---------------- */
let toastTimer = 0;
function toast(msg, ms = 2600, error = false) {
  el.toast.textContent = msg;
  el.toast.classList.toggle('error', error);
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), ms);
}
// The series language: a pick shows from the next start, so only the note changes now.
const languages = NeuralI18n.languageChoices(window, (note) => toast(note, 6000));
// New versions of the series (update-check.js): the switch, and the newer version when one is known.
const upd = NeuralI18n.updates(window, T);
let menu = null;
function openMenu(items, btn, at) {
  closeMenu();
  const back = document.activeElement;
  const pop = document.createElement('div');
  pop.className = 'popup';
  pop.setAttribute('role', 'menu');
  const build = (items2, host) => {
    for (const it of items2) {
      if (it === '-') { host.appendChild(document.createElement('hr')); continue; }
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mi';
      b.disabled = !!it.disabled;
      b.setAttribute('role', 'menuitem');
      const checked = it.check ? it.check() : it.radio ? it.radio() : false;
      b.innerHTML = `<span class="chk">${checked ? (it.radio ? '●' : '✓') : ''}</span><span>${esc(it.label)}</span><span class="k">${esc(it.key || '')}</span><span class="arr">${it.sub ? '›' : ''}</span>`;
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => {
        if (it.sub) { pop.textContent = ''; build(it.sub, pop); pop.querySelector('.mi:not(:disabled)')?.focus(); return; }
        closeMenu();
        it.run();
      });
      host.appendChild(b);
    }
  };
  build(items, pop);
  el.popups.appendChild(pop);
  if (btn) {
    const r = btn.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(r.right - pop.offsetWidth, innerWidth - pop.offsetWidth - 8)) + 'px';
    pop.style.top = (r.bottom + 4) + 'px';
    btn.classList.add('open');
  } else {
    pop.style.left = Math.max(8, Math.min(at.x, innerWidth - pop.offsetWidth - 8)) + 'px';
    pop.style.top = Math.max(8, Math.min(at.y, innerHeight - pop.offsetHeight - 8)) + 'px';
  }
  menu = { pop, btn, back };
  pop.querySelector('.mi:not(:disabled)')?.focus();
  pop.addEventListener('keydown', (e) => {
    const all = [...pop.querySelectorAll('.mi:not(:disabled)')];
    const i = all.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); all[(i + 1) % all.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); all[(i - 1 + all.length) % all.length].focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); }
  });
}
function closeMenu() {
  if (!menu) return;
  const { pop, btn, back } = menu;
  menu = null;
  pop.remove();
  if (btn) btn.classList.remove('open');
  if (back && back !== document.body && document.contains(back)) back.focus({ preventScroll: true });
}
document.addEventListener('mousedown', (e) => {
  if (menu && !menu.pop.contains(e.target) && !(menu.btn && menu.btn.contains(e.target))) closeMenu();
}, true);
window.addEventListener('blur', closeMenu);

$('#menu-btn').addEventListener('click', (e) => {
  if (menu && menu.btn === e.currentTarget) { closeMenu(); return; }
  openMenu([
    { label: T('menu.settings'), run: openSettings },
    { label: T('menu.folder'), run: openFolder },
    '-',
    { label: T('menu.theme'), sub: [
      ...THEMES.map((th) => ({ label: th.name, radio: () => S.theme === th.id, run: () => setTheme(th.id) })),
      '-',
      { label: T('menu.theme-sync'), check: () => S.syncTheme, run: toggleThemeSync },
    ] },
    { label: T('lang.menu'), sub: languages().map((l) => ({ label: l.label, radio: l.checked, run: l.pick })) },
    { label: T('update.check'), check: upd.enabled, run: upd.toggle },
    ...(upd.latest() ? [{ label: upd.latestLabel(), run: upd.open }] : []),
    '-',
    { label: T('menu.keys'), key: 'F1', run: openShortcuts },
    { label: T('menu.about'), run: openAbout },
  ], e.currentTarget);
});

function ask(dlg, focus) {
  return new Promise((res) => {
    closeMenu();
    const back = document.activeElement;
    dlg.returnValue = '';
    dlg.showModal();
    if (focus) focus.focus();
    dlg.addEventListener('close', () => {
      res(dlg.returnValue || 'cancel');
      if (back && back !== document.body && document.contains(back)) back.focus({ preventScroll: true });
    }, { once: true });
  });
}
// Unsaved annotations: Kaydet / Atla / Vazgeç. kind: 'capture' (a new capture came) or 'quit'.
async function askUnsaved(kind) {
  const d = $('#dlg-unsaved');
  if (d.open) d.close('cancel');
  $('#unsaved-text').textContent = T(kind === 'quit' ? 'unsaved.quit' : 'unsaved.capture');
  return ask(d, $('#unsaved-save'));
}
async function confirmQuit() {
  if (editing) commitText();
  if (!doc || !doc.hist.dirty) { snap.quitAnswer(true); return; }
  const a = await askUnsaved('quit');
  if (a === 'cancel' || (a === 'save' && !(await act('save')))) { snap.quitAnswer(false); return; }
  snap.quitAnswer(true);
}

const SHORTCUTS = () => [
  [T('tool.select'), 'V'], [T('tool.arrow'), 'A'], [T('tool.rect'), 'R'], [T('tool.pen'), 'P'], [T('tool.text'), 'T'],
  [T('tool.highlight'), 'H'], [T('tool.pixelate'), 'B'], [T('keys.colors'), '1 – 5'], [T('keys.straight'), T('keys.straight.k')],
  [T('act.undo'), 'Ctrl+Z'], [T('act.redo'), 'Ctrl+Y / Ctrl+Shift+Z'], [T('keys.delete'), 'Del'],
  [T('keys.text-line'), 'Shift+Enter'], [T('keys.text-done'), T('keys.text-done.k')],
  [T('act.copy'), 'Ctrl+C'], [T('act.save'), 'Ctrl+S'], [T('act.saveas'), 'Ctrl+Shift+S'], [T('act.pin'), 'Ctrl+P'], [T('act.new'), 'Ctrl+N'],
  [T('keys.zoom'), T('keys.zoom.k')], [T('keys.fit'), 'Ctrl+0'], [T('keys.actual'), 'Ctrl+1'], [T('keys.pan'), T('keys.pan.k')],
  [T('keys.capture'), shortcut.accel || '—'], [T('keys.overlay'), T('keys.overlay.k')], [T('keys.help'), 'F1'],
];
function openShortcuts() {
  $('#keys-list').innerHTML = SHORTCUTS().map(([a, k]) => `<span>${esc(a)}</span><span class="kk">${esc(k)}</span>`).join('');
  ask($('#dlg-keys'));
}
let info = { version: '', saveDir: '', settings: { autoSave: true, openEditor: true } };
function openAbout() {
  $('#about-hint').textContent = T('about.hint', { version: info.version });
  ask($('#dlg-about'));
}

/* ---------------- Settings dialog: shortcut, auto-save, editor ---------------- */
let recording = false;
function renderSettings() {
  const st = info.settings || {};
  $('#set-autosave').setAttribute('aria-checked', String(!!st.autoSave));
  $('#set-editor').setAttribute('aria-checked', String(!!st.openEditor));
  $('#set-dir').textContent = info.saveDir || '';
  $('#set-dir').title = info.saveDir || '';
  renderShortcut();
  const m = $('#set-msg');
  if (!shortcut.ok && !recording && !m.textContent) { m.classList.add('err'); m.textContent = shortcut.error || T('err.shortcut-taken', { accel: shortcut.accel }); }
}
async function openSettings() {
  info = (await snap.info()) || info;
  shortcut = info.shortcut || shortcut;
  const m = $('#set-msg');
  m.textContent = '';
  m.classList.remove('err');
  renderSettings();
  const d = $('#dlg-settings');
  if (d.open) return;
  await ask(d, $('#set-ok'));
  if (recording) await stopRecording();
}
async function toggleSetting(key) {
  const patch = { [key]: !info.settings[key] };
  info.settings = await snap.set(patch);
  renderSettings();
}
$('#set-autosave').addEventListener('click', () => toggleSetting('autoSave'));
$('#set-editor').addEventListener('click', () => toggleSetting('openEditor'));
$('#set-folder').addEventListener('click', openFolder);
async function startRecording() {
  recording = true;
  const b = $('#set-shortcut');
  b.classList.add('capturing');
  b.textContent = T('set.press');
  const m = $('#set-msg');
  m.classList.remove('err');
  m.textContent = T('set.capture');
  await snap.recordShortcut(true);
}
async function stopRecording(result) {
  recording = false;
  $('#set-shortcut').classList.remove('capturing');
  const s = result || await snap.recordShortcut(false);
  shortcut = s;
  renderShortcut();
  return s;
}
// An Electron accelerator from a key press, or null while only modifiers are held (as NeuralDeck).
function accelOf(e) {
  const c = e.code;
  let key = null;
  if (c === 'Space') key = 'Space';
  else if (/^Key[A-Z]$/.test(c)) key = c.slice(3);
  else if (/^Digit[0-9]$/.test(c)) key = c.slice(5);
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(c)) key = c;
  else if (/^Arrow(Up|Down|Left|Right)$/.test(c)) key = c.slice(5);
  else if (c === 'PrintScreen') key = 'PrintScreen';
  if (!key) return null;
  return [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super', key].filter(Boolean).join('+');
}
$('#set-shortcut').addEventListener('click', () => { if (!recording) startRecording(); });
window.addEventListener('keydown', async (e) => {
  if (!recording) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.key === 'Escape') { await stopRecording(); $('#set-msg').textContent = T('set.unchanged'); return; }
  const accel = accelOf(e);
  if (!accel) return;
  const r = await snap.setShortcut(accel);
  await stopRecording(r);
  const m = $('#set-msg');
  m.classList.toggle('err', !!r.error);
  m.textContent = r.error ? r.error + (r.ok ? ' ' + T('set.kept', { accel: r.accel }) : '') : T('set.new', { accel: r.accel });
}, true);
$('#dlg-settings').addEventListener('cancel', (e) => { if (recording) e.preventDefault(); });

/* ---------------- Keyboard ---------------- */
document.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || recording || document.querySelector('dialog[open]') || e.target === el.text) return;
  const key = e.key;
  const low = key.length === 1 ? key.toLowerCase() : key;
  if ((e.ctrlKey || e.metaKey) && !e.altKey) {
    if (low === 'z' && !e.shiftKey) undo();
    else if (low === 'y' || (low === 'z' && e.shiftKey)) redo();
    else if (low === 'c' && !e.shiftKey) act('copy');
    else if (low === 's') act(e.shiftKey ? 'saveAs' : 'save');
    else if (low === 'p') act('pin');
    else if (low === 'n') newCapture();
    else if (key === '+' || key === '=' || e.code === 'NumpadAdd') zoomStep(1);
    else if (key === '-' || e.code === 'NumpadSubtract') zoomStep(-1);
    else if (key === '0' || e.code === 'Numpad0') fitView();
    else if (key === '1' || e.code === 'Numpad1') zoomTo(1);
    else return;
    e.preventDefault();
    return;
  }
  if (e.altKey) return;
  if (key === 'F1') openShortcuts();
  else if (!e.shiftKey && TOOL_KEYS[low] && !menu) setTool(TOOL_KEYS[low]);
  else if (/^[1-5]$/.test(key) && !menu) setColor(+key - 1);
  else if ((key === 'Delete' || key === 'Backspace') && sel >= 0) deleteSelected();
  else if (key === 'Escape') { if (menu) closeMenu(); else if (draft || drag) cancelDraft(); else if (sel >= 0) { sel = -1; redraw(); } else return; }
  else if (key === ' ' && doc) { if (!spaceDown) { spaceDown = true; el.stage.classList.add('pan'); } }
  else return;
  e.preventDefault();
});
document.addEventListener('keyup', (e) => { if (e.key === ' ') { spaceDown = false; el.stage.classList.remove('pan'); } });

/* ---------------- Window ---------------- */
// Without the focus the beam rests (see styles.css); the recent captures are read again when the window comes back.
const idle = () => root.classList.toggle('idle', !document.hasFocus());
window.addEventListener('focus', () => { idle(); renderRecent(); });
window.addEventListener('blur', () => { idle(); spaceDown = false; el.stage.classList.remove('pan'); });
idle();
for (const id of ['win-min', 'win-max', 'win-close']) $('#' + id).addEventListener('mousedown', (e) => e.preventDefault());
$('#win-min').addEventListener('click', () => snap.minimize());
$('#win-max').addEventListener('click', () => snap.toggleMaximize());
$('#win-close').addEventListener('click', () => snap.close());
$('.band').addEventListener('dblclick', (e) => { if (!e.target.closest('.win-btns')) snap.toggleMaximize(); });
for (const h of document.querySelectorAll('.rz')) {
  h.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    h.setPointerCapture(e.pointerId);
    snap.resizeStart(h.dataset.edge);
    const end = () => { h.removeEventListener('pointerup', end); h.removeEventListener('lostpointercapture', end); snap.resizeEnd(); };
    h.addEventListener('pointerup', end);
    h.addEventListener('lostpointercapture', end);
  });
}

// For the tests: the document, the annotations and the view, in image pixels.
window.snapTest = {
  doc: () => (doc ? { id: doc.id, w: doc.w, h: doc.h, file: doc.file, name: doc.name, dirty: doc.hist.dirty, canUndo: doc.hist.canUndo, canRedo: doc.hist.canRedo, count: list.length } : null),
  list: () => JSON.parse(JSON.stringify(list)),
  sel: () => sel,
  tool: () => S.tool,
  editing: () => !!editing,
  view: () => ({ s: view.s, ox: view.ox, oy: view.oy, fit: view.fit, zoom: zoom() }),
  toClient: (x, y) => { const r = el.stage.getBoundingClientRect(); return { x: r.left + view.ox + x * view.s, y: r.top + view.oy + y * view.s }; },
  act: (kind) => act(kind),
};

/* ---------------- Start ---------------- */
// A program that follows the series starts with the series theme (it may have changed while this one was closed).
const seriesTheme = await snap.themeInit(S.theme, S.syncTheme);
if (seriesTheme !== S.theme && THEMES.some((t) => t.id === seriesTheme)) { S.theme = seriesTheme; saveSettings(); }
applyTheme();
info = (await snap.info()) || info;
shortcut = info.shortcut || shortcut;
renderShortcut();
renderAll();
ready = true;
for (const f of early.splice(0)) f();
if (!doc) renderRecent();

})();
