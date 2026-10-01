const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const fs = require('fs');

// Performance & GPU acceleration switches for instantaneous startup
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-certificate-errors');

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

/**
 * Ultra-fast TCP port check.
 * Connects directly via raw TCP socket which responds in < 2ms locally.
 */
function isPortActive(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(120);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, '127.0.0.1');
  });
}

/**
 * Launch backend server process in parallel and navigate window as soon as port binds.
 */
async function startServerAndNavigate() {
  const targetUrl = `http://localhost:${PORT}/hospitality`;

  // 1. If server is already active, navigate instantly!
  if (await isPortActive(PORT)) {
    console.log(`[Electron] Backend server already active on port ${PORT}. Connecting immediately.`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadURL(targetUrl);
    }
    return;
  }

  // 2. Spawn backend server
  const rootDir = path.resolve(__dirname, '..');
  const serverScript = path.join(rootDir, 'server.js');
  const nodeBin = findNodeBinary();

  console.log(`[Electron] Spawning backend server: ${nodeBin} -> ${serverScript}`);
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

  // 3. Fast poll (every 35ms) until server accepts connections
  const maxAttempts = 120; // ~4.2 seconds max timeout
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise(r => setTimeout(r, 35));
    if (await isPortActive(PORT)) {
      console.log(`[Electron] Backend server is online (attempt ${attempt + 1}). Navigating to CRM...`);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.loadURL(targetUrl);
      }
      return;
    }
  }

  // Fallback: try navigating even if port test timed out
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadURL(targetUrl);
  }
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
    backgroundColor: '#0f172a',
    show: true, // Immediately show window on launch for instant responsiveness
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      sandbox: false
    }
  });

  // Automatically maximize window to full desktop hotel workspace
  mainWindow.maximize();

  // Load instant local splash screen immediately (< 10ms from disk)
  const splashPath = path.join(__dirname, 'splash.html');
  if (fs.existsSync(splashPath)) {
    mainWindow.loadFile(splashPath);
  }

  // Gracefully handle any transient connection glitch during server boot
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    if (validatedURL && validatedURL.includes(`localhost:${PORT}`)) {
      console.warn(`[Electron] did-fail-load: ${errorCode} (${errorDescription}). Retrying in 200ms...`);
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.loadURL(`http://localhost:${PORT}/hospitality`);
        }
      }, 200);
    }
  });

  // Intercept window open calls: keep CRM pages inside app, open external web links in browser
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

function cleanupServer() {
  if (serverProcess && !serverProcess.killed) {
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(serverProcess.pid), '/f', '/t'], { windowsHide: true });
      } else {
        serverProcess.kill();
      }
    } catch (e) {}
    serverProcess = null;
  }
}

// App Lifecycle
app.whenReady().then(() => {
  createMainWindow();
  startServerAndNavigate();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
      startServerAndNavigate();
    }
  });
});

app.on('window-all-closed', () => {
  cleanupServer();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  cleanupServer();
});
