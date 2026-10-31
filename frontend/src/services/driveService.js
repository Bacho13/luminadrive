const STORAGE_KEYS = {
  API_URL: 'luminadrive_api_url',
  TOKEN: 'luminadrive_token',
  MODE: 'luminadrive_mode', // 'auto' | 'remote' | 'local'
  LOCAL_STATE: 'luminadrive_local_db_v1',
};

// IndexedDB helper for storing large shrunk photo blobs in Local/Demo fallback mode
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

// Initial seed data for Local Fallback Mode
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
        quota_bytes: 50 * 1024 * 1024 * 1024, // 50 GB
        avatar_color: '#8b5cf6',
        created_at: now,
      },
      {
        id: 'usr_elena',
        username: 'elena',
        display_name: 'Elena Rostova',
        password: 'elena123',
        role: 'user',
        quota_bytes: 5 * 1024 * 1024 * 1024, // 5 GB
        avatar_color: '#ec4899',
        created_at: now,
      },
      {
        id: 'usr_david',
        username: 'david',
        display_name: 'David Kim',
        password: 'david123',
        role: 'user',
        quota_bytes: 2 * 1024 * 1024 * 1024, // 2 GB
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
    photos: [
      {
        id: 'pht_demo_1',
        user_id: 'usr_elena',
        folder_id: 'fld_alps',
        original_name: 'IMG_8492_Matterhorn_Sunrise.JPG',
        mime_type: 'image/webp',
        width: 3840,
        height: 2560,
        original_size: 8420000,
        compressed_size: 1640000,
        is_favorite: true,
        created_at: new Date(Date.now() - 3600 * 1000 * 5).toISOString(),
        demo_url: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=1400&q=85',
      },
      {
        id: 'pht_demo_2',
        user_id: 'usr_elena',
        folder_id: 'fld_alps',
        original_name: 'IMG_8510_Alpine_Lake_Reflection.JPG',
        mime_type: 'image/webp',
        width: 3840,
        height: 2160,
        original_size: 7150000,
        compressed_size: 1380000,
        is_favorite: false,
        created_at: new Date(Date.now() - 3600 * 1000 * 18).toISOString(),
        demo_url: 'https://images.unsplash.com/photo-1469474968028-56623f02e42e?auto=format&fit=crop&w=1400&q=85',
      },
      {
        id: 'pht_demo_3',
        user_id: 'usr_elena',
        folder_id: 'fld_family',
        original_name: 'DSC_0419_Golden_Hour_Coast.PNG',
        mime_type: 'image/webp',
        width: 3200,
        height: 2400,
        original_size: 11200000,
        compressed_size: 1890000,
        is_favorite: true,
        created_at: new Date(Date.now() - 3600 * 1000 * 32).toISOString(),
        demo_url: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1400&q=85',
      },
      {
        id: 'pht_demo_4',
        user_id: 'usr_david',
        folder_id: 'fld_street',
        original_name: 'RAW_9021_Neon_Shibuya_Rain.JPG',
        mime_type: 'image/webp',
        width: 3840,
        height: 2560,
        original_size: 9650000,
        compressed_size: 1720000,
        is_favorite: true,
        created_at: new Date(Date.now() - 3600 * 1000 * 12).toISOString(),
        demo_url: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?auto=format&fit=crop&w=1400&q=85',
      },
      {
        id: 'pht_demo_5',
        user_id: 'usr_david',
        folder_id: null,
        original_name: 'IMG_3012_Mountain_Mist_Forest.JPG',
        mime_type: 'image/webp',
        width: 3600,
        height: 2400,
        original_size: 6480000,
        compressed_size: 1210000,
        is_favorite: false,
        created_at: new Date(Date.now() - 3600 * 1000 * 48).toISOString(),
        demo_url: 'https://images.unsplash.com/photo-1511497584788-876760111969?auto=format&fit=crop&w=1400&q=85',
      },
      {
        id: 'pht_demo_6',
        user_id: 'usr_admin',
        folder_id: 'fld_server',
        original_name: 'Nordic_Aurora_Night_Sky.JPG',
        mime_type: 'image/webp',
        width: 3840,
        height: 2160,
        original_size: 8900000,
        compressed_size: 1540000,
        is_favorite: true,
        created_at: new Date(Date.now() - 3600 * 1000 * 4).toISOString(),
        demo_url: 'https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&w=1400&q=85',
      },
    ],
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
    const timer = setTimeout(() => controller.abort(), 2500);
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

// Local DB helper to compute user stats identical to FastAPI backend
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

// =====================================================================
// EXPORTED UNIFIED SERVICE METHODS
// =====================================================================
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

    // Local fallback
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

  async uploadPhoto({ shrunkItem, folderId = null, targetUserId = null }) {
    if (backendReachable) {
      const formData = new FormData();
      formData.append('file', shrunkItem.shrunkFile);
      formData.append('reported_original_size', String(shrunkItem.originalSize));
      if (folderId) formData.append('folder_id', folderId);
      if (targetUserId && targetUserId !== 'all') formData.append('target_user_id', targetUserId);

      const created = await apiFetch('/api/photos/upload', {
        method: 'POST',
        body: formData,
      });
      return {
        ...created,
        file_url: resolveMediaUrl(created.file_url),
        thumb_url: resolveMediaUrl(created.thumb_url),
      };
    }

    // Local fallback mode with real quota check & IndexedDB storage
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

    const photoId = `pht_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const fullDataUrl = await fileToDataUrl(shrunkItem.shrunkFile);
    await saveBlobToIDB(photoId, fullDataUrl);

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

  // Admin methods
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
    const simulatedDiskTotal = 512 * 1024 * 1024 * 1024; // 512 GB Linux Laptop SSD

    return {
      total_users: users.length,
      total_photos: totalPhotos,
      total_used_bytes: totalUsed,
      total_original_bytes: totalOrig,
      total_saved_bytes: totalSaved,
      total_quota_allocated_bytes: totalQuota,
      disk_total_bytes: simulatedDiskTotal,
      disk_used_bytes: 42 * 1024 * 1024 * 1024 + totalUsed,
      disk_free_bytes: simulatedDiskTotal - (42 * 1024 * 1024 * 1024 + totalUsed),
      storage_root: '/home/laptop-server/photo-drive/storage',
      users,
    };
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
