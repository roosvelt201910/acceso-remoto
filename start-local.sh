#!/usr/bin/env bash
# ==============================================================================
# Script de Inicio Local para Sistema de Escritorio Remoto Minimalista
# ==============================================================================

set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

echo "================================================================"
echo "    INICIALIZADOR DEL SISTEMA DE ESCRITORIO REMOTO (ANYDESK)    "
echo "================================================================"

# Exportar rutas comunes de Node.js
export PATH="/Users/roosvelt/.local/node/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"

echo "[+] Node.js detectado: $(node -v)"

# 2. Instalar dependencias si no existen
if [ ! -d "signaling-server/node_modules" ]; then
    echo "[*] Instalando dependencias del Servidor de Señalización..."
    npm --prefix signaling-server install
fi

if [ ! -d "host/node_modules" ]; then
    echo "[*] Instalando dependencias del Agente Host..."
    npm --prefix host install
fi

# 3. Crear archivos .env si no existen
if [ ! -f "signaling-server/.env" ]; then
    cp signaling-server/.env.example signaling-server/.env
    echo "[+] Archivo .env generado para el Servidor de Señalización."
fi

if [ ! -f "host/.env" ]; then
    cp host/.env.example host/.env
    echo "[+] Archivo .env generado para el Agente Host."
fi

# 4. Lanzar Servidor de Señalización en segundo plano
echo "[*] Iniciando Servidor de Señalización (Puerto 9000)..."
node signaling-server/server.js &
SERVER_PID=$!

# Esperar 1 segundo para que el servidor abra el puerto
sleep 1

# 5. Lanzar Servidor Web para el Cliente (usando Python o Node http-server)
echo "[*] Iniciando Servidor Web del Cliente (Puerto 8080)..."
if command -v python3 &> /dev/null; then
    (cd client && python3 -m http.server 8080) &
    CLIENT_PID=$!
elif command -v npx &> /dev/null; then
    npx -y http-server client -p 8080 -c-1 &
    CLIENT_PID=$!
fi

# 6. Lanzar Agente Host
echo "[*] Iniciando Agente Host..."
echo "----------------------------------------------------------------"
echo ">> Abre tu navegador en: http://localhost:8080"
echo ">> Presiona Ctrl+C para detener todos los servicios."
echo "----------------------------------------------------------------"

# Manejar cierre de procesos al salir
trap "echo -e '\n[!] Deteniendo servicios...'; kill $SERVER_PID $CLIENT_PID 2>/dev/null; exit 0" SIGINT SIGTERM

node host/host.js
