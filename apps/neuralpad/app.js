/* ============================================================
   NeuralPad — Not Defteri davranışı (Taş Tablet'in mantığı üzerine)
   ============================================================ */
'use strict';
(async () => {

const $ = (s, r = document) => r.querySelector(s);
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const readJSON = k => { try { return JSON.parse(localStorage.getItem(k)) || null; } catch { return null; } };
const newUid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/* Masaüstü kabuğu (Electron). Tarayıcıda açılırsa dosya işlemleri devre dışı kalır. */
const NOOP = () => {};
const NO_SHELL = { ok: false, error: 'Bu işlem yalnızca masaüstü uygulamasında çalışır.' };
const np = window.np || {
  minimize: NOOP, toggleMaximize: NOOP, close: () => window.close(), closeAck: NOOP, confirmClose: () => window.close(),
  onCloseRequest: NOOP, onMaximized: NOOP, onOpenFiles: NOOP, resizeStart: NOOP, resizeEnd: NOOP,
  newWindow: NOOP, paste: null, pendingFiles: async () => [], openDialog: async () => [], saveDialog: async () => null,
  readFile: async () => NO_SHELL, writeFile: async () => NO_SHELL,
  sessionLoad: async () => null, sessionSave: NOOP, pathForFile: () => '',
};
const IN_SHELL = !!window.np;

const root = document.documentElement;
const app = $('#app');
const editorsEl = $('#editors');
const backdrop = $('#backdrop');
const tabsEl = $('#tabs');
const menubar = $('#menubar');
const popupsEl = $('#popups');
const toastEl = $('#toast');
const bandTitle = $('#band-title');
const fb = {
  bar: $('#findbar'), find: $('#fb-find'), rep: $('#fb-replace'), repRow: $('#fb-replace-row'),
  toggle: $('#fb-toggle'), count: $('#fb-count'), opts: $('#fb-opts'), optsBox: $('#fb-optsbox'),
  matchCase: $('#fb-case'), wrap: $('#fb-wrap'),
};

const IS_EXTRA_WINDOW = new URLSearchParams(location.search).has('yeni');
const SETTINGS_KEY = 'neuralpad.settings';

// Dışarıdan gelen dosyalar (ikinci kez açılış) başlangıç bitene kadar sıraya alınır
const incoming = [];
let started = false;
np.onOpenFiles(paths => { if (started) openPaths(paths); else incoming.push(...paths); });

/* ---------------- Ayarlar ---------------- */
const FONTS = [
  { name: 'Chakra Petch', css: '"Chakra Petch", "Rajdhani", "Segoe UI", sans-serif' },
  { name: 'Rajdhani', css: '"Rajdhani", "Segoe UI", sans-serif' },
  { name: 'IBM Plex Mono', css: '"IBM Plex Mono", Consolas, monospace' },
  { name: 'JetBrains Mono', css: '"JetBrains Mono", Consolas, monospace' },
  { name: 'Space Mono', css: '"Space Mono", Consolas, monospace' },
  { name: 'Oxanium', css: '"Oxanium", "Segoe UI", sans-serif' },
  { name: 'Cascadia Mono', css: '"Cascadia Mono", Consolas, monospace' },
  { name: 'Consolas', css: 'Consolas, "Courier New", monospace' },
  { name: 'Segoe UI', css: '"Segoe UI", system-ui, sans-serif' },
];
const SIZES = [8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 26, 28, 32, 36, 48, 72];
const THEMES = [
  { id: 'neon', name: 'Neon' },
  { id: 'ice', name: 'Buz' },
  { id: 'alarm', name: 'Alarm' },
  { id: 'daylight', name: 'Gündüz' },
];
const DEFAULTS = {
  wordWrap: true, statusBar: true, zoom: 100,
  fontFamily: 'Chakra Petch', fontStyle: 'normal', fontWeight: 500, fontSize: 17,
  theme: 'neon', matchCase: false, wrapAround: true, lastDir: '', v: 2,
};
const S = Object.assign({}, DEFAULTS, readJSON(SETTINGS_KEY));
if (!THEMES.some(t => t.id === S.theme)) S.theme = DEFAULTS.theme;
// Sürüm 2: varsayılan yazı tipi hesap makinesinin ekran yazı tipine (Chakra Petch) geçti
if ((S.v || 1) < 2) {
  Object.assign(S, { fontFamily: DEFAULTS.fontFamily, fontStyle: DEFAULTS.fontStyle, fontWeight: DEFAULTS.fontWeight, fontSize: DEFAULTS.fontSize, v: 2 });
  saveSettings();
}

function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(S)); } catch { /* depolama kapalı olabilir */ }
}

function applySettings() {
  for (const t of THEMES) root.classList.toggle('theme-' + t.id, t.id === S.theme);
  app.classList.toggle('nowrap', !S.wordWrap);
  app.classList.toggle('no-status', !S.statusBar);
  const f = FONTS.find(f => f.name === S.fontFamily) || FONTS[0];
  const rs = root.style;
  rs.setProperty('--ed-font', f.css);
  rs.setProperty('--ed-size', S.fontSize + 'px');
  rs.setProperty('--ed-weight', S.fontWeight);
  rs.setProperty('--ed-style', S.fontStyle);
  rs.setProperty('--zoom', S.zoom / 100);
  for (const t of tabs) t.ta.wrap = S.wordWrap ? 'soft' : 'off';
  fb.matchCase.checked = S.matchCase;
  fb.wrap.checked = S.wrapAround;
  updateStatus();
  refreshBackdrop();
}

/* ---------------- Sekmeler ---------------- */
let tabs = [];
let active = null;

const displayName = t => t.name || 'Başlıksız';
const isDirty = t => t.ta.value !== t.savedText;
const samePath = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const baseName = p => p.split(/[\\/]/).pop();
const dirName = p => p.slice(0, Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/')));

function createTab({ name = null, path = null, text = '', savedText = text, eol = 'CRLF', enc = 'UTF-8' } = {}) {
  const ta = document.createElement('textarea');
  ta.className = 'ed-text';
  ta.spellcheck = false;
  ta.hidden = true;
  ta.wrap = S.wordWrap ? 'soft' : 'off';
  ta.setAttribute('autocomplete', 'off');
  ta.setAttribute('autocapitalize', 'off');
  ta.setAttribute('aria-label', 'Belge metni');
  ta.value = text;
  editorsEl.appendChild(ta);
  const tab = { uid: newUid(), name, path, savedText, eol, enc, ta };
  wireTextarea(tab);
  tabs.push(tab);
  return tab;
}

function wireTextarea(tab) {
  const ta = tab.ta;
  ta.addEventListener('input', () => onChange(tab));
  for (const ev of ['keyup', 'mouseup', 'select', 'focus']) ta.addEventListener(ev, updateStatus);
  ta.addEventListener('scroll', syncBackdropScroll);
  ta.addEventListener('keydown', e => {
    // Not Defteri gibi: Tab karakter ekler, odak değiştirmez
    if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault();
      insertText('\t');
    }
  });
  ta.addEventListener('contextmenu', e => {
    e.preventDefault();
    openContextMenu(e.clientX, e.clientY);
  });
}

function activate(tab) {
  if (!tab) return;
  for (const t of tabs) t.ta.hidden = t !== tab;
  active = tab;
  if (tab._restore) {
    const r = tab._restore;
    delete tab._restore;
    tab.ta.setSelectionRange(r.ss || 0, r.se || 0);
    tab.ta.scrollTop = r.st || 0;
  }
  tab.ta.focus({ preventScroll: true });
  renderTabs();
  updateTitle();
  updateStatus();
  refreshBackdrop();
  scheduleSession();
}

const CLOSE_ICON = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6"/></svg>';

function renderTabs() {
  tabsEl.textContent = '';
  for (const t of tabs) {
    const b = document.createElement('div');
    b.className = 'tab' + (isDirty(t) ? ' dirty' : '');
    b.setAttribute('role', 'tab');
    b.setAttribute('tabindex', t === active ? '0' : '-1');
    b.setAttribute('aria-selected', String(t === active));
    b.title = t.path || (t.name ? displayName(t) : 'Başlıksız (kaydedilmedi)');
    b.innerHTML = `<span class="tab-name">${esc(displayName(t))}</span><span class="tab-dot" aria-label="Kaydedilmemiş"></span><span class="tab-close" role="button" title="Sekmeyi kapat (Ctrl+W)" aria-label="Sekmeyi kapat">${CLOSE_ICON}</span>`;
    b.addEventListener('mousedown', e => { if (e.button === 1) e.preventDefault(); });
    b.addEventListener('click', e => {
      if (e.target.closest('.tab-close')) closeTab(t);
      else if (t !== active) activate(t);
      else t.ta.focus();
    });
    b.addEventListener('auxclick', e => { if (e.button === 1) closeTab(t); });
    b.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(t); }
    });
    t.tabEl = b;
    tabsEl.appendChild(b);
  }
  active?.tabEl?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function updateTabState(t) {
  t.tabEl?.classList.toggle('dirty', isDirty(t));
}

function updateTitle() {
  if (!active) return;
  const name = (isDirty(active) ? '*' : '') + displayName(active);
  document.title = name + ' - NeuralPad';
  bandTitle.textContent = name;
  bandTitle.title = active.path || '';
}

function onChange(tab) {
  updateTabState(tab);
  if (tab === active) {
    updateTitle();
    updateStatus();
    refreshBackdrop();
  }
  scheduleSession();
}

function newTab() {
  activate(createTab());
}

function nextTab(dir = 1) {
  if (tabs.length < 2) return;
  const i = tabs.indexOf(active);
  activate(tabs[(i + dir + tabs.length) % tabs.length]);
}

async function closeTab(tab = active) {
  if (!tab) return false;
  if (isDirty(tab)) {
    if (tab !== active) activate(tab);
    const r = await confirmSave(tab);
    if (r === 'cancel') return false;
    if (r === 'save' && !(await save(tab))) return false;
  }
  const i = tabs.indexOf(tab);
  tabs.splice(i, 1);
  tab.ta.remove();
  if (!tabs.length) activate(createTab());
  else if (active === tab) activate(tabs[Math.min(i, tabs.length - 1)]);
  else renderTabs();
  scheduleSession();
  return true;
}

function newWindow() {
  if (!IN_SHELL) { toast(NO_SHELL.error); return; }
  np.newWindow();
}

function closeWindow() {
  np.close();
}

/* ---------------- Kodlama ve satır sonu ---------------- */
let ansiMap = null; // Windows-1254 (Türkçe ANSI) için karakter → bayt
function getAnsiMap() {
  if (ansiMap) return ansiMap;
  ansiMap = new Map();
  const dec = new TextDecoder('windows-1254');
  for (let b = 0; b < 256; b++) {
    const ch = dec.decode(new Uint8Array([b]));
    if (!ansiMap.has(ch)) ansiMap.set(ch, b);
  }
  return ansiMap;
}

function decodeBytes(buf) {
  const b = new Uint8Array(buf);
  let enc = 'UTF-8';
  let text;
  if (b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) {
    enc = 'UTF-8 BOM'; text = new TextDecoder('utf-8').decode(b.subarray(3));
  } else if (b[0] === 0xFF && b[1] === 0xFE) {
    enc = 'UTF-16 LE'; text = new TextDecoder('utf-16le').decode(b.subarray(2));
  } else if (b[0] === 0xFE && b[1] === 0xFF) {
    enc = 'UTF-16 BE'; text = new TextDecoder('utf-16be').decode(b.subarray(2));
  } else {
    try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(b); }
    catch { enc = 'ANSI'; text = new TextDecoder('windows-1254').decode(b); }
  }
  let eol = 'CRLF';
  if (text.includes('\r\n')) eol = 'CRLF';
  else if (text.includes('\n')) eol = 'LF';
  else if (text.includes('\r')) eol = 'CR';
  return { text: text.replace(/\r\n?/g, '\n'), enc, eol };
}

function encodeText(text, eol, enc) {
  const t = eol === 'CRLF' ? text.replace(/\n/g, '\r\n') : eol === 'CR' ? text.replace(/\n/g, '\r') : text;
  if (enc === 'UTF-8') return new TextEncoder().encode(t);
  if (enc === 'UTF-8 BOM') {
    const body = new TextEncoder().encode(t);
    const out = new Uint8Array(body.length + 3);
    out.set([0xEF, 0xBB, 0xBF]);
    out.set(body, 3);
    return out;
  }
  if (enc === 'UTF-16 LE' || enc === 'UTF-16 BE') {
    const le = enc === 'UTF-16 LE';
    const out = new Uint8Array(2 + t.length * 2);
    const dv = new DataView(out.buffer);
    dv.setUint16(0, 0xFEFF, le);
    for (let i = 0; i < t.length; i++) dv.setUint16(2 + i * 2, t.charCodeAt(i), le);
    return out;
  }
  // ANSI
  const map = getAnsiMap();
  const out = new Uint8Array(t.length);
  for (let i = 0; i < t.length; i++) out[i] = map.get(t[i]) ?? 0x3F; // eşlenemeyen → '?'
  return out;
}

/* ---------------- Dosya işlemleri ---------------- */
function rememberDir(p) {
  const d = dirName(p);
  if (d && d !== S.lastDir) { S.lastDir = d; saveSettings(); }
}

async function openFile() {
  if (!IN_SHELL) { toast(NO_SHELL.error); return; }
  const paths = await np.openDialog(S.lastDir);
  await openPaths(paths || []);
}

async function openPaths(paths) {
  for (const p of paths) await openPath(p);
}

async function openPath(p) {
  const open = tabs.find(t => samePath(t.path, p));
  if (open) { activate(open); return; }
  const r = await np.readFile(p);
  if (!r || !r.ok) { toast(`"${baseName(p)}" açılamadı: ${r?.error || 'bilinmeyen hata'}`); return; }
  loadIntoTab(r.bytes, r.name, r.path);
  rememberDir(r.path);
}

function loadIntoTab(bytes, name, path) {
  const { text, enc, eol } = decodeBytes(bytes);
  let tab = active;
  const reusable = tab && !tab.path && !tab.name && tab.ta.value === '' && !isDirty(tab);
  if (!reusable) tab = createTab();
  tab.name = name;
  tab.path = path;
  tab.enc = enc;
  tab.eol = eol;
  tab.savedText = text;
  tab.ta.value = text;
  activate(tab);
  tab.ta.setSelectionRange(0, 0);
  tab.ta.scrollTop = 0;
  // Klasik .LOG özelliği: ilk satırı ".LOG" olan dosyaya açılışta zaman damgası eklenir
  if (/^\.LOG(\n|$)/.test(text)) {
    tab.ta.setSelectionRange(text.length, text.length);
    insertText((text.endsWith('\n') ? '' : '\n') + timestamp() + '\n');
    scrollToIndex(tab.ta.value.length);
  }
}

async function save(tab = active) {
  if (!tab) return false;
  if (!tab.path) return saveAs(tab);
  return writeTo(tab, tab.path);
}

async function saveAs(tab = active) {
  if (!tab) return false;
  if (!IN_SHELL) { toast(NO_SHELL.error); return false; }
  const name = tab.name || 'Başlıksız.txt';
  const suggested = tab.path || (S.lastDir ? S.lastDir + '\\' + name : name);
  const p = await np.saveDialog(suggested);
  if (!p) return false;
  return writeTo(tab, p);
}

async function writeTo(tab, p) {
  const text = tab.ta.value;
  const r = await np.writeFile(p, encodeText(text, tab.eol, tab.enc));
  if (!r || !r.ok) { toast(`Kaydedilemedi: ${r?.error || 'bilinmeyen hata'}`); return false; }
  tab.path = p;
  tab.name = baseName(p);
  tab.savedText = text;
  rememberDir(p);
  afterSave(tab);
  return true;
}

function afterSave(tab) {
  renderTabs();
  updateTitle();
  updateStatus();
  scheduleSession();
  toast(`Kaydedildi: ${displayName(tab)}`);
}

async function saveAll() {
  for (const t of [...tabs]) {
    if (!isDirty(t)) continue;
    if (t !== active) activate(t);
    if (!(await save(t))) break;
  }
}

function printDoc() {
  if (!active) return;
  $('#print-title').textContent = displayName(active);
  $('#print-text').textContent = active.ta.value;
  window.print();
}

// Sürükle-bırak ile dosya açma
window.addEventListener('dragover', e => {
  if ([...e.dataTransfer.types].includes('Files')) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }
}, true);
window.addEventListener('drop', async e => {
  if (![...e.dataTransfer.types].includes('Files')) return;
  e.preventDefault();
  e.stopPropagation();
  for (const f of [...e.dataTransfer.files]) {
    const p = np.pathForFile(f);
    if (p) await openPath(p);
    else loadIntoTab(await f.arrayBuffer(), f.name, null);
  }
}, true);

/* ---------------- Düzenle ---------------- */
function insertText(str, ta = active?.ta) {
  if (!ta) return;
  ta.focus();
  const ok = str === ''
    ? document.execCommand('delete')
    : document.execCommand('insertText', false, str);
  if (!ok) {
    ta.setRangeText(str, ta.selectionStart, ta.selectionEnd, 'end');
    ta.dispatchEvent(new Event('input'));
  }
}

const hasSelection = () => !!active && active.ta.selectionStart !== active.ta.selectionEnd;

function edit(cmd) {
  if (!active) return;
  active.ta.focus();
  document.execCommand(cmd);
}

async function paste() {
  if (!active) return;
  active.ta.focus();
  if (np.paste) { np.paste(); return; }
  try {
    const text = await navigator.clipboard.readText();
    insertText(text.replace(/\r\n?/g, '\n'));
  } catch {
    if (!document.execCommand('paste')) toast('Menüden yapıştırılamadı. Ctrl+V kullanın.');
  }
}

function deleteSel() {
  if (!active) return;
  active.ta.focus();
  document.execCommand(hasSelection() ? 'delete' : 'forwardDelete');
}

function selectAll() {
  if (!active) return;
  active.ta.focus();
  active.ta.select();
  updateStatus();
}

function timestamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())} ${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

function insertDate() {
  insertText(timestamp());
}

/* ---------------- Bul / Değiştir ---------------- */
const foldTr = s => {
  if (S.matchCase) return s;
  const low = s.toLocaleLowerCase('tr-TR');
  return low.length === s.length ? low : s.toLowerCase();
};

function setReplaceVisible(show) {
  fb.repRow.hidden = !show;
  fb.toggle.setAttribute('aria-expanded', String(show));
}

function openFind(withReplace) {
  if (!active) return;
  fb.bar.hidden = false;
  setReplaceVisible(withReplace);
  const ta = active.ta;
  const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
  if (sel && !sel.includes('\n')) fb.find.value = sel;
  fb.find.focus();
  fb.find.select();
  refreshBackdrop();
}

function closeFind() {
  fb.bar.hidden = true;
  fb.bar.classList.remove('notfound');
  fb.optsBox.hidden = true;
  fb.opts.setAttribute('aria-expanded', 'false');
  backdrop.textContent = '';
  active?.ta.focus();
}

function searchFrom(from, dir) {
  const q = fb.find.value;
  const ta = active.ta;
  const hay = foldTr(ta.value);
  const needle = foldTr(q);
  let i;
  if (dir > 0) {
    i = hay.indexOf(needle, from);
    if (i < 0 && S.wrapAround) i = hay.indexOf(needle);
  } else {
    const start = from - needle.length;
    i = start >= 0 ? hay.lastIndexOf(needle, start) : -1;
    if (i < 0 && S.wrapAround) i = hay.lastIndexOf(needle);
  }
  return i;
}

function selectMatch(i, len) {
  const ta = active.ta;
  ta.setSelectionRange(i, i + len);
  if (fb.bar.hidden || !fb.bar.contains(document.activeElement)) ta.focus({ preventScroll: true });
  scrollToIndex(i);
  updateStatus();
  refreshBackdrop();
}

function notFound(q) {
  fb.bar.classList.add('notfound');
  toast(`"${q}" bulunamadı.`);
}

function findNext(dir = 1) {
  if (!active) return false;
  const q = fb.find.value;
  if (!q) { openFind(!fb.repRow.hidden); return false; }
  const ta = active.ta;
  const i = searchFrom(dir > 0 ? ta.selectionEnd : ta.selectionStart, dir);
  if (i < 0) { notFound(q); return false; }
  fb.bar.classList.remove('notfound');
  selectMatch(i, q.length);
  return true;
}

function findIncremental() {
  fb.bar.classList.remove('notfound');
  const q = fb.find.value;
  if (!q) { refreshBackdrop(); return; }
  const i = searchFrom(active.ta.selectionStart, 1);
  if (i < 0) { fb.bar.classList.add('notfound'); refreshBackdrop(); return; }
  selectMatch(i, q.length);
}

function replaceOne() {
  if (!active) return;
  const q = fb.find.value;
  if (!q) return;
  const ta = active.ta;
  const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
  if (sel.length === q.length && foldTr(sel) === foldTr(q)) {
    const back = document.activeElement;
    insertText(fb.rep.value);
    back?.focus();
  }
  findNext(1);
}

function replaceAll() {
  if (!active) return;
  const q = fb.find.value;
  if (!q) return;
  const ta = active.ta;
  const v = ta.value;
  const hay = foldTr(v);
  const needle = foldTr(q);
  const r = fb.rep.value;
  let out = '', last = 0, n = 0, i;
  while ((i = hay.indexOf(needle, last)) !== -1) {
    out += v.slice(last, i) + r;
    last = i + q.length;
    n++;
  }
  if (!n) { notFound(q); return; }
  out += v.slice(last);
  const caret = Math.min(ta.selectionStart, out.length);
  const top = ta.scrollTop;
  const back = document.activeElement;
  ta.focus();
  ta.select();
  insertText(out); // tek adımda geri alınabilir
  ta.setSelectionRange(caret, caret);
  ta.scrollTop = top;
  back?.focus();
  toast(`${n.toLocaleString('tr-TR')} yer değiştirildi.`);
}

fb.find.addEventListener('input', findIncremental);
fb.find.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); findNext(e.shiftKey ? -1 : 1); }
});
fb.rep.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); (e.ctrlKey && e.altKey) ? replaceAll() : replaceOne(); }
});
$('#fb-next').addEventListener('click', () => findNext(1));
$('#fb-prev').addEventListener('click', () => findNext(-1));
$('#fb-close').addEventListener('click', closeFind);
$('#fb-rep').addEventListener('click', replaceOne);
$('#fb-repall').addEventListener('click', replaceAll);
fb.toggle.addEventListener('click', () => {
  setReplaceVisible(fb.repRow.hidden);
  (fb.repRow.hidden ? fb.find : fb.rep).focus();
});
fb.opts.addEventListener('click', () => {
  fb.optsBox.hidden = !fb.optsBox.hidden;
  fb.opts.setAttribute('aria-expanded', String(!fb.optsBox.hidden));
});
fb.matchCase.addEventListener('change', () => { S.matchCase = fb.matchCase.checked; saveSettings(); refreshBackdrop(); });
fb.wrap.addEventListener('change', () => { S.wrapAround = fb.wrap.checked; saveSettings(); });
fb.bar.addEventListener('keydown', e => {
  if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
});

/* Ayna katmanı: eşleşmeleri vurgular, imleç konumunu ölçer */
let bdQueued = false;
function refreshBackdrop() {
  if (bdQueued) return;
  bdQueued = true;
  requestAnimationFrame(() => { bdQueued = false; renderBackdrop(); });
}

function renderBackdrop() {
  const q = fb.find.value;
  if (!active || fb.bar.hidden || !q) {
    if (backdrop.firstChild) backdrop.textContent = '';
    fb.count.textContent = '';
    return;
  }
  const ta = active.ta;
  const v = ta.value;
  const hay = foldTr(v);
  const needle = foldTr(q);
  const ss = ta.selectionStart, se = ta.selectionEnd;
  let html = '', last = 0, n = 0, cur = -1, i;
  while ((i = hay.indexOf(needle, last)) !== -1 && n < 5000) {
    const isCur = i === ss && i + q.length === se;
    if (isCur) cur = n;
    html += esc(v.slice(last, i)) + `<mark${isCur ? ' class="cur"' : ''}>${esc(v.slice(i, i + q.length))}</mark>`;
    last = i + q.length;
    n++;
  }
  backdrop.innerHTML = html + esc(v.slice(last)) + '\n';
  syncBackdropScroll();
  fb.count.textContent = n ? (cur >= 0 ? `${cur + 1} / ${n}${n >= 5000 ? '+' : ''}` : `${n}${n >= 5000 ? '+' : ''} sonuç`) : 'Sonuç yok';
}

function syncBackdropScroll() {
  if (!active || !backdrop.firstChild) return;
  backdrop.scrollTop = active.ta.scrollTop;
  backdrop.scrollLeft = active.ta.scrollLeft;
}

function scrollToIndex(idx) {
  if (!active) return;
  const ta = active.ta;
  const v = ta.value;
  backdrop.innerHTML = esc(v.slice(0, idx)) + '<span id="bd-probe"></span>' + esc(v.slice(idx)) + '\n';
  const probe = $('#bd-probe', backdrop);
  const top = probe.offsetTop;
  const left = probe.offsetLeft;
  const lh = parseFloat(getComputedStyle(ta).lineHeight) || 24;
  if (top < ta.scrollTop || top + lh > ta.scrollTop + ta.clientHeight) {
    ta.scrollTop = Math.max(0, top - ta.clientHeight / 3);
  }
  if (!S.wordWrap && (left < ta.scrollLeft || left > ta.scrollLeft + ta.clientWidth - 60)) {
    ta.scrollLeft = Math.max(0, left - ta.clientWidth / 2);
  }
  backdrop.textContent = '';
  renderBackdrop();
}

/* ---------------- Git ---------------- */
function lineOf(v, pos) {
  let n = 1, i = -1;
  while ((i = v.indexOf('\n', i + 1)) !== -1 && i < pos) n++;
  return n;
}

async function openGoto() {
  if (!active) return;
  const ta = active.ta;
  const v = ta.value;
  const total = lineOf(v, v.length);
  const dlg = $('#dlg-goto');
  const input = $('#goto-line');
  input.max = total;
  input.value = lineOf(v, ta.selectionStart);
  $('#goto-hint').textContent = `Bu belgede ${total.toLocaleString('tr-TR')} satır var.`;
  const p = ask(dlg);
  input.select();
  if ((await p) !== 'ok') { ta.focus(); return; }
  const line = clamp(parseInt(input.value, 10) || 1, 1, total);
  let idx = 0;
  for (let l = 1; l < line; l++) idx = v.indexOf('\n', idx) + 1;
  ta.focus();
  ta.setSelectionRange(idx, idx);
  scrollToIndex(idx);
  updateStatus();
}

/* ---------------- Biçim / Görünüm ---------------- */
function toggleWrap() {
  S.wordWrap = !S.wordWrap;
  saveSettings();
  applySettings();
  if (active) scrollToIndex(active.ta.selectionStart);
}

function toggleStatus() {
  S.statusBar = !S.statusBar;
  saveSettings();
  applySettings();
}

function setZoom(z) {
  S.zoom = clamp(Math.round(z / 10) * 10, 10, 500);
  saveSettings();
  applySettings();
}
const zoomBy = d => setZoom(S.zoom + d);

function setTheme(id) {
  S.theme = id;
  saveSettings();
  applySettings();
}

async function openFont() {
  const dlg = $('#dlg-font');
  const famSel = $('#font-family');
  const styleSel = $('#font-style');
  const sizeSel = $('#font-size');
  const prev = $('#font-preview');
  famSel.innerHTML = FONTS.map(f => `<option value="${esc(f.name)}" style="font-family:${esc(f.css)}">${esc(f.name)}</option>`).join('');
  const sizes = [...new Set([...SIZES, S.fontSize])].sort((a, b) => a - b);
  sizeSel.innerHTML = sizes.map(s => `<option value="${s}">${s}</option>`).join('');
  famSel.value = S.fontFamily;
  styleSel.value = `${S.fontStyle}|${S.fontWeight}`;
  if (!styleSel.value) styleSel.value = 'normal|500';
  sizeSel.value = String(S.fontSize);
  const update = () => {
    const f = FONTS.find(f => f.name === famSel.value) || FONTS[0];
    const [st, w] = styleSel.value.split('|');
    prev.style.fontFamily = f.css;
    prev.style.fontStyle = st;
    prev.style.fontWeight = w;
    prev.style.fontSize = Math.min(+sizeSel.value, 48) + 'px';
  };
  famSel.onchange = styleSel.onchange = sizeSel.onchange = update;
  update();
  const p = ask(dlg);
  famSel.focus();
  if ((await p) === 'ok') {
    const [st, w] = styleSel.value.split('|');
    S.fontFamily = famSel.value;
    S.fontStyle = st;
    S.fontWeight = +w;
    S.fontSize = +sizeSel.value;
    saveSettings();
    applySettings();
  }
  active?.ta.focus();
}

/* ---------------- Durum çubuğu ---------------- */
const EOL_NAMES = { CRLF: 'Windows (CRLF)', LF: 'Unix (LF)', CR: 'Macintosh (CR)' };
let stQueued = false;
function updateStatus() {
  if (stQueued) return;
  stQueued = true;
  requestAnimationFrame(() => {
    stQueued = false;
    if (!active) return;
    const ta = active.ta;
    const v = ta.value;
    const caret = ta.selectionDirection === 'backward' ? ta.selectionStart : ta.selectionEnd;
    const line = lineOf(v, caret);
    const col = caret - (v.lastIndexOf('\n', caret - 1) + 1) + 1;
    const sel = ta.selectionEnd - ta.selectionStart;
    const fmt = n => n.toLocaleString('tr-TR');
    $('#st-pos').textContent = `Sat ${fmt(line)}, Süt ${fmt(col)}`;
    $('#st-chars').textContent = sel ? `${fmt(sel)} / ${fmt(v.length)} karakter` : `${fmt(v.length)} karakter`;
    $('#st-zoom').textContent = `%${S.zoom}`;
    $('#st-eol').textContent = EOL_NAMES[active.eol] || active.eol;
    $('#st-enc').textContent = active.enc;
  });
}
document.addEventListener('selectionchange', () => {
  if (active && document.activeElement === active.ta) updateStatus();
});

/* ---------------- Diyaloglar ---------------- */
function ask(dlg) {
  return new Promise(res => {
    closeMenus(false);
    dlg.returnValue = '';
    dlg.showModal();
    dlg.addEventListener('close', () => res(dlg.returnValue || 'cancel'), { once: true });
  });
}

async function confirmSave(tab) {
  $('#confirm-text').textContent = `"${displayName(tab)}" belgesindeki değişiklikler kaydedilsin mi?`;
  return ask($('#dlg-confirm'));
}

function openAbout() {
  ask($('#dlg-about')).then(() => active?.ta.focus());
}

const SHORTCUT_DOC = [
  ['Yeni sekme', 'Ctrl+N'],
  ['Yeni pencere', 'Ctrl+Shift+N'],
  ['Aç', 'Ctrl+O'],
  ['Kaydet', 'Ctrl+S'],
  ['Farklı kaydet', 'Ctrl+Shift+S'],
  ['Tümünü kaydet', 'Ctrl+Alt+S'],
  ['Yazdır', 'Ctrl+P'],
  ['Sekmeyi kapat', 'Ctrl+W'],
  ['Pencereyi kapat', 'Ctrl+Shift+W / Alt+F4'],
  ['Sonraki / önceki sekme', 'Ctrl+Tab / Ctrl+Shift+Tab'],
  ['Geri al / Yinele', 'Ctrl+Z / Ctrl+Y'],
  ['Kes / Kopyala / Yapıştır', 'Ctrl+X / Ctrl+C / Ctrl+V'],
  ['Bul', 'Ctrl+F'],
  ['Sonrakini / öncekini bul', 'F3 / Shift+F3'],
  ['Değiştir', 'Ctrl+H'],
  ['Tümünü değiştir (Değiştir kutusunda)', 'Ctrl+Alt+Enter'],
  ['Git', 'Ctrl+G'],
  ['Tümünü seç', 'Ctrl+A'],
  ['Saat/Tarih', 'F5'],
  ['Yakınlaştır / Uzaklaştır', 'Ctrl+Artı / Ctrl+Eksi / Ctrl+Tekerlek'],
  ['Varsayılan yakınlaştırma', 'Ctrl+0'],
  ['Menüye geç', 'F10 / Alt'],
];

function openShortcuts() {
  $('#keys-list').innerHTML = SHORTCUT_DOC.map(([a, k]) => `<span>${esc(a)}</span><span class="kk">${esc(k)}</span>`).join('');
  ask($('#dlg-keys')).then(() => active?.ta.focus());
}

/* ---------------- Menüler ---------------- */
const MENUS = [
  { label: 'Dosya', items: [
    { label: 'Yeni sekme', key: 'Ctrl+N', run: newTab },
    { label: 'Yeni pencere', key: 'Ctrl+Shift+N', run: newWindow },
    { label: 'Aç...', key: 'Ctrl+O', run: openFile },
    { label: 'Kaydet', key: 'Ctrl+S', run: () => save() },
    { label: 'Farklı kaydet...', key: 'Ctrl+Shift+S', run: () => saveAs() },
    { label: 'Tümünü kaydet', key: 'Ctrl+Alt+S', run: saveAll },
    '-',
    { label: 'Yazdır...', key: 'Ctrl+P', run: printDoc },
    '-',
    { label: 'Sekmeyi kapat', key: 'Ctrl+W', run: () => closeTab() },
    { label: 'Pencereyi kapat', key: 'Ctrl+Shift+W', run: closeWindow },
    { label: 'Çıkış', run: closeWindow },
  ] },
  { label: 'Düzenle', items: [
    { label: 'Geri al', key: 'Ctrl+Z', run: () => edit('undo') },
    { label: 'Yinele', key: 'Ctrl+Y', run: () => edit('redo') },
    '-',
    { label: 'Kes', key: 'Ctrl+X', run: () => edit('cut'), enabled: hasSelection },
    { label: 'Kopyala', key: 'Ctrl+C', run: () => edit('copy'), enabled: hasSelection },
    { label: 'Yapıştır', key: 'Ctrl+V', run: paste },
    { label: 'Sil', key: 'Del', run: deleteSel },
    '-',
    { label: 'Bul', key: 'Ctrl+F', run: () => openFind(false) },
    { label: 'Sonrakini bul', key: 'F3', run: () => findNext(1) },
    { label: 'Öncekini bul', key: 'Shift+F3', run: () => findNext(-1) },
    { label: 'Değiştir', key: 'Ctrl+H', run: () => openFind(true) },
    { label: 'Git', key: 'Ctrl+G', run: openGoto },
    '-',
    { label: 'Tümünü seç', key: 'Ctrl+A', run: selectAll },
    { label: 'Saat/Tarih', key: 'F5', run: insertDate },
  ] },
  { label: 'Biçim', items: [
    { label: 'Sözcük kaydırma', check: () => S.wordWrap, run: toggleWrap },
    { label: 'Yazı tipi...', run: openFont },
  ] },
  { label: 'Görünüm', items: [
    { label: 'Yakınlaştır', sub: [
      { label: 'Yakınlaştır', key: 'Ctrl+Artı', run: () => zoomBy(10) },
      { label: 'Uzaklaştır', key: 'Ctrl+Eksi', run: () => zoomBy(-10) },
      { label: 'Varsayılan yakınlaştırmaya geri yükle', key: 'Ctrl+0', run: () => setZoom(100) },
    ] },
    { label: 'Durum çubuğu', check: () => S.statusBar, run: toggleStatus },
    '-',
    { label: 'Tema', sub: THEMES.map(t => ({ label: t.name, radio: () => S.theme === t.id, run: () => setTheme(t.id) })) },
  ] },
  { label: 'Yardım', items: [
    { label: 'Klavye kısayolları', run: openShortcuts },
    { label: 'NeuralPad hakkında', run: openAbout },
  ] },
];

const CONTEXT_ITEMS = [
  { label: 'Geri al', key: 'Ctrl+Z', run: () => edit('undo') },
  '-',
  { label: 'Kes', key: 'Ctrl+X', run: () => edit('cut'), enabled: hasSelection },
  { label: 'Kopyala', key: 'Ctrl+C', run: () => edit('copy'), enabled: hasSelection },
  { label: 'Yapıştır', key: 'Ctrl+V', run: paste },
  { label: 'Sil', key: 'Del', run: deleteSel, enabled: hasSelection },
  '-',
  { label: 'Tümünü seç', key: 'Ctrl+A', run: selectAll },
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
    const j = (i + (e.key === 'ArrowRight' ? 1 : -1) + n) % n;
    if (menuState) openTopMenu(j, true);
    else menubar.children[j].focus();
  } else if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    openTopMenu(i, true);
  } else if (e.key === 'Escape') {
    e.preventDefault();
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
  const pop = renderPopup(CONTEXT_ITEMS, x, y, 0);
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
    b.addEventListener('mousedown', e => e.preventDefault()); // düzenleyici seçimini koru
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
  const vw = innerWidth, vh = innerHeight;
  let left = x;
  if (left + w > vw - 8) left = altX !== undefined ? altX - w : vw - w - 8;
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
    default:
      if (e.key.length === 1 && !e.ctrlKey && !e.altKey) {
        const ch = e.key.toLocaleLowerCase('tr-TR');
        const start = cur + 1;
        for (let k = 0; k < items.length; k++) {
          const b = items[(start + k) % items.length];
          if (b._item.label.toLocaleLowerCase('tr-TR').startsWith(ch)) { handled(); b.focus(); break; }
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
  if (restoreFocus) active?.ta.focus();
}

document.addEventListener('mousedown', e => {
  if (!menuState) return;
  if (e.target.closest('.popup') || e.target.closest('#menubar')) return;
  closeMenus(false);
}, true);
window.addEventListener('blur', () => closeMenus(false));
window.addEventListener('resize', () => { closeMenus(false); refreshBackdrop(); });

/* ---------------- Klavye kısayolları ---------------- */
const SHORTCUTS = {
  'Ctrl+N': newTab, 'Ctrl+Alt+N': newTab,
  'Ctrl+Shift+N': newWindow,
  'Ctrl+O': openFile,
  'Ctrl+S': () => save(),
  'Ctrl+Shift+S': () => saveAs(),
  'Ctrl+Alt+S': saveAll,
  'Ctrl+P': printDoc,
  'Ctrl+W': () => closeTab(), 'Ctrl+Alt+W': () => closeTab(),
  'Ctrl+Shift+W': closeWindow,
  'Ctrl+Tab': () => nextTab(1), 'Ctrl+Shift+Tab': () => nextTab(-1),
  'Ctrl+Alt+PageDown': () => nextTab(1), 'Ctrl+Alt+PageUp': () => nextTab(-1),
  'Ctrl+F': () => openFind(false),
  'Ctrl+H': () => openFind(true),
  'Ctrl+G': openGoto,
  'F3': () => findNext(1), 'Shift+F3': () => findNext(-1),
  'F5': insertDate,
  'F10': focusMenubar,
};

let altAlone = false;
window.addEventListener('keydown', e => {
  altAlone = e.key === 'Alt' && !e.ctrlKey && !e.shiftKey;
  if (document.querySelector('dialog[open]')) return;
  const ctrl = e.ctrlKey || e.metaKey;

  if (ctrl && !e.altKey) {
    if (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd') { e.preventDefault(); zoomBy(10); return; }
    if (e.key === '-' || e.code === 'NumpadSubtract') { e.preventDefault(); zoomBy(-10); return; }
    if (e.key === '0' || e.code === 'Numpad0') { e.preventDefault(); setZoom(100); return; }
  }

  // Harfler fiziksel tuşa göre (AltGr / Türkçe klavyede de çalışsın)
  const key = /^Key[A-Z]$/.test(e.code) ? e.code.slice(3) : e.key;
  const id = (ctrl ? 'Ctrl+' : '') + (e.altKey ? 'Alt+' : '') + (e.shiftKey ? 'Shift+' : '') + key;
  const fn = SHORTCUTS[id];
  if (fn) {
    e.preventDefault();
    e.stopPropagation();
    closeMenus(false);
    fn();
  }
}, true);

window.addEventListener('keyup', e => {
  if (e.key === 'Alt' && altAlone) {
    altAlone = false;
    e.preventDefault();
    if (menuState || menubar.contains(document.activeElement)) closeMenus(true);
    else focusMenubar();
  }
});

editorsEl.addEventListener('wheel', e => {
  if (e.ctrlKey) {
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 10 : -10);
  }
}, { passive: false });

$('#tab-new').addEventListener('click', newTab);
tabsEl.addEventListener('wheel', e => {
  if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { tabsEl.scrollLeft += e.deltaY; e.preventDefault(); }
}, { passive: false });

/* ---------------- Pencere: tuşlar, boyutlandırma, kapatma ---------------- */
for (const id of ['win-min', 'win-max', 'win-close']) {
  $('#' + id).addEventListener('mousedown', e => e.preventDefault()); // düzenleyici odağını koru
}
$('#win-min').addEventListener('click', () => np.minimize());
$('#win-max').addEventListener('click', () => np.toggleMaximize());
$('#win-close').addEventListener('click', closeWindow);
np.onMaximized(on => {
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
    np.resizeStart(h.dataset.edge);
    const end = () => {
      h.removeEventListener('pointerup', end);
      h.removeEventListener('lostpointercapture', end);
      np.resizeEnd();
    };
    h.addEventListener('pointerup', end);
    h.addEventListener('lostpointercapture', end);
  });
}

// Ana pencere kapanırken oturumu saklar; ek pencerelerde kaydedilmemiş belgeler için sorar
let closing = false;
np.onCloseRequest(async () => {
  np.closeAck();
  if (closing) return;
  closing = true;
  try {
    closeMenus(false);
    if (!IS_EXTRA_WINDOW) {
      saveSessionNow();
      np.confirmClose();
      return;
    }
    for (const t of [...tabs]) {
      if (!isDirty(t)) continue;
      activate(t);
      const r = await confirmSave(t);
      if (r === 'cancel') return;
      if (r === 'save' && !(await save(t))) return;
    }
    np.confirmClose();
  } finally {
    closing = false;
  }
});

/* ---------------- Oturum (sekmeleri hatırlama) ---------------- */
let sessTimer = null;
function scheduleSession() {
  if (IS_EXTRA_WINDOW || !started) return;
  clearTimeout(sessTimer);
  sessTimer = setTimeout(saveSessionNow, 500);
}

// Kaydedilmiş ve değişmemiş dosyaların metni saklanmaz; açılışta diskten yeniden okunur.
function saveSessionNow() {
  if (IS_EXTRA_WINDOW || !started) return;
  clearTimeout(sessTimer);
  np.sessionSave({
    active: tabs.indexOf(active),
    tabs: tabs.map(t => {
      const dirty = isDirty(t);
      return {
        uid: t.uid, name: t.name, path: t.path,
        text: t.path && !dirty ? null : t.ta.value,
        saved: dirty ? t.savedText : null,
        eol: t.eol, enc: t.enc,
        ss: t.ta.selectionStart, se: t.ta.selectionEnd, st: t.ta.scrollTop,
      };
    }),
  });
}

async function restoreSession() {
  const d = await np.sessionLoad();
  if (!d || !Array.isArray(d.tabs) || !d.tabs.length) return false;
  const missing = [];
  let toActivate = null;
  for (const [i, s] of d.tabs.entries()) {
    let text = typeof s.text === 'string' ? s.text : null;
    let saved = typeof s.saved === 'string' ? s.saved : null;
    let eol = s.eol || 'CRLF';
    let enc = s.enc || 'UTF-8';
    if (s.path && text === null) {
      const r = await np.readFile(s.path);
      if (!r || !r.ok) { missing.push(s.name || baseName(s.path)); continue; }
      ({ text, eol, enc } = decodeBytes(r.bytes));
      saved = null;
    }
    const t = createTab({ name: s.name || null, path: s.path || null, text: text || '', savedText: saved ?? (text || ''), eol, enc });
    if (s.uid) t.uid = s.uid;
    t._restore = s;
    if (i === d.active) toActivate = t;
  }
  if (missing.length) toast(`Bulunamadığı için açılmadı: ${missing.join(', ')}`);
  if (!tabs.length) return false;
  activate(toActivate || tabs[0]);
  return true;
}

window.addEventListener('beforeunload', () => saveSessionNow());
document.addEventListener('visibilitychange', () => { if (document.hidden) saveSessionNow(); });

/* ---------------- Bildirim ---------------- */
let toastTimer = null;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2800);
}

/* ---------------- Başlat ---------------- */
buildMenubar();
applySettings();
if (IS_EXTRA_WINDOW || !(await restoreSession())) activate(createTab());
started = true;
await openPaths([...(await np.pendingFiles()), ...incoming.splice(0)]);
scheduleSession();
document.fonts?.ready.then(refreshBackdrop);

})();
