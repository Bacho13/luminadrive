#!/usr/bin/env bash
# ==============================================================================
# LuminaDrive — Automated Linux Laptop Server Provisioner (Run from Git Bash)
# ==============================================================================
set -e

SERVER_TARGET="${1:-bacho@192.168.1.17}"
REMOTE_DIR="${2:-~/photo-drive-server}"
PORT="${3:-8000}"

echo "=================================================================="
echo " 🚀 Deploying LuminaDrive Backend to: $SERVER_TARGET"
echo " 📂 Target Directory:                 $REMOTE_DIR"
echo " 🌐 Server Port:                      $PORT"
echo "=================================================================="

echo "[1/4] Creating remote directory on Linux laptop..."
ssh "$SERVER_TARGET" "mkdir -p $REMOTE_DIR"

echo "[2/4] Uploading FastAPI backend files via SCP..."
scp backend/main.py backend/requirements.txt backend/start_linux.sh "$SERVER_TARGET:$REMOTE_DIR/"

echo "[3/4] Preparing Python environment & dependencies on Linux laptop..."
ssh -t "$SERVER_TARGET" "cd $REMOTE_DIR && chmod +x start_linux.sh && \
  if ! command -v python3 >/dev/null 2>&1; then sudo apt-get update && sudo apt-get install -y python3 python3-venv python3-pip; fi && \
  if [ ! -d venv ]; then python3 -m venv venv || (sudo apt-get update && sudo apt-get install -y python3-venv && python3 -m venv venv); fi && \
  ./venv/bin/pip install --upgrade pip && \
  ./venv/bin/pip install -r requirements.txt"

echo "[4/4] Setting up background systemd service (photo-drive.service)..."
ssh -t "$SERVER_TARGET" "REMOTE_ABS=\$(cd $REMOTE_DIR && pwd) && \
  USER_NAME=\$(whoami) && \
  sudo bash -c \"cat > /etc/systemd/system/photo-drive.service <<EOF
[Unit]
Description=LuminaDrive Self-Hosted Linux Photo Cloud API
After=network.target

[Service]
Type=simple
User=\$USER_NAME
WorkingDirectory=\$REMOTE_ABS
Environment=PORT=$PORT
ExecStart=\$REMOTE_ABS/venv/bin/uvicorn main:app --host 0.0.0.0 --port $PORT
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF\" && \
  sudo systemctl daemon-reload && \
  sudo systemctl enable photo-drive.service && \
  sudo systemctl restart photo-drive.service && \
  sudo systemctl status photo-drive.service --no-pager"

echo "=================================================================="
echo " ✅ Linux Laptop Server is LIVE and running 24/7 on port $PORT!"
echo " 👉 Test Health URL: http://${SERVER_TARGET#*@}:$PORT/api/health"
echo "=================================================================="
