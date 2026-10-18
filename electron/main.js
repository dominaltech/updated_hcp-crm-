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

function getAppConfig() {
  const appDataDir = path.join(process.env.APPDATA || '', 'HotelCityPark');
  const configFile = path.join(appDataDir, 'network_config.json');
  let config = {
    mode: 'master', // 'master' | 'client'
    serverHost: 'localhost',
    serverPort: PORT,
    screen: 'hospitality'
  };

  if (fs.existsSync(configFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(configFile, 'utf8'));
      config = { ...config, ...parsed };
    } catch (_) {}
  }

  // Parse command line arguments
  const args = process.argv || [];
  for (const a of args) {
    if (a === '--client') config.mode = 'client';
    if (a === '--master') config.mode = 'master';
    if (a.startsWith('--server=')) config.serverHost = a.split('=')[1].trim();
    if (a.startsWith('--host=')) config.serverHost = a.split('=')[1].trim();
    if (a.startsWith('--port=')) config.serverPort = parseInt(a.split('=')[1].trim(), 10) || PORT;
    if (a === '--admin' || a === '--owner' || a === '--screen=admin') {
      config.screen = 'admin';
      config.mode = 'client';
    }
    if (a === '--restaurant' || a === '--screen=restaurant') config.screen = 'restaurant';
    if (a === '--bar' || a === '--screen=bar') config.screen = 'bar';
    if (a === '--hospitality' || a === '--screen=hospitality') config.screen = 'hospitality';
  }
  // Auto-detect Admin mode if executable name contains "admin" or "owner"
  try {
    const exeName = path.basename(process.execPath || '').toLowerCase();
    if (exeName.includes('admin') || exeName.includes('owner')) {
      config.screen = 'admin';
      config.mode = 'client';
    }
  } catch (_) {}

  // If in admin mode and serverHost is localhost, check if remote cloud URL or LAN IP is available
  if (config.screen === 'admin' && (config.serverHost === 'localhost' || !config.serverHost)) {
    try {
      const rFile = path.join(__dirname, '..', 'remote_url.txt');
      if (fs.existsSync(rFile)) {
        const rUrl = fs.readFileSync(rFile, 'utf8').trim();
        if (rUrl) config.serverHost = rUrl;
      } else {
        config.serverHost = '10.160.83.195';
      }
    } catch (_) {
      config.serverHost = '10.160.83.195';
    }
  }

  return config;
}

function saveAppConfig(newCfg) {
  const appDataDir = path.join(process.env.APPDATA || '', 'HotelCityPark');
  if (!fs.existsSync(appDataDir)) {
    try { fs.mkdirSync(appDataDir, { recursive: true }); } catch (_) {}
  }
  const configFile = path.join(appDataDir, 'network_config.json');
  try {
    fs.writeFileSync(configFile, JSON.stringify(newCfg, null, 2), 'utf8');
  } catch (_) {}
}

function promptSetServerIp() {
  const promptWin = new BrowserWindow({
    width: 520,
    height: 420,
    title: 'Connect to Hotel Server / Cloud',
    parent: mainWindow,
    modal: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    backgroundColor: '#0f172a',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  const curCfg = getAppConfig();
  let defaultIp = curCfg.serverHost !== 'localhost' ? curCfg.serverHost : '10.160.83.195';
  
  // Check if remote_url.txt exists
  let remoteCloudUrl = '';
  try {
    const rFile = path.join(__dirname, '..', 'remote_url.txt');
    if (fs.existsSync(rFile)) {
      remoteCloudUrl = fs.readFileSync(rFile, 'utf8').trim();
    }
  } catch (_) {}

  const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Connect to Hotel Server / Cloud</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #fff; padding: 22px; margin: 0; }
    h3 { margin: 0 0 6px; font-size: 1.15rem; color: #38bdf8; }
    p { font-size: 0.82rem; color: #94a3b8; margin: 0 0 14px; line-height: 1.4; }
    label { font-size: 0.76rem; font-weight: 700; color: #cbd5e1; text-transform: uppercase; display: block; margin-bottom: 4px; }
    input, select { width: 100%; box-sizing: border-box; padding: 9px 12px; background: #1e293b; border: 1.5px solid #334155; border-radius: 8px; color: #fff; font-size: 0.92rem; margin-bottom: 12px; }
    input:focus, select:focus { border-color: #38bdf8; outline: none; }
    .quick-links { display: flex; gap: 8px; margin-bottom: 14px; }
    .quick-btn { flex: 1; padding: 6px 10px; font-size: 0.76rem; font-weight: 600; background: #1e293b; border: 1px solid #334155; border-radius: 6px; color: #38bdf8; cursor: pointer; text-align: center; }
    .quick-btn:hover { background: #334155; }
    .btns { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; }
    button { padding: 9px 18px; border-radius: 8px; font-weight: 700; font-size: 0.84rem; cursor: pointer; border: none; }
    .btn-cancel { background: #334155; color: #cbd5e1; }
    .btn-save { background: #0284c7; color: #fff; }
  </style>
</head>
<body>
  <h3>🌐 Hotel City Park Connection</h3>
  <p>Connect over Local Hotel Wi-Fi or Worldwide Cloud.</p>
  
  <div class="quick-links">
    <div class="quick-btn" onclick="document.getElementById('ip').value='10.160.83.195'">🏢 Hotel Wi-Fi</div>
    ${remoteCloudUrl ? `<div class="quick-btn" onclick="document.getElementById('ip').value='${remoteCloudUrl}'">🌐 Worldwide Cloud</div>` : ''}
    <div class="quick-btn" onclick="document.getElementById('ip').value='localhost'">💻 This PC</div>
  </div>

  <form id="f">
    <label>Server IP / Cloud URL</label>
    <input type="text" id="ip" value="${defaultIp}" placeholder="e.g. 10.160.83.195 or https://..." required autofocus />
    
    <label>Initial Screen</label>
    <select id="sc">
      <option value="admin" ${curCfg.screen === 'admin' ? 'selected' : ''}>👑 Admin & Owner Portal</option>
      <option value="hospitality" ${curCfg.screen === 'hospitality' ? 'selected' : ''}>🏨 Front Desk (Hospitality CRM)</option>
      <option value="restaurant" ${curCfg.screen === 'restaurant' ? 'selected' : ''}>🍽️ Restaurant POS Counter</option>
      <option value="bar" ${curCfg.screen === 'bar' ? 'selected' : ''}>🍸 Bar POS Counter</option>
      <option value="store-admin" ${curCfg.screen === 'store-admin' ? 'selected' : ''}>📋 Store Admin & Inventory</option>
    </select>

    <div class="btns">
      <button type="button" class="btn-cancel" onclick="window.close()">Cancel</button>
      <button type="submit" class="btn-save">Save & Connect</button>
    </div>
  </form>
  <script>
    const { ipcRenderer } = require('electron');
    document.getElementById('f').onsubmit = (e) => {
      e.preventDefault();
      const ip = document.getElementById('ip').value.trim();
      const sc = document.getElementById('sc').value;
      ipcRenderer.send('save-network-config', { serverHost: ip, screen: sc, mode: 'client' });
      window.close();
    };
  </script>
</body>
</html>`;

  promptWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(htmlContent));
}

/**
 * Launch backend server process in parallel and navigate window as soon as port binds.
 */
async function startServerAndNavigate() {
  const cfg = getAppConfig();
  const screen = cfg.screen || 'hospitality';
  const isClient = cfg.mode === 'client';
  const targetHost = isClient ? (cfg.serverHost || 'localhost') : 'localhost';
  const targetPort = isClient ? (cfg.serverPort || PORT) : PORT;

  let screenPath = screen;
  if (screen === 'admin') screenPath = 'admin/';
  else if (screen === 'store') screenPath = 'store-admin';

  let targetUrl;
  if (targetHost.startsWith('http://') || targetHost.startsWith('https://')) {
    const base = targetHost.replace(/\/+$/, '');
    targetUrl = `${base}/${screenPath}`;
  } else {
    targetUrl = `http://${targetHost}:${targetPort}/${screenPath}`;
  }

  console.log(`[Electron] Starting in ${cfg.mode.toUpperCase()} mode. Target URL: ${targetUrl}`);

  if (mainWindow && !mainWindow.isDestroyed()) {
    const titleMap = {
      admin: 'Hotel City Park - Admin & Owner Portal',
      hospitality: 'Hotel City Park CRM - Front Desk',
      restaurant: 'Hotel City Park - Restaurant POS',
      bar: 'Hotel City Park - Bar Lounge POS',
      'store-admin': 'Hotel City Park - Store Admin'
    };
    mainWindow.setTitle(titleMap[screen] || 'Hotel City Park CRM');
  }

  // In Client Mode: do NOT spawn a local SQLite server. Connect to host!
  if (isClient) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadURL(targetUrl);
    }
    setupMenu();
    return;
  }

  // In Master Mode:
  // 1. If server is already active, navigate instantly!
  if (await isPortActive(PORT)) {
    console.log(`[Electron] Backend server already active on port ${PORT}. Connecting immediately.`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadURL(targetUrl);
    }
    setupMenu();
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
        NODE_ENV: 'production',
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
  const maxAttempts = 200; // ~7 seconds max timeout
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise(r => setTimeout(r, 35));
    if (await isPortActive(PORT)) {
      console.log(`[Electron] Backend server is online (attempt ${attempt + 1}). Navigating to CRM...`);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.loadURL(targetUrl);
      }
      setupMenu();
      return;
    }
  }

  // Fallback: try navigating even if port test timed out
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadURL(targetUrl);
  }
  setupMenu();
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
    },
    {
      label: '🌐 Network & Mode',
      submenu: [
        {
          label: 'Mode: Master Server (Main PC - Local SQLite + Cloud Sync)',
          type: 'checkbox',
          checked: getAppConfig().mode === 'master',
          click: () => {
            const cfg = getAppConfig();
            cfg.mode = 'master';
            cfg.serverHost = 'localhost';
            saveAppConfig(cfg);
            startServerAndNavigate();
          }
        },
        {
          label: 'Mode: Client (Connect to Main PC over Wi-Fi / LAN)',
          type: 'checkbox',
          checked: getAppConfig().mode === 'client',
          click: () => {
            promptSetServerIp();
          }
        },
        { type: 'separator' },
        {
          label: 'Set Server IP Address / Cloud URL...',
          click: () => {
            promptSetServerIp();
          }
        },
        { type: 'separator' },
        {
          label: '👑 Switch Screen: Admin & Owner Portal',
          click: () => {
            const cfg = getAppConfig();
            cfg.screen = 'admin';
            saveAppConfig(cfg);
            startServerAndNavigate();
          }
        },
        {
          label: '🏨 Switch Screen: Front Desk (Hospitality CRM)',
          click: () => {
            const cfg = getAppConfig();
            cfg.screen = 'hospitality';
            saveAppConfig(cfg);
            startServerAndNavigate();
          }
        },
        {
          label: '🍽️ Switch Screen: Restaurant POS Counter',
          click: () => {
            const cfg = getAppConfig();
            cfg.screen = 'restaurant';
            saveAppConfig(cfg);
            startServerAndNavigate();
          }
        },
        {
          label: '🍸 Switch Screen: Bar POS Counter',
          click: () => {
            const cfg = getAppConfig();
            cfg.screen = 'bar';
            saveAppConfig(cfg);
            startServerAndNavigate();
          }
        },
        {
          label: '📋 Switch Screen: Store Admin & Inventory',
          click: () => {
            const cfg = getAppConfig();
            cfg.screen = 'store-admin';
            saveAppConfig(cfg);
            startServerAndNavigate();
          }
        }
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

ipcMain.on('save-network-config', (event, newCfg) => {
  const cfg = getAppConfig();
  const updated = { ...cfg, ...newCfg };
  saveAppConfig(updated);
  if (updated.mode === 'client') {
    cleanupServer();
  }
  startServerAndNavigate();
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
