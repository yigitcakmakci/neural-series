/* ============================================================
   NeuralNav — dosya gezgini davranışı
   ============================================================ */
'use strict';
(async () => {

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const readJSON = k => { try { return JSON.parse(localStorage.getItem(k)) || null; } catch { return null; } };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const svg = id => `<svg aria-hidden="true"><use href="#${id}"/></svg>`;

const nv = window.nv;
if (!nv) { document.body.textContent = 'NeuralNav yalnızca masaüstü uygulaması olarak çalışır.'; return; }

const root = document.documentElement;
const IS_EXTRA = new URLSearchParams(location.search).has('yeni');
const el = {
  tabs: $('#tabs'), bandTitle: $('#band-title'), crumbs: $('#crumbs'), address: $('#address'), addressInput: $('#address-input'),
  search: $('#search'), searchClear: $('#search-clear'), cmdbar: $('#cmdbar'), sidebar: $('#sidebar'), content: $('#content'),
  head: $('#list-head'), scroller: $('#scroller'), canvas: $('#canvas'), layer: $('#layer'), pc: $('#pc-view'), empty: $('#empty'),
  preview: $('#preview'), stCount: $('#st-count'), stSel: $('#st-sel'), stJob: $('#st-job'), stDrive: $('#st-drive'),
  popups: $('#popups'), jobs: $('#jobs'), toast: $('#toast'),
};

/* ---------------- Ayarlar ---------------- */
const SETTINGS_KEY = 'neuralnav.settings';
const THEMES = [
  { id: 'neon', name: 'Neon' },
  { id: 'ice', name: 'Buz' },
  { id: 'alarm', name: 'Alarm' },
  { id: 'daylight', name: 'Gündüz' },
];
const DEFAULTS = { view: 'details', sortKey: 'name', sortDir: 1, showHidden: false, showExt: true, preview: false, theme: 'neon', pins: [] };
const S = Object.assign({}, DEFAULTS, readJSON(SETTINGS_KEY));
if (!THEMES.some(t => t.id === S.theme)) S.theme = DEFAULTS.theme;
if (!Array.isArray(S.pins)) S.pins = [];
function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(S)); } catch { /* depolama kapalı olabilir */ } }
function applyTheme() { for (const t of THEMES) root.classList.toggle('theme-' + t.id, t.id === S.theme); }

/* ---------------- Biçimlendirme ve türler ---------------- */
const collator = new Intl.Collator('tr', { numeric: true, sensitivity: 'base' });
const dtf = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmtDate = ms => ms ? dtf.format(new Date(ms)) : '';
const fmtN = n => n.toLocaleString('tr-TR');
function fmtSize(n) {
  if (n < 1024) return `${fmtN(n)} bayt`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toLocaleString('tr-TR', { maximumFractionDigits: v < 10 ? 1 : 0 })} ${units[i]}`;
}

const TYPES = {
  txt: ['Metin Belgesi', 'text'], md: ['Markdown Belgesi', 'text'], log: ['Günlük Dosyası', 'text'], rtf: ['Zengin Metin Belgesi', 'text'],
  ini: ['Yapılandırma Ayarları', 'code'], cfg: ['Yapılandırma Dosyası', 'code'], conf: ['Yapılandırma Dosyası', 'code'], reg: ['Kayıt Girdileri', 'code'],
  pdf: ['PDF Belgesi', 'pdf'], doc: ['Word Belgesi', 'doc'], docx: ['Word Belgesi', 'doc'], odt: ['OpenDocument Metni', 'doc'],
  xls: ['Excel Çalışma Sayfası', 'sheet'], xlsx: ['Excel Çalışma Sayfası', 'sheet'], csv: ['CSV Dosyası', 'sheet'], ods: ['OpenDocument Tablosu', 'sheet'],
  ppt: ['PowerPoint Sunusu', 'slide'], pptx: ['PowerPoint Sunusu', 'slide'], odp: ['OpenDocument Sunusu', 'slide'],
  jpg: ['JPEG Resmi', 'image'], jpeg: ['JPEG Resmi', 'image'], png: ['PNG Resmi', 'image'], gif: ['GIF Resmi', 'image'], webp: ['WebP Resmi', 'image'],
  bmp: ['Bit Eşlem Resmi', 'image'], svg: ['SVG Resmi', 'image'], ico: ['Simge', 'image'], tif: ['TIFF Resmi', 'image'], tiff: ['TIFF Resmi', 'image'],
  heic: ['HEIC Resmi', 'image'], avif: ['AVIF Resmi', 'image'], psd: ['Photoshop Belgesi', 'image'],
  mp3: ['MP3 Ses Dosyası', 'audio'], wav: ['WAV Ses Dosyası', 'audio'], flac: ['FLAC Ses Dosyası', 'audio'], m4a: ['M4A Ses Dosyası', 'audio'],
  aac: ['AAC Ses Dosyası', 'audio'], ogg: ['OGG Ses Dosyası', 'audio'], wma: ['WMA Ses Dosyası', 'audio'], opus: ['Opus Ses Dosyası', 'audio'],
  mp4: ['MP4 Video', 'video'], mkv: ['MKV Video', 'video'], avi: ['AVI Video', 'video'], mov: ['QuickTime Video', 'video'],
  webm: ['WebM Video', 'video'], wmv: ['WMV Video', 'video'], m4v: ['M4V Video', 'video'],
  zip: ['ZIP Arşivi', 'archive'], rar: ['RAR Arşivi', 'archive'], '7z': ['7-Zip Arşivi', 'archive'], tar: ['TAR Arşivi', 'archive'],
  gz: ['GZip Arşivi', 'archive'], iso: ['Disk Görüntüsü', 'archive'],
  exe: ['Uygulama', 'app'], msi: ['Windows Installer Paketi', 'app'], lnk: ['Kısayol', 'app'], url: ['İnternet Kısayolu', 'app'],
  bat: ['Toplu İş Dosyası', 'code'], cmd: ['Komut Dosyası', 'code'], ps1: ['PowerShell Betiği', 'code'], dll: ['Uygulama Uzantısı', 'app'],
  sys: ['Sistem Dosyası', 'file'], js: ['JavaScript Dosyası', 'code'], mjs: ['JavaScript Dosyası', 'code'], ts: ['TypeScript Dosyası', 'code'],
  jsx: ['JSX Dosyası', 'code'], tsx: ['TSX Dosyası', 'code'], json: ['JSON Dosyası', 'code'], html: ['HTML Belgesi', 'code'], htm: ['HTML Belgesi', 'code'],
  css: ['CSS Dosyası', 'code'], scss: ['SCSS Dosyası', 'code'], xml: ['XML Belgesi', 'code'], yml: ['YAML Dosyası', 'code'], yaml: ['YAML Dosyası', 'code'],
  py: ['Python Dosyası', 'code'], java: ['Java Dosyası', 'code'], c: ['C Kaynak Dosyası', 'code'], cpp: ['C++ Kaynak Dosyası', 'code'],
  h: ['C Başlık Dosyası', 'code'], cs: ['C# Kaynak Dosyası', 'code'], go: ['Go Dosyası', 'code'], rs: ['Rust Dosyası', 'code'],
  php: ['PHP Dosyası', 'code'], sh: ['Kabuk Betiği', 'code'], sql: ['SQL Dosyası', 'code'], toml: ['TOML Dosyası', 'code'],
  ttf: ['TrueType Yazı Tipi', 'file'], otf: ['OpenType Yazı Tipi', 'file'], woff2: ['Web Yazı Tipi', 'file'],
};
const SYMBOL = { folder: 'f-folder', text: 'f-text', doc: 'f-text', code: 'f-code', image: 'f-image', audio: 'f-audio', video: 'f-video', archive: 'f-archive', pdf: 'f-pdf', sheet: 'f-sheet', slide: 'f-slide', app: 'f-app', file: 'f-file' };
const NATIVE_ICON = new Set(['exe', 'lnk', 'url', 'ico', 'msi', 'scr', 'cpl', 'appref-ms']);
const TEXT_EXT = new Set(['txt', 'md', 'log', 'ini', 'cfg', 'conf', 'json', 'js', 'mjs', 'ts', 'jsx', 'tsx', 'css', 'scss', 'html', 'htm', 'xml', 'csv', 'py', 'java', 'c', 'cpp', 'h', 'cs', 'go', 'rs', 'php', 'sh', 'bat', 'cmd', 'ps1', 'yml', 'yaml', 'toml', 'sql', 'reg', 'srt', 'gitignore', 'env']);
const PLAYABLE = new Set(['mp4', 'webm', 'm4v', 'mov', 'mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus']);
const KNOWN_LABELS = { desktop: 'Masaüstü', downloads: 'İndirilenler', documents: 'Belgeler', pictures: 'Resimler', music: 'Müzik', videos: 'Videolar' };
const KNOWN_ICONS = { desktop: 'i-desktop', downloads: 'i-download', documents: 'i-documents', pictures: 'i-pictures', music: 'i-music', videos: 'i-videos' };

/* ---------------- Yollar ---------------- */
const joinPath = (dir, name) => (dir.endsWith('\\') ? dir : dir + '\\') + name;
const isDriveRoot = p => /^[a-z]:\\?$/i.test(p);
function rootOf(p) {
  const m = /^([a-z]:)/i.exec(p);
  if (m) return m[1].toUpperCase() + '\\';
  const u = /^(\\\\[^\\]+\\[^\\]+)/.exec(p);
  return u ? u[1] + '\\' : '';
}
function parentOf(p) {
  if (!p || p === 'pc' || isDriveRoot(p)) return null;
  const t = p.replace(/\\+$/, '');
  if (/^\\\\[^\\]+\\[^\\]+$/.test(t)) return null;
  const i = t.lastIndexOf('\\');
  if (i < 0) return null;
  const par = t.slice(0, i);
  return /^[a-z]:$/i.test(par) ? par + '\\' : par;
}
const baseName = p => { const t = p.replace(/\\+$/, ''); const i = t.lastIndexOf('\\'); return i < 0 ? t : t.slice(i + 1); };
const norm = p => p.toLowerCase().replace(/\\+$/, '');
const samePath = (a, b) => !!a && !!b && norm(a) === norm(b);
const sameRoot = (a, b) => rootOf(a).toLowerCase() === rootOf(b).toLowerCase();
const extOf = name => { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(i + 1).toLowerCase() : ''; };
function fileURL(p) {
  if (p.startsWith('\\\\')) return 'file:' + p.split('\\').map((s, i) => (i < 2 ? s : encodeURIComponent(s))).join('/');
  return 'file:///' + p.split('\\').map((s, i) => (i === 0 ? s : encodeURIComponent(s))).join('/');
}

/* ---------------- Konumlar ---------------- */
let places = { home: '', known: [], drives: [], neuralPad: false };
async function loadPlaces() {
  try { places = await nv.places(); } catch { /* son bilinen liste kalır */ }
}
const userName = () => baseName(places.home || 'Kullanıcı');
function driveInfo(p) {
  const r = rootOf(p).toLowerCase();
  return places.drives.find(d => d.root.toLowerCase() === r) || null;
}
function driveLabel(rootPath) {
  const d = driveInfo(rootPath);
  const kind = !d ? 'Sürücü' : d.label || ({ Removable: 'USB Sürücü', Network: 'Ağ Sürücüsü', CDRom: 'DVD Sürücüsü' }[d.type] || 'Yerel Disk');
  return `${kind} (${rootPath.slice(0, 2).toUpperCase()})`;
}
function locLabel(loc) {
  if (!loc || loc === 'pc') return 'Bu Bilgisayar';
  const k = places.known.find(x => samePath(x.path, loc));
  if (k) return KNOWN_LABELS[k.key];
  if (samePath(loc, places.home)) return userName();
  if (isDriveRoot(loc)) return driveLabel(loc);
  return baseName(loc);
}
function locIcon(loc) {
  if (!loc || loc === 'pc') return 'i-pc';
  const k = places.known.find(x => samePath(x.path, loc));
  if (k) return KNOWN_ICONS[k.key];
  if (samePath(loc, places.home)) return 'i-home';
  if (isDriveRoot(loc)) return 'i-drive';
  return 'i-folder';
}

/* ---------------- Öğeler ---------------- */
function toItem(dir, e) {
  const name = e.n;
  const isDir = !!e.d;
  const ext = isDir ? '' : extOf(name);
  const t = isDir ? ['Dosya klasörü', 'folder'] : TYPES[ext] || [ext ? `${ext.toUpperCase()} Dosyası` : 'Dosya', 'file'];
  return {
    name, ext, isDir,
    path: e.path || joinPath(dir, name),
    size: e.s || 0, mtime: e.m || 0, ctime: e.c || 0, attrs: e.a || 0,
    type: t[0], cat: t[1],
    hidden: !!((e.a || 0) & 6),
    lower: name.toLocaleLowerCase('tr-TR'),
  };
}
const shownName = it => (S.showExt || it.isDir || !it.ext ? it.name : it.name.slice(0, -(it.ext.length + 1)));

/* ---------------- Sekmeler ---------------- */
let tabs = [];
let active = null;
const newTabState = () => ({ id: uid(), loc: null, history: [], hi: -1, entries: [], items: [], sel: new Set(), anchor: -1, focus: -1, scroll: 0, filter: '', search: null, token: 0 });
const isPCView = (t = active) => t.loc === 'pc' && !t.search;
const currentDir = (t = active) => (t && t.loc && t.loc !== 'pc' && !t.search ? t.loc : null);

async function addTab(loc, { activate = true, select = null } = {}) {
  const t = newTabState();
  const i = active ? tabs.indexOf(active) + 1 : tabs.length;
  tabs.splice(i, 0, t);
  if (activate) { active = t; renderTabs(); }
  await navigate(t, loc, { select });
  if (!activate) renderTabs();
  return t;
}

function activateTab(t) {
  if (!t || t === active) return;
  if (active) active.scroll = el.scroller.scrollTop;
  cancelRename();
  active = t;
  el.search.value = t.search ? t.search.query : t.filter;
  renderAll();
  el.scroller.scrollTop = t.scroll;
  renderVisible(true);
  nv.watch(currentDir(t) || '');
  saveSession();
}

function closeTab(t = active) {
  if (tabs.length === 1) { nv.close(); return; }
  const i = tabs.indexOf(t);
  stopSearch(t);
  tabs.splice(i, 1);
  if (t === active) { active = null; activateTab(tabs[Math.min(i, tabs.length - 1)]); }
  else renderTabs();
  saveSession();
}

function cycleTab(dir) {
  if (tabs.length < 2) return;
  activateTab(tabs[(tabs.indexOf(active) + dir + tabs.length) % tabs.length]);
}

/* ---------------- Gezinme ---------------- */
async function navigate(tab, loc, { push = true, select = null, keep = false } = {}) {
  const token = ++tab.token;
  let entries = [];
  let resolved = loc;
  if (loc !== 'pc') {
    const r = await nv.list(loc);
    if (token !== tab.token) return false;
    if (!r.ok) {
      toast(`"${loc}" açılamadı: ${r.error}`);
      if (tab.loc) return false;
      resolved = 'pc';
    } else {
      resolved = r.dir;
      entries = r.entries.map(e => toItem(r.dir, e));
    }
  }
  const changed = !tab.loc || !samePath(tab.loc, resolved);
  const keepSel = keep && !changed ? new Set(tab.sel) : null;
  const keepFocus = keep && !changed ? tab.items[tab.focus]?.path : null;
  if (changed) {
    stopSearch(tab);
    if (push) {
      tab.history = tab.history.slice(0, tab.hi + 1);
      tab.history.push(resolved);
      if (tab.history.length > 60) tab.history.shift();
      tab.hi = tab.history.length - 1;
    }
    tab.filter = '';
    tab.sel = new Set();
    tab.anchor = tab.focus = -1;
    tab.scroll = 0;
  }
  tab.loc = resolved;
  tab.entries = entries;
  rebuild(tab);
  if (keepSel) {
    const present = new Set(tab.items.map(i => i.path));
    tab.sel = new Set([...keepSel].filter(p => present.has(p)));
    tab.focus = keepFocus ? tab.items.findIndex(i => i.path === keepFocus) : -1;
  }
  if (select) selectPaths(tab, [].concat(select));
  if (tab === active) {
    if (changed) {
      cancelRename();
      el.search.value = '';
      nv.watch(currentDir(tab) || '');
    }
    renderAll();
    if (changed) el.scroller.scrollTop = 0;
    if (select && tab.focus >= 0) ensureVisible(tab.focus);
  } else {
    renderTabs();
  }
  saveSession();
  return true;
}

const refresh = (tab = active) => (tab.loc ? navigate(tab, tab.loc, { push: false, keep: true }) : null);
function refreshWhere(dirs) {
  for (const t of tabs) {
    if (t.loc && t.loc !== 'pc' && !t.search && dirs.some(d => d && samePath(d, t.loc))) refresh(t);
  }
}

function goBack(t = active) { if (t.hi > 0) { t.hi--; navigate(t, t.history[t.hi], { push: false }); } }
function goForward(t = active) { if (t.hi < t.history.length - 1) { t.hi++; navigate(t, t.history[t.hi], { push: false }); } }
function goUp(t = active) {
  if (t.search) { clearSearch(); return; }
  if (t.loc === 'pc') return;
  navigate(t, parentOf(t.loc) || 'pc', { select: t.loc });
}

async function goTo(input) {
  const s = input.trim();
  if (!s) return;
  if (['bu bilgisayar', 'this pc', 'bilgisayar'].includes(s.toLocaleLowerCase('tr-TR'))) { navigate(active, 'pc'); return; }
  const r = await nv.resolve(s, currentDir() || places.home);
  if (!r.ok) { toast(`"${s}" bulunamadı.`); return; }
  if (r.isDir) navigate(active, r.path);
  else {
    const err = await nv.open(r.path);
    if (err) toast(`Açılamadı: ${err}`);
  }
}

async function openPathArg(p) {
  if (p === 'pc') { await addTab('pc'); return; }
  const r = await nv.resolve(p, places.home);
  if (!r.ok) return;
  if (r.isDir) await addTab(r.path);
  else await addTab(parentOf(r.path) || 'pc', { select: r.path });
}

/* ---------------- Sıralama ve süzme ---------------- */
function rebuild(tab) {
  const source = tab.search ? tab.search.results : tab.entries;
  const f = tab.filter.trim().toLocaleLowerCase('tr-TR');
  const items = source.filter(it => (S.showHidden || !it.hidden) && (!f || it.lower.includes(f)));
  const k = S.sortKey;
  const dir = S.sortDir;
  items.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    let c = 0;
    if (k === 'date') c = a.mtime - b.mtime;
    else if (k === 'size') c = a.size - b.size;
    else if (k === 'type') c = collator.compare(a.type, b.type);
    else if (k === 'loc') c = collator.compare(parentOf(a.path) || '', parentOf(b.path) || '');
    if (c === 0) c = collator.compare(a.name, b.name);
    return c * dir;
  });
  tab.items = items;
}

function setSort(key) {
  if (S.sortKey === key) S.sortDir = -S.sortDir;
  else { S.sortKey = key; S.sortDir = key === 'date' || key === 'size' ? -1 : 1; }
  saveSettings();
  resort();
}
function resort() {
  const t = active;
  const focusPath = t.items[t.focus]?.path;
  rebuild(t);
  t.focus = focusPath ? t.items.findIndex(i => i.path === focusPath) : -1;
  renderContent();
}

/* ---------------- Seçim ---------------- */
const selItems = (t = active) => t.items.filter(i => t.sel.has(i.path));
const selPaths = (t = active) => selItems(t).map(i => i.path);
function selectOnly(i) {
  const t = active;
  t.sel = new Set(t.items[i] ? [t.items[i].path] : []);
  t.focus = t.anchor = i;
  selectionChanged();
}
function toggleSel(i) {
  const t = active;
  const p = t.items[i].path;
  if (t.sel.has(p)) t.sel.delete(p); else t.sel.add(p);
  t.focus = t.anchor = i;
  selectionChanged();
}
function rangeSel(i, additive) {
  const t = active;
  const a = t.anchor >= 0 ? t.anchor : i;
  const [lo, hi] = a < i ? [a, i] : [i, a];
  const next = additive ? new Set(t.sel) : new Set();
  for (let k = lo; k <= hi; k++) next.add(t.items[k].path);
  t.sel = next;
  t.focus = i;
  selectionChanged();
}
function selectAll() {
  const t = active;
  t.sel = new Set(t.items.map(i => i.path));
  selectionChanged();
}
function clearSel() {
  active.sel = new Set();
  selectionChanged();
}
function selectPaths(tab, paths) {
  tab.sel = new Set();
  let first = -1;
  tab.items.forEach((it, i) => {
    if (paths.some(p => samePath(p, it.path))) { tab.sel.add(it.path); if (first < 0) first = i; }
  });
  tab.focus = tab.anchor = first;
}
// Selection only restyles the rows already on screen; replacing them would swallow a double-click.
function paintSelection() {
  if (!active || isPCView()) return;
  for (const node of el.layer.children) {
    const i = +node.dataset.i;
    const it = active.items[i];
    if (it) node.className = (L.grid ? 'tile' : 'row') + itemClass(it, i);
  }
}
function selectionChanged() {
  paintSelection();
  renderStatus();
  updateCommands();
  schedulePreview();
}

/* ---------------- Çizim ---------------- */
const ROW_H = 30, TILE_W = 124, TILE_H = 132, GRID_PAD = 10;
let L = { grid: false, cols: 1 };
let lastRange = null;

function renderAll() {
  renderTabs();
  renderAddress();
  renderSidebar();
  renderContent();
  renderStatus();
  updateCommands();
  schedulePreview();
  const title = active.search ? `“${active.search.query}” sonuçları` : locLabel(active.loc);
  document.title = `${title} - NeuralNav`;
  el.bandTitle.textContent = title;
  el.search.placeholder = isPCView() ? 'Bir klasör açınca arama yapılır' : `${locLabel(active.loc)} içinde ara`;
  el.search.disabled = isPCView();
  el.searchClear.hidden = !(el.search.value || active.search);
}

function renderTabs() {
  el.tabs.textContent = '';
  for (const t of tabs) {
    const b = document.createElement('div');
    b.className = 'tab';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(t === active));
    b.tabIndex = t === active ? 0 : -1;
    const label = t.search ? `Ara: ${t.search.query}` : locLabel(t.loc);
    b.title = t.loc && t.loc !== 'pc' ? t.loc : 'Bu Bilgisayar';
    b.innerHTML = `${svg(t.search ? 'i-search' : locIcon(t.loc))}<span class="tab-name">${esc(label)}</span><span class="tab-close" role="button" title="Sekmeyi kapat (Ctrl+W)" aria-label="Sekmeyi kapat">${svg('i-close')}</span>`;
    b.addEventListener('mousedown', e => { if (e.button === 1) e.preventDefault(); });
    b.addEventListener('click', e => { if (e.target.closest('.tab-close')) closeTab(t); else activateTab(t); });
    b.addEventListener('auxclick', e => { if (e.button === 1) closeTab(t); });
    b.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activateTab(t); } });
    el.tabs.appendChild(b);
    if (t === active) requestAnimationFrame(() => b.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  }
}

function crumbsFor(loc) {
  const out = [{ label: 'Bu Bilgisayar', path: 'pc' }];
  if (!loc || loc === 'pc') return out;
  const r = rootOf(loc);
  if (/^[a-z]:\\$/i.test(r)) out.push({ label: driveLabel(r), path: r });
  else { out.length = 0; out.push({ label: r.replace(/\\$/, ''), path: r }); }
  let acc = r;
  for (const part of loc.slice(r.length).split('\\').filter(Boolean)) {
    acc = joinPath(acc, part);
    out.push({ label: part, path: acc });
  }
  return out;
}

function renderAddress() {
  const parts = crumbsFor(active.loc);
  const sep = `<span class="crumb-sep">${svg('i-chev')}</span>`;
  el.crumbs.innerHTML = parts.map((c, i) =>
    `${i ? sep : ''}<button class="crumb${i === parts.length - 1 && !active.search ? ' last' : ''}" type="button" data-path="${esc(c.path)}">${esc(c.label)}</button>`).join('')
    + (active.search ? `${sep}<span class="crumb search">“${esc(active.search.query)}” sonuçları</span>` : '');
  requestAnimationFrame(() => { el.crumbs.scrollLeft = el.crumbs.scrollWidth; });
  $('#nav-back').disabled = active.hi <= 0;
  $('#nav-forward').disabled = active.hi >= active.history.length - 1;
  $('#nav-up').disabled = active.loc === 'pc' && !active.search;
}

function renderSidebar() {
  const cur = active ? (active.search ? null : active.loc) : null;
  const item = (p, label, icon, extra = '', cls = '') =>
    `<button class="side-item${cls}${cur && samePath(cur, p) ? ' active' : ''}" type="button" data-path="${esc(p)}" title="${esc(p === 'pc' ? 'Bu Bilgisayar' : p)}">${svg(icon)}${extra || `<span class="side-label">${esc(label)}</span>`}</button>`;
  let html = '<div class="side-title">HIZLI ERİŞİM</div>';
  if (places.home) html += item(places.home, userName(), 'i-home');
  for (const k of places.known) html += item(k.path, KNOWN_LABELS[k.key], KNOWN_ICONS[k.key]);
  for (const p of S.pins) html += item(p, baseName(p) || p, 'i-pin', '', ' pin');
  html += '<div class="side-title">SÜRÜCÜLER</div>';
  for (const d of places.drives) {
    if (!d.ready) { html += item(d.root, driveLabel(d.root), 'i-drive'); continue; }
    const used = d.total ? Math.round((1 - d.free / d.total) * 100) : 0;
    html += item(d.root, '', 'i-drive',
      `<span class="side-drive"><span class="side-label">${esc(driveLabel(d.root))}</span><span class="bar${used > 90 ? ' full' : ''}"><i style="width:${used}%"></i></span><span class="side-sub">${fmtSize(d.free)} boş</span></span>`);
  }
  html += '<div class="side-title">DİĞER</div>';
  html += item('pc', 'Bu Bilgisayar', 'i-pc');
  html += `<button class="side-item" type="button" data-action="recycle" title="Windows'ta Geri Dönüşüm Kutusu'nu açar">${svg('i-trash')}<span class="side-label">Geri Dönüşüm Kutusu</span></button>`;
  el.sidebar.innerHTML = html;
}

function renderPC() {
  const known = places.known.map(k =>
    `<button class="pc-card" type="button" data-path="${esc(k.path)}"><span class="ic cat-folder"><svg class="line"><use href="#${KNOWN_ICONS[k.key]}"/></svg></span><span class="pc-txt"><span class="pc-name">${KNOWN_LABELS[k.key]}</span></span></button>`).join('');
  const drives = places.drives.map(d => {
    const used = d.total ? Math.round((1 - d.free / d.total) * 100) : 0;
    const sub = d.ready ? `${fmtSize(d.free)} boş / ${fmtSize(d.total)}` : 'Hazır değil';
    return `<button class="pc-card" type="button" data-path="${esc(d.root)}"><span class="ic cat-drive"><svg><use href="#f-drive"/></svg></span><span class="pc-txt"><span class="pc-name">${esc(driveLabel(d.root))}</span>${d.ready ? `<span class="bar${used > 90 ? ' full' : ''}"><i style="width:${used}%"></i></span>` : ''}<span class="pc-sub">${sub}</span></span></button>`;
  }).join('');
  el.pc.innerHTML = `<section class="pc-sec"><h3>KLASÖRLER</h3><div class="pc-grid">${known}</div></section><section class="pc-sec"><h3>SÜRÜCÜLER</h3><div class="pc-grid drives">${drives}</div></section>`;
}

function computeLayout() {
  const n = active.items.length;
  if (S.view === 'grid' && !active.search) {
    const w = el.scroller.clientWidth - GRID_PAD * 2;
    const cols = Math.max(1, Math.floor(w / TILE_W));
    return { grid: true, cols, height: Math.ceil(n / cols) * TILE_H + GRID_PAD * 2 };
  }
  return { grid: false, cols: 1, height: n * ROW_H + 12 };
}

const HEADS = {
  normal: [['name', 'Ad'], ['date', 'Değiştirme tarihi'], ['type', 'Tür'], ['size', 'Boyut']],
  search: [['name', 'Ad'], ['loc', 'Konum'], ['date', 'Değiştirme tarihi'], ['size', 'Boyut']],
};

function renderContent() {
  const t = active;
  const pc = isPCView(t);
  el.pc.hidden = !pc;
  el.scroller.hidden = pc;
  if (pc) { el.head.hidden = true; el.empty.hidden = true; renderPC(); return; }
  L = computeLayout();
  el.content.classList.toggle('search-mode', !!t.search);
  el.head.hidden = L.grid;
  if (!L.grid) {
    el.head.innerHTML = HEADS[t.search ? 'search' : 'normal'].map(([k, label]) =>
      `<button class="h h-${k}" type="button" data-sort="${k}">${label}${S.sortKey === k ? `<span class="arrow">${S.sortDir > 0 ? '▲' : '▼'}</span>` : ''}</button>`).join('');
  }
  el.canvas.style.height = L.height + 'px';
  renderVisible(true);
  const searching = t.search && t.search.running;
  el.empty.hidden = t.items.length > 0 && !(searching && !t.items.length);
  if (!t.items.length) el.empty.textContent = searching ? 'ARANIYOR…' : t.search ? 'Sonuç bulunamadı.' : t.filter ? 'Filtreyle eşleşen öğe yok.' : 'Bu klasör boş.';
  el.empty.hidden = t.items.length > 0;
}

function itemClass(it, i) {
  const t = active;
  return (t.sel.has(it.path) ? ' sel' : '') + (i === t.focus ? ' focus' : '') + (cutSet.has(it.path) ? ' cut' : '') + (it.hidden ? ' hid' : '');
}

function renderVisible(force) {
  if (!active || isPCView()) return;
  const top = el.scroller.scrollTop;
  const h = el.scroller.clientHeight || 600;
  const n = active.items.length;
  let first, last;
  if (L.grid) {
    const r0 = Math.max(0, Math.floor((top - GRID_PAD) / TILE_H) - 1);
    const r1 = Math.ceil((top + h) / TILE_H) + 1;
    first = r0 * L.cols;
    last = Math.min(n, r1 * L.cols);
  } else {
    first = Math.max(0, Math.floor(top / ROW_H) - 10);
    last = Math.min(n, Math.ceil((top + h) / ROW_H) + 10);
  }
  if (!force && lastRange && lastRange[0] === first && lastRange[1] === last) return;
  lastRange = [first, last];
  const parts = [];
  for (let i = first; i < last; i++) parts.push(L.grid ? tileHTML(i) : rowHTML(i));
  el.layer.innerHTML = parts.join('');
  loadVisuals(first, last);
}

function rowHTML(i) {
  const it = active.items[i];
  const loc = active.search ? `<span class="c-loc" title="${esc(parentOf(it.path) || '')}"><bdi>${esc(parentOf(it.path) || '')}</bdi></span>` : '';
  const type = active.search ? '' : `<span class="c-type">${esc(it.type)}</span>`;
  return `<div class="row${itemClass(it, i)}" data-i="${i}" draggable="true" style="top:${i * ROW_H + 6}px"><span class="c-name">${iconHTML(it, false)}<span class="nm">${esc(shownName(it))}</span></span>${loc}<span class="c-date">${fmtDate(it.mtime)}</span>${type}<span class="c-size">${it.isDir ? '' : fmtSize(it.size)}</span></div>`;
}

function tileHTML(i) {
  const it = active.items[i];
  const left = GRID_PAD + (i % L.cols) * TILE_W;
  const top = GRID_PAD + Math.floor(i / L.cols) * TILE_H;
  return `<div class="tile${itemClass(it, i)}" data-i="${i}" draggable="true" style="left:${left}px;top:${top}px" title="${esc(it.name)}">${iconHTML(it, true)}<span class="nm">${esc(shownName(it))}</span></div>`;
}

/* Gerçek simgeler (uygulamalar, kısayollar) ve küçük resimler istendikçe yüklenir */
const visuals = new Map();
const visualPending = new Set();
let visualQueue = [];
let visualActive = 0;
function visualKey(it, big) {
  if (big && (it.cat === 'image' || it.cat === 'video') && !['svg', 'ico'].includes(it.ext)) return `t|${it.path}|${it.mtime}`;
  if (NATIVE_ICON.has(it.ext)) return `i|${it.path}|${big ? 'l' : 'n'}`;
  return null;
}
function iconHTML(it, big) {
  const key = visualKey(it, big);
  const v = key && visuals.get(key);
  if (v) return `<span class="ic cat-${it.cat}${key[0] === 't' ? ' has-thumb' : ''}"><img src="${v}" alt="" draggable="false"></span>`;
  const overlay = it.ext === 'lnk' || it.ext === 'url' ? `<svg class="ov"><use href="#f-link"/></svg>` : '';
  return `<span class="ic cat-${it.cat}"><svg><use href="#${SYMBOL[it.cat] || 'f-file'}"/></svg>${overlay}</span>`;
}
function loadVisuals(first, last) {
  const big = L.grid;
  visualQueue = [];
  for (let i = first; i < last; i++) {
    const it = active.items[i];
    const key = visualKey(it, big);
    if (key && !visuals.has(key) && !visualPending.has(key)) visualQueue.push([key, it]);
  }
  pumpVisuals();
}
function pumpVisuals() {
  while (visualActive < 4 && visualQueue.length) {
    const [key, it] = visualQueue.shift();
    if (visuals.has(key) || visualPending.has(key)) continue;
    visualPending.add(key);
    visualActive++;
    const job = key[0] === 't' ? nv.thumb(it.path, 128) : nv.icon(it.path, key.endsWith('|l') ? 'large' : 'normal');
    job.then(url => {
      if (url) {
        visuals.set(key, url);
        if (visuals.size > 3000) visuals.delete(visuals.keys().next().value);
        scheduleRedraw();
      }
    }).catch(() => {}).finally(() => { visualPending.delete(key); visualActive--; pumpVisuals(); });
  }
}
let redrawQueued = false;
function scheduleRedraw() {
  if (redrawQueued) return;
  redrawQueued = true;
  requestAnimationFrame(() => { redrawQueued = false; renderVisible(true); });
}

function ensureVisible(i) {
  if (i < 0 || !L) return;
  const s = el.scroller;
  let top, bottom;
  if (L.grid) { top = GRID_PAD + Math.floor(i / L.cols) * TILE_H; bottom = top + TILE_H; }
  else { top = i * ROW_H + 6; bottom = top + ROW_H; }
  if (top < s.scrollTop) s.scrollTop = top - 4;
  else if (bottom > s.scrollTop + s.clientHeight) s.scrollTop = bottom - s.clientHeight + 4;
  renderVisible(false);
}

function renderStatus() {
  const t = active;
  if (isPCView(t)) {
    el.stCount.textContent = `${places.drives.length} sürücü`;
    el.stSel.textContent = '';
  } else {
    let count = `${fmtN(t.items.length)} öğe`;
    if (t.search) count += t.search.running ? ' · aranıyor…' : t.search.truncated ? ' · ilk 5.000 sonuç' : ' · arama bitti';
    el.stCount.textContent = count;
    const sel = selItems(t);
    if (sel.length) {
      const files = sel.filter(i => !i.isDir);
      const bytes = files.reduce((s, i) => s + i.size, 0);
      el.stSel.textContent = `${fmtN(sel.length)} öğe seçildi${files.length ? ' · ' + fmtSize(bytes) : ''}`;
    } else el.stSel.textContent = '';
  }
  el.stJob.textContent = jobs.size ? `${jobs.size} işlem sürüyor` : '';
  const d = t.loc && t.loc !== 'pc' ? driveInfo(t.loc) : null;
  if (d && d.ready && d.total) {
    const used = Math.round((1 - d.free / d.total) * 100);
    el.stDrive.innerHTML = `${esc(d.root.slice(0, 2))} · ${fmtSize(d.free)} boş <span class="bar${used > 90 ? ' full' : ''}"><i style="width:${used}%"></i></span>`;
  } else el.stDrive.textContent = '';
}

function updateCommands() {
  const n = active.sel.size;
  const dir = currentDir();
  const set = (cmd, on) => { const b = el.cmdbar.querySelector(`[data-cmd="${cmd}"]`); if (b) b.disabled = !on; };
  set('new', !!dir);
  set('cut', n > 0);
  set('copy', n > 0);
  set('paste', !!dir);
  set('rename', n === 1);
  set('delete', n > 0);
  set('sort', !isPCView());
  set('view', true);
  set('terminal', !!dir);
  el.cmdbar.querySelector('[data-cmd="preview"]').setAttribute('aria-pressed', String(S.preview));
  el.preview.hidden = !S.preview;
}

/* ---------------- Önizleme ---------------- */
let previewTimer = 0;
let previewToken = 0;
function schedulePreview() {
  if (!S.preview) return;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(renderPreview, 140);
}
function decodePreview(bytes) {
  const b = new Uint8Array(bytes);
  for (let i = 0; i < Math.min(b.length, 4096); i++) if (b[i] === 0) return null;
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { /* ANSI */ }
  try { return new TextDecoder('windows-1254').decode(b); } catch { return null; }
}
async function renderPreview() {
  const tok = ++previewToken;
  const sel = selItems();
  if (sel.length !== 1) {
    el.preview.innerHTML = `<div class="pv-empty">${sel.length ? `${fmtN(sel.length)} öğe seçildi.` : 'Önizlemek için bir öğe seç.'}</div>`;
    return;
  }
  const it = sel[0];
  let media = '';
  if (it.cat === 'image' && !['psd', 'heic', 'tif', 'tiff'].includes(it.ext)) media = `<img src="${fileURL(it.path)}" alt="">`;
  else if (it.cat === 'video' && PLAYABLE.has(it.ext)) media = `<video src="${fileURL(it.path)}" controls muted preload="metadata"></video>`;
  else if (it.cat === 'audio' && PLAYABLE.has(it.ext)) media = `<div style="display:grid;gap:10px;justify-items:center;width:100%;padding:12px">${iconHTML(it, true)}<audio src="${fileURL(it.path)}" controls preload="metadata"></audio></div>`;
  else if (!it.isDir && (TEXT_EXT.has(it.ext) || (!it.ext && it.size < 65536))) {
    const r = await nv.previewText(it.path);
    if (tok !== previewToken) return;
    const text = r.ok ? decodePreview(r.bytes) : null;
    if (text !== null) media = `<pre class="pv-text">${esc(text)}${r.truncated ? '\n…' : ''}</pre>`;
  }
  if (!media) media = iconHTML(it, true).replace('class="ic', 'class="ic big');
  let extra = '';
  if (it.isDir) {
    const r = await nv.list(it.path);
    if (tok !== previewToken) return;
    extra = r.ok ? `<dt>İçerik</dt><dd>${fmtN(r.entries.length)} öğe</dd>` : '';
  }
  el.preview.innerHTML = `<div class="pv-media">${media}</div><div class="pv-name">${esc(it.name)}</div><dl class="pv-meta"><dt>Tür</dt><dd>${esc(it.type)}</dd>${it.isDir ? '' : `<dt>Boyut</dt><dd>${fmtSize(it.size)}</dd>`}${extra}<dt>Değiştirme</dt><dd>${fmtDate(it.mtime)}</dd><dt>Oluşturma</dt><dd>${fmtDate(it.ctime)}</dd>${active.search ? `<dt>Konum</dt><dd>${esc(parentOf(it.path) || '')}</dd>` : ''}</dl>`;
}

/* ---------------- Açma ---------------- */
async function openItem(it, { inNewTab = false } = {}) {
  if (it.isDir) {
    if (inNewTab) addTab(it.path, { activate: false });
    else navigate(active, it.path);
    return;
  }
  if (it.ext === 'lnk') {
    const target = await nv.readLink(it.path);
    if (target) {
      const r = await nv.resolve(target, '');
      if (r.ok && r.isDir) { navigate(active, r.path); return; }
    }
  }
  const err = await nv.open(it.path);
  if (err) toast(`Açılamadı: ${err}`);
}
function openSelection() {
  const items = selItems();
  if (!items.length) return;
  if (items.length === 1) { openItem(items[0]); return; }
  const dirs = items.filter(i => i.isDir);
  const files = items.filter(i => !i.isDir).slice(0, 15);
  for (const f of files) nv.open(f.path);
  for (const d of dirs) addTab(d.path, { activate: false });
}

/* ---------------- Pano, yeni öğe, silme, yeniden adlandırma ---------------- */
let cutSet = new Set();
async function toClipboard(op) {
  const paths = selPaths();
  if (!paths.length) return;
  await nv.clipSet(op, paths);
  cutSet = op === 'move' ? new Set(paths) : new Set();
  renderVisible(true);
  toast(`${fmtN(paths.length)} öğe ${op === 'move' ? 'kesildi' : 'kopyalandı'}.`);
}
async function pasteInto(dir) {
  if (!dir) { toast('Buraya yapıştırılamaz.'); return; }
  const c = await nv.clipGet();
  if (!c || !c.paths || !c.paths.length) { toast('Panoda dosya yok.'); return; }
  const op = c.op === 'move' ? 'move' : 'copy';
  startJob(op, c.paths, dir, { fromClipboard: op === 'move' });
}

async function createItem(kind) {
  const dir = currentDir();
  if (!dir) { toast('Burada yeni öğe oluşturulamaz.'); return; }
  const r = await nv.create(dir, kind === 'dir' ? 'Yeni klasör' : 'Yeni Metin Belgesi.txt', kind);
  if (!r.ok) { toast(`Oluşturulamadı: ${r.error}`); return; }
  pushUndo({ type: 'create', path: r.path });
  await navigate(active, dir, { push: false, keep: true, select: r.path });
  startRename(r.path);
}

async function trashSelection() {
  const items = selItems();
  if (!items.length) return;
  const focus = active.focus;
  const r = await nv.trash(items.map(i => i.path));
  const done = items.length - r.failed.length;
  if (done) toast(`${fmtN(done)} öğe Geri Dönüşüm Kutusu'na taşındı.`);
  if (r.failed.length) toast(`${fmtN(r.failed.length)} öğe silinemedi: ${r.failed[0].message}`);
  await afterRemoval(items, focus);
}
async function deletePermanently() {
  const items = selItems();
  if (!items.length) return;
  const what = items.length === 1 ? `"${items[0].name}"` : `${fmtN(items.length)} öğe`;
  const ok = await confirmBox({ title: 'Kalıcı olarak sil', text: `${what} kalıcı olarak silinsin mi? Geri Dönüşüm Kutusu'na gitmez ve geri alınamaz.`, okLabel: 'Kalıcı olarak sil', danger: true });
  if (!ok) return;
  const focus = active.focus;
  const r = await nv.deletePermanent(items.map(i => i.path));
  if (r.failed.length) toast(`${fmtN(r.failed.length)} öğe silinemedi: ${r.failed[0].message}`);
  else toast(`${what} kalıcı olarak silindi.`);
  await afterRemoval(items, focus);
}
async function afterRemoval(items, focus) {
  const t = active;
  if (t.search) {
    const gone = new Set(items.map(i => i.path));
    t.search.results = t.search.results.filter(i => !gone.has(i.path));
    rebuild(t);
    t.sel = new Set();
    renderContent();
  } else await navigate(t, t.loc, { push: false, keep: true });
  if (t.items.length) selectOnly(clamp(focus, 0, t.items.length - 1));
  else selectionChanged();
  refreshWhere(items.map(i => parentOf(i.path)));
}

let renaming = null;
function cancelRename() {
  if (renaming) { renaming.cancel(); renaming = null; }
}
function startRename(target) {
  const t = active;
  if (isPCView(t)) return;
  let i = typeof target === 'string' ? t.items.findIndex(it => samePath(it.path, target)) : t.focus;
  if (i < 0 || !t.sel.has(t.items[i]?.path)) {
    const s = selItems(t);
    if (s.length !== 1) return;
    i = t.items.indexOf(s[0]);
  }
  if (i < 0) return;
  cancelRename();
  selectOnly(i);
  ensureVisible(i);
  const it = t.items[i];
  const input = document.createElement('input');
  input.className = 'rename';
  input.spellcheck = false;
  input.value = it.name;
  if (L.grid) {
    Object.assign(input.style, { left: `${GRID_PAD + (i % L.cols) * TILE_W}px`, top: `${GRID_PAD + Math.floor(i / L.cols) * TILE_H + 82}px`, width: `${TILE_W - 8}px` });
  } else {
    const nameCol = el.head.querySelector('.h-name');
    Object.assign(input.style, { left: '44px', top: `${i * ROW_H + 8}px`, width: `${Math.max(180, (nameCol ? nameCol.offsetWidth : 300) - 40)}px` });
  }
  el.canvas.appendChild(input);
  input.focus();
  const dot = it.isDir ? -1 : it.name.lastIndexOf('.');
  input.setSelectionRange(0, dot > 0 ? dot : it.name.length);
  let finished = false;
  const finish = async commit => {
    if (finished) return;
    finished = true;
    renaming = null;
    const value = input.value.trim();
    input.remove();
    el.scroller.focus({ preventScroll: true });
    if (!commit || !value || value === it.name) return;
    const r = await nv.rename(it.path, value);
    if (!r.ok) { toast(`Yeniden adlandırılamadı: ${r.error}`); return; }
    pushUndo({ type: 'rename', from: it.path, to: r.path });
    if (t.search) {
      const idx = t.search.results.findIndex(x => x.path === it.path);
      if (idx >= 0) t.search.results[idx] = toItem(parentOf(r.path), { n: baseName(r.path), d: it.isDir ? 1 : 0, s: it.size, m: it.mtime, c: it.ctime, path: r.path });
      rebuild(t);
      selectPaths(t, [r.path]);
      renderContent();
    } else await navigate(t, t.loc, { push: false, keep: true, select: r.path });
  };
  renaming = { cancel: () => finish(false) };
  input.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('mousedown', e => e.stopPropagation());
  input.addEventListener('dblclick', e => e.stopPropagation());
}

/* ---------------- Geri alma ---------------- */
const undoStack = [];
function pushUndo(u) { undoStack.push(u); if (undoStack.length > 40) undoStack.shift(); }
async function undo() {
  const u = undoStack.pop();
  if (!u) { toast('Geri alınacak işlem yok.'); return; }
  if (u.type === 'rename') {
    const r = await nv.rename(u.to, baseName(u.from));
    if (!r.ok) { toast(`Geri alınamadı: ${r.error}`); return; }
    toast('Yeniden adlandırma geri alındı.');
    refreshWhere([parentOf(u.from)]);
  } else if (u.type === 'move') {
    const groups = new Map();
    for (const [src, dest] of u.pairs) {
      const back = parentOf(src);
      if (!groups.has(back)) groups.set(back, []);
      groups.get(back).push(dest);
    }
    for (const [back, dests] of groups) startJob('move', dests, back, { noUndo: true });
    toast('Taşıma geri alınıyor.');
  } else if (u.type === 'copy' || u.type === 'create') {
    const paths = u.type === 'copy' ? u.pairs.map(p => p[1]) : [u.path];
    const r = await nv.trash(paths);
    toast(r.failed.length ? `Geri alınamadı: ${r.failed[0].message}` : `${u.type === 'copy' ? 'Kopyalama' : 'Oluşturma'} geri alındı; öğeler Geri Dönüşüm Kutusu'nda.`);
    refreshWhere(paths.map(parentOf));
  }
}

/* ---------------- Kopyalama / taşıma işleri ---------------- */
// The page names each job before starting it, so even a job that finishes at once finds its record.
const jobs = new Map();
function startJob(op, sources, destDir, extra = {}) {
  const id = uid();
  jobs.set(id, { id, op, sources, destDir, started: Date.now(), ...extra });
  nv.transfer(id, op, sources, destDir);
  renderJobs();
  renderStatus();
}
nv.onJob(m => {
  const j = jobs.get(m.id);
  if (!j) return;
  switch (m.state) {
    case 'start': Object.assign(j, { op: m.op, count: m.count, destDir: m.destDir }); break;
    case 'progress': j.progress = m; break;
    case 'conflict': conflictQueue.push({ j, m }); pumpConflicts(); break;
    case 'done': finishJob(j, m.result); break;
    case 'cancelled': jobs.delete(j.id); toast('İşlem iptal edildi.'); refreshWhere([j.destDir, ...(j.sources || []).map(parentOf)]); break;
    case 'error': jobs.delete(j.id); toast(`İşlem yapılamadı: ${m.message}`); break;
  }
  renderJobs();
  renderStatus();
});
function finishJob(j, result) {
  jobs.delete(j.id);
  if (result.op === 'move' && j.fromClipboard) { nv.clipClear(); cutSet = new Set(); }
  if (result.pairs.length && !j.noUndo) pushUndo({ type: result.op, pairs: result.pairs });
  for (const t of tabs) {
    if (!t.loc || t.loc === 'pc' || t.search) continue;
    const isDest = samePath(t.loc, j.destDir);
    const isSource = (j.sources || []).some(s => samePath(parentOf(s), t.loc));
    if (isDest || isSource) navigate(t, t.loc, { push: false, keep: !isDest, select: isDest && t === active && result.done.length ? result.done : null });
  }
  if (result.errors.length) toast(`${fmtN(result.errors.length)} öğe işlenemedi: ${result.errors[0].message}`);
  else if (!result.done.length && result.skipped) toast('Öğeler atlandı; değişiklik yapılmadı.');
}
let jobsTimer = 0;
function renderJobs() {
  const now = Date.now();
  const visible = [...jobs.values()].filter(j => now - (j.started || now) > 400);
  el.jobs.innerHTML = visible.map(j => {
    const p = j.progress;
    const pct = p && p.totalBytes ? Math.round(p.doneBytes / p.totalBytes * 100) : p && p.totalFiles ? Math.round(p.doneFiles / p.totalFiles * 100) : 0;
    const verb = j.op === 'move' ? 'Taşınıyor' : 'Kopyalanıyor';
    const detail = p ? `${p.totalBytes ? `${fmtSize(p.doneBytes)} / ${fmtSize(p.totalBytes)}` : `${fmtN(p.doneFiles)} / ${fmtN(p.totalFiles)}`} · ${esc(p.current || '')}` : 'Hazırlanıyor…';
    return `<div class="job"><div class="job-top"><span class="job-title">${verb} → ${esc(locLabel(j.destDir || ''))}</span><button class="job-cancel" type="button" data-job="${j.id}">İptal</button></div><span class="bar"><i style="width:${pct}%"></i></span><span class="job-detail">${detail}</span></div>`;
  }).join('');
  clearTimeout(jobsTimer);
  if (jobs.size) jobsTimer = setTimeout(renderJobs, 450);
}
el.jobs.addEventListener('click', e => {
  const b = e.target.closest('[data-job]');
  if (b) nv.cancelJob(b.dataset.job);
});

const conflictQueue = [];
let conflictOpen = false;
async function pumpConflicts() {
  if (conflictOpen || !conflictQueue.length) return;
  conflictOpen = true;
  const { j, m } = conflictQueue.shift();
  const name = baseName(m.dest);
  $('#cf-text').textContent = `"${name}" adlı bir ${m.isDir ? 'klasör' : 'dosya'} ${locLabel(parentOf(m.dest) || '')} içinde zaten var.`;
  const info = (size, mtime) => (m.isDir ? `Klasör\n${fmtDate(mtime)}` : `${fmtSize(size)}\n${fmtDate(mtime)}`);
  $('#cf-src').textContent = info(m.srcSize, m.srcMtime);
  $('#cf-dest').textContent = info(m.destSize, m.destMtime);
  $('#cf-src').style.whiteSpace = $('#cf-dest').style.whiteSpace = 'pre-line';
  $('#cf-replace').textContent = m.isDir ? 'Birleştir' : 'Değiştir';
  $('#cf-all').checked = false;
  const r = await ask($('#dlg-conflict'));
  nv.conflictReply(j.id, m.reqId, { action: ['replace', 'keep', 'skip'].includes(r) ? r : 'cancel', all: $('#cf-all').checked });
  conflictOpen = false;
  pumpConflicts();
}

/* ---------------- Arama ---------------- */
function startSearch(q) {
  const t = active;
  const dir = currentDir(t) || (t.search && t.search.root);
  if (!q.trim() || !dir) return;
  stopSearch(t);
  const token = uid();
  t.filter = '';
  t.search = { query: q.trim(), token, root: dir, results: [], running: true, truncated: false };
  t.sel = new Set();
  t.focus = t.anchor = -1;
  nv.search(token, dir, t.search.query);
  nv.watch('');
  renderAll();
  el.scroller.scrollTop = 0;
}
function stopSearch(t) {
  if (t && t.search && t.search.running) nv.cancelSearch(t.search.token);
  if (t) t.search = null;
}
function clearSearch() {
  const t = active;
  const had = !!t.search;
  stopSearch(t);
  t.filter = '';
  el.search.value = '';
  rebuild(t);
  if (had) { t.sel = new Set(); t.focus = -1; nv.watch(currentDir(t) || ''); }
  renderAll();
}
let searchRedraw = 0;
nv.onSearch(({ token, items, done, truncated }) => {
  const t = tabs.find(x => x.search && x.search.token === token);
  if (!t) return;
  for (const e of items) t.search.results.push(toItem(parentOf(e.path), e));
  if (done) { t.search.running = false; t.search.truncated = !!truncated; }
  if (searchRedraw) return;
  searchRedraw = requestAnimationFrame(() => {
    searchRedraw = 0;
    if (!t.search) return;
    const focusPath = t.items[t.focus]?.path;
    rebuild(t);
    if (focusPath) t.focus = t.items.findIndex(i => i.path === focusPath);
    if (t === active) { renderContent(); renderStatus(); renderTabs(); }
  });
});

/* ---------------- Özellikler ---------------- */
let sizeTokens = [];
nv.onSizeProgress(p => { const h = sizeHandlers.get(p.token); if (h) h(p); });
const sizeHandlers = new Map();
async function showProps(items) {
  if (!items.length) {
    const dir = currentDir();
    if (!dir) return;
    items = [{ name: locLabel(dir), path: dir, isDir: true, type: 'Dosya klasörü', cat: 'folder', ext: '' }];
  }
  const dlg = $('#dlg-props');
  const rows = $('#pr-rows');
  const one = items.length === 1 ? items[0] : null;
  $('#pr-icon').innerHTML = one ? iconHTML(one, true) : `<span class="ic cat-file"><svg><use href="#f-file"/></svg></span>`;
  $('#pr-name').textContent = one ? one.name : `${fmtN(items.length)} öğe`;
  const parents = [...new Set(items.map(i => parentOf(i.path) || ''))];
  const cells = [];
  cells.push(['Tür', one ? one.type : [...new Set(items.map(i => i.type))].length === 1 ? items[0].type : 'Çeşitli türler']);
  cells.push(['Konum', parents.length === 1 ? parents[0] || 'Bu Bilgisayar' : 'Çeşitli klasörler']);
  cells.push(['Boyut', '<span id="pr-size">Hesaplanıyor…</span>']);
  cells.push(['İçerik', '<span id="pr-contents">—</span>']);
  if (one) {
    const st = await nv.stat(one.path);
    if (st.ok) {
      cells.push(['Oluşturma', fmtDate(st.ctime)], ['Değiştirme', fmtDate(st.mtime)], ['Erişim', fmtDate(st.atime)]);
      const attrs = [st.attrs & 1 ? 'Salt okunur' : '', st.attrs & 2 ? 'Gizli' : '', st.attrs & 4 ? 'Sistem' : ''].filter(Boolean);
      cells.push(['Öznitelikler', attrs.length ? attrs.join(', ') : 'Yok']);
    }
  }
  rows.innerHTML = cells.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${k === 'Boyut' || k === 'İçerik' ? v : esc(v)}</dd>`).join('');
  const total = { bytes: 0, files: 0, dirs: 0 };
  const show = (extra = { bytes: 0, files: 0, dirs: 0 }, doneAll = false) => {
    const b = total.bytes + extra.bytes;
    const sz = $('#pr-size');
    const ct = $('#pr-contents');
    if (sz) sz.textContent = `${fmtSize(b)} (${fmtN(b)} bayt)${doneAll ? '' : ' · hesaplanıyor…'}`;
    if (ct) ct.textContent = `${fmtN(total.files + extra.files)} dosya, ${fmtN(total.dirs + extra.dirs)} klasör`;
  };
  for (const i of items) if (!i.isDir) { total.bytes += i.size; total.files++; }
  show();
  const open = ask(dlg);
  const dirs = items.filter(i => i.isDir);
  sizeTokens = [];
  (async () => {
    for (const d of dirs) {
      const token = uid();
      sizeTokens.push(token);
      sizeHandlers.set(token, p => show(p));
      const r = await nv.folderSize(token, d.path);
      sizeHandlers.delete(token);
      if (!dlg.open) return;
      // A single folder reports what it contains; in a multi-selection the folder itself counts too.
      if (r.ok) { total.bytes += r.bytes; total.files += r.files; total.dirs += r.dirs + (items.length > 1 ? 1 : 0); }
    }
    if (dlg.open) show(undefined, true);
  })();
  await open;
  for (const t of sizeTokens) nv.cancelSize(t);
  el.scroller.focus({ preventScroll: true });
}

/* ---------------- Diyaloglar ve bildirim ---------------- */
function ask(dlg) {
  return new Promise(res => {
    closeMenus(false);
    dlg.returnValue = '';
    dlg.showModal();
    dlg.addEventListener('close', () => res(dlg.returnValue || 'cancel'), { once: true });
  });
}
async function confirmBox({ title, text, okLabel = 'Tamam', danger = false }) {
  $('#cfm-title').textContent = title;
  $('#cfm-text').textContent = text;
  const ok = $('#cfm-ok');
  ok.textContent = okLabel;
  ok.className = danger ? 'danger' : 'primary';
  return (await ask($('#dlg-confirm'))) === 'ok';
}
let toastTimer = 0;
function toast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), 3200);
}

const SHORTCUT_DOC = [
  ['Aç', 'Enter / çift tıklama'], ['Geri / İleri', 'Alt+Sol / Alt+Sağ / Geri tuşu'], ['Üst klasör', 'Alt+Yukarı'],
  ['Adres çubuğu', 'Ctrl+L / Alt+D / F4'], ['Ara', 'Ctrl+F / Ctrl+E'], ['Yenile', 'F5'],
  ['Yeni sekme / Sekmeyi kapat', 'Ctrl+T / Ctrl+W'], ['Sonraki / önceki sekme', 'Ctrl+Tab / Ctrl+Shift+Tab'], ['Yeni pencere', 'Ctrl+N'],
  ['Yeni klasör', 'Ctrl+Shift+N'], ['Yeniden adlandır', 'F2'], ['Kes / Kopyala / Yapıştır', 'Ctrl+X / Ctrl+C / Ctrl+V'],
  ['Geri Dönüşüm Kutusu\'na taşı', 'Del / Ctrl+D'], ['Kalıcı olarak sil (onay ister)', 'Shift+Del'], ['Geri al', 'Ctrl+Z'],
  ['Tümünü seç', 'Ctrl+A'], ['Yolu kopyala', 'Ctrl+Shift+C'], ['Özellikler', 'Alt+Enter'], ['Önizleme bölmesi', 'Alt+P'],
  ['Ada göre atla', 'Harf yaz'], ['Kopyala / taşı (sürüklerken)', 'Ctrl / Shift basılı tut'],
];
function openShortcuts() {
  $('#keys-list').innerHTML = SHORTCUT_DOC.map(([a, k]) => `<span>${esc(a)}</span><span class="kk">${esc(k)}</span>`).join('');
  ask($('#dlg-keys'));
}

/* ---------------- Menüler ---------------- */
let menuState = null;
const CHECK = '<svg><use href="#i-chev"/></svg>';

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
    b.innerHTML = `<span class="chk">${checked ? (it.radio ? '●' : '✓') : it.icon ? svg(it.icon) : ''}</span><span>${esc(it.label)}</span><span class="k">${esc(it.key || '')}</span><span class="arr">${it.sub ? '›' : ''}</span>`;
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
  el.popups.appendChild(pop);
  placePopup(pop, x, y);
  return pop;
}
function placePopup(pop, x, y, altX) {
  const w = pop.offsetWidth, h = pop.offsetHeight;
  let left = x;
  if (left + w > innerWidth - 8) left = altX !== undefined ? altX - w : innerWidth - w - 8;
  let top = y;
  if (top + h > innerHeight - 8) top = Math.max(8, innerHeight - h - 8);
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
  const sub = renderPopup(btn._item.sub, r.right - 2, r.top - 6, +pop.dataset.level + 1);
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
  const cur = items.indexOf(document.activeElement);
  const lvl = +pop.dataset.level;
  const handled = () => { e.preventDefault(); e.stopPropagation(); };
  switch (e.key) {
    case 'ArrowDown': handled(); focusItem(pop, cur + 1); break;
    case 'ArrowUp': handled(); focusItem(pop, cur < 0 ? -1 : cur - 1); break;
    case 'ArrowRight': { handled(); const b = document.activeElement; if (b?._item?.sub) openSub(pop, b, true); break; }
    case 'ArrowLeft':
    case 'Escape':
      handled();
      if (lvl > 0) {
        const parent = menuState.stack[lvl - 1];
        trimStack(parent);
        parent.querySelector('.mi.open')?.classList.remove('open');
        focusItem(parent, 0);
      } else closeMenus(true);
      break;
    case 'Enter': case ' ': handled(); document.activeElement?.click(); break;
    case 'Tab': handled(); closeMenus(true); break;
  }
}
function openMenu(items, x, y, btn) {
  closeMenus(false);
  const pop = renderPopup(items, x, y, 0);
  menuState = { btn, stack: [pop] };
  btn?.classList.add('open');
  focusItem(pop, 0);
}
function closeMenus(restoreFocus = true) {
  if (!menuState) return;
  for (const p of menuState.stack) p.remove();
  menuState.btn?.classList.remove('open');
  menuState = null;
  if (restoreFocus) el.scroller.focus({ preventScroll: true });
}
document.addEventListener('mousedown', e => {
  if (!menuState) return;
  if (e.target.closest('.popup') || (menuState.btn && menuState.btn.contains(e.target))) return;
  closeMenus(false);
}, true);
window.addEventListener('blur', () => closeMenus(false));

const NEW_MENU = () => [
  { label: 'Klasör', key: 'Ctrl+Shift+N', icon: 'i-newfolder', run: () => createItem('dir') },
  { label: 'Metin belgesi', icon: 'i-newfile', run: () => createItem('file') },
];
const SORT_MENU = () => [
  ...(active.search ? HEADS.search : HEADS.normal).map(([k, label]) => ({ label, radio: () => S.sortKey === k, run: () => { if (S.sortKey !== k) setSort(k); } })),
  '-',
  { label: 'Artan', radio: () => S.sortDir > 0, run: () => { S.sortDir = 1; saveSettings(); resort(); } },
  { label: 'Azalan', radio: () => S.sortDir < 0, run: () => { S.sortDir = -1; saveSettings(); resort(); } },
];
const VIEW_MENU = () => [
  { label: 'Ayrıntılar', icon: 'i-list', radio: () => S.view === 'details', run: () => setView('details') },
  { label: 'Kutucuklar', icon: 'i-view', radio: () => S.view === 'grid', run: () => setView('grid') },
  '-',
  { label: 'Gizli öğeler', check: () => S.showHidden, run: () => { S.showHidden = !S.showHidden; saveSettings(); resort(); renderStatus(); } },
  { label: 'Dosya uzantıları', check: () => S.showExt, run: () => { S.showExt = !S.showExt; saveSettings(); renderVisible(true); } },
  { label: 'Önizleme bölmesi', key: 'Alt+P', check: () => S.preview, run: togglePreview },
];
const MORE_MENU = () => [
  { label: 'Yeni pencere', key: 'Ctrl+N', icon: 'i-window', run: () => nv.newWindow(currentDir() || '') },
  { label: 'Terminalde aç', icon: 'i-terminal', enabled: () => !!currentDir(), run: () => nv.openTerminal(currentDir()) },
  { label: "Windows Gezgini'nde aç", icon: 'i-folder', enabled: () => !!currentDir(), run: () => nv.showInExplorer(currentDir()) },
  { label: 'Geri Dönüşüm Kutusu', icon: 'i-trash', run: () => nv.openRecycleBin() },
  '-',
  { label: "Gezgin pencerelerini NeuralNav'a aktar", check: () => watcher.enabled, enabled: () => watcher.available, run: toggleWatcher },
  { label: 'Tema', sub: THEMES.map(t => ({ label: t.name, radio: () => S.theme === t.id, run: () => { S.theme = t.id; saveSettings(); applyTheme(); } })) },
  { label: 'Klavye kısayolları', run: openShortcuts },
  { label: 'NeuralNav hakkında', run: () => ask($('#dlg-about')) },
];

function itemMenu() {
  const items = selItems();
  const one = items.length === 1 ? items[0] : null;
  const allFiles = items.every(i => !i.isDir);
  const textLike = items.length && allFiles && items.every(i => TEXT_EXT.has(i.ext) || !i.ext);
  const m = [{ label: 'Aç', key: 'Enter', run: openSelection }];
  if (one && one.isDir) {
    m.push({ label: 'Yeni sekmede aç', run: () => addTab(one.path, { activate: false }) });
    m.push({ label: 'Yeni pencerede aç', run: () => nv.newWindow(one.path) });
  }
  if (one && !one.isDir) m.push({ label: 'Birlikte aç…', run: () => nv.openWith(one.path) });
  if (textLike && places.neuralPad) m.push({ label: 'NeuralPad ile aç', icon: 'i-documents', run: () => nv.openInNeuralPad(items.map(i => i.path)) });
  if (active.search && one) m.push({ label: 'Dosya konumunu aç', run: () => navigate(active, parentOf(one.path), { select: one.path }) });
  m.push('-');
  m.push({ label: 'Kes', key: 'Ctrl+X', icon: 'i-cut', run: () => toClipboard('move') });
  m.push({ label: 'Kopyala', key: 'Ctrl+C', icon: 'i-copy', run: () => toClipboard('copy') });
  if (one && one.isDir) m.push({ label: 'Bu klasöre yapıştır', icon: 'i-paste', run: () => pasteInto(one.path) });
  m.push({ label: 'Yolu kopyala', key: 'Ctrl+Shift+C', run: copyPaths });
  m.push('-');
  m.push({ label: 'Yeniden adlandır', key: 'F2', icon: 'i-rename', enabled: () => !!one, run: () => startRename() });
  m.push({ label: 'Sil', key: 'Del', icon: 'i-delete', run: trashSelection });
  m.push({ label: 'Kalıcı olarak sil…', key: 'Shift+Del', run: deletePermanently });
  m.push('-');
  if (one && one.isDir) {
    const pinned = S.pins.some(p => samePath(p, one.path));
    m.push({ label: pinned ? 'Hızlı erişimden kaldır' : 'Hızlı erişime sabitle', icon: 'i-pin', run: () => togglePin(one.path) });
    m.push({ label: 'Terminalde aç', icon: 'i-terminal', run: () => nv.openTerminal(one.path) });
  }
  if (one) m.push({ label: "Windows Gezgini'nde göster", icon: 'i-folder', run: () => nv.showInExplorer(one.path) });
  m.push({ label: 'Özellikler', key: 'Alt+Enter', icon: 'i-props', run: () => showProps(selItems()) });
  return m;
}
function backgroundMenu() {
  const dir = currentDir();
  return [
    { label: 'Görünüm', icon: 'i-view', sub: VIEW_MENU() },
    { label: 'Sırala', icon: 'i-sort', sub: SORT_MENU() },
    { label: 'Yenile', key: 'F5', icon: 'i-refresh', run: () => refresh() },
    '-',
    { label: 'Yapıştır', key: 'Ctrl+V', icon: 'i-paste', enabled: () => !!dir, run: () => pasteInto(dir) },
    { label: 'Geri al', key: 'Ctrl+Z', icon: 'i-undo', enabled: () => undoStack.length > 0, run: undo },
    '-',
    { label: 'Yeni', icon: 'i-plus', enabled: () => !!dir, sub: NEW_MENU() },
    '-',
    { label: 'Terminalde aç', icon: 'i-terminal', enabled: () => !!dir, run: () => nv.openTerminal(dir) },
    { label: "Windows Gezgini'nde aç", icon: 'i-folder', enabled: () => !!dir, run: () => nv.showInExplorer(dir) },
    { label: 'Özellikler', icon: 'i-props', enabled: () => !!dir, run: () => showProps([]) },
  ];
}

let watcher = { available: false, enabled: false };
async function toggleWatcher() {
  const on = await nv.watcherSet(!watcher.enabled);
  watcher.enabled = on;
  toast(on
    ? "Açık: yeni Gezgin pencereleri NeuralNav'da açılacak (bilgisayar açılınca da)."
    : 'Kapalı: Gezgin pencereleri artık Windows Gezgini\'nde kalacak.');
}

function setView(v) { S.view = v; saveSettings(); renderContent(); if (active.focus >= 0) ensureVisible(active.focus); }
function togglePreview() { S.preview = !S.preview; saveSettings(); updateCommands(); if (S.preview) renderPreview(); }
function togglePin(p) {
  if (S.pins.some(x => samePath(x, p))) S.pins = S.pins.filter(x => !samePath(x, p));
  else S.pins.push(p);
  saveSettings();
  renderSidebar();
}
async function copyPaths() {
  const paths = selPaths();
  const text = (paths.length ? paths : [currentDir() || '']).filter(Boolean).map(p => `"${p}"`).join('\r\n');
  try { await navigator.clipboard.writeText(text); toast('Yol panoya kopyalandı.'); } catch { toast('Yol kopyalanamadı.'); }
}

/* ---------------- Komut çubuğu ve araç çubuğu ---------------- */
el.cmdbar.addEventListener('click', e => {
  const b = e.target.closest('[data-cmd]');
  if (!b || b.disabled) return;
  const r = b.getBoundingClientRect();
  const at = items => openMenu(items, r.left, r.bottom + 4, b);
  switch (b.dataset.cmd) {
    case 'new': at(NEW_MENU()); break;
    case 'cut': toClipboard('move'); break;
    case 'copy': toClipboard('copy'); break;
    case 'paste': pasteInto(currentDir()); break;
    case 'rename': startRename(); break;
    case 'delete': trashSelection(); break;
    case 'sort': at(SORT_MENU()); break;
    case 'view': at(VIEW_MENU()); break;
    case 'preview': togglePreview(); break;
    case 'terminal': nv.openTerminal(currentDir()); break;
    case 'more': at(MORE_MENU()); break;
  }
});
el.cmdbar.addEventListener('mousedown', e => { if (e.target.closest('[data-cmd]')) e.preventDefault(); });

$('#nav-back').addEventListener('click', () => goBack());
$('#nav-forward').addEventListener('click', () => goForward());
$('#nav-up').addEventListener('click', () => goUp());
$('#nav-refresh').addEventListener('click', () => refresh());
$('#tab-new').addEventListener('click', () => addTab('pc'));

el.crumbs.addEventListener('click', e => {
  const b = e.target.closest('.crumb[data-path]');
  if (!b) return;
  e.stopPropagation();
  navigate(active, b.dataset.path);
});
el.crumbs.addEventListener('auxclick', e => {
  const b = e.target.closest('.crumb[data-path]');
  if (b && e.button === 1) addTab(b.dataset.path, { activate: false });
});
function editAddress() {
  el.crumbs.hidden = true;
  el.addressInput.hidden = false;
  el.addressInput.value = active.loc === 'pc' || !active.loc ? 'Bu Bilgisayar' : active.loc;
  el.addressInput.focus();
  el.addressInput.select();
}
function endAddressEdit() {
  el.addressInput.hidden = true;
  el.crumbs.hidden = false;
}
el.address.addEventListener('click', e => { if (!e.target.closest('.crumb') && el.addressInput.hidden) editAddress(); });
el.addressInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); const v = el.addressInput.value; endAddressEdit(); goTo(v); el.scroller.focus(); }
  else if (e.key === 'Escape') { e.preventDefault(); endAddressEdit(); el.scroller.focus(); }
});
el.addressInput.addEventListener('blur', endAddressEdit);

el.search.addEventListener('input', () => {
  const t = active;
  if (t.search) stopSearch(t);
  t.filter = el.search.value;
  rebuild(t);
  t.focus = -1;
  renderAll();
});
el.search.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); startSearch(el.search.value); }
  else if (e.key === 'Escape') { e.preventDefault(); clearSearch(); el.scroller.focus(); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); el.scroller.focus(); if (active.items.length) { selectOnly(0); ensureVisible(0); } }
});
el.searchClear.addEventListener('click', () => { clearSearch(); el.search.focus(); });

el.head.addEventListener('click', e => {
  const b = e.target.closest('[data-sort]');
  if (b) setSort(b.dataset.sort);
});

/* ---------------- Kenar çubuğu ve Bu Bilgisayar ---------------- */
function placeClick(e) {
  const b = e.target.closest('[data-path], [data-action]');
  if (!b) return;
  if (b.dataset.action === 'recycle') { nv.openRecycleBin(); return; }
  if (e.ctrlKey || e.button === 1) addTab(b.dataset.path, { activate: false });
  else navigate(active, b.dataset.path);
}
el.sidebar.addEventListener('click', placeClick);
el.sidebar.addEventListener('auxclick', e => { if (e.button === 1) placeClick(e); });
el.pc.addEventListener('click', placeClick);
el.pc.addEventListener('auxclick', e => { if (e.button === 1) placeClick(e); });
el.sidebar.addEventListener('contextmenu', e => {
  const b = e.target.closest('[data-path]');
  e.preventDefault();
  if (!b) return;
  const p = b.dataset.path;
  const items = [
    { label: 'Aç', run: () => navigate(active, p) },
    { label: 'Yeni sekmede aç', run: () => addTab(p, { activate: false }) },
    { label: 'Yeni pencerede aç', run: () => nv.newWindow(p === 'pc' ? '' : p) },
  ];
  if (b.classList.contains('pin')) items.push('-', { label: 'Hızlı erişimden kaldır', icon: 'i-pin', run: () => togglePin(p) });
  openMenu(items, e.clientX, e.clientY, null);
});

/* ---------------- Fare: seçim, açma, sağ tık, çerçeveyle seçme ---------------- */
let pendingSingle = -1;
const indexOf = e => { const t = e.target.closest('[data-i]'); return t ? +t.dataset.i : -1; };
el.scroller.addEventListener('mousedown', e => {
  if (e.target.classList.contains('rename')) return;
  if (e.target === el.scroller && e.offsetX >= el.scroller.clientWidth) return; // scrollbar
  el.scroller.focus({ preventScroll: true });
  const i = indexOf(e);
  if (e.button === 0 && e.detail >= 2 && i >= 0 && !e.ctrlKey && !e.shiftKey) {
    pendingSingle = -1;
    openItem(active.items[i]);
    return;
  }
  if (e.button === 0) {
    if (i >= 0) {
      const p = active.items[i].path;
      if (e.ctrlKey) toggleSel(i);
      else if (e.shiftKey) rangeSel(i, false);
      else if (!active.sel.has(p)) selectOnly(i);
      else { pendingSingle = i; active.focus = i; }
    } else startMarquee(e);
  } else if (e.button === 2) {
    if (i >= 0 && !active.sel.has(active.items[i].path)) selectOnly(i);
    else if (i < 0) clearSel();
  }
});
document.addEventListener('mouseup', () => {
  if (pendingSingle >= 0) { const i = pendingSingle; pendingSingle = -1; selectOnly(i); }
});
el.scroller.addEventListener('auxclick', e => {
  const i = indexOf(e);
  if (e.button === 1 && i >= 0 && active.items[i].isDir) addTab(active.items[i].path, { activate: false });
});
el.scroller.addEventListener('contextmenu', e => {
  e.preventDefault();
  const i = indexOf(e);
  openMenu(i >= 0 ? itemMenu() : backgroundMenu(), e.clientX, e.clientY, null);
});
el.scroller.addEventListener('scroll', () => requestAnimationFrame(() => renderVisible(false)));
new ResizeObserver(() => {
  if (!active || isPCView()) return;
  const before = L.grid ? L.cols : 0;
  L = computeLayout();
  el.canvas.style.height = L.height + 'px';
  renderVisible(before !== (L.grid ? L.cols : 0));
}).observe(el.scroller);

function indicesInRect(x0, y0, x1, y1) {
  const out = [];
  const n = active.items.length;
  if (L.grid) {
    const c0 = Math.max(0, Math.floor((x0 - GRID_PAD) / TILE_W));
    const c1 = Math.min(L.cols - 1, Math.floor((x1 - GRID_PAD) / TILE_W));
    const r0 = Math.max(0, Math.floor((y0 - GRID_PAD) / TILE_H));
    const r1 = Math.floor((y1 - GRID_PAD) / TILE_H);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) { const i = r * L.cols + c; if (i < n) out.push(i); }
  } else {
    const r0 = Math.max(0, Math.floor((y0 - 6) / ROW_H));
    const r1 = Math.min(n - 1, Math.floor((y1 - 6) / ROW_H));
    for (let i = r0; i <= r1; i++) out.push(i);
  }
  return out;
}
function startMarquee(e) {
  if (isPCView()) return;
  const additive = e.ctrlKey;
  const base = additive ? new Set(active.sel) : new Set();
  if (!additive && active.sel.size) clearSel();
  const c0 = el.canvas.getBoundingClientRect();
  const sx = e.clientX - c0.left;
  const sy = e.clientY - c0.top;
  const box = document.createElement('div');
  box.className = 'marquee';
  let lx = e.clientX, ly = e.clientY, moved = false, raf = 0;
  const update = () => {
    const c = el.canvas.getBoundingClientRect();
    const x = lx - c.left, y = ly - c.top;
    const x0 = Math.min(sx, x), x1 = Math.max(sx, x), y0 = Math.min(sy, y), y1 = Math.max(sy, y);
    Object.assign(box.style, { left: x0 + 'px', top: y0 + 'px', width: (x1 - x0) + 'px', height: (y1 - y0) + 'px' });
    const next = new Set(base);
    for (const i of indicesInRect(x0, y0, x1, y1)) {
      const p = active.items[i].path;
      if (additive && base.has(p)) next.delete(p); else next.add(p);
    }
    active.sel = next;
    paintSelection();
    renderStatus();
  };
  const tick = () => {
    const r = el.scroller.getBoundingClientRect();
    if (moved) {
      if (ly < r.top + 24) el.scroller.scrollTop -= 14;
      else if (ly > r.bottom - 24) el.scroller.scrollTop += 14;
      update();
    }
    raf = requestAnimationFrame(tick);
  };
  const onMove = ev => {
    lx = ev.clientX; ly = ev.clientY;
    if (!moved && Math.abs(lx - e.clientX) + Math.abs(ly - e.clientY) > 4) { moved = true; el.canvas.appendChild(box); }
  };
  const onUp = () => {
    cancelAnimationFrame(raf);
    box.remove();
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    selectionChanged();
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
  raf = requestAnimationFrame(tick);
}

/* ---------------- Sürükle bırak ---------------- */
let dragOut = null;
el.scroller.addEventListener('dragstart', e => {
  const i = indexOf(e);
  e.preventDefault();
  if (i < 0) return;
  pendingSingle = -1;
  if (!active.sel.has(active.items[i].path)) selectOnly(i);
  const paths = selPaths();
  dragOut = { paths, at: Date.now() };
  nv.startDrag(paths);
});
const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
let dropEl = null;
function markDrop(node) {
  if (dropEl === node) return;
  dropEl?.classList.remove('drop');
  dropEl = node;
  dropEl?.classList.add('drop');
}
function dropTarget(e) {
  const dragged = dragOut && Date.now() - dragOut.at < 120000 ? dragOut.paths : [];
  const node = e.target.closest('[data-i], .side-item[data-path], .crumb[data-path], .pc-card[data-path]');
  if (node && node.dataset.i !== undefined) {
    const it = active.items[+node.dataset.i];
    if (it && it.isDir && !dragged.some(p => samePath(p, it.path))) return { dir: it.path, node };
  } else if (node && node.dataset.path && node.dataset.path !== 'pc') {
    return { dir: node.dataset.path, node };
  }
  if (e.target.closest('#content') && currentDir()) return { dir: currentDir(), node: null };
  return null;
}
function dropEffect(e, dir, paths) {
  if (e.ctrlKey) return 'copy';
  if (e.shiftKey) return 'move';
  const src = paths && paths[0];
  return src && sameRoot(src, dir) ? 'move' : 'copy';
}
window.addEventListener('dragover', e => {
  if (!hasFiles(e)) return;
  const t = dropTarget(e);
  markDrop(t ? t.node : null);
  if (!t) { e.dataTransfer.dropEffect = 'none'; return; }
  e.preventDefault();
  e.dataTransfer.dropEffect = dropEffect(e, t.dir, dragOut ? dragOut.paths : null);
});
window.addEventListener('dragleave', e => { if (!e.relatedTarget) markDrop(null); });
window.addEventListener('drop', e => {
  markDrop(null);
  if (!hasFiles(e)) return;
  const t = dropTarget(e);
  e.preventDefault();
  dragOut = null;
  if (!t) return;
  const paths = [...e.dataTransfer.files].map(f => nv.pathForFile(f)).filter(Boolean);
  if (!paths.length) return;
  if (paths.some(p => samePath(p, t.dir))) return;
  if (paths.every(p => samePath(parentOf(p) || '', t.dir))) return;
  startJob(dropEffect(e, t.dir, paths), paths, t.dir);
});

/* ---------------- Klavye ---------------- */
const isTyping = node => node && (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.isContentEditable);
const GLOBAL_KEYS = {
  'Ctrl+T': () => addTab('pc'),
  'Ctrl+W': () => closeTab(),
  'Ctrl+N': () => nv.newWindow(currentDir() || ''),
  'Ctrl+L': editAddress, 'Alt+D': editAddress, 'F4': editAddress,
  'Ctrl+F': () => { el.search.focus(); el.search.select(); }, 'Ctrl+E': () => { el.search.focus(); el.search.select(); },
  'Ctrl+Tab': () => cycleTab(1), 'Ctrl+Shift+Tab': () => cycleTab(-1),
  'F5': () => refresh(),
  'Alt+P': togglePreview,
};
const LIST_KEYS = {
  'Enter': openSelection,
  'Alt+Enter': () => showProps(selItems()),
  'Backspace': () => goBack(),
  'Alt+ArrowLeft': () => goBack(), 'Alt+ArrowRight': () => goForward(), 'Alt+ArrowUp': () => goUp(),
  'Delete': trashSelection, 'Ctrl+D': trashSelection, 'Shift+Delete': deletePermanently,
  'F2': () => startRename(),
  'Ctrl+C': () => toClipboard('copy'), 'Ctrl+X': () => toClipboard('move'), 'Ctrl+V': () => pasteInto(currentDir()),
  'Ctrl+Z': undo, 'Ctrl+A': selectAll,
  'Ctrl+Shift+N': () => createItem('dir'),
  'Ctrl+Shift+C': copyPaths,
  'Escape': () => { if (active.search || active.filter) clearSearch(); else clearSel(); },
  'Ctrl+ ': () => { if (active.focus >= 0) toggleSel(active.focus); },
};
let taBuf = '', taTime = 0;
function typeAhead(ch) {
  const now = Date.now();
  taBuf = now - taTime > 900 ? ch : taBuf + ch;
  taTime = now;
  const q = taBuf.toLocaleLowerCase('tr-TR');
  const items = active.items;
  const start = taBuf.length === 1 ? active.focus + 1 : Math.max(0, active.focus);
  for (let k = 0; k < items.length; k++) {
    const i = (start + k) % items.length;
    if (items[i].lower.startsWith(q)) { selectOnly(i); ensureVisible(i); return; }
  }
}
function navKey(e) {
  const t = active;
  if (isPCView(t)) return false;
  const n = t.items.length;
  if (!n) return false;
  const cols = L.grid ? L.cols : 1;
  const page = Math.max(1, Math.floor(el.scroller.clientHeight / (L.grid ? TILE_H : ROW_H))) * cols;
  let i = t.focus;
  switch (e.key) {
    case 'ArrowDown': i = i < 0 ? 0 : i + cols; break;
    case 'ArrowUp': i = i < 0 ? 0 : i - cols; break;
    case 'ArrowRight': if (!L.grid) return false; i = i + 1; break;
    case 'ArrowLeft': if (!L.grid) return false; i = Math.max(0, i - 1); break;
    case 'Home': i = 0; break;
    case 'End': i = n - 1; break;
    case 'PageDown': i = Math.max(0, i) + page; break;
    case 'PageUp': i = Math.max(0, i) - page; break;
    default: return false;
  }
  e.preventDefault();
  i = clamp(i, 0, n - 1);
  if (e.shiftKey) rangeSel(i, e.ctrlKey);
  else if (e.ctrlKey) { t.focus = i; selectionChanged(); }
  else selectOnly(i);
  ensureVisible(i);
  return true;
}
window.addEventListener('keydown', e => {
  if (document.querySelector('dialog[open]')) return;
  const ctrl = e.ctrlKey || e.metaKey;
  const key = /^Key[A-Z]$/.test(e.code) ? e.code.slice(3) : e.key;
  const id = (ctrl ? 'Ctrl+' : '') + (e.altKey ? 'Alt+' : '') + (e.shiftKey ? 'Shift+' : '') + key;
  if (GLOBAL_KEYS[id]) { e.preventDefault(); closeMenus(false); GLOBAL_KEYS[id](); return; }
  if (isTyping(e.target) || menuState) return;
  // Enter and Space on a focused button or tab belong to that control.
  if ((e.key === 'Enter' || e.key === ' ') && e.target.closest && e.target.closest('button, .tab')) return;
  if (LIST_KEYS[id]) { e.preventDefault(); LIST_KEYS[id](); return; }
  if (navKey(e)) return;
  if (!ctrl && !e.altKey && e.key.length === 1 && e.key !== ' ' && !isPCView()) { e.preventDefault(); typeAhead(e.key); }
}, true);
window.addEventListener('mouseup', e => {
  if (e.button === 3) { e.preventDefault(); goBack(); }
  else if (e.button === 4) { e.preventDefault(); goForward(); }
});

/* ---------------- Pencere ---------------- */
for (const id of ['win-min', 'win-max', 'win-close']) $('#' + id).addEventListener('mousedown', e => e.preventDefault());
$('#win-min').addEventListener('click', () => nv.minimize());
$('#win-max').addEventListener('click', () => nv.toggleMaximize());
$('#win-close').addEventListener('click', () => nv.close());
nv.onMaximized(on => {
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
    nv.resizeStart(h.dataset.edge);
    const end = () => {
      h.removeEventListener('pointerup', end);
      h.removeEventListener('lostpointercapture', end);
      nv.resizeEnd();
    };
    h.addEventListener('pointerup', end);
    h.addEventListener('lostpointercapture', end);
  });
}
nv.onCloseRequest(async () => {
  const ok = await confirmBox({ title: 'Devam eden işlem', text: 'Kopyalama ya da taşıma sürüyor. Pencere kapanırsa işlem yarıda kalır. Yine de kapatılsın mı?', okLabel: 'İptal et ve kapat', danger: true });
  if (!ok) return;
  for (const j of jobs.values()) nv.cancelJob(j.id);
  nv.confirmClose();
});

/* ---------------- Değişiklik izleme, konum yenileme ---------------- */
nv.onChanged(dir => {
  for (const t of tabs) if (t.loc && !t.search && samePath(t.loc, dir)) refresh(t);
});
async function refreshPlaces() {
  await loadPlaces();
  renderSidebar();
  if (isPCView()) renderPC();
  renderStatus();
}
window.addEventListener('focus', refreshPlaces);
setInterval(() => { if (!document.hidden) refreshPlaces(); }, 30000);

/* ---------------- Oturum ---------------- */
let sessTimer = 0;
let started = false;
function saveSession() {
  if (IS_EXTRA || !started) return;
  clearTimeout(sessTimer);
  sessTimer = setTimeout(() => {
    nv.sessionSave({ active: tabs.indexOf(active), tabs: tabs.map(t => ({ loc: t.loc, history: t.history.slice(-20), hi: Math.min(t.hi, 19) })) });
  }, 400);
}

/* ---------------- Başlat ---------------- */
applyTheme();
await loadPlaces();
nv.watcherGet().then(w => { watcher = w; }).catch(() => {});
if (!IS_EXTRA) {
  const s = await nv.sessionLoad();
  if (s && Array.isArray(s.tabs) && s.tabs.length) {
    for (const st of s.tabs) {
      if (!st || !st.loc) continue;
      const t = newTabState();
      t.history = Array.isArray(st.history) && st.history.length ? st.history : [st.loc];
      t.hi = clamp(st.hi ?? t.history.length - 1, 0, t.history.length - 1);
      t.pendingLoc = st.loc;
      tabs.push(t);
    }
    if (tabs.length) {
      active = tabs[clamp(s.active | 0, 0, tabs.length - 1)];
      await Promise.all(tabs.map(t => navigate(t, t.pendingLoc, { push: false })));
    }
  }
}
if (!tabs.length) {
  active = newTabState();
  tabs.push(active);
  await navigate(active, 'pc', { push: true });
}
for (const t of tabs) if (!t.history.length) { t.history = [t.loc]; t.hi = 0; }
started = true;
for (const p of await nv.pendingPaths()) await openPathArg(p);
nv.onOpenPaths(async paths => { for (const p of paths) await openPathArg(p); });
renderAll();
nv.watch(currentDir() || '');
saveSession();
el.scroller.focus({ preventScroll: true });
document.fonts?.ready.then(() => renderVisible(true));

})();
