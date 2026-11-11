"use strict";
// The bridge of the capture overlay (overlay.html) and of the pins (pin.html). main.js checks every channel against
// the sender: an overlay's channels only work from an overlay, a pin's only from that pin.
const { contextBridge, ipcRenderer } = require("electron");

const on = (channel) => (fn) => { ipcRenderer.on(channel, (_e, payload) => fn(payload)); };
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : NaN);
const rect = (r) => (r ? { x: num(r.x), y: num(r.y), w: num(r.w), h: num(r.h) } : null);

// The interface language (language.js), read once before the page draws.
contextBridge.exposeInMainWorld("neuralLang", { ...ipcRenderer.sendSync("neural:lang") });

contextBridge.exposeInMainWorld("snapOverlay", {
  // main.js: the frozen picture of this display ({ seq, w, h, pixels, region, origin, windows }), then "shown", then
  // "reset" when the capture is over
  onFrame: on("ov:frame"),
  onShown: on("ov:shown"),
  onReset: on("ov:reset"),
  drawn: (seq) => ipcRenderer.send("ov:drawn", num(seq)),
  cleared: () => ipcRenderer.send("ov:cleared"),
  // the user's choice: kind "rect" | "window" | "display", rect in grab pixels
  pick: (seq, kind, r) => ipcRenderer.send("ov:pick", num(seq), String(kind), rect(r)),
  cancel: (seq) => ipcRenderer.send("ov:cancel", num(seq)),
  // tests: the program's state (an overlay exists even when NeuralSnap runs without a window)
  state: () => ipcRenderer.invoke("snap:state"),
  test: (cmd) => ipcRenderer.invoke("snap:test", String(cmd)),
});

contextBridge.exposeInMainWorld("snapPin", {
  onImage: on("pin:image"), // { png, w, h, zoom, margin }
  ready: () => ipcRenderer.send("pin:ready"),
  moveTo: (x, y) => ipcRenderer.send("pin:move-to", num(x), num(y)),
  zoom: (zoom, ax, ay) => ipcRenderer.invoke("pin:zoom", num(zoom), num(ax), num(ay)),
  close: () => ipcRenderer.send("pin:close"),
  menu: () => ipcRenderer.send("pin:menu"),
  act: (id) => ipcRenderer.invoke("pin:act", String(id)),
  state: () => ipcRenderer.invoke("snap:state"),
});
