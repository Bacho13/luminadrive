const STORAGE_KEYS = {
  API_URL: 'luminadrive_api_url',
  TOKEN: 'luminadrive_token',
  MODE: 'luminadrive_mode',
  LOCAL_STATE: 'luminadrive_local_db_v1',
};

const IDB_NAME = 'LuminaDriveBlobsDB';
const IDB_STORE = 'photo_blobs';

function openBlobDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveBlobToIDB(key, dataUrl) {
  try {
    const db = await openBlobDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(dataUrl, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Ignore IDB quota issues
  }
}

async function getBlobFromIDB(key) {
  try {
    const db = await openBlobDB();
    return new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function deleteBlobFromIDB(key) {
  try {
    const db = await openBlobDB();
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(key);
  } catch {
    // Ignore
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function getInitialLocalDB() {
  const now = new Date().toISOString();
  return {
    users: [
      {
        id: 'usr_admin',
        username: 'admin',
        display_name: 'Server Admin',
        password: 'admin123',
        role: 'admin',
        quota_bytes: 50 * 1024 * 1024 * 1024,
        avatar_color: '#8b5cf6',
        created_at: now,
      },
      {
        id: 'usr_elena',
        username: 'elena',
        display_name: 'Elena Rostova',
        password: 'elena123',
        role: 'user',
        quota_bytes: 5 * 1024 * 1024 * 1024,
        avatar_color: '#ec4899',
        created_at: now,
      },
      {
        id: 'usr_david',
        username: 'david',
        display_name: 'David Kim',
        password: 'david123',
        role: 'user',
        quota_bytes: 2 * 1024 * 1024 * 1024,
        avatar_color: '#06b6d4',
        created_at: now,
      },
    ],
    folders: [
      { id: 'fld_alps', user_id: 'usr_elena', name: 'Summer in Alps 2026', created_at: now },
      { id: 'fld_family', user_id: 'usr_elena', name: 'Family Portraits', created_at: now },
      { id: 'fld_street', user_id: 'usr_david', name: 'Tokyo Night Street', created_at: now },
      { id: 'fld_server', user_id: 'usr_admin', name: 'Home Lab & Setup', created_at: now },
    ],
    photos: [],
  };
}

function loadLocalDB() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.LOCAL_STATE);
    if (!raw) {
      const seed = getInitialLocalDB();
      localStorage.setItem(STORAGE_KEYS.LOCAL_STATE, JSON.stringify(seed));
      return seed;
    }
    return JSON.parse(raw);
  } catch {
    return getInitialLocalDB();
  }
}

function saveLocalDB(db) {
  localStorage.setItem(STORAGE_KEYS.LOCAL_STATE, JSON.stringify(db));
}

export function getConfiguredApiUrl() {
  const saved = localStorage.getItem(STORAGE_KEYS.API_URL);
  if (saved !== null) return saved.replace(/\/+$/, '');
  const envUrl = import.meta.env.VITE_API_URL || 'https://blserv.tailf8397c.ts.net';
  return envUrl.replace(/\/+$/, '');
}

export function setConfiguredApiUrl(url) {
  const cleaned = (url || '').trim().replace(/\/+$/, '');
  localStorage.setItem(STORAGE_KEYS.API_URL, cleaned);
}

export function getToken() {
  return localStorage.getItem(STORAGE_KEYS.TOKEN);
}

export function setToken(token) {
  if (token) {
    localStorage.setItem(STORAGE_KEYS.TOKEN, token);
  } else {
    localStorage.removeItem(STORAGE_KEYS.TOKEN);
  }
}

let backendReachable = false;

export function isBackendConnected() {
  return backendReachable;
}

export async function probeServerHealth() {
  const baseUrl = getConfiguredApiUrl();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${baseUrl}/api/health`, { signal: controller.signal });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      if (data && data.status === 'ok') {
        backendReachable = true;
        return { connected: true, info: data };
      }
    }
  } catch {
    // Server offline or not configured yet
  }
  backendReachable = false;
  return { connected: false, info: null };
}

function resolveMediaUrl(relativePath) {
  if (!relativePath) return '';
  if (relativePath.startsWith('http') || relativePath.startsWith('data:') || relativePath.startsWith('blob:')) {
    return relativePath;
  }
  const base = getConfiguredApiUrl();
  const token = getToken();
  const sep = relativePath.includes('?') ? '&' : '?';
  return `${base}${relativePath}${token ? `${sep}token=${encodeURIComponent(token)}` : ''}`;
}

async function apiFetch(path, options = {}) {
  const base = getConfiguredApiUrl();
  const token = getToken();
  const headers = { ...(options.headers || {}) };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (!(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${base}${path}`, {
    ...options,
    headers,
  });
  if (!res.ok) {
    let errMsg = `Request failed (${res.status})`;
    try {
      const errData = await res.json();
      if (errData.detail) errMsg = errData.detail;
    } catch {
      // Ignore
    }
    throw new Error(errMsg);
  }
  return res.json();
}

// Upload via XMLHttpRequest with automatic retry & smooth 0->95% (sending) -> 100% (green saved) progress
async function apiUploadWithProgress(path, formDataFactory, onProgress, maxRetries = 3) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await new Promise((resolve, reject) => {
        const base = getConfiguredApiUrl();
        const token = getToken();
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${base}${path}`, true);
        xhr.timeout = 45000;
        if (token) {
          xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        }

        let processingTimer = null;
        let currentPct = 1;

        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable && typeof onProgress === 'function') {
            // Map network byte transfer to 1%..92% so 100% is strictly reserved for green 'Saved on disk'
            const sendPct = Math.min(92, Math.max(1, Math.round((event.loaded / event.total) * 92)));
            currentPct = sendPct;
            onProgress(sendPct, event.loaded, event.total);

            if (event.loaded >= event.total && !processingTimer) {
              processingTimer = setInterval(() => {
                if (currentPct < 98) {
                  currentPct += 1;
                  onProgress(currentPct, event.loaded, event.total);
                }
              }, 180);
            }
          }
        };

        const clearTimer = () => {
          if (processingTimer) {
            clearInterval(processingTimer);
            processingTimer = null;
          }
        };

        xhr.onload = () => {
          clearTimer();
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const parsed = JSON.parse(xhr.responseText);
              if (typeof onProgress === 'function') onProgress(100);
              resolve(parsed);
            } catch {
              reject(new Error('Invalid server response'));
            }
          } else {
            let errMsg = `Upload failed (${xhr.status})`;
            try {
              const errData = JSON.parse(xhr.responseText);
              if (errData.detail) errMsg = errData.detail;
            } catch {
              // Ignore
            }
            const err = new Error(errMsg);
            err.status = xhr.status;
            reject(err);
          }
        };

        xhr.onerror = () => {
          clearTimer();
          reject(new Error('Network error during photo upload'));
        };

        xhr.ontimeout = () => {
          clearTimer();
          reject(new Error('Upload timed out, retrying...'));
        };

        const body = typeof formDataFactory === 'function' ? formDataFactory() : formDataFactory;
        xhr.send(body);
      });
    } catch (err) {
      lastError = err;
      // Don't retry on 413 (Quota Exceeded) or 401/403 (Auth error)
      if (err.status === 413 || err.status === 401 || err.status === 403) {
        throw err;
      }
      if (attempt < maxRetries) {
        if (typeof onProgress === 'function') onProgress(5);
        await new Promise((r) => setTimeout(r, 800 * attempt));
      }
    }
  }
  throw lastError || new Error('Upload failed');
}

function computeLocalUserStats(db, user) {
  const userPhotos = db.photos.filter((p) => p.user_id === user.id);
  const userFolders = db.folders.filter((f) => f.user_id === user.id);
  const usedBytes = userPhotos.reduce((acc, p) => acc + (p.compressed_size || 0), 0);
  const origBytes = userPhotos.reduce((acc, p) => acc + (p.original_size || 0), 0);
  const savedBytes = Math.max(0, origBytes - usedBytes);
  return {
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    role: user.role,
    quota_bytes: user.quota_bytes,
    used_bytes: usedBytes,
    original_bytes: origBytes,
    saved_bytes: savedBytes,
    photo_count: userPhotos.length,
    folder_count: userFolders.length,
    avatar_color: user.avatar_color || '#6366f1',
    created_at: user.created_at,
    virtual_path: `storage/users/${user.id}/`,
  };
}

async function hydrateLocalPhoto(db, photo) {
  const owner = db.users.find((u) => u.id === photo.user_id);
  const orig = photo.original_size || 0;
  const comp = photo.compressed_size || 0;
  const saved = Math.max(0, orig - comp);
  const savedPct = orig > 0 ? Number(((saved / orig) * 100).toFixed(1)) : 0;

  let fileUrl = photo.demo_url || '';
  let thumbUrl = photo.thumb_data_url || photo.demo_url || '';

  if (!fileUrl && photo.id) {
    const idbData = await getBlobFromIDB(photo.id);
    if (idbData) {
      fileUrl = idbData;
      if (!thumbUrl) thumbUrl = idbData;
    }
  }

  return {
    ...photo,
    owner_username: owner ? owner.username : 'unknown',
    owner_display_name: owner ? owner.display_name : 'Unknown User',
    saved_bytes: saved,
    saved_percent: savedPct,
    file_url: fileUrl,
    thumb_url: thumbUrl || fileUrl,
  };
}

function buildFallbackTelemetry(totalUsed) {
  const diskTotal = 243885932544;
  const sysUsed = 20536918976;
  const diskUsed = sysUsed + totalUsed;
  const diskFree = Math.max(0, diskTotal - diskUsed);
  const ramTotal = 8 * 1024 * 1024 * 1024;
  const ramUsed = Math.round((2.1 + Math.sin(Date.now() / 4000) * 0.15) * 1024 * 1024 * 1024);
  const cpuPct = Number((11.5 + Math.abs(Math.sin(Date.now() / 2200)) * 18.4).toFixed(1));
  return {
    hostname: 'blserv',
    os_info: 'Linux 7.0.0-42-generic',
    cpu_percent: cpuPct,
    cpu_cores: 4,
    cpu_temp_c: Number((46.0 + Math.sin(Date.now() / 5000) * 2.5).toFixed(1)),
    load_avg: [Number((cpuPct / 45).toFixed(2)), 0.34, 0.28],
    uptime_seconds: 18420 + Math.floor(Date.now() / 1000) % 10000,
    ram_total_bytes: ramTotal,
    ram_used_bytes: ramUsed,
    ram_available_bytes: ramTotal - ramUsed,
    ram_percent: Number(((ramUsed / ramTotal) * 100).toFixed(1)),
    swap_total_bytes: 2 * 1024 * 1024 * 1024,
    swap_used_bytes: 64 * 1024 * 1024,
    swap_percent: 3.1,
    disk_total_bytes: diskTotal,
    disk_used_bytes: diskUsed,
    disk_free_bytes: diskFree,
    disk_percent: Number(((diskUsed / diskTotal) * 100).toFixed(1)),
    photo_drive_used_bytes: totalUsed,
    system_other_used_bytes: sysUsed,
    net_rx_bytes: 184920192,
    net_tx_bytes: 94821904,
    timestamp: new Date().toISOString(),
  };
}

export const driveService = {
  async login(username, password) {
    const health = await probeServerHealth();
    if (health.connected) {
      const data = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      setToken(data.token);
      return data.user;
    }

    const db = loadLocalDB();
    const user = db.users.find(
      (u) => u.username.toLowerCase() === username.trim().toLowerCase() && u.password === password
    );
    if (!user) {
      throw new Error('Invalid username or password');
    }
    setToken(`local_token_${user.id}`);
    return computeLocalUserStats(db, user);
  },

  async getCurrentUser() {
    const token = getToken();
    if (!token) return null;

    const health = await probeServerHealth();
    if (health.connected && !token.startsWith('local_token_')) {
      try {
        return await apiFetch('/api/auth/me');
      } catch {
        setToken(null);
        return null;
      }
    }

    const db = loadLocalDB();
    const userId = token.replace('local_token_', '');
    const user = db.users.find((u) => u.id === userId) || db.users[0];
    if (!user) return null;
    return computeLocalUserStats(db, user);
  },

  async getFolders(userId = null) {
    if (backendReachable) {
      const q = userId && userId !== 'all' ? `?user_id=${encodeURIComponent(userId)}` : '';
      return apiFetch(`/api/folders${q}`);
    }
    const db = loadLocalDB();
    const token = getToken() || '';
    const currentId = token.replace('local_token_', '');
    const targetId = userId && userId !== 'all' ? userId : currentId;
    return db.folders
      .filter((f) => f.user_id === targetId)
      .map((f) => ({
        ...f,
        photo_count: db.photos.filter((p) => p.folder_id === f.id).length,
      }));
  },

  async createFolder(name, userId = null) {
    if (backendReachable) {
      return apiFetch('/api/folders', {
        method: 'POST',
        body: JSON.stringify({ name, user_id: userId }),
      });
    }
    const db = loadLocalDB();
    const token = getToken() || '';
    const currentId = token.replace('local_token_', '');
    const targetId = userId && userId !== 'all' ? userId : currentId;
    const newFolder = {
      id: `fld_${Math.random().toString(36).slice(2, 10)}`,
      user_id: targetId,
      name: name.trim(),
      photo_count: 0,
      created_at: new Date().toISOString(),
    };
    db.folders.unshift(newFolder);
    saveLocalDB(db);
    return newFolder;
  },

  async deleteFolder(folderId) {
    if (backendReachable) {
      return apiFetch(`/api/folders/${folderId}`, { method: 'DELETE' });
    }
    const db = loadLocalDB();
    db.folders = db.folders.filter((f) => f.id !== folderId);
    db.photos = db.photos.map((p) => (p.folder_id === folderId ? { ...p, folder_id: null } : p));
    saveLocalDB(db);
    return { deleted: true };
  },

  async getPhotos({ userId = null, folderId = null, favoritesOnly = false } = {}) {
    if (backendReachable) {
      const params = new URLSearchParams();
      if (userId) params.set('user_id', userId);
      if (folderId) params.set('folder_id', folderId);
      if (favoritesOnly) params.set('favorites_only', 'true');
      const list = await apiFetch(`/api/photos?${params.toString()}`);
      return list.map((p) => ({
        ...p,
        file_url: resolveMediaUrl(p.file_url),
        thumb_url: resolveMediaUrl(p.thumb_url),
      }));
    }

    const db = loadLocalDB();
    const token = getToken() || '';
    const currentId = token.replace('local_token_', '');
    const targetUserId = userId || currentId;

    let filtered = db.photos;
    if (targetUserId !== 'all') {
      filtered = filtered.filter((p) => p.user_id === targetUserId);
    }
    if (folderId) {
      filtered = filtered.filter((p) => p.folder_id === folderId);
    }
    if (favoritesOnly) {
      filtered = filtered.filter((p) => p.is_favorite);
    }

    filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return Promise.all(filtered.map((p) => hydrateLocalPhoto(db, p)));
  },

  async uploadPhoto({ shrunkItem, folderId = null, targetUserId = null, onProgress = null }) {
    if (backendReachable) {
      const buildFormData = () => {
        const formData = new FormData();
        formData.append('file', shrunkItem.shrunkFile);
        formData.append('reported_original_size', String(shrunkItem.originalSize));
        if (folderId) formData.append('folder_id', folderId);
        if (targetUserId && targetUserId !== 'all') formData.append('target_user_id', targetUserId);
        return formData;
      };

      const created = await apiUploadWithProgress('/api/photos/upload', buildFormData, onProgress);
      return {
        ...created,
        file_url: resolveMediaUrl(created.file_url),
        thumb_url: resolveMediaUrl(created.thumb_url),
      };
    }

    const db = loadLocalDB();
    const token = getToken() || '';
    const currentId = token.replace('local_token_', '');
    const ownerId = targetUserId && targetUserId !== 'all' ? targetUserId : currentId;
    const owner = db.users.find((u) => u.id === ownerId);
    if (!owner) throw new Error('Target user virtual space not found');

    const stats = computeLocalUserStats(db, owner);
    if (stats.used_bytes + shrunkItem.compressedSize > stats.quota_bytes) {
      throw new Error('Storage quota limit reached for this virtual space! Ask Admin to increase quota.');
    }

    if (typeof onProgress === 'function') onProgress(35);
    const photoId = `pht_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const fullDataUrl = await fileToDataUrl(shrunkItem.shrunkFile);
    if (typeof onProgress === 'function') onProgress(75);
    await saveBlobToIDB(photoId, fullDataUrl);
    if (typeof onProgress === 'function') onProgress(100);

    const record = {
      id: photoId,
      user_id: ownerId,
      folder_id: folderId || null,
      original_name: shrunkItem.originalFile.name,
      mime_type: shrunkItem.mimeType,
      width: shrunkItem.width,
      height: shrunkItem.height,
      original_size: shrunkItem.originalSize,
      compressed_size: shrunkItem.compressedSize,
      is_favorite: false,
      thumb_data_url: shrunkItem.thumbDataUrl,
      created_at: new Date().toISOString(),
    };

    db.photos.unshift(record);
    saveLocalDB(db);
    return hydrateLocalPhoto(db, record);
  },

  async updatePhoto(photoId, updates) {
    if (backendReachable) {
      const updated = await apiFetch(`/api/photos/${photoId}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
      });
      return {
        ...updated,
        file_url: resolveMediaUrl(updated.file_url),
        thumb_url: resolveMediaUrl(updated.thumb_url),
      };
    }

    const db = loadLocalDB();
    const idx = db.photos.findIndex((p) => p.id === photoId);
    if (idx === -1) throw new Error('Photo not found');
    const current = db.photos[idx];
    const next = {
      ...current,
      ...(updates.is_favorite !== undefined ? { is_favorite: updates.is_favorite } : {}),
      ...(updates.folder_id !== undefined ? { folder_id: updates.folder_id || null } : {}),
      ...(updates.original_name ? { original_name: updates.original_name } : {}),
    };
    db.photos[idx] = next;
    saveLocalDB(db);
    return hydrateLocalPhoto(db, next);
  },

  async deletePhoto(photoId) {
    if (backendReachable) {
      return apiFetch(`/api/photos/${photoId}`, { method: 'DELETE' });
    }
    const db = loadLocalDB();
    db.photos = db.photos.filter((p) => p.id !== photoId);
    saveLocalDB(db);
    await deleteBlobFromIDB(photoId);
    return { deleted: true, id: photoId };
  },

  async getAdminOverview() {
    if (backendReachable) {
      return apiFetch('/api/admin/overview');
    }
    const db = loadLocalDB();
    const users = db.users.map((u) => computeLocalUserStats(db, u));
    const totalUsed = users.reduce((a, u) => a + u.used_bytes, 0);
    const totalOrig = users.reduce((a, u) => a + u.original_bytes, 0);
    const totalSaved = users.reduce((a, u) => a + u.saved_bytes, 0);
    const totalQuota = users.reduce((a, u) => a + u.quota_bytes, 0);
    const totalPhotos = users.reduce((a, u) => a + u.photo_count, 0);

    return {
      total_users: users.length,
      total_photos: totalPhotos,
      total_used_bytes: totalUsed,
      total_original_bytes: totalOrig,
      total_saved_bytes: totalSaved,
      total_quota_allocated_bytes: totalQuota,
      storage_root: '/home/bacho/photo-drive-server/storage',
      ...buildFallbackTelemetry(totalUsed),
      users,
    };
  },

  async getLiveTelemetry() {
    if (backendReachable) {
      return apiFetch('/api/admin/telemetry');
    }
    const db = loadLocalDB();
    const totalUsed = db.photos.reduce((a, p) => a + (p.compressed_size || 0), 0);
    return buildFallbackTelemetry(totalUsed);
  },

  async adminCreateUser({ username, display_name, password, quota_mb, role, avatar_color }) {
    if (backendReachable) {
      return apiFetch('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({ username, display_name, password, quota_mb, role, avatar_color }),
      });
    }
    const db = loadLocalDB();
    const cleanUser = username.trim().toLowerCase();
    if (db.users.some((u) => u.username.toLowerCase() === cleanUser)) {
      throw new Error(`Username '${cleanUser}' already exists`);
    }
    const newUser = {
      id: `usr_${Math.random().toString(36).slice(2, 10)}`,
      username: cleanUser,
      display_name: display_name.trim() || cleanUser,
      password,
      role: role === 'admin' ? 'admin' : 'user',
      quota_bytes: Math.max(50, Number(quota_mb) || 5120) * 1024 * 1024,
      avatar_color: avatar_color || '#6366f1',
      created_at: new Date().toISOString(),
    };
    db.users.push(newUser);
    saveLocalDB(db);
    return computeLocalUserStats(db, newUser);
  },

  async adminUpdateUser(userId, { display_name, password, quota_mb, role }) {
    if (backendReachable) {
      return apiFetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ display_name, password, quota_mb, role }),
      });
    }
    const db = loadLocalDB();
    const idx = db.users.findIndex((u) => u.id === userId);
    if (idx === -1) throw new Error('User not found');
    const u = db.users[idx];
    const updated = {
      ...u,
      ...(display_name ? { display_name: display_name.trim() } : {}),
      ...(password ? { password: password.trim() } : {}),
      ...(quota_mb !== undefined ? { quota_bytes: Math.max(50, Number(quota_mb)) * 1024 * 1024 } : {}),
      ...(role ? { role } : {}),
    };
    db.users[idx] = updated;
    saveLocalDB(db);
    return computeLocalUserStats(db, updated);
  },

  async adminDeleteUser(userId) {
    if (backendReachable) {
      return apiFetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
    }
    const db = loadLocalDB();
    const userPhotos = db.photos.filter((p) => p.user_id === userId);
    for (const p of userPhotos) {
      await deleteBlobFromIDB(p.id);
    }
    db.users = db.users.filter((u) => u.id !== userId);
    db.folders = db.folders.filter((f) => f.user_id !== userId);
    db.photos = db.photos.filter((p) => p.user_id !== userId);
    saveLocalDB(db);
    return { deleted: true, id: userId };
  },
};
