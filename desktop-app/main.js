const { app, BrowserWindow, ipcMain, desktopCapturer, screen } = require('electron');
const path = require('path');
const { exec } = require('child_process');
const os = require('os');
const dgram = require('dgram');

let mainWindow = null;
let discoveredServerUrl = 'ws://192.168.3.141:9000'; // Default inteligente

// ========================================================
// Autodescubrimiento UDP en Red Local (Zero-Config)
// ========================================================
const udpClient = dgram.createSocket({ type: 'udp4', reuseAddr: true });

udpClient.on('message', (msg) => {
  try {
    const data = JSON.parse(msg.toString());
    if (data.type === 'SIGNALING_SERVER_FOUND' && data.serverUrl) {
      discoveredServerUrl = data.serverUrl;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('server-discovered', discoveredServerUrl);
      }
    }
  } catch (e) {}
});

udpClient.bind(9001, () => {
  udpClient.setBroadcast(true);
  // Enviar sondeo inicial a la red
  const probe = JSON.stringify({ type: 'DISCOVER_SIGNALING_SERVER' });
  udpClient.send(probe, 9001, '255.255.255.255', () => {});
});

ipcMain.handle('get-discovered-server', () => {
  return discoveredServerUrl;
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1050,
    height: 720,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#0c0e14',
    title: 'AnyDesk Remote Desktop - Ing. Roosvelt Enriquez Gamez',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Inicialización de la aplicación
app.whenReady().then(() => {
  // Configurar permiso automático para captura de pantalla (desktopCapturer / getDisplayMedia)
  const { session } = require('electron');
  if (session.defaultSession.setDisplayMediaRequestHandler) {
    session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
      desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
        const primary = sources[0];
        callback({ video: primary });
      }).catch(() => {
        callback({});
      });
    });
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ========================================================
// IPC: Obtener Fuentes de Pantalla para Captura Nativa
// ========================================================
ipcMain.handle('get-screen-sources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 320, height: 180 }
  });
  return sources.map(s => ({ id: s.id, name: s.name, thumbnail: s.thumbnail.toDataURL() }));
});

// ========================================================
// IPC: Ejecución de Eventos de Entrada en el Sistema Operativo
// ========================================================
ipcMain.on('execute-input', (event, inputData) => {
  const { action, normX, normY, button, key, deltaY } = inputData;
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.size;

  let x = Math.round((normX || 0) * width);
  let y = Math.round((normY || 0) * height);
  const platform = os.platform();

  if (action === 'mousemove') {
    if (platform === 'darwin') {
      const script = `osascript -l JavaScript -e "
        ObjC.import('CoreGraphics');
        var point = $.CGPointMake(${x}, ${y});
        $.CGEventPost($.kCGHIDEventTap, $.CGEventCreateMouseEvent(null, $.kCGEventMouseMoved, point, 0));
      "`;
      exec(script, () => {});
    } else if (platform === 'linux') {
      exec(`xdotool mousemove ${x} ${y}`, () => {});
    } else if (platform === 'win32') {
      exec(`powershell -Command "[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y})"`, () => {});
    }
  } else if (action === 'click' || action === 'mousedown' || action === 'mouseup') {
    const isRight = button === 2;
    if (platform === 'darwin') {
      const downType = isRight ? '$.kCGEventRightMouseDown' : '$.kCGEventLeftMouseDown';
      const upType = isRight ? '$.kCGEventRightMouseUp' : '$.kCGEventLeftMouseUp';
      const script = `osascript -l JavaScript -e "
        ObjC.import('CoreGraphics');
        var point = $.CGPointMake(${x}, ${y});
        $.CGEventPost($.kCGHIDEventTap, $.CGEventCreateMouseEvent(null, ${downType}, point, ${isRight ? 1 : 0}));
        $.CGEventPost($.kCGHIDEventTap, $.CGEventCreateMouseEvent(null, ${upType}, point, ${isRight ? 1 : 0}));
      "`;
      exec(script, () => {});
    } else if (platform === 'linux') {
      exec(`xdotool mousemove ${x} ${y} click ${isRight ? 3 : 1}`, () => {});
    }
  } else if (action === 'keydown') {
    if (key && key.length === 1) {
      if (platform === 'darwin') {
        const escaped = key.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        exec(`osascript -e 'tell application "System Events" to keystroke "${escaped}"'`, () => {});
      } else if (platform === 'linux') {
        exec(`xdotool key "${key}"`, () => {});
      }
    }
  }
});
