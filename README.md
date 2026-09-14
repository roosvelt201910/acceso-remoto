# Sistema de Escritorio Remoto Minimalista (Estilo AnyDesk)
**Autor y Desarrollador:** Ing. Roosvelt Enriquez Gamez

Un sistema de acceso y control remoto autónomo, modular y de baja latencia construido en **Node.js**, **WebSockets** y **HTML5 Canvas**.

---

## 🏛 Arquitectura del Sistema

El sistema está dividido en **tres módulos totalmente independientes y desacoplados**:

```mermaid
flowchart LR
    subgraph Host["🖥️ Agente Host (Equipo Remoto)"]
        H1[Capturador de Pantalla] --> H2[Compresor JPEG / Sharp]
        H2 --> H3[Cliente WebSocket Host]
        H4[Controlador I/O OS] <-- H3
    end

    subgraph Signaling["🌐 Servidor de Señalización"]
        S1[WebSocket Server / Relay]
        S2[(Gestor de Sesiones por ID)]
        S1 <--> S2
    end

    subgraph Client["💻 Cliente Web (Navegador)"]
        C1[Cliente WebSocket Web] --> C2[Motor Renderizado Canvas]
        C3[Captura de Ratón & Teclado] --> C1
        C4[HUD de Métricas & Calidad]
    end

    H3 <== "Streaming Fotogramas (JPEG)" ==> S1
    S1 <== "Fotogramas Renderizados" ==> C1
    C1 == "Eventos de Entrada (Mouse/Key)" ==> S1
    S1 == "Despacho de Eventos" ==> H3
```

---

## 🖥️ Aplicación de Escritorio Instalable (Multiplataforma)

El proyecto incluye el módulo `desktop-app/` basado en **Electron**, que permite compilar e instalar el sistema como un ejecutable nativo en **Windows (.exe)**, **macOS (.dmg)** y **Linux (.AppImage / .deb)**.

### Características de la App de Escritorio:
- **Interfaz Todo en Uno**: Muestra tu ID ("Este Puesto de Trabajo") y permite conectarte a otra PC ("Otro Puesto de Trabajo").
- **Captura Nativa de Pantalla**: Utiliza `desktopCapturer` del sistema operativo sin configuraciones manuales.
- **Control Remoto Directo**: Ejecuta clics y movimientos de cursor de forma fluida.
- **Uso a través de Internet**: Se conecta al servidor de señalización en la nube (WSS).

### Cómo Ejecutar o Compilar los Instaladores:

```bash
# 1. Entrar al directorio de la app
cd desktop-app

# 2. Instalar dependencias
npm install

# 3. Probar en modo desarrollo
npm start

# 4. Generar Instalador para Windows (.exe)
npm run dist:win

# 5. Generar Instalador para macOS (.dmg)
npm run dist:mac

# 6. Generar Instalador para Linux (.AppImage / .deb)
npm run dist:linux
```
Los archivos instalables generados se guardarán automáticamente en la carpeta `desktop-app/dist/`.

---

## 📦 Estructura del Proyecto

```
Acceso-remoto/
├── package.json                   # Script raíz para orquestación
├── start-local.sh                 # Script bash para pruebas locales simultáneas
├── README.md                      # Documentación completa y guía de seguridad
├── signaling-server/              # MÓDULO 1: Servidor de Señalización
│   ├── package.json
│   ├── server.js                  # Lógica WebSocket y enrutamiento por ID
│   └── .env.example
├── host/                          # MÓDULO 2: Agente Host
│   ├── package.json
│   ├── host.js                    # Bucle continuo de captura de pantalla
│   ├── input-controller.js        # Ejecutor de clics, movimientos y teclas
│   └── .env.example
└── client/                        # MÓDULO 3: Cliente Web
    ├── index.html                 # UI con Canvas interactivo
    ├── style.css                  # Tema oscuro glassmorphism
    └── app.js                     # Renderizado en tiempo real y captura I/O
```

---

## 🚀 Inicio Rápido Local

### 1. Requisitos Previos
- **Node.js** v18 o superior instalado en el sistema.

### 2. Ejecución Automatizada
Puedes arrancar los tres módulos con un solo comando:

```bash
chmod +x start-local.sh
./start-local.sh
```

El script se encargará de:
1. Instalar dependencias en `signaling-server` y `host`.
2. Iniciar el Servidor de Señalización en `ws://localhost:9000`.
3. Iniciar el servidor web del Cliente en `http://localhost:8080`.
4. Iniciar el Agente Host y registrar un **ID de Sesión** (por ejemplo: `987654321`).

### 3. Conexión desde el Navegador
1. Abre tu navegador web en [http://localhost:8080](http://localhost:8080).
2. Introduce el **ID de Sesión** generado por el Host (aparece en la terminal).
3. Haz clic en **Conectar**.

---

## 🔒 Configuración del Canal Seguro de Señalización (WSS / TLS)

Para entornos de producción o conexiones fuera de la red local, es fundamental asegurar el canal con **WSS (WebSocket Secure)**.

### Opción A: WSS Nativo en Node.js

1. **Generar certificados SSL/TLS** (para desarrollo local puedes usar `openssl` o `mkcert`):
   ```bash
   mkdir -p signaling-server/certs
   openssl req -x509 -newkey rsa:2048 -nodes -sha256 -keyout signaling-server/certs/key.pem -out signaling-server/certs/cert.pem -days 365
   ```

2. **Editar `signaling-server/.env`**:
   ```env
   PORT=9000
   HOST=0.0.0.0
   SSL_ENABLED=true
   SSL_KEY_PATH=./certs/key.pem
   SSL_CERT_PATH=./certs/cert.pem
   ```

3. **Conectar vía cliente usando `wss://`**:
   En el cliente web, utiliza la URL: `wss://tudominio.com:9000` o `wss://localhost:9000`.

---

### Opción B: Reverse Proxy con Nginx y Let's Encrypt (Recomendado para Producción)

Configuración recomendada de Nginx para terminación TLS y proxying de WebSockets:

```nginx
server {
    listen 443 ssl http2;
    server_name remote.tudominio.com;

    ssl_certificate /etc/letsencrypt/live/remote.tudominio.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/remote.tudominio.com/privkey.pem;

    # Cliente Web Estático
    location / {
        root /var/www/remote-client;
        index index.html;
        try_files $uri $uri/ =404;
    }

    # Canal WebSocket de Señalización
    location /ws {
        proxy_pass http://127.0.0.1:9000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
```

---

## ⚙️ Permisos de Sistema para el Agente Host

- **macOS**:
  - `Grabación de Pantalla (Screen Recording)`: Otorga permiso a Terminal / Node.js en *Ajustes del Sistema > Privacidad y Seguridad > Grabación de pantalla*.
  - `Accesibilidad (Accessibility)`: Necesario para que el controlador pueda simular eventos de teclado y ratón.
- **Linux (X11 / Wayland)**:
  - Requiere `xdotool` instalado (`sudo apt install xdotool`) para despacho de eventos de ratón/teclado.
- **Windows**:
  - Requiere PowerShell habilitado para ejecución de scripts de usuario.

---

## 📡 Protocolo de Mensajería JSON

| Mensaje | Emisor | Receptor | Descripción |
|---|---|---|---|
| `REGISTER_HOST` | Host | Servidor | Registra el host con un ID de sesión de 9 dígitos. |
| `HOST_REGISTERED` | Servidor | Host | Confirma el registro del host. |
| `JOIN_SESSION` | Cliente | Servidor | Solicita conexión a un host con su ID. |
| `SESSION_CONNECTED` | Servidor | Cliente | Confirma emparejamiento con el host. |
| `FRAME` | Host | Cliente | Fotograma de pantalla comprimido en JPEG (base64/binario). |
| `INPUT_EVENT` | Cliente | Host | Eventos de ratón (`normX`, `normY`, clics) y teclado (`key`). |
| `CONFIG_CHANGE` | Cliente | Host | Ajuste dinámico de calidad (JPEG %) y FPS. |
| `PING` / `PONG` | Cliente/Host | Servidor | Medición de RTT (latencia de ida y vuelta). |
