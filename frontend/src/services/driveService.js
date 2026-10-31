const DEFAULT_SERVER_URL = 'https://blserv.tailf8397c.ts.net';

const STORAGE_KEYS = {
  API_URL: 'luminadrive_api_url',
  TOKEN: 'luminadrive_token',
  LOCAL_STATE: 'luminadrive_local_db_v1',
  MIGRATED_IDS: 'luminadrive_migrated_ids_v1',
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

function dataUrlToFile(dataUrl, filename, mimeType = 'image/webp') {
  const arr = dataUrl.split(',');
  const mimeMatch = arr[0].match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : mimeType;
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new File([u8arr], filename, { type: mime });
}

export function getConfiguredApiUrl() {
  const saved = localStorage.getItem(STORAGE_KEYS.API_URL);
  if (saved) {
    // Auto-clear old temporary trycloudflare URLs so we always use the permanent Tailscale Funnel URL
    if (saved.includes('trycloudflare.com') || saved.includes('192.168.')) {
      localStorage.removeItem(STORAGE_KEYS.API_URL);
    } else {
      return saved.replace(/\/+$/, '');
    }
  }
  const envUrl = import.meta.env.VITE_API_URL || DEFAULT_SERVER_URL;
  return envUrl.replace(/\/+$/, '');
}

export function setConfiguredApiUrl(url) {
  const cleaned = (url || '').trim().replace(/\/+$/, '');
  if (!cleaned) {
    localStorage.removeItem(STORAGE_KEYS.API_URL);
  } else {
    localStorage.setItem(STORAGE_KEYS.API_URL, cleaned);
  }
}

export function getToken() {
  const tok = localStorage.getItem(STORAGE_KEYS.TOKEN);
  // Never use an old browser-only local_token_ now that the Linux server is live
  if (tok && tok.startsWith('local_token_')) {
    localStorage.removeItem(STORAGE_KEYS.TOKEN);
    return null;
  }
  return tok;
}

export function setToken(token) {
  if (token) {
    localStorage.setItem(STORAGE_KEYS.TOKEN, token);
  } else {
    localStorage.removeItem(STORAGE_KEYS.TOKEN);
  }
}

let backendReachable = true;

export function isBackendConnected() {
  return backendReachable;
}

export async function probeServerHealth() {
  const baseUrl = getConfiguredApiUrl();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
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
    // Ignore transient ping error
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
  backendReachable = true;
  return res.json();
}

// Upload via XMLHttpRequest with automatic retry & smooth 1->92% (sending) -> 100% (green saved) progress
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
              backendReachable = true;
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

/**
 * Automatic Browser-to-Linux-Server Recovery:
 * If the user created any accounts (e.g. 'mariko') or uploaded any photos while their
 * browser was in local/sandbox mode earlier, this automatically migrates those users and
 * photos from browser storage directly onto the Linux laptop server!
 */
export async function recoverLocalUsersAndPhotosToServer() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.LOCAL_STATE);
    if (!raw) return { recoveredUsers: 0, recoveredPhotos: 0 };

    const localDb = JSON.parse(raw);
    if (!localDb || !Array.isArray(localDb.users)) return { recoveredUsers: 0, recoveredPhotos: 0 };

    const migratedRaw = localStorage.getItem(STORAGE_KEYS.MIGRATED_IDS);
    const migrated = migratedRaw ? JSON.parse(migratedRaw) : { users: {}, photos: {} };

    const overview = await apiFetch('/api/admin/overview');
    const serverUsers = overview.users || [];

    const DEMO_USER_IDS = new Set(['usr_admin', 'usr_elena', 'usr_david']);
    const DEMO_PHOTO_IDS = new Set([
      'pht_demo_1',
      'pht_demo_2',
      'pht_demo_3',
      'pht_demo_4',
      'pht_demo_5',
      'pht_demo_6',
    ]);

    let recoveredUsers = 0;
    let recoveredPhotos = 0;

    // Map local user.id -> server user.id
    const userIdMap = { usr_admin: 'usr_admin' };

    for (const lu of localDb.users) {
      if (DEMO_USER_IDS.has(lu.id)) continue;

      const existingOnServer = serverUsers.find(
        (su) => su.username.toLowerCase() === lu.username.toLowerCase()
      );
      if (existingOnServer) {
        userIdMap[lu.id] = existingOnServer.id;
        migrated.users[lu.id] = existingOnServer.id;
      } else if (!migrated.users[lu.id]) {
        try {
          const created = await apiFetch('/api/admin/users', {
            method: 'POST',
            body: JSON.stringify({
              username: lu.username,
              display_name: lu.display_name || lu.username,
              password: lu.password || '123456',
              quota_mb: Math.max(50, Math.round((lu.quota_bytes || 5368709120) / (1024 * 1024))),
              role: lu.role || 'user',
              avatar_color: lu.avatar_color || '#ec4899',
            }),
          });
          userIdMap[lu.id] = created.id;
          migrated.users[lu.id] = created.id;
          recoveredUsers++;
        } catch {
          // Ignore if already created
        }
      }
    }

    // Recover any real photos stored in IndexedDB during earlier offline session
    if (Array.isArray(localDb.photos)) {
      for (const lp of localDb.photos) {
        if (DEMO_PHOTO_IDS.has(lp.id) || migrated.photos[lp.id]) continue;
        const dataUrl = await getBlobFromIDB(lp.id);
        if (!dataUrl) continue;

        const targetServerUserId = userIdMap[lp.user_id] || migrated.users[lp.user_id] || 'usr_admin';
        try {
          const file = dataUrlToFile(dataUrl, lp.original_name || 'photo.webp', lp.mime_type || 'image/webp');
          const formData = new FormData();
          formData.append('file', file);
          formData.append('reported_original_size', String(lp.original_size || file.size));
          formData.append('target_user_id', targetServerUserId);

          await apiUploadWithProgress('/api/photos/upload', () => formData, null, 2);
          migrated.photos[lp.id] = true;
          recoveredPhotos++;
        } catch {
          // Ignore individual photo migration errors
        }
      }
    }

    localStorage.setItem(STORAGE_KEYS.MIGRATED_IDS, JSON.stringify(migrated));
    return { recoveredUsers, recoveredPhotos };
  } catch {
    return { recoveredUsers: 0, recoveredPhotos: 0 };
  }
}

export const driveService = {
  async login(username, password) {
    const data = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    setToken(data.token);
    return data.user;
  },

  async getCurrentUser() {
    const token = getToken();
    if (!token) return null;
    try {
      return await apiFetch('/api/auth/me');
    } catch {
      setToken(null);
      return null;
    }
  },

  async getFolders(userId = null) {
    const q = userId && userId !== 'all' ? `?user_id=${encodeURIComponent(userId)}` : '';
    return apiFetch(`/api/folders${q}`);
  },

  async createFolder(name, userId = null) {
    return apiFetch('/api/folders', {
      method: 'POST',
      body: JSON.stringify({ name, user_id: userId }),
    });
  },

  async deleteFolder(folderId) {
    return apiFetch(`/api/folders/${folderId}`, { method: 'DELETE' });
  },

  async getPhotos({ userId = null, folderId = null, favoritesOnly = false } = {}) {
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
  },

  async uploadPhoto({ shrunkItem, folderId = null, targetUserId = null, onProgress = null }) {
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
  },

  async updatePhoto(photoId, updates) {
    const updated = await apiFetch(`/api/photos/${photoId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
    return {
      ...updated,
      file_url: resolveMediaUrl(updated.file_url),
      thumb_url: resolveMediaUrl(updated.thumb_url),
    };
  },

  async deletePhoto(photoId) {
    return apiFetch(`/api/photos/${photoId}`, { method: 'DELETE' });
  },

  async getAdminOverview() {
    return apiFetch('/api/admin/overview');
  },

  async getLiveTelemetry() {
    return apiFetch('/api/admin/telemetry');
  },

  async adminCreateUser({ username, display_name, password, quota_mb, role, avatar_color }) {
    return apiFetch('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify({ username, display_name, password, quota_mb, role, avatar_color }),
    });
  },

  async adminUpdateUser(userId, { username, display_name, password, quota_mb, role }) {
    return apiFetch(`/api/admin/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ username, display_name, password, quota_mb, role }),
    });
  },

  async adminDeleteUser(userId) {
    return apiFetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
  },
};
