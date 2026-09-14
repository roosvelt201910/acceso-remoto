// Elementos DOM Modo y Host Web
const modeClientBtn = document.getElementById('modeClientBtn');
const modeHostBtn = document.getElementById('modeHostBtn');
const connectionBar = document.getElementById('connectionBar');
const hostBar = document.getElementById('hostBar');
const startScreenShareBtn = document.getElementById('startScreenShareBtn');
const stopScreenShareBtn = document.getElementById('stopScreenShareBtn');
const myHostSessionId = document.getElementById('myHostSessionId');

// Elementos DOM Cliente
const signalingUrlInput = document.getElementById('signalingUrl');
const sessionIdInput = document.getElementById('sessionIdInput');
const connectBtn = document.getElementById('connectBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const pasteBtn = document.getElementById('pasteBtn');
const qualitySelect = document.getElementById('qualitySelect');
const toggleControlBtn = document.getElementById('toggleControlBtn');
const fullscreenBtn = document.getElementById('fullscreenBtn');

const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const rttValue = document.getElementById('rttValue');
const fpsValue = document.getElementById('fpsValue');
const resValue = document.getElementById('resValue');

const welcomeScreen = document.getElementById('welcomeScreen');
const canvasWrapper = document.getElementById('canvasWrapper');
const remoteCanvas = document.getElementById('remoteCanvas');
const ctx = remoteCanvas.getContext('2d');
const toastContainer = document.getElementById('toastContainer');

// Estado de la Aplicación
let ws = null;
let isConnected = false;
let isRemoteControlEnabled = true;
let currentSessionId = null;
let isHostBroadcaster = false;
let hostMediaStream = null;
let hostBroadcastTimer = null;
let generatedHostId = String(Math.floor(100000000 + Math.random() * 900000000));
myHostSessionId.textContent = generatedHostId;

// Métricas y Rendimiento
let frameCount = 0;
let lastFpsTime = performance.now();
let pingInterval = null;
let lastPingTime = 0;
let currentRtt = 0;

// Dimensiones remotas
let remoteWidth = 1920;
let remoteHeight = 1080;

// Throttling de movimiento de ratón
let lastMouseMoveTime = 0;
const MOUSE_THROTTLE_MS = 25; // ~40 actualizaciones de cursor por segundo

// Imagen en memoria para renderizado fluido
const frameImg = new Image();

// ==========================================
// 1. Modos de Operación (Cliente vs Host Web)
// ==========================================

modeClientBtn.addEventListener('click', () => {
  modeClientBtn.classList.add('active');
  modeHostBtn.classList.remove('active');
  connectionBar.style.display = 'block';
  hostBar.style.display = 'none';
  if (isHostBroadcaster) {
    stopWebScreenShare();
  }
});

modeHostBtn.addEventListener('click', () => {
  modeHostBtn.classList.add('active');
  modeClientBtn.classList.remove('active');
  connectionBar.style.display = 'none';
  hostBar.style.display = 'block';
  if (isConnected && !isHostBroadcaster) {
    disconnectSession();
  }
});

startScreenShareBtn.addEventListener('click', async () => {
  await startWebScreenShare();
});

stopScreenShareBtn.addEventListener('click', () => {
  stopWebScreenShare();
});

async function startWebScreenShare() {
  const url = signalingUrlInput.value.trim() || 'ws://localhost:9000';
  
  try {
    hostMediaStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        cursor: 'always',
        frameRate: { ideal: 30, max: 60 }
      },
      audio: false
    });

    const videoTrack = hostMediaStream.getVideoTracks()[0];
    videoTrack.onended = () => {
      stopWebScreenShare();
    };

    // Conectar WebSocket como Host
    ws = new WebSocket(url);

    ws.onopen = () => {
      isHostBroadcaster = true;
      currentSessionId = generatedHostId;
      updateStatus('online', 'Transmitiendo');

      sendJson({
        type: 'REGISTER_HOST',
        sessionId: generatedHostId,
        payload: {
          platform: 'browser-web',
          browser: navigator.userAgent
        }
      });

      startScreenBroadcasting(hostMediaStream);
      startScreenShareBtn.style.display = 'none';
      stopScreenShareBtn.style.display = 'inline-flex';
      showToast(`¡Transmitiendo pantalla en vivo! Comparte el ID: [${generatedHostId}]`, 'success');
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'INPUT_EVENT') {
          showToast(`Evento de entrada recibido: ${msg.payload.action}`, 'info');
        }
      } catch (e) {}
    };

    ws.onclose = () => {
      stopWebScreenShare();
      updateStatus('offline', 'Desconectado');
    };

  } catch (err) {
    showToast('Error al capturar pantalla: ' + err.message, 'error');
  }
}

function startScreenBroadcasting(stream) {
  const video = document.createElement('video');
  video.srcObject = stream;
  video.play();

  const offscreenCanvas = document.createElement('canvas');
  const offscreenCtx = offscreenCanvas.getContext('2d');

  let seq = 0;
  hostBroadcastTimer = setInterval(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN || video.videoWidth === 0) return;

    offscreenCanvas.width = video.videoWidth;
    offscreenCanvas.height = video.videoHeight;
    offscreenCtx.drawImage(video, 0, 0, offscreenCanvas.width, offscreenCanvas.height);

    const dataUrl = offscreenCanvas.toDataURL('image/jpeg', 0.65);
    seq++;

    sendJson({
      type: 'FRAME',
      sessionId: generatedHostId,
      payload: {
        seq: seq,
        width: video.videoWidth,
        height: video.videoHeight,
        data: dataUrl,
        timestamp: Date.now()
      }
    });

    resValue.textContent = `${video.videoWidth} x ${video.videoHeight}`;
  }, 1000 / 25); // 25 FPS
}

function stopWebScreenShare() {
  if (hostBroadcastTimer) {
    clearInterval(hostBroadcastTimer);
    hostBroadcastTimer = null;
  }
  if (hostMediaStream) {
    hostMediaStream.getTracks().forEach(track => track.stop());
    hostMediaStream = null;
  }
  if (ws && isHostBroadcaster) {
    ws.close();
    ws = null;
  }
  isHostBroadcaster = false;
  startScreenShareBtn.style.display = 'inline-flex';
  stopScreenShareBtn.style.display = 'none';
  updateStatus('offline', 'Desconectado');
  showToast('Transmisión de pantalla detenida.', 'info');
}


connectBtn.addEventListener('click', () => {
  const url = signalingUrlInput.value.trim();
  const sessionId = sessionIdInput.value.trim();

  if (!url) {
    showToast('Por favor introduce la URL del servidor de señalización.', 'error');
    return;
  }
  if (!sessionId) {
    showToast('Por favor introduce el ID de sesión del Host.', 'error');
    sessionIdInput.focus();
    return;
  }

  connectToSession(url, sessionId);
});

disconnectBtn.addEventListener('click', () => {
  disconnectSession();
  showToast('Desconectado de la sesión.', 'info');
});

pasteBtn.addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    sessionIdInput.value = text.trim();
    showToast('ID pegado desde el portapapeles.', 'success');
  } catch (err) {
    showToast('No se pudo acceder al portapapeles.', 'error');
  }
});

toggleControlBtn.addEventListener('click', () => {
  isRemoteControlEnabled = !isRemoteControlEnabled;
  toggleControlBtn.classList.toggle('active', isRemoteControlEnabled);
  showToast(
    isRemoteControlEnabled ? 'Control remoto de entrada ACTIVADO' : 'Control remoto DESACTIVADO (Solo ver)',
    'info'
  );
});

qualitySelect.addEventListener('change', (e) => {
  const quality = parseInt(e.target.value, 10);
  if (isConnected && ws) {
    sendJson({
      type: 'CONFIG_CHANGE',
      sessionId: currentSessionId,
      payload: { quality }
    });
    showToast(`Calidad ajustada al ${quality}%`, 'info');
  }
});

fullscreenBtn.addEventListener('click', () => {
  if (!document.fullscreenElement) {
    canvasWrapper.requestFullscreen().catch((err) => {
      showToast('Error al activar pantalla completa: ' + err.message, 'error');
    });
  } else {
    document.exitFullscreen();
  }
});

// Atajos del HUD
document.querySelectorAll('.hud-btn').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const key = btn.getAttribute('data-key');
    if (isConnected && isRemoteControlEnabled) {
      sendInputEvent({ action: 'keydown', key: key, code: key });
      showToast(`Enviado atajo: ${key}`, 'info');
      remoteCanvas.focus();
    }
  });
});

// ==========================================
// 2. Conexión WebSocket y Señalización
// ==========================================

function connectToSession(url, sessionId) {
  updateStatus('connecting', 'Conectando...');
  connectBtn.disabled = true;

  try {
    ws = new WebSocket(url);
  } catch (err) {
    showToast('URL de WebSocket inválida: ' + err.message, 'error');
    updateStatus('offline', 'Desconectado');
    connectBtn.disabled = false;
    return;
  }

  ws.onopen = () => {
    console.log('[Client] Conectado al servidor de señalización.');
    currentSessionId = sessionId;

    // Solicitar unión a la sesión del Host
    sendJson({
      type: 'JOIN_SESSION',
      sessionId: sessionId,
      payload: { userAgent: navigator.userAgent }
    });

    startPingLoop();
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleSignalingMessage(msg);
    } catch (err) {
      console.error('[Client] Error parseando mensaje:', err);
    }
  };

  ws.onclose = () => {
    console.log('[Client] Conexión WebSocket cerrada.');
    handleDisconnection();
  };

  ws.onerror = (err) => {
    console.error('[Client] Error de conexión:', err);
    showToast('Error en el canal de señalización.', 'error');
  };
}

function handleSignalingMessage(msg) {
  switch (msg.type) {
    case 'SESSION_CONNECTED':
      isConnected = true;
      updateStatus('online', 'En Línea');
      showToast(`¡Conectado al Host [${msg.sessionId}]!`, 'success');

      welcomeScreen.style.display = 'none';
      canvasWrapper.style.display = 'flex';
      connectBtn.style.display = 'none';
      disconnectBtn.style.display = 'inline-flex';
      qualitySelect.disabled = false;
      remoteCanvas.focus();
      break;

    case 'FRAME':
      renderFrame(msg);
      break;

    case 'HOST_DISCONNECTED':
      showToast(msg.message || 'El Host se ha desconectado.', 'error');
      disconnectSession();
      break;

    case 'PONG':
      currentRtt = Math.round(performance.now() - lastPingTime);
      rttValue.textContent = `${currentRtt} ms`;
      break;

    case 'ERROR':
      showToast(msg.message || 'Error en la sesión.', 'error');
      disconnectSession();
      break;

    default:
      console.log('[Client] Mensaje no reconocido:', msg.type);
  }
}

function disconnectSession() {
  if (ws) {
    ws.close();
    ws = null;
  }
  handleDisconnection();
}

function handleDisconnection() {
  isConnected = false;
  currentSessionId = null;
  stopPingLoop();

  updateStatus('offline', 'Desconectado');
  welcomeScreen.style.display = 'flex';
  canvasWrapper.style.display = 'none';
  connectBtn.style.display = 'inline-flex';
  connectBtn.disabled = false;
  disconnectBtn.style.display = 'none';
  qualitySelect.disabled = true;

  fpsValue.textContent = '0';
  rttValue.textContent = '-- ms';
}

function updateStatus(state, label) {
  statusDot.className = `status-dot ${state}`;
  statusText.textContent = label;
}

function startPingLoop() {
  stopPingLoop();
  pingInterval = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      lastPingTime = performance.now();
      sendJson({ type: 'PING', sessionId: currentSessionId });
    }
  }, 2000);
}

function stopPingLoop() {
  if (pingInterval) {
    clearInterval(pingInterval);
    pingInterval = null;
  }
}

function sendJson(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

// ==========================================
// 3. Renderizado de Fotogramas en Canvas
// ==========================================

function renderFrame(frameData) {
  if (!frameData || !frameData.data) return;

  // Actualizar resolución nativa reportada si cambia
  if (frameData.width && frameData.height) {
    if (remoteCanvas.width !== frameData.width || remoteCanvas.height !== frameData.height) {
      remoteWidth = frameData.width;
      remoteHeight = frameData.height;
      remoteCanvas.width = frameData.width;
      remoteCanvas.height = frameData.height;
      resValue.textContent = `${remoteWidth} x ${remoteHeight}`;
    }
  }

  frameImg.onload = () => {
    ctx.drawImage(frameImg, 0, 0, remoteCanvas.width, remoteCanvas.height);
    updateFpsCounter();
  };
  frameImg.src = frameData.data;
}

function updateFpsCounter() {
  frameCount++;
  const now = performance.now();
  if (now - lastFpsTime >= 1000) {
    const fps = Math.round((frameCount * 1000) / (now - lastFpsTime));
    fpsValue.textContent = fps;
    frameCount = 0;
    lastFpsTime = now;
  }
}

// ==========================================
// 4. Captura y Normalización de Eventos de Entrada
// ==========================================

/**
 * Calcula la coordenada relativa [0.0 - 1.0] dentro del canvas
 */
function getNormalizedCoordinates(e) {
  const rect = remoteCanvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  const normX = Math.max(0, Math.min(1, x / rect.width));
  const normY = Math.max(0, Math.min(1, y / rect.height));

  return { normX, normY };
}

function sendInputEvent(payload) {
  if (!isConnected || !isRemoteControlEnabled || !ws) return;

  sendJson({
    type: 'INPUT_EVENT',
    sessionId: currentSessionId,
    payload: payload
  });
}

// Eventos de Ratón en el Canvas
remoteCanvas.addEventListener('mousemove', (e) => {
  const now = performance.now();
  if (now - lastMouseMoveTime < MOUSE_THROTTLE_MS) return;
  lastMouseMoveTime = now;

  const { normX, normY } = getNormalizedCoordinates(e);
  sendInputEvent({
    action: 'mousemove',
    normX: normX,
    normY: normY
  });
});

remoteCanvas.addEventListener('mousedown', (e) => {
  e.preventDefault();
  const { normX, normY } = getNormalizedCoordinates(e);
  sendInputEvent({
    action: 'mousedown',
    normX: normX,
    normY: normY,
    button: e.button
  });
});

remoteCanvas.addEventListener('mouseup', (e) => {
  e.preventDefault();
  const { normX, normY } = getNormalizedCoordinates(e);
  sendInputEvent({
    action: 'mouseup',
    normX: normX,
    normY: normY,
    button: e.button
  });
});

remoteCanvas.addEventListener('click', (e) => {
  e.preventDefault();
  const { normX, normY } = getNormalizedCoordinates(e);
  sendInputEvent({
    action: 'click',
    normX: normX,
    normY: normY,
    button: e.button
  });
});

remoteCanvas.addEventListener('dblclick', (e) => {
  e.preventDefault();
  const { normX, normY } = getNormalizedCoordinates(e);
  sendInputEvent({
    action: 'dblclick',
    normX: normX,
    normY: normY
  });
});

remoteCanvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  sendInputEvent({
    action: 'wheel',
    deltaY: e.deltaY,
    deltaX: e.deltaX
  });
}, { passive: false });

remoteCanvas.addEventListener('contextmenu', (e) => {
  e.preventDefault(); // Prevenir menú contextual del navegador
});

// Eventos de Teclado cuando el canvas tiene el foco
remoteCanvas.addEventListener('keydown', (e) => {
  if (!isRemoteControlEnabled) return;
  
  // Prevenir que teclas como Tab, Flechas o Espacio hagan scroll en el navegador
  if (['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
    e.preventDefault();
  }

  sendInputEvent({
    action: 'keydown',
    key: e.key,
    code: e.code,
    ctrlKey: e.ctrlKey,
    altKey: e.altKey,
    shiftKey: e.shiftKey,
    metaKey: e.metaKey
  });
});

remoteCanvas.addEventListener('keyup', (e) => {
  if (!isRemoteControlEnabled) return;
  sendInputEvent({
    action: 'keyup',
    key: e.key,
    code: e.code
  });
});

// ==========================================
// 5. Utilidades y Notificaciones Toast
// ==========================================

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${message}</span>`;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}
