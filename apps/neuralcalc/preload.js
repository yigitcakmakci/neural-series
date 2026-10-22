"use strict";
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("kx9", {
  minimize: () => ipcRenderer.send("kx9:minimize"),
  close: () => ipcRenderer.send("kx9:close"),
  fit: (w, h) => ipcRenderer.send("kx9:fit", Number(w), Number(h)),
  passThrough: (on) => ipcRenderer.send("kx9:pass", Boolean(on)),
});
