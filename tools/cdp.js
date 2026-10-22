"use strict";
// Small Chrome DevTools Protocol client for driving the Neural apps in tests.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targets(port) {
  return (await (await fetch(`http://127.0.0.1:${port}/json`)).json());
}
async function waitTarget(port, match, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const t = (await targets(port)).find((x) => x.type === "page" && match(x));
      if (t) return t;
    } catch (e) { /* not up yet */ }
    await sleep(250);
  }
  throw new Error("target not found");
}
async function attach(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const waiting = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); } };
  const call = (method, params) => new Promise((res) => { const n = ++id; waiting.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });
  const evaluate = async (expr) => {
    const r = await call("Runtime.evaluate", { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) throw new Error((r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description) || r.result.exceptionDetails.text || "eval failed");
    if (r.error) throw new Error(r.error.message);
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  const key = async (key, code, vk, modifiers = 0, text) => {
    await call("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", key, code, windowsVirtualKeyCode: vk, modifiers, text });
    await call("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, modifiers });
  };
  const click = async (x, y, opts = {}) => {
    const base = { x, y, button: opts.button || "left", clickCount: opts.count || 1, modifiers: opts.modifiers || 0 };
    await call("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await call("Input.dispatchMouseEvent", { type: "mousePressed", ...base });
    await call("Input.dispatchMouseEvent", { type: "mouseReleased", ...base });
  };
  return { call, evaluate, key, click, close: () => ws.close(), target };
}
module.exports = { sleep, targets, waitTarget, attach };
