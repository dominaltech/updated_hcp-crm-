const { contextBridge, ipcRenderer } = require('electron');

// Expose safe desktop environment markers to window
contextBridge.exposeInMainWorld('isElectron', true);
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  version: process.versions.electron,
  print: () => ipcRenderer.send('print-window'),
  openExternal: (url) => ipcRenderer.send('open-external', url)
});
