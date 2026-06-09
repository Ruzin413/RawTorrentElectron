const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow;
let backendProcess;

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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    title: "RawTorrent Engine",
    icon: path.join(__dirname, 'build/installer/icon.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false
    },
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#ffffff',
      symbolColor: '#475569',
      height: 52
    }
  });

  mainWindow.loadFile('index.html');
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

  const fs = require('fs');
  if (!isDev && !fs.existsSync(command)) {
    console.error(`Backend executable not found at: ${command}`);
    dialog.showErrorBox('Backend Error', `The backend executable was not found at:\n${command}`);
    return;
  }

  console.log(`Starting backend from ${backendDir}: ${command} ${args.join(' ')}`);

  backendProcess = spawn(command, args, {
    cwd: backendDir,
    stdio: 'ignore',
    env: { ...process.env, ASPNETCORE_URLS: 'http://localhost:5000' },
    windowsHide: true
  });

  backendProcess.on('error', (err) => {
    console.error('Failed to start backend:', err);
    dialog.showErrorBox('Backend Failed', `Failed to start backend process:\n${err.message}`);
  });

  backendProcess.on('close', (code) => {
    console.log(`Backend process exited with code ${code}`);
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

app.whenReady().then(() => {
  app.setName('RawTorrent');
  if (app.isPackaged) app.setAsDefaultProtocolClient('magnet');
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

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
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
