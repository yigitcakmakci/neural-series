"use strict";
const { contextBridge, ipcRenderer } = require("electron");

const on = (channel) => (fn) => { ipcRenderer.on(channel, (_e, payload) => fn(payload)); };

contextBridge.exposeInMainWorld("nt", {
  // window
  minimize: () => ipcRenderer.send("nt:minimize"),
  toggleMaximize: () => ipcRenderer.send("nt:toggle-max"),
  close: () => ipcRenderer.send("nt:close"),
  confirmClose: () => ipcRenderer.send("nt:close-confirm"),
  onCloseRequest: on("nt:close-request"),
  onMaximized: on("nt:maximized"),
  resizeStart: (edge) => ipcRenderer.send("nt:resize-start", String(edge)),
  resizeEnd: () => ipcRenderer.send("nt:resize-end"),
  newWindow: () => ipcRenderer.send("nt:new-window"),
  pendingDirs: () => ipcRenderer.invoke("nt:pending-dirs"),
  onOpenDirs: on("nt:open-dirs"),
  info: () => ipcRenderer.invoke("nt:info"),
  clipRead: () => ipcRenderer.invoke("nt:clip-read"),
  clipWrite: (text) => ipcRenderer.send("nt:clip-write", String(text)),
  // shells
  spawn: (id, shellId, cwd, cols, rows) => ipcRenderer.send("nt:spawn", String(id), String(shellId), String(cwd || ""), cols | 0, rows | 0),
  input: (id, text) => ipcRenderer.send("nt:input", String(id), String(text)),
  resize: (id, cols, rows) => ipcRenderer.send("nt:resize", String(id), cols | 0, rows | 0),
  kill: (id) => ipcRenderer.send("nt:kill", String(id)),
  onStarted: on("nt:started"),
  onData: on("nt:data"),
  onExit: on("nt:exit"),
});
