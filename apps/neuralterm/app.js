/* ============================================================
   NeuralTerm — terminal behavior
   ============================================================ */
'use strict';
(async () => {

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const readJSON = k => { try { return JSON.parse(localStorage.getItem(k)) || null; } catch { return null; } };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const nt = window.nt;
const root = document.documentElement;
const el = { tabs: $('#tabs'), terms: $('#terms'), title: $('#band-title'), popups: $('#popups'), toast: $('#toast'), shell: $('#st-shell'), size: $('#st-size'), font: $('#st-font') };

/* ---------------- Settings ---------------- */
const SETTINGS_KEY = 'neuralterm.settings';
const THEMES = [{ id: 'neon', name: 'Neon' }, { id: 'ice', name: 'Buz' }, { id: 'alarm', name: 'Alarm' }, { id: 'daylight', name: 'Gündüz' }];
const S = Object.assign({ theme: 'neon', syncTheme: true, fontSize: 15, shell: 'powershell' }, readJSON(SETTINGS_KEY));
const saveSettings = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(S)); } catch { /* storage unavailable */ } };

// ANSI colors: the Neural series palette; the daylight theme uses dark tones for its light ground.
const DARK = {
  black: '#0c0d15', red: '#ff2a4f', green: '#3dff9a', yellow: '#fcee0a', blue: '#3d8bff', magenta: '#ff4fd8', cyan: '#00f0ff', white: '#c8c6b8',
  brightBlack: '#5b6178', brightRed: '#ff6b84', brightGreen: '#7dffba', brightYellow: '#fff66b', brightBlue: '#7aaeff', brightMagenta: '#ff8ae5', brightCyan: '#7af8ff', brightWhite: '#ffffff',
};
const LIGHT = {
  black: '#141414', red: '#c4102f', green: '#0a7a40', yellow: '#7a6a00', blue: '#1450c8', magenta: '#a0107f', cyan: '#007f8c', white: '#5f5a24',
  brightBlack: '#6b6640', brightRed: '#e0203f', brightGreen: '#0f9a52', brightYellow: '#8c7a00', brightBlue: '#2a66e0', brightMagenta: '#c020a0', brightCyan: '#00909e', brightWhite: '#141414',
};
const ACCENTS = {
  neon: { foreground: '#ebe8d8', cursor: '#fcee0a', selectionBackground: 'rgba(0, 240, 255, 0.28)' },
  ice: { foreground: '#e4f4ff', cursor: '#00f0ff', selectionBackground: 'rgba(255, 79, 216, 0.28)' },
  alarm: { foreground: '#f2e7e3', cursor: '#fcee0a', selectionBackground: 'rgba(252, 238, 10, 0.25)' },
  daylight: { foreground: '#141414', cursor: '#ff2a4f', selectionBackground: 'rgba(0, 127, 140, 0.3)' },
};
const termTheme = () => ({ background: '#00000000', cursorAccent: '#05070c', ...(S.theme === 'daylight' ? LIGHT : DARK), ...ACCENTS[S.theme] });
function applyTheme() {
  for (const t of THEMES) root.classList.toggle('theme-' + t.id, t.id === S.theme);
  for (const t of tabs) t.term.options.theme = termTheme();
}
function setTheme(id) { S.theme = id; saveSettings(); applyTheme(); nt.themeSet(id); }
// The series theme: another Neural program (or another NeuralTerm window) changed it, or the setting changed there.
nt.onThemeApply(id => {
  if (!THEMES.some(t => t.id === id) || id === S.theme) return;
  S.theme = id;
  saveSettings();
  applyTheme();
});
nt.onThemeSyncState(on => { S.syncTheme = !!on; saveSettings(); });
function toggleThemeSync() { S.syncTheme = !S.syncTheme; saveSettings(); nt.themeSync(S.syncTheme, S.theme); }

/* ---------------- Tabs ---------------- */
let info = { shells: [], home: '' };
let tabs = [];
let active = null;
const shellName = id => (info.shells.find(s => s.id === id) || {}).name || id;

function newTab(shellId = S.shell, cwd = '') {
  if (!info.shells.some(s => s.id === shellId)) shellId = info.shells[0]?.id || 'cmd';
  const id = uid();
  const box = document.createElement('div');
  box.className = 'term';
  el.terms.appendChild(box);
  const term = new Terminal({
    allowTransparency: true,
    cursorBlink: true,
    cursorStyle: 'bar',
    fontFamily: '"Cascadia Mono", "Cascadia Code", Consolas, "Courier New", monospace',
    fontSize: S.fontSize,
    lineHeight: 1.15,
    scrollback: 10000,
    theme: termTheme(),
    windowsPty: { backend: 'conpty' },
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(box);
  const tab = { id, shellId, cwd, term, fit, box, title: '', dead: false, cols: 0, rows: 0 };
  tabs.push(tab);
  term.onData(d => {
    if (tab.dead) { if (d === '\r') restart(tab); return; }
    nt.input(id, d);
  });
  term.onResize(({ cols, rows }) => { tab.cols = cols; tab.rows = rows; if (!tab.dead) nt.resize(id, cols, rows); if (tab === active) renderStatus(); });
  term.onTitleChange(t => { tab.title = t; renderTabs(); if (tab === active) renderTitle(); });
  term.attachCustomKeyEventHandler(e => keyHandler(e, tab));
  box.addEventListener('contextmenu', e => { e.preventDefault(); rightClick(tab); });
  activate(tab);
  fit.fit();
  tab.cols = term.cols;
  tab.rows = term.rows;
  nt.spawn(id, shellId, cwd || info.home, term.cols, term.rows);
  return tab;
}

function restart(tab) {
  tab.dead = false;
  tab.title = '';
  tab.term.reset();
  tab.fit.fit();
  nt.spawn(tab.id, tab.shellId, tab.cwd || info.home, tab.term.cols, tab.term.rows);
  renderTabs();
}

function activate(tab) {
  active = tab;
  for (const t of tabs) t.box.hidden = t !== tab;
  renderTabs();
  renderTitle();
  requestAnimationFrame(() => { tab.fit.fit(); tab.term.focus(); renderStatus(); });
}

async function closeTab(tab = active) {
  if (!tab) return;
  nt.kill(tab.id);
  tab.term.dispose();
  tab.box.remove();
  const i = tabs.indexOf(tab);
  tabs.splice(i, 1);
  if (!tabs.length) { nt.confirmClose(); return; }
  if (tab === active) activate(tabs[Math.min(i, tabs.length - 1)]);
  else renderTabs();
}

function cycle(dir) {
  if (tabs.length < 2) return;
  activate(tabs[(tabs.indexOf(active) + dir + tabs.length) % tabs.length]);
}

const tabLabel = t => {
  if (t.title && !/\\(cmd|powershell|pwsh|bash|wsl)\.exe$/i.test(t.title)) return t.title.replace(/^Yönetici: /, '');
  return shellName(t.shellId);
};
function renderTabs() {
  el.tabs.textContent = '';
  for (const t of tabs) {
    const b = document.createElement('div');
    b.className = 'tab' + (t.dead ? ' dead' : '');
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(t === active));
    b.title = `${shellName(t.shellId)}${t.cwd ? ' · ' + t.cwd : ''}`;
    b.innerHTML = `<span class="tab-mark">&gt;_</span><span class="tab-name">${esc(tabLabel(t))}</span><span class="tab-close" role="button" title="Sekmeyi kapat (Ctrl+Shift+W)" aria-label="Sekmeyi kapat"><svg viewBox="0 0 12 12"><path d="M3 3l6 6M9 3l-6 6"/></svg></span>`;
    b.addEventListener('mousedown', e => { if (e.button === 1) e.preventDefault(); });
    b.addEventListener('click', e => { if (e.target.closest('.tab-close')) closeTab(t); else activate(t); });
    b.addEventListener('auxclick', e => { if (e.button === 1) closeTab(t); });
    el.tabs.appendChild(b);
  }
}
function renderTitle() {
  const t = active ? tabLabel(active) : 'NeuralTerm';
  el.title.textContent = t;
  document.title = `${t} - NeuralTerm`;
}
function renderStatus() {
  if (!active) return;
  el.shell.textContent = shellName(active.shellId) + (active.dead ? ' · sonlandı' : '');
  el.size.textContent = `${active.term.cols}×${active.term.rows}`;
  el.font.textContent = `${S.fontSize} pt`;
}

/* ---------------- Shell events ---------------- */
const byId = id => tabs.find(t => t.id === id);
nt.onStarted(({ id, cwd }) => { const t = byId(id); if (t) { t.cwd = cwd; renderTabs(); } });
nt.onData(({ id, data }) => { const t = byId(id); if (t) t.term.write(data); });
nt.onExit(({ id, code, error }) => {
  const t = byId(id);
  if (!t) return;
  // A clean exit closes the tab, like Windows Terminal; otherwise the tab stays with a note.
  if (code === 0 && !error) { closeTab(t); return; }
  t.dead = true;
  const why = error ? ` · ${error}` : '';
  t.term.write(`\r\n\x1b[90m[İşlem ${code} koduyla sonlandı${why}] Enter: yeniden başlat · Ctrl+Shift+W: sekmeyi kapat\x1b[0m\r\n`);
  renderTabs();
  if (t === active) renderStatus();
});

/* ---------------- Clipboard and keys ---------------- */
let toastTimer = 0;
function toast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2400);
}
function copySelection(tab) {
  const text = tab.term.getSelection();
  if (!text) return false;
  nt.clipWrite(text);
  tab.term.clearSelection();
  toast('Kopyalandı.');
  return true;
}
async function paste(tab) {
  const text = await nt.clipRead();
  if (text && !tab.dead) tab.term.paste(text.replace(/\r\n/g, '\n'));
}
// As in Windows Terminal: a right-click copies when there is a selection, otherwise it pastes.
function rightClick(tab) {
  if (!copySelection(tab)) paste(tab);
}
function setFont(size) {
  S.fontSize = Math.max(8, Math.min(36, size));
  saveSettings();
  for (const t of tabs) { t.term.options.fontSize = S.fontSize; t.fit.fit(); }
  renderStatus();
}
// Keys NeuralTerm handles itself also stop the browser's default (otherwise Ctrl+V would paste twice).
function keyHandler(e, tab) {
  if (e.type !== 'keydown') return true;
  const handled = handleKey(e, tab);
  if (handled) e.preventDefault();
  return !handled;
}
function handleKey(e, tab) {
  const r = keyAction(e, tab);
  return r === false;
}
function keyAction(e, tab) {
  const ctrl = e.ctrlKey && !e.altKey;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (ctrl && e.shiftKey) {
    if (k === 't') { newTab(); return false; }
    if (k === 'w') { closeTab(tab); return false; }
    if (k === 'n') { nt.newWindow(); return false; }
    if (k === 'c') { copySelection(tab); return false; }
    if (k === 'v') { paste(tab); return false; }
    const n = parseInt(e.code.replace('Digit', ''), 10);
    if (n >= 1 && n <= info.shells.length && /^Digit/.test(e.code)) { newTab(info.shells[n - 1].id, tab.cwd); return false; }
  }
  if (ctrl && !e.shiftKey) {
    if (k === 'Tab') { cycle(1); return false; }
    if (k === 'c' && tab.term.hasSelection()) { copySelection(tab); return false; }
    if (k === 'v') { paste(tab); return false; }
    if (k === '=' || k === '+' || e.code === 'NumpadAdd') { setFont(S.fontSize + 1); return false; }
    if (k === '-' || e.code === 'NumpadSubtract') { setFont(S.fontSize - 1); return false; }
    if (k === '0' || e.code === 'Numpad0') { setFont(15); return false; }
  }
  if (e.ctrlKey && e.shiftKey && k === 'Tab') { cycle(-1); return false; }
  return true;
}
document.addEventListener('wheel', e => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  setFont(S.fontSize + (e.deltaY < 0 ? 1 : -1));
}, { passive: false });

/* ---------------- Menus ---------------- */
let menu = null;
function openMenu(items, btn) {
  closeMenu();
  const pop = document.createElement('div');
  pop.className = 'popup';
  pop.setAttribute('role', 'menu');
  const build = (list, host) => {
    for (const it of list) {
      if (it === '-') { host.appendChild(document.createElement('hr')); continue; }
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mi';
      const checked = it.check ? it.check() : it.radio ? it.radio() : false;
      b.innerHTML = `<span class="chk">${checked ? (it.radio ? '●' : '✓') : ''}</span><span>${esc(it.label)}</span><span class="k">${esc(it.key || '')}</span><span class="arr">${it.sub ? '›' : ''}</span>`;
      b.addEventListener('mousedown', e => e.preventDefault());
      b.addEventListener('click', () => {
        if (it.sub) { pop.textContent = ''; build(it.sub, pop); return; }
        closeMenu();
        it.run();
      });
      host.appendChild(b);
    }
  };
  build(items, pop);
  el.popups.appendChild(pop);
  const r = btn.getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(r.right - pop.offsetWidth, innerWidth - pop.offsetWidth - 8)) + 'px';
  pop.style.top = (r.bottom + 4) + 'px';
  btn.classList.add('open');
  menu = { pop, btn };
  pop.querySelector('.mi')?.focus();
  pop.addEventListener('keydown', e => {
    const items = [...pop.querySelectorAll('.mi')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeMenu(); }
  });
}
function closeMenu() {
  if (!menu) return;
  menu.pop.remove();
  menu.btn.classList.remove('open');
  menu = null;
  active?.term.focus();
}
document.addEventListener('mousedown', e => {
  if (menu && !menu.pop.contains(e.target) && !menu.btn.contains(e.target)) closeMenu();
}, true);
window.addEventListener('blur', closeMenu);

const shellItems = (run, radio) => info.shells.map((s, i) => ({ label: s.name, key: i < 9 ? `Ctrl+Shift+${i + 1}` : '', radio: radio ? () => radio(s.id) : null, run: () => run(s.id) }));
$('#tab-new').addEventListener('click', () => newTab());
$('#tab-shells').addEventListener('click', e => openMenu(shellItems(id => newTab(id, active?.cwd)), e.currentTarget));
$('#menu-btn').addEventListener('click', e => openMenu([
  { label: 'Yeni pencere', key: 'Ctrl+Shift+N', run: () => nt.newWindow() },
  '-',
  { label: 'Varsayılan kabuk', sub: shellItems(id => { S.shell = id; saveSettings(); toast(`Yeni sekmeler ${shellName(id)} ile açılacak.`); }, id => S.shell === id) },
  { label: 'Tema', sub: [
    ...THEMES.map(t => ({ label: t.name, radio: () => S.theme === t.id, run: () => setTheme(t.id) })),
    '-',
    { label: 'Temayı seriyle eşitle', check: () => S.syncTheme, run: toggleThemeSync },
  ] },
  { label: 'Yazıyı büyüt', key: 'Ctrl+=', run: () => setFont(S.fontSize + 1) },
  { label: 'Yazıyı küçült', key: 'Ctrl+-', run: () => setFont(S.fontSize - 1) },
  '-',
  { label: 'Klavye kısayolları', run: openShortcuts },
  { label: 'NeuralTerm hakkında', run: () => ask($('#dlg-about')) },
], e.currentTarget));

/* ---------------- Dialogs ---------------- */
function ask(dlg) {
  return new Promise(res => {
    closeMenu();
    dlg.returnValue = '';
    dlg.showModal();
    dlg.addEventListener('close', () => { res(dlg.returnValue || 'cancel'); active?.term.focus(); }, { once: true });
  });
}
const SHORTCUTS = [
  ['Yeni sekme (varsayılan kabuk)', 'Ctrl+Shift+T'], ['Belirli kabukla yeni sekme', 'Ctrl+Shift+1…5'], ['Sekmeyi kapat', 'Ctrl+Shift+W'],
  ['Sonraki / önceki sekme', 'Ctrl+Tab / Ctrl+Shift+Tab'], ['Yeni pencere', 'Ctrl+Shift+N'],
  ['Kopyala', 'Ctrl+C (seçim varken) / Ctrl+Shift+C'], ['Yapıştır', 'Ctrl+V / Ctrl+Shift+V'], ['Sağ tık', 'Seçim varsa kopyalar, yoksa yapıştırır'],
  ['Yazı boyutu', 'Ctrl+= / Ctrl+- / Ctrl+0 / Ctrl+Tekerlek'], ['Çalışan komutu durdur', 'Ctrl+C (seçim yokken)'],
];
function openShortcuts() {
  $('#keys-list').innerHTML = SHORTCUTS.map(([a, k]) => `<span>${esc(a)}</span><span class="kk">${esc(k)}</span>`).join('');
  ask($('#dlg-keys'));
}

/* ---------------- Window ---------------- */
for (const id of ['win-min', 'win-max', 'win-close']) $('#' + id).addEventListener('mousedown', e => e.preventDefault());
$('#win-min').addEventListener('click', () => nt.minimize());
$('#win-max').addEventListener('click', () => nt.toggleMaximize());
$('#win-close').addEventListener('click', () => nt.close());
nt.onMaximized(on => root.classList.toggle('is-max', on));
for (const h of document.querySelectorAll('.rz')) {
  h.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    h.setPointerCapture(e.pointerId);
    nt.resizeStart(h.dataset.edge);
    const end = () => { h.removeEventListener('pointerup', end); h.removeEventListener('lostpointercapture', end); nt.resizeEnd(); };
    h.addEventListener('pointerup', end);
    h.addEventListener('lostpointercapture', end);
  });
}
nt.onCloseRequest(async count => {
  $('#cfm-title').textContent = 'Tüm sekmeler kapansın mı?';
  $('#cfm-text').textContent = `${count} sekme açık. Pencere kapanırsa içlerinde çalışan her şey sonlanır.`;
  $('#cfm-ok').textContent = 'Hepsini kapat';
  if ((await ask($('#dlg-confirm'))) === 'ok') nt.confirmClose();
});
new ResizeObserver(() => { if (active) active.fit.fit(); }).observe(el.terms);

/* ---------------- Start ---------------- */
// A program that follows the series starts with the series theme (it may have changed while this one was closed).
const seriesTheme = await nt.themeInit(S.theme, S.syncTheme);
if (seriesTheme !== S.theme && THEMES.some(t => t.id === seriesTheme)) { S.theme = seriesTheme; saveSettings(); }
applyTheme();
info = await nt.info();
if (!info.shells.some(s => s.id === S.shell)) S.shell = info.shells[0]?.id;
await document.fonts?.ready;
const dirs = await nt.pendingDirs();
if (dirs.length) for (const d of dirs) newTab(S.shell, d);
else newTab();
nt.onOpenDirs(list => { for (const d of list) newTab(S.shell, d); });

})();
