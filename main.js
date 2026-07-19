const { app, BrowserWindow, globalShortcut, ipcMain } = require('electron');
const path = require('path');

// Disable autoplay policy restrictions so that cockpit alarms play immediately on startup
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Express-Server starten
// Durch das require() wird der Code in server.js ausgeführt.
try {
  require(path.join(__dirname, 'server.js'));
} catch (err) {
  console.error('Fehler beim Starten des Express-Servers:', err);
}

let mainWindow;
let secondaryWindow;
let isMapFullscreen = false;
let wasWindowAlreadyFullscreenBeforeMapFS = false;

function handleToggleFullscreen() {
  if (!mainWindow) return;
  const isWindowFS = mainWindow.isFullScreen();
  
  if (!isMapFullscreen) {
    // Entering map fullscreen mode
    isMapFullscreen = true;
    if (isWindowFS) {
      wasWindowAlreadyFullscreenBeforeMapFS = true;
    } else {
      wasWindowAlreadyFullscreenBeforeMapFS = false;
      mainWindow.setFullScreen(true);
    }
    mainWindow.webContents.send('electron-fullscreen-changed', true);
  } else {
    // Exiting map fullscreen mode
    isMapFullscreen = false;
    if (!wasWindowAlreadyFullscreenBeforeMapFS) {
      mainWindow.setFullScreen(false);
    }
    mainWindow.webContents.send('electron-fullscreen-changed', false);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1420,
    height: 920,
    minWidth: 1000,
    minHeight: 700,
    title: 'War Thunder Tactical Map & Telemetry Dashboard',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    backgroundColor: '#03070d',
    autoHideMenuBar: true
  });

  const targetUrl = 'http://localhost:811';

  // Funktion versucht die Seite zyklisch zu laden, bis der Server bereit ist
  const loadWithRetry = () => {
    mainWindow.loadURL(targetUrl).catch(() => {
      console.log('Server noch nicht bereit, neuer Versuch in 200ms...');
      setTimeout(loadWithRetry, 200);
    });
  };

  loadWithRetry();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.on('leave-full-screen', () => {
    isMapFullscreen = false;
    mainWindow.webContents.send('electron-fullscreen-changed', false);
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Listener to register global shortcuts dynamically
ipcMain.on('register-zoom-shortcut', (event, { shortcutZoomIn, shortcutZoomOut, shortcutToggleAir, shortcutToggleGround, shortcutToggleNaval, shortcutToggleBases, shortcutToggleFullscreen }) => {
  // Always clear previous shortcuts first
  globalShortcut.unregisterAll();

  const registerKey = (keyName, shortcut, triggerChannel) => {
    if (!shortcut) return;
    try {
      globalShortcut.register(shortcut, () => {
        if (mainWindow) {
          if (triggerChannel === 'trigger-toggle-fullscreen') {
            handleToggleFullscreen();
          } else {
            mainWindow.webContents.send(triggerChannel);
          }
        }
      });
      console.log(`Global shortcut registered: ${keyName} -> ${shortcut}`);
    } catch (err) {
      console.error(`Failed to register global shortcut ${keyName} (${shortcut}):`, err);
    }
  };

  registerKey('Zoom In', shortcutZoomIn, 'trigger-zoom-in');
  registerKey('Zoom Out', shortcutZoomOut, 'trigger-zoom-out');
  registerKey('Toggle Air', shortcutToggleAir, 'trigger-toggle-air');
  registerKey('Toggle Ground', shortcutToggleGround, 'trigger-toggle-ground');
  registerKey('Toggle Naval', shortcutToggleNaval, 'trigger-toggle-naval');
  registerKey('Toggle Bases', shortcutToggleBases, 'trigger-toggle-bases');
  registerKey('Toggle Fullscreen', shortcutToggleFullscreen, 'trigger-toggle-fullscreen');
});

// IPC listener to toggle window fullscreen state
ipcMain.on('toggle-fullscreen', () => {
  handleToggleFullscreen();
});

// IPC listener to open secondary monitor window
ipcMain.on('open-secondary-window', () => {
  if (secondaryWindow) {
    secondaryWindow.focus();
    return;
  }

  secondaryWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 600,
    minHeight: 450,
    title: 'War Thunder Instrument & Telemetry Display',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    backgroundColor: '#03070d',
    autoHideMenuBar: true
  });

  secondaryWindow.loadURL('http://localhost:811/hud.html');

  secondaryWindow.on('closed', () => {
    secondaryWindow = null;
  });
});

// Spawn background PowerShell joystick polling process
const { spawn } = require('child_process');
let joyProcess = null;

function startJoystickPolling() {
  const scriptPath = path.join(__dirname, 'joy_poll.ps1');
  joyProcess = spawn('powershell.exe', [
    '-ExecutionPolicy', 'Bypass',
    '-File', scriptPath
  ]);

  joyProcess.stdout.on('data', (data) => {
    const lines = data.toString().split('\n');
    lines.forEach(line => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const evt = JSON.parse(trimmed);
        if (mainWindow) {
          mainWindow.webContents.send('joy-event', evt);
        }
      } catch (err) {
        // Ignore non-JSON output lines
      }
    });
  });

  joyProcess.stderr.on('data', (data) => {
    console.error(`Joystick polling stderr: ${data}`);
  });

  joyProcess.on('close', (code) => {
    console.log(`Joystick polling process exited with code ${code}`);
  });
}

// Start polling when app is ready
app.whenReady().then(() => {
  startJoystickPolling();
});

// Cleanup global shortcuts and background process on application quit
app.on('will-quit', () => {
  if (joyProcess) {
    joyProcess.kill();
  }
  globalShortcut.unregisterAll();
});