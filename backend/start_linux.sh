#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

echo "======================================================"
echo "  Linux Laptop Photo Drive - Backend Server Launcher  "
echo "======================================================"

if [ ! -d "venv" ]; then
    echo "[1/3] Creating Python virtual environment..."
    python3 -m venv venv
fi

echo "[2/3] Installing / verifying FastAPI & Pillow dependencies..."
./venv/bin/pip install --upgrade pip -q
./venv/bin/pip install -r requirements.txt -q

export PORT="${PORT:-8000}"
echo "[3/3] Starting Photo Drive server on 0.0.0.0:${PORT}..."
echo "      Default Admin Login: admin / admin123"
echo "      Photos Stored In:    $(pwd)/storage/users/"
echo "======================================================"

exec ./venv/bin/uvicorn main:app --host 0.0.0.0 --port "$PORT"
