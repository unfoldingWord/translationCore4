'use strict';

// tC4's Electron entry point. The packaging recipe copies this tracked source
// into the artifact as electron/tc4-main.js; it must run before the template's
// electronStartup.js so the template's free-port scan cannot create a second
// server over the same project store (D39).
const { app, BrowserWindow, ipcMain, safeStorage } = require('electron');
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

// The download report (#382, D80): the page cannot see whether the person saved
// a download or cancelled the save dialog, so the main process reports each
// download's result to the page that started it, on `download:done` (exposed
// by scripts/preload.cjs as `tc4Desktop.onDownloadDone`). The file name is the
// one the person saved under, else the suggested one. Each session is watched
// once: the hidden PDF window shares the main window's session.
const watchedSessions = new WeakSet();
function watchDownloads(session) {
  if (watchedSessions.has(session)) return;
  watchedSessions.add(session);
  session.on('will-download', (_event, item, webContents) => {
    item.once('done', (_done, state) => {
      const savePath = item.getSavePath();
      const filename = savePath ? path.basename(savePath) : item.getFilename();
      if (!webContents.isDestroyed()) webContents.send('download:done', { filename, state });
    });
  });
}

// The Door43 token in the operating-system keychain (#366, D85). The renderer's
// "Stay signed in" hands the token — the token only — over `token:keep`
// (exposed by scripts/preload.cjs as `tc4Desktop.keychain`); the next app
// session reads it back over `token:read`, and Sign out or a refused token
// clears it over `token:forget`. The bytes on disk are `safeStorage`'s
// ciphertext, which the operating system's keychain (macOS Keychain, Windows
// DPAPI, a Linux keyring) holds the key for; the file holds no clear text.
// Where `safeStorage` reports no encryption (a Linux desktop with no keyring:
// the basic_text backend is not turned on), nothing is written and the answer
// says why, so the token stays in renderer memory for the session and the
// app says so in one line (the conservative choice, D84 point 6).
const TOKEN_FILE = 'door43-token';
const tokenFile = () => path.join(app.getPath('userData'), TOKEN_FILE);
const NO_KEYCHAIN = 'this computer has no keychain the app can use';
const hasKeychain = () => safeStorage.isEncryptionAvailable()
  && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text');

function keepToken(_event, token) {
  if (typeof token !== 'string' || !token) return { kept: false, reason: 'no token was given' };
  if (!hasKeychain()) return { kept: false, reason: NO_KEYCHAIN };
  const file = tokenFile();
  const writing = `${file}.tc4-writing-${process.pid}`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(writing, safeStorage.encryptString(token), { mode: 0o600 });
  fs.renameSync(writing, file);
  return { kept: true };
}

function readToken() {
  const file = tokenFile();
  if (!fs.existsSync(file)) return { token: null };
  if (!hasKeychain()) return { token: null, reason: NO_KEYCHAIN };
  try {
    return { token: safeStorage.decryptString(fs.readFileSync(file)) };
  } catch (error) {
    // Bytes this keychain cannot open (another account's, or damaged): they
    // are no use to anyone, so they go.
    fs.rmSync(file, { force: true });
    return { token: null, reason: `the kept token could not be read: ${error.message}` };
  }
}

function forgetToken() {
  fs.rmSync(tokenFile(), { force: true });
  return { forgotten: true };
}

function start() {
  if (process.platform === 'win32') app.setAppUserModelId('org.unfoldingword.translationcore4');

  if (!app.requestSingleInstanceLock()) {
    app.quit(); // second copy: no window, no server, exit
    return;
  }

  // The PDF bridge on Linux (#451): Chromium's print compositor keeps the
  // printed PDF in /dev/shm, which is 64 MB in a Docker container by default.
  // The OBS PDF with pictures is about 48 MB, and printing it there failed with
  // "Printing failed". This switch moves that memory to the temporary directory.
  if (process.platform === 'linux') app.commandLine.appendSwitch('disable-dev-shm-usage');

  ipcMain.handle('export:pdf', printPdf);
  ipcMain.handle('token:keep', keepToken);
  ipcMain.handle('token:read', readToken);
  ipcMain.handle('token:forget', forgetToken);
  app.on('browser-window-created', (_event, win) => {
    watchDownloads(win.webContents.session);
    // #362: "Open on Door43" is a link with target=_blank; it opens in the
    // system browser, not in a second app window.
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url)) require('electron').shell.openExternal(url);
      return { action: 'deny' };
    });
  });

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
      // #284: a Windows copy whose server cannot load the VC++ runtime stops
      // here, with the prerequisite named, before any profile write and
      // before the template can show "The backend could not be started."
      const missingRuntime = bootstrap.missingWindowsServerRuntime(options);
      if (missingRuntime) {
        require('electron').dialog.showErrorBox('translationCore4 could not start', missingRuntime);
        app.exit(1);
        return;
      }
      // Bind the process and any existing profile before upstream startup
      // captures APP_RESOURCES_DIR. All platforms publish resource releases
      // and their install records under this same singleton lock (#528).
      bootstrap.bindPackagedResources(options);
      bootstrap.bootstrap(options);
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
