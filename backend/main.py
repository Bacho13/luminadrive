import hashlib
import io
import os
import platform
import shutil
import socket
import sqlite3
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import jwt
from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from PIL import Image, ImageOps
from pydantic import BaseModel

# =====================================================================
# CONFIGURATION & STORAGE PATHS
# =====================================================================
BASE_DIR = Path(__file__).resolve().parent
STORAGE_DIR = Path(os.getenv("PHOTO_DRIVE_STORAGE", str(BASE_DIR / "storage")))
USERS_STORAGE_DIR = STORAGE_DIR / "users"
DB_PATH = STORAGE_DIR / "photo_drive.db"

JWT_SECRET = os.getenv("PHOTO_DRIVE_SECRET", "linux-laptop-photo-drive-secret-key-change-me")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_HOURS = 24 * 7  # 7 days

DEFAULT_ADMIN_USER = os.getenv("PHOTO_DRIVE_ADMIN_USER", "admin")
DEFAULT_ADMIN_PASS = os.getenv("PHOTO_DRIVE_ADMIN_PASS", "admin123")

STORAGE_DIR.mkdir(parents=True, exist_ok=True)
USERS_STORAGE_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(
    title="Linux Laptop Photo Drive API",
    description="Self-hosted Google Photos/Drive backend with smart visually-lossless photo shrinking, isolated user virtual spaces, and real-time hardware telemetry.",
    version="1.1.0",
)

# Enable CORS for Vercel frontend & local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def add_pna_headers(request, call_next):
    response = await call_next(request)
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Private-Network"] = "true"
    response.headers["Access-Control-Allow-Headers"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "*"
    return response

security = HTTPBearer(auto_error=False)


# =====================================================================
# REAL-TIME LINUX HARDWARE TELEMETRY ENGINE (/proc & /sys)
# =====================================================================
_cpu_lock = threading.Lock()
_last_cpu_times: Optional[tuple[int, int]] = None
_last_cpu_percent: float = 0.0


def _read_proc_cpu_times() -> Optional[tuple[int, int]]:
    stat_path = Path("/proc/stat")
    if not stat_path.exists():
        return None
    try:
        first_line = stat_path.read_text().splitlines()[0]
        parts = [int(x) for x in first_line.split()[1:]]
        idle = parts[3] + (parts[4] if len(parts) > 4 else 0)
        total = sum(parts)
        return idle, total
    except Exception:
        return None


def get_live_cpu_percent() -> float:
    global _last_cpu_times, _last_cpu_percent
    with _cpu_lock:
        current = _read_proc_cpu_times()
        if current is None:
            return 12.5
        if _last_cpu_times is None:
            _last_cpu_times = current
            time.sleep(0.08)
            current = _read_proc_cpu_times() or current

        prev_idle, prev_total = _last_cpu_times
        curr_idle, curr_total = current
        total_diff = curr_total - prev_total
        idle_diff = curr_idle - prev_idle
        _last_cpu_times = current

        if total_diff > 0:
            busy = max(0.0, min(100.0, (1.0 - (idle_diff / total_diff)) * 100.0))
            _last_cpu_percent = round(busy, 1)
        return _last_cpu_percent


def get_live_memory_info() -> dict:
    meminfo_path = Path("/proc/meminfo")
    if meminfo_path.exists():
        try:
            data = {}
            for line in meminfo_path.read_text().splitlines():
                if ":" in line:
                    k, v = line.split(":", 1)
                    num = int(v.strip().split()[0]) * 1024  # kB -> bytes
                    data[k.strip()] = num
            total = data.get("MemTotal", 8 * 1024**3)
            avail = data.get("MemAvailable", data.get("MemFree", total // 2))
            used = max(0, total - avail)
            swap_total = data.get("SwapTotal", 0)
            swap_free = data.get("SwapFree", 0)
            swap_used = max(0, swap_total - swap_free)
            return {
                "ram_total_bytes": total,
                "ram_used_bytes": used,
                "ram_available_bytes": avail,
                "ram_percent": round((used / total) * 100.0, 1) if total > 0 else 0.0,
                "swap_total_bytes": swap_total,
                "swap_used_bytes": swap_used,
                "swap_percent": round((swap_used / swap_total) * 100.0, 1) if swap_total > 0 else 0.0,
            }
        except Exception:
            pass
    return {
        "ram_total_bytes": 8 * 1024**3,
        "ram_used_bytes": 2 * 1024**3,
        "ram_available_bytes": 6 * 1024**3,
        "ram_percent": 25.0,
        "swap_total_bytes": 0,
        "swap_used_bytes": 0,
        "swap_percent": 0.0,
    }


def get_cpu_temperature() -> Optional[float]:
    thermal_base = Path("/sys/class/thermal")
    if thermal_base.exists():
        temps = []
        for zone in thermal_base.glob("thermal_zone*"):
            temp_file = zone / "temp"
            if temp_file.exists():
                try:
                    raw = int(temp_file.read_text().strip())
                    temp_c = raw / 1000.0 if raw > 1000 else float(raw)
                    if 15.0 <= temp_c <= 115.0:
                        temps.append(temp_c)
                except Exception:
                    pass
        if temps:
            return round(max(temps), 1)
    return None


def get_uptime_and_load() -> tuple[int, list[float]]:
    uptime_sec = 0
    uptime_path = Path("/proc/uptime")
    if uptime_path.exists():
        try:
            uptime_sec = int(float(uptime_path.read_text().split()[0]))
        except Exception:
            pass

    load_avg = [0.0, 0.0, 0.0]
    if hasattr(os, "getloadavg"):
        try:
            l1, l5, l15 = os.getloadavg()
            load_avg = [round(l1, 2), round(l5, 2), round(l15, 2)]
        except Exception:
            pass
    return uptime_sec, load_avg


def get_network_bytes() -> tuple[int, int]:
    net_path = Path("/proc/net/dev")
    rx_total = 0
    tx_total = 0
    if net_path.exists():
        try:
            for line in net_path.read_text().splitlines()[2:]:
                if ":" not in line:
                    continue
                iface, rest = line.split(":", 1)
                if iface.strip() == "lo":
                    continue
                fields = rest.split()
                if len(fields) >= 9:
                    rx_total += int(fields[0])
                    tx_total += int(fields[8])
        except Exception:
            pass
    return rx_total, tx_total


def collect_system_telemetry(photo_drive_used_bytes: int = 0) -> dict:
    disk = shutil.disk_usage(str(STORAGE_DIR))
    disk_percent = round((disk.used / disk.total) * 100.0, 1) if disk.total > 0 else 0.0
    cpu_pct = get_live_cpu_percent()
    mem = get_live_memory_info()
    temp_c = get_cpu_temperature()
    uptime_sec, load_avg = get_uptime_and_load()
    rx_bytes, tx_bytes = get_network_bytes()

    return {
        "hostname": socket.gethostname(),
        "os_info": f"{platform.system()} {platform.release()}",
        "cpu_percent": cpu_pct,
        "cpu_cores": os.cpu_count() or 1,
        "cpu_temp_c": temp_c,
        "load_avg": load_avg,
        "uptime_seconds": uptime_sec,
        **mem,
        "disk_total_bytes": disk.total,
        "disk_used_bytes": disk.used,
        "disk_free_bytes": disk.free,
        "disk_percent": disk_percent,
        "photo_drive_used_bytes": photo_drive_used_bytes,
        "system_other_used_bytes": max(0, disk.used - photo_drive_used_bytes),
        "net_rx_bytes": rx_bytes,
        "net_tx_bytes": tx_bytes,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# Prime the CPU reader once at startup
get_live_cpu_percent()


# =====================================================================
# DATABASE SETUP & HELPERS
# =====================================================================
def get_db():
    conn = sqlite3.connect(str(DB_PATH), timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = FULL")
    return conn


def hash_password(password: str, salt: Optional[str] = None) -> str:
    if not salt:
        salt = uuid.uuid4().hex
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120_000).hex()
    return f"{salt}${digest}"


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        salt, _ = stored_hash.split("$", 1)
        return hash_password(password, salt) == stored_hash
    except ValueError:
        return False


def ensure_user_virtual_dirs(user_id: str):
    user_root = USERS_STORAGE_DIR / user_id
    (user_root / "photos").mkdir(parents=True, exist_ok=True)
    (user_root / "thumbs").mkdir(parents=True, exist_ok=True)
    return user_root


def init_db():
    conn = get_db()
    with conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                display_name TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'user',
                quota_bytes INTEGER NOT NULL DEFAULT 5368709120,
                avatar_color TEXT NOT NULL DEFAULT '#6366f1',
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS folders (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                name TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS photos (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                folder_id TEXT,
                original_name TEXT NOT NULL,
                stored_filename TEXT NOT NULL,
                thumb_filename TEXT NOT NULL,
                mime_type TEXT NOT NULL,
                width INTEGER NOT NULL DEFAULT 0,
                height INTEGER NOT NULL DEFAULT 0,
                original_size INTEGER NOT NULL,
                compressed_size INTEGER NOT NULL,
                is_favorite INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL
            )
            """
        )

        # Ensure default Admin exists with 2 GB max virtual space
        admin_quota_2gb = 2 * 1024 * 1024 * 1024  # 2 GB
        cur = conn.execute("SELECT id, quota_bytes FROM users WHERE username = ?", (DEFAULT_ADMIN_USER.lower(),))
        existing_admin = cur.fetchone()
        if not existing_admin:
            admin_id = "usr_admin"
            now = datetime.now(timezone.utc).isoformat()
            conn.execute(
                """
                INSERT INTO users (id, username, display_name, password_hash, role, quota_bytes, avatar_color, created_at)
                VALUES (?, ?, ?, ?, 'admin', ?, '#8b5cf6', ?)
                """,
                (
                    admin_id,
                    DEFAULT_ADMIN_USER.lower(),
                    "Server Admin",
                    hash_password(DEFAULT_ADMIN_PASS),
                    admin_quota_2gb,
                    now,
                ),
            )
            ensure_user_virtual_dirs(admin_id)
        elif existing_admin["quota_bytes"] > admin_quota_2gb:
            conn.execute(
                "UPDATE users SET quota_bytes = ? WHERE id = ?",
                (admin_quota_2gb, existing_admin["id"]),
            )
    conn.close()


init_db()


# =====================================================================
# AUTHENTICATION & PERMISSIONS
# =====================================================================
def create_token(user_id: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRE_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    token: Optional[str] = Query(default=None),
):
    raw_token = credentials.credentials if credentials else token
    if not raw_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")

    try:
        payload = jwt.decode(raw_token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = payload.get("sub")
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")

    conn = get_db()
    user = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    conn.close()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User no longer exists")
    return dict(user)


def require_admin(user: dict = Depends(get_current_user)):
    if user["role"] != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the Server Admin can perform this action")
    return user


# =====================================================================
# SMART VISUALLY-LOSSLESS PHOTO SHRINKING ENGINE
# =====================================================================
def smart_shrink_photo(raw_bytes: bytes, filename: str, max_dimension: int = 3840) -> dict:
    original_size = len(raw_bytes)
    try:
        img = Image.open(io.BytesIO(raw_bytes))
        orig_format = (img.format or "").upper()
        img = ImageOps.exif_transpose(img)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid image file '{filename}': {exc}")

    width, height = img.size
    needs_resize = max(width, height) > max_dimension

    if needs_resize:
        ratio = max_dimension / float(max(width, height))
        width = max(1, int(round(width * ratio)))
        height = max(1, int(round(height * ratio)))
        img = img.resize((width, height), Image.Resampling.LANCZOS)

    has_alpha = img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info)
    target_img = img.convert("RGBA" if has_alpha else "RGB")

    # Fast path: if the browser already pre-shrunk the image to WebP within max_dimension,
    # avoid slow double re-encoding on the laptop CPU so uploads complete instantaneously!
    if orig_format == "WEBP" and not needs_resize:
        compressed_bytes = raw_bytes
        mime_type = "image/webp"
        ext = ".webp"
    else:
        out_buf = io.BytesIO()
        target_img.save(out_buf, format="WEBP", quality=86, method=4)
        compressed_bytes = out_buf.getvalue()
        mime_type = "image/webp"
        ext = ".webp"

        if len(compressed_bytes) >= original_size and not needs_resize:
            compressed_bytes = raw_bytes
            orig_ext = Path(filename).suffix.lower() or ".jpg"
            ext = orig_ext
            mime_map = {
                ".jpg": "image/jpeg",
                ".jpeg": "image/jpeg",
                ".png": "image/png",
                ".webp": "image/webp",
                ".gif": "image/gif",
            }
            mime_type = mime_map.get(orig_ext, "image/jpeg")

    thumb_img = target_img.copy()
    thumb_img.thumbnail((420, 420), Image.Resampling.LANCZOS)
    thumb_buf = io.BytesIO()
    thumb_img.save(thumb_buf, format="WEBP", quality=78, method=2)
    thumb_bytes = thumb_buf.getvalue()

    return {
        "compressed_bytes": compressed_bytes,
        "thumb_bytes": thumb_bytes,
        "original_size": original_size,
        "compressed_size": len(compressed_bytes),
        "width": width,
        "height": height,
        "mime_type": mime_type,
        "ext": ext,
    }


# =====================================================================
# STATS SERIALIZER
# =====================================================================
def get_user_with_stats(conn: sqlite3.Connection, user_row: dict) -> dict:
    stats = conn.execute(
        """
        SELECT
            COUNT(*) AS photo_count,
            COALESCE(SUM(compressed_size), 0) AS used_bytes,
            COALESCE(SUM(original_size), 0) AS total_original_bytes
        FROM photos
        WHERE user_id = ?
        """,
        (user_row["id"],),
    ).fetchone()

    folder_count = conn.execute(
        "SELECT COUNT(*) AS cnt FROM folders WHERE user_id = ?",
        (user_row["id"],),
    ).fetchone()["cnt"]

    used_bytes = stats["used_bytes"]
    orig_bytes = stats["total_original_bytes"]
    saved_bytes = max(0, orig_bytes - used_bytes)

    return {
        "id": user_row["id"],
        "username": user_row["username"],
        "display_name": user_row["display_name"],
        "role": user_row["role"],
        "quota_bytes": user_row["quota_bytes"],
        "used_bytes": used_bytes,
        "original_bytes": orig_bytes,
        "saved_bytes": saved_bytes,
        "photo_count": stats["photo_count"],
        "folder_count": folder_count,
        "avatar_color": user_row["avatar_color"],
        "created_at": user_row["created_at"],
        "virtual_path": f"storage/users/{user_row['id']}/",
    }


def serialize_photo(row: dict) -> dict:
    orig = row["original_size"]
    comp = row["compressed_size"]
    saved = max(0, orig - comp)
    saved_pct = round((saved / orig) * 100, 1) if orig > 0 else 0.0
    return {
        "id": row["id"],
        "user_id": row["user_id"],
        "owner_username": row.get("owner_username"),
        "owner_display_name": row.get("owner_display_name"),
        "folder_id": row["folder_id"],
        "original_name": row["original_name"],
        "mime_type": row["mime_type"],
        "width": row["width"],
        "height": row["height"],
        "original_size": orig,
        "compressed_size": comp,
        "saved_bytes": saved,
        "saved_percent": saved_pct,
        "is_favorite": bool(row["is_favorite"]),
        "created_at": row["created_at"],
        "file_url": f"/api/photos/{row['id']}/file",
        "thumb_url": f"/api/photos/{row['id']}/thumb",
    }


# =====================================================================
# PYDANTIC SCHEMAS
# =====================================================================
class LoginRequest(BaseModel):
    username: str
    password: str


class CreateUserRequest(BaseModel):
    username: str
    display_name: str
    password: str
    quota_mb: int = 5120  # Default 5 GB
    role: str = "user"
    avatar_color: str = "#3b82f6"


class UpdateUserRequest(BaseModel):
    username: Optional[str] = None
    display_name: Optional[str] = None
    password: Optional[str] = None
    quota_mb: Optional[int] = None
    role: Optional[str] = None


class CreateFolderRequest(BaseModel):
    name: str
    user_id: Optional[str] = None


class UpdatePhotoRequest(BaseModel):
    is_favorite: Optional[bool] = None
    folder_id: Optional[str] = None
    original_name: Optional[str] = None


# =====================================================================
# ROUTES: HEALTH & AUTH
# =====================================================================
@app.get("/api/health")
def health_check():
    disk = shutil.disk_usage(str(STORAGE_DIR))
    return {
        "status": "ok",
        "server": "Linux Laptop Photo Drive",
        "disk_total_bytes": disk.total,
        "disk_used_bytes": disk.used,
        "disk_free_bytes": disk.free,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.post("/api/auth/login")
def login(payload: LoginRequest):
    conn = get_db()
    user = conn.execute(
        "SELECT * FROM users WHERE username = ?",
        (payload.username.strip().lower(),),
    ).fetchone()

    if not user or not verify_password(payload.password, user["password_hash"]):
        conn.close()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password")

    user_dict = dict(user)
    token = create_token(user_dict["id"], user_dict["role"])
    profile = get_user_with_stats(conn, user_dict)
    conn.close()
    return {"token": token, "user": profile}


@app.get("/api/auth/me")
def get_me(current_user: dict = Depends(get_current_user)):
    conn = get_db()
    profile = get_user_with_stats(conn, current_user)
    conn.close()
    return profile


# =====================================================================
# ROUTES: FOLDERS / ALBUMS (VIRTUAL SPACE)
# =====================================================================
@app.get("/api/folders")
def list_folders(
    user_id: Optional[str] = Query(default=None),
    current_user: dict = Depends(get_current_user),
):
    target_user_id = current_user["id"]
    if user_id and user_id != current_user["id"]:
        if current_user["role"] != "admin":
            raise HTTPException(status_code=403, detail="Access denied to another user's virtual space")
        target_user_id = user_id

    conn = get_db()
    rows = conn.execute(
        """
        SELECT f.*, COUNT(p.id) AS photo_count
        FROM folders f
        LEFT JOIN photos p ON p.folder_id = f.id
        WHERE f.user_id = ?
        GROUP BY f.id
        ORDER BY f.created_at DESC
        """,
        (target_user_id,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.post("/api/folders")
def create_folder(
    payload: CreateFolderRequest,
    current_user: dict = Depends(get_current_user),
):
    target_user_id = current_user["id"]
    if payload.user_id and payload.user_id != current_user["id"]:
        if current_user["role"] != "admin":
            raise HTTPException(status_code=403, detail="Access denied")
        target_user_id = payload.user_id

    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Folder name cannot be empty")

    folder_id = f"fld_{uuid.uuid4().hex[:10]}"
    now = datetime.now(timezone.utc).isoformat()
    conn = get_db()
    with conn:
        conn.execute(
            "INSERT INTO folders (id, user_id, name, created_at) VALUES (?, ?, ?, ?)",
            (folder_id, target_user_id, name, now),
        )
    conn.close()
    return {"id": folder_id, "user_id": target_user_id, "name": name, "photo_count": 0, "created_at": now}


@app.delete("/api/folders/{folder_id}")
def delete_folder(
    folder_id: str,
    confirm: bool = Query(default=False),
    admin: dict = Depends(require_admin),
):
    if not confirm:
        raise HTTPException(status_code=400, detail="Explicit admin confirmation required to delete")
    conn = get_db()
    folder = conn.execute("SELECT * FROM folders WHERE id = ?", (folder_id,)).fetchone()
    if not folder:
        conn.close()
        raise HTTPException(status_code=404, detail="Folder not found")
    with conn:
        conn.execute("DELETE FROM folders WHERE id = ?", (folder_id,))
    conn.close()
    return {"deleted": True}


# =====================================================================
# ROUTES: PHOTOS (UPLOAD, SHRINK, VIEW, MANAGE)
# =====================================================================
@app.get("/api/photos")
def list_photos(
    user_id: Optional[str] = Query(default=None, description="Admin only: inspect a specific user_id or 'all'"),
    folder_id: Optional[str] = Query(default=None),
    favorites_only: bool = Query(default=False),
    current_user: dict = Depends(get_current_user),
):
    conn = get_db()
    params = []
    where_clauses = []

    if user_id == "all":
        if current_user["role"] != "admin":
            conn.close()
            raise HTTPException(status_code=403, detail="Only Admin can view all virtual spaces")
    elif user_id and user_id != current_user["id"]:
        if current_user["role"] != "admin":
            conn.close()
            raise HTTPException(status_code=403, detail="Access denied to another user's virtual space")
        where_clauses.append("p.user_id = ?")
        params.append(user_id)
    else:
        where_clauses.append("p.user_id = ?")
        params.append(current_user["id"])

    if folder_id:
        where_clauses.append("p.folder_id = ?")
        params.append(folder_id)

    if favorites_only:
        where_clauses.append("p.is_favorite = 1")

    where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""
    query = f"""
        SELECT p.*, u.username AS owner_username, u.display_name AS owner_display_name
        FROM photos p
        JOIN users u ON u.id = p.user_id
        {where_sql}
        ORDER BY p.created_at DESC
    """
    rows = conn.execute(query, params).fetchall()
    conn.close()
    return [serialize_photo(dict(r)) for r in rows]


@app.post("/api/photos/upload")
async def upload_photo(
    file: UploadFile = File(...),
    folder_id: Optional[str] = Form(default=None),
    target_user_id: Optional[str] = Form(default=None),
    reported_original_size: Optional[int] = Form(default=None),
    current_user: dict = Depends(get_current_user),
):
    owner_id = current_user["id"]
    if target_user_id and target_user_id != current_user["id"]:
        if current_user["role"] != "admin":
            raise HTTPException(status_code=403, detail="Only Admin can upload to another user's virtual space")
        owner_id = target_user_id

    raw_bytes = await file.read()
    if not raw_bytes:
        raise HTTPException(status_code=400, detail="Empty file uploaded")

    conn = get_db()
    owner_row = conn.execute("SELECT * FROM users WHERE id = ?", (owner_id,)).fetchone()
    if not owner_row:
        conn.close()
        raise HTTPException(status_code=404, detail="Target user not found")

    owner_stats = get_user_with_stats(conn, dict(owner_row))

    shrunk = smart_shrink_photo(raw_bytes, file.filename or "photo.jpg")

    true_original_size = max(shrunk["original_size"], reported_original_size or 0)
    compressed_size = shrunk["compressed_size"]

    if owner_stats["used_bytes"] + compressed_size > owner_stats["quota_bytes"]:
        conn.close()
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Storage quota exceeded for this virtual space. Ask the Admin to increase your storage limit.",
        )

    photo_id = f"pht_{uuid.uuid4().hex[:12]}"
    stored_filename = f"{photo_id}{shrunk['ext']}"
    thumb_filename = f"{photo_id}_thumb.webp"

    user_dir = ensure_user_virtual_dirs(owner_id)
    photo_path = user_dir / "photos" / stored_filename
    thumb_path = user_dir / "thumbs" / thumb_filename

    photo_path.write_bytes(shrunk["compressed_bytes"])
    thumb_path.write_bytes(shrunk["thumb_bytes"])

    now = datetime.now(timezone.utc).isoformat()
    with conn:
        conn.execute(
            """
            INSERT INTO photos (
                id, user_id, folder_id, original_name, stored_filename, thumb_filename,
                mime_type, width, height, original_size, compressed_size, is_favorite, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
            """,
            (
                photo_id,
                owner_id,
                folder_id or None,
                file.filename or "photo.jpg",
                stored_filename,
                thumb_filename,
                shrunk["mime_type"],
                shrunk["width"],
                shrunk["height"],
                true_original_size,
                compressed_size,
                now,
            ),
        )
        row = conn.execute(
            """
            SELECT p.*, u.username AS owner_username, u.display_name AS owner_display_name
            FROM photos p
            JOIN users u ON u.id = p.user_id
            WHERE p.id = ?
            """,
            (photo_id,),
        ).fetchone()
    conn.close()
    return serialize_photo(dict(row))


@app.get("/api/photos/{photo_id}/file")
def get_photo_file(photo_id: str, current_user: dict = Depends(get_current_user)):
    conn = get_db()
    photo = conn.execute("SELECT * FROM photos WHERE id = ?", (photo_id,)).fetchone()
    conn.close()
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")
    if photo["user_id"] != current_user["id"] and current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Access denied")

    file_path = USERS_STORAGE_DIR / photo["user_id"] / "photos" / photo["stored_filename"]
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Photo file missing on disk")
    return FileResponse(str(file_path), media_type=photo["mime_type"], filename=photo["original_name"])


@app.get("/api/photos/{photo_id}/thumb")
def get_photo_thumb(photo_id: str, current_user: dict = Depends(get_current_user)):
    conn = get_db()
    photo = conn.execute("SELECT * FROM photos WHERE id = ?", (photo_id,)).fetchone()
    conn.close()
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")
    if photo["user_id"] != current_user["id"] and current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Access denied")

    thumb_path = USERS_STORAGE_DIR / photo["user_id"] / "thumbs" / photo["thumb_filename"]
    if not thumb_path.exists():
        file_path = USERS_STORAGE_DIR / photo["user_id"] / "photos" / photo["stored_filename"]
        if file_path.exists():
            return FileResponse(str(file_path), media_type=photo["mime_type"])
        raise HTTPException(status_code=404, detail="Thumbnail missing on disk")
    return FileResponse(str(thumb_path), media_type="image/webp")


@app.patch("/api/photos/{photo_id}")
def update_photo(
    photo_id: str,
    payload: UpdatePhotoRequest,
    current_user: dict = Depends(get_current_user),
):
    conn = get_db()
    photo = conn.execute("SELECT * FROM photos WHERE id = ?", (photo_id,)).fetchone()
    if not photo:
        conn.close()
        raise HTTPException(status_code=404, detail="Photo not found")
    if photo["user_id"] != current_user["id"] and current_user["role"] != "admin":
        conn.close()
        raise HTTPException(status_code=403, detail="Access denied")

    updates = []
    params = []
    if payload.is_favorite is not None:
        updates.append("is_favorite = ?")
        params.append(1 if payload.is_favorite else 0)
    if payload.folder_id is not None:
        updates.append("folder_id = ?")
        params.append(payload.folder_id if payload.folder_id != "" else None)
    if payload.original_name is not None and payload.original_name.strip():
        updates.append("original_name = ?")
        params.append(payload.original_name.strip())

    if updates:
        params.append(photo_id)
        with conn:
            conn.execute(f"UPDATE photos SET {', '.join(updates)} WHERE id = ?", params)

    updated = conn.execute(
        """
        SELECT p.*, u.username AS owner_username, u.display_name AS owner_display_name
        FROM photos p
        JOIN users u ON u.id = p.user_id
        WHERE p.id = ?
        """,
        (photo_id,),
    ).fetchone()
    conn.close()
    return serialize_photo(dict(updated))


@app.delete("/api/photos/{photo_id}")
def delete_photo(
    photo_id: str,
    confirm: bool = Query(default=False),
    admin: dict = Depends(require_admin),
):
    if not confirm:
        raise HTTPException(status_code=400, detail="Explicit admin confirmation required to delete")
    conn = get_db()
    photo = conn.execute("SELECT * FROM photos WHERE id = ?", (photo_id,)).fetchone()
    if not photo:
        conn.close()
        raise HTTPException(status_code=404, detail="Photo not found")

    file_path = USERS_STORAGE_DIR / photo["user_id"] / "photos" / photo["stored_filename"]
    thumb_path = USERS_STORAGE_DIR / photo["user_id"] / "thumbs" / photo["thumb_filename"]

    with conn:
        conn.execute("DELETE FROM photos WHERE id = ?", (photo_id,))
    conn.close()

    for p in (file_path, thumb_path):
        try:
            if p.exists():
                p.unlink()
        except OSError:
            pass

    return {"deleted": True, "id": photo_id}


# =====================================================================
# ROUTES: ADMIN MANAGEMENT & REAL-TIME HARDWARE TELEMETRY
# =====================================================================
@app.get("/api/admin/telemetry")
def admin_live_telemetry(admin: dict = Depends(require_admin)):
    conn = get_db()
    row = conn.execute("SELECT COALESCE(SUM(compressed_size), 0) AS total_used FROM photos").fetchone()
    conn.close()
    photo_drive_used = row["total_used"] if row else 0
    return collect_system_telemetry(photo_drive_used)


@app.get("/api/admin/overview")
def admin_overview(admin: dict = Depends(require_admin)):
    conn = get_db()
    users_rows = conn.execute("SELECT * FROM users ORDER BY created_at ASC").fetchall()
    users = [get_user_with_stats(conn, dict(u)) for u in users_rows]
    conn.close()

    total_used = sum(u["used_bytes"] for u in users)
    total_original = sum(u["original_bytes"] for u in users)
    total_saved = sum(u["saved_bytes"] for u in users)
    total_quota_allocated = sum(u["quota_bytes"] for u in users)
    total_photos = sum(u["photo_count"] for u in users)

    telemetry = collect_system_telemetry(total_used)

    return {
        "total_users": len(users),
        "total_photos": total_photos,
        "total_used_bytes": total_used,
        "total_original_bytes": total_original,
        "total_saved_bytes": total_saved,
        "total_quota_allocated_bytes": total_quota_allocated,
        "storage_root": str(STORAGE_DIR),
        **telemetry,
        "users": users,
    }


@app.post("/api/admin/users")
def admin_create_user(payload: CreateUserRequest, admin: dict = Depends(require_admin)):
    username = payload.username.strip().lower()
    if not username or len(username) < 2:
        raise HTTPException(status_code=400, detail="Username must be at least 2 characters")
    if len(payload.password) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters")

    user_id = f"usr_{uuid.uuid4().hex[:10]}"
    role = "admin" if payload.role == "admin" else "user"
    effective_mb = min(2048, max(50, payload.quota_mb)) if role == "admin" else max(50, payload.quota_mb)
    quota_bytes = effective_mb * 1024 * 1024
    now = datetime.now(timezone.utc).isoformat()

    conn = get_db()
    existing = conn.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
    if existing:
        conn.close()
        raise HTTPException(status_code=400, detail=f"Username '{username}' is already registered")

    with conn:
        conn.execute(
            """
            INSERT INTO users (id, username, display_name, password_hash, role, quota_bytes, avatar_color, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                user_id,
                username,
                payload.display_name.strip() or username,
                hash_password(payload.password),
                role,
                quota_bytes,
                payload.avatar_color,
                now,
            ),
        )
        ensure_user_virtual_dirs(user_id)
        created_row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        result = get_user_with_stats(conn, dict(created_row))
    conn.close()
    return result


@app.patch("/api/admin/users/{user_id}")
def admin_update_user(user_id: str, payload: UpdateUserRequest, admin: dict = Depends(require_admin)):
    conn = get_db()
    user = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if not user:
        conn.close()
        raise HTTPException(status_code=404, detail="User not found")

    updates = []
    params = []
    if payload.username is not None and payload.username.strip():
        clean_username = payload.username.strip().lower()
        if len(clean_username) < 2:
            conn.close()
            raise HTTPException(status_code=400, detail="Login username must be at least 2 characters")
        dup = conn.execute(
            "SELECT id FROM users WHERE username = ? AND id != ?",
            (clean_username, user_id),
        ).fetchone()
        if dup:
            conn.close()
            raise HTTPException(status_code=400, detail=f"Login username '{clean_username}' is already taken")
        updates.append("username = ?")
        params.append(clean_username)
    if payload.display_name is not None and payload.display_name.strip():
        updates.append("display_name = ?")
        params.append(payload.display_name.strip())
    if payload.password is not None and payload.password.strip():
        updates.append("password_hash = ?")
        params.append(hash_password(payload.password.strip()))
    target_role = payload.role if payload.role in ("admin", "user") else user["role"]
    if payload.quota_mb is not None:
        capped_mb = min(2048, max(50, payload.quota_mb)) if target_role == "admin" else max(50, payload.quota_mb)
        updates.append("quota_bytes = ?")
        params.append(capped_mb * 1024 * 1024)
    if payload.role in ("admin", "user"):
        updates.append("role = ?")
        params.append(payload.role)

    if updates:
        params.append(user_id)
        with conn:
            conn.execute(f"UPDATE users SET {', '.join(updates)} WHERE id = ?", params)

    updated = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    result = get_user_with_stats(conn, dict(updated))
    conn.close()
    return result


@app.delete("/api/admin/users/{user_id}")
def admin_delete_user(
    user_id: str,
    confirm: bool = Query(default=False),
    admin: dict = Depends(require_admin),
):
    if not confirm:
        raise HTTPException(status_code=400, detail="Explicit admin confirmation required to delete user")
    if user_id == admin["id"]:
        raise HTTPException(status_code=400, detail="You cannot delete your own active Admin account")

    conn = get_db()
    user = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if not user:
        conn.close()
        raise HTTPException(status_code=404, detail="User not found")

    with conn:
        conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
    conn.close()

    user_dir = USERS_STORAGE_DIR / user_id
    if user_dir.exists():
        shutil.rmtree(str(user_dir), ignore_errors=True)

    return {"deleted": True, "id": user_id}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=int(os.getenv("PORT", "8000")), reload=True)
