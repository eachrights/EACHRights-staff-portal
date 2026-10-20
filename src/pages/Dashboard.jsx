import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Folder, FolderPlus, FolderOpen, UploadCloud, Download, Eye, Pencil, Trash2, ChevronRight,
  Loader2, AlertCircle, CheckCircle2, RefreshCw, Lock, X, FolderInput,
} from "lucide-react";

import Header from "../components/Header";
import Sidebar from "../components/Sidebar";
import { userPool } from "../cognito";
import { accessFromPayload, canSeeDepartment, DEPARTMENTS } from "../access";
import MoveFile from "../components/MoveFile";

const ADMIN_EMAIL = "admin@eachrights.or.ke";

/*
 * Design tokens (shared with the admin dashboard)
 * emerald #0A6B52 | forest #07523F | gold #FF9F1C | canvas #F5F7F6 | line #E3E9E5 | ink #14201A
 *
 * Backend contract
 *   GET    /admin/files?prefix=            -> { files: [{ key, size, lastModified }] }
 *   GET    /admin/files/download?key=&disposition=inline|attachment -> { url }
 *   POST   /admin/files/upload-url         { prefix, filename, contentType, size } -> { url, key }
 *   POST   /admin/files/folder             { prefix } -> { prefix }
 *   POST   /admin/files/rename             { key, newName } -> { key }
 *   POST   /admin/files/rename-folder      { prefix, newName } -> { prefix }
 *   DELETE /admin/files?key=
 *   POST   /admin/files/delete-folder      { prefix } -> { deleted, count }
 * The files Lambda enforces department access; the buttons here only hide what would be refused.
 */
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api";
const FILES_PATH = "/admin/files";
const DOWNLOAD_PATH = "/admin/files/download";
const UPLOAD_URL_PATH = "/admin/files/upload-url";
const FOLDER_PATH = "/admin/files/folder";
const RENAME_PATH = "/admin/files/rename";
const RENAME_FOLDER_PATH = "/admin/files/rename-folder";
const DELETE_FOLDER_PATH = "/admin/files/delete-folder";

const MAX_FILE_BYTES = 200 * 1024 ** 2;
const FOLDER_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,59}$/;
const FOLDER_NAME_HINT = "Use letters, numbers, spaces, dots, dashes or underscores (up to 60 characters).";

const DEPT_COLORS = {
  finance: "#0EA47A", "education-justice": "#FF9F1C", "gender-justice": "#E5484D",
  "health-justice": "#F2589B", "environment-climate-change": "#7CB518", "economic-justice": "#3E7BFA",
  communication: "#8E4EC6", it: "#14B8C4", "executive-director": "#1B2A41", "business-human-rights": "#D9480F",
};
const DEFAULT_COLOR = "#0EA47A";

const FONT_CSS = `
@import url("https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&display=swap");
.eachr-display { font-family: "Fraunces", Georgia, serif; font-feature-settings: "lnum" 1; }
`;

const FOCUS = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FF9F1C]";

function rootPrefixFor(slug) {
  if (slug === "finance") return "finance/";
  if (["communication", "it", "executive-director"].includes(slug)) return `departments/${slug}/`;
  return `programs/${slug}/`;
}

// ---------------------------------------------------------
// Helpers
// ---------------------------------------------------------

class SessionError extends Error {
  constructor(message = "Your session has expired. Please sign in again.") {
    super(message);
    this.name = "SessionError";
  }
}

function getCognitoSession() {
  return new Promise((resolve, reject) => {
    const currentUser = userPool.getCurrentUser();
    if (!currentUser) return reject(new SessionError());
    currentUser.getSession((error, session) => {
      if (error || !session || !session.isValid()) return reject(new SessionError());
      resolve(session);
    });
  });
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const v = bytes / 1024 ** i;
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

const fileExtension = (name) => (name.includes(".") ? name.split(".").pop().toLowerCase() : "");

const BADGE_STYLES = {
  pdf: "bg-red-50 text-red-700 ring-red-100",
  doc: "bg-blue-50 text-blue-700 ring-blue-100",
  docx: "bg-blue-50 text-blue-700 ring-blue-100",
  xls: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  xlsx: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  csv: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  ppt: "bg-orange-50 text-orange-700 ring-orange-100",
  pptx: "bg-orange-50 text-orange-700 ring-orange-100",
  png: "bg-purple-50 text-purple-700 ring-purple-100",
  jpg: "bg-purple-50 text-purple-700 ring-purple-100",
  jpeg: "bg-purple-50 text-purple-700 ring-purple-100",
};

function FileBadge({ name }) {
  const ext = fileExtension(name);
  return (
    <span
      aria-hidden="true"
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[10px] font-semibold uppercase ring-1 ring-inset ${
        BADGE_STYLES[ext] || "bg-slate-100 text-slate-600 ring-slate-200"
      }`}
    >
      {ext ? ext.slice(0, 4) : "file"}
    </span>
  );
}

// Flat keys -> the folders and files at one level
function listLevel(files, prefix) {
  const folders = new Map();
  const items = [];

  files.forEach((file) => {
    if (!file.key.startsWith(prefix)) return;
    const rest = file.key.slice(prefix.length);
    if (!rest) return;

    const slash = rest.indexOf("/");
    if (slash === -1) {
      items.push({ ...file, name: rest });
      return;
    }

    const name = rest.slice(0, slash);
    const entry = folders.get(name) || { name, count: 0, bytes: 0 };
    // "folder/" alone is just the folder marker, not a file
    if (slash < rest.length - 1) {
      entry.count += 1;
      entry.bytes += file.size || 0;
    }
    folders.set(name, entry);
  });

  return {
    folders: [...folders.values()].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
    ),
    items: items.sort(
      (a, b) => (new Date(b.lastModified).getTime() || 0) - (new Date(a.lastModified).getTime() || 0)
    ),
  };
}

// PUT with progress (fetch cannot report upload progress)
function putToS3(url, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream"); // must match the signed type
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`The upload was rejected (status ${xhr.status}).`));
    xhr.onerror = () => reject(new Error("Network error during upload. Check the bucket's CORS settings."));
    xhr.send(file);
  });
}

function nameProblem(name, isFolder) {
  if (!name) return "Enter a name.";
  if (isFolder) return FOLDER_NAME_PATTERN.test(name) ? "" : FOLDER_NAME_HINT;
  if (name.length > 150 || /[\\/]/.test(name) || name.startsWith(".") || name.includes("..")) {
    return "Use 150 characters or fewer, with no slashes, and don't start with a dot.";
  }
  return "";
}

/** Inline rename: Enter or clicking away saves, Escape cancels. A file keeps its extension. */
function InlineRename({ name, isFolder, onSave, onCancel }) {
  const dot = isFolder ? -1 : name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot) : "";
  const base = ext ? name.slice(0, dot) : name;

  const inputRef = useRef(null);
  const busyRef = useRef(false);
  const [value, setValue] = useState(base);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const clean = () => value.trim().replace(/\s+/g, " ");

  const commit = async () => {
    if (busyRef.current) return;
    const trimmed = clean();
    const problem = nameProblem(trimmed, isFolder);

    if (problem) {
      setError(problem);
      inputRef.current?.focus();
      return;
    }
    if (trimmed === base) return onCancel();

    busyRef.current = true;
    setSaving(true);
    setError("");

    try {
      await onSave(`${trimmed}${ext}`);
    } catch (err) {
      if (err instanceof SessionError) return;
      busyRef.current = false;
      setSaving(false);
      setError(err?.message || "Unable to rename.");
      inputRef.current?.focus();
    }
  };

  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              if (!saving) onCancel();
            }
          }}
          onBlur={() => {
            if (busyRef.current) return;
            if (nameProblem(clean(), isFolder)) onCancel();
            else commit();
          }}
          disabled={saving}
          autoComplete="off"
          aria-label={isFolder ? "Folder name" : "File name"}
          aria-invalid={error ? "true" : "false"}
          className="min-w-0 flex-1 rounded border border-[#FF9F1C] bg-white px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF9F1C]/40"
        />
        {ext && <span className="shrink-0 text-sm text-slate-500">{ext}</span>}
        {saving && <Loader2 size={15} className="shrink-0 animate-spin text-slate-500" />}
      </div>
      {error && <p role="alert" className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}

function IconButton({ label, onClick, disabled, danger = false, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label.split(" ")[0]}
      className={`rounded-lg p-2 text-slate-500 transition disabled:opacity-50 motion-reduce:transition-none ${FOCUS} ${
        danger ? "hover:bg-red-50 hover:text-red-700" : "hover:bg-[#D9F0E5] hover:text-[#0A6B52]"
      }`}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------
// Page
// ---------------------------------------------------------

function Dashboard() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  const [email, setEmail] = useState("");
  const [access, setAccess] = useState({ isAdmin: false, departments: new Set() });
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const [activeSlug, setActiveSlug] = useState(null);
  const [path, setPath] = useState([]);

  const [files, setFiles] = useState([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [loadError, setLoadError] = useState("");

  const [downloadingKey, setDownloadingKey] = useState(null);
  const [working, setWorking] = useState(null);
  const [actionError, setActionError] = useState("");

  const [renaming, setRenaming] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const [moveTarget, setMoveTarget] = useState(null);

  const [uploads, setUploads] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);

  const [showFolderForm, setShowFolderForm] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [folderError, setFolderError] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);

  // Access check
  useEffect(() => {
    let isMounted = true;

    getCognitoSession()
      .then((session) => {
        if (!isMounted) return;
        const payload = session.getIdToken().decodePayload();
        const userEmail = String(payload?.email || "").trim().toLowerCase();
        const nextAccess = accessFromPayload(payload);

        // Administrators work from the admin area
        if (userEmail === ADMIN_EMAIL || nextAccess.isAdmin) {
          navigate("/admin", { replace: true });
          return;
        }
        setEmail(userEmail);
        setAccess(nextAccess);
        setCheckingAccess(false);
      })
      .catch(() => {
        if (isMounted) navigate("/", { replace: true });
      });

    return () => {
      isMounted = false;
    };
  }, [navigate]);

  const handleLogout = () => {
    const currentUser = userPool.getCurrentUser();
    if (currentUser) currentUser.signOut();
    localStorage.removeItem("eachrights_auth");
    sessionStorage.removeItem("eachrights_auth");
    navigate("/", { replace: true });
  };

  const myDepartments = useMemo(() => DEPARTMENTS.filter((d) => canSeeDepartment(access, d.slug)), [access]);

  useEffect(() => {
    if (!activeSlug && myDepartments.length > 0) setActiveSlug(myDepartments[0].slug);
  }, [activeSlug, myDepartments]);

  const activeDepartment = myDepartments.find((d) => d.slug === activeSlug);
  const rootPrefix = activeSlug ? rootPrefixFor(activeSlug) : "";
  const currentPrefix = rootPrefix + path.map((s) => `${s}/`).join("");

  // Staff write in their own department; the CEO group writes only in Executive Director
  const canWriteHere =
    Boolean(activeSlug) &&
    (access.departments.has(activeSlug) || (activeSlug === "executive-director" && access.departments.has("ceo")));

  const moveRoots = useMemo(
    () => (rootPrefix ? [{ prefix: rootPrefix, label: activeDepartment?.name || "Department" }] : []),
    [rootPrefix, activeDepartment]
  );

  const apiRequest = useCallback(
    async (apiPath, { method = "GET", body } = {}) => {
      let token;
      try {
        const session = await getCognitoSession();
        token = session.getIdToken().getJwtToken();
      } catch (err) {
        navigate("/", { replace: true });
        throw err;
      }

      const response = await fetch(`${API_BASE_URL}${apiPath}`, {
        method,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });

      let data = {};
      try {
        data = await response.json();
      } catch {
        data = {};
      }

      if (response.status === 401) {
        navigate("/", { replace: true });
        throw new SessionError();
      }
      if (!response.ok) {
        throw new Error(data?.message || data?.error || `Request failed with status ${response.status}`);
      }
      return data;
    },
    [navigate]
  );

  const loadFiles = useCallback(async () => {
    if (!rootPrefix) return;
    setLoadingFiles(true);
    setLoadError("");

    try {
      const data = await apiRequest(`${FILES_PATH}?prefix=${encodeURIComponent(rootPrefix)}`);
      const list = Array.isArray(data) ? data : data.files || [];
      setFiles(list.filter((f) => f.key));
    } catch (err) {
      if (err instanceof SessionError) return;
      console.error("Failed to load files:", err);
      setFiles([]);
      setLoadError(err.message || "Unable to load files.");
    } finally {
      setLoadingFiles(false);
    }
  }, [apiRequest, rootPrefix]);

  useEffect(() => {
    if (!checkingAccess) loadFiles();
  }, [checkingAccess, loadFiles]);

  const { folders, items } = useMemo(() => listLevel(files, currentPrefix), [files, currentPrefix]);

  const chooseDepartment = (slug) => {
    if (slug === activeSlug) return;
    setActiveSlug(slug);
    setPath([]);
    setFiles([]);
    setActionError("");
    setShowFolderForm(false);
    setRenaming(null);
    setMoveTarget(null);
  };

  // View opens the file in a new tab; Download saves it
  const handleFileAction = async (file, action) => {
    setActionError("");
    setWorking({ key: file.key, action });
    if (action === "download") setDownloadingKey(file.key);

    // Open the tab now (while the click is fresh) so browsers don't block it
    const viewWindow = action === "view" ? window.open("about:blank", "_blank") : null;

    try {
      const disposition = action === "view" ? "inline" : "attachment";
      const data = await apiRequest(`${DOWNLOAD_PATH}?key=${encodeURIComponent(file.key)}&disposition=${disposition}`);
      if (!data?.url) throw new Error("No link was returned for this file.");

      if (viewWindow) {
        viewWindow.opener = null;
        viewWindow.location.href = data.url;
      } else {
        const link = document.createElement("a");
        link.href = data.url;
        link.download = file.name;
        document.body.appendChild(link);
        link.click();
        link.remove();
      }
    } catch (err) {
      viewWindow?.close();
      if (err instanceof SessionError) return;
      console.error(`${action} failed:`, err);
      setActionError(err.message || (action === "view" ? "Unable to open this file." : "Unable to download this file."));
    } finally {
      setWorking(null);
      setDownloadingKey(null);
    }
  };

  // Rename and delete
  const renameFile = async (file, newName) => {
    await apiRequest(RENAME_PATH, { method: "POST", body: { key: file.key, newName } });
    setRenaming(null);
    await loadFiles();
  };

  const renameFolder = async (folder, newName) => {
    await apiRequest(RENAME_FOLDER_PATH, { method: "POST", body: { prefix: `${currentPrefix}${folder.name}/`, newName } });
    setRenaming(null);
    await loadFiles();
  };

  const askDeleteFile = (file) => {
    setDeleteError("");
    setDeleteTarget({ kind: "file", key: file.key, name: file.name });
  };

  const askDeleteFolder = (folder) => {
    const prefix = `${currentPrefix}${folder.name}/`;
    const count = files.filter((f) => f.key.startsWith(prefix) && !f.key.endsWith("/")).length;
    setDeleteError("");
    setDeleteTarget({ kind: "folder", prefix, name: folder.name, count });
  };

  const closeDeleteDialog = () => {
    if (deleting) return;
    setDeleteTarget(null);
    setDeleteError("");
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError("");

    try {
      if (deleteTarget.kind === "file") {
        await apiRequest(`${FILES_PATH}?key=${encodeURIComponent(deleteTarget.key)}`, { method: "DELETE" });
      } else {
        await apiRequest(DELETE_FOLDER_PATH, { method: "POST", body: { prefix: deleteTarget.prefix } });
      }
      setDeleteTarget(null);
      await loadFiles();
    } catch (err) {
      if (err instanceof SessionError) return;
      console.error("Delete failed:", err);
      setDeleteError(err.message || "Unable to delete this.");
    } finally {
      setDeleting(false);
    }
  };

  useEffect(() => {
    if (!deleteTarget) return undefined;
    const onKeyDown = (e) => {
      if (e.key === "Escape" && !deleting) {
        setDeleteTarget(null);
        setDeleteError("");
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [deleteTarget, deleting]);

  // Upload
  const updateUpload = (id, changes) =>
    setUploads((current) => current.map((u) => (u.id === id ? { ...u, ...changes } : u)));

  const startUpload = async (fileList) => {
    const chosen = Array.from(fileList || []);
    if (chosen.length === 0 || uploading || !activeSlug || !canWriteHere) return;

    setActionError("");
    setUploading(true);

    const stamp = Date.now();
    const queue = chosen.map((file, i) => ({ id: `${stamp}-${i}`, file }));

    setUploads(
      queue.map(({ id, file }) => ({ id, name: file.name, size: file.size, progress: 0, status: "uploading", error: "" }))
    );

    for (const { id, file } of queue) {
      if (file.size === 0) {
        updateUpload(id, { status: "error", error: "This file is empty." });
        continue;
      }
      if (file.size > MAX_FILE_BYTES) {
        updateUpload(id, { status: "error", error: `Files must be smaller than ${formatBytes(MAX_FILE_BYTES)}.` });
        continue;
      }

      try {
        const contentType = file.type || "application/octet-stream";
        const data = await apiRequest(UPLOAD_URL_PATH, {
          method: "POST",
          body: { prefix: currentPrefix, filename: file.name, contentType, size: file.size },
        });
        if (!data?.url || !data?.key) throw new Error("No upload link was returned.");

        await putToS3(data.url, file, (progress) => updateUpload(id, { progress }));

        // The API picks the final name, so show the one that was stored
        updateUpload(id, { status: "done", progress: 100, name: data.key.split("/").pop() });
      } catch (err) {
        if (err instanceof SessionError) {
          setUploading(false);
          return;
        }
        console.error("Upload failed:", err);
        updateUpload(id, { status: "error", error: err.message || "Upload failed." });
      }
    }

    setUploading(false);
    loadFiles();
  };

  const handleFileInput = (e) => {
    startUpload(e.target.files);
    e.target.value = ""; // allows choosing the same file again
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    if (canWriteHere) startUpload(e.dataTransfer.files);
  };

  // New folder
  const handleCreateFolder = async (e) => {
    e.preventDefault();
    const name = folderName.trim();

    if (!FOLDER_NAME_PATTERN.test(name)) return setFolderError(FOLDER_NAME_HINT);
    if (folders.some((f) => f.name.toLowerCase() === name.toLowerCase())) {
      return setFolderError("A folder with that name already exists here.");
    }

    setFolderError("");
    setCreatingFolder(true);

    try {
      await apiRequest(FOLDER_PATH, { method: "POST", body: { prefix: `${currentPrefix}${name}/` } });
      setFolderName("");
      setShowFolderForm(false);
      await loadFiles();
    } catch (err) {
      if (err instanceof SessionError) return;
      console.error("Create folder failed:", err);
      setFolderError(err.message || "Unable to create the folder.");
    } finally {
      setCreatingFolder(false);
    }
  };

  // ---------------------------------------------------------
  // Render
  // ---------------------------------------------------------

  if (checkingAccess) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F5F7F6]">
        <div className="text-center">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-[#E3E9E5] border-t-[#0A6B52]" />
          <p className="mt-4 text-sm font-medium text-slate-600">Checking access...</p>
        </div>
      </div>
    );
  }

  const finishedUploads = uploads.filter((u) => u.status !== "uploading");
  const isEmpty = !loadingFiles && folders.length === 0 && items.length === 0;
  const accent = DEPT_COLORS[activeSlug] || DEFAULT_COLOR;
  const levelBytes = items.reduce((s, f) => s + (f.size || 0), 0);

  return (
    <div className="min-h-screen bg-[#F5F7F6] text-[#14201A]">
      <style>{FONT_CSS}</style>

      <div className="flex min-h-screen">
        <Sidebar mobileOpen={mobileSidebarOpen} onClose={() => setMobileSidebarOpen(false)} />

        <div className="flex min-w-0 flex-1 flex-col">
          <Header email={email} onMenuClick={() => setMobileSidebarOpen(true)} onLogout={handleLogout} />

          <main className="mx-auto w-full max-w-[1100px] flex-1 px-4 py-8 sm:px-6 lg:px-8">
            <h1 className="eachr-display text-3xl font-semibold tracking-tight text-[#07523F]">My files</h1>
            <p className="mt-1 text-sm text-slate-500">Browse, download and upload documents in your department folders.</p>

            {myDepartments.length === 0 ? (
              <p className="mt-8 rounded-2xl border border-[#E3E9E5] bg-white p-5 text-sm text-slate-600">
                You haven't been added to a department yet. Ask an administrator for access.
              </p>
            ) : (
              <>
                {/* Department picker */}
                <div role="group" aria-label="Department" className="mt-6 flex flex-wrap gap-2">
                  {myDepartments.map((dept) => {
                    const color = DEPT_COLORS[dept.slug] || DEFAULT_COLOR;
                    const active = dept.slug === activeSlug;
                    return (
                      <button
                        key={dept.slug}
                        type="button"
                        onClick={() => chooseDepartment(dept.slug)}
                        aria-pressed={active}
                        className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-semibold transition motion-reduce:transition-none ${FOCUS} ${
                          active ? "border-transparent text-white" : "border-[#E3E9E5] bg-white text-slate-700 hover:border-[#0A6B52]/40"
                        }`}
                        style={active ? { backgroundColor: color } : undefined}
                      >
                        <Folder
                          size={15}
                          aria-hidden="true"
                          style={active ? { color: "#fff", fill: "rgba(255,255,255,0.35)" } : { color, fill: `${color}55` }}
                        />
                        {dept.name}
                      </button>
                    );
                  })}
                </div>

                <section
                  aria-label="Files"
                  onDragOver={(e) => {
                    if (!canWriteHere) return;
                    e.preventDefault();
                    if (!dragging) setDragging(true);
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false);
                  }}
                  onDrop={handleDrop}
                  className={`mt-5 space-y-5 rounded-2xl transition motion-reduce:transition-none ${
                    dragging ? "ring-4 ring-[#FF9F1C]/30" : ""
                  }`}
                >
                  {/* Toolbar */}
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#E3E9E5] bg-white px-5 py-3.5">
                    <nav aria-label="Folder path" className="min-w-0">
                      <ol className="flex flex-wrap items-center gap-1 text-sm">
                        <li>
                          <button
                            type="button"
                            onClick={() => setPath([])}
                            disabled={path.length === 0}
                            className={`rounded px-1 font-semibold text-[#0A6B52] hover:underline disabled:no-underline ${FOCUS}`}
                          >
                            {activeDepartment?.name}
                          </button>
                        </li>
                        {path.map((segment, i) => (
                          <li key={`${segment}-${i}`} className="flex items-center gap-1">
                            <ChevronRight size={14} className="text-slate-400" aria-hidden="true" />
                            <button
                              type="button"
                              onClick={() => setPath(path.slice(0, i + 1))}
                              disabled={i === path.length - 1}
                              className={`rounded px-1 font-semibold text-[#0A6B52] hover:underline disabled:no-underline ${FOCUS}`}
                            >
                              {segment}
                            </button>
                          </li>
                        ))}
                      </ol>
                    </nav>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={loadFiles}
                        disabled={loadingFiles}
                        aria-label="Refresh files"
                        title="Refresh files"
                        className={`rounded-lg border border-[#E3E9E5] bg-white p-2 text-slate-600 transition hover:bg-[#E3F4EB] disabled:opacity-50 ${FOCUS}`}
                      >
                        <RefreshCw size={16} className={loadingFiles ? "animate-spin" : ""} />
                      </button>

                      {canWriteHere ? (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setShowFolderForm((open) => !open);
                              setFolderError("");
                            }}
                            aria-expanded={showFolderForm}
                            className={`inline-flex items-center gap-2 rounded-lg border border-[#E3E9E5] bg-white px-3 py-2 text-sm font-semibold text-[#0A6B52] transition hover:bg-[#E3F4EB] ${FOCUS}`}
                          >
                            <FolderPlus size={16} />
                            New folder
                          </button>

                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={uploading}
                            className={`inline-flex items-center gap-2 rounded-lg bg-[#0A6B52] px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-[#07523F] disabled:opacity-60 ${FOCUS}`}
                          >
                            {uploading ? <Loader2 size={16} className="animate-spin" /> : <UploadCloud size={16} />}
                            Upload files
                          </button>

                          <input ref={fileInputRef} type="file" multiple onChange={handleFileInput} className="hidden" aria-label="Choose files to upload" />
                        </>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F7EBD3] px-3 py-1.5 text-xs font-semibold text-[#7A5718]">
                          <Lock size={13} aria-hidden="true" />
                          View only
                        </span>
                      )}
                    </div>
                  </div>

                  {/* New folder form */}
                  {canWriteHere && showFolderForm && (
                    <form onSubmit={handleCreateFolder} className="rounded-2xl border border-[#E3E9E5] bg-white px-5 py-4">
                      <label htmlFor="folder-name" className="block text-xs font-semibold text-slate-700">Folder name</label>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <input
                          id="folder-name"
                          type="text"
                          value={folderName}
                          onChange={(e) => setFolderName(e.target.value)}
                          disabled={creatingFolder}
                          autoFocus
                          autoComplete="off"
                          className="w-64 max-w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#0A6B52] focus:ring-2 focus:ring-[#FF9F1C]/30"
                        />
                        <button
                          type="submit"
                          disabled={creatingFolder}
                          className={`inline-flex items-center gap-2 rounded-lg bg-[#0A6B52] px-3.5 py-2 text-sm font-semibold text-white hover:bg-[#07523F] disabled:opacity-60 ${FOCUS}`}
                        >
                          {creatingFolder && <Loader2 size={15} className="animate-spin" />}
                          Create folder
                        </button>
                        <button type="button" onClick={() => setShowFolderForm(false)} className={`rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 ${FOCUS}`}>
                          Cancel
                        </button>
                      </div>
                      {folderError && <p role="alert" className="mt-2 text-xs text-red-700">{folderError}</p>}
                    </form>
                  )}

                  {(loadError || actionError) && (
                    <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                      <AlertCircle size={18} className="mt-0.5 shrink-0" />
                      <p className="min-w-0 flex-1">{loadError || actionError}</p>
                      <button
                        type="button"
                        onClick={() => (loadError ? loadFiles() : setActionError(""))}
                        className={`rounded border border-red-200 bg-white px-2.5 py-1 text-xs font-semibold hover:bg-red-100 ${FOCUS}`}
                      >
                        {loadError ? "Try again" : "Dismiss"}
                      </button>
                    </div>
                  )}

                  {/* Upload progress */}
                  {uploads.length > 0 && (
                    <div role="status" aria-live="polite" className="rounded-2xl border border-[#E3E9E5] bg-white px-5 py-3.5">
                      <ul className="space-y-2">
                        {uploads.map((u) => (
                          <li key={u.id} className="text-sm">
                            <div className="flex items-center gap-2">
                              {u.status === "done" && <CheckCircle2 size={16} className="shrink-0 text-[#0E8A45]" />}
                              {u.status === "error" && <AlertCircle size={16} className="shrink-0 text-red-600" />}
                              {u.status === "uploading" && <Loader2 size={16} className="shrink-0 animate-spin text-[#0A6B52]" />}
                              <span className="min-w-0 flex-1 truncate font-medium">{u.name}</span>
                              <span className="text-xs tabular-nums text-slate-500">
                                {u.status === "error" ? "Failed" : u.status === "done" ? "Uploaded" : `${u.progress}%`}
                              </span>
                            </div>

                            {u.status === "uploading" && (
                              <div
                                role="progressbar"
                                aria-label={`Uploading ${u.name}`}
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-valuenow={u.progress}
                                className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#E9EEEB]"
                              >
                                <div className="h-full rounded-full bg-[#FF9F1C] transition-all motion-reduce:transition-none" style={{ width: `${u.progress}%` }} />
                              </div>
                            )}

                            {u.status === "error" && <p className="mt-0.5 pl-6 text-xs text-red-700">{u.error}</p>}
                          </li>
                        ))}
                      </ul>

                      {finishedUploads.length > 0 && !uploading && (
                        <button type="button" onClick={() => setUploads([])} className={`mt-2 inline-flex items-center gap-1 rounded text-xs font-semibold text-[#0A6B52] hover:underline ${FOCUS}`}>
                          <X size={12} />
                          Clear list
                        </button>
                      )}
                    </div>
                  )}

                  {isEmpty ? (
                    <div className="flex flex-col items-center rounded-2xl border border-dashed border-[#CBD7CF] bg-white px-5 py-16 text-center">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#D9F0E5] text-[#0A6B52]">
                        <FolderOpen size={22} />
                      </div>
                      <h3 className="mt-4 text-sm font-semibold">This folder is empty</h3>
                      <p className="mt-1 max-w-sm text-sm leading-6 text-slate-500">
                        {canWriteHere
                          ? "Upload files or drag them here, or create a folder to organise them."
                          : "Nothing has been added here yet."}
                      </p>
                    </div>
                  ) : (
                    <>
                      {/* Folders */}
                      {folders.length > 0 && (
                        <div>
                          <h2 className="eachr-display mb-3 text-lg font-semibold text-[#07523F]">Folders</h2>
                          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            {folders.map((folder) => {
                              const isRenaming = renaming?.kind === "folder" && renaming.id === folder.name;
                              return (
                                <li key={folder.name} className="flex items-center gap-1 rounded-xl border border-[#E3E9E5] bg-white py-2 pl-3.5 pr-1.5 transition hover:border-[#0A6B52]/40 motion-reduce:transition-none">
                                  {isRenaming ? (
                                    <div className="min-w-0 flex-1 py-1">
                                      <InlineRename name={folder.name} isFolder onCancel={() => setRenaming(null)} onSave={(n) => renameFolder(folder, n)} />
                                    </div>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => setPath([...path, folder.name])}
                                      className={`flex min-w-0 flex-1 items-center gap-3 rounded py-1 text-left ${FOCUS}`}
                                    >
                                      <Folder size={22} className="shrink-0" style={{ color: accent }} fill="currentColor" fillOpacity={0.25} />
                                      <span className="min-w-0">
                                        <span className="block truncate text-sm font-semibold">{folder.name}</span>
                                        <span className="block text-xs tabular-nums text-slate-500">
                                          {folder.count} {folder.count === 1 ? "file" : "files"}, {formatBytes(folder.bytes)}
                                        </span>
                                      </span>
                                    </button>
                                  )}

                                  {canWriteHere && !isRenaming && (
                                    <div className="flex shrink-0">
                                      <IconButton label={`Rename folder ${folder.name}`} onClick={() => setRenaming({ kind: "folder", id: folder.name })}>
                                        <Pencil size={16} />
                                      </IconButton>
                                      <IconButton label={`Delete folder ${folder.name}`} danger onClick={() => askDeleteFolder(folder)}>
                                        <Trash2 size={16} />
                                      </IconButton>
                                    </div>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      )}

                      {/* Files */}
                      <div>
                        <h2 className="eachr-display mb-3 text-lg font-semibold text-[#07523F]">Files</h2>
                        <div className="overflow-hidden rounded-2xl border border-[#E3E9E5] bg-white">
                          <div className="overflow-x-auto" aria-busy={loadingFiles}>
                            <table className="w-full min-w-[560px]">
                              <thead className="bg-[#F5F8F6]">
                                <tr className="border-b border-[#E3E9E5] text-left text-xs font-semibold text-slate-500">
                                  <th scope="col" className="px-5 py-3">Name</th>
                                  <th scope="col" className="px-5 py-3">Last modified</th>
                                  <th scope="col" className="px-5 py-3">Size</th>
                                  <th scope="col" className="px-5 py-3"><span className="sr-only">Actions</span></th>
                                </tr>
                              </thead>

                              <tbody className="divide-y divide-[#EEF1EC]">
                                {loadingFiles && files.length === 0 ? (
                                  Array.from({ length: 4 }).map((_, i) => (
                                    <tr key={i}>
                                      <td colSpan={4} className="px-5 py-3">
                                        <div className="h-4 w-1/2 animate-pulse rounded bg-[#E8ECE6] motion-reduce:animate-none" />
                                      </td>
                                    </tr>
                                  ))
                                ) : items.length === 0 ? (
                                  <tr>
                                    <td colSpan={4} className="px-5 py-8 text-center text-sm text-slate-500">
                                      No files at this level. Open a folder above to see more.
                                    </td>
                                  </tr>
                                ) : (
                                  items.map((file) => {
                                    const busy = working?.key === file.key;
                                    return (
                                      <tr key={file.key} className="hover:bg-[#F4FAF6]">
                                        <td className="max-w-0 px-5 py-2.5">
                                          {renaming?.kind === "file" && renaming.id === file.key ? (
                                            <InlineRename name={file.name} onCancel={() => setRenaming(null)} onSave={(n) => renameFile(file, n)} />
                                          ) : (
                                            <div className="flex min-w-0 items-center gap-3">
                                              <FileBadge name={file.name} />
                                              <span className="truncate text-sm font-medium" title={file.name}>{file.name}</span>
                                            </div>
                                          )}
                                        </td>

                                        <td className="whitespace-nowrap px-5 py-2.5 text-sm tabular-nums text-slate-500">{formatDate(file.lastModified)}</td>
                                        <td className="whitespace-nowrap px-5 py-2.5 text-sm tabular-nums text-slate-500">{formatBytes(file.size)}</td>

                                        <td className="px-5 py-2.5">
                                          <div className="flex items-center justify-end gap-0.5">
                                            <IconButton label={`View ${file.name}`} disabled={busy} onClick={() => handleFileAction(file, "view")}>
                                              {busy && working?.action === "view" ? <Loader2 size={17} className="animate-spin" /> : <Eye size={17} />}
                                            </IconButton>
                                            <IconButton label={`Download ${file.name}`} disabled={busy} onClick={() => handleFileAction(file, "download")}>
                                              {downloadingKey === file.key ? <Loader2 size={17} className="animate-spin" /> : <Download size={17} />}
                                            </IconButton>

                                            {canWriteHere && (
                                              <>
                                                <IconButton label={`Move ${file.name}`} disabled={busy} onClick={() => setMoveTarget(file)}>
                                                  <FolderInput size={17} />
                                                </IconButton>
                                                <IconButton label={`Rename ${file.name}`} disabled={busy} onClick={() => setRenaming({ kind: "file", id: file.key })}>
                                                  <Pencil size={17} />
                                                </IconButton>
                                                <IconButton label={`Delete ${file.name}`} danger disabled={busy} onClick={() => askDeleteFile(file)}>
                                                  <Trash2 size={17} />
                                                </IconButton>
                                              </>
                                            )}
                                          </div>
                                        </td>
                                      </tr>
                                    );
                                  })
                                )}
                              </tbody>
                            </table>
                          </div>

                          {!loadingFiles && items.length > 0 && (
                            <p className="border-t border-[#E3E9E5] bg-[#F5F8F6] px-5 py-3 text-xs tabular-nums text-slate-500">
                              {items.length} {items.length === 1 ? "file" : "files"}, {formatBytes(levelBytes)}
                            </p>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </section>
              </>
            )}

            <MoveFile
              file={moveTarget}
              files={files}
              roots={moveRoots}
              onClose={() => setMoveTarget(null)}
              onMoved={() => {
                setMoveTarget(null);
                loadFiles();
              }}
            />

            {deleteTarget && (
              <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
                <div className="absolute inset-0 bg-[#14201A]/50" onClick={closeDeleteDialog} aria-hidden="true" />

                <div
                  role="alertdialog"
                  aria-modal="true"
                  aria-labelledby="delete-title"
                  aria-describedby="delete-desc"
                  className="relative w-full max-w-md rounded-2xl border border-[#E3E9E5] bg-white p-6 shadow-xl"
                >
                  <div className="flex items-start gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-700">
                      <Trash2 size={20} />
                    </span>

                    <div className="min-w-0">
                      <h2 id="delete-title" className="text-lg font-semibold">
                        {deleteTarget.kind === "folder" ? "Delete this folder?" : "Delete this file?"}
                      </h2>
                      <p id="delete-desc" className="mt-1.5 text-sm leading-6 text-slate-600">
                        <span className="break-all font-semibold text-[#14201A]">{deleteTarget.name}</span>{" "}
                        {deleteTarget.kind === "folder"
                          ? `and ${deleteTarget.count} ${deleteTarget.count === 1 ? "file" : "files"} inside it will be permanently deleted.`
                          : "will be permanently deleted."}{" "}
                        This can't be undone.
                      </p>
                    </div>
                  </div>

                  {deleteError && (
                    <div role="alert" className="mt-4 flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                      <AlertCircle size={17} className="mt-0.5 shrink-0" />
                      <p className="min-w-0 flex-1">{deleteError}</p>
                    </div>
                  )}

                  <div className="mt-6 flex justify-end gap-2.5">
                    <button
                      type="button"
                      onClick={closeDeleteDialog}
                      disabled={deleting}
                      autoFocus
                      className={`rounded-lg border border-[#E3E9E5] bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-[#F5F8F6] disabled:opacity-50 ${FOCUS}`}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={confirmDelete}
                      disabled={deleting}
                      className={`inline-flex items-center gap-2 rounded-lg bg-red-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-60 ${FOCUS}`}
                    >
                      {deleting && <Loader2 size={16} className="animate-spin" />}
                      {deleting ? "Deleting..." : deleteTarget.kind === "folder" ? "Delete folder" : "Delete file"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </main>

          <footer className="border-t border-[#E3E9E5] bg-white px-5 py-5 text-center sm:px-8">
            <p className="text-xs text-slate-500">EACHRights Staff Portal • Secure Internal Platform</p>
          </footer>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
