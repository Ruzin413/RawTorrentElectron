const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow;
let backendProcess;

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
    command = path.join(process.resourcesPath, 'backend', 'TorServices.exe');
    args = [];
  }

  console.log(`Starting backend: ${command} ${args.join(' ')}`);

  backendProcess = spawn(command, args, {
    cwd: __dirname,
    stdio: 'inherit'
  });

  backendProcess.on('error', (err) => {
    console.error('Failed to start backend:', err);
  });
}

app.whenReady().then(() => {
  startBackend();
  createWindow();

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
    backendProcess.kill();
  }
});
