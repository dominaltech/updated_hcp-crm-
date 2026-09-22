const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');

let mainWindow = null;
let serverProcess = null;
const PORT = process.env.PORT || 3000;

// Ensure only a single instance of the application runs
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function getIconPath() {
  const possiblePaths = [
    path.join(__dirname, '..', 'build', 'icon.ico'),
    path.join(__dirname, '..', 'electron_icon.ico'),
    path.join(process.resourcesPath, 'icon.ico'),
    path.join(process.resourcesPath, 'app', 'electron_icon.ico'),
    path.join(process.resourcesPath, 'app', 'build', 'icon.ico'),
    path.join(__dirname, '..', 'public', 'HCP New Logo Png_withname.png')
  ];
  return possiblePaths.find(p => fs.existsSync(p)) || possiblePaths[0];
}

function findNodeBinary() {
  const possibleNodes = [
    path.join(__dirname, '..', 'runtime', 'node.exe'),
    path.join(process.resourcesPath, 'runtime', 'node.exe'),
    path.join(process.resourcesPath, 'app', 'runtime', 'node.exe'),
    path.join(__dirname, '..', '..', 'runtime', 'node.exe'),
    'node.exe',
    'node'
  ];
  for (const n of possibleNodes) {
    if (fs.existsSync(n)) return n;
  }
  return 'node';
}

function isServerListening(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}/`, (res) => {
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(500, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function startServer() {
  const alreadyRunning = await isServerListening(PORT);
  if (alreadyRunning) {
    console.log(`[Electron] Server already active on port ${PORT}.`);
    return;
  }

  const rootDir = path.resolve(__dirname, '..');
  const serverScript = path.join(rootDir, 'server.js');
  const nodeBin = findNodeBinary();

  console.log(`[Electron] Spawning backend server using ${nodeBin}...`);
  try {
    serverProcess = spawn(nodeBin, [serverScript], {
      cwd: rootDir,
      env: {
        ...process.env,
        USE_APPDATA: '1',
        PORT: String(PORT)
      },
      stdio: 'ignore',
      windowsHide: true
    });

    serverProcess.on('error', (err) => {
      console.error('[Electron] Failed to start backend server:', err);
    });
  } catch (err) {
    console.error('[Electron] Exception launching server process:', err);
  }

  // Wait for server to be responsive
  let ready = false;
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 250));
    if (await isServerListening(PORT)) {
      ready = true;
      break;
    }
  }
  console.log(`[Electron] Server ready state: ${ready}`);
}

function createMainWindow() {
  const iconPath = getIconPath();

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 700,
    title: 'Hotel City Park CRM',
    icon: iconPath,
    backgroundColor: '#ffffff',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      sandbox: false
    }
  });

  // Maximized view for complete desktop hotel dashboard experience
  mainWindow.maximize();

  // Load Hospitality screen directly inside the native Electron window
  mainWindow.loadURL(`http://localhost:${PORT}/hospitality`);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  // Intercept new window requests to stay within window or open externally if third-party
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(`http://localhost:${PORT}`) || url.startsWith('blob:')) {
      return { action: 'allow' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  setupMenu();
}

function setupMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Print Document',
          accelerator: 'CmdOrCtrl+P',
          click: () => {
            if (mainWindow) mainWindow.webContents.print();
          }
        },
        { type: 'separator' },
        {
          label: 'Open AppData Database Folder',
          click: () => {
            const appDataDir = path.join(process.env.APPDATA || '', 'HotelCityPark');
            if (fs.existsSync(appDataDir)) {
              shell.openPath(appDataDir);
            } else {
              shell.openExternal(`file://${appDataDir}`);
            }
          }
        },
        { type: 'separator' },
        { role: 'quit', label: 'Exit Hotel City Park' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload', label: 'Refresh Screen' },
        { role: 'forceReload', label: 'Force Reload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Full Screen' },
        { role: 'toggleDevTools', label: 'Developer Tools' }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// IPC Handlers
ipcMain.on('print-window', () => {
  if (mainWindow) {
    mainWindow.webContents.print();
  }
});

ipcMain.on('open-external', (event, url) => {
  if (url) shell.openExternal(url);
});

// App Lifecycle
app.whenReady().then(async () => {
  await startServer();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // Kill background server process on exit
  if (serverProcess && !serverProcess.killed) {
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', serverProcess.pid, '/f', '/t']);
      } else {
        serverProcess.kill();
      }
    } catch (e) {}
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (serverProcess && !serverProcess.killed) {
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', serverProcess.pid, '/f', '/t']);
      } else {
        serverProcess.kill();
      }
    } catch (e) {}
  }
});
