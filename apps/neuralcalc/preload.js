"use strict";
const { contextBridge, ipcRenderer } = require("electron");

// The interface language (language.js): the texts once, before the page draws, and the series setting.
contextBridge.exposeInMainWorld("neuralLang", { ...ipcRenderer.sendSync("neural:lang"), set: (id) => ipcRenderer.invoke("neural:lang-set", String(id)) });

contextBridge.exposeInMainWorld("kx9", {
  minimize: () => ipcRenderer.send("kx9:minimize"),
  close: () => ipcRenderer.send("kx9:close"),
  fit: (w, h) => ipcRenderer.send("kx9:fit", Number(w), Number(h)),
  passThrough: (on) => ipcRenderer.send("kx9:pass", Boolean(on)),
});
