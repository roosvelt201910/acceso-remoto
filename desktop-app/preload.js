const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getScreenSources: () => ipcRenderer.invoke('get-screen-sources'),
  executeInput: (data) => ipcRenderer.send('execute-input', data),
  getDiscoveredServer: () => ipcRenderer.invoke('get-discovered-server'),
  onServerDiscovered: (callback) => ipcRenderer.on('server-discovered', (_event, url) => callback(url))
});

