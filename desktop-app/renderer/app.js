// Elementos DOM
const myDesktopIdEl = document.getElementById('myDesktopId');
const copyIdBtn = document.getElementById('copyIdBtn');
const targetIdInput = document.getElementById('targetIdInput');
const startRemoteSessionBtn = document.getElementById('startRemoteSessionBtn');
const statusDot = document.getElementById('statusDot');
const statusLabel = document.getElementById('statusLabel');

const mainDashboard = document.getElementById('mainDashboard');
const remoteSessionView = document.getElementById('remoteSessionView');
const connectedTargetIdEl = document.getElementById('connectedTargetId');
const disconnectSessionBtn = document.getElementById('disconnectSessionBtn');
const desktopCanvas = document.getElementById('desktopCanvas');
const ctx = desktopCanvas.getContext('2d');

// Generar o recuperar ID de esta máquina
let myStationId = localStorage.getItem('anydesk_station_id');
if (!myStationId) {
  myStationId = String(Math.floor(100000000 + Math.random() * 900000000));
  localStorage.setItem('anydesk_station_id', myStationId);
}
myDesktopIdEl.textContent = formatId(myStationId);

function formatId(id) {
  return id.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3');
}

// Servidor Central de Señalización en la Nube (Internet 24/7)
const DEFAULT_SIGNALING_SERVER = 'wss://acceso-remoto.onrender.com';
let currentActiveServerUrl = DEFAULT_SIGNALING_SERVER;

// Sockets
let hostWs = null;
let clientWs = null;
let screenStream = null;
let broadcastTimer = null;
const frameImg = new Image();

// Inicialización con autodescubrimiento Zero-Config
async function startAutoDiscovery() {
  if (window.electronAPI && window.electronAPI.getDiscoveredServer) {
    try {
      const autoUrl = await window.electronAPI.getDiscoveredServer();
      if (autoUrl) currentActiveServerUrl = autoUrl;
      window.electronAPI.onServerDiscovered((url) => {
        if (url && url !== currentActiveServerUrl) {
          currentActiveServerUrl = url;
          if (!hostWs || hostWs.readyState !== WebSocket.OPEN) {
            initHostAgent();
          }
        }
      });
    } catch (e) {}
  }
  initHostAgent();
}

// ========================================================
// 1. Inicializar Agente Host Automático en Segundo Plano
// ========================================================
async function initHostAgent() {
  const url = currentActiveServerUrl || DEFAULT_SIGNALING_SERVER;
  statusDot.className = 'status-dot';
  statusLabel.textContent = 'Conectando a red automática...';

  try {
    if (hostWs) {
      hostWs.close();
    }
    hostWs = new WebSocket(url);

    let pingInterval = null;

    hostWs.onopen = () => {
      console.log('[Desktop Host] Conectado exitosamente al servidor de señalización:', url);
      statusDot.className = 'status-dot online';
      statusLabel.textContent = 'En Línea';

      hostWs.send(JSON.stringify({
        type: 'REGISTER_HOST',
        sessionId: myStationId,
        payload: { app: 'electron-desktop' }
      }));

      // Mantener conexión activa 24/7 con Heartbeat Ping
      if (pingInterval) clearInterval(pingInterval);
      pingInterval = setInterval(() => {
        if (hostWs && hostWs.readyState === WebSocket.OPEN) {
          hostWs.send(JSON.stringify({ type: 'PING' }));
        }
      }, 15000);
    };

    hostWs.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'CLIENT_ATTACHED') {
          console.log('[Desktop Host] ¡Cliente remoto conectado! Iniciando captura de pantalla...');
          await startScreenCaptureBroadcaster();
        } else if (msg.type === 'CLIENT_DETACHED') {
          console.log('[Desktop Host] Cliente desconectado.');
          stopScreenCaptureBroadcaster();
        } else if (msg.type === 'INPUT_EVENT') {
          // Ejecutar evento nativo de ratón o teclado en el SO
          if (window.electronAPI) {
            window.electronAPI.executeInput(msg.payload);
          }
        }
      } catch (e) {}
    };

    hostWs.onclose = () => {
      if (pingInterval) clearInterval(pingInterval);
      statusDot.className = 'status-dot';
      statusLabel.textContent = 'Reconectando al servidor...';
      setTimeout(initHostAgent, 3000);
    };

    hostWs.onerror = (err) => {
      console.warn('Error en conexión con servidor de señalización:', url);
      statusDot.className = 'status-dot';
      statusLabel.textContent = 'Servidor no disponible (' + url + ')';
      try { hostWs.close(); } catch(e) {}
    };
  } catch (err) {
    console.error('Error conectando host:', err);
    statusLabel.textContent = 'Error de conexión';
    setTimeout(initHostAgent, 4000);
  }
}

async function startScreenCaptureBroadcaster() {
  if (broadcastTimer) return;

  try {
    console.log('[Desktop Host] Iniciando transmisión de pantalla en tiempo real...');

    // 1. Intentar getDisplayMedia (aprobado por setDisplayMediaRequestHandler)
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: 'always',
          frameRate: { ideal: 30, max: 60 }
        },
        audio: false
      });
    } catch (err1) {
      console.log('[Desktop Host] Recurriendo a getUserMedia legacy:', err1.message);
      const sources = await window.electronAPI.getScreenSources();
      const primarySource = sources[0] || { id: 'screen:0:0' };

      screenStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: primarySource.id
          }
        }
      });
    }

    const video = document.createElement('video');
    video.srcObject = screenStream;
    video.muted = true;
    await video.play();

    const offscreenCanvas = document.createElement('canvas');
    const offCtx = offscreenCanvas.getContext('2d');

    let seq = 0;
    broadcastTimer = setInterval(() => {
      if (!hostWs || hostWs.readyState !== WebSocket.OPEN || video.videoWidth === 0) return;

      offscreenCanvas.width = video.videoWidth;
      offscreenCanvas.height = video.videoHeight;
      offCtx.drawImage(video, 0, 0, offscreenCanvas.width, offscreenCanvas.height);

      const jpegBase64 = offscreenCanvas.toDataURL('image/jpeg', 0.65);
      seq++;

      hostWs.send(JSON.stringify({
        type: 'FRAME',
        sessionId: myStationId,
        payload: {
          seq: seq,
          width: video.videoWidth,
          height: video.videoHeight,
          data: jpegBase64,
          timestamp: Date.now()
        }
      }));
    }, 1000 / 25); // 25 FPS

    console.log('[Desktop Host] Transmisión activa a 25 FPS.');

  } catch (err) {
    console.error('Error al capturar pantalla del host:', err);
  }
}

function stopScreenCaptureBroadcaster() {
  if (broadcastTimer) {
    clearInterval(broadcastTimer);
    broadcastTimer = null;
  }
  if (screenStream) {
    screenStream.getTracks().forEach(t => t.stop());
    screenStream = null;
  }
}

// ========================================================
// 2. Conexión de Cliente (Controlar otra PC)
// ========================================================
startRemoteSessionBtn.addEventListener('click', () => {
  const targetId = targetIdInput.value.replace(/\s+/g, '').replace(/-/g, '').trim();

  if (!targetId) {
    alert('Introduce el ID de la PC a la que te deseas conectar.');
    return;
  }

  connectToRemotePc(currentActiveServerUrl, targetId);
});

let connectedSessionTargetId = null;

function connectToRemotePc(url, targetId) {
  statusLabel.textContent = 'Conectando a ' + targetId + '...';

  try {
    clientWs = new WebSocket(url);
  } catch (err) {
    alert('URL de servidor inválida: ' + url);
    return;
  }

  clientWs.onopen = () => {
    clientWs.send(JSON.stringify({
      type: 'JOIN_SESSION',
      sessionId: targetId,
      payload: {}
    }));
  };

  clientWs.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'SESSION_CONNECTED') {
        connectedSessionTargetId = targetId;
        connectedTargetIdEl.textContent = formatId(targetId);
        mainDashboard.style.display = 'none';
        remoteSessionView.style.display = 'flex';
        desktopCanvas.focus();
      } else if (msg.type === 'FRAME') {
        renderRemoteFrame(msg);
      } else if (msg.type === 'ERROR' || msg.type === 'HOST_DISCONNECTED') {
        alert(msg.message || 'El equipo remoto no está en línea o el ID no existe.');
        disconnectRemoteSession();
      }
    } catch (e) {}
  };

  clientWs.onerror = () => {
    alert('No se pudo conectar al servidor en la nube.');
    disconnectRemoteSession();
  };

  clientWs.onclose = () => {
    disconnectRemoteSession();
  };
}

function renderRemoteFrame(frameData) {
  if (!frameData) return;
  const imgData = frameData.data || (frameData.payload && frameData.payload.data);
  if (!imgData) return;

  const width = frameData.width || (frameData.payload && frameData.payload.width) || 1280;
  const height = frameData.height || (frameData.payload && frameData.payload.height) || 720;

  if (desktopCanvas.width !== width || desktopCanvas.height !== height) {
    desktopCanvas.width = width;
    desktopCanvas.height = height;
  }

  frameImg.onload = () => {
    ctx.drawImage(frameImg, 0, 0, desktopCanvas.width, desktopCanvas.height);
  };
  frameImg.src = imgData;
}

function disconnectRemoteSession() {
  if (clientWs) {
    clientWs.close();
    clientWs = null;
  }
  connectedSessionTargetId = null;
  mainDashboard.style.display = 'flex';
  remoteSessionView.style.display = 'none';
}

disconnectSessionBtn.addEventListener('click', disconnectRemoteSession);

// ========================================================
// 3. Captura y Envío de Control Total (Ratón y Teclado)
// ========================================================

function getCanvasCoordinates(e) {
  const rect = desktopCanvas.getBoundingClientRect();
  const normX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  const normY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
  return { normX, normY };
}

function sendRemoteInput(payload) {
  if (!clientWs || clientWs.readyState !== WebSocket.OPEN || !connectedSessionTargetId) return;
  clientWs.send(JSON.stringify({
    type: 'INPUT_EVENT',
    sessionId: connectedSessionTargetId,
    payload: payload
  }));
}

// Movimiento de Ratón (Throttled a ~40 updates/seg)
let lastMoveTime = 0;
desktopCanvas.addEventListener('mousemove', (e) => {
  const now = performance.now();
  if (now - lastMoveTime < 25) return;
  lastMoveTime = now;

  const { normX, normY } = getCanvasCoordinates(e);
  sendRemoteInput({ action: 'mousemove', normX, normY });
});

// Clics y Pulsaciones de Ratón
desktopCanvas.addEventListener('mousedown', (e) => {
  e.preventDefault();
  const { normX, normY } = getCanvasCoordinates(e);
  sendRemoteInput({ action: 'mousedown', normX, normY, button: e.button });
});

desktopCanvas.addEventListener('mouseup', (e) => {
  e.preventDefault();
  const { normX, normY } = getCanvasCoordinates(e);
  sendRemoteInput({ action: 'mouseup', normX, normY, button: e.button });
});

desktopCanvas.addEventListener('dblclick', (e) => {
  e.preventDefault();
  const { normX, normY } = getCanvasCoordinates(e);
  sendRemoteInput({ action: 'dblclick', normX, normY });
});

desktopCanvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  sendRemoteInput({ action: 'wheel', deltaY: e.deltaY, deltaX: e.deltaX });
}, { passive: false });

desktopCanvas.addEventListener('contextmenu', (e) => {
  e.preventDefault(); // Deshabilitar menú local para enviar clic derecho remoto
});

// Teclado Interactivo Remoto
window.addEventListener('keydown', (e) => {
  if (!connectedSessionTargetId || !clientWs || clientWs.readyState !== WebSocket.OPEN) return;
  
  if (['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
    e.preventDefault();
  }

  sendRemoteInput({
    action: 'keydown',
    key: e.key,
    keyCode: e.keyCode,
    ctrlKey: e.ctrlKey,
    altKey: e.altKey,
    shiftKey: e.shiftKey
  });
});

window.addEventListener('keyup', (e) => {
  if (!connectedSessionTargetId || !clientWs || clientWs.readyState !== WebSocket.OPEN) return;
  sendRemoteInput({
    action: 'keyup',
    key: e.key,
    keyCode: e.keyCode
  });
});

copyIdBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(myStationId);
  copyIdBtn.textContent = '¡Copiado!';
  setTimeout(() => copyIdBtn.textContent = 'Copiar', 2000);
});

// Arrancar agente host local con autodescubrimiento Zero-Config
startAutoDiscovery();
