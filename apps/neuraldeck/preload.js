"use strict";
const { contextBridge, ipcRenderer } = require("electron");

// The interface language (language.js): the texts once, before the page draws, and the series setting.
contextBridge.exposeInMainWorld("neuralLang", { ...ipcRenderer.sendSync("neural:lang"), set: (id) => ipcRenderer.invoke("neural:lang-set", String(id)) });
// New versions of the series (update-check.js): the switch and the newer version's page.
contextBridge.exposeInMainWorld("neuralUpdate", { state: () => ipcRenderer.invoke("neural:update-state"), set: (on) => ipcRenderer.invoke("neural:update-set", Boolean(on)), open: () => ipcRenderer.invoke("neural:update-open") });

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
  onRefresh: (fn) => { ipcRenderer.on("deck:refresh", () => fn()); }, // a measurement (cpu) came in: ask again
});
