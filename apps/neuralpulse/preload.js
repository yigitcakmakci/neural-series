"use strict";
const { contextBridge, ipcRenderer } = require("electron");

const on = (channel) => (fn) => { ipcRenderer.on(channel, (_e, payload) => fn(payload)); };

// The interface language (language.js): the texts once, before the page draws, and the series setting.
contextBridge.exposeInMainWorld("neuralLang", { ...ipcRenderer.sendSync("neural:lang"), set: (id) => ipcRenderer.invoke("neural:lang-set", String(id)) });
// New versions of the series (update-check.js): the switch and the newer version's page.
contextBridge.exposeInMainWorld("neuralUpdate", { state: () => ipcRenderer.invoke("neural:update-state"), set: (on) => ipcRenderer.invoke("neural:update-set", Boolean(on)), open: () => ipcRenderer.invoke("neural:update-open") });

contextBridge.exposeInMainWorld("np", {
  // window
  minimize: () => ipcRenderer.send("np:minimize"),
  toggleMaximize: () => ipcRenderer.send("np:toggle-max"),
  close: () => ipcRenderer.send("np:close"),
  onMaximized: on("np:maximized"),
  resizeStart: (edge) => ipcRenderer.send("np:resize-start", String(edge)),
  resizeEnd: () => ipcRenderer.send("np:resize-end"),
  // measurements: what is known so far, then one sample a second; the helper's state (running, paused, error)
  info: () => ipcRenderer.invoke("np:info"),
  state: () => ipcRenderer.invoke("np:state"),
  onSample: on("np:sample"),
  onSensor: on("np:sensor"),
  // processes
  endProcess: (pid, name) => ipcRenderer.invoke("np:end", Number(pid), String(name)),
  openLocation: (p) => ipcRenderer.invoke("np:open-location", String(p)),
  clipWrite: (text) => ipcRenderer.send("np:clip-write", String(text)),
  // series theme
  themeInit: (theme, sync) => ipcRenderer.invoke("np:theme-init", String(theme), Boolean(sync)),
  themeSet: (theme) => ipcRenderer.send("np:theme-set", String(theme)),
  themeSync: (on, theme) => ipcRenderer.send("np:theme-sync", Boolean(on), String(theme)),
  onThemeApply: on("np:theme-apply"),
  onThemeSyncState: on("np:theme-sync-state"),
});
