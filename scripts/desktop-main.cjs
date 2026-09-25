'use strict';

// tC4's Electron entry point. The packaging recipe copies this tracked source
// into the artifact as electron/tc4-main.js; it must run before the template's
// electronStartup.js so the template's free-port scan cannot create a second
// server over the same project store (D39).
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

// The PDF bridge (#20, owner-approved 2026-09-24): the renderer's
// PDF export sends one print document; this prints it in a hidden window and
// returns the PDF bytes, with no print dialog. The document goes through a
// temporary file, not a data: URL, because Chromium caps a data: URL at 2 MB
// and a long book is larger. `preferCSSPageSize` lets the document's @page
// rule set the paper (A4 or Letter).
async function printPdf(_event, html) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc4-pdf-'));
  const file = path.join(dir, 'book.html');
  const win = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true } });
  try {
    fs.writeFileSync(file, String(html));
    await win.loadFile(file);
    return await win.webContents.printToPDF({ preferCSSPageSize: true });
  } finally {
    win.destroy();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function start() {
  if (process.platform === 'win32') app.setAppUserModelId('org.unfoldingword.translationcore4');

  if (!app.requestSingleInstanceLock()) {
    app.quit(); // second copy: no window, no server, exit
    return;
  }

  ipcMain.handle('export:pdf', printPdf);

  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  try {
    const bootstrap = require('./tc4-bootstrap.cjs');
    if (bootstrap.shouldBindPackagedResources(process.env.START_SERVER)) {
      const options = {
        ...require('./tc4-bootstrap.json'),
        resourcesDir: require('path').join(__dirname, '..'),
        home: require('os').homedir(),
      };
      // Bind the process and any existing profile before upstream startup
      // captures APP_RESOURCES_DIR. Linux keeps shell seeding; macOS and
      // Windows also perform their existing first-run copies here.
      bootstrap.bindPackagedResources(options);
      if (process.platform === 'darwin' || process.platform === 'win32') {
        bootstrap.bootstrap(options);
      }
    }
  } catch (error) {
    require('electron').dialog.showErrorBox(
      'translationCore4 could not start',
      'The bundled resources could not be prepared. Please quit and try again.\n' + error.message,
    );
    app.exit(1);
    return;
  }

  require('./electronStartup.js');
}

start();
