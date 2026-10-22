"use strict";
// Bridge for NeuralWeb's own chrome: the window UI (ui/index.html) and the popup overlay (ui/popup.html).
const { contextBridge, ipcRenderer } = require("electron");

const EVENTS = new Set([
  "state", "bookmarks", "downloads", "hover", "find-result", "find-open", "focus-omnibox", "maximized", "fullscreen",
  "popup:picked", "popup:closed", "popup:render", "popup:update", "popup:clear", "theme", "star", "popup-state",
]);

contextBridge.exposeInMainWorld("nw", {
  on: (channel, fn) => { if (EVENTS.has(channel)) ipcRenderer.on(channel, (_e, payload) => fn(payload)); },
  // window UI
  cmd: (name, arg) => ipcRenderer.send("ui:cmd", String(name), arg),
  layout: (layout) => ipcRenderer.send("ui:layout", layout),
  resizeStart: (edge) => ipcRenderer.send("ui:resize-start", String(edge)),
  resizeEnd: () => ipcRenderer.send("ui:resize-end"),
  suggest: (text) => ipcRenderer.invoke("ui:suggest", String(text)),
  suggestRemote: (text) => ipcRenderer.invoke("ui:suggest-remote", String(text)),
  resolve: (text) => ipcRenderer.invoke("ui:resolve", String(text)),
  popup: (token, spec) => ipcRenderer.send("ui:popup", token, spec),
  popupUpdate: (data) => ipcRenderer.send("ui:popup-update", data),
  popupClose: () => ipcRenderer.send("ui:popup-close"),
  bookmarkOpen: (url, how) => ipcRenderer.send("ui:bookmark-open", String(url), String(how || "")),
  bookmark: (op, ...args) => ipcRenderer.invoke("ui:bookmark", String(op), ...args),
  // popup overlay
  measured: (id, size) => ipcRenderer.send("popup:measured", id, size),
  pick: (id, value, keepOpen) => ipcRenderer.send("popup:pick", id, value, !!keepOpen),
  dismiss: (id) => ipcRenderer.send("popup:dismiss", id),
});
