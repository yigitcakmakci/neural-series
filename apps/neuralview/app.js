/* ============================================================
   NeuralView — image viewer behavior: the folder of the open image, zoom and pan, rotation, information,
   file operations and the series' menus.
   ============================================================ */
'use strict';
(async () => {

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const readJSON = k => { try { return JSON.parse(localStorage.getItem(k)) || null; } catch { return null; } };

/* Desktop shell (Electron). Opened in a plain browser, the file operations stay disabled. */
const NOOP = () => {};
const NO_SHELL = { ok: false, error: 'Bu işlem yalnızca masaüstü uygulamasında çalışır.' };
const vw = window.vw || {
  minimize: NOOP, toggleMaximize: NOOP, setFull: NOOP, close: () => window.close(), closeAck: NOOP, confirmClose: () => window.close(),
  onCloseRequest: NOOP, onMaximized: NOOP, onFull: NOOP, resizeStart: NOOP, resizeEnd: NOOP,
  onOpenPaths: NOOP, pendingPaths: async () => [], openDialog: async () => null, list: async () => NO_SHELL, watch: NOOP,
  onDirChanged: NOOP, meta: async () => NO_SHELL, copyImage: async () => NO_SHELL, copyText: async () => NO_SHELL,
  trash: async () => NO_SHELL, rename: async () => NO_SHELL, showInNav: async () => NO_SHELL, hasNav: async () => false,
  saveRotation: async () => NO_SHELL, pathForFile: () => '',
};

const root = document.documentElement;
const app = $('#app');
const stage = $('#stage');
const viewport = $('#viewport');
const stripEl = $('#strip');
const infoEl = $('#info');
const menubar = $('#menubar');
const popupsEl = $('#popups');
const toastEl = $('#toast');
const bandTitle = $('#band-title');

const SETTINGS_KEY = 'neuralview.settings';

// Paths handed in from outside (a second launch) wait in a queue until startup has finished
const incoming = [];
let started = false;
vw.onOpenPaths(paths => { if (started) openPath(paths[0]); else incoming.push(...paths); });

/* ---------------- Settings ---------------- */
const THEMES = [
  { id: 'neon', name: 'Neon' },
  { id: 'ice', name: 'Buz' },
  { id: 'alarm', name: 'Alarm' },
  { id: 'daylight', name: 'Gündüz' },
];
const SORTS = [
  { id: 'name', name: 'Ad' },
  { id: 'date', name: 'Değiştirilme tarihi' },
  { id: 'size', name: 'Boyut' },
];
const INTERVALS = [2, 3, 5, 10];
const DEFAULTS = { theme: 'neon', sort: 'name', desc: false, info: false, strip: true, checker: false, interval: 3, lastDir: '', v: 1 };
const S = Object.assign({}, DEFAULTS, readJSON(SETTINGS_KEY));
if (!THEMES.some(t => t.id === S.theme)) S.theme = DEFAULTS.theme;
if (!SORTS.some(s => s.id === S.sort)) S.sort = DEFAULTS.sort;
if (!INTERVALS.includes(S.interval)) S.interval = DEFAULTS.interval;

function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(S)); } catch { /* storage may be unavailable */ }
}
function applySettings() {
  for (const t of THEMES) root.classList.toggle('theme-' + t.id, t.id === S.theme);
  app.classList.toggle('no-strip', !S.strip);
  stage.classList.toggle('checker', S.checker);
  infoEl.hidden = !S.info;
  renderInfo();
  requestAnimationFrame(applyView);
}
function setSetting(k, v) {
  S[k] = v;
  saveSettings();
  applySettings();
}

/* ---------------- Files ---------------- */
// Extension → how the file is handled. HEIC/HEIF are listed so that they can be explained.
const KINDS = {
  jpg: 'jpeg', jpeg: 'jpeg', jpe: 'jpeg', jfif: 'jpeg', png: 'png', gif: 'gif', webp: 'webp', bmp: 'bmp', dib: 'bmp',
  ico: 'ico', svg: 'svg', avif: 'avif', heic: 'heic', heif: 'heic',
};
const FORMAT_NAMES = { jpeg: 'JPEG', png: 'PNG', gif: 'GIF', webp: 'WebP', bmp: 'BMP', ico: 'ICO', svg: 'SVG', avif: 'AVIF', heic: 'HEIC' };
const extOf = p => { const m = /\.([^.\\/]+)$/.exec(p); return m ? m[1].toLowerCase() : ''; };
const kindOf = p => KINDS[extOf(p)] || null;
const baseName = p => p.split(/[\\/]/).pop();
const samePath = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const version = e => `${Math.round(e.mtime)}-${e.size}`;
const urlOf = (scheme, e) => `${scheme}://f/${encodeURIComponent(e.path)}?v=${version(e)}`;

const collator = new Intl.Collator('tr', { numeric: true, sensitivity: 'base' });
const fmtN = n => n.toLocaleString('tr-TR');
function fmtBytes(n) {
  if (n < 1024) return `${fmtN(n)} bayt`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024, u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
  return `${v.toLocaleString('tr-TR', { maximumFractionDigits: v < 10 ? 1 : 0 })} ${units[u]}`;
}
const fmtDate = ms => (ms > 0 ? new Date(ms).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

let dir = null;        // folder of the open image
let list = [];         // its images, sorted
let index = -1;
let cur = null;        // { entry, kind, el, w, h, ok, meta }
let loadSeq = 0;

function sortList() {
  const byName = (a, b) => collator.compare(a.name, b.name);
  const cmp = S.sort === 'date' ? (a, b) => a.mtime - b.mtime || byName(a, b)
    : S.sort === 'size' ? (a, b) => a.size - b.size || byName(a, b)
    : byName;
  list.sort(S.desc ? (a, b) => cmp(b, a) : cmp);
}
function resort() {
  const e = cur && cur.entry;
  sortList();
  index = e ? list.indexOf(e) : -1;
  renderStrip();
  updateChrome();
}

// Opens a file (its folder becomes the list) or a folder (its first image).
async function openPath(p) {
  if (!p) return false;
  if (!(await settleRotation())) return false;
  const r = await vw.list(p);
  if (!r.ok) { toast(`Açılamadı: ${r.error}`); return false; }
  stopSlideshow();
  dir = r.dir;
  S.lastDir = dir;
  saveSettings();
  list = r.entries;
  sortList();
  let i = list.findIndex(e => samePath(e.path, p));
  if (i < 0 && !samePath(r.dir, p)) toast(`Bu dosya NeuralView'in açtığı bir resim değil: ${baseName(p)}`);
  if (i < 0) i = list.length ? 0 : -1;
  vw.watch(dir);
  renderStrip();
  await show(i);
  return true;
}

async function openDialog() {
  const p = await vw.openDialog(dir || S.lastDir);
  if (p) await openPath(p);
}

// Shows image i of the list (or the empty screen).
async function show(i) {
  const seq = ++loadSeq;
  index = i;
  view.rot = 0;
  updateRotbar();
  const e = list[i] || null;
  updateStripActive();
  setNotice(null);
  if (!e) {
    cur = null;
    viewport.replaceChildren();
    $('#empty').hidden = false;
    $('#empty-text').innerHTML = dir
      ? 'Bu klasörde NeuralView\'in açabileceği bir resim yok. Başka bir resim açmak için <kbd>Ctrl+O</kbd>.'
      : 'Bir resim açmak için <kbd>Ctrl+O</kbd> tuşlarına bas ya da resmi buraya sürükle.';
    updateChrome();
    return;
  }
  $('#empty').hidden = true;
  const kind = kindOf(e.path);
  cur = { entry: e, kind, el: null, w: 0, h: 0, ok: false, meta: null };
  const c = cur;
  updateChrome();
  vw.meta(e.path).then(m => {
    if (c !== cur) return;
    c.meta = m && m.ok ? m : null;
    updateChrome();
  });

  if (kind === 'heic') {
    viewport.replaceChildren();
    setNotice('HEIC açılamıyor',
      'NeuralView, resimleri Chromium motoruyla çizer ve bu motor HEIC/HEIF biçimini çözemez. Resmi telefonundan ya da Fotoğraflar uygulamasından JPG veya PNG olarak dışa aktarıp yeniden aç. Bilgi paneli (I) dosyanın ayrıntılarını yine gösterir.');
    return;
  }
  const im = new Image();
  im.crossOrigin = 'anonymous'; // the protocol answers with CORS headers, so the canvas stays readable
  im.decoding = 'async';
  im.draggable = false;
  im.alt = e.name;
  im.src = urlOf('nvimg', e);
  try {
    await im.decode();
  } catch {
    if (seq !== loadSeq) return;
    viewport.replaceChildren();
    setNotice('Resim açılamadı', `"${e.name}" çözülemedi: dosya bozuk, yarım inmiş ya da uzantısıyla içeriği uyuşmuyor.`);
    return;
  }
  if (seq !== loadSeq) return;
  // An SVG is sized by its own width/height or viewBox (Chromium gives one with only a viewBox a 300x150-like
  // default box); without either it gets a 4:3 frame.
  let w = im.naturalWidth, h = im.naturalHeight;
  if (kind === 'svg' || !w || !h) {
    const m = c.meta || (await vw.meta(e.path));
    if (seq !== loadSeq) return;
    if (m && m.width && m.height) { w = m.width; h = m.height; }
    else if (!w || !h) { w = 1024; h = 768; }
  }
  im.style.width = w + 'px';
  im.style.height = h + 'px';
  Object.assign(c, { el: im, w, h, ok: true });
  view.fit = true;
  viewport.replaceChildren(im);
  applyView();
  updateChrome();
  preload(i);
}

// The neighbours are decoded ahead, so stepping through a folder does not flash.
function preload(i) {
  for (const j of [i + 1, i - 1]) {
    const e = list[(j + list.length) % list.length];
    if (!e || e === list[i] || kindOf(e.path) === 'heic') continue;
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.src = urlOf('nvimg', e);
    im.decode().catch(() => {});
  }
}

async function go(step, { wrapHud = true } = {}) {
  if (!list.length) return;
  if (!(await settleRotation())) return;
  let i = index + step;
  if (i >= list.length || i < 0) {
    i = (i + list.length) % list.length;
    if (wrapHud && list.length > 1) hud(step > 0 ? '↺ Klasörün başına dönüldü' : '↻ Klasörün sonuna geçildi');
  }
  await show(i);
}
async function goTo(i) {
  if (i === index || i < 0 || i >= list.length) return;
  if (!(await settleRotation())) return;
  await show(i);
}

function setNotice(title, text) {
  $('#notice').hidden = !title;
  if (!title) return;
  $('#notice-title').textContent = title;
  $('#notice-text').textContent = text;
}

/* ---------------- Zoom, pan, rotation ---------------- */
const view = { fit: true, scale: 1, tx: 0, ty: 0, rot: 0 }; // rot: quarter turns clockwise, on screen only until saved
const turns = () => ((view.rot % 4) + 4) % 4;
const MAX_SCALE = 32;

function shownSize() {
  return turns() % 2 ? [cur.h, cur.w] : [cur.w, cur.h];
}
function fitScale() {
  const r = stage.getBoundingClientRect();
  const pad = root.classList.contains('is-full') ? 0 : 20;
  const [bw, bh] = shownSize();
  return Math.min(1, (r.width - pad * 2) / bw, (r.height - pad * 2) / bh);
}
const minScale = () => Math.min(fitScale(), 1) * 0.5;
function canPan() {
  if (!cur || !cur.ok) return false;
  const r = stage.getBoundingClientRect();
  const [bw, bh] = shownSize();
  return bw * view.scale > r.width + 1 || bh * view.scale > r.height + 1;
}
function clampPan() {
  const r = stage.getBoundingClientRect();
  const [bw, bh] = shownSize();
  const mx = Math.max(0, (bw * view.scale - r.width) / 2);
  const my = Math.max(0, (bh * view.scale - r.height) / 2);
  view.tx = clamp(view.tx, -mx, mx);
  view.ty = clamp(view.ty, -my, my);
}
function applyView() {
  if (!cur || !cur.ok) { stage.classList.remove('pannable'); updateStatus(); return; }
  if (view.fit) { view.scale = fitScale(); view.tx = 0; view.ty = 0; }
  clampPan();
  cur.el.style.transform = `translate(${view.tx}px, ${view.ty}px) rotate(${view.rot * 90}deg) scale(${view.scale}) translate(-50%, -50%)`;
  cur.el.classList.toggle('pixel', view.scale >= 3);
  stage.classList.toggle('pannable', canPan());
  updateStatus();
}
function animateOnce() {
  if (!cur || !cur.el) return;
  cur.el.classList.add('anim');
  clearTimeout(animateOnce.t);
  animateOnce.t = setTimeout(() => cur && cur.el && cur.el.classList.remove('anim'), 220);
}

// Zooms to scale s keeping the screen point (cx, cy) still; without a point, around the middle.
function zoomTo(s, cx, cy) {
  if (!cur || !cur.ok) return;
  const r = stage.getBoundingClientRect();
  s = clamp(s, minScale(), MAX_SCALE);
  const ox = (cx ?? r.left + r.width / 2) - (r.left + r.width / 2);
  const oy = (cy ?? r.top + r.height / 2) - (r.top + r.height / 2);
  const k = s / view.scale;
  view.tx = ox - k * (ox - view.tx);
  view.ty = oy - k * (oy - view.ty);
  view.scale = s;
  view.fit = Math.abs(s - fitScale()) < 0.0005;
  applyView();
  hud(`%${Math.round(s * 100)}`);
}
const zoomBy = (f, cx, cy) => cur && cur.ok && zoomTo(view.scale * f, cx, cy);
function fit() {
  if (!cur || !cur.ok) return;
  view.fit = true;
  animateOnce();
  applyView();
  hud(`Sığdır · %${Math.round(view.scale * 100)}`);
}
function actualSize(cx, cy) {
  if (!cur || !cur.ok) return;
  animateOnce();
  zoomTo(1, cx, cy);
}

function rotate(d) {
  if (!cur || !cur.ok) return;
  view.rot += d;
  animateOnce();
  applyView();
  updateRotbar();
}

/* ---------------- Saving a rotation ---------------- */
// JPEG keeps its pixels (only the EXIF orientation changes); PNG, WebP and BMP are written again.
function rotationSupport() {
  if (!cur || !cur.ok) return null;
  const k = cur.kind;
  const animated = cur.meta && cur.meta.animated;
  if (k === 'jpeg') return 'JPEG: pikseller değişmez, yalnızca EXIF yön bilgisi güncellenir (kayıpsız).';
  if (k === 'png' && !animated) return 'PNG: resim döndürülüp kayıpsız olarak yeniden yazılır; dosyadaki ek metin bilgileri korunmaz.';
  if (k === 'webp' && !animated) return 'WebP: resim döndürülüp en yüksek kalitede yeniden kodlanır.';
  if (k === 'bmp') return 'BMP: resim döndürülüp yeniden yazılır.';
  return null;
}
function updateRotbar() {
  const t = cur && cur.ok ? turns() : 0;
  const bar = $('#rotbar');
  bar.hidden = !t;
  if (!t) return;
  const savable = !!rotationSupport();
  $('#rot-text').textContent = savable ? `${t * 90}° döndürüldü · kaydedilmedi` : `${t * 90}° döndürüldü · ${FORMAT_NAMES[cur.kind] || 'bu biçim'} için yalnızca ekranda`;
  $('#rot-save').hidden = !savable;
}

// Draws the image turned by t quarter turns at its full size.
function rotatedCanvas(t) {
  const c = document.createElement('canvas');
  const odd = t % 2 === 1;
  c.width = odd ? cur.h : cur.w;
  c.height = odd ? cur.w : cur.h;
  const g = c.getContext('2d');
  g.translate(c.width / 2, c.height / 2);
  g.rotate((t * Math.PI) / 2);
  g.drawImage(cur.el, -cur.w / 2, -cur.h / 2, cur.w, cur.h);
  return c;
}
const toBlob = (c, type, q) => new Promise(res => c.toBlob(res, type, q));

async function saveRotation() {
  const c = cur, e = c.entry, t = turns();
  let job;
  try {
    if (c.kind === 'jpeg') job = { kind: 'jpeg', quarterTurns: t };
    else if (c.kind === 'bmp') {
      const cv = rotatedCanvas(t);
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height);
      job = { kind: 'bmp', width: cv.width, height: cv.height, rgba: d.data };
    } else {
      const type = c.kind === 'png' ? 'image/png' : 'image/webp';
      const blob = await toBlob(rotatedCanvas(t), type, 1);
      if (!blob || blob.type !== type) throw new Error(`${FORMAT_NAMES[c.kind]} yazılamadı.`);
      job = { kind: 'encoded', bytes: new Uint8Array(await blob.arrayBuffer()) };
    }
  } catch (err) {
    toast(`Kaydedilemedi: ${err.message}`);
    return false;
  }
  const r = await vw.saveRotation(e.path, job);
  if (!r.ok) { toast(`Kaydedilemedi: ${r.error}`); return false; }
  e.size = r.size;
  e.mtime = r.mtime;
  toast(`"${e.name}" döndürülmüş olarak kaydedildi.`);
  return true;
}

// Before leaving an image with an unsaved rotation: true when it is fine to go on.
async function settleRotation() {
  if (!cur || !cur.ok || !turns()) return true;
  const detail = rotationSupport();
  if (!detail) return true; // shown turned only; nothing to save
  const r = await confirmDlg('Döndürme', `"${cur.entry.name}" ${turns() * 90}° döndürüldü. Kaydedilsin mi?`, detail,
    [['save', 'Kaydet', 'primary'], ['discard', 'Kaydetme'], ['cancel', 'İptal']]);
  if (r === 'cancel') return false;
  if (r === 'save' && !(await saveRotation())) return false;
  view.rot = 0;
  updateRotbar();
  return true;
}

async function saveRotationCmd() {
  if (!cur || !cur.ok || !turns()) { toast('Kaydedilecek bir döndürme yok.'); return; }
  const detail = rotationSupport();
  if (!detail) { toast(`${FORMAT_NAMES[cur.kind] || 'Bu'} biçiminde döndürme kaydedilemez; resim yalnızca ekranda döner.`); return; }
  const r = await confirmDlg('Döndürmeyi kaydet', `"${cur.entry.name}" ${turns() * 90}° döndürülmüş olarak kaydedilsin mi?`, detail,
    [['save', 'Kaydet', 'primary'], ['cancel', 'İptal']]);
  if (r !== 'save' || !(await saveRotation())) return;
  await show(index); // the file on disk is now the turned image
  refreshThumb(cur && cur.entry);
}
function undoRotation() {
  if (!turns()) return;
  view.rot = 0;
  animateOnce();
  applyView();
  updateRotbar();
}

/* ---------------- File operations ---------------- */
async function copyImage() {
  if (!cur || !cur.ok) { toast('Kopyalanacak bir resim yok.'); return; }
  const blob = await toBlob(rotatedCanvas(turns()), 'image/png');
  if (!blob) { toast('Resim panoya kopyalanamadı.'); return; }
  const r = await vw.copyImage(new Uint8Array(await blob.arrayBuffer()));
  toast(r.ok ? 'Resim panoya kopyalandı.' : r.error);
}
async function copyPath() {
  if (!cur) return;
  const r = await vw.copyText(cur.entry.path);
  toast(r.ok ? 'Dosya yolu panoya kopyalandı.' : r.error);
}

async function trashCurrent() {
  if (!cur) return;
  const e = cur.entry;
  const r = await confirmDlg('Sil', `"${e.name}" Geri Dönüşüm Kutusu'na taşınsın mı?`, 'Geri Dönüşüm Kutusu\'ndan geri yükleyebilirsin.',
    [['ok', 'Geri Dönüşüm Kutusu\'na taşı', 'danger'], ['cancel', 'İptal']]);
  if (r !== 'ok') return;
  const res = await vw.trash(e.path);
  if (!res.ok) { toast(`Silinemedi: ${res.error}`); return; }
  view.rot = 0;
  const i = list.indexOf(e);
  if (i >= 0) list.splice(i, 1);
  renderStrip();
  await show(Math.min(Math.max(i, 0), list.length - 1));
  toast(`"${e.name}" Geri Dönüşüm Kutusu'na taşındı.`);
}

async function renameCurrent() {
  if (!cur) return;
  if (!(await settleRotation())) return;
  const e = cur.entry;
  const dlg = $('#dlg-rename');
  const input = $('#rename-input');
  const err = $('#rename-error');
  input.value = e.name;
  err.textContent = '';
  const p = ask(dlg);
  const dot = e.name.lastIndexOf('.');
  input.focus();
  input.setSelectionRange(0, dot > 0 ? dot : e.name.length);
  const form = $('#rename-form');
  const onSubmit = async ev => {
    if (ev.submitter && ev.submitter.value === 'cancel') return;
    ev.preventDefault();
    const name = input.value.trim();
    if (name === e.name) { dlg.close('cancel'); return; }
    if (extOf(name) !== extOf(e.name) && !kindOf(name)) {
      err.textContent = 'Yeni uzantı bir resim uzantısı değil; dosya NeuralView listesinden çıkar.';
      if (!input.dataset.warned) { input.dataset.warned = '1'; return; }
    }
    const r = await vw.rename(e.path, name);
    if (!r.ok) { err.textContent = r.error; input.focus(); return; }
    e.path = r.path;
    e.name = baseName(r.path);
    dlg.close('ok');
  };
  form.addEventListener('submit', onSubmit);
  const res = await p;
  form.removeEventListener('submit', onSubmit);
  delete input.dataset.warned;
  if (res !== 'ok') { stage.focus(); return; }
  if (!kindOf(e.path)) {
    list.splice(list.indexOf(e), 1);
    renderStrip();
    await show(Math.min(index, list.length - 1));
  } else resort();
  toast(`Yeni adı: ${e.name}`);
  stage.focus();
}

async function showInNav() {
  if (!cur) return;
  const r = await vw.showInNav(cur.entry.path);
  if (!r.ok) toast(r.error);
  else if (r.via !== 'NeuralNav') toast('NeuralNav kurulu değil; dosya Windows Gezgini\'nde gösterildi.');
}

// The folder changed on disk (another program, or our own rename/delete/save): list it again, keep the image.
vw.onDirChanged(async d => {
  if (!dir || !samePath(d, dir)) return;
  const r = await vw.list(dir);
  if (!r.ok || !samePath(r.dir, dir)) return;
  const curPath = cur && cur.entry.path;
  const old = new Map(list.map(e => [e.path.toLowerCase(), e]));
  list = r.entries.map(n => {
    const o = old.get(n.path.toLowerCase());
    if (!o) return n;
    const changed = o.mtime !== n.mtime || o.size !== n.size;
    Object.assign(o, n);
    if (changed) o.changed = true;
    return o;
  });
  sortList();
  const i = curPath ? list.findIndex(e => samePath(e.path, curPath)) : -1;
  renderStrip();
  if (i >= 0) {
    index = i;
    const e = list[i];
    if (e.changed && !turns()) { e.changed = false; await show(i); }
    else { e.changed = false; updateStripActive(); updateChrome(); }
  } else if (curPath) {
    await show(Math.min(Math.max(index, 0), list.length - 1));
  } else if (list.length && index < 0) {
    await show(0);
  }
});

/* ---------------- Slideshow and full screen ---------------- */
let isFull = false;
let slideshow = null; // { timer, wasFull }
function setFull(on) { vw.setFull(on); }
vw.onFull(on => {
  isFull = on;
  root.classList.toggle('is-full', on);
  requestAnimationFrame(() => { applyView(); });
});
function startSlideshow() {
  if (!cur || list.length < 2) { toast('Slayt gösterisi için klasörde en az iki resim olmalı.'); return; }
  slideshow = { timer: null, wasFull: isFull };
  if (!isFull) setFull(true);
  scheduleSlide();
  hud(`▶ Slayt gösterisi · ${S.interval} sn · durdurmak için Boşluk`);
}
function scheduleSlide() {
  if (!slideshow) return;
  clearTimeout(slideshow.timer);
  slideshow.timer = setTimeout(async () => {
    if (!slideshow) return;
    if (!document.querySelector('dialog[open]')) await go(1, { wrapHud: false });
    scheduleSlide();
  }, S.interval * 1000);
}
function stopSlideshow() {
  if (!slideshow) return;
  clearTimeout(slideshow.timer);
  const was = slideshow.wasFull;
  slideshow = null;
  if (!was) setFull(false);
  hud('■ Slayt gösterisi durdu');
}
const toggleSlideshow = () => (slideshow ? stopSlideshow() : startSlideshow());

/* ---------------- Thumbnails ---------------- */
const thumbObserver = new IntersectionObserver(entries => {
  for (const en of entries) {
    if (!en.isIntersecting) continue;
    const b = en.target;
    thumbObserver.unobserve(b);
    loadThumb(b);
  }
}, { root: stripEl, rootMargin: '0px 400px' });

function loadThumb(b) {
  const e = b._entry;
  const kind = kindOf(e.path);
  const im = new Image();
  im.alt = '';
  im.decoding = 'async';
  // Windows' own thumbnail first (fast, cached by Explorer); the image itself when there is none.
  im.onerror = () => {
    im.onerror = () => { b.replaceChildren(label(kind)); };
    if (kind === 'heic') { b.replaceChildren(label(kind)); return; }
    im.src = urlOf('nvimg', e);
  };
  im.src = urlOf('nvthumb', e);
  b.replaceChildren(im);
}
function label(kind) {
  const s = document.createElement('span');
  s.className = 'tlabel';
  s.textContent = FORMAT_NAMES[kind] || '?';
  return s;
}
function renderStrip() {
  thumbObserver.disconnect();
  const frag = document.createDocumentFragment();
  list.forEach((e, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'thumb';
    b.setAttribute('role', 'option');
    b.setAttribute('aria-selected', String(i === index));
    b.title = e.name;
    b.dataset.i = i;
    b._entry = e;
    b.tabIndex = -1;
    frag.appendChild(b);
  });
  stripEl.replaceChildren(frag);
  for (const b of stripEl.children) thumbObserver.observe(b);
  updateStripActive();
}
function updateStripActive() {
  for (const b of stripEl.querySelectorAll('.thumb[aria-selected="true"]')) b.setAttribute('aria-selected', 'false');
  const b = stripEl.children[index];
  if (!b) return;
  b.setAttribute('aria-selected', 'true');
  b.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'instant' });
}
function refreshThumb(e) {
  if (!e) return;
  const b = [...stripEl.children].find(x => x._entry === e);
  if (b) loadThumb(b);
}
stripEl.addEventListener('click', ev => {
  const b = ev.target.closest('.thumb');
  if (b) goTo(+b.dataset.i);
});
stripEl.addEventListener('wheel', ev => {
  if (Math.abs(ev.deltaY) > Math.abs(ev.deltaX)) { stripEl.scrollLeft += ev.deltaY; ev.preventDefault(); }
}, { passive: false });

/* ---------------- Information panel ---------------- */
const ORIENTATIONS = { 1: 'Normal', 2: 'Yatay aynalı', 3: '180° döndürülmüş', 4: 'Dikey aynalı', 5: 'Aynalı, 90° sola', 6: '90° sağa döndürülmüş', 7: 'Aynalı, 90° sağa', 8: '90° sola döndürülmüş' };
function exifDate(s) {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(s || ''));
  if (!m) return s ? String(s) : '';
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  return isNaN(d) ? String(s) : d.toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });
}
const deg = (v, pos, neg) => `${Math.abs(v).toLocaleString('tr-TR', { minimumFractionDigits: 5, maximumFractionDigits: 5 })}° ${v < 0 ? neg : pos}`;

function renderInfo() {
  if (!S.info) return;
  const rows = [];
  const add = (k, v) => { if (v !== undefined && v !== null && v !== '') rows.push(`<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`); };
  const sec = t => rows.push(`<div class="sec">${esc(t)}</div>`);
  let gps = null;
  if (!cur) {
    rows.push('<dd>Açık bir resim yok.</dd>');
  } else {
    const e = cur.entry, m = cur.meta || {};
    const w = cur.ok ? cur.w : m.width, h = cur.ok ? cur.h : m.height;
    sec('DOSYA');
    add('Ad', e.name);
    add('Klasör', dir);
    add('Biçim', (m.format || FORMAT_NAMES[cur.kind] || '?') + (m.animated ? ' · animasyonlu' : ''));
    if (w && h) add('Boyutlar', `${fmtN(w)} × ${fmtN(h)} piksel${w * h >= 100000 ? ` · ${(w * h / 1e6).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} MP` : ''}`);
    add('Dosya boyutu', `${fmtBytes(e.size)} (${fmtN(e.size)} bayt)`);
    add('Değiştirilme', fmtDate(e.mtime));
    add('Oluşturma', fmtDate(e.ctime));
    const x = m.exif;
    if (x) {
      sec('EXIF');
      const camera = [x.make, x.model].filter(Boolean);
      add('Kamera', camera.length === 2 && x.model.toLowerCase().startsWith(x.make.toLowerCase()) ? x.model : camera.join(' '));
      add('Objektif', x.lens);
      add('Çekim tarihi', exifDate(x.taken));
      if (x.exposure > 0) add('Pozlama', x.exposure < 1 ? `1/${Math.round(1 / x.exposure)} sn` : `${x.exposure.toLocaleString('tr-TR')} sn`);
      if (x.fNumber > 0) add('Diyafram', `f/${x.fNumber.toLocaleString('tr-TR', { maximumFractionDigits: 1 })}`);
      if (x.iso) add('ISO', String(x.iso));
      if (x.focal > 0) add('Odak uzaklığı', `${x.focal.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} mm${x.focal35 ? ` (35 mm karşılığı ${x.focal35} mm)` : ''}`);
      if (x.flash !== undefined) add('Flaş', x.flash & 1 ? 'Patladı' : 'Patlamadı');
      if (x.orientation && x.orientation !== 1) add('Yön', ORIENTATIONS[x.orientation] || String(x.orientation));
      add('Yazılım', x.software);
      add('Sanatçı', x.artist);
      add('Telif', x.copyright);
      add('Açıklama', x.description);
      gps = x.gps;
      if (gps) {
        sec('KONUM');
        if (Number.isFinite(gps.lat) && Number.isFinite(gps.lon)) {
          add('Enlem', deg(gps.lat, 'K', 'G'));
          add('Boylam', deg(gps.lon, 'D', 'B'));
        } else add('Koordinatlar', 'Okunamadı');
        if (Number.isFinite(gps.alt)) add('Yükseklik', `${gps.alt.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} m`);
      }
    } else if (cur.meta && ['jpeg', 'png', 'webp'].includes(cur.kind)) {
      sec('EXIF');
      rows.push('<dd class="none">Bu dosyada EXIF bilgisi yok.</dd>');
    }
  }
  $('#gps-warn').hidden = !gps;
  $('#info-list').innerHTML = rows.join('');
}
function toggleInfo() { setSetting('info', !S.info); }

/* ---------------- Status, title, read-outs ---------------- */
function updateTitle() {
  const name = cur ? cur.entry.name : 'NeuralView';
  bandTitle.textContent = name;
  document.title = cur ? `${name} - NeuralView` : 'NeuralView';
}
function updateStatus() {
  $('#st-pos').textContent = cur ? `${fmtN(index + 1)} / ${fmtN(list.length)}` : (dir ? `0 / 0` : '—');
  const m = cur && cur.meta;
  const w = cur && cur.ok ? cur.w : m && m.width, h = cur && cur.ok ? cur.h : m && m.height;
  $('#st-dims').textContent = w && h ? `${fmtN(w)} × ${fmtN(h)}` : '';
  $('#st-size').textContent = cur ? fmtBytes(cur.entry.size) : '';
  $('#st-fmt').textContent = cur ? (m && m.format) || FORMAT_NAMES[cur.kind] || '' : '';
  $('#st-zoom').textContent = cur && cur.ok ? `%${Math.round(view.scale * 100)}${view.fit ? ' · sığdır' : ''}` : '';
}
function updateChrome() {
  updateTitle();
  updateStatus();
  renderInfo();
  updateRotbar();
  const many = list.length > 1;
  $('#nav-prev').classList.toggle('on', many);
  $('#nav-next').classList.toggle('on', many);
}

let hudTimer = null;
function hud(text) {
  const h = $('#hud');
  h.textContent = text;
  h.classList.add('show');
  clearTimeout(hudTimer);
  hudTimer = setTimeout(() => h.classList.remove('show'), 1300);
}

let toastTimer = null;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2800);
}

/* ---------------- Dialogs ---------------- */
function ask(dlg) {
  return new Promise(res => {
    closeMenus(false);
    dlg.returnValue = '';
    dlg.showModal();
    dlg.addEventListener('close', () => res(dlg.returnValue || 'cancel'), { once: true });
  });
}
// buttons: [[value, label, 'primary' | 'danger' | undefined], ...]; the first one has the focus.
function confirmDlg(title, text, hint, buttons) {
  const dlg = $('#dlg-confirm');
  $('#confirm-title').textContent = title;
  $('#confirm-text').textContent = text;
  $('#confirm-hint').textContent = hint || '';
  const box = $('#confirm-btns');
  box.replaceChildren(...buttons.map(([value, label, cls]) => {
    const b = document.createElement('button');
    b.value = value;
    b.textContent = label;
    if (cls) b.className = cls;
    return b;
  }));
  const p = ask(dlg);
  box.firstChild.focus();
  return p.then(r => { stage.focus(); return r; });
}

const SHORTCUT_DOC = [
  ['Sonraki / önceki resim', '→ / ← · Tekerlek'],
  ['İlk / son resim', 'Home / End'],
  ['Yakınlaştır / uzaklaştır', 'Ctrl+Tekerlek · + / -'],
  ['Ekrana sığdır', '0 / Ctrl+0'],
  ['Gerçek boyut (%100)', '1 / Ctrl+1'],
  ['Sığdır ↔ %100', 'Çift tıklama'],
  ['Kaydırma (büyütülmüşken)', 'Sürükle · ↑ / ↓'],
  ['Sağa / sola döndür', 'R / Shift+R'],
  ['Döndürmeyi kaydet', 'Ctrl+S'],
  ['Bilgi paneli', 'I'],
  ['Küçük resim şeridi', 'T'],
  ['Tam ekran', 'F11'],
  ['Slayt gösterisi', 'Boşluk'],
  ['Tam ekrandan / slayttan çık', 'Esc'],
  ['Resmi panoya kopyala', 'Ctrl+C'],
  ['Dosya yolunu kopyala', 'Ctrl+Shift+C'],
  ['Konumu NeuralNav\'da aç', 'Ctrl+E'],
  ['Yeniden adlandır', 'F2'],
  ['Geri Dönüşüm Kutusu\'na taşı', 'Del'],
  ['Resim aç', 'Ctrl+O'],
  ['Menüye geç', 'F10 / Alt'],
  ['Bu liste', '? / F1'],
];
function openShortcuts() {
  $('#keys-list').innerHTML = SHORTCUT_DOC.map(([a, k]) => `<span>${esc(a)}</span><span class="kk">${esc(k)}</span>`).join('');
  ask($('#dlg-keys')).then(() => stage.focus());
}
function openAbout() {
  ask($('#dlg-about')).then(() => stage.focus());
}

/* ---------------- Menus ---------------- */
const hasImage = () => !!(cur && cur.ok);
const hasFile = () => !!cur;
const MENUS = [
  { label: 'Dosya', items: [
    { label: 'Aç...', key: 'Ctrl+O', run: openDialog },
    { label: 'Konumu NeuralNav\'da aç', key: 'Ctrl+E', run: showInNav, enabled: hasFile },
    '-',
    { label: 'Döndürmeyi kaydet', key: 'Ctrl+S', run: saveRotationCmd, enabled: () => hasImage() && !!turns() },
    { label: 'Yeniden adlandır...', key: 'F2', run: renameCurrent, enabled: hasFile },
    { label: 'Geri Dönüşüm Kutusu\'na taşı', key: 'Del', run: trashCurrent, enabled: hasFile },
    '-',
    { label: 'Çıkış', run: () => vw.close() },
  ] },
  { label: 'Düzenle', items: [
    { label: 'Resmi kopyala', key: 'Ctrl+C', run: copyImage, enabled: hasImage },
    { label: 'Dosya yolunu kopyala', key: 'Ctrl+Shift+C', run: copyPath, enabled: hasFile },
    '-',
    { label: 'Sağa döndür', key: 'R', run: () => rotate(1), enabled: hasImage },
    { label: 'Sola döndür', key: 'Shift+R', run: () => rotate(-1), enabled: hasImage },
    { label: 'Döndürmeyi geri al', run: undoRotation, enabled: () => hasImage() && !!turns() },
  ] },
  { label: 'Görünüm', items: [
    { label: 'Ekrana sığdır', key: '0', run: fit, enabled: hasImage },
    { label: 'Gerçek boyut (%100)', key: '1', run: () => actualSize(), enabled: hasImage },
    { label: 'Yakınlaştır', key: '+', run: () => zoomBy(1.25), enabled: hasImage },
    { label: 'Uzaklaştır', key: '-', run: () => zoomBy(0.8), enabled: hasImage },
    '-',
    { label: 'Bilgi paneli', key: 'I', check: () => S.info, run: toggleInfo },
    { label: 'Küçük resim şeridi', key: 'T', check: () => S.strip, run: () => setSetting('strip', !S.strip) },
    { label: 'Saydamlıkta dama deseni', check: () => S.checker, run: () => setSetting('checker', !S.checker) },
    { label: 'Tam ekran', key: 'F11', check: () => isFull, run: () => setFull(!isFull) },
    { label: 'Slayt gösterisi', key: 'Boşluk', check: () => !!slideshow, run: toggleSlideshow },
    '-',
    { label: 'Sırala', sub: () => [
      ...SORTS.map(s => ({ label: s.name, radio: () => S.sort === s.id, run: () => { S.sort = s.id; saveSettings(); resort(); } })),
      '-',
      { label: 'Ters sıra', check: () => S.desc, run: () => { S.desc = !S.desc; saveSettings(); resort(); } },
    ] },
    { label: 'Slayt süresi', sub: () => INTERVALS.map(n => ({ label: `${n} saniye`, radio: () => S.interval === n, run: () => { S.interval = n; saveSettings(); scheduleSlide(); } })) },
    { label: 'Tema', sub: () => THEMES.map(t => ({ label: t.name, radio: () => S.theme === t.id, run: () => setSetting('theme', t.id) })) },
  ] },
  { label: 'Yardım', items: [
    { label: 'Klavye kısayolları', key: 'F1', run: openShortcuts },
    { label: 'NeuralView hakkında', run: openAbout },
  ] },
];
const CONTEXT_ITEMS = () => [
  { label: 'Resmi kopyala', key: 'Ctrl+C', run: copyImage, enabled: hasImage },
  { label: 'Dosya yolunu kopyala', key: 'Ctrl+Shift+C', run: copyPath, enabled: hasFile },
  '-',
  { label: 'Sağa döndür', key: 'R', run: () => rotate(1), enabled: hasImage },
  { label: 'Sola döndür', key: 'Shift+R', run: () => rotate(-1), enabled: hasImage },
  { label: 'Ekrana sığdır', key: '0', run: fit, enabled: hasImage },
  { label: 'Gerçek boyut (%100)', key: '1', run: () => actualSize(), enabled: hasImage },
  '-',
  { label: 'Konumu NeuralNav\'da aç', key: 'Ctrl+E', run: showInNav, enabled: hasFile },
  { label: 'Yeniden adlandır...', key: 'F2', run: renameCurrent, enabled: hasFile },
  { label: 'Geri Dönüşüm Kutusu\'na taşı', key: 'Del', run: trashCurrent, enabled: hasFile },
  '-',
  { label: 'Bilgi paneli', key: 'I', check: () => S.info, run: toggleInfo },
];

let menuState = null; // { index, btn, stack: [popup, ...] }

function buildMenubar() {
  MENUS.forEach((m, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = m.label;
    b.setAttribute('role', 'menuitem');
    b.setAttribute('aria-haspopup', 'true');
    b.setAttribute('aria-expanded', 'false');
    b.addEventListener('click', () => {
      if (menuState && menuState.index === i) closeMenus();
      else openTopMenu(i, false);
    });
    b.addEventListener('mouseenter', () => {
      if (menuState && menuState.index !== -1 && menuState.index !== i) openTopMenu(i, false);
    });
    b.addEventListener('keydown', e => menubarKey(e, i));
    menubar.appendChild(b);
  });
}
function menubarKey(e, i) {
  const n = MENUS.length;
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    e.preventDefault();
    e.stopPropagation();
    const j = (i + (e.key === 'ArrowRight' ? 1 : -1) + n) % n;
    if (menuState) openTopMenu(j, true);
    else menubar.children[j].focus();
  } else if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    e.stopPropagation();
    openTopMenu(i, true);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeMenus();
  }
}
function focusMenubar() {
  closeMenus(false);
  menubar.children[0].focus();
}
function openTopMenu(i, focusFirst) {
  closeMenus(false);
  const b = menubar.children[i];
  const r = b.getBoundingClientRect();
  const pop = renderPopup(MENUS[i].items, r.left, r.bottom + 4, 0);
  b.setAttribute('aria-expanded', 'true');
  menuState = { index: i, btn: b, stack: [pop] };
  if (focusFirst) focusItem(pop, 0);
  else b.focus({ preventScroll: true });
}
function openContextMenu(x, y) {
  closeMenus(false);
  const pop = renderPopup(CONTEXT_ITEMS(), x, y, 0);
  menuState = { index: -1, btn: null, stack: [pop] };
  focusItem(pop, 0);
}
function renderPopup(items, x, y, level) {
  const pop = document.createElement('div');
  pop.className = 'popup';
  pop.setAttribute('role', 'menu');
  pop.dataset.level = level;
  for (const it of items) {
    if (it === '-') { pop.appendChild(document.createElement('hr')); continue; }
    const b = document.createElement('button');
    b.className = 'mi';
    b.type = 'button';
    const checked = it.check ? it.check() : it.radio ? it.radio() : false;
    b.setAttribute('role', it.check ? 'menuitemcheckbox' : it.radio ? 'menuitemradio' : 'menuitem');
    if (it.check || it.radio) b.setAttribute('aria-checked', String(checked));
    if (it.sub) b.setAttribute('aria-haspopup', 'true');
    b.innerHTML = `<span class="chk">${checked ? (it.radio ? '●' : '✓') : ''}</span><span>${esc(it.label)}</span><span class="k">${esc(it.key || '')}</span><span class="arr">${it.sub ? '›' : ''}</span>`;
    if (it.enabled && !it.enabled()) b.disabled = true;
    b._item = it;
    b.addEventListener('mousedown', e => e.preventDefault());
    b.addEventListener('click', () => {
      if (it.sub) { openSub(pop, b, true); return; }
      closeMenus(true);
      it.run();
    });
    b.addEventListener('mouseenter', () => {
      b.focus({ preventScroll: true });
      trimStack(pop);
      if (it.sub) openSub(pop, b, false);
    });
    pop.appendChild(b);
  }
  pop.addEventListener('keydown', popupKey);
  popupsEl.appendChild(pop);
  placePopup(pop, x, y);
  return pop;
}
function placePopup(pop, x, y, altX) {
  const w = pop.offsetWidth, h = pop.offsetHeight;
  const vw_ = innerWidth, vh = innerHeight;
  let left = x;
  if (left + w > vw_ - 8) left = altX !== undefined ? altX - w : vw_ - w - 8;
  let top = y;
  if (top + h > vh - 8) top = Math.max(8, vh - h - 8);
  pop.style.left = Math.max(8, left) + 'px';
  pop.style.top = top + 'px';
}
function trimStack(pop) {
  if (!menuState) return;
  const lvl = +pop.dataset.level;
  while (menuState.stack.length > lvl + 1) menuState.stack.pop().remove();
  pop.querySelectorAll('.mi.open').forEach(x => x.classList.remove('open'));
}
function openSub(pop, btn, focusFirst) {
  if (!menuState) return;
  trimStack(pop);
  btn.classList.add('open');
  const r = btn.getBoundingClientRect();
  const sub = renderPopup(btn._item.sub(), r.right - 2, r.top - 6, +pop.dataset.level + 1);
  placePopup(sub, r.right - 2, r.top - 6, r.left + 2);
  menuState.stack.push(sub);
  if (focusFirst) focusItem(sub, 0);
}
function focusItem(pop, idx) {
  const items = [...pop.querySelectorAll('.mi:not(:disabled)')];
  if (items.length) items[(idx + items.length) % items.length].focus({ preventScroll: true });
}
function popupKey(e) {
  const pop = e.currentTarget;
  const items = [...pop.querySelectorAll('.mi:not(:disabled)')];
  const cur_ = items.indexOf(document.activeElement);
  const lvl = +pop.dataset.level;
  const handled = () => { e.preventDefault(); e.stopPropagation(); };
  switch (e.key) {
    case 'ArrowDown': handled(); focusItem(pop, cur_ + 1); break;
    case 'ArrowUp': handled(); focusItem(pop, cur_ < 0 ? -1 : cur_ - 1); break;
    case 'Home': handled(); focusItem(pop, 0); break;
    case 'End': handled(); focusItem(pop, -1); break;
    case 'ArrowRight': {
      handled();
      const b = document.activeElement;
      if (b?._item?.sub) openSub(pop, b, true);
      else if (menuState.index >= 0) openTopMenu((menuState.index + 1) % MENUS.length, true);
      break;
    }
    case 'ArrowLeft':
      handled();
      if (lvl > 0) {
        const parent = menuState.stack[lvl - 1];
        trimStack(parent);
        parent.querySelector('.mi.open')?.classList.remove('open');
        focusParentOf(parent, pop);
      } else if (menuState.index >= 0) {
        openTopMenu((menuState.index - 1 + MENUS.length) % MENUS.length, true);
      }
      break;
    case 'Escape':
      handled();
      if (lvl > 0) {
        const parent = menuState.stack[lvl - 1];
        trimStack(parent);
        focusParentOf(parent, pop);
      } else if (menuState.btn) {
        const btn = menuState.btn;
        closeMenus(false);
        btn.focus();
      } else closeMenus(true);
      break;
    case 'Tab': handled(); closeMenus(true); break;
    case 'Enter': case ' ': break; // the focused button clicks itself
    default:
      if (e.key.length === 1 && !e.ctrlKey && !e.altKey) {
        handled();
        const ch = e.key.toLocaleLowerCase('tr-TR');
        const start = cur_ + 1;
        for (let k = 0; k < items.length; k++) {
          const b = items[(start + k) % items.length];
          if (b._item.label.toLocaleLowerCase('tr-TR').startsWith(ch)) { b.focus(); break; }
        }
      }
  }
}
function focusParentOf(parent, sub) {
  const items = [...parent.querySelectorAll('.mi')];
  const opener = items.find(b => b._item.sub && b.classList.contains('open')) || items.find(b => b._item.sub);
  sub.remove();
  opener?.focus();
}
function closeMenus(restoreFocus = true) {
  if (!menuState) return;
  for (const p of menuState.stack) p.remove();
  menuState.btn?.setAttribute('aria-expanded', 'false');
  menuState = null;
  if (restoreFocus) stage.focus({ preventScroll: true });
}
document.addEventListener('mousedown', e => {
  if (!menuState) return;
  if (e.target.closest('.popup') || e.target.closest('#menubar')) return;
  closeMenus(false);
}, true);
window.addEventListener('blur', () => closeMenus(false));

/* ---------------- Keyboard ---------------- */
const SHORTCUTS = {
  'ArrowRight': () => go(1), 'ArrowLeft': () => go(-1), 'PageDown': () => go(1), 'PageUp': () => go(-1),
  'Home': () => goTo(0), 'End': () => goTo(list.length - 1),
  'ArrowUp': () => pan(0, 80), 'ArrowDown': () => pan(0, -80),
  '0': fit, 'Ctrl+0': fit, '1': () => actualSize(), 'Ctrl+1': () => actualSize(),
  'R': () => rotate(1), 'Shift+R': () => rotate(-1), 'Ctrl+S': saveRotationCmd,
  'I': toggleInfo, 'T': () => setSetting('strip', !S.strip),
  'F11': () => setFull(!isFull), ' ': toggleSlideshow,
  'Ctrl+C': copyImage, 'Ctrl+Shift+C': copyPath, 'Ctrl+E': showInNav,
  'F2': renameCurrent, 'Delete': trashCurrent, 'Ctrl+O': openDialog,
  'F1': openShortcuts, 'F10': focusMenubar,
};
function pan(dx, dy) {
  if (!canPan()) return;
  view.tx += dx;
  view.ty += dy;
  applyView();
}

let altAlone = false;
window.addEventListener('keydown', e => {
  altAlone = e.key === 'Alt' && !e.ctrlKey && !e.shiftKey;
  if (document.querySelector('dialog[open]')) return;
  if (menuState || menubar.contains(document.activeElement)) return; // the menus handle their own keys
  const ctrl = e.ctrlKey || e.metaKey;

  if (e.key === 'Escape') {
    if (slideshow) { e.preventDefault(); stopSlideshow(); }
    else if (isFull) { e.preventDefault(); setFull(false); }
    return;
  }
  if (!e.altKey && (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd')) { e.preventDefault(); zoomBy(1.25); return; }
  if (!e.altKey && (e.key === '-' || e.code === 'NumpadSubtract')) { e.preventDefault(); zoomBy(0.8); return; }
  if (!ctrl && e.key === '?') { e.preventDefault(); openShortcuts(); return; }

  // Letters and digits by physical key (so shortcuts also work with AltGr and on a Turkish keyboard)
  const key = /^Key[A-Z]$/.test(e.code) ? e.code.slice(3) : /^(Digit|Numpad)[0-9]$/.test(e.code) ? e.code.slice(-1) : e.key;
  const id = (ctrl ? 'Ctrl+' : '') + (e.altKey ? 'Alt+' : '') + (e.shiftKey ? 'Shift+' : '') + key;
  const fn = SHORTCUTS[id];
  if (fn) {
    e.preventDefault();
    e.stopPropagation();
    if (slideshow && /Arrow|Page|Home|End/.test(key)) scheduleSlide();
    fn();
  }
}, true);
window.addEventListener('keyup', e => {
  if (e.key === 'Alt' && altAlone) {
    altAlone = false;
    e.preventDefault();
    if (isFull) return;
    if (menuState || menubar.contains(document.activeElement)) closeMenus(true);
    else focusMenubar();
  }
});

/* ---------------- Mouse: wheel, drag, double click, context menu ---------------- */
let wheelAcc = 0, wheelAt = 0;
stage.addEventListener('wheel', e => {
  e.preventDefault();
  if (e.ctrlKey) {
    zoomBy(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
    return;
  }
  if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
  wheelAcc += e.deltaY;
  const now = performance.now();
  if (Math.abs(wheelAcc) >= 50 && now - wheelAt > 140) {
    wheelAt = now;
    go(wheelAcc > 0 ? 1 : -1);
    wheelAcc = 0;
  }
}, { passive: false });

let drag = null;
stage.addEventListener('pointerdown', e => {
  if (e.button !== 0 || e.target.closest('button') || !canPan()) return;
  e.preventDefault();
  stage.setPointerCapture(e.pointerId);
  drag = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
  stage.classList.add('panning');
});
stage.addEventListener('pointermove', e => {
  idle();
  if (!drag) return;
  view.tx = drag.tx + e.clientX - drag.x;
  view.ty = drag.ty + e.clientY - drag.y;
  view.fit = false;
  applyView();
});
const endDrag = () => { drag = null; stage.classList.remove('panning'); };
stage.addEventListener('pointerup', endDrag);
stage.addEventListener('lostpointercapture', endDrag);
stage.addEventListener('dblclick', e => {
  if (e.target.closest('button') || !hasImage()) return;
  if (view.fit) {
    animateOnce();
    zoomTo(fitScale() < 1 ? 1 : 2, e.clientX, e.clientY);
  } else fit();
});
stage.addEventListener('mouseup', e => {
  if (e.button === 3) { e.preventDefault(); go(-1); }
  if (e.button === 4) { e.preventDefault(); go(1); }
});
stage.addEventListener('contextmenu', e => {
  e.preventDefault();
  openContextMenu(e.clientX, e.clientY);
});
window.addEventListener('contextmenu', e => e.preventDefault());

// In full screen the pointer hides after a moment of rest.
let idleTimer = null;
function idle() {
  stage.classList.remove('idle');
  clearTimeout(idleTimer);
  if (isFull) idleTimer = setTimeout(() => stage.classList.add('idle'), 1800);
}

$('#nav-prev').addEventListener('click', () => go(-1));
$('#nav-next').addEventListener('click', () => go(1));
$('#empty-open').addEventListener('click', openDialog);
$('#rot-save').addEventListener('click', saveRotationCmd);
$('#rot-undo').addEventListener('click', undoRotation);
$('#info-close').addEventListener('click', toggleInfo);
for (const b of document.querySelectorAll('.nav-arrow, .rb-btn, #info-close')) b.addEventListener('mousedown', e => e.preventDefault());

let resizeQueued = false;
window.addEventListener('resize', () => {
  closeMenus(false);
  if (resizeQueued) return;
  resizeQueued = true;
  requestAnimationFrame(() => { resizeQueued = false; applyView(); });
});

/* ---------------- Drag and drop ---------------- */
let dragDepth = 0;
const dropEl = $('#drop');
const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; dropEl.hidden = false; });
window.addEventListener('dragover', e => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
window.addEventListener('dragleave', e => { if (!hasFiles(e)) return; if (--dragDepth <= 0) { dragDepth = 0; dropEl.hidden = true; } });
window.addEventListener('drop', e => {
  e.preventDefault();
  dragDepth = 0;
  dropEl.hidden = true;
  const f = e.dataTransfer?.files?.[0];
  const p = f && vw.pathForFile(f);
  if (p) openPath(p);
});

/* ---------------- Window: buttons, resizing, closing ---------------- */
for (const id of ['win-min', 'win-max', 'win-close']) {
  $('#' + id).addEventListener('mousedown', e => e.preventDefault());
}
$('#win-min').addEventListener('click', () => vw.minimize());
$('#win-max').addEventListener('click', () => vw.toggleMaximize());
$('#win-close').addEventListener('click', () => vw.close());
vw.onMaximized(on => {
  root.classList.toggle('is-max', on);
  const b = $('#win-max');
  const label = on ? 'Önceki boyuta dön' : 'Ekranı kapla';
  b.setAttribute('aria-label', label);
  b.title = label;
});
for (const h of document.querySelectorAll('.rz')) {
  h.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    h.setPointerCapture(e.pointerId);
    vw.resizeStart(h.dataset.edge);
    const end = () => {
      h.removeEventListener('pointerup', end);
      h.removeEventListener('lostpointercapture', end);
      vw.resizeEnd();
    };
    h.addEventListener('pointerup', end);
    h.addEventListener('lostpointercapture', end);
  });
}

// An unsaved rotation is asked about before the window closes.
let closing = false;
vw.onCloseRequest(async () => {
  vw.closeAck();
  if (closing) return;
  closing = true;
  try {
    closeMenus(false);
    stopSlideshow();
    if (await settleRotation()) vw.confirmClose();
  } finally {
    closing = false;
  }
});

/* ---------------- Start ---------------- */
buildMenubar();
applySettings();
updateChrome();
started = true;
const first = [...(await vw.pendingPaths()), ...incoming.splice(0)][0];
if (first) await openPath(first);
stage.focus();

})();
