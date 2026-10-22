"use strict";
// The popup overlay: renders one popup at a time, reports its size so the view can be cut to fit,
// and sends the choice back. The main process decides where it goes and who gets the answer.
const rootEl = document.getElementById("root");
const H = document.documentElement;
let cur = null; // { id, kind, data, width, maxHeight, path, focusEl }
let autoTimer = 0;
const ICON = {
  globe: "M8 2a6 6 0 1 1 0 12A6 6 0 0 1 8 2zM2 8h12M8 2c-2.2 2.4-2.2 9.6 0 12M8 2c2.2 2.4 2.2 9.6 0 12",
  folder: "M2 4h4.5l1.5 1.5H14V13H2z",
  search: "M7 3a4 4 0 1 1 0 8a4 4 0 0 1 0-8zM10 10l3.5 3.5",
  clock: "M8 2.5a5.5 5.5 0 1 1 0 11a5.5 5.5 0 0 1 0-11zM8 5v3.2l2.2 1.4",
  star: "M8 2l1.8 3.9 4.2.5-3.1 2.9.8 4.2L8 11.4l-3.7 2.1.8-4.2L2 6.4l4.2-.5z",
  lock: "M4.5 7.5h7v5.5h-7zM6 7.5V5.5a2 2 0 0 1 4 0v2",
  warn: "M8 2.5l6 11H2zM8 6.5v3.5M8 11.5v.5",
  file: "M4 2.5h5l3 3v8H4zM9 2.5v3h3",
  full: "M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10",
  pause: "M5.5 3.5v9M10.5 3.5v9",
  play: "M5 3l8 5-8 5z",
  x: "M4 4l8 8M12 4l-8 8",
  retry: "M13 4.5V8h-3.5M12.6 7.6A5 5 0 1 0 11 11.6",
  dir: "M2 4h4.5l1.5 1.5H14V13H2zM8 7.5v4M6 9.5l2 2 2-2",
};
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
function icon(d) {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 16 16");
  s.setAttribute("aria-hidden", "true");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", d);
  s.append(p);
  return s;
}
function picture(src) {
  if (!src || src === "globe") return icon(ICON.globe);
  if (src === "folder") return icon(ICON.folder);
  const img = el("img");
  img.alt = "";
  img.src = src;
  img.addEventListener("error", () => img.replaceWith(icon(ICON.globe)), { once: true });
  return img;
}
const pick = (value, keepOpen) => { if (cur) nw.pick(cur.id, value, keepOpen); };
function applyTheme(theme, priv) {
  H.className = `theme-${theme || "neon"}${priv ? " private" : ""}`;
}

nw.on("popup:render", (p) => {
  clearTimeout(autoTimer);
  cur = { ...p, path: [] };
  applyTheme(p.theme, p.priv);
  render();
});
nw.on("popup:update", ({ id, data }) => {
  if (!cur || cur.id !== id) return;
  if (cur.kind === "menu" && data && !data.items) {
    const z = rootEl.querySelector(".zoom-val");
    if (z && data.zoom != null) z.textContent = `%${data.zoom}`;
    return;
  }
  cur.data = data;
  render(true);
});
nw.on("popup:clear", () => { cur = null; clearTimeout(autoTimer); rootEl.replaceChildren(); });
nw.on("theme", (t) => applyTheme(t, cur && cur.priv));
// Clicking anywhere outside closes the popup.
window.addEventListener("blur", () => { if (cur) nw.dismiss(cur.id); });

function render(isUpdate) {
  const keepFocus = isUpdate && document.activeElement && document.activeElement.dataset.key;
  rootEl.style.width = "";
  rootEl.style.setProperty("--maxh", `${cur.maxHeight || 600}px`);
  const box = el("div", `pop pop-${cur.kind}`);
  const inner = el("div", "pop-inner");
  box.append(inner);
  cur.focusEl = null;
  BUILD[cur.kind](inner, cur.data || {});
  rootEl.replaceChildren(box);
  if (keepFocus) {
    const again = rootEl.querySelector(`[data-key="${CSS.escape(keepFocus)}"]`);
    if (again) again.focus();
  } else if (cur.focusEl) cur.focusEl.focus();
  measure(cur.id);
}
async function measure(id) {
  await document.fonts.ready;
  if (!cur || cur.id !== id) return;
  if (cur.width) rootEl.style.width = `${cur.width}px`;
  const r = rootEl.getBoundingClientRect();
  nw.measured(id, { width: Math.ceil(r.width), height: Math.ceil(r.height) });
}

const BUILD = {};

/* ---------- menus, with submenus opened in place ---------- */
function menuLevel() {
  let items = cur.data.items || [];
  const trail = [];
  for (const i of cur.path) {
    const it = items[i];
    if (!it || !it.sub) { cur.path = []; return { items: cur.data.items || [], trail: [] }; }
    trail.push(it.label);
    items = it.sub;
  }
  return { items, trail };
}
BUILD.menu = (inner) => {
  const { items, trail } = menuLevel();
  const box = el("div", "menu");
  box.setAttribute("role", "menu");
  if (trail.length) {
    const back = el("button", "mi back");
    back.type = "button";
    back.dataset.key = "back";
    back.append(el("span", "ic", "‹"), el("span", "l", trail[trail.length - 1]), el("span"), el("span"));
    back.addEventListener("click", () => { cur.path.pop(); render(); });
    box.append(back, el("hr", "sep"));
  }
  items.forEach((it, i) => {
    if (it === "-") { box.append(el("hr", "sep")); return; }
    if (it.type === "zoom") {
      const row = el("div", "zoom-row");
      const zb = (label, value, keep, title) => {
        const b = el("button", "zbtn");
        b.type = "button";
        b.title = title;
        b.dataset.key = value;
        if (value === "zoom:full") b.append(icon(ICON.full)); else b.textContent = label;
        b.addEventListener("click", () => pick(value, keep));
        return b;
      };
      row.append(el("span"), el("span", "l", it.label), zb("−", "zoom:out", true, "Uzaklaştır (Ctrl+-)"), el("span", "zoom-val", `%${it.zoom}`), zb("+", "zoom:in", true, "Yakınlaştır (Ctrl++)"), el("span"), zb("", "zoom:full", false, "Tam ekran (F11)"));
      box.append(row);
      return;
    }
    const b = el("button", "mi" + (it.danger ? " danger" : ""));
    b.type = "button";
    b.setAttribute("role", "menuitem");
    b.dataset.key = it.id || `sub${i}`;
    b.disabled = !!it.disabled;
    const ic = el("span", "ic");
    if (it.checked) ic.textContent = "✓";
    else if (it.icon) ic.append(picture(it.icon));
    b.append(ic, el("span", "l", it.label), el("span", "k", it.key || ""), el("span", "arr", it.sub ? "›" : ""));
    b.addEventListener("click", () => {
      if (it.sub) { cur.path.push(i); render(); const first = rootEl.querySelector(".mi:not(.back):not(:disabled)"); if (first) first.focus(); }
      else if (it.id) pick(it.id);
    });
    box.append(b);
  });
  inner.append(box);
};
document.addEventListener("keydown", (e) => {
  if (!cur || cur.kind !== "menu") return;
  const items = [...rootEl.querySelectorAll(".mi:not(:disabled)")];
  const at = items.indexOf(document.activeElement);
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    if (!items.length) return;
    const step = e.key === "ArrowDown" ? 1 : -1;
    items[at < 0 ? (step > 0 ? 0 : items.length - 1) : (at + step + items.length) % items.length].focus();
  } else if (e.key === "Home" || e.key === "End") {
    e.preventDefault();
    if (items.length) items[e.key === "Home" ? 0 : items.length - 1].focus();
  } else if (e.key === "ArrowRight" && at >= 0 && items[at].querySelector(".arr").textContent) {
    e.preventDefault();
    items[at].click();
  } else if ((e.key === "ArrowLeft" || e.key === "Backspace") && cur.path.length) {
    e.preventDefault();
    cur.path.pop();
    render();
    const first = rootEl.querySelector(".mi:not(.back):not(:disabled)");
    if (first) first.focus();
  }
});

/* ---------- address bar suggestions (the bar keeps the keyboard) ---------- */
BUILD.suggest = (inner, d) => {
  const list = el("div", "suggest");
  (d.items || []).forEach((it, i) => {
    const row = el("div", "si" + (i === d.sel ? " sel" : ""));
    row.append(icon(it.kind === "search" ? ICON.search : it.kind === "bookmark" ? ICON.star : it.kind === "history" ? ICON.clock : ICON.globe));
    const t = el("span", "t");
    t.append(el("span", "main", it.main));
    if (it.sub) t.append(el("span", "sub", it.sub));
    row.append(t);
    row.addEventListener("mousedown", (e) => { e.preventDefault(); if (e.button === 0) pick(i); });
    list.append(row);
  });
  inner.append(list);
};

/* ---------- prompts: permissions, sign-in, leave page, bookmark editing ---------- */
BUILD.prompt = (inner, d) => {
  const form = el("form", "prompt");
  form.append(el("div", "head", d.title || "NeuralWeb"));
  if (d.text) form.append(el("div", "p-text", d.text));
  const values = {};
  const getters = {};
  for (const f of d.fields || []) {
    const lab = el("label", "p-field");
    lab.append(el("span", "p-label", f.label));
    if (f.type === "select") {
      values[f.id] = f.value;
      const btn = el("button", "p-select");
      btn.type = "button";
      const label = () => { const o = f.options.find((x) => x.value === values[f.id]); return o ? o.label.replace(/^(· )+/, "") : ""; };
      btn.append(el("span", null, label()));
      const list = el("div", "p-options");
      list.hidden = true;
      for (const o of f.options) {
        const ob = el("button", "p-opt" + (o.value === values[f.id] ? " on" : ""), o.label);
        ob.type = "button";
        ob.addEventListener("click", () => {
          values[f.id] = o.value;
          btn.firstChild.textContent = label();
          for (const x of list.children) x.classList.toggle("on", x === ob);
          list.hidden = true;
          btn.focus();
          measure(cur.id);
        });
        list.append(ob);
      }
      btn.addEventListener("click", () => { list.hidden = !list.hidden; measure(cur.id); if (!list.hidden) (list.querySelector(".on") || list.firstChild).focus(); });
      lab.append(btn, list);
      getters[f.id] = () => values[f.id];
      if (!cur.focusEl) cur.focusEl = btn;
    } else {
      const inp = el("input");
      inp.type = f.type === "password" ? "password" : "text";
      inp.value = f.value || "";
      inp.spellcheck = false;
      inp.autocomplete = "off";
      lab.append(inp);
      getters[f.id] = () => inp.value;
      if (!cur.focusEl) cur.focusEl = inp;
    }
    form.append(lab);
  }
  const answer = (button) => {
    if (d.fields) {
      const vals = {};
      for (const [k, g] of Object.entries(getters)) vals[k] = g();
      pick({ button, values: vals });
    } else pick(button);
  };
  const btns = el("div", "p-btns");
  const buttons = d.buttons || [{ id: "ok", label: "Tamam", primary: true }];
  const primary = buttons.find((b) => b.primary) || buttons[buttons.length - 1];
  for (const b of buttons) {
    const btn = el("button", "btn" + (b.primary ? " primary" : b.danger ? " danger" : ""), b.label);
    btn.type = "button";
    btn.addEventListener("click", () => answer(b.id));
    btns.append(btn);
    if (b === primary && !d.fields) cur.focusEl = btn;
  }
  form.append(btns);
  form.addEventListener("submit", (e) => { e.preventDefault(); answer(primary.id); });
  form.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.tagName === "INPUT") { e.preventDefault(); answer(primary.id); }
  });
  inner.append(form);
};

/* ---------- downloads ---------- */
const speeds = new Map();
function size(n) {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toLocaleString("tr-TR", { maximumFractionDigits: n < 10 && i ? 1 : 0 })} ${u[i]}`;
}
function speedOf(it) {
  const now = Date.now();
  const prev = speeds.get(it.id);
  let v = prev ? prev.v : 0;
  if (prev && now - prev.t > 200) v = prev.v * 0.6 + ((it.received - prev.b) / ((now - prev.t) / 1000)) * 0.4;
  if (!prev || now - prev.t > 200) speeds.set(it.id, { t: now, b: it.received, v });
  return v;
}
function statusOf(it) {
  switch (it.state) {
    case "progressing": {
      const v = speedOf(it);
      const left = it.total && v > 0 ? Math.max(1, Math.round((it.total - it.received) / v)) : 0;
      const eta = left ? (left > 90 ? ` · ${Math.round(left / 60)} dk kaldı` : ` · ${left} sn kaldı`) : "";
      return `${size(it.received)}${it.total ? " / " + size(it.total) : ""}${v > 0 ? ` · ${size(v)}/sn` : ""}${eta}`;
    }
    case "paused": return `Duraklatıldı · ${size(it.received)}${it.total ? " / " + size(it.total) : ""}`;
    case "completed": return `${size(it.total || it.received)} · Tamamlandı`;
    case "cancelled": return "İptal edildi";
    default: return "Başarısız oldu";
  }
}
function iconButton(d, title, onClick, cls = "") {
  const b = el("button", "ib " + cls);
  b.type = "button";
  b.title = title;
  b.setAttribute("aria-label", title);
  b.dataset.key = title + d.length;
  b.append(icon(d));
  b.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
  return b;
}
BUILD.downloads = (inner, d) => {
  const box = el("div", "dl");
  box.append(el("div", "head", d.active ? `İndiriliyor · ${d.active}` : "İndirilenler"));
  const list = el("div", "dl-list");
  if (!d.recent || !d.recent.length) list.append(el("div", "dl-empty", "Henüz indirilen dosya yok."));
  for (const it of d.recent || []) {
    const live = it.state === "progressing" || it.state === "paused";
    const bad = it.state === "cancelled" || it.state === "interrupted";
    const row = el("div", "dl-row" + (it.state === "completed" ? " done" : "") + (bad ? " bad" : "") + (it.state === "paused" ? " paused" : ""));
    const ext = (it.filename.match(/\.([a-z0-9]{1,5})$/i) || [, "dosya"])[1];
    row.append(el("div", "dl-ic", ext));
    const mid = el("div");
    mid.append(el("div", "dl-name", it.filename), el("div", "dl-status", statusOf(it)));
    if (live) {
      const bar = el("div", "dl-bar" + (!it.total ? " unknown" : ""));
      const fill = el("i");
      fill.style.width = it.total ? `${Math.min(100, (it.received / it.total) * 100)}%` : "30%";
      bar.append(fill);
      mid.append(bar);
    }
    const acts = el("div", "dl-acts");
    const act = (action) => () => pick({ action, id: it.id }, action !== "open");
    if (it.state === "progressing") acts.append(iconButton(ICON.pause, "Duraklat", act("pause")), iconButton(ICON.x, "İptal et", act("cancel"), "x"));
    else if (it.state === "paused") acts.append(iconButton(ICON.play, "Devam et", act("resume")), iconButton(ICON.x, "İptal et", act("cancel"), "x"));
    else if (it.state === "completed") acts.append(iconButton(ICON.dir, "Klasörde göster", () => pick({ action: "show", id: it.id })));
    else acts.append(iconButton(ICON.retry, "Yeniden dene", act("retry")), iconButton(ICON.x, "Listeden kaldır", act("remove"), "x"));
    row.append(mid, acts);
    if (it.state === "completed") { row.title = "Dosyayı aç"; row.addEventListener("click", () => pick({ action: "open", id: it.id })); }
    list.append(row);
  }
  box.append(list);
  const foot = el("div", "foot");
  const all = el("button", "btn", "Tüm indirilenler");
  all.type = "button";
  all.dataset.key = "all";
  all.addEventListener("click", () => pick({ action: "all" }));
  foot.append(all);
  box.append(foot);
  inner.append(box);
  // Opened by a new download without taking the keyboard: it goes away by itself unless the pointer is on it.
  if (d.autoClose && !autoTimer) {
    const arm = () => { clearTimeout(autoTimer); autoTimer = setTimeout(() => { if (cur && cur.kind === "downloads") nw.dismiss(cur.id); }, 5000); };
    rootEl.onmouseenter = () => clearTimeout(autoTimer);
    rootEl.onmouseleave = arm;
    arm();
  }
};

/* ---------- site info ---------- */
BUILD.siteinfo = (inner, d) => {
  const box = el("div", "site");
  box.append(el("div", "head", d.host || "Site bilgileri"));
  const sec = el("div", "site-sec " + (d.security || ""));
  sec.append(icon(d.security === "secure" ? ICON.lock : d.security === "insecure" ? ICON.warn : d.security === "file" ? ICON.file : ICON.globe), el("div", "st", d.title));
  if (d.text) sec.append(el("div", "tx", d.text));
  box.append(sec);
  if (d.origin && /^https?:/.test(d.origin)) {
    box.append(el("div", "site-h", "İzinler"));
    if (!d.perms || !d.perms.length) box.append(el("div", "site-none", "Bu site için kaydedilmiş izin yok."));
    for (const p of d.perms || []) {
      const row = el("div", "perm");
      row.append(el("span", null, p.label), el("span", "v" + (p.value === "block" ? " block" : ""), p.value === "allow" ? "İZİN VERİLDİ" : "ENGELLENDİ"));
      const reset = el("button", "btn", "Sıfırla");
      reset.type = "button";
      reset.dataset.key = "reset-" + p.perm;
      reset.addEventListener("click", () => pick({ action: "reset", perm: p.perm }, true));
      row.append(reset);
      box.append(row);
    }
  }
  const foot = el("div", "foot");
  const set = el("button", "btn", "Site ayarları");
  set.type = "button";
  set.addEventListener("click", () => pick({ action: "settings" }));
  foot.append(set);
  box.append(foot);
  inner.append(box);
};

/* ---------- shield: what was blocked on this page, and the per-site switch ---------- */
BUILD.shield = (inner, d) => {
  const state = !d.enabled ? "off" : !d.web ? "na" : d.siteOff ? "site" : "on";
  const box = el("div", "shield " + state);
  box.append(el("div", "head", d.host ? `Kalkan · ${d.host}` : "Kalkan"));
  const big = el("div", "sh-big");
  const ic = icon("M8 1.8l5 1.9v4c0 3.2-2.1 5.4-5 6.5-2.9-1.1-5-3.3-5-6.5v-4z");
  big.append(ic);
  const txt = el("div", "sh-txt");
  if (state === "on") {
    txt.append(el("b", "sh-num", d.count.toLocaleString("tr-TR")), el("span", null, d.count === 1 ? "reklam ya da izleyici isteği bu sayfada engellendi" : "reklam ve izleyici isteği bu sayfada engellendi"));
  } else {
    txt.append(el("b", "sh-state", state === "site" ? "Bu sitede kapalı" : state === "off" ? "Kalkan kapalı" : "Bu sayfada çalışmaz"),
      el("span", null, state === "site" ? "Bu sitedeki reklamlar ve izleyiciler yükleniyor." : state === "off" ? "Hiçbir sitede reklam ve izleyici engellenmiyor." : "Kalkan yalnızca web sitelerinde çalışır."));
  }
  big.append(txt);
  box.append(big);
  if (d.enabled && !d.ready) box.append(el("div", "sh-note", d.updating ? "Engelleme listeleri indiriliyor…" : "Engelleme listeleri henüz yüklenmedi."));
  if (state === "on" || state === "site") {
    const row = el("button", "sh-switch");
    row.type = "button";
    row.dataset.key = "site";
    row.setAttribute("role", "switch");
    row.setAttribute("aria-checked", String(state === "on"));
    row.append(el("span", "sh-l", "Bu sitede kalkan"), el("span", "sh-sw"));
    row.addEventListener("click", () => pick({ action: "site", on: state !== "on" }, true));
    box.append(row);
    if (d.pending) box.append(el("div", "sh-note", "Panel kapanınca sayfa yenilenip değişiklik uygulanır."));
  }
  if (state === "on" && d.hosts && d.hosts.length) {
    box.append(el("div", "site-h", "En çok engellenenler"));
    const list = el("div", "sh-hosts");
    for (const h of d.hosts) {
      const r = el("div", "sh-host");
      r.append(el("span", "h", h.host), el("span", "n", h.n.toLocaleString("tr-TR")));
      list.append(r);
    }
    box.append(list);
  }
  const foot = el("div", "foot");
  if (!d.enabled) {
    const on = el("button", "btn primary", "Kalkanı aç");
    on.type = "button";
    on.dataset.key = "global";
    on.addEventListener("click", () => pick({ action: "global", on: true }, true));
    foot.append(on);
  }
  if (d.today && !d.priv) foot.prepend(el("span", "sh-today", `Bugün toplam ${d.today.toLocaleString("tr-TR")}`));
  const set = el("button", "btn", "Kalkan ayarları");
  set.type = "button";
  set.addEventListener("click", () => pick({ action: "settings" }));
  foot.append(set);
  box.append(foot);
  inner.append(box);
};

/* ---------- saved accounts under a login box (the page keeps the keyboard) ---------- */
BUILD.accounts = (inner, d) => {
  const box = el("div", "accounts");
  box.append(el("div", "acc-head", `Kayıtlı hesaplar · ${d.host}`));
  (d.items || []).forEach((it, i) => {
    const row = el("div", "acc" + (i === d.sel ? " sel" : ""));
    row.append(icon("M10.5 2.5a3 3 0 1 1-2.6 4.5L3 11.9V13.5h1.6v-1.2h1.2V11h1.2l1.4-1.4A3 3 0 0 1 10.5 2.5zM11 5h.01"), el("span", "u", it.username || "(kullanıcı adı yok)"), el("span", "m", "••••••••"));
    row.addEventListener("mousedown", (e) => { e.preventDefault(); if (e.button === 0) pick(it.id); });
    box.append(row);
  });
  const manage = el("div", "acc acc-manage", "Şifreleri yönet…");
  manage.addEventListener("mousedown", (e) => { e.preventDefault(); if (e.button === 0) pick("manage"); });
  box.append(manage);
  inner.append(box);
};
