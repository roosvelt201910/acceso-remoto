const { app, BrowserWindow, ipcMain, desktopCapturer, screen } = require('electron');
const path = require('path');
const { exec } = require('child_process');
const os = require('os');
const dgram = require('dgram');

let mainWindow = null;
let discoveredServerUrl = 'wss://acceso-remoto.onrender.com'; // Servidor Cloud Global

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
// Controlador Nativo de Entrada de Ultra Baja Latencia (0ms)
// ========================================================
let winInputProcess = null;

if (os.platform() === 'win32') {
  // Iniciar proceso PowerShell persistente con C# Win32 P/Invoke para 0ms de lag
  const initScript = `
    $code = @'
    using System;
    using System.Runtime.InteropServices;
    public class Win32Input {
      [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
      [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, int extra);
      [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);
      
      public static void Move(int x, int y) { SetCursorPos(x, y); }
      public static void Click(int x, int y, uint flags) { SetCursorPos(x, y); mouse_event(flags, 0, 0, 0, 0); }
      public static void Mouse(uint flags) { mouse_event(flags, 0, 0, 0, 0); }
      public static void Wheel(int delta) { mouse_event(0x0800, 0, 0, (uint)delta, 0); }
      public static void Key(byte vk, uint flags) { keybd_event(vk, 0, flags, 0); }
    }
'@
    Add-Type -TypeDefinition $code -Language CSharp
    while ($true) {
      $line = [Console]::In.ReadLine()
      if (-not $line) { break }
      Invoke-Expression $line
    }
  `;

  winInputProcess = exec('powershell -NoProfile -NonInteractive -Command -', { windowsHide: true });
  if (winInputProcess && winInputProcess.stdin) {
    winInputProcess.stdin.write(initScript + '\n');
  }
}

// IPC: Ejecución de Eventos de Entrada en el Sistema Operativo
ipcMain.on('execute-input', (event, inputData) => {
  if (!inputData) return;
  const { action, normX, normY, button, key, keyCode, deltaY } = inputData;
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.size;

  let x = Math.round((normX !== undefined ? normX : 0.5) * width);
  let y = Math.round((normY !== undefined ? normY : 0.5) * height);
  x = Math.max(0, Math.min(width - 1, x));
  y = Math.max(0, Math.min(height - 1, y));

  const platform = os.platform();

  if (platform === 'win32' && winInputProcess && winInputProcess.stdin) {
    // Windows: Despacho a través de Win32 API directa
    if (action === 'mousemove') {
      winInputProcess.stdin.write(`[Win32Input]::Move(${x}, ${y})\n`);
    } else if (action === 'mousedown') {
      const flag = button === 2 ? '0x0008' : (button === 1 ? '0x0020' : '0x0002');
      winInputProcess.stdin.write(`[Win32Input]::Click(${x}, ${y}, ${flag})\n`);
    } else if (action === 'mouseup') {
      const flag = button === 2 ? '0x0010' : (button === 1 ? '0x0040' : '0x0004');
      winInputProcess.stdin.write(`[Win32Input]::Click(${x}, ${y}, ${flag})\n`);
    } else if (action === 'click') {
      const down = button === 2 ? '0x0008' : '0x0002';
      const up = button === 2 ? '0x0010' : '0x0004';
      winInputProcess.stdin.write(`[Win32Input]::Click(${x}, ${y}, ${down} -bor ${up})\n`);
    } else if (action === 'dblclick') {
      const down = '0x0002';
      const up = '0x0004';
      winInputProcess.stdin.write(`[Win32Input]::Click(${x}, ${y}, ${down} -bor ${up}); [Win32Input]::Click(${x}, ${y}, ${down} -bor ${up})\n`);
    } else if (action === 'wheel') {
      const delta = deltaY > 0 ? -120 : 120;
      winInputProcess.stdin.write(`[Win32Input]::Wheel(${delta})\n`);
    } else if (action === 'keydown') {
      const vk = keyCode || 0;
      if (vk > 0) {
        winInputProcess.stdin.write(`[Win32Input]::Key(${vk}, 0)\n`);
      }
    } else if (action === 'keyup') {
      const vk = keyCode || 0;
      if (vk > 0) {
        winInputProcess.stdin.write(`[Win32Input]::Key(${vk}, 2)\n`);
      }
    }
  } else if (platform === 'darwin') {
    // macOS: Despacho CoreGraphics nativo
    if (action === 'mousemove') {
      const script = `osascript -l JavaScript -e "ObjC.import('CoreGraphics'); $.CGEventPost($.kCGHIDEventTap, $.CGEventCreateMouseEvent(null, $.kCGEventMouseMoved, $.CGPointMake(${x}, ${y}), 0));"`;
      exec(script, () => {});
    } else if (action === 'click' || action === 'mousedown' || action === 'mouseup') {
      const isRight = button === 2;
      const downType = isRight ? '$.kCGEventRightMouseDown' : '$.kCGEventLeftMouseDown';
      const upType = isRight ? '$.kCGEventRightMouseUp' : '$.kCGEventLeftMouseUp';
      const flag = isRight ? 1 : 0;
      const script = `osascript -l JavaScript -e "ObjC.import('CoreGraphics'); var p = $.CGPointMake(${x}, ${y}); $.CGEventPost($.kCGHIDEventTap, $.CGEventCreateMouseEvent(null, ${downType}, p, ${flag})); $.CGEventPost($.kCGHIDEventTap, $.CGEventCreateMouseEvent(null, ${upType}, p, ${flag}));"`;
      exec(script, () => {});
    } else if (action === 'wheel') {
      const amount = deltaY > 0 ? -5 : 5;
      const script = `osascript -l JavaScript -e "ObjC.import('CoreGraphics'); $.CGEventPost($.kCGHIDEventTap, $.CGEventCreateScrollWheelEvent(null, 0, 1, ${amount}));"`;
      exec(script, () => {});
    } else if (action === 'keydown' && key && key.length === 1) {
      const escaped = key.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      exec(`osascript -e 'tell application "System Events" to keystroke "${escaped}"'`, () => {});
    }
  }
});
