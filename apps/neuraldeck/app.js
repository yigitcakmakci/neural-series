/* ============================================================
   NeuralDeck — palette behavior: ask the main process for suggestions as you type, move through them, run one.
   ============================================================ */
'use strict';
(async () => {

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const deck = window.deck;
if (!deck) { document.body.textContent = 'NeuralDeck yalnızca masaüstü uygulaması olarak çalışır.'; return; }

const root = document.documentElement;
const q = $('#q');
const list = $('#results');
const settingsEl = $('#settings');
const THEMES = ['neon', 'ice', 'alarm', 'daylight'];

let items = [];
let sel = 0;
let seq = 0;
let shortcut = { accel: '', ok: true, error: '' };

function applyTheme(t) { for (const id of THEMES) root.classList.toggle('theme-' + id, id === t); }

/* ---------------- Suggestions ---------------- */
async function refresh() {
  const n = ++seq;
  const got = await deck.query(q.value);
  if (n !== seq) return; // a newer keystroke is already on its way
  items = got;
  sel = Math.max(0, items.findIndex(i => !i.disabled));
  render();
}
function render() {
  list.innerHTML = items.map((it, i) => {
    const sym = !/^[A-Z]{2}-\d$/.test(it.chip);
    const hint = it.disabled ? '' : it.complete && i === sel ? 'Enter · Tab' : i === sel ? 'Enter' : '';
    return `<li class="item${it.disabled ? ' off' : ''}" role="option" aria-selected="${i === sel}" aria-disabled="${it.disabled}" data-i="${i}">
      <span class="chip${sym ? ' sym' : ''}">${esc(it.chip || '')}</span>
      <span class="txt"><span class="title">${esc(it.title)}</span><span class="detail">${esc(it.detail || '')}</span></span>
      <span class="hint">${hint}</span></li>`;
  }).join('');
  const cur = list.children[sel];
  if (cur) cur.scrollIntoView({ block: 'nearest' });
  fit();
}
function move(d) {
  if (!items.length) return;
  let i = sel;
  for (let k = 0; k < items.length; k++) {
    i = (i + d + items.length) % items.length;
    if (!items[i].disabled) break;
  }
  sel = i;
  render();
}
async function run(i) {
  const it = items[i];
  if (!it) return;
  if (it.disabled) { shake(i); return; }
  const r = await deck.run(i);
  if (!r || !r.ok) { shake(i); if (r && r.error) toast(r.error); return; }
  if (r.complete) { q.value = r.complete; await refresh(); return; }
  if (r.view === 'settings') { openSettings(); return; }
  if (r.toast) toast(r.toast);
  if (!r.hide) await refresh();
}
async function complete() {
  const it = items[sel];
  if (!it || !it.complete) return false;
  q.value = it.complete;
  q.setSelectionRange(q.value.length, q.value.length);
  await refresh();
  return true;
}
function shake(i) {
  const el = list.children[i];
  if (!el) return;
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
}
let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.textContent = ''; }, 2600);
}

// The window is exactly as tall as the panel's content.
function fit() {
  requestAnimationFrame(() => deck.resize(Math.ceil($('.frame').getBoundingClientRect().height)));
}

q.addEventListener('input', refresh);
q.addEventListener('keydown', async e => {
  switch (e.key) {
    case 'ArrowDown': e.preventDefault(); move(1); break;
    case 'ArrowUp': e.preventDefault(); move(-1); break;
    case 'PageDown': e.preventDefault(); move(5); break;
    case 'PageUp': e.preventDefault(); move(-5); break;
    case 'Enter': e.preventDefault(); await run(sel); break;
    case 'Tab': e.preventDefault(); await complete(); break;
    case 'Escape': e.preventDefault(); deck.hide(); break;
  }
});
list.addEventListener('mousemove', e => {
  const li = e.target.closest('.item');
  if (!li || +li.dataset.i === sel || items[+li.dataset.i].disabled) return;
  sel = +li.dataset.i;
  render();
});
list.addEventListener('mousedown', e => e.preventDefault()); // the input keeps the keyboard
list.addEventListener('click', e => {
  const li = e.target.closest('.item');
  if (li) run(+li.dataset.i);
});

/* ---------------- Shortcut warning ---------------- */
function showShortcut(s) {
  shortcut = s || shortcut;
  $('#band-hint').textContent = shortcut.ok ? shortcut.accel : '';
  const w = $('#warn');
  w.hidden = shortcut.ok;
  w.textContent = shortcut.ok ? '' : `${shortcut.accel} kısayolu kaydedilemedi: başka bir program kullanıyor olabilir. Başka bir kısayol seçmek için "ayarlar" yaz.`;
  $('#set-shortcut').textContent = shortcut.accel || '—';
}

/* ---------------- Settings ---------------- */
let capturing = false;
function openSettings() {
  list.hidden = true;
  settingsEl.hidden = false;
  $('#set-msg').textContent = '';
  $('#set-msg').classList.remove('err');
  $('#set-shortcut').focus();
  fit();
}
async function closeSettings() {
  if (capturing) await stopCapture();
  settingsEl.hidden = true;
  list.hidden = false;
  q.focus();
  q.select();
  await refresh();
}
async function startCapture() {
  capturing = true;
  await deck.capture(true);
  const b = $('#set-shortcut');
  b.classList.add('capturing');
  b.textContent = 'Tuşlara bas…';
  $('#set-msg').classList.remove('err');
  $('#set-msg').textContent = 'Ctrl, Alt, Shift ya da Win ile birlikte bir tuşa bas. Vazgeçmek için Esc.';
}
async function stopCapture(result) {
  capturing = false;
  $('#set-shortcut').classList.remove('capturing');
  const s = result || await deck.capture(false);
  showShortcut(s);
  return s;
}
// An Electron accelerator from a key press, or null while only modifiers are held.
function accelOf(e) {
  const c = e.code;
  let key = null;
  if (c === 'Space') key = 'Space';
  else if (/^Key[A-Z]$/.test(c)) key = c.slice(3);
  else if (/^Digit[0-9]$/.test(c)) key = c.slice(5);
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(c)) key = c;
  else if (/^Arrow(Up|Down|Left|Right)$/.test(c)) key = c.slice(5);
  if (!key) return null;
  return [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super', key].filter(Boolean).join('+');
}
$('#set-shortcut').addEventListener('click', () => { if (!capturing) startCapture(); });
$('#set-back').addEventListener('click', closeSettings);
window.addEventListener('keydown', async e => {
  if (settingsEl.hidden) return;
  if (capturing) {
    e.preventDefault();
    if (e.key === 'Escape') { await stopCapture(); $('#set-msg').textContent = 'Kısayol değişmedi.'; return; }
    const accel = accelOf(e);
    if (!accel) return;
    const r = await deck.setShortcut(accel);
    await stopCapture(r);
    const m = $('#set-msg');
    m.classList.toggle('err', !!r.error);
    m.textContent = r.error ? r.error + (r.ok ? ` Kısayol ${r.accel} olarak kaldı.` : '') : `Yeni kısayol: ${r.accel}`;
    return;
  }
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSettings(); }
}, true);

/* ---------------- Showing and hiding ---------------- */
deck.onShown(async s => {
  applyTheme(s.theme);
  showShortcut(s.shortcut);
  if (!settingsEl.hidden) return;
  q.focus();
  q.select();
  await refresh();
});
deck.onHidden(() => { if (!settingsEl.hidden) closeSettings(); });
deck.onTheme(applyTheme);
deck.onOpenSettings(openSettings);

const st = await deck.state();
applyTheme(st.theme);
showShortcut(st.shortcut);
await refresh();
q.focus();

})();
