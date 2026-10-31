import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  CloudUpload,
  Cpu,
  Database,
  Download,
  Eye,
  Folder,
  FolderPlus,
  HardDrive,
  Heart,
  Image as ImageIcon,
  Info,
  KeyRound,
  LayoutGrid,
  Lock,
  LogOut,
  Maximize2,
  Plus,
  RefreshCw,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  X,
  Zap,
} from 'lucide-react';
import {
  driveService,
  getConfiguredApiUrl,
  isBackendConnected,
  probeServerHealth,
  setConfiguredApiUrl,
  setToken,
} from './services/driveService';
import { formatBytes, shrinkPhotoVisuallyLossless } from './utils/imageShrinker';

const QUOTA_PRESETS_MB = [
  { label: '500 MB', value: 500 },
  { label: '2 GB', value: 2048 },
  { label: '5 GB', value: 5120 },
  { label: '10 GB', value: 10240 },
  { label: '25 GB', value: 25600 },
  { label: '50 GB', value: 51200 },
];

const AVATAR_COLORS = ['#6366f1', '#ec4899', '#06b6d4', '#10b981', '#f59e0b', '#8b5cf6', '#f43f5e'];

export default function App() {
  // Auth & Connection state
  const [currentUser, setCurrentUser] = useState(null);
  const [loadingInit, setLoadingInit] = useState(true);
  const [serverConnected, setServerConnected] = useState(false);
  const [serverModalOpen, setServerModalOpen] = useState(false);
  const [apiUrlInput, setApiUrlInput] = useState(getConfiguredApiUrl());

  // Login form state
  const [loginUsername, setLoginUsername] = useState('admin');
  const [loginPassword, setLoginPassword] = useState('admin123');
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  // Navigation & Virtual Space state
  // activeSection: 'photos' | 'favorites' | 'admin'
  const [activeSection, setActiveSection] = useState('photos');
  const [selectedFolderId, setSelectedFolderId] = useState(null);
  // For Admin: null = own space, 'all' = everyone's photos, or specific user_id
  const [inspectedUserId, setInspectedUserId] = useState(null);

  // Data state
  const [photos, setPhotos] = useState([]);
  const [folders, setFolders] = useState([]);
  const [adminOverview, setAdminOverview] = useState(null);
  const [loadingPhotos, setLoadingPhotos] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('newest'); // 'newest' | 'savings' | 'size'
  const [gridCols, setGridCols] = useState('normal'); // 'normal' | 'compact'

  // Modals
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [pendingUploads, setPendingUploads] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadTargetFolder, setUploadTargetFolder] = useState('');
  const [compareItem, setCompareItem] = useState(null);

  const [newFolderModalOpen, setNewFolderModalOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  const [lightboxPhoto, setLightboxPhoto] = useState(null);

  // Admin Modals
  const [createUserModalOpen, setCreateUserModalOpen] = useState(false);
  const [newUserForm, setNewUserForm] = useState({
    username: '',
    display_name: '',
    password: '',
    quota_mb: 5120,
    role: 'user',
    avatar_color: '#6366f1',
  });
  const [editingUser, setEditingUser] = useState(null);
  const [editUserForm, setEditUserForm] = useState({
    display_name: '',
    password: '',
    quota_mb: 5120,
    role: 'user',
  });

  const [toast, setToast] = useState(null);
  const fileInputRef = useRef(null);

  function showToast(message, type = 'success') {
    setToast({ message, type });
    setTimeout(() => {
      setToast((prev) => (prev?.message === message ? null : prev));
    }, 4000);
  }

  // Initial session restoration
  useEffect(() => {
    async function init() {
      setLoadingInit(true);
      const health = await probeServerHealth();
      setServerConnected(health.connected);
      const user = await driveService.getCurrentUser();
      if (user) {
        setCurrentUser(user);
      }
      setLoadingInit(false);
    }
    init();
  }, []);

  // Load workspace data whenever user or inspected space changes
  useEffect(() => {
    if (!currentUser) return;
    refreshWorkspace();
  }, [currentUser?.id, inspectedUserId, selectedFolderId, activeSection]);

  async function refreshWorkspace() {
    if (!currentUser) return;
    setLoadingPhotos(true);
    try {
      const health = await probeServerHealth();
      setServerConnected(health.connected);

      const freshMe = await driveService.getCurrentUser();
      if (freshMe) setCurrentUser(freshMe);

      const effectiveUserId =
        currentUser.role === 'admin' && inspectedUserId ? inspectedUserId : currentUser.id;

      const [photoList, folderList] = await Promise.all([
        driveService.getPhotos({
          userId: effectiveUserId,
          folderId: selectedFolderId,
          favoritesOnly: activeSection === 'favorites',
        }),
        effectiveUserId !== 'all' ? driveService.getFolders(effectiveUserId) : Promise.resolve([]),
      ]);

      setPhotos(photoList);
      setFolders(folderList);

      if (currentUser.role === 'admin') {
        const overview = await driveService.getAdminOverview();
        setAdminOverview(overview);
      }
    } catch (err) {
      showToast(err.message || 'Failed to load virtual space', 'error');
    } finally {
      setLoadingPhotos(false);
    }
  }

  // Determine the active virtual space owner info (either current user, or the user Admin is inspecting)
  const activeSpaceUser = useMemo(() => {
    if (!currentUser) return null;
    if (currentUser.role === 'admin' && inspectedUserId && inspectedUserId !== 'all' && adminOverview?.users) {
      const found = adminOverview.users.find((u) => u.id === inspectedUserId);
      if (found) return found;
    }
    return currentUser;
  }, [currentUser, inspectedUserId, adminOverview]);

  // Filtered and sorted photos
  const displayedPhotos = useMemo(() => {
    let list = [...photos];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (p) =>
          p.original_name.toLowerCase().includes(q) ||
          (p.owner_display_name && p.owner_display_name.toLowerCase().includes(q)) ||
          (p.owner_username && p.owner_username.toLowerCase().includes(q))
      );
    }
    if (sortBy === 'savings') {
      list.sort((a, b) => (b.saved_bytes || 0) - (a.saved_bytes || 0));
    } else if (sortBy === 'size') {
      list.sort((a, b) => (b.compressed_size || 0) - (a.compressed_size || 0));
    } else {
      list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }
    return list;
  }, [photos, searchQuery, sortBy]);

  // Handlers
  async function handleLogin(e) {
    e?.preventDefault();
    setLoginError('');
    setLoggingIn(true);
    try {
      const user = await driveService.login(loginUsername, loginPassword);
      setCurrentUser(user);
      setInspectedUserId(null);
      setSelectedFolderId(null);
      setActiveSection('photos');
      setServerConnected(isBackendConnected());
      showToast(`Welcome back, ${user.display_name}!`);
    } catch (err) {
      setLoginError(err.message || 'Login failed');
    } finally {
      setLoggingIn(false);
    }
  }

  function handleLogout() {
    setToken(null);
    setCurrentUser(null);
    setPhotos([]);
    setFolders([]);
    setAdminOverview(null);
    setInspectedUserId(null);
  }

  async function handleSaveServerUrl(e) {
    e.preventDefault();
    setConfiguredApiUrl(apiUrlInput);
    const health = await probeServerHealth();
    setServerConnected(health.connected);
    setServerModalOpen(false);
    if (health.connected) {
      showToast('Connected to Linux Laptop Photo Drive server!');
      if (currentUser) refreshWorkspace();
    } else {
      showToast('Server URL saved (Linux server offline — using Browser Sandbox mode)', 'info');
    }
  }

  // Smart Shrink File Selection
  async function handleFilesSelected(fileList) {
    const rawFiles = Array.from(fileList || []).filter((f) => f.type.startsWith('image/'));
    if (rawFiles.length === 0) {
      showToast('Please select valid image files (JPG, PNG, WEBP, HEIC)', 'error');
      return;
    }

    setUploadModalOpen(true);
    // Process each image with our visually-lossless shrinker
    const placeholders = rawFiles.map((f, idx) => ({
      tempId: `${Date.now()}_${idx}`,
      name: f.name,
      originalSize: f.size,
      status: 'shrinking',
    }));
    setPendingUploads((prev) => [...prev, ...placeholders]);

    for (let i = 0; i < rawFiles.length; i++) {
      const f = rawFiles[i];
      const tempId = placeholders[i].tempId;
      const shrunk = await shrinkPhotoVisuallyLossless(f, 3840, 0.86);
      setPendingUploads((prev) =>
        prev.map((item) =>
          item.tempId === tempId
            ? {
                ...item,
                status: 'ready',
                shrunk,
              }
            : item
        )
      );
    }
  }

  async function handleConfirmUpload() {
    const readyItems = pendingUploads.filter((i) => i.status === 'ready' && i.shrunk);
    if (readyItems.length === 0) return;

    setUploading(true);
    const targetUser =
      currentUser.role === 'admin' && inspectedUserId && inspectedUserId !== 'all'
        ? inspectedUserId
        : currentUser.id;
    const folderId = uploadTargetFolder || selectedFolderId || null;

    let uploadedCount = 0;
    let totalSaved = 0;

    try {
      for (const item of readyItems) {
        await driveService.uploadPhoto({
          shrunkItem: item.shrunk,
          folderId,
          targetUserId: targetUser,
        });
        uploadedCount++;
        totalSaved += item.shrunk.savedBytes;
      }
      setPendingUploads([]);
      setUploadModalOpen(false);
      await refreshWorkspace();
      showToast(
        `Uploaded ${uploadedCount} photo${uploadedCount > 1 ? 's' : ''} — Saved ${formatBytes(totalSaved)} without quality loss!`
      );
    } catch (err) {
      showToast(err.message || 'Upload failed', 'error');
    } finally {
      setUploading(false);
    }
  }

  async function handleCreateFolder(e) {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    try {
      const targetUser =
        currentUser.role === 'admin' && inspectedUserId && inspectedUserId !== 'all'
          ? inspectedUserId
          : currentUser.id;
      const created = await driveService.createFolder(newFolderName, targetUser);
      setFolders((prev) => [created, ...prev]);
      setNewFolderName('');
      setNewFolderModalOpen(false);
      showToast(`Album "${created.name}" created`);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function handleDeleteFolder(folderId, e) {
    e.stopPropagation();
    try {
      await driveService.deleteFolder(folderId);
      if (selectedFolderId === folderId) setSelectedFolderId(null);
      await refreshWorkspace();
      showToast('Album removed');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function handleToggleFavorite(photo, e) {
    e?.stopPropagation();
    try {
      const updated = await driveService.updatePhoto(photo.id, {
        is_favorite: !photo.is_favorite,
      });
      setPhotos((prev) => prev.map((p) => (p.id === photo.id ? updated : p)));
      if (lightboxPhoto?.id === photo.id) setLightboxPhoto(updated);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function handleMovePhotoFolder(photo, newFolderId) {
    try {
      const updated = await driveService.updatePhoto(photo.id, {
        folder_id: newFolderId,
      });
      setPhotos((prev) => prev.map((p) => (p.id === photo.id ? updated : p)));
      if (lightboxPhoto?.id === photo.id) setLightboxPhoto(updated);
      await refreshWorkspace();
      showToast('Photo album updated');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function handleDeletePhoto(photo, e) {
    e?.stopPropagation();
    try {
      await driveService.deletePhoto(photo.id);
      setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
      if (lightboxPhoto?.id === photo.id) setLightboxPhoto(null);
      await refreshWorkspace();
      showToast('Photo deleted from virtual space');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // Admin Handlers
  async function handleAdminCreateUser(e) {
    e.preventDefault();
    try {
      const created = await driveService.adminCreateUser(newUserForm);
      setCreateUserModalOpen(false);
      setNewUserForm({
        username: '',
        display_name: '',
        password: '',
        quota_mb: 5120,
        role: 'user',
        avatar_color: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
      });
      await refreshWorkspace();
      showToast(`Registered user "${created.display_name}" with ${formatBytes(created.quota_bytes)} virtual space!`);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function handleAdminUpdateUser(e) {
    e.preventDefault();
    if (!editingUser) return;
    try {
      await driveService.adminUpdateUser(editingUser.id, {
        display_name: editUserForm.display_name,
        password: editUserForm.password || undefined,
        quota_mb: Number(editUserForm.quota_mb),
        role: editUserForm.role,
      });
      setEditingUser(null);
      await refreshWorkspace();
      showToast('User settings & storage quota updated!');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function handleAdminDeleteUser(user) {
    if (user.id === currentUser.id) {
      showToast('Cannot delete your own active Admin account', 'error');
      return;
    }
    try {
      await driveService.adminDeleteUser(user.id);
      if (inspectedUserId === user.id) setInspectedUserId(null);
      await refreshWorkspace();
      showToast(`Deleted user "${user.display_name}" and their virtual space`);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  function openInspectUserSpace(userId) {
    setInspectedUserId(userId);
    setSelectedFolderId(null);
    setActiveSection('photos');
  }

  if (loadingInit) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-300">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm font-medium tracking-wide">Mounting Linux Photo Drive...</p>
        </div>
      </div>
    );
  }

  // ===================================================================
  // VIEW 1: LOGIN SCREEN (ADMIN-ONLY REGISTRATION ENFORCED)
  // ===================================================================
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between relative overflow-hidden">
        {/* Ambient background glow */}
        <div className="pointer-events-none fixed inset-0 overflow-hidden">
          <div className="absolute -top-40 -left-40 w-96 h-96 bg-indigo-600/20 rounded-full blur-3xl" />
          <div className="absolute top-1/3 -right-32 w-96 h-96 bg-fuchsia-600/15 rounded-full blur-3xl" />
          <div className="absolute -bottom-40 left-1/3 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl" />
        </div>

        {/* Top Bar */}
        <header className="relative z-10 flex items-center justify-between px-6 py-5 max-w-7xl w-full mx-auto">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-500/30">
              <Camera className="w-5 h-5 text-white" />
            </div>
            <div>
              <span className="font-bold text-lg tracking-tight text-white">LuminaDrive</span>
              <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                Linux Home Server Edition
              </span>
            </div>
          </div>

          <button
            onClick={() => {
              setApiUrlInput(getConfiguredApiUrl());
              setServerModalOpen(true);
            }}
            className="flex items-center gap-2 text-xs font-medium px-3.5 py-2 rounded-xl bg-slate-900/90 hover:bg-slate-800 border border-slate-800 text-slate-300 transition"
          >
            <span
              className={`w-2 h-2 rounded-full ${
                serverConnected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
              }`}
            />
            {serverConnected ? 'Linux Laptop Server: Online' : 'Sandbox Mode (Configure Laptop URL)'}
            <Settings className="w-3.5 h-3.5 text-slate-400" />
          </button>
        </header>

        {/* Main Login Card */}
        <main className="relative z-10 flex-1 flex items-center justify-center px-4 py-8">
          <div className="w-full max-w-4xl grid md:grid-cols-12 bg-slate-900/70 backdrop-blur-xl border border-slate-800/90 rounded-3xl shadow-2xl overflow-hidden">
            {/* Left Feature Column */}
            <div className="md:col-span-6 p-8 md:p-10 bg-gradient-to-br from-indigo-950/60 via-slate-900/80 to-slate-950 flex flex-col justify-between border-b md:border-b-0 md:border-r border-slate-800/80">
              <div>
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-xs font-medium mb-6">
                  <Sparkles className="w-3.5 h-3.5" /> Smart Visually-Lossless Photo Cloud
                </div>
                <h1 className="text-2xl md:text-3xl font-bold text-white leading-tight mb-4">
                  Your Old Linux Laptop, Reimagined as Google Photos.
                </h1>
                <p className="text-slate-400 text-sm leading-relaxed mb-8">
                  Automatically shrinks photo file sizes by <strong className="text-slate-200">65%–85%</strong> with
                  zero visible quality loss before saving to your laptop&apos;s physical drive.
                </p>

                <div className="space-y-4">
                  <div className="flex items-start gap-3.5">
                    <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center shrink-0 mt-0.5">
                      <Zap className="w-4 h-4 text-emerald-400" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-slate-200">Zero-Quality-Loss Shrinking</h3>
                      <p className="text-xs text-slate-400">
                        Smart 4K WebP perceptual optimization keeps every detail crystal clear at a fraction of the MB.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3.5">
                    <div className="w-8 h-8 rounded-lg bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center shrink-0 mt-0.5">
                      <HardDrive className="w-4 h-4 text-indigo-400" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-slate-200">Isolated Virtual Spaces & Quotas</h3>
                      <p className="text-xs text-slate-400">
                        Each user gets a private virtual drive & custom GB quota. Admin can inspect all spaces.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3.5">
                    <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0 mt-0.5">
                      <ShieldCheck className="w-4 h-4 text-amber-400" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-slate-200">Invite-Only by Server Admin</h3>
                      <p className="text-xs text-slate-400">
                        Public sign-up is disabled. Only the Server Administrator can register accounts.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-8 pt-6 border-t border-slate-800/80">
                <p className="text-xs font-medium text-slate-400 mb-2.5">Quick-fill Accounts (Click to test):</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setLoginUsername('admin');
                      setLoginPassword('admin123');
                    }}
                    className="text-xs px-3 py-1.5 rounded-lg bg-violet-500/15 hover:bg-violet-500/25 text-violet-300 border border-violet-500/30 transition flex items-center gap-1.5"
                  >
                    <ShieldCheck className="w-3.5 h-3.5" /> Admin (admin / admin123)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setLoginUsername('elena');
                      setLoginPassword('elena123');
                    }}
                    className="text-xs px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
                  >
                    User: Elena
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setLoginUsername('david');
                      setLoginPassword('david123');
                    }}
                    className="text-xs px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
                  >
                    User: David
                  </button>
                </div>
              </div>
            </div>

            {/* Right Login Form */}
            <div className="md:col-span-6 p-8 md:p-10 flex flex-col justify-center">
              <div className="mb-6">
                <h2 className="text-xl font-bold text-white">Sign in to Your Virtual Space</h2>
                <p className="text-xs text-slate-400 mt-1">
                  Enter the credentials provided by your Server Administrator.
                </p>
              </div>

              {loginError && (
                <div className="mb-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                  <Info className="w-4 h-4 shrink-0" />
                  <span>{loginError}</span>
                </div>
              )}

              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">Username</label>
                  <input
                    type="text"
                    required
                    value={loginUsername}
                    onChange={(e) => setLoginUsername(e.target.value)}
                    placeholder="e.g. admin or elena"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950/90 border border-slate-800 text-sm text-white focus:outline-none focus:border-indigo-500 transition"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">Password</label>
                  <input
                    type="password"
                    required
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950/90 border border-slate-800 text-sm text-white focus:outline-none focus:border-indigo-500 transition"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loggingIn}
                  className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-semibold text-sm shadow-lg shadow-indigo-600/25 transition disabled:opacity-50"
                >
                  {loggingIn ? 'Mounting Virtual Space...' : 'Sign In to Photo Drive'}
                </button>
              </form>

              <div className="mt-6 p-3.5 rounded-xl bg-slate-950/70 border border-slate-800/80 flex items-start gap-3">
                <Lock className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                <div className="text-xs text-slate-400 leading-relaxed">
                  <span className="text-slate-200 font-medium">Need an account?</span> Public registration is disabled
                  for privacy. Ask the <span className="text-indigo-300">Server Admin</span> to create your virtual
                  space and storage quota.
                </div>
              </div>
            </div>
          </div>
        </main>

        {/* Server Connection Modal */}
        {serverModalOpen && (
          <ServerConfigModal
            apiUrlInput={apiUrlInput}
            setApiUrlInput={setApiUrlInput}
            serverConnected={serverConnected}
            onSave={handleSaveServerUrl}
            onClose={() => setServerModalOpen(false)}
          />
        )}
      </div>
    );
  }

  // ===================================================================
  // VIEW 2: AUTHENTICATED WORKSPACE (USER VIRTUAL SPACE + ADMIN CONSOLE)
  // ===================================================================
  const quotaBytes = activeSpaceUser?.quota_bytes || 1;
  const usedBytes = activeSpaceUser?.used_bytes || 0;
  const savedBytes = activeSpaceUser?.saved_bytes || 0;
  const origBytes = activeSpaceUser?.original_bytes || 0;
  const quotaPercent = Math.min(100, Number(((usedBytes / quotaBytes) * 100).toFixed(1)));
  const savingsPercent = origBytes > 0 ? Number(((savedBytes / origBytes) * 100).toFixed(1)) : 0;

  const isInspectingOther =
    currentUser.role === 'admin' && inspectedUserId && inspectedUserId !== currentUser.id;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col md:flex-row">
      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 max-w-md px-4 py-3 rounded-2xl bg-slate-900/95 border border-slate-700 shadow-2xl flex items-center gap-3 animate-bounce">
          <div
            className={`w-2.5 h-2.5 rounded-full shrink-0 ${
              toast.type === 'error' ? 'bg-rose-500' : 'bg-emerald-400'
            }`}
          />
          <span className="text-xs font-medium text-slate-100">{toast.message}</span>
        </div>
      )}

      {/* ===============================================================
          LEFT SIDEBAR
         =============================================================== */}
      <aside className="w-full md:w-72 bg-slate-900/60 border-b md:border-b-0 md:border-r border-slate-800/80 flex flex-col justify-between p-4 shrink-0">
        <div className="space-y-6">
          {/* App Brand + Server Badge */}
          <div className="flex items-center justify-between px-2">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center shadow-md shadow-indigo-500/20">
                <Camera className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="font-bold text-base tracking-tight text-white leading-none">LuminaDrive</h1>
                <button
                  onClick={() => {
                    setApiUrlInput(getConfiguredApiUrl());
                    setServerModalOpen(true);
                  }}
                  className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-400 hover:text-indigo-300 transition"
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      serverConnected ? 'bg-emerald-400' : 'bg-amber-400'
                    }`}
                  />
                  {serverConnected ? 'Linux Disk Connected' : 'Browser Storage Mode'}
                </button>
              </div>
            </div>

            <button
              onClick={() => fileInputRef.current?.click()}
              title="Upload & Shrink Photos"
              className="p-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/25 transition"
            >
              <CloudUpload className="w-4 h-4" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                handleFilesSelected(e.target.files);
                e.target.value = '';
              }}
            />
          </div>

          {/* ADMIN CONTROL SWITCHER */}
          {currentUser.role === 'admin' && (
            <div className="p-3 rounded-2xl bg-gradient-to-br from-violet-950/60 to-slate-900 border border-violet-500/30 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-violet-300 flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5" /> Admin Master Access
                </span>
                <button
                  onClick={() => setCreateUserModalOpen(true)}
                  className="text-[11px] px-2 py-0.5 rounded-md bg-violet-500/20 hover:bg-violet-500/30 text-violet-200 border border-violet-500/30 transition flex items-center gap-1"
                >
                  <UserPlus className="w-3 h-3" /> + User
                </button>
              </div>

              <button
                onClick={() => setActiveSection('admin')}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition ${
                  activeSection === 'admin'
                    ? 'bg-violet-600 text-white shadow-md shadow-violet-600/30'
                    : 'bg-slate-900/80 text-slate-300 hover:bg-slate-800'
                }`}
              >
                <span className="flex items-center gap-2">
                  <Users className="w-4 h-4" /> All Users & Quotas
                </span>
                <span className="px-1.5 py-0.5 rounded bg-black/20 text-[10px]">
                  {adminOverview?.total_users || 1}
                </span>
              </button>

              <div>
                <label className="block text-[10px] text-slate-400 mb-1">
                  Inspect Virtual Space of Any User:
                </label>
                <select
                  value={inspectedUserId || currentUser.id}
                  onChange={(e) => {
                    const val = e.target.value;
                    setInspectedUserId(val === currentUser.id ? null : val);
                    setSelectedFolderId(null);
                    if (activeSection === 'admin') setActiveSection('photos');
                  }}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-violet-500"
                >
                  <option value={currentUser.id}>My Space ({currentUser.display_name})</option>
                  <option value="all">🌐 Every User&apos;s Photos (Combined)</option>
                  {adminOverview?.users
                    ?.filter((u) => u.id !== currentUser.id)
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        👤 {u.display_name} (@{u.username}) — {formatBytes(u.used_bytes)}
                      </option>
                    ))}
                </select>
              </div>
            </div>
          )}

          {/* Virtual Space Navigation */}
          <div className="space-y-1">
            <p className="px-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
              Virtual Space
            </p>
            <button
              onClick={() => {
                setActiveSection('photos');
                setSelectedFolderId(null);
              }}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-medium transition ${
                activeSection === 'photos' && !selectedFolderId
                  ? 'bg-indigo-600/15 text-indigo-300 border border-indigo-500/30'
                  : 'text-slate-300 hover:bg-slate-800/60'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <ImageIcon className="w-4 h-4" /> All Photos
              </span>
              <span className="text-[11px] text-slate-400">
                {inspectedUserId === 'all'
                  ? adminOverview?.total_photos || photos.length
                  : activeSpaceUser?.photo_count || 0}
              </span>
            </button>

            <button
              onClick={() => {
                setActiveSection('favorites');
                setSelectedFolderId(null);
              }}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-medium transition ${
                activeSection === 'favorites'
                  ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                  : 'text-slate-300 hover:bg-slate-800/60'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <Heart className="w-4 h-4" /> Favorites
              </span>
            </button>
          </div>

          {/* Albums / Folders in Virtual Space */}
          {inspectedUserId !== 'all' && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between px-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Albums ({folders.length})
                </span>
                <button
                  onClick={() => setNewFolderModalOpen(true)}
                  className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                >
                  <FolderPlus className="w-3.5 h-3.5" /> New
                </button>
              </div>

              <div className="max-h-44 overflow-y-auto space-y-1 pr-1">
                {folders.length === 0 ? (
                  <p className="px-2 py-2 text-[11px] text-slate-500 italic">No albums in this virtual space yet.</p>
                ) : (
                  folders.map((folder) => (
                    <div
                      key={folder.id}
                      onClick={() => {
                        setActiveSection('photos');
                        setSelectedFolderId(folder.id);
                      }}
                      className={`group flex items-center justify-between px-3 py-2 rounded-xl text-xs cursor-pointer transition ${
                        selectedFolderId === folder.id && activeSection === 'photos'
                          ? 'bg-indigo-600/20 text-indigo-200 border border-indigo-500/30'
                          : 'text-slate-300 hover:bg-slate-800/60'
                      }`}
                    >
                      <span className="flex items-center gap-2 truncate">
                        <Folder className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                        <span className="truncate">{folder.name}</span>
                      </span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-slate-500">{folder.photo_count ?? 0}</span>
                        <button
                          onClick={(e) => handleDeleteFolder(folder.id, e)}
                          className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-rose-400 p-0.5 transition"
                          title="Delete Album"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Bottom Storage Quota & Shrink Savings Cards */}
        <div className="space-y-3 mt-6 pt-4 border-t border-slate-800/80">
          {/* Storage Quota Progress Card */}
          {inspectedUserId !== 'all' && activeSpaceUser && (
            <div className="p-3.5 rounded-2xl bg-slate-950/90 border border-slate-800/90 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-200 flex items-center gap-1.5">
                  <HardDrive className="w-3.5 h-3.5 text-indigo-400" />
                  {isInspectingOther ? `${activeSpaceUser.display_name}'s Quota` : 'Virtual Space Quota'}
                </span>
                <span className="text-[11px] font-semibold text-slate-300">{quotaPercent}%</span>
              </div>

              <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    quotaPercent > 90
                      ? 'bg-rose-500'
                      : quotaPercent > 75
                        ? 'bg-amber-500'
                        : 'bg-gradient-to-r from-indigo-500 to-cyan-400'
                  }`}
                  style={{ width: `${Math.max(2, quotaPercent)}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>{formatBytes(usedBytes)} used</span>
                <span>Limit: {formatBytes(quotaBytes)}</span>
              </div>

              <div className="pt-1 flex items-center justify-between text-[10px] text-emerald-400 border-t border-slate-800/80">
                <span className="flex items-center gap-1">
                  <Sparkles className="w-3 h-3" /> Shrunk Savings:
                </span>
                <span className="font-semibold">
                  {formatBytes(savedBytes)} ({savingsPercent}%)
                </span>
              </div>
            </div>
          )}

          {/* User Profile & Logout */}
          <div className="flex items-center justify-between px-2 py-1.5 rounded-xl bg-slate-900/90 border border-slate-800/60">
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white shrink-0"
                style={{ backgroundColor: currentUser.avatar_color || '#6366f1' }}
              >
                {currentUser.display_name.slice(0, 2).toUpperCase()}
              </div>
              <div className="truncate">
                <p className="text-xs font-semibold text-white truncate">{currentUser.display_name}</p>
                <p className="text-[10px] text-slate-400 truncate">
                  @{currentUser.username} · {currentUser.role.toUpperCase()}
                </p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              title="Sign Out"
              className="p-2 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* ===============================================================
          MAIN CONTENT AREA
         =============================================================== */}
      <main className="flex-1 flex flex-col min-w-0 max-h-screen overflow-y-auto">
        {/* Admin Inspection Banner when viewing another user's virtual space */}
        {isInspectingOther && (
          <div className="bg-gradient-to-r from-violet-900/80 via-indigo-900/80 to-slate-900 border-b border-violet-500/40 px-6 py-2.5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 text-xs">
              <Eye className="w-4 h-4 text-violet-300 shrink-0" />
              <span>
                Admin Inspector Mode: Viewing{' '}
                <strong className="text-white">
                  {inspectedUserId === 'all'
                    ? "Every User's Virtual Space (Combined)"
                    : `${activeSpaceUser?.display_name}'s Virtual Space (@${activeSpaceUser?.username})`}
                </strong>
              </span>
              {activeSpaceUser && inspectedUserId !== 'all' && (
                <span className="hidden sm:inline-block px-2 py-0.5 rounded bg-black/30 text-[11px] font-mono text-violet-200">
                  {activeSpaceUser.virtual_path}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setActiveSection('admin')}
                className="text-xs px-3 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white transition"
              >
                Back to All Users
              </button>
              <button
                onClick={() => setInspectedUserId(null)}
                className="text-xs px-3 py-1 rounded-lg bg-violet-500 hover:bg-violet-400 text-white font-medium transition"
              >
                Return to My Space
              </button>
            </div>
          </div>
        )}

        {/* Top Header Bar */}
        <header className="sticky top-0 z-20 bg-slate-950/85 backdrop-blur-md border-b border-slate-800/80 px-6 py-4 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              {activeSection === 'admin' ? (
                <>
                  <ShieldCheck className="w-5 h-5 text-violet-400" />
                  Server Admin Control Center & User Spaces
                </>
              ) : activeSection === 'favorites' ? (
                <>
                  <Heart className="w-5 h-5 text-rose-400" />
                  Favorite Photos
                </>
              ) : selectedFolderId ? (
                <>
                  <Folder className="w-5 h-5 text-indigo-400" />
                  {folders.find((f) => f.id === selectedFolderId)?.name || 'Album'}
                </>
              ) : inspectedUserId === 'all' ? (
                <>
                  <Database className="w-5 h-5 text-cyan-400" />
                  All Users&apos; Photos Across Server
                </>
              ) : (
                <>
                  <ImageIcon className="w-5 h-5 text-indigo-400" />
                  {isInspectingOther ? `${activeSpaceUser?.display_name}'s Photos` : 'My Virtual Photo Space'}
                </>
              )}
            </h2>
            <p className="text-xs text-slate-400">
              {activeSection === 'admin'
                ? 'Register users, manage storage quotas, and inspect every virtual space on your Linux laptop.'
                : `Stored shrunk without quality loss · ${displayedPhotos.length} photo${
                    displayedPhotos.length === 1 ? '' : 's'
                  }`}
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {activeSection !== 'admin' && (
              <>
                {/* Search input */}
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search photos..."
                    className="pl-9 pr-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs text-white focus:outline-none focus:border-indigo-500 w-44 sm:w-56"
                  />
                </div>

                {/* Sort select */}
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-300 focus:outline-none focus:border-indigo-500"
                >
                  <option value="newest">Newest First</option>
                  <option value="savings">Most Space Saved</option>
                  <option value="size">Largest File Size</option>
                </select>

                {/* Grid size toggle */}
                <button
                  onClick={() => setGridCols((c) => (c === 'normal' ? 'compact' : 'normal'))}
                  title="Toggle Grid Density"
                  className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300"
                >
                  <LayoutGrid className="w-4 h-4" />
                </button>
              </>
            )}

            <button
              onClick={refreshWorkspace}
              title="Refresh"
              className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300"
            >
              <RefreshCw className={`w-4 h-4 ${loadingPhotos ? 'animate-spin text-indigo-400' : ''}`} />
            </button>

            {activeSection === 'admin' ? (
              <button
                onClick={() => setCreateUserModalOpen(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-xs font-semibold shadow-lg shadow-violet-600/25 transition"
              >
                <UserPlus className="w-4 h-4" /> Register New User
              </button>
            ) : (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/25 transition"
              >
                <CloudUpload className="w-4 h-4" /> Shrink & Upload Photos
              </button>
            )}
          </div>
        </header>

        {/* =============================================================
            SECTION A: ADMIN CONTROL CENTER (ALL USERS, QUOTAS, DISK)
           ============================================================= */}
        {activeSection === 'admin' && currentUser.role === 'admin' && adminOverview ? (
          <div className="p-6 space-y-6">
            {/* Global Server Stats Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="p-5 rounded-2xl bg-slate-900/70 border border-slate-800/90 space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Virtual Spaces & Users</span>
                  <Users className="w-4 h-4 text-violet-400" />
                </div>
                <p className="text-2xl font-bold text-white">{adminOverview.total_users}</p>
                <p className="text-[11px] text-slate-400">
                  Allocated Quota: <span className="text-slate-200">{formatBytes(adminOverview.total_quota_allocated_bytes)}</span>
                </p>
              </div>

              <div className="p-5 rounded-2xl bg-slate-900/70 border border-slate-800/90 space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Total Photos Stored</span>
                  <ImageIcon className="w-4 h-4 text-indigo-400" />
                </div>
                <p className="text-2xl font-bold text-white">{adminOverview.total_photos}</p>
                <p className="text-[11px] text-slate-400">
                  Stored Size on Disk: <span className="text-indigo-300 font-medium">{formatBytes(adminOverview.total_used_bytes)}</span>
                </p>
              </div>

              <div className="p-5 rounded-2xl bg-emerald-950/25 border border-emerald-500/30 space-y-2">
                <div className="flex items-center justify-between text-xs text-emerald-300">
                  <span>Space Saved by Smart Shrink</span>
                  <Zap className="w-4 h-4 text-emerald-400" />
                </div>
                <p className="text-2xl font-bold text-emerald-400">
                  {formatBytes(adminOverview.total_saved_bytes)}
                </p>
                <p className="text-[11px] text-emerald-200/70">
                  Original Raw Size: {formatBytes(adminOverview.total_original_bytes)}
                </p>
              </div>

              <div className="p-5 rounded-2xl bg-slate-900/70 border border-slate-800/90 space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Linux Laptop Disk Free</span>
                  <Server className="w-4 h-4 text-cyan-400" />
                </div>
                <p className="text-2xl font-bold text-white">{formatBytes(adminOverview.disk_free_bytes)}</p>
                <p className="text-[11px] text-slate-400 truncate" title={adminOverview.storage_root}>
                  Path: {adminOverview.storage_root}
                </p>
              </div>
            </div>

            {/* Quick Inspect All Photos Banner */}
            <div className="p-4 rounded-2xl bg-gradient-to-r from-indigo-950/60 via-slate-900 to-slate-900 border border-indigo-500/30 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center">
                  <Eye className="w-5 h-5 text-indigo-300" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">Master Photo Stream</h3>
                  <p className="text-xs text-slate-400">
                    Browse every photo uploaded across all users&apos; virtual spaces in one unified view.
                  </p>
                </div>
              </div>
              <button
                onClick={() => openInspectUserSpace('all')}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition"
              >
                View All Users&apos; Photos ({adminOverview.total_photos})
              </button>
            </div>

            {/* Users & Virtual Spaces Directory */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-200">
                  Registered Users & Virtual Spaces ({adminOverview.users.length})
                </h3>
                <span className="text-xs text-slate-400">
                  Only Admin can register users or modify their storage quota
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {adminOverview.users.map((u) => {
                  const uPct = Math.min(100, Number(((u.used_bytes / (u.quota_bytes || 1)) * 100).toFixed(1)));
                  return (
                    <div
                      key={u.id}
                      className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 hover:border-slate-700 transition flex flex-col justify-between gap-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div
                            className="w-11 h-11 rounded-xl flex items-center justify-center text-sm font-bold text-white shrink-0"
                            style={{ backgroundColor: u.avatar_color || '#6366f1' }}
                          >
                            {u.display_name.slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h4 className="font-semibold text-sm text-white">{u.display_name}</h4>
                              <span
                                className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                                  u.role === 'admin'
                                    ? 'bg-violet-500/20 text-violet-300 border border-violet-500/30'
                                    : 'bg-slate-800 text-slate-300'
                                }`}
                              >
                                {u.role.toUpperCase()}
                              </span>
                            </div>
                            <p className="text-xs text-slate-400">
                              @{u.username} · <span className="font-mono text-[11px]">{u.virtual_path}</span>
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => {
                              setEditingUser(u);
                              setEditUserForm({
                                display_name: u.display_name,
                                password: '',
                                quota_mb: Math.round(u.quota_bytes / (1024 * 1024)),
                                role: u.role,
                              });
                            }}
                            className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 transition"
                          >
                            Edit Quota
                          </button>
                          {u.id !== currentUser.id && (
                            <button
                              onClick={() => handleAdminDeleteUser(u)}
                              title="Delete User & Virtual Space"
                              className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* User Storage Quota Progress Bar */}
                      <div className="space-y-1.5 bg-slate-950/70 p-3.5 rounded-xl border border-slate-800/80">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-300 font-medium">
                            {formatBytes(u.used_bytes)} <span className="text-slate-500">of</span>{' '}
                            {formatBytes(u.quota_bytes)}
                          </span>
                          <span className="text-slate-400">{uPct}% used</span>
                        </div>
                        <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              uPct > 90
                                ? 'bg-rose-500'
                                : uPct > 75
                                  ? 'bg-amber-500'
                                  : 'bg-gradient-to-r from-indigo-500 to-cyan-400'
                            }`}
                            style={{ width: `${Math.max(2, uPct)}%` }}
                          />
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1">
                          <span>
                            {u.photo_count} photos · {u.folder_count} albums
                          </span>
                          <span className="text-emerald-400">
                            Saved {formatBytes(u.saved_bytes)} via Smart Shrink
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-1">
                        <span className="text-[11px] text-slate-500">
                          Created {new Date(u.created_at).toLocaleDateString()}
                        </span>
                        <button
                          onClick={() => openInspectUserSpace(u.id)}
                          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-indigo-600/20 hover:bg-indigo-600 text-indigo-300 hover:text-white border border-indigo-500/30 text-xs font-medium transition"
                        >
                          <Eye className="w-3.5 h-3.5" /> Open Virtual Space
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          /* =============================================================
             SECTION B: PHOTO GALLERY & VIRTUAL SPACE DROPZONE
             ============================================================= */
          <div
            className="p-6 flex-1 flex flex-col gap-6"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (e.dataTransfer.files?.length) {
                handleFilesSelected(e.dataTransfer.files);
              }
            }}
          >
            {/* Quick Drag & Drop Shrink Banner */}
            <div
              onClick={() => fileInputRef.current?.click()}
              className="group cursor-pointer p-4 rounded-2xl bg-slate-900/50 hover:bg-slate-900/90 border border-dashed border-slate-800 hover:border-indigo-500/60 transition flex flex-wrap items-center justify-between gap-4"
            >
              <div className="flex items-center gap-3.5">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center group-hover:scale-105 transition">
                  <Sparkles className="w-5 h-5 text-indigo-400" />
                </div>
                <div>
                  <h3 className="text-xs sm:text-sm font-semibold text-slate-200">
                    Drop photos anywhere or click to Shrink & Save to Virtual Space
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Automatically optimizes file size by up to 80% with visually lossless 4K quality before saving to disk.
                  </p>
                </div>
              </div>
              <span className="text-xs font-medium text-indigo-400 group-hover:text-indigo-300 px-3 py-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
                Select Photos
              </span>
            </div>

            {/* Photo Grid */}
            {displayedPhotos.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center py-16 text-center">
                <div className="w-16 h-16 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center mb-4">
                  <ImageIcon className="w-8 h-8 text-slate-600" />
                </div>
                <h3 className="text-base font-semibold text-slate-300">No photos in this virtual space yet</h3>
                <p className="text-xs text-slate-500 max-w-sm mt-1 mb-5">
                  Upload photos from your phone or laptop. They will be automatically shrunk without losing visual quality.
                </p>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/25 transition flex items-center gap-2"
                >
                  <CloudUpload className="w-4 h-4" /> Upload First Photo
                </button>
              </div>
            ) : (
              <div
                className={`grid gap-4 ${
                  gridCols === 'compact'
                    ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6'
                    : 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4'
                }`}
              >
                {displayedPhotos.map((photo) => (
                  <div
                    key={photo.id}
                    onClick={() => setLightboxPhoto(photo)}
                    className="group relative rounded-2xl bg-slate-900 border border-slate-800/90 hover:border-indigo-500/50 overflow-hidden cursor-pointer shadow-sm hover:shadow-xl transition flex flex-col"
                  >
                    <div className="relative aspect-[4/3] bg-slate-950 overflow-hidden">
                      <img
                        src={photo.thumb_url || photo.file_url}
                        alt={photo.original_name}
                        loading="lazy"
                        className="w-full h-full object-cover group-hover:scale-105 transition duration-500"
                      />

                      {/* Top Badges */}
                      <div className="absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between gap-1 pointer-events-none">
                        {photo.saved_percent > 0 ? (
                          <span className="px-2 py-0.5 rounded-full bg-emerald-950/85 backdrop-blur-md border border-emerald-500/40 text-[10px] font-semibold text-emerald-300 flex items-center gap-1">
                            <Zap className="w-2.5 h-2.5" /> -{photo.saved_percent}% size
                          </span>
                        ) : (
                          <span />
                        )}

                        {(inspectedUserId === 'all' || isInspectingOther) && photo.owner_display_name && (
                          <span className="px-2 py-0.5 rounded-full bg-violet-950/85 backdrop-blur-md border border-violet-500/40 text-[10px] font-medium text-violet-200 truncate max-w-[120px]">
                            {photo.owner_display_name}
                          </span>
                        )}
                      </div>

                      {/* Hover Overlay Actions */}
                      <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition flex items-end justify-between p-3">
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={(e) => handleToggleFavorite(photo, e)}
                            className={`p-1.5 rounded-lg backdrop-blur-md border transition ${
                              photo.is_favorite
                                ? 'bg-rose-500/30 border-rose-500/50 text-rose-300'
                                : 'bg-slate-900/80 border-slate-700 text-slate-300 hover:text-white'
                            }`}
                            title="Favorite"
                          >
                            <Heart className={`w-3.5 h-3.5 ${photo.is_favorite ? 'fill-rose-400' : ''}`} />
                          </button>

                          <a
                            href={photo.file_url}
                            download={photo.original_name}
                            onClick={(e) => e.stopPropagation()}
                            className="p-1.5 rounded-lg bg-slate-900/80 hover:bg-slate-800 border border-slate-700 text-slate-300 hover:text-white backdrop-blur-md transition"
                            title="Download Shrunk Photo"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </a>
                        </div>

                        <button
                          onClick={(e) => handleDeletePhoto(photo, e)}
                          className="p-1.5 rounded-lg bg-slate-900/80 hover:bg-rose-600 border border-slate-700 hover:border-rose-500 text-slate-300 hover:text-white backdrop-blur-md transition"
                          title="Delete Photo"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Card Footer Info */}
                    <div className="p-3 flex items-center justify-between gap-2 text-xs">
                      <div className="truncate">
                        <p className="font-medium text-slate-200 truncate" title={photo.original_name}>
                          {photo.original_name}
                        </p>
                        <p className="text-[11px] text-slate-400">
                          <span className="text-indigo-300 font-medium">{formatBytes(photo.compressed_size)}</span>
                          {photo.original_size > photo.compressed_size && (
                            <span className="line-through text-slate-600 ml-1.5">
                              {formatBytes(photo.original_size)}
                            </span>
                          )}
                        </p>
                      </div>
                      {photo.is_favorite && <Heart className="w-3.5 h-3.5 text-rose-400 fill-rose-400 shrink-0" />}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* ===============================================================
          MODAL 1: SMART SHRINK UPLOAD & VISUAL QUALITY PREVIEW
         =============================================================== */}
      {uploadModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-3xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
                  <Zap className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">
                    Smart Visually-Lossless Photo Shrinker
                  </h3>
                  <p className="text-xs text-slate-400">
                    Shrinking file size to maximum efficiency while keeping 100% crisp visual quality
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setPendingUploads([]);
                  setUploadModalOpen(false);
                }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4 flex-1">
              {/* Summary Bar */}
              {pendingUploads.some((i) => i.status === 'ready') && (
                <div className="p-4 rounded-2xl bg-emerald-950/30 border border-emerald-500/30 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-emerald-300">
                      Ready to save to {isInspectingOther ? `${activeSpaceUser?.display_name}'s` : 'your'} virtual space
                    </p>
                    <p className="text-[11px] text-slate-300 mt-0.5">
                      Original Total:{' '}
                      <span className="line-through text-slate-400">
                        {formatBytes(
                          pendingUploads.reduce((acc, i) => acc + (i.shrunk?.originalSize || i.originalSize || 0), 0)
                        )}
                      </span>{' '}
                      → Shrunk Size:{' '}
                      <strong className="text-emerald-300">
                        {formatBytes(
                          pendingUploads.reduce((acc, i) => acc + (i.shrunk?.compressedSize || 0), 0)
                        )}
                      </strong>
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <label className="text-xs text-slate-400">Album:</label>
                    <select
                      value={uploadTargetFolder}
                      onChange={(e) => setUploadTargetFolder(e.target.value)}
                      className="px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                    >
                      <option value="">No Album (Main Space)</option>
                      {folders.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {/* Side-by-Side Visual Quality Inspector if user clicked "Verify Quality" */}
              {compareItem && (
                <div className="p-4 rounded-2xl bg-slate-950 border border-indigo-500/40 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-indigo-300 flex items-center gap-1.5">
                      <Eye className="w-4 h-4" /> Visual Fidelity Comparison: {compareItem.originalFile.name}
                    </span>
                    <button
                      onClick={() => setCompareItem(null)}
                      className="text-xs text-slate-400 hover:text-white"
                    >
                      Close Preview
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <span className="text-[11px] text-slate-400">
                        Original Raw ({formatBytes(compareItem.originalSize)})
                      </span>
                      <img
                        src={compareItem.originalUrl}
                        alt="Original"
                        className="w-full h-48 object-contain bg-slate-900 rounded-xl border border-slate-800"
                      />
                    </div>
                    <div className="space-y-1">
                      <span className="text-[11px] text-emerald-400 font-medium">
                        Shrunk Visually-Lossless ({formatBytes(compareItem.compressedSize)} · -{compareItem.savedPercent}%)
                      </span>
                      <img
                        src={compareItem.shrunkUrl}
                        alt="Shrunk"
                        className="w-full h-48 object-contain bg-slate-900 rounded-xl border border-emerald-500/30"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Items List */}
              <div className="space-y-2.5">
                {pendingUploads.map((item) => (
                  <div
                    key={item.tempId}
                    className="p-3 rounded-2xl bg-slate-950/90 border border-slate-800 flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {item.shrunk ? (
                        <img
                          src={item.shrunk.thumbDataUrl}
                          alt={item.name}
                          className="w-12 h-12 rounded-xl object-cover shrink-0 border border-slate-800"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-xl bg-slate-900 flex items-center justify-center shrink-0">
                          <RefreshCw className="w-4 h-4 text-indigo-400 animate-spin" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-white truncate">{item.name}</p>
                        {item.status === 'shrinking' ? (
                          <p className="text-[11px] text-indigo-400">Optimizing lossless visual encoding...</p>
                        ) : (
                          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400 mt-0.5">
                            <span className="line-through">{formatBytes(item.shrunk.originalSize)}</span>
                            <span>→</span>
                            <span className="text-emerald-400 font-semibold">
                              {formatBytes(item.shrunk.compressedSize)}
                            </span>
                            <span className="px-1.5 py-0.2 rounded bg-emerald-500/15 text-emerald-300 text-[10px]">
                              -{item.shrunk.savedPercent}% saved
                            </span>
                            <span>
                              ({item.shrunk.width}×{item.shrunk.height})
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {item.shrunk && (
                        <button
                          type="button"
                          onClick={() => setCompareItem(item.shrunk)}
                          className="text-[11px] px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300"
                        >
                          Compare Quality
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          setPendingUploads((prev) => prev.filter((p) => p.tempId !== item.tempId))
                        }
                        className="p-1.5 text-slate-500 hover:text-rose-400"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-800 flex items-center justify-between bg-slate-950/60">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="text-xs font-medium text-indigo-400 hover:text-indigo-300 flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" /> Add More Photos
              </button>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setPendingUploads([]);
                    setUploadModalOpen(false);
                  }}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={uploading || pendingUploads.some((i) => i.status === 'shrinking')}
                  onClick={handleConfirmUpload}
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/30 disabled:opacity-50"
                >
                  {uploading
                    ? 'Saving to Virtual Space...'
                    : `Save ${pendingUploads.length} Shrunk Photo${pendingUploads.length > 1 ? 's' : ''}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===============================================================
          MODAL 2: LIGHTBOX FULL PHOTO INSPECTOR
         =============================================================== */}
      {lightboxPhoto && (
        <div
          onClick={() => setLightboxPhoto(null)}
          className="fixed inset-0 z-50 bg-slate-950/95 backdrop-blur-xl flex flex-col md:flex-row"
        >
          {/* Image Canvas */}
          <div className="flex-1 flex items-center justify-center p-4 md:p-8 relative min-h-0">
            <button
              onClick={() => setLightboxPhoto(null)}
              className="absolute top-4 left-4 p-2.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 border border-slate-700 text-slate-200"
            >
              <X className="w-5 h-5" />
            </button>

            <img
              src={lightboxPhoto.file_url}
              alt={lightboxPhoto.original_name}
              onClick={(e) => e.stopPropagation()}
              className="max-w-full max-h-[82vh] object-contain rounded-xl shadow-2xl"
            />
          </div>

          {/* Right Inspector Sidebar */}
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full md:w-80 bg-slate-900 border-t md:border-t-0 md:border-l border-slate-800 p-6 flex flex-col justify-between gap-6 overflow-y-auto"
          >
            <div className="space-y-5">
              <div>
                <h3 className="font-bold text-sm text-white break-words">{lightboxPhoto.original_name}</h3>
                <p className="text-xs text-slate-400 mt-1">
                  Uploaded {new Date(lightboxPhoto.created_at).toLocaleString()}
                </p>
              </div>

              {/* Smart Shrink Efficiency Breakdown */}
              <div className="p-4 rounded-2xl bg-emerald-950/25 border border-emerald-500/30 space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-emerald-300 flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5" /> Smart Shrink Result
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-bold">
                    -{lightboxPhoto.saved_percent}% Size
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 pt-1 text-xs">
                  <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800">
                    <span className="text-[10px] text-slate-400 block">Original Size</span>
                    <span className="font-semibold text-slate-300">
                      {formatBytes(lightboxPhoto.original_size)}
                    </span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-slate-950/80 border border-emerald-500/30">
                    <span className="text-[10px] text-emerald-400 block">Saved on Disk</span>
                    <span className="font-bold text-emerald-300">
                      {formatBytes(lightboxPhoto.compressed_size)}
                    </span>
                  </div>
                </div>
                <p className="text-[11px] text-slate-400">
                  Saved <strong className="text-emerald-300">{formatBytes(lightboxPhoto.saved_bytes)}</strong> on your
                  Linux laptop without visual quality loss.
                </p>
              </div>

              {/* Technical Specs */}
              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1.5 border-b border-slate-800">
                  <span className="text-slate-400">Dimensions</span>
                  <span className="text-slate-200 font-medium">
                    {lightboxPhoto.width || 3840} × {lightboxPhoto.height || 2160} px
                  </span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-800">
                  <span className="text-slate-400">Format</span>
                  <span className="text-slate-200 font-medium uppercase">
                    {lightboxPhoto.mime_type?.replace('image/', '') || 'WEBP'}
                  </span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-800">
                  <span className="text-slate-400">Virtual Space Owner</span>
                  <span className="text-indigo-300 font-medium">
                    {lightboxPhoto.owner_display_name || currentUser.display_name}
                  </span>
                </div>
              </div>

              {/* Move to Album */}
              {inspectedUserId !== 'all' && (
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">Album in Virtual Space</label>
                  <select
                    value={lightboxPhoto.folder_id || ''}
                    onChange={(e) => handleMovePhotoFolder(lightboxPhoto, e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                  >
                    <option value="">No Album (Main Space)</option>
                    {folders.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => handleToggleFavorite(lightboxPhoto)}
                  className={`py-2.5 px-3 rounded-xl border text-xs font-medium flex items-center justify-center gap-1.5 transition ${
                    lightboxPhoto.is_favorite
                      ? 'bg-rose-500/20 border-rose-500/40 text-rose-300'
                      : 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
                  }`}
                >
                  <Heart className={`w-4 h-4 ${lightboxPhoto.is_favorite ? 'fill-rose-400' : ''}`} />
                  {lightboxPhoto.is_favorite ? 'Favorited' : 'Favorite'}
                </button>

                <a
                  href={lightboxPhoto.file_url}
                  download={lightboxPhoto.original_name}
                  className="py-2.5 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition"
                >
                  <Download className="w-4 h-4" /> Download
                </a>
              </div>

              <button
                onClick={() => handleDeletePhoto(lightboxPhoto)}
                className="w-full py-2.5 px-3 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 text-xs font-medium flex items-center justify-center gap-1.5 transition"
              >
                <Trash2 className="w-4 h-4" /> Delete from Virtual Space
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===============================================================
          MODAL 3: CREATE ALBUM / FOLDER
         =============================================================== */}
      {newFolderModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateFolder}
            className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <FolderPlus className="w-4 h-4 text-indigo-400" /> Create New Album
              </h3>
              <button
                type="button"
                onClick={() => setNewFolderModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <input
              type="text"
              required
              autoFocus
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="e.g. Summer Vacation 2026"
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white focus:outline-none focus:border-indigo-500"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setNewFolderModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-xs text-slate-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white"
              >
                Create Album
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ===============================================================
          MODAL 4: ADMIN — REGISTER NEW USER & SET QUOTA
         =============================================================== */}
      {createUserModalOpen && currentUser.role === 'admin' && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleAdminCreateUser}
            className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-violet-500/20 border border-violet-500/30 flex items-center justify-center">
                  <UserPlus className="w-5 h-5 text-violet-300" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Register New User & Virtual Space</h3>
                  <p className="text-[11px] text-slate-400">
                    Creates an isolated directory on your Linux laptop with a custom storage quota
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCreateUserModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Username (Login ID)</label>
                <input
                  type="text"
                  required
                  value={newUserForm.username}
                  onChange={(e) => setNewUserForm({ ...newUserForm, username: e.target.value })}
                  placeholder="e.g. alex"
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Display Name</label>
                <input
                  type="text"
                  required
                  value={newUserForm.display_name}
                  onChange={(e) => setNewUserForm({ ...newUserForm, display_name: e.target.value })}
                  placeholder="e.g. Alex Morgan"
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Initial Password</label>
                <input
                  type="text"
                  required
                  value={newUserForm.password}
                  onChange={(e) => setNewUserForm({ ...newUserForm, password: e.target.value })}
                  placeholder="At least 4 characters"
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Role</label>
                <select
                  value={newUserForm.role}
                  onChange={(e) => setNewUserForm({ ...newUserForm, role: e.target.value })}
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                >
                  <option value="user">Standard User (Own Virtual Space Only)</option>
                  <option value="admin">Server Admin (Can View All Spaces)</option>
                </select>
              </div>
            </div>

            {/* Storage Quota Selector */}
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-200">
                  Virtual Space Storage Quota Limit
                </label>
                <span className="text-xs font-bold text-indigo-400">
                  {formatBytes(newUserForm.quota_mb * 1024 * 1024)}
                </span>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {QUOTA_PRESETS_MB.map((preset) => (
                  <button
                    type="button"
                    key={preset.value}
                    onClick={() => setNewUserForm({ ...newUserForm, quota_mb: preset.value })}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${
                      newUserForm.quota_mb === preset.value
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2 pt-1">
                <span className="text-[11px] text-slate-400">Custom Quota (MB):</span>
                <input
                  type="number"
                  min="50"
                  value={newUserForm.quota_mb}
                  onChange={(e) => setNewUserForm({ ...newUserForm, quota_mb: Number(e.target.value) })}
                  className="w-28 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-xs text-white"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setCreateUserModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-xs text-slate-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-xs font-semibold text-white shadow-lg shadow-violet-600/25"
              >
                Create User & Virtual Space
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ===============================================================
          MODAL 5: ADMIN — EDIT USER QUOTA / PASSWORD
         =============================================================== */}
      {editingUser && currentUser.role === 'admin' && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleAdminUpdateUser}
            className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-white">
                  Edit Quota & Settings: @{editingUser.username}
                </h3>
                <p className="text-[11px] text-slate-400">
                  Currently using {formatBytes(editingUser.used_bytes)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingUser(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Display Name</label>
              <input
                type="text"
                required
                value={editUserForm.display_name}
                onChange={(e) => setEditUserForm({ ...editUserForm, display_name: e.target.value })}
                className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Reset Password (leave blank to keep current)
              </label>
              <input
                type="text"
                value={editUserForm.password}
                onChange={(e) => setEditUserForm({ ...editUserForm, password: e.target.value })}
                placeholder="New password..."
                className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
              />
            </div>

            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-200">Storage Quota Limit</label>
                <span className="text-xs font-bold text-indigo-400">
                  {formatBytes(editUserForm.quota_mb * 1024 * 1024)}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {QUOTA_PRESETS_MB.map((preset) => (
                  <button
                    type="button"
                    key={preset.value}
                    onClick={() => setEditUserForm({ ...editUserForm, quota_mb: preset.value })}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${
                      editUserForm.quota_mb === preset.value
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 pt-1">
                <span className="text-[11px] text-slate-400">Quota (MB):</span>
                <input
                  type="number"
                  min="50"
                  value={editUserForm.quota_mb}
                  onChange={(e) => setEditUserForm({ ...editUserForm, quota_mb: Number(e.target.value) })}
                  className="w-28 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-xs text-white"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingUser(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-xs text-slate-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white"
              >
                Save Changes
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Server Config Modal */}
      {serverModalOpen && (
        <ServerConfigModal
          apiUrlInput={apiUrlInput}
          setApiUrlInput={setApiUrlInput}
          serverConnected={serverConnected}
          onSave={handleSaveServerUrl}
          onClose={() => setServerModalOpen(false)}
        />
      )}
    </div>
  );
}

// =====================================================================
// SERVER CONNECTION MODAL COMPONENT
// =====================================================================
function ServerConfigModal({ apiUrlInput, setApiUrlInput, serverConnected, onSave, onClose }) {
  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <form
        onSubmit={onSave}
        className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-4 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center">
              <Server className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Linux Laptop Server Connection</h3>
              <p className="text-[11px] text-slate-400">
                Connect your Vercel frontend to your Linux laptop&apos;s FastAPI backend
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 text-xs space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Current Status:</span>
            <span
              className={`font-semibold flex items-center gap-1.5 ${
                serverConnected ? 'text-emerald-400' : 'text-amber-400'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${serverConnected ? 'bg-emerald-400' : 'bg-amber-400'}`}
              />
              {serverConnected
                ? 'Connected to Linux FastAPI Server'
                : 'Using Browser Sandbox (Linux API not reached)'}
            </span>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1.5">
            Backend Server URL (FastAPI on your Linux laptop)
          </label>
          <input
            type="text"
            value={apiUrlInput}
            onChange={(e) => setApiUrlInput(e.target.value)}
            placeholder="Leave empty for local proxy, or https://your-laptop-tunnel.trycloudflare.com"
            className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-indigo-500"
          />
          <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
            • When running locally on your laptop, leave blank or use <code className="text-indigo-300">http://localhost:8000</code>.
            <br />• When deployed on <strong>Vercel</strong>, expose your Linux laptop port 8000 using{' '}
            <code className="text-indigo-300">cloudflared tunnel --url http://localhost:8000</code> or Tailscale Funnel and paste the HTTPS URL here (or set <code className="text-indigo-300">VITE_API_URL</code> in Vercel).
          </p>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 text-xs text-slate-300"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white"
          >
            Save & Test Connection
          </button>
        </div>
      </form>
    </div>
  );
}
