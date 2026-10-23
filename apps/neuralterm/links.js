/* ============================================================
   NeuralTerm — paths and web addresses in the output, for Ctrl+click
   Finds where they may sit on a line and which folder a relative path starts from. main.js decides which
   candidate paths exist; only those become links.
   ============================================================ */
'use strict';
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NeuralTermLinks = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const MAX_WORDS = 12; // a path with spaces in it may run this many words past its start
  const BARE_WORDS = 4; // and a plain word, tried as a name in the line's folder, this many
  const MAX_BARE = 30; // plain words tried on one line
  // Ends a path: characters Windows does not allow in names, quotes, backticks and control characters.
  const STOP = /[<>"'|?*`\u0000-\u001f]/;
  const TRAIL = /[.,;:!?)\]}]+$/;
  const PAIRS = { ')': '(', ']': '[', '}': '{' };
  const count = (s, ch) => s.split(ch).length - 1;

  function urls(text) {
    const out = [];
    const re = /\bhttps?:\/\/[^\s"'<>`]+/gi;
    let m;
    while ((m = re.exec(text))) {
      let s = m[0];
      // Sentence punctuation is not part of the address; a closing bracket is only when the address opened one.
      for (;;) {
        const t = s.replace(/[.,;:!?'"]+$/, '');
        if (t !== s) { s = t; continue; }
        const last = s[s.length - 1];
        if (PAIRS[last] && count(s, last) > count(s, PAIRS[last])) { s = s.slice(0, -1); continue; }
        break;
      }
      if (/^https?:\/\/[^/\s]/i.test(s)) out.push({ kind: 'url', start: m.index, end: m.index + s.length, target: s });
    }
    return out;
  }

  // Ways a path starting here may end: at each word end up to the first character no path can contain, each also
  // without trailing punctuation. main.js keeps the longest one that exists. A colon belongs only to a drive.
  function variants(text, start, maxWords, drive = false) {
    let end = start;
    while (end < text.length && !STOP.test(text[end]) && !(text[end] === ':' && !(drive && end === start + 1))) end++;
    const span = text.slice(start, end);
    const out = [];
    const add = (s) => {
      for (const t of [s, s.replace(TRAIL, '')]) {
        if (t && /[\p{L}\p{N}]/u.test(t) && !out.includes(t)) out.push(t);
      }
    };
    let words = 0;
    for (let j = 1; j <= span.length; j++) {
      if ((j === span.length || /\s/.test(span[j])) && !/\s/.test(span[j - 1])) {
        add(span.slice(0, j));
        if (++words >= maxWords) break;
      }
    }
    return out;
  }

  // Where a path may start: a drive (C:\ or C:/), a network share (\\server\), an explicit relative path (.\ or ..\),
  // or a plain word, which becomes a link only when it names something in the line's folder.
  function paths(text, taken = []) {
    const out = [];
    let bare = 0;
    for (let i = 0; i < text.length; i++) {
      if (taken.some((t) => i >= t.start && i < t.end)) continue;
      const prev = i ? text[i - 1] : ' ';
      const boundary = /[\s"'(=[,;]/.test(prev);
      let kind = null;
      const drive = /[A-Za-z]/.test(text[i]) && text[i + 1] === ':' && /[\\/]/.test(text[i + 2] || '') && !/[\p{L}\p{N}]/u.test(prev);
      if (drive) kind = 'abs';
      else if (text.startsWith('\\\\', i) && /[^\s\\]/.test(text[i + 2] || '') && prev !== '\\') kind = 'abs';
      else if (boundary && /^\.{1,2}[\\/]/.test(text.slice(i, i + 3))) kind = 'rel';
      else if (boundary && !/\s/.test(text[i]) && bare < MAX_BARE) { kind = 'bare'; bare++; }
      if (!kind) continue;
      const v = variants(text, i, kind === 'bare' ? BARE_WORDS : MAX_WORDS, drive).filter((s) => !/^\.+$/.test(s));
      if (v.length) out.push({ start: i, kind, variants: v });
    }
    return out;
  }

  function find(text) {
    const u = urls(text);
    return { urls: u, paths: paths(text, u) };
  }

  // The folder a relative path on a line refers to: the nearest prompt (PowerShell, Komut İstemi) or PowerShell
  // listing header at or above it. lines: the line itself first, then the ones above it.
  const BASES = [/^PS ([A-Za-z]:\\[^>]*)>/, /^([A-Za-z]:\\[^>]*)>/, /^\s*(?:Directory|Dizin)\s*:\s*([A-Za-z]:\\.*?)\s*$/];
  function baseDir(lines) {
    for (const line of lines) {
      for (const re of BASES) {
        const m = re.exec(line);
        if (m) return m[1];
      }
    }
    return null;
  }

  // hits[i]: { text, path, isDir } for the variant of candidate i that exists, or null. Earlier links win overlaps.
  function choose(cands, hits) {
    const links = [];
    let reach = -1;
    cands.forEach((c, i) => {
      const h = hits[i];
      if (!h || c.start < reach) return;
      links.push({ kind: 'path', start: c.start, end: c.start + h.text.length, target: h.path, isDir: !!h.isDir });
      reach = c.start + h.text.length;
    });
    return links;
  }

  return { find, urls, paths, variants, baseDir, choose };
});
