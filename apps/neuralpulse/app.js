/* ============================================================
   NeuralPulse — graphs and the process list
   main.js forwards one sample a second from plsensor.exe: { t, cpu, mem, disks, net, gpu, procs }.
   ============================================================ */
'use strict';
(async () => {

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const readJSON = k => { try { return JSON.parse(localStorage.getItem(k)) || null; } catch { return null; } };
const np = window.np;
// Interface texts in the series language (lang\*.json through language.js and i18n.js).
const T = NeuralI18n.page(window);
const root = document.documentElement;
const HISTORY = 60; // seconds on the graphs
const ROW_H = 26; // px, as --row-h

/* ---------------- Settings ---------------- */
const SETTINGS_KEY = 'neuralpulse.settings';
const THEMES = ['neon', 'ice', 'alarm', 'daylight'].map(id => ({ id, name: T('theme.' + id) }));
const COLUMNS = ['name', 'pid', 'cpu', 'mem', 'path'];
const S = Object.assign({ theme: 'neon', syncTheme: true, sort: 'cpu', dir: 'desc' }, readJSON(SETTINGS_KEY));
if (!COLUMNS.includes(S.sort)) S.sort = 'cpu';
const saveSettings = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(S)); } catch { /* storage unavailable */ } };

function applyTheme() {
  for (const t of THEMES) root.classList.toggle('theme-' + t.id, t.id === S.theme);
  readColors();
  drawAll();
}
function setTheme(id) { S.theme = id; saveSettings(); applyTheme(); np.themeSet(id); }
// The series theme: another Neural program changed it, or the setting changed there.
np.onThemeApply(id => {
  if (!THEMES.some(t => t.id === id) || id === S.theme) return;
  S.theme = id;
  saveSettings();
  applyTheme();
});
np.onThemeSyncState(on => { S.syncTheme = !!on; saveSettings(); });
function toggleThemeSync() { S.syncTheme = !S.syncTheme; saveSettings(); np.themeSync(S.syncTheme, S.theme); }

/* ---------------- Numbers in the interface language ---------------- */
const nf = (min, max, style) => new Intl.NumberFormat(T.locale, { style, minimumFractionDigits: min, maximumFractionDigits: max });
const N0 = nf(0, 0), N1 = nf(1, 1), P0 = nf(0, 0, 'percent'), P1 = nf(1, 1, 'percent');
const pct = v => P0.format((Number(v) || 0) / 100);
const pct1 = v => P1.format((Number(v) || 0) / 100);
const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];
function bytes(n) {
  let v = Math.max(0, Number(n) || 0), i = 0;
  while (v >= 1024 && i < UNITS.length - 1) { v /= 1024; i++; }
  return `${(i === 0 || v >= 100 ? N0 : N1).format(v)} ${UNITS[i]}`;
}
const rate = n => T('unit.rate', { v: bytes(n) });
const two = n => String(n).padStart(2, '0');
function duration(sec) {
  const s = Math.max(0, Math.floor(sec));
  const d = Math.floor(s / 86400);
  const t = `${two(Math.floor(s / 3600) % 24)}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}`;
  return d ? T('uptime.days', { d, t }) : t;
}

/* ---------------- Graph cards ---------------- */
const el = { cards: $('#cards'), tbody: $('#tbody'), rows: $('#rows'), spacer: $('#spacer'), empty: $('#empty'), search: $('#search'), clear: $('#search-clear'), count: $('#procs-count'), live: $('#live'), liveText: $('#live-text'), toast: $('#toast'), popups: $('#popups') };
const cards = new Map(); // key → { key, kind, el, canvas, ctx, series: [[…], …], cores }
let order = []; // the cards' keys as shown
let COLORS = {};
function readColors() {
  const cs = getComputedStyle(root);
  for (const k of ['g-cpu', 'g-mem', 'g-disk', 'g-rx', 'g-tx', 'g-gpu', 'g-grid']) COLORS[k] = cs.getPropertyValue('--' + k).trim();
}
const SERIES = { cpu: ['g-cpu'], mem: ['g-mem'], disk: ['g-disk'], net: ['g-rx', 'g-tx'], gpu: ['g-gpu'] };

function makeCard(key, kind, label) {
  const c = document.createElement('article');
  c.className = 'card';
  c.dataset.kind = kind;
  c.dataset.key = key;
  c.innerHTML = '<header class="card-head"><span class="card-label"></span><span class="card-sub"></span></header>'
    + '<div class="card-value"><span class="big">—</span><span class="unit"></span></div><canvas aria-hidden="true"></canvas>'
    + (kind === 'cpu' ? `<div class="cores" role="img" aria-label="${esc(T('card.cores.aria'))}"></div>` : '')
    + '<span class="scale"></span><div class="card-foot"></div>';
  $('.card-label', c).textContent = label;
  const canvas = $('canvas', c);
  return {
    key, kind, el: c, canvas, ctx: canvas.getContext('2d'), series: SERIES[kind].map(() => []), max: 100,
    big: $('.big', c), unit: $('.unit', c), sub: $('.card-sub', c), foot: $('.card-foot', c), scale: $('.scale', c), cores: $('.cores', c),
  };
}
// The cards a sample asks for: CPU, memory, each disk, network, and the GPU when Windows has its counters.
function ensureCards(s) {
  const want = [['cpu', 'cpu', T('card.cpu')], ['mem', 'mem', T('card.mem')]];
  for (const d of s.disks || []) want.push(['disk:' + d.name, 'disk', T('card.disk')]);
  want.push(['net', 'net', T('card.net')]);
  if (s.gpu) want.push(['gpu', 'gpu', T('card.gpu')]);
  const keys = want.map(w => w[0]);
  if (keys.join('\n') === order.join('\n')) return;
  for (const [key, kind, label] of want) if (!cards.has(key)) cards.set(key, makeCard(key, kind, label));
  for (const key of [...cards.keys()]) if (!keys.includes(key)) cards.delete(key);
  el.cards.replaceChildren(...keys.map(k => cards.get(k).el));
  order = keys;
}
function push(key, values) {
  const c = cards.get(key);
  if (!c) return;
  values.forEach((v, i) => {
    const a = c.series[i];
    a.push(Number(v) || 0);
    if (a.length > HISTORY) a.splice(0, a.length - HISTORY);
  });
}
const sum = (list, k) => (list || []).reduce((a, x) => a + (Number(x[k]) || 0), 0);
function setText(node, text) { if (node && node.textContent !== text) node.textContent = text; }
// A card's foot: one or two lines, each cut with an ellipsis (the whole text in the tooltip).
function setFoot(c, ...lines) {
  const key = lines.join('\n');
  if (c.footText === key) return;
  c.footText = key;
  c.foot.replaceChildren(...lines.map(l => { const d = document.createElement('div'); d.textContent = l; return d; }));
  c.foot.title = lines.join(' · ');
}
// "13.6 / 32.0 GB": two sizes in the unit of the larger one.
function pair(a, b) {
  let i = 0, top = Math.max(Number(a) || 0, Number(b) || 0);
  while (top >= 1024 && i < UNITS.length - 1) { top /= 1024; i++; }
  const f = v => { const x = (Number(v) || 0) / 1024 ** i; return (i === 0 || x >= 100 ? N0 : N1).format(x); };
  return `${f(a)} / ${f(b)} ${UNITS[i]}`;
}

function updateCards(s) {
  const cpu = cards.get('cpu');
  if (cpu) {
    setText(cpu.big, pct(s.cpu.total));
    const n = s.cpu.cores.length;
    setText(cpu.sub, T('card.cores', { n }));
    if (cpu.cores.children.length !== n) cpu.cores.replaceChildren(...s.cpu.cores.map(() => document.createElement('i')));
    s.cpu.cores.forEach((v, i) => {
      const bar = cpu.cores.children[i];
      bar.style.setProperty('--v', String(Math.min(1, Math.max(0, v / 100))));
      bar.title = T('card.core', { n: i + 1, v: pct(v) });
    });
    const top = (s.procs || []).reduce((a, p) => (!a || p.cpu > a.cpu ? p : a), null);
    setFoot(cpu, top ? T('card.cpu-top', { name: top.name, v: pct1(top.cpu) }) : '');
  }
  const mem = cards.get('mem');
  if (mem) {
    const m = s.mem;
    setText(mem.big, pct(m.total ? (m.used / m.total) * 100 : 0));
    setText(mem.unit, pair(m.used, m.total));
    mem.unit.title = T('card.mem-used');
    setFoot(mem, T('card.commit', { v: pair(m.commit, m.commitLimit) }));
  }
  for (const d of s.disks || []) {
    const c = cards.get('disk:' + d.name);
    if (!c) continue;
    setText(c.big, pct(d.busy));
    setText(c.unit, T('card.disk-busy'));
    setText(c.sub, d.name);
    setFoot(c, T('card.disk-read', { v: rate(d.read) }), T('card.disk-write', { v: rate(d.write) }));
  }
  const net = cards.get('net');
  if (net) {
    const rx = sum(s.net, 'rx'), tx = sum(s.net, 'tx');
    setText(net.big, rate(rx + tx));
    net.big.title = T('card.net-total');
    setText(net.sub, s.net.length ? T('card.net-ifaces', { n: s.net.length }) : '');
    net.sub.title = (s.net || []).map(n => n.name).join(' · ');
    if (s.net.length) setFoot(net, T('card.net-rx', { v: rate(rx) }), T('card.net-tx', { v: rate(tx) }));
    else setFoot(net, T('card.net-none'));
  }
  const gpu = cards.get('gpu');
  if (gpu && s.gpu) {
    setText(gpu.big, pct(s.gpu.util));
    setText(gpu.unit, T('card.gpu-busy'));
    setText(gpu.sub, s.gpu.name || '');
    gpu.sub.title = s.gpu.name || '';
    setFoot(gpu, T('card.gpu-mem', { v: s.gpu.total ? pair(s.gpu.used, s.gpu.total) : bytes(s.gpu.used) }));
    gpu.foot.title = T('card.gpu-mem.title');
  }
}

// A rising scale for the network: 64 KB/s, 128 KB/s, … whatever the last minute needs.
function scaleFor(values) {
  let m = 64 * 1024;
  const top = Math.max(0, ...values.flat());
  while (m < top) m *= 2;
  return m;
}
function draw(c) {
  const r = c.canvas.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
  if (c.canvas.width !== w || c.canvas.height !== h) { c.canvas.width = w; c.canvas.height = h; }
  const g = c.ctx;
  g.clearRect(0, 0, w, h);
  // the grid: quarters, and a line every 10 seconds
  g.strokeStyle = COLORS['g-grid'];
  g.lineWidth = 1;
  g.beginPath();
  for (let i = 1; i < 4; i++) { const y = Math.round((h * i) / 4) + 0.5; g.moveTo(0, y); g.lineTo(w, y); }
  for (let i = 1; i < 6; i++) { const x = Math.round((w * i) / 6) + 0.5; g.moveTo(x, 0); g.lineTo(x, h); }
  g.stroke();
  const max = c.kind === 'net' ? scaleFor(c.series) : 100;
  c.max = max;
  setText(c.scale, c.kind === 'net' ? rate(max) : '');
  const step = w / (HISTORY - 1);
  c.series.forEach((vals, si) => {
    const n = vals.length;
    if (!n) return;
    const color = COLORS[SERIES[c.kind][si]] || '#888';
    const line = new Path2D();
    const x0 = w - (n - 1) * step;
    for (let i = 0; i < n; i++) {
      const x = w - (n - 1 - i) * step;
      const y = h - Math.min(1, Math.max(0, vals[i] / max)) * (h - 2 * dpr) - dpr;
      if (i) line.lineTo(x, y); else line.moveTo(x, y);
    }
    if (n === 1) line.lineTo(w, h - Math.min(1, vals[0] / max) * (h - 2 * dpr) - dpr);
    const area = new Path2D(line);
    area.lineTo(w, h);
    area.lineTo(x0, h);
    area.closePath();
    g.globalAlpha = si ? 0.1 : 0.18;
    g.fillStyle = color;
    g.fill(area);
    g.globalAlpha = 1;
    g.strokeStyle = color;
    g.lineWidth = 1.5 * dpr;
    g.lineJoin = 'round';
    g.stroke(line);
  });
}
function drawAll() { for (const c of cards.values()) draw(c); }
new ResizeObserver(() => drawAll()).observe(el.cards);

/* ---------------- Process list (only the visible rows exist; they are filled in place) ---------------- */
let procs = []; // the newest sample's processes
let view = []; // searched and sorted
let selPid = null;
let query = '';
const pool = []; // { el, cells, vals, p }
const collator = new Intl.Collator(T.locale, { sensitivity: 'base', numeric: true });
const SORTERS = {
  name: (a, b) => collator.compare(a.name, b.name),
  pid: (a, b) => a.pid - b.pid,
  cpu: (a, b) => a.cpu - b.cpu,
  mem: (a, b) => a.mem - b.mem,
  path: (a, b) => (a.path && b.path ? collator.compare(a.path, b.path) : (a.path ? 0 : 1) - (b.path ? 0 : 1)),
};
const FIRST_DIR = { name: 'asc', pid: 'asc', cpu: 'desc', mem: 'desc', path: 'asc' };
let memTotal = 0;

function setProcs(list) {
  procs = (list || []).map(p => ({ ...p, key: `${p.name}\n${p.pid}\n${p.path || ''}`.toLowerCase() }));
  rebuildView();
}
function rebuildView() {
  const q = query.trim().toLowerCase();
  const list = q ? procs.filter(p => p.key.includes(q)) : procs.slice();
  const f = SORTERS[S.sort], d = S.dir === 'asc' ? 1 : -1;
  list.sort((a, b) => d * f(a, b) || collator.compare(a.name, b.name) || a.pid - b.pid);
  view = list;
  el.spacer.style.height = view.length * ROW_H + 'px';
  renderRows();
  setText(el.count, q ? T('procs.match', { n: view.length }) : '');
  renderEmpty();
  renderStatus();
}
function makeRow() {
  const r = document.createElement('div');
  r.className = 'tr';
  r.setAttribute('role', 'row');
  const cells = ['name', 'pid num', 'cpu num', 'mem num', 'path'].map(cls => {
    const c = document.createElement('span');
    c.className = 'td ' + cls;
    c.setAttribute('role', 'gridcell');
    r.appendChild(c);
    return c;
  });
  const row = { el: r, cells, vals: [], heat: [], p: null, sel: null };
  r.addEventListener('mousedown', e => {
    if (!row.p || e.button > 2) return;
    select(row.p.pid);
    el.tbody.focus({ preventScroll: true });
  });
  r.addEventListener('contextmenu', e => {
    e.preventDefault();
    if (row.p) openContext(row.p, e.clientX, e.clientY);
  });
  el.rows.appendChild(r);
  return row;
}
function cell(row, i, text, title) {
  if (row.vals[i] === text) return;
  row.vals[i] = text;
  row.cells[i].textContent = text;
  if (title !== undefined) row.cells[i].title = title;
}
function heat(row, i, h) {
  const v = Math.round(Math.min(1, Math.max(0, h)) * 20) / 20;
  if (row.heat[i] === v) return;
  row.heat[i] = v;
  row.cells[i].style.setProperty('--h', String(v));
}
function renderRows() {
  const top = el.tbody.scrollTop;
  const first = Math.max(0, Math.min(Math.floor(top / ROW_H), Math.max(0, view.length - 1)));
  const count = Math.ceil(el.tbody.clientHeight / ROW_H) + 1;
  while (pool.length < count) pool.push(makeRow());
  el.rows.style.transform = `translateY(${first * ROW_H}px)`;
  for (let j = 0; j < pool.length; j++) {
    const row = pool[j];
    const p = j < count ? view[first + j] : null;
    row.p = p || null;
    if (!p) { if (!row.el.hidden) row.el.hidden = true; continue; }
    if (row.el.hidden) row.el.hidden = false;
    if (row.el.dataset.pid !== String(p.pid)) row.el.dataset.pid = String(p.pid);
    cell(row, 0, p.name, p.name);
    cell(row, 1, String(p.pid));
    cell(row, 2, pct1(p.cpu));
    cell(row, 3, bytes(p.mem));
    cell(row, 4, p.path || '—', p.path || T('path.denied'));
    row.cells[4].classList.toggle('none', !p.path);
    if (row.cells[2].dataset.v !== String(p.cpu)) row.cells[2].dataset.v = String(p.cpu);
    if (row.cells[3].dataset.v !== String(p.mem)) row.cells[3].dataset.v = String(p.mem);
    heat(row, 2, p.cpu / 25);
    heat(row, 3, memTotal ? (p.mem / memTotal) * 8 : 0);
    const sel = p.pid === selPid;
    if (row.sel !== sel) { row.sel = sel; row.el.classList.toggle('sel', sel); row.el.setAttribute('aria-selected', String(sel)); }
  }
}
let scrollQueued = false;
el.tbody.addEventListener('scroll', () => {
  if (scrollQueued) return;
  scrollQueued = true;
  requestAnimationFrame(() => { scrollQueued = false; renderRows(); });
});
new ResizeObserver(() => renderRows()).observe(el.tbody);

const selected = () => view.find(p => p.pid === selPid) || null;
function select(pid, scroll = false) {
  selPid = pid;
  if (scroll) {
    const i = view.findIndex(p => p.pid === pid);
    if (i >= 0) {
      const y = i * ROW_H, tb = el.tbody;
      if (y < tb.scrollTop) tb.scrollTop = y;
      else if (y + ROW_H > tb.scrollTop + tb.clientHeight) tb.scrollTop = y + ROW_H - tb.clientHeight;
    }
  }
  renderRows();
}
function moveBy(n) {
  if (!view.length) return;
  const i = view.findIndex(p => p.pid === selPid);
  const next = i < 0 ? (n > 0 ? 0 : view.length - 1) : Math.max(0, Math.min(view.length - 1, i + n));
  select(view[next].pid, true);
}

// Sorting: a click on a header; the same header again turns the order around.
const headers = [...document.querySelectorAll('.th')];
function renderHeaders() {
  for (const h of headers) {
    const col = h.dataset.col, on = col === S.sort;
    h.classList.toggle('sorted', on);
    h.classList.toggle('asc', on && S.dir === 'asc');
    h.classList.toggle('desc', on && S.dir === 'desc');
    h.setAttribute('aria-sort', on ? (S.dir === 'asc' ? 'ascending' : 'descending') : 'none');
    h.title = T('col.sort', { col: h.textContent.trim() });
  }
}
function setSort(col) {
  if (S.sort === col) S.dir = S.dir === 'asc' ? 'desc' : 'asc';
  else { S.sort = col; S.dir = FIRST_DIR[col]; }
  saveSettings();
  renderHeaders();
  rebuildView();
}
for (const h of headers) {
  h.addEventListener('mousedown', e => e.preventDefault());
  h.addEventListener('click', () => setSort(h.dataset.col));
}

// Searching: name, PID or location.
function setQuery(text) {
  query = text;
  if (el.search.value !== text) el.search.value = text;
  el.clear.hidden = !text;
  el.tbody.scrollTop = 0;
  rebuildView();
}
el.search.addEventListener('input', () => setQuery(el.search.value));
el.clear.addEventListener('click', () => { setQuery(''); el.search.focus(); });
el.search.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    e.preventDefault();
    if (el.search.value) setQuery(''); else el.tbody.focus();
  } else if (e.key === 'ArrowDown' || e.key === 'Enter') {
    e.preventDefault();
    if (!selected() && view.length) select(view[0].pid, true);
    el.tbody.focus();
  }
});

/* ---------------- What can be done with a process ---------------- */
let toastTimer = 0;
function toast(msg, ms = 2600, error = false) {
  el.toast.textContent = msg;
  el.toast.classList.toggle('error', error);
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), ms);
}
function copy(text) {
  if (!text) return;
  np.clipWrite(text);
  toast(T('toast.copied'));
}
async function openLocation(p) {
  if (!p) return;
  if (!p.path) { toast(T('loc.none'), 4000, true); return; }
  const err = await np.openLocation(p.path);
  if (err) toast(err, 5000, true);
}
// Ending: a confirmation first (name, PID, location, the warning); main.js checks again and Windows may refuse.
async function endProcess(p) {
  if (!p) return;
  if (info.demo) { toast(T('end.demo'), 5000, true); return; }
  $('#end-target').textContent = T('end.target', { name: p.name, pid: p.pid });
  $('#end-path').textContent = p.path || '';
  if ((await ask($('#dlg-end'), $('#end-cancel'))) !== 'ok') return;
  const at = view.findIndex(x => x.pid === p.pid);
  const r = await np.endProcess(p.pid, p.name);
  if (!r || !r.ok) { toast((r && r.error) || T('end.failed', { error: '?' }), 7000, true); return; }
  toast(T('end.done', { name: p.name, pid: p.pid }), 4000);
  // gone from the list now; the next sample confirms it
  procs = procs.filter(x => x.pid !== p.pid);
  rebuildView();
  if (selPid === p.pid && view.length) select(view[Math.min(at, view.length - 1)].pid, true);
}

function openContext(p, x, y) {
  select(p.pid);
  openMenu([
    { label: T(info.nav ? 'ctx.open-nav' : 'ctx.open-explorer'), key: 'Enter', disabled: !p.path, run: () => openLocation(p) },
    { label: T('ctx.copy-path'), key: 'Ctrl+C', disabled: !p.path, run: () => copy(p.path) },
    { label: T('ctx.copy-name'), run: () => copy(p.name) },
    '-',
    { label: T('ctx.end'), key: 'Del', danger: true, run: () => endProcess(p) },
  ], null, { x, y });
}

el.tbody.addEventListener('keydown', e => {
  const page = Math.max(1, Math.floor(el.tbody.clientHeight / ROW_H) - 1);
  const p = selected();
  const plain = !e.ctrlKey && !e.altKey && !e.metaKey;
  if (e.key === 'ArrowDown' && plain) moveBy(1);
  else if (e.key === 'ArrowUp' && plain) moveBy(-1);
  else if (e.key === 'PageDown' && plain) moveBy(page);
  else if (e.key === 'PageUp' && plain) moveBy(-page);
  else if (e.key === 'Home' && plain) moveBy(-view.length);
  else if (e.key === 'End' && plain) moveBy(view.length);
  else if (e.key === 'Enter' && plain) openLocation(p);
  else if (e.key === 'Delete' && plain) endProcess(p);
  else if (e.key.toLowerCase() === 'c' && e.ctrlKey && !e.altKey && !e.shiftKey) copy(p && (p.path || p.name));
  else if ((e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) && p) {
    const row = pool.find(r => r.p === p);
    const b = (row ? row.el : el.tbody).getBoundingClientRect();
    openContext(p, b.left + 40, b.top + (row ? ROW_H : 8));
  } else if (e.key.length === 1 && plain && e.key !== ' ') {
    el.search.focus(); // typing searches; the key itself goes to the box
    return;
  } else return;
  e.preventDefault();
});
el.tbody.addEventListener('contextmenu', e => e.preventDefault());

/* ---------------- Menus ---------------- */
// The series language: a pick shows from the next start, so only the note changes now.
const languages = NeuralI18n.languageChoices(window, note => toast(note, 6000));
// New versions of the series (update-check.js): the switch, and the newer version when one is known.
const upd = NeuralI18n.updates(window, T);
let menu = null;
function openMenu(items, btn, at) {
  closeMenu();
  const back = document.activeElement;
  const pop = document.createElement('div');
  pop.className = 'popup';
  pop.setAttribute('role', 'menu');
  const build = (list, host) => {
    for (const it of list) {
      if (it === '-') { host.appendChild(document.createElement('hr')); continue; }
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mi' + (it.danger ? ' danger' : '');
      b.disabled = !!it.disabled;
      b.setAttribute('role', 'menuitem');
      const checked = it.check ? it.check() : it.radio ? it.radio() : false;
      b.innerHTML = `<span class="chk">${checked ? (it.radio ? '●' : '✓') : ''}</span><span>${esc(it.label)}</span><span class="k">${esc(it.key || '')}</span><span class="arr">${it.sub ? '›' : ''}</span>`;
      b.addEventListener('mousedown', e => e.preventDefault());
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
  pop.addEventListener('keydown', e => {
    const list = [...pop.querySelectorAll('.mi:not(:disabled)')];
    const i = list.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length].focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeMenu(); }
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
document.addEventListener('mousedown', e => {
  if (menu && !menu.pop.contains(e.target) && !(menu.btn && menu.btn.contains(e.target))) closeMenu();
}, true);
window.addEventListener('blur', closeMenu);

$('#menu-btn').addEventListener('click', e => {
  if (menu && menu.btn === e.currentTarget) { closeMenu(); return; }
  openMenu([
    { label: T('menu.theme'), sub: [
      ...THEMES.map(th => ({ label: th.name, radio: () => S.theme === th.id, run: () => setTheme(th.id) })),
      '-',
      { label: T('menu.theme-sync'), check: () => S.syncTheme, run: toggleThemeSync },
    ] },
    { label: T('lang.menu'), sub: languages().map(l => ({ label: l.label, radio: l.checked, run: l.pick })) },
    { label: T('update.check'), check: upd.enabled, run: upd.toggle },
    ...(upd.latest() ? [{ label: upd.latestLabel(), run: upd.open }] : []),
    '-',
    { label: T('menu.keys'), key: 'F1', run: openShortcuts },
    { label: T('menu.about'), run: openAbout },
  ], e.currentTarget);
});

/* ---------------- Dialogs ---------------- */
function ask(dlg, focus) {
  return new Promise(res => {
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
const SHORTCUTS = () => [
  [T('keys.search'), 'Ctrl+F'], [T('keys.clear'), 'Esc'], [T('keys.move'), '↑ ↓ PageUp PageDown Home End'],
  [T('keys.open'), 'Enter'], [T('keys.copy'), 'Ctrl+C'], [T('keys.end'), 'Del'], [T('keys.menu'), T('keys.menu.k')],
  [T('keys.sort'), T('keys.sort.k')], [T('keys.help'), 'F1'],
];
function openShortcuts() {
  $('#keys-list').innerHTML = SHORTCUTS().map(([a, k]) => `<span>${esc(a)}</span><span class="kk">${esc(k)}</span>`).join('');
  ask($('#dlg-keys'));
}
function openAbout() {
  $('#about-hint').textContent = T('about.hint', { version: info.version });
  ask($('#dlg-about'));
}
document.addEventListener('keydown', e => {
  if (e.defaultPrevented || document.querySelector('dialog[open]')) return;
  if (e.key === 'F1') { e.preventDefault(); openShortcuts(); }
  else if (e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'f') { e.preventDefault(); el.search.focus(); el.search.select(); }
});

/* ---------------- Window ---------------- */
// Without the focus the animations rest (see styles.css).
const idle = () => root.classList.toggle('idle', !document.hasFocus());
window.addEventListener('focus', idle);
window.addEventListener('blur', idle);
idle();
for (const id of ['win-min', 'win-max', 'win-close']) $('#' + id).addEventListener('mousedown', e => e.preventDefault());
$('#win-min').addEventListener('click', () => np.minimize());
$('#win-max').addEventListener('click', () => np.toggleMaximize());
$('#win-close').addEventListener('click', () => np.close());
np.onMaximized(on => root.classList.toggle('is-max', on));
for (const h of document.querySelectorAll('.rz')) {
  h.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    h.setPointerCapture(e.pointerId);
    np.resizeStart(h.dataset.edge);
    const end = () => { h.removeEventListener('pointerup', end); h.removeEventListener('lostpointercapture', end); np.resizeEnd(); };
    h.addEventListener('pointerup', end);
    h.addEventListener('lostpointercapture', end);
  });
}

/* ---------------- Samples, status ---------------- */
let info = { demo: false, version: '', nav: false, uptime: 0, history: [], last: null, sensor: {} };
let infoAt = Date.now();
let sensorState = {};
let latest = null;
const uptimeNow = () => info.uptime + (Date.now() - infoAt) / 1000;

function renderLive() {
  const st = sensorState;
  const state = st.error ? 'error' : !latest ? 'wait' : info.demo ? 'demo' : 'on';
  el.live.className = 'live ' + state + (el.live.classList.contains('beat') ? ' beat' : '');
  setText(el.liveText, T('live.' + state));
  el.live.title = state === 'on' || state === 'demo' ? T(`live.${state}.title`) : '';
}
function renderEmpty() {
  const st = sensorState;
  let text = '';
  if (!procs.length) text = st.error === 'missing' ? T('empty.missing') : st.error ? T('empty.stopped') : T('empty.wait');
  else if (!view.length) text = T('empty.none', { q: query.trim() });
  el.empty.hidden = !text;
  setText(el.empty, text);
}
function renderStatus() {
  setText($('#st-procs'), latest ? T('status.procs', { n: procs.length }) : '');
  setText($('#st-cpu'), latest ? T('status.cpu', { v: pct(latest.cpu.total) }) : '');
  setText($('#st-mem'), latest && latest.mem.total ? T('status.mem', { v: pct((latest.mem.used / latest.mem.total) * 100) }) : '');
  setText($('#st-uptime'), T('status.uptime', { v: duration(uptimeNow()) }));
}
setInterval(() => setText($('#st-uptime'), T('status.uptime', { v: duration(uptimeNow()) })), 1000);

// quiet: a sample from before the page loaded, for the graphs only
function onSample(s, quiet = false) {
  if (!s || !s.cpu) return;
  ensureCards(s);
  push('cpu', [s.cpu.total]);
  push('mem', [s.mem.total ? (s.mem.used / s.mem.total) * 100 : 0]);
  for (const d of s.disks || []) push('disk:' + d.name, [d.busy]);
  push('net', [sum(s.net, 'rx'), sum(s.net, 'tx')]);
  if (s.gpu) push('gpu', [s.gpu.util]);
  lastT = s.t;
  if (quiet) return;
  latest = s;
  memTotal = s.mem.total || 0;
  updateCards(s);
  drawAll();
  if (Array.isArray(s.procs)) setProcs(s.procs);
  renderLive();
  el.live.classList.toggle('beat', !el.live.classList.contains('beat'));
}

/* ---------------- Start ---------------- */
// Samples that arrive while the page is still starting wait here.
let lastT = 0;
let ready = false;
const early = [];
np.onSample(s => { if (ready) onSample(s); else early.push(s); });
np.onSensor(st => { sensorState = st || {}; renderLive(); renderEmpty(); });

// A program that follows the series starts with the series theme (it may have changed while this one was closed).
const seriesTheme = await np.themeInit(S.theme, S.syncTheme);
if (seriesTheme !== S.theme && THEMES.some(t => t.id === seriesTheme)) { S.theme = seriesTheme; saveSettings(); }
applyTheme();
renderHeaders();
info = await np.info();
infoAt = Date.now();
sensorState = info.sensor || {};
const hist = info.history || [];
for (const h of hist.slice(0, -1)) onSample(h, true);
if (info.last) onSample(info.last);
ready = true;
for (const s of early) if (s.t > lastT) onSample(s);
early.length = 0;
renderLive();
renderEmpty();
renderStatus();
el.tbody.focus({ preventScroll: true });

})();
