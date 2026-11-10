/* ============================================================
   Neural Series — interface text in the user's language
   t(key, vars) looks a text up in the program's language file (lang\tr.json, lang\en.json), fills {name}
   placeholders and picks a plural form ({ one, other }). apply(root) translates the data-i18n attributes of a page.
   UMD: main.js requires it, a page loads it with <script> and finds window.NeuralI18n.
   build.ps1 copies this file next to each program; from source a page loads ../shared/i18n.js.
   ============================================================ */
'use strict';
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NeuralI18n = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const LOCALES = { tr: 'tr-TR', en: 'en-GB' };

  // dict: { key: "text" | { one, other } }, already merged over Turkish by language.js.
  function create({ lang, dict }) {
    const code = LOCALES[lang] ? lang : 'tr';
    const words = dict || {};
    const plural = new Intl.PluralRules(LOCALES[code]);
    const fill = (s, vars) => String(s).replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] !== undefined ? String(vars[k]) : m));
    // A missing key comes back as itself, so it shows on screen and the tests find it.
    function t(key, vars) {
      let v = words[key];
      if (v === undefined) return key;
      if (v && typeof v === 'object') v = v[plural.select(Number(vars && vars.n) || 0)] ?? v.other;
      return fill(v, vars);
    }
    t.lang = code;
    t.locale = LOCALES[code];
    t.has = (key) => words[key] !== undefined;
    return t;
  }

  // Elements carry their key: data-i18n (text), data-i18n-title, data-i18n-placeholder, data-i18n-aria-label.
  // A key the texts do not have leaves the page's own (Turkish) text, e.g. NeuralCalc opened in a plain browser.
  const ATTRS = [['i18nTitle', 'title'], ['i18nPlaceholder', 'placeholder'], ['i18nAriaLabel', 'aria-label']];
  function apply(rootEl, t) {
    const sel = '[data-i18n],[data-i18n-title],[data-i18n-placeholder],[data-i18n-aria-label]';
    for (const el of rootEl.querySelectorAll(sel)) {
      if (el.dataset.i18n && t.has(el.dataset.i18n)) el.textContent = t(el.dataset.i18n);
      for (const [k, attr] of ATTRS) if (el.dataset[k] && t.has(el.dataset[k])) el.setAttribute(attr, t(el.dataset[k]));
    }
  }

  // In a page: the language main.js handed over through the preload (window.neuralLang = { lang, dict, languages, set }).
  function page(win) {
    const t = create(win.neuralLang || { lang: 'tr', dict: {} });
    win.document.documentElement.lang = t.lang;
    apply(win.document, t);
    return t;
  }

  // The choices of the "Dil · Language" menu. Picking one writes the series language, which shows from the next start
  // of each program; notify(note) gets the explanation, in the language picked.
  function languageChoices(win, notify) {
    const L = win.neuralLang || {};
    let chosen = L.lang;
    return () => (L.languages || []).map((l) => ({
      id: l.id,
      label: l.name,
      checked: () => chosen === l.id,
      pick: async () => {
        if (l.id === chosen) return;
        const note = await L.set(l.id);
        if (note) { chosen = l.id; notify(note); }
      },
    }));
  }

  // The update entries next to the language menu (update-check.js through the preload's window.neuralUpdate): the
  // series switch "check for new versions", and the newer version's page when one is known. Every part is a function,
  // so a menu built once still shows the current state.
  function updates(win, T) {
    const U = win.neuralUpdate;
    let s = { enabled: true, latest: null };
    const refresh = () => (U ? U.state().then((v) => { s = v; }, () => {}) : Promise.resolve());
    refresh();
    // A check made after the page loaded (in this program or another) shows when the window comes back to the front.
    win.addEventListener('focus', refresh);
    setInterval(refresh, 60e3);
    return {
      available: !!U,
      enabled: () => s.enabled,
      toggle: async () => { if (U) s = await U.set(!s.enabled); },
      latest: () => s.latest,
      latestLabel: () => (s.latest ? T('update.available', { version: s.latest.version }) : ''),
      open: () => { if (U) U.open(); },
      refresh,
    };
  }

  return { create, apply, page, languageChoices, updates, LOCALES };
});
