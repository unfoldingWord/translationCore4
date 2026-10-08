'use strict';

// tC4's Electron preload. The packaging recipe copies this tracked source over
// the template's electron/preload.js (#20). It exposes only what the tC4 client
// calls: `electronAPI.setCanClose`, the unsaved-work close guard
// (src/state.jsx), unchanged from the template; `tc4Desktop.printPdf`, the PDF
// bridge of src/data/export/pdf.ts, answered by `export:pdf` in
// scripts/desktop-main.cjs; and `tc4Desktop.onDownloadDone`, the download
// report of src/views/ExportMenu.jsx (#382), fed by `download:done` in the same
// file, which returns the function that removes the listener; and
// `tc4Desktop.keychain`, the Door43 token's keep/read/forget of
// src/data/share/keychain.ts (#366, D85), answered by `token:keep`,
// `token:read` and `token:forget` in the same file through Electron's
// `safeStorage`. The token is the only thing that crosses this bridge, and
// nothing else about the person; and `tc4Desktop.feedback.send`, the help-desk
// report of the Feedback dialog (#378), answered by `feedback:send` in the same
// file, which sends it and returns the result. The template's Firefox, FFmpeg and
// PDF-publisher members are left out: the tC4 client is the only client
// packaged, and it calls none of them.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  setCanClose: (canClose) => ipcRenderer.send('setCanClose', canClose),
});

contextBridge.exposeInMainWorld('tc4Desktop', {
  printPdf: (html) => ipcRenderer.invoke('export:pdf', html),
  onDownloadDone: (listener) => {
    const relay = (_event, result) => listener(result);
    ipcRenderer.on('download:done', relay);
    return () => ipcRenderer.removeListener('download:done', relay);
  },
  keychain: {
    keep: (token) => ipcRenderer.invoke('token:keep', token),
    read: () => ipcRenderer.invoke('token:read'),
    forget: () => ipcRenderer.invoke('token:forget'),
  },
  feedback: {
    send: (report) => ipcRenderer.invoke('feedback:send', report),
  },
});
