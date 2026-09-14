/**
 * Agente Host de Escritorio Remoto
 * Captura continua de pantalla optimizada y ejecución de eventos de entrada remota.
 */

const path = require('path');
const { WebSocket } = require('ws');
const screenshot = require('screenshot-desktop');
const sharp = require('sharp');
const InputController = require('./input-controller');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const SIGNALING_URL = process.env.SIGNALING_URL || 'ws://localhost:9000';
let SESSION_ID = process.env.SESSION_ID || generateSessionId();
let TARGET_FPS = parseInt(process.env.TARGET_FPS || '20', 10);
let JPEG_QUALITY = parseInt(process.env.JPEG_QUALITY || '60', 10);
const MAX_WIDTH = parseInt(process.env.MAX_WIDTH || '1280', 10);
const MAX_HEIGHT = parseInt(process.env.MAX_HEIGHT || '720', 10);
const ENABLE_REMOTE_CONTROL = process.env.ENABLE_REMOTE_CONTROL !== 'false';

let ws = null;
let isCapturing = false;
let isClientAttached = false;
let captureTimer = null;
let inputController = new InputController(1920, 1080);
let frameSequence = 0;

function generateSessionId() {
  return String(Math.floor(100000000 + Math.random() * 900000000));
}

console.log('====================================================');
console.log('       AGENTE HOST DE ESCRITORIO REMOTO             ');
console.log('    Desarrollado por: Ing. Roosvelt Enriquez Gamez  ');
console.log('====================================================');
console.log(`[Config] ID de Sesión: ${SESSION_ID}`);
console.log(`[Config] Servidor de Señalización: ${SIGNALING_URL}`);
console.log(`[Config] FPS Objetivo: ${TARGET_FPS} | Calidad JPEG: ${JPEG_QUALITY}%`);
console.log(`[Config] Control Remoto: ${ENABLE_REMOTE_CONTROL ? 'Habilitado' : 'Deshabilitado'}`);
console.log('====================================================');

/**
 * Conecta el Host al Servidor de Señalización
 */
function connectSignaling() {
  console.log(`[Host] Conectando con servidor de señalización...`);
  
  ws = new WebSocket(SIGNALING_URL);

  ws.on('open', () => {
    console.log(`[Host] Conexión establecida con el servidor de señalización.`);
    
    // Anunciar registro del Host
    sendJson({
      type: 'REGISTER_HOST',
      sessionId: SESSION_ID,
      payload: {
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        targetFps: TARGET_FPS,
        quality: JPEG_QUALITY
      }
    });
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      handleSignalingMessage(msg);
    } catch (err) {
      console.error('[Host] Error procesando mensaje de señalización:', err.message);
    }
  });

  ws.on('close', () => {
    console.warn('[Host] Conexión cerrada con el servidor. Reintentando en 3 segundos...');
    stopCapture();
    isClientAttached = false;
    setTimeout(connectSignaling, 3000);
  });

  ws.on('error', (err) => {
    console.error('[Host] Error de WebSocket:', err.message);
  });
}

/**
 * Manejador de eventos de señalización y control
 */
function handleSignalingMessage(msg) {
  switch (msg.type) {
    case 'HOST_REGISTERED':
      console.log(`\n>>> HOST LISTO PARA CONEXIÓN <<<`);
      console.log(`>>> Para conectarte desde el cliente web, usa el ID: [ ${msg.sessionId} ] <<<\n`);
      break;

    case 'CLIENT_ATTACHED':
      console.log(`[Host] ¡Cliente conectado! Iniciando transmisión de pantalla...`);
      isClientAttached = true;
      startCapture();
      break;

    case 'CLIENT_DETACHED':
      console.log(`[Host] Cliente desconectado. Deteniendo transmisión de pantalla para ahorrar recursos.`);
      isClientAttached = false;
      stopCapture();
      break;

    case 'INPUT_EVENT':
      if (ENABLE_REMOTE_CONTROL && isClientAttached) {
        inputController.handleEvent(msg.payload);
      }
      break;

    case 'CONFIG_CHANGE':
      if (msg.payload) {
        if (msg.payload.quality) JPEG_QUALITY = Math.max(10, Math.min(100, msg.payload.quality));
        if (msg.payload.fps) {
          TARGET_FPS = Math.max(5, Math.min(60, msg.payload.fps));
          restartCaptureLoop();
        }
        console.log(`[Host] Configuración actualizada: Calidad=${JPEG_QUALITY}%, FPS=${TARGET_FPS}`);
      }
      break;

    case 'PONG':
      break;

    case 'ERROR':
      console.error(`[Host] Error recibido del servidor:`, msg.message);
      break;

    default:
      console.log(`[Host] Mensaje no gestionado: ${msg.type}`);
  }
}

/**
 * Bucle de captura y compresión continua de pantalla
 */
async function captureAndSendFrame() {
  if (!isClientAttached || !ws || ws.readyState !== WebSocket.OPEN) {
    return;
  }

  const startTime = Date.now();

  try {
    let compressedBuffer;
    let width = 1280;
    let height = 720;

    try {
      // 1. Intentar capturar pantalla real del sistema
      const rawBuffer = await screenshot({ format: 'png' });
      const image = sharp(rawBuffer);
      const metadata = await image.metadata();

      width = metadata.width || 1280;
      height = metadata.height || 720;
      inputController.setScreenResolution(width, height);

      compressedBuffer = await image
        .resize({
          width: Math.min(width, MAX_WIDTH),
          height: Math.min(height, MAX_HEIGHT),
          fit: 'inside',
          withoutEnlargement: true
        })
        .jpeg({ quality: JPEG_QUALITY })
        .toBuffer();
    } catch (captureErr) {
      // Fallback dinámico (patrón de prueba interactivo cuando falta permiso de Grabación de Pantalla en macOS)
      const nowStr = new Date().toLocaleTimeString();
      const svg = `<svg width="${MAX_WIDTH}" height="${MAX_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#0f172a" />
            <stop offset="100%" stop-color="#1e293b" />
          </linearGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#bg)" />
        <rect x="40" y="40" width="${MAX_WIDTH - 80}" height="${MAX_HEIGHT - 80}" rx="16" fill="#141822" stroke="#00e5ff" stroke-width="2" stroke-dasharray="8 4" opacity="0.6"/>
        <text x="${MAX_WIDTH / 2}" y="180" font-family="sans-serif" font-size="34" font-weight="bold" fill="#00e5ff" text-anchor="middle">ESCRITORIO REMOTO ACTIVO</text>
        <text x="${MAX_WIDTH / 2}" y="240" font-family="sans-serif" font-size="20" fill="#f8fafc" text-anchor="middle">Sesión ID: ${SESSION_ID} | FPS: ${TARGET_FPS} | Frame: #${frameSequence}</text>
        <text x="${MAX_WIDTH / 2}" y="300" font-family="monospace" font-size="42" font-weight="bold" fill="#00e676" text-anchor="middle">${nowStr}</text>
        <circle cx="${inputController.lastX}" cy="${inputController.lastY}" r="12" fill="#ff1744" opacity="0.85"/>
        <text x="${inputController.lastX + 18}" y="${inputController.lastY + 5}" font-family="monospace" font-size="14" fill="#ffffff">Cursor (${inputController.lastX}, ${inputController.lastY})</text>
        <text x="${MAX_WIDTH / 2}" y="${MAX_HEIGHT - 100}" font-family="sans-serif" font-size="14" fill="#94a3b8" text-anchor="middle">Modo Interactivo: Haz clic o mueve el ratón en el Canvas para controlar el cursor.</text>
      </svg>`;

      compressedBuffer = await sharp(Buffer.from(svg))
        .jpeg({ quality: JPEG_QUALITY })
        .toBuffer();
    }

    // 2. Empaquetar y enviar el fotograma al cliente
    const base64Data = compressedBuffer.toString('base64');
    frameSequence++;

    sendJson({
      type: 'FRAME',
      sessionId: SESSION_ID,
      payload: {
        seq: frameSequence,
        width: width,
        height: height,
        data: `data:image/jpeg;base64,${base64Data}`,
        timestamp: Date.now()
      }
    });

  } catch (err) {
    console.error('[Host] Error al procesar fotograma:', err.message);
  }
}

function startCapture() {
  if (isCapturing) return;
  isCapturing = true;
  const intervalMs = Math.round(1000 / TARGET_FPS);
  console.log(`[Host] Bucle de captura activo a ${TARGET_FPS} FPS (${intervalMs}ms por fotograma).`);
  captureTimer = setInterval(captureAndSendFrame, intervalMs);
}

function stopCapture() {
  isCapturing = false;
  if (captureTimer) {
    clearInterval(captureTimer);
    captureTimer = null;
  }
}

function restartCaptureLoop() {
  if (isCapturing) {
    stopCapture();
    startCapture();
  }
}

function sendJson(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

// Iniciar agente
connectSignaling();

// Manejo de salida limpia
process.on('SIGINT', () => {
  console.log('\n[Host] Apagando agente host...');
  stopCapture();
  if (ws) ws.close();
  process.exit(0);
});
