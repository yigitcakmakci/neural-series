/* ============================================================
   NeuralSnap — a pin. main.js sends the picture (PNG) and its starting zoom; the window is exactly the picture plus a
   margin for the shadow. Drag anywhere: move. Wheel: zoom 10–400 % around the cursor. Double-click or Esc: close.
   Right-click: Kopyala, Kaydet…, Düzenleyicide aç, Kapat (a menu of main.js).
   ============================================================ */
'use strict';
(() => {
const $ = (s) => document.querySelector(s);
const T = NeuralI18n.page(window);
const api = window.snapPin;
if (!api) return;
const pin = $('#pin'), img = $('#img'), chip = $('#zoom');
const P = new Intl.NumberFormat(T.locale, { style: 'percent', maximumFractionDigits: 0 });
let zoom = 1;
let natural = { w: 0, h: 0 };
let drag = null;
let chipTimer = 0;

api.onImage(({ png, w, h, zoom: z, margin }) => {
  natural = { w, h };
  zoom = z;
  document.documentElement.style.setProperty('--m', margin + 'px');
  img.onload = () => api.ready();
  img.src = URL.createObjectURL(new Blob([png], { type: 'image/png' }));
});

// Moving: the window follows the pointer in screen coordinates (it moves under it, so client coordinates would not do).
pin.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  drag = { sx: e.screenX, sy: e.screenY, wx: window.screenX, wy: window.screenY, moved: false };
  pin.setPointerCapture(e.pointerId);
});
pin.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.screenX - drag.sx, dy = e.screenY - drag.sy;
  if (!drag.moved && Math.hypot(dx, dy) < 2) return;
  drag.moved = true;
  api.moveTo(drag.wx + dx, drag.wy + dy);
});
const endDrag = () => { drag = null; };
pin.addEventListener('pointerup', endDrag);
pin.addEventListener('lostpointercapture', endDrag);
pin.addEventListener('dblclick', () => api.close());
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); api.close(); }
  else if (e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'c') { e.preventDefault(); api.act('copy'); }
});
addEventListener('contextmenu', (e) => { e.preventDefault(); api.menu(); });

function showZoom() {
  chip.textContent = P.format(zoom);
  chip.hidden = false;
  clearTimeout(chipTimer);
  chipTimer = setTimeout(() => { chip.hidden = true; }, 900);
}
addEventListener('wheel', async (e) => {
  e.preventDefault();
  const next = Math.max(0.1, Math.min(4, zoom * Math.exp(-e.deltaY / 500)));
  if (Math.abs(next - zoom) < 1e-4) return;
  zoom = next;
  const z = await api.zoom(zoom, e.clientX, e.clientY);
  if (Number.isFinite(z)) zoom = z;
  showZoom();
}, { passive: false });

// For the tests.
window.pinState = () => ({ zoom, natural, loaded: img.complete && img.naturalWidth > 0, shown: { w: img.naturalWidth, h: img.naturalHeight }, chip: chip.hidden ? '' : chip.textContent });
})();
