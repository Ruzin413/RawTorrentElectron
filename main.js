const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const { spawn } = require('child_process');

let mainWindow;
let backendProcess;
let backendPort = 5000;
let backendRestarts = 0;
let isQuitting = false;

// Single instance lock to handle magnet protocol links on Windows/Linux
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      const magnet = commandLine.find(arg => arg.startsWith('magnet:'));
      if (magnet) sendMagnetUri(magnet);
    }
  });
}

// ─── Settings (theme) ───
const THEMES = ['light', 'dark', 'system'];
const PROJECT_URL = 'https://github.com/Ruzin413/RawTorrentDesktop';

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
  } catch {
    return {};
  }
}

function writeSettings(settings) {
  try {
    fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error('Could not save settings:', err);
  }
}

// Colors matching the toolbar (--bg-surface) in each theme
function themeColors() {
  return nativeTheme.shouldUseDarkColors
    ? { overlay: '#0f172a', symbol: '#cbd5e1', background: '#0b1120' }
    : { overlay: '#ffffff', symbol: '#475569', background: '#f8fafc' };
}

nativeTheme.on('updated', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const colors = themeColors();
  mainWindow.setBackgroundColor(colors.background);
  if (process.platform !== 'linux') {
    mainWindow.setTitleBarOverlay({ color: colors.overlay, symbolColor: colors.symbol, height: 52 });
  }
});

function createWindow() {
  const colors = themeColors();
  // Linux window managers don't render the titlebar overlay controls, so keep the native frame there
  const titleBarOptions = process.platform === 'linux' ? {} : {
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: colors.overlay,
      symbolColor: colors.symbol,
      height: 52
    }
  };

  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    title: "RawTorrent Engine",
    icon: path.join(__dirname, 'build/installer/icon.png'),
    backgroundColor: colors.background,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false
    },
    ...titleBarOptions
  });

  loadApp();
}

// The renderer reads the backend port and default download dir from the query string
function loadApp() {
  mainWindow.loadFile('index.html', {
    query: { port: String(backendPort), downloadsDir: app.getPath('downloads') }
  });
}

// Ask the OS for a free localhost port so a busy 5000 (or a stale backend) can't break the UI
function findFreePort(preferred) {
  const tryPort = (port) => new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const { port: freePort } = server.address();
      server.close(() => resolve(freePort));
    });
  });
  return tryPort(preferred).catch(() => tryPort(0)).catch(() => preferred);
}

function startBackend() {
  const isDev = !app.isPackaged;
  let command = 'dotnet';
  let args = ['run', '--project', 'RawTorrent/TorServices/TorServices/TorServices.csproj'];

  if (!isDev) {
    const executableName = process.platform === 'win32' ? 'TorServices.exe' : 'TorServices';
    command = path.join(process.resourcesPath, 'backend', executableName);
    args = [];
  }

  const backendDir = isDev ? __dirname : path.join(process.resourcesPath, 'backend');

  if (!isDev && !fs.existsSync(command)) {
    console.error(`Backend executable not found at: ${command}`);
    dialog.showErrorBox('Backend Error', `The backend executable was not found at:\n${command}`);
    return;
  }

  if (!isDev && process.platform !== 'win32') {
    try {
      fs.accessSync(command, fs.constants.X_OK);
    } catch {
      try {
        fs.chmodSync(command, 0o755);
      } catch (err) {
        dialog.showErrorBox('Backend Error', `The backend is not executable and could not be fixed:\n${command}\n\n${err.message}`);
        return;
      }
    }
  }

  console.log(`Starting backend from ${backendDir}: ${command} ${args.join(' ')} (port ${backendPort})`);

  // Backend output goes to <logs>/backend.log, since the install dir is read-only on Linux
  let logStream = null;
  try {
    const logDir = app.getPath('logs');
    fs.mkdirSync(logDir, { recursive: true });
    logStream = fs.createWriteStream(path.join(logDir, 'backend.log'), { flags: 'a' });
  } catch (err) {
    console.error('Could not open backend log:', err);
  }

  backendProcess = spawn(command, args, {
    cwd: backendDir,
    stdio: ['ignore', logStream ? 'pipe' : 'ignore', logStream ? 'pipe' : 'ignore'],
    env: {
      ...process.env,
      ASPNETCORE_URLS: `http://127.0.0.1:${backendPort}`,
      RAWTORRENT_PORT: String(backendPort),
      RAWTORRENT_PARENT_PID: String(process.pid)
    },
    windowsHide: true
  });

  if (logStream) {
    backendProcess.stdout.pipe(logStream);
    backendProcess.stderr.pipe(logStream);
  }

  let spawnFailed = false;
  backendProcess.on('error', (err) => {
    spawnFailed = true;
    console.error('Failed to start backend:', err);
    dialog.showErrorBox('Backend Failed', `Failed to start backend process:\n${err.message}`);
  });

  backendProcess.on('close', async (code) => {
    console.log(`Backend process exited with code ${code}`);
    // An unexpected exit (e.g. the port was taken in the meantime) gets a fresh port and the UI follows it
    if (isQuitting || spawnFailed || backendRestarts >= 3) return;
    backendRestarts++;
    backendPort = await findFreePort(0);
    startBackend();
    if (mainWindow && !mainWindow.isDestroyed()) loadApp();
  });
}

function sendMagnetUri(uri) {
  if (mainWindow) {
    mainWindow.webContents.send('magnet-uri', { uri, defaultDir: app.getPath('downloads') });
  }
}

app.on('open-url', (event, url) => {
  event.preventDefault();
  if (url.startsWith('magnet:')) sendMagnetUri(url);
});

app.whenReady().then(async () => {
  // A second instance only forwards its magnet link to the first one; it must not start a backend
  if (!gotTheLock) return;
  app.setName('RawTorrent');
  if (app.isPackaged) app.setAsDefaultProtocolClient('magnet');
  const { theme } = readSettings();
  nativeTheme.themeSource = THEMES.includes(theme) ? theme : 'light';
  backendPort = await findFreePort(5000);
  startBackend();
  createWindow();

  const magnetUri = process.argv.find(arg => arg.startsWith('magnet:'));
  if (magnetUri) {
    mainWindow.webContents.once('did-finish-load', () => {
      sendMagnetUri(magnetUri);
    });
  }

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// IPC Handlers for Native Dialogs
ipcMain.handle('open-file-dialog', async (event, options) => {
  const result = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow(), {
    properties: ['openFile'],
    filters: [{ name: 'Torrent Files', extensions: ['torrent'] }, { name: 'All Files', extensions: ['*'] }]
  });
  return result.filePaths[0];
});

ipcMain.handle('open-directory-dialog', async (event, options) => {
  const result = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow(), {
    properties: ['openDirectory']
  });
  return result.filePaths[0];
});

ipcMain.handle('get-settings', () => ({
  theme: nativeTheme.themeSource,
  version: app.getVersion()
}));

ipcMain.handle('set-theme', (event, theme) => {
  if (!THEMES.includes(theme)) return;
  nativeTheme.themeSource = theme;
  writeSettings({ ...readSettings(), theme });
});

ipcMain.handle('open-project-page', () => shell.openExternal(PROJECT_URL));

// Opens a folder in the platform file manager; returns an error string or '' on success
ipcMain.handle('open-folder', async (event, folderPath) => {
  if (!folderPath) return 'No path';
  return shell.openPath(folderPath);
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('will-quit', () => {
  isQuitting = true;
  if (backendProcess) {
    if (process.platform === 'win32') {
      const { exec } = require('child_process');
      // On Windows, we need to kill the process tree to ensure the backend stops
      exec(`taskkill /pid ${backendProcess.pid} /f /t`);
    } else {
      // On Linux/Mac, SIGTERM usually suffices, or we can use process.kill
      backendProcess.kill('SIGTERM');
    }
  }
});
