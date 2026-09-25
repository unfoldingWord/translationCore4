'use strict';

// tC4's Electron preload. The packaging recipe copies this tracked source over
// the template's electron/preload.js (#20). It exposes only what the tC4 client
// calls: `electronAPI.setCanClose`, the unsaved-work close guard
// (src/state.jsx), unchanged from the template; and `tc4Desktop.printPdf`, the
// PDF bridge of src/data/export/pdf.ts, answered by `export:pdf` in
// scripts/desktop-main.cjs. The template's Firefox, FFmpeg and PDF-publisher
// members are left out: the tC4 client is the only client packaged, and it
// calls none of them.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  setCanClose: (canClose) => ipcRenderer.send('setCanClose', canClose),
});

contextBridge.exposeInMainWorld('tc4Desktop', {
  printPdf: (html) => ipcRenderer.invoke('export:pdf', html),
});
