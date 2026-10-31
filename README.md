# LuminaDrive — Self-Hosted Linux Photo Cloud (React + FastAPI)

Transform your old Linux laptop into a modern, private Google Photos / Drive server with **Smart Visually-Lossless Photo Shrinking**, **Isolated User Virtual Spaces**, **Per-User Storage Quotas**, and a **Master Admin Control Center**.

---

## ✨ Key Features

1. **Smart Visually-Lossless Photo Shrinking (Client + Server)**
   - Shrinks uploaded photos by **65%–85%** in file size without visible quality loss (caps only extreme dimensions at 4K `3840px` and encodes to high-efficiency perceptual WebP + fast gallery thumbnails).
   - Includes a live **Before vs. After Visual Quality Comparison** modal during upload and tracks exact MB/GB saved per photo, per user, and across the entire server.
2. **Admin-Only User Registration**
   - Public registration is disabled. Only the **Server Admin** can register new users and assign or update their **Storage Quota Limit** (e.g., `500 MB`, `2 GB`, `5 GB`, `10 GB`, `50 GB`, or custom MB).
3. **Isolated Virtual Spaces (`storage/users/<user_id>/`)**
   - Every user has their own isolated folder on your Linux laptop disk and can only see their own photos, albums, and storage quota bar.
4. **Admin Master Inspector**
   - The Admin can see server-wide disk health, view every user's quota usage, and click **"Open Virtual Space"** on any user (or select **"Every User's Photos"**) to browse and manage everyone's virtual space.
5. **Vercel Ready + Hybrid Sandbox Mode**
   - Includes `vercel.json` for 1-click Vercel deployment and a runtime **Server Connection** switcher so your Vercel web app can connect to your Linux laptop's FastAPI URL.

---

## 🚀 1. Running the Backend on Your Linux Laptop

Copy the `backend/` folder to your Linux laptop and run:

```bash
cd backend
chmod +x start_linux.sh
./start_linux.sh
```

Or manually with Python 3:
```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

- **Default Admin Login**: `admin` / `admin123`
- **Photos Stored On Disk**: `backend/storage/users/<user_id>/photos/`
- **Database**: `backend/storage/photo_drive.db`

### Exposing Your Linux Laptop to Your Vercel Frontend (Free HTTPS Tunnel)
Because Vercel runs on HTTPS in the cloud, expose your Linux laptop's port `8000` over HTTPS using **Cloudflare Tunnel** (free, no port-forwarding needed):
```bash
cloudflared tunnel --url http://localhost:8000
```
Copy the generated `https://xxxx.trycloudflare.com` URL and either:
- Paste it into the **"Linux Laptop Server Connection"** modal inside the web app, OR
- Set `VITE_API_URL=https://xxxx.trycloudflare.com` in your Vercel project environment variables.

---

## 💻 2. Running the React Frontend Locally (VS Code)

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.
