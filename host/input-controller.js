/**
 * Controlador de Entrada Remota (Ratón y Teclado)
 * Traduce coordenadas relativas y despacha acciones al sistema operativo anfitrión.
 */

const { exec } = require('child_process');
const os = require('os');

class InputController {
  constructor(screenWidth = 1920, screenHeight = 1080) {
    this.screenWidth = screenWidth;
    this.screenHeight = screenHeight;
    this.platform = os.platform(); // 'darwin', 'win32', 'linux'
    this.lastX = Math.round(screenWidth / 2);
    this.lastY = Math.round(screenHeight / 2);
    
    console.log(`[InputController] Inicializado para pantalla [${this.screenWidth}x${this.screenHeight}] en SO: ${this.platform}`);
  }

  setScreenResolution(width, height) {
    if (width && height) {
      this.screenWidth = width;
      this.screenHeight = height;
    }
  }

  /**
   * Procesa un evento de entrada enviado desde el cliente web
   * @param {Object} event { action, x, y, button, key, deltaY }
   */
  handleEvent(event) {
    if (!event || !event.action) return;

    // Normalizar coordenadas (el cliente envía ratios normalizados de 0.0 a 1.0 o píxeles directos)
    let targetX = this.lastX;
    let targetY = this.lastY;

    if (typeof event.normX === 'number' && typeof event.normY === 'number') {
      targetX = Math.round(event.normX * this.screenWidth);
      targetY = Math.round(event.normY * this.screenHeight);
    } else if (typeof event.x === 'number' && typeof event.y === 'number') {
      targetX = Math.round(event.x);
      targetY = Math.round(event.y);
    }

    // Asegurar límites de pantalla
    targetX = Math.max(0, Math.min(this.screenWidth - 1, targetX));
    targetY = Math.max(0, Math.min(this.screenHeight - 1, targetY));

    switch (event.action) {
      case 'mousemove':
        this.moveMouse(targetX, targetY);
        break;

      case 'mousedown':
        this.mouseDown(targetX, targetY, event.button || 0);
        break;

      case 'mouseup':
        this.mouseUp(targetX, targetY, event.button || 0);
        break;

      case 'click':
        this.clickMouse(targetX, targetY, event.button || 0);
        break;

      case 'dblclick':
        this.doubleClick(targetX, targetY);
        break;

      case 'wheel':
        this.scroll(event.deltaY || 0);
        break;

      case 'keydown':
        this.keyDown(event.key, event.code);
        break;

      case 'keyup':
        this.keyUp(event.key, event.code);
        break;

      default:
        console.log(`[InputController] Acción no soportada: ${event.action}`);
    }
  }

  moveMouse(x, y) {
    this.lastX = x;
    this.lastY = y;
    
    if (this.platform === 'darwin') {
      // macOS: usando AppleScript con CoreGraphics / JXA
      const script = `osascript -l JavaScript -e "
        ObjC.import('CoreGraphics');
        var point = $.CGPointMake(${x}, ${y});
        $.CGEventPost($.kCGHIDEventTap, $.CGEventCreateMouseEvent(null, $.kCGEventMouseMoved, point, 0));
      "`;
      exec(script, () => {});
    } else if (this.platform === 'linux') {
      exec(`xdotool mousemove ${x} ${y}`, () => {});
    } else if (this.platform === 'win32') {
      const psCommand = `powershell -Command "[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y})"`;
      exec(psCommand, () => {});
    }
  }

  clickMouse(x, y, button = 0) {
    this.lastX = x;
    this.lastY = y;
    const isRightClick = button === 2;

    if (this.platform === 'darwin') {
      const downType = isRightClick ? '$.kCGEventRightMouseDown' : '$.kCGEventLeftMouseDown';
      const upType = isRightClick ? '$.kCGEventRightMouseUp' : '$.kCGEventLeftMouseUp';
      const script = `osascript -l JavaScript -e "
        ObjC.import('CoreGraphics');
        var point = $.CGPointMake(${x}, ${y});
        $.CGEventPost($.kCGHIDEventTap, $.CGEventCreateMouseEvent(null, ${downType}, point, ${isRightClick ? 1 : 0}));
        $.CGEventPost($.kCGHIDEventTap, $.CGEventCreateMouseEvent(null, ${upType}, point, ${isRightClick ? 1 : 0}));
      "`;
      exec(script, () => {});
    } else if (this.platform === 'linux') {
      const btn = isRightClick ? 3 : 1;
      exec(`xdotool mousemove ${x} ${y} click ${btn}`, () => {});
    } else if (this.platform === 'win32') {
      const flag = isRightClick ? '0x08 | 0x10' : '0x02 | 0x04';
      const ps = `powershell -Command "[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y}); $signature = '[DllImport(\\\"user32.dll\\\")] public static extern void mouse_event(int flags, int dx, int dy, int data, int extra);'; $type = Add-Type -MemberDefinition $signature -Name Win32 -PassThru; $type::mouse_event(${flag}, 0, 0, 0, 0)"`;
      exec(ps, () => {});
    }
  }

  mouseDown(x, y, button = 0) {
    const isRight = button === 2;
    if (this.platform === 'darwin') {
      const downType = isRight ? '$.kCGEventRightMouseDown' : '$.kCGEventLeftMouseDown';
      const script = `osascript -l JavaScript -e "
        ObjC.import('CoreGraphics');
        var point = $.CGPointMake(${x}, ${y});
        $.CGEventPost($.kCGHIDEventTap, $.CGEventCreateMouseEvent(null, ${downType}, point, ${isRight ? 1 : 0}));
      "`;
      exec(script, () => {});
    } else if (this.platform === 'linux') {
      exec(`xdotool mousedown ${isRight ? 3 : 1}`, () => {});
    }
  }

  mouseUp(x, y, button = 0) {
    const isRight = button === 2;
    if (this.platform === 'darwin') {
      const upType = isRight ? '$.kCGEventRightMouseUp' : '$.kCGEventLeftMouseUp';
      const script = `osascript -l JavaScript -e "
        ObjC.import('CoreGraphics');
        var point = $.CGPointMake(${x}, ${y});
        $.CGEventPost($.kCGHIDEventTap, $.CGEventCreateMouseEvent(null, ${upType}, point, ${isRight ? 1 : 0}));
      "`;
      exec(script, () => {});
    } else if (this.platform === 'linux') {
      exec(`xdotool mouseup ${isRight ? 3 : 1}`, () => {});
    }
  }

  doubleClick(x, y) {
    this.clickMouse(x, y, 0);
    setTimeout(() => this.clickMouse(x, y, 0), 100);
  }

  scroll(deltaY) {
    const amount = deltaY > 0 ? -5 : 5;
    if (this.platform === 'darwin') {
      const script = `osascript -l JavaScript -e "
        ObjC.import('CoreGraphics');
        $.CGEventPost($.kCGHIDEventTap, $.CGEventCreateScrollWheelEvent(null, 0, 1, ${amount}));
      "`;
      exec(script, () => {});
    } else if (this.platform === 'linux') {
      const btn = deltaY > 0 ? 5 : 4;
      exec(`xdotool click ${btn}`, () => {});
    }
  }

  keyDown(key, code) {
    if (!key) return;
    if (this.platform === 'darwin') {
      // Si es una sola letra o número
      if (key.length === 1) {
        const escaped = key.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        exec(`osascript -e 'tell application "System Events" to keystroke "${escaped}"'`, () => {});
      } else {
        const specialKeys = {
          'Enter': 'return',
          'Backspace': 'delete',
          'Escape': 'escape',
          'Tab': 'tab',
          'Space': 'space',
          'ArrowUp': 'up arrow',
          'ArrowDown': 'down arrow',
          'ArrowLeft': 'left arrow',
          'ArrowRight': 'right arrow'
        };
        const mapped = specialKeys[key];
        if (mapped) {
          exec(`osascript -e 'tell application "System Events" to key code (key code of "${mapped}")' 2>/dev/null || osascript -e 'tell application "System Events" to keystroke (ASCII character 13)'`, () => {});
        }
      }
    } else if (this.platform === 'linux') {
      exec(`xdotool key "${key}"`, () => {});
    }
  }

  keyUp(key, code) {
    // La mayoría de los comandos simples gestionan el stroke completo en el down
  }
}

module.exports = InputController;
