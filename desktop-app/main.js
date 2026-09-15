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

const fs = require('fs');
const { spawn } = require('child_process');

let winInputProcess = null;

function initWinInput() {
  if (os.platform() !== 'win32') return;
  try {
    const scriptPath = path.join(app.getPath('temp'), 'roosvelt-win-input.ps1');
    const scriptContent = `Add-Type -AssemblyName System.Windows.Forms
$code = @'
using System;
using System.Runtime.InteropServices;
public class Win32Input {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, int extra);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);
  
  public static void M(int x, int y) { SetCursorPos(x, y); }
  public static void C(int x, int y, uint f) { SetCursorPos(x, y); mouse_event(f, 0, 0, 0, 0); }
  public static void W(int d) { mouse_event(0x0800, 0, 0, (uint)d, 0); }
  public static void Key(byte k, uint f) { keybd_event(k, 0, f, 0); }
}
'@
Add-Type -TypeDefinition $code -Language CSharp
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    if ($line.Trim().Length -eq 0) { continue }
    try {
        Invoke-Expression $line
    } catch {}
}
`;
    fs.writeFileSync(scriptPath, scriptContent, 'utf8');

    winInputProcess = spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-File', scriptPath
    ], {
      windowsHide: true,
      stdio: ['pipe', 'ignore', 'ignore']
    });

    winInputProcess.on('exit', () => {
      winInputProcess = null;
    });
  } catch (err) {
    console.error('Error iniciando controlador de entrada Win32:', err);
  }
}

// Inicialización de la aplicación
app.whenReady().then(() => {
  // Inicializar controlador Win32 si estamos en Windows
  initWinInput();

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
  if (winInputProcess) {
    try { winInputProcess.kill(); } catch (e) {}
  }
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

// IPC: Ejecución de Eventos de Entrada en el Sistema Operativo
ipcMain.on('execute-input', (event, inputData) => {
  if (!inputData) return;
  const { action, normX, normY, button, key, keyCode, deltaY } = inputData;
  const primaryDisplay = screen.getPrimaryDisplay();
  const scale = primaryDisplay.scaleFactor || 1;
  const width = Math.round(primaryDisplay.bounds.width * scale);
  const height = Math.round(primaryDisplay.bounds.height * scale);

  let x = Math.round((normX !== undefined ? normX : 0.5) * width);
  let y = Math.round((normY !== undefined ? normY : 0.5) * height);
  x = Math.max(0, Math.min(width - 1, x));
  y = Math.max(0, Math.min(height - 1, y));

  const platform = os.platform();

  if (platform === 'win32') {
    if (!winInputProcess || !winInputProcess.stdin || winInputProcess.killed) {
      initWinInput();
    }
    if (winInputProcess && winInputProcess.stdin) {
      try {
        if (action === 'mousemove') {
          winInputProcess.stdin.write(`[Win32Input]::M(${x}, ${y})\r\n`);
        } else if (action === 'mousedown') {
          const flag = button === 2 ? 0x0008 : (button === 1 ? 0x0020 : 0x0002);
          winInputProcess.stdin.write(`[Win32Input]::C(${x}, ${y}, ${flag})\r\n`);
        } else if (action === 'mouseup') {
          const flag = button === 2 ? 0x0010 : (button === 1 ? 0x0040 : 0x0004);
          winInputProcess.stdin.write(`[Win32Input]::C(${x}, ${y}, ${flag})\r\n`);
        } else if (action === 'click') {
          const flag = button === 2 ? 24 : 6;
          winInputProcess.stdin.write(`[Win32Input]::C(${x}, ${y}, ${flag})\r\n`);
        } else if (action === 'dblclick') {
          winInputProcess.stdin.write(`[Win32Input]::C(${x}, ${y}, 6); [Win32Input]::C(${x}, ${y}, 6)\r\n`);
        } else if (action === 'wheel') {
          const delta = deltaY > 0 ? -120 : 120;
          winInputProcess.stdin.write(`[Win32Input]::W(${delta})\r\n`);
        } else if (action === 'keydown') {
          const vk = keyCode || 0;
          if (vk > 0) {
            winInputProcess.stdin.write(`[Win32Input]::Key(${vk}, 0)\r\n`);
          }
        } else if (action === 'keyup') {
          const vk = keyCode || 0;
          if (vk > 0) {
            winInputProcess.stdin.write(`[Win32Input]::Key(${vk}, 2)\r\n`);
          }
        }
      } catch (e) {
        console.error('Error escribiendo en winInputProcess:', e);
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
