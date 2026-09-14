const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const dgram = require('dgram');
const os = require('os');
const { WebSocketServer, WebSocket } = require('ws');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const PORT = parseInt(process.env.PORT || '9000', 10);
const UDP_PORT = 9001;
const HOST = process.env.HOST || '0.0.0.0';
const SSL_ENABLED = process.env.SSL_ENABLED === 'true';

// Obtener IP local de la máquina
function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

const localServerIp = getLocalIpAddress();

// ========================================================
// Servicio de Autodescubrimiento UDP (Zero-Configuration LAN)
// ========================================================
const udpServer = dgram.createSocket({ type: 'udp4', reuseAddr: true });

udpServer.on('error', (err) => {
  console.warn('[UDP AutoDiscovery] Advertencia en socket UDP:', err.message);
});

udpServer.on('message', (msg, rinfo) => {
  try {
    const data = JSON.parse(msg.toString());
    if (data.type === 'DISCOVER_SIGNALING_SERVER') {
      const response = JSON.stringify({
        type: 'SIGNALING_SERVER_FOUND',
        serverUrl: `ws://${localServerIp}:${PORT}`,
        ip: localServerIp,
        port: PORT
      });
      udpServer.send(response, rinfo.port, rinfo.address);
    }
  } catch (e) {}
});

udpServer.bind(UDP_PORT, () => {
  udpServer.setBroadcast(true);
  console.log(`[UDP AutoDiscovery] Transmisor de baliza automático activo en puerto ${UDP_PORT}`);

  // Emitir baliza cada 2 segundos a toda la red local
  setInterval(() => {
    const beacon = JSON.stringify({
      type: 'SIGNALING_SERVER_FOUND',
      serverUrl: `ws://${localServerIp}:${PORT}`,
      ip: localServerIp,
      port: PORT,
      timestamp: Date.now()
    });
    udpServer.send(beacon, UDP_PORT, '255.255.255.255', () => {});
  }, 2000);
});

// Tabla de sesiones en memoria: sessionId -> { hostWs, clientWs, hostMeta, createdAt }
const sessions = new Map();

// Crear servidor HTTP o HTTPS según configuración
let server;
if (SSL_ENABLED) {
  const keyPath = path.resolve(__dirname, process.env.SSL_KEY_PATH || './certs/key.pem');
  const certPath = path.resolve(__dirname, process.env.SSL_CERT_PATH || './certs/cert.pem');
  
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    server = https.createServer({
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath)
    });
    console.log('[Server] Modo seguro TLS/WSS activado.');
  } else {
    console.warn('[Server] Certificados no encontrados, recurriendo a HTTP/WS estándar.');
    server = http.createServer();
  }
} else {
  server = http.createServer();
}

// Endpoint HTTP de diagnóstico rápido
server.on('request', (req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', activeSessions: sessions.size, uptime: process.uptime() }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Servidor de Señalización de Acceso Remoto Activo.');
});

const wss = new WebSocketServer({ server });

console.log(`[Server] Inicializando Servidor de Señalización en ${SSL_ENABLED ? 'wss' : 'ws'}://${HOST}:${PORT}`);

wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  ws.isAlive = true;
  ws.sessionId = null;
  ws.clientRole = null; // 'HOST' o 'CLIENT'

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (data, isBinary) => {
    // Si es mensaje binario (por ejemplo, fotograma directo optimizado)
    if (isBinary) {
      if (ws.clientRole === 'HOST' && ws.sessionId) {
        const session = sessions.get(ws.sessionId);
        if (session && session.clientWs && session.clientWs.readyState === WebSocket.OPEN) {
          session.clientWs.send(data, { binary: true });
        }
      }
      return;
    }

    // Mensajes de control / JSON
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch (err) {
      console.error('[Server] Formato de mensaje JSON inválido:', err.message);
      return;
    }

    handleMessage(ws, message, clientIp);
  });

  ws.on('close', () => {
    handleDisconnect(ws);
  });

  ws.on('error', (err) => {
    console.error(`[Server] Error en socket [${ws.sessionId || 'sin-sesion'}]:`, err.message);
  });
});

/**
 * Enrutador de mensajes de señalización y control
 */
function handleMessage(ws, message, clientIp) {
  const { type, sessionId, payload } = message;

  switch (type) {
    case 'REGISTER_HOST': {
      // El Host registra un ID de sesión (generado o predeterminado)
      const targetId = String(sessionId || generateRandomSessionId());
      
      // Si ya existía una sesión previa con ese ID, cerrar la anterior
      if (sessions.has(targetId)) {
        const oldSession = sessions.get(targetId);
        if (oldSession.hostWs && oldSession.hostWs !== ws) {
          oldSession.hostWs.close();
        }
      }

      ws.sessionId = targetId;
      ws.clientRole = 'HOST';
      
      sessions.set(targetId, {
        hostWs: ws,
        clientWs: null,
        hostMeta: payload || {},
        createdAt: Date.now()
      });

      console.log(`[Host Conectado] Sesión registrada: [ID: ${targetId}] desde ${clientIp}`);

      sendJson(ws, {
        type: 'HOST_REGISTERED',
        sessionId: targetId,
        message: 'Host registrado exitosamente. Listo para recibir conexiones de clientes.'
      });
      break;
    }

    case 'JOIN_SESSION': {
      // Un cliente web solicita unirse a un Host por su ID
      const targetId = String(sessionId);
      const session = sessions.get(targetId);

      if (!session || !session.hostWs || session.hostWs.readyState !== WebSocket.OPEN) {
        console.warn(`[Cliente Rechazado] Intento de conexión a sesión inexistente o inactiva: ${targetId}`);
        sendJson(ws, {
          type: 'ERROR',
          code: 'SESSION_NOT_FOUND',
          message: `La sesión [${targetId}] no existe o el Host no está en línea.`
        });
        return;
      }

      ws.sessionId = targetId;
      ws.clientRole = 'CLIENT';
      session.clientWs = ws;

      console.log(`[Cliente Conectado] Emparejado con Host: [ID: ${targetId}]`);

      // Notificar al cliente que la conexión fue aceptada con la metadata del host (resolución, etc.)
      sendJson(ws, {
        type: 'SESSION_CONNECTED',
        sessionId: targetId,
        hostMeta: session.hostMeta
      });

      // Notificar al Host que hay un cliente conectado
      sendJson(session.hostWs, {
        type: 'CLIENT_ATTACHED',
        sessionId: targetId
      });
      break;
    }

    case 'FRAME': {
      // Retransmisión de fotograma desde Host hacia Cliente (modo payload JSON / base64)
      if (ws.clientRole === 'HOST' && ws.sessionId) {
        const session = sessions.get(ws.sessionId);
        if (session && session.clientWs && session.clientWs.readyState === WebSocket.OPEN) {
          sendJson(session.clientWs, {
            type: 'FRAME',
            data: payload.data, // Buffer base64 o metadatos
            width: payload.width,
            height: payload.height,
            timestamp: payload.timestamp
          });
        }
      }
      break;
    }

    case 'INPUT_EVENT': {
      // Evento de ratón/teclado desde Cliente hacia Host
      if (ws.clientRole === 'CLIENT' && ws.sessionId) {
        const session = sessions.get(ws.sessionId);
        if (session && session.hostWs && session.hostWs.readyState === WebSocket.OPEN) {
          sendJson(session.hostWs, {
            type: 'INPUT_EVENT',
            payload: payload
          });
        }
      }
      break;
    }

    case 'CONFIG_CHANGE': {
      // Ajuste dinámico de calidad / FPS solicitado por el cliente
      if (ws.sessionId) {
        const session = sessions.get(ws.sessionId);
        const target = ws.clientRole === 'CLIENT' ? session?.hostWs : session?.clientWs;
        if (target && target.readyState === WebSocket.OPEN) {
          sendJson(target, { type: 'CONFIG_CHANGE', payload });
        }
      }
      break;
    }

    case 'PING': {
      sendJson(ws, { type: 'PONG', timestamp: payload?.timestamp || Date.now() });
      break;
    }

    default:
      console.warn(`[Server] Tipo de mensaje no reconocido: ${type}`);
  }
}

/**
 * Manejo de desconexiones
 */
function handleDisconnect(ws) {
  if (!ws.sessionId) return;

  const session = sessions.get(ws.sessionId);
  if (!session) return;

  if (ws.clientRole === 'HOST') {
    console.log(`[Host Desconectado] Sesión finalizada: ${ws.sessionId}`);
    if (session.clientWs && session.clientWs.readyState === WebSocket.OPEN) {
      sendJson(session.clientWs, {
        type: 'HOST_DISCONNECTED',
        message: 'El equipo remoto (Host) se ha desconectado.'
      });
    }
    sessions.delete(ws.sessionId);
  } else if (ws.clientRole === 'CLIENT') {
    console.log(`[Cliente Desconectado] Sesión: ${ws.sessionId}`);
    session.clientWs = null;
    if (session.hostWs && session.hostWs.readyState === WebSocket.OPEN) {
      sendJson(session.hostWs, {
        type: 'CLIENT_DETACHED',
        message: 'El cliente de control remoto se ha desconectado.'
      });
    }
  }
}

/**
 * Envío seguro de JSON a través del socket
 */
function sendJson(ws, obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

/**
 * Genera un ID de sesión de 9 dígitos estilo AnyDesk (ej. 482-910-334)
 */
function generateRandomSessionId() {
  const num = Math.floor(100000000 + Math.random() * 900000000);
  return String(num);
}

// Heartbeat para limpiar sockets inactivos o zombies cada 30 segundos
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) {
      console.log(`[Server] Terminando conexión inactiva.`);
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => {
  clearInterval(interval);
});

server.listen(PORT, HOST, () => {
  console.log(`=== SERVIDOR DE SEÑALIZACIÓN EN LÍNEA ===`);
  console.log(`URL Local: ${SSL_ENABLED ? 'wss' : 'ws'}://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`Health Check: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/health`);
  console.log(`==========================================`);
});
