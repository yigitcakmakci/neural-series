// The NeuralCalc KX-9 engine: lexer, parser/evaluator and number formatting, shared by NeuralCalc (a <script> tag,
// global NeuralCalcEngine) and NeuralDeck (require). Errors are CalcError with a code; ERR maps codes to the
// calculator's [hex code, message] pair. evaluate(src, { angle: "DEG" | "RAD", ans }) takes the calculator's own
// notation: × ÷ − √ π, "~" for a unary minus, "ANS", "E" for exponents (plain + - * / ^ ( ) % ! work too).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.NeuralCalcEngine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  class CalcError extends Error { constructor(code) { super(code); this.code = code; } }
  const fail = (code) => { throw new CalcError(code); };
  const ERR = {
    SYNTAX: ["0x01", "SÖZDİZİMİ HATASI"],
    DIV0: ["0x0D", "SIFIRA BÖLME"],
    COMPLEX: ["0x1C", "KARMAŞIK SONUÇ"],
    DOMAIN: ["0x2D", "TANIM DIŞI DEĞER"],
    UNDEF: ["0x3F", "TANIMSIZ"],
    FACT: ["0x4A", "n! YALNIZ DOĞAL SAYIDA"],
    OVERFLOW: ["0xFF", "TAŞMA"],
  };
  const OPS = { "−": "-", "~": "-", "×": "*", "÷": "/" };

  function lex(src) {
    const out = [];
    let i = 0;
    while (i < src.length) {
      const rest = src.slice(i);
      let m;
      if ((m = /^(?:\d+\.?\d*|\.\d+)(?:E[+\-−]?\d+)?/.exec(rest))) {
        out.push({ t: "num", v: parseFloat(m[0].replace("−", "-")) });
        i += m[0].length;
        continue;
      }
      if ((m = /^(sin|cos|tan|log|ln)/.exec(rest))) {
        out.push({ t: "fn", v: m[1] });
        i += m[1].length;
        continue;
      }
      if (rest.startsWith("ANS")) { out.push({ t: "ans" }); i += 3; continue; }
      const ch = src[i];
      if (ch === "√") out.push({ t: "fn", v: "sqrt" });
      else if (ch === "π") out.push({ t: "num", v: Math.PI });
      else if (ch === "e") out.push({ t: "num", v: Math.E });
      else if ("+-−~×*÷/^()%!".includes(ch)) out.push({ t: "op", v: OPS[ch] || ch });
      else if (ch !== " ") fail("SYNTAX");
      i++;
    }
    return out;
  }

  function evaluate(src, ctx) {
    const tk = lex(src);
    let p = 0;
    const isOp = (v) => tk[p] && tk[p].t === "op" && tk[p].v === v;
    const expect = (v) => { if (!isOp(v)) fail("SYNTAX"); p++; };
    const startsFactor = (t) => t && (t.t === "num" || t.t === "ans" || t.t === "fn" || (t.t === "op" && t.v === "("));
    const rad = (x) => (ctx.angle === "DEG" ? (x * Math.PI) / 180 : x);
    const snap = (x) => (Math.abs(x) < 1e-12 ? 0 : x);

    function fn(name, a) {
      switch (name) {
        case "sin": return snap(Math.sin(rad(a)));
        case "cos": return snap(Math.cos(rad(a)));
        case "tan": if (snap(Math.cos(rad(a))) === 0) fail("UNDEF"); return snap(Math.tan(rad(a)));
        case "sqrt": if (a < 0) fail("COMPLEX"); return Math.sqrt(a);
        case "log": if (a <= 0) fail("DOMAIN"); return Math.log10(a);
        case "ln": if (a <= 0) fail("DOMAIN"); return Math.log(a);
      }
      return fail("SYNTAX");
    }
    function fact(n) {
      const r = Math.round(n);
      if (n < 0 || Math.abs(n - r) > 1e-9) fail("FACT");
      if (r > 170) fail("OVERFLOW");
      let out = 1;
      for (let i = 2; i <= r; i++) out *= i;
      return out;
    }
    function primary() {
      const t = tk[p];
      if (!t) fail("SYNTAX");
      if (t.t === "num") { p++; return t.v; }
      if (t.t === "ans") { p++; return ctx.ans; }
      if (t.t === "fn") { p++; expect("("); const a = expr(); expect(")"); return fn(t.v, a); }
      if (isOp("(")) { p++; const a = expr(); expect(")"); return a; }
      return fail("SYNTAX");
    }
    // A trailing % is remembered so that "a + b%" can mean "a plus b percent of a".
    function postfix() {
      let v = primary();
      let pct = false;
      while (isOp("!") || isOp("%")) {
        if (tk[p++].v === "!") v = fact(v);
        else { v /= 100; pct = true; }
      }
      return { v, pct };
    }
    function power() {
      const base = postfix();
      if (!isOp("^")) return base;
      p++;
      return { v: Math.pow(base.v, unary().v), pct: false };
    }
    function unary() {
      if (isOp("-")) { p++; const r = unary(); return { v: -r.v, pct: r.pct }; }
      if (isOp("+")) { p++; return unary(); }
      return power();
    }
    function term() {
      let { v, pct } = unary();
      for (;;) {
        if (isOp("*") || isOp("/")) {
          const op = tk[p++].v;
          const r = unary().v;
          if (op === "/") { if (r === 0) fail("DIV0"); v /= r; } else v *= r;
        } else if (startsFactor(tk[p])) v *= unary().v;
        else break;
        pct = false;
      }
      return { v, pct };
    }
    function expr() {
      let v = term().v;
      while (isOp("+") || isOp("-")) {
        const op = tk[p++].v;
        const r = term();
        const rv = r.pct ? v * r.v : r.v;
        v = op === "+" ? v + rv : v - rv;
      }
      return v;
    }

    if (!tk.length) fail("SYNTAX");
    const v = expr();
    if (p < tk.length) fail("SYNTAX");
    if (Number.isNaN(v)) fail("DOMAIN");
    if (!Number.isFinite(v)) fail("OVERFLOW");
    return v;
  }

  function fmt(v) {
    if (Object.is(v, -0)) v = 0;
    const a = Math.abs(v);
    let s;
    if (a !== 0 && (a >= 1e15 || a < 1e-6)) {
      const [m, e] = v.toExponential(9).split("e");
      s = m.replace(/\.?0+$/, "") + "E" + (e[0] === "-" ? "−" : "+") + e.slice(1);
    } else if (Number.isInteger(v)) {
      s = String(v);
    } else {
      s = String(parseFloat(v.toPrecision(12)));
    }
    return s.replace("-", "−");
  }

  return { CalcError, ERR, fail, lex, evaluate, fmt };
});
