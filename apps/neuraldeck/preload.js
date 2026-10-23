"use strict";
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("deck", {
  query: (text) => ipcRenderer.invoke("deck:query", String(text)),
  run: (index) => ipcRenderer.invoke("deck:run", Number(index)),
  hide: () => ipcRenderer.send("deck:hide"),
  resize: (height) => ipcRenderer.send("deck:resize", Number(height)),
  state: () => ipcRenderer.invoke("deck:state"),
  capture: (on) => ipcRenderer.invoke("deck:capture", Boolean(on)),
  setShortcut: (accel) => ipcRenderer.invoke("deck:set-shortcut", String(accel)),
  onShown: (fn) => { ipcRenderer.on("deck:shown", (_e, s) => fn(s)); },
  onHidden: (fn) => { ipcRenderer.on("deck:hidden", () => fn()); },
  onTheme: (fn) => { ipcRenderer.on("deck:theme", (_e, t) => fn(String(t))); },
  onOpenSettings: (fn) => { ipcRenderer.on("deck:open-settings", () => fn()); },
});
