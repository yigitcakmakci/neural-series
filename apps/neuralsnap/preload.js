"use strict";
// The editor's bridge to main.js. Every channel is checked there against the sender (only the editor's own page).
const { contextBridge, ipcRenderer } = require("electron");

const on = (channel) => (fn) => { ipcRenderer.on(channel, (_e, payload) => fn(payload)); };

// The interface language (language.js): the texts once, before the page draws, and the series setting.
contextBridge.exposeInMainWorld("neuralLang", { ...ipcRenderer.sendSync("neural:lang"), set: (id) => ipcRenderer.invoke("neural:lang-set", String(id)) });
// New versions of the series (update-check.js): the switch and the newer version's page.
contextBridge.exposeInMainWorld("neuralUpdate", { state: () => ipcRenderer.invoke("neural:update-state"), set: (on) => ipcRenderer.invoke("neural:update-set", Boolean(on)), open: () => ipcRenderer.invoke("neural:update-open") });

contextBridge.exposeInMainWorld("snap", {
  // window
  minimize: () => ipcRenderer.send("snap:minimize"),
  toggleMaximize: () => ipcRenderer.send("snap:toggle-max"),
  close: () => ipcRenderer.send("snap:close"),
  onMaximized: on("snap:maximized"),
  resizeStart: (edge) => ipcRenderer.send("snap:resize-start", String(edge)),
  resizeEnd: () => ipcRenderer.send("snap:resize-end"),
  // the program: version, shortcut, settings, capture folder; state for the tests
  info: () => ipcRenderer.invoke("snap:info"),
  state: () => ipcRenderer.invoke("snap:state"),
  test: (cmd) => ipcRenderer.invoke("snap:test", String(cmd)),
  // pictures: a new capture, a picture to edit, the exported picture going out (copy, save, saveAs, view, pin)
  capture: () => ipcRenderer.invoke("snap:capture"),
  onOpen: on("snap:open"),
  exportAs: (kind, id, png, dirty) => ipcRenderer.invoke("snap:export", String(kind), Number(id), ArrayBuffer.isView(png) ? png : new Uint8Array(0), Boolean(dirty)),
  setDirty: (on) => ipcRenderer.send("snap:dirty", Boolean(on)),
  recent: () => ipcRenderer.invoke("snap:recent"),
  openFile: (p) => ipcRenderer.invoke("snap:open-file", String(p)),
  openFolder: () => ipcRenderer.invoke("snap:open-folder"),
  // settings
  set: (patch) => ipcRenderer.invoke("snap:set", { autoSave: patch && patch.autoSave, openEditor: patch && patch.openEditor }),
  recordShortcut: (on) => ipcRenderer.invoke("snap:shortcut-record", Boolean(on)),
  setShortcut: (accel) => ipcRenderer.invoke("snap:set-shortcut", String(accel)),
  onShortcut: on("snap:shortcut"),
  onOpenSettings: on("snap:open-settings"),
  // quitting with unsaved annotations: the page asks, then answers
  onConfirmQuit: on("snap:confirm-quit"),
  quitAnswer: (go) => ipcRenderer.send("snap:quit-answer", Boolean(go)),
  // series theme
  themeInit: (theme, sync) => ipcRenderer.invoke("snap:theme-init", String(theme), Boolean(sync)),
  themeSet: (theme) => ipcRenderer.send("snap:theme-set", String(theme)),
  themeSync: (on, theme) => ipcRenderer.send("snap:theme-sync", Boolean(on), String(theme)),
  onThemeApply: on("snap:theme-apply"),
  onThemeSyncState: on("snap:theme-sync-state"),
});
