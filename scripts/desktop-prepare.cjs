// Keep resource preparation out of Electron's event loop. This window owns
// cancellation until the template takes over server/window lifetime.
const path = require('node:path');
const { Worker } = require('node:worker_threads');

function prepareDesktop({ app, BrowserWindow }, options, start, fail) {
  let worker, window;
  let cancelled = false, completed = false, quitting = false;
  const stop = () => {
    if (quitting) return;
    cancelled = true;
    quitting = true;
    // Keep the singleton lock until no worker can still write to the store.
    Promise.resolve(worker?.terminate()).finally(() => {
      app.removeListener('before-quit', beforeQuit);
      app.quit();
    });
  };
  const beforeQuit = (event) => { event.preventDefault(); stop(); };
  app.on('before-quit', beforeQuit);
  const failed = (error) => {
    if (cancelled || completed) return;
    completed = true;
    app.removeListener('before-quit', beforeQuit);
    fail(error);
  };
  app.whenReady().then(async () => {
    if (cancelled) return;
    window = new BrowserWindow({ width: 520, height: 240, resizable: false, title: 'translationCore4',
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    window.on('close', (event) => { if (!completed && !quitting) { event.preventDefault(); stop(); } });
    await window.loadFile(path.join(__dirname, 'tc4-preparing.html'));
    if (cancelled) return;
    worker = new Worker(path.join(__dirname, 'tc4-resource-worker.cjs'), { workerData: options });
    worker.on('error', failed);
    worker.on('exit', (code) => {
      if (!completed && !cancelled) failed(new Error(`Resource preparation stopped before completion (exit ${code})`));
    });
    worker.on('message', (message) => {
      if (cancelled || completed) return;
      if (message.type === 'progress') {
        const { completed: count, total } = message.progress;
        // The page is local, has no IPC bridge and shows counts only. No
        // resource names or remote strings are evaluated in the renderer.
        window.webContents.executeJavaScript(`document.getElementById('progress').textContent = ${JSON.stringify(`Preparing resources: ${count} of ${total}`)}`).catch(failed);
      } else if (message.type === 'done') {
        completed = true;
        app.removeListener('before-quit', beforeQuit);
        window.webContents.executeJavaScript("document.getElementById('progress').textContent = 'Starting…'").catch(() => {});
        // Keep a window alive through handoff, so window-all-closed cannot
        // make the template quit while it is starting its owned server.
        const handoff = (_event, next) => {
          if (next === window) return;
          next.once('ready-to-show', () => { if (!window.isDestroyed()) window.destroy(); });
          app.removeListener('browser-window-created', handoff);
        };
        app.on('browser-window-created', handoff);
        try { start(); } catch (error) { fail(error); }
      }
    });
  }).catch(failed);
}

module.exports = { prepareDesktop };
