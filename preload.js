const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  registerZoomShortcut: (shortcuts) => ipcRenderer.send('register-zoom-shortcut', shortcuts),
  onTriggerZoomIn: (callback) => ipcRenderer.on('trigger-zoom-in', () => callback()),
  onTriggerZoomOut: (callback) => ipcRenderer.on('trigger-zoom-out', () => callback()),
  onTriggerToggleAir: (callback) => ipcRenderer.on('trigger-toggle-air', () => callback()),
  onTriggerToggleGround: (callback) => ipcRenderer.on('trigger-toggle-ground', () => callback()),
  onTriggerToggleNaval: (callback) => ipcRenderer.on('trigger-toggle-naval', () => callback()),
  onTriggerToggleBases: (callback) => ipcRenderer.on('trigger-toggle-bases', () => callback()),
  onTriggerToggleFullscreen: (callback) => ipcRenderer.on('trigger-toggle-fullscreen', () => callback()),
  onElectronFullscreenChanged: (callback) => ipcRenderer.on('electron-fullscreen-changed', (event, isFS) => callback(isFS)),
  toggleFullscreen: () => ipcRenderer.send('toggle-fullscreen'),
  onJoyEvent: (callback) => ipcRenderer.on('joy-event', (event, data) => callback(data)),
  openSecondaryWindow: () => ipcRenderer.send('open-secondary-window'),
  isElectron: true
});
