"use strict";
const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("np", {
  // window
  minimize: () => ipcRenderer.send("np:minimize"),
  toggleMaximize: () => ipcRenderer.send("np:toggle-max"),
  close: () => ipcRenderer.send("np:close"),
  closeAck: () => ipcRenderer.send("np:close-ack"),
  confirmClose: () => ipcRenderer.send("np:close-confirm"),
  onCloseRequest: (fn) => { ipcRenderer.on("np:close-request", () => fn()); },
  onMaximized: (fn) => { ipcRenderer.on("np:maximized", (_e, on) => fn(Boolean(on))); },
  resizeStart: (edge) => ipcRenderer.send("np:resize-start", String(edge)),
  resizeEnd: () => ipcRenderer.send("np:resize-end"),
  newWindow: () => ipcRenderer.send("np:new-window"),
  paste: () => ipcRenderer.send("np:paste"),
  // files
  onOpenFiles: (fn) => { ipcRenderer.on("np:open-files", (_e, paths) => fn(paths)); },
  pendingFiles: () => ipcRenderer.invoke("np:pending-files"),
  openDialog: (dir) => ipcRenderer.invoke("np:open-dialog", String(dir || "")),
  saveDialog: (suggested) => ipcRenderer.invoke("np:save-dialog", String(suggested || "")),
  readFile: (p) => ipcRenderer.invoke("np:read-file", String(p)),
  writeFile: (p, bytes) => ipcRenderer.invoke("np:write-file", String(p), bytes),
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch (e) { return ""; } },
  // session
  sessionLoad: () => ipcRenderer.invoke("np:session-load"),
  sessionSave: (data) => ipcRenderer.send("np:session-save", data),
  // series theme
  themeInit: (theme, sync) => ipcRenderer.invoke("np:theme-init", String(theme), Boolean(sync)),
  themeSet: (theme) => ipcRenderer.send("np:theme-set", String(theme)),
  themeSync: (on, theme) => ipcRenderer.send("np:theme-sync", Boolean(on), String(theme)),
  onThemeApply: (fn) => { ipcRenderer.on("np:theme-apply", (_e, theme) => fn(String(theme))); },
  onThemeSyncState: (fn) => { ipcRenderer.on("np:theme-sync-state", (_e, on) => fn(Boolean(on))); },
});
