"use strict";
const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("vw", {
  // window
  minimize: () => ipcRenderer.send("vw:minimize"),
  toggleMaximize: () => ipcRenderer.send("vw:toggle-max"),
  setFull: (on) => ipcRenderer.send("vw:set-full", Boolean(on)),
  close: () => ipcRenderer.send("vw:close"),
  closeAck: () => ipcRenderer.send("vw:close-ack"),
  confirmClose: () => ipcRenderer.send("vw:close-confirm"),
  onCloseRequest: (fn) => { ipcRenderer.on("vw:close-request", () => fn()); },
  onMaximized: (fn) => { ipcRenderer.on("vw:maximized", (_e, on) => fn(Boolean(on))); },
  onFull: (fn) => { ipcRenderer.on("vw:full", (_e, on) => fn(Boolean(on))); },
  resizeStart: (edge) => ipcRenderer.send("vw:resize-start", String(edge)),
  resizeEnd: () => ipcRenderer.send("vw:resize-end"),
  // files
  onOpenPaths: (fn) => { ipcRenderer.on("vw:open-paths", (_e, paths) => fn(paths)); },
  pendingPaths: () => ipcRenderer.invoke("vw:pending-paths"),
  openDialog: (dir) => ipcRenderer.invoke("vw:open-dialog", String(dir || "")),
  list: (target) => ipcRenderer.invoke("vw:list", String(target)),
  watch: (dir) => ipcRenderer.send("vw:watch", String(dir || "")),
  onDirChanged: (fn) => { ipcRenderer.on("vw:dir-changed", (_e, dir) => fn(dir)); },
  meta: (p) => ipcRenderer.invoke("vw:meta", String(p)),
  copyImage: (png) => ipcRenderer.invoke("vw:copy-image", png),
  copyText: (text) => ipcRenderer.invoke("vw:copy-text", String(text)),
  trash: (p) => ipcRenderer.invoke("vw:trash", String(p)),
  rename: (p, name) => ipcRenderer.invoke("vw:rename", String(p), String(name)),
  showInNav: (p) => ipcRenderer.invoke("vw:show-in-nav", String(p)),
  hasNav: () => ipcRenderer.invoke("vw:has-nav"),
  saveRotation: (p, job) => ipcRenderer.invoke("vw:save-rotation", String(p), job),
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch (e) { return ""; } },
  // series theme
  themeInit: (theme, sync) => ipcRenderer.invoke("vw:theme-init", String(theme), Boolean(sync)),
  themeSet: (theme) => ipcRenderer.send("vw:theme-set", String(theme)),
  themeSync: (on, theme) => ipcRenderer.send("vw:theme-sync", Boolean(on), String(theme)),
  onThemeApply: (fn) => { ipcRenderer.on("vw:theme-apply", (_e, theme) => fn(String(theme))); },
  onThemeSyncState: (fn) => { ipcRenderer.on("vw:theme-sync-state", (_e, on) => fn(Boolean(on))); },
});
