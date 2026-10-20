import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  UploadCloud,
  FileText,
  FolderPlus,
  X,
  CheckCircle2,
  AlertCircle,
  Lock,
} from "lucide-react";

import Header from "../../components/Header";
import Sidebar from "../../components/Sidebar";
import NewFolderRow from "../../components/NewFolderRow";
import { userPool } from "../../cognito";

/* ---------- configuration ---------- */

const API_URL = import.meta.env.VITE_UPLOAD_API_URL; // e.g. https://xyz.execute-api.../prod
const MAX_MB = 100;
const ALLOWED = [
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "csv", "txt", "png", "jpg", "jpeg",
];

/*
 * `value` is the storage folder (S3 prefix, no trailing slash) sent to the
 * presign endpoint as `folder`. Program areas live under programs/<slug>,
 * matching the Programs page.
 */
const FOLDER_GROUPS = [
  {
    label: "General",
    folders: [
      { value: "shared-files", label: "Shared files", note: "All authorised staff" },
      { value: "finance", label: "Finance", note: "Restricted access", restricted: true },
    ],
  },
  {
    label: "Programs: thematic areas",
    folders: [
      { value: "programs/education-justice", label: "Education Justice", note: "Programs" },
      { value: "programs/universal-periodic-review", label: "Universal Periodic Review", note: "Programs" },
      { value: "programs/institutional-growth", label: "Institutional Growth", note: "Programs" },
      { value: "programs/srhr-advocacy", label: "SRHR Advocacy", note: "Programs" },
      { value: "programs/economic-justice", label: "Economic Justice", note: "Programs" },
    ],
  },
];

const ALL_FOLDERS = FOLDER_GROUPS.flatMap((g) => g.folders);

const FONT_CSS = `
@import url("https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&display=swap");
.eachr-display { font-family: "Fraunces", Georgia, "Times New Roman", serif; font-feature-settings: "lnum" 1; }
.eachr-focus:focus-visible, .eachr-drop:focus-within { outline: 2px solid #C8963E; outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { .eachr-motion { transition: none !important; } }
`;

/* ---------- helpers ---------- */

class SessionError extends Error {
  constructor(message = "Your session has expired. Please sign in again.") {
    super(message);
    this.name = "SessionError";
  }
}

/** Resolves with the current Cognito session, refreshing it if needed. */
function getCognitoSession() {
  return new Promise((resolve, reject) => {
    const currentUser = userPool.getCurrentUser();

    if (!currentUser) {
      reject(new SessionError());
      return;
    }

    currentUser.getSession((error, session) => {
      if (error || !session || !session.isValid()) {
        reject(new SessionError());
        return;
      }

      resolve(session);
    });
  });
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function validate(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  if (!ALLOWED.includes(ext)) return `.${ext} files are not allowed`;
  if (file.size === 0) return "This file is empty";
  if (file.size > MAX_MB * 1024 ** 2) return `Larger than ${MAX_MB} MB`;
  return "";
}

async function getPresignedUrl(file, folder) {
  if (!API_URL) throw new Error("Upload service is not connected yet");

  const session = await getCognitoSession();
  const token = session.getIdToken().getJwtToken();

  const res = await fetch(`${API_URL}/presign`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type || "application/octet-stream",
      folder,
    }),
  });

  if (res.status === 401) throw new SessionError();
  if (res.status === 403) {
    throw new Error("You do not have permission to upload to this folder");
  }
  if (!res.ok) throw new Error("Could not start the upload");

  return res.json(); // expected: { url }
}

function putToStorage(url, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error("The upload was rejected by storage"));
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(file);
  });
}

/**
 * Works out the folder the Programs page asked for. A known folder is used
 * as is; a subfolder of a known folder is added as a selectable folder.
 */
function resolveRequestedFolder(prefix) {
  const requested = String(prefix || "").replace(/\/+$/, "");

  if (ALL_FOLDERS.some((f) => f.value === requested)) {
    return { value: requested, custom: null };
  }

  const root = ALL_FOLDERS.find((f) => requested.startsWith(`${f.value}/`));
  if (!root) return { value: "", custom: null };

  return {
    value: requested,
    custom: {
      value: requested,
      label: requested.split("/").pop(),
      note: `Inside ${root.label}`,
      parent: requested.slice(0, requested.lastIndexOf("/")),
      restricted: root.restricted,
    },
  };
}

/* ---------- page ---------- */

function FileUpload() {
  const navigate = useNavigate();
  const location = useLocation();

  // The Programs page passes { area, prefix } when opening this page from a
  // thematic area or one of its subfolders, e.g. "programs/education-justice/2027/".
  const [initial] = useState(() => resolveRequestedFolder(location.state?.prefix));
  const [folder, setFolder] = useState(initial.value);

  // Folders made on this page. They are not stored anywhere until the first
  // file is uploaded into them (storage only shows a folder once it has a file).
  const [customFolders, setCustomFolders] = useState(
    initial.custom ? [initial.custom] : []
  );
  const [creatingFolder, setCreatingFolder] = useState(false);

  const [email, setEmail] = useState("");
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let isMounted = true;

    getCognitoSession()
      .then((session) => {
        if (!isMounted) return;

        const payload = session.getIdToken().decodePayload();
        setEmail(String(payload?.email || "").trim().toLowerCase());
      })
      .catch(() => {
        if (isMounted) navigate("/", { replace: true });
      });

    return () => {
      isMounted = false;
    };
  }, [navigate]);

  const allFolders = [...ALL_FOLDERS, ...customFolders];
  const selectedFolder = allFolders.find((f) => f.value === folder);

  // Names already used inside the folder where a new one would be created
  const siblingNames = customFolders
    .filter((f) => f.parent === folder)
    .map((f) => f.label);

  const handleCreateFolder = async (prefix) => {
    const value = prefix.replace(/\/+$/, "");

    if (allFolders.some((f) => f.value.toLowerCase() === value.toLowerCase())) {
      throw new Error("A folder with this name already exists.");
    }

    setCustomFolders((prev) => [
      ...prev,
      {
        value,
        label: value.split("/").pop(),
        note: `Inside ${selectedFolder?.label}`,
        parent: folder,
        restricted: selectedFolder?.restricted,
      },
    ]);
    setFolder(value);
  };

  const patch = (id, changes) =>
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...changes } : i)));

  const handleLogout = () => {
    const currentUser = userPool.getCurrentUser();

    if (currentUser) currentUser.signOut();

    localStorage.removeItem("eachrights_auth");
    sessionStorage.removeItem("eachrights_auth");

    navigate("/", { replace: true });
  };

  const addFiles = (fileList) => {
    const incoming = Array.from(fileList).map((file) => {
      const error = validate(file);
      return {
        id: `${file.name}-${file.size}-${file.lastModified}`,
        file,
        status: error ? "invalid" : "queued",
        progress: 0,
        error,
      };
    });

    setItems((prev) => {
      const known = new Set(prev.map((i) => i.id));
      return [...prev, ...incoming.filter((i) => !known.has(i.id))];
    });
  };

  const removeItem = (id) => setItems((prev) => prev.filter((i) => i.id !== id));

  const clearUploaded = () =>
    setItems((prev) => prev.filter((i) => i.status !== "done"));

  const pending = items.filter((i) => i.status === "queued" || i.status === "error");
  const uploadedCount = items.filter((i) => i.status === "done").length;

  const uploadAll = async () => {
    setBusy(true);

    for (const item of pending) {
      patch(item.id, { status: "uploading", progress: 0, error: "" });

      try {
        const { url } = await getPresignedUrl(item.file, folder);
        await putToStorage(url, item.file, (p) => patch(item.id, { progress: p }));
        patch(item.id, { status: "done", progress: 100 });
      } catch (err) {
        if (err instanceof SessionError) {
          navigate("/", { replace: true });
          return;
        }

        patch(item.id, { status: "error", error: err.message });
      }
    }

    setBusy(false);
  };

  const renderFolderCard = (f) => (
    <label
      key={f.value}
      className={`eachr-motion flex cursor-pointer flex-col rounded-lg border p-4 transition focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[#C8963E] ${
        folder === f.value
          ? "border-[#0F3D2E] bg-[#E8F0EB]"
          : "border-[#DDE2DB] hover:bg-[#F5F6F2]"
      }`}
    >
      <input
        type="radio"
        name="folder"
        value={f.value}
        checked={folder === f.value}
        onChange={() => setFolder(f.value)}
        className="sr-only"
      />
      <span className="flex items-center gap-1.5 font-semibold">
        {f.restricted && <Lock size={14} className="text-[#7A5718]" />}
        {f.label}
      </span>
      <span className="mt-1 text-xs text-slate-500">{f.note}</span>
    </label>
  );

  return (
    <div className="min-h-screen bg-[#F5F6F2] text-[#16211C]">
      <style>{FONT_CSS}</style>

      <div className="flex min-h-screen">
        <Sidebar
          mobileOpen={mobileSidebarOpen}
          onClose={() => setMobileSidebarOpen(false)}
        />

        <div className="min-w-0 flex-1">
          <Header
            email={email}
            onMenuClick={() => setMobileSidebarOpen(true)}
            onLogout={handleLogout}
          />

          <main className="mx-auto max-w-[900px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            <h2 className="eachr-display text-3xl font-semibold tracking-tight">
              Upload files
            </h2>
            <p className="mt-2 text-sm text-slate-500">
              Files go to private storage. Up to {MAX_MB} MB each.
            </p>

            {/* STEP: FOLDER */}
            <section className="mt-6 rounded-2xl border border-[#DDE2DB] bg-white p-5 sm:p-6">
              <fieldset>
                <legend className="eachr-display text-xl font-semibold">
                  Choose a folder
                </legend>

                {FOLDER_GROUPS.map((group) => (
                  <div key={group.label} className="mt-5">
                    <p className="text-xs font-medium text-slate-400">
                      {group.label}
                    </p>

                    <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {group.folders.map(renderFolderCard)}
                    </div>
                  </div>
                ))}

                {(customFolders.length > 0 || creatingFolder) && (
                  <div className="mt-5">
                    <p className="text-xs font-medium text-slate-400">
                      New folders
                    </p>

                    {creatingFolder && (
                      <div className="mt-2">
                        <NewFolderRow
                          parentPrefix={`${folder}/`}
                          existingNames={siblingNames}
                          onCreate={handleCreateFolder}
                          onDone={() => setCreatingFolder(false)}
                        />
                      </div>
                    )}

                    {customFolders.length > 0 && (
                      <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {customFolders.map(renderFolderCard)}
                      </div>
                    )}
                  </div>
                )}

                <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-[#E8ECE6] pt-4">
                  <button
                    type="button"
                    onClick={() => setCreatingFolder(true)}
                    disabled={!folder || creatingFolder}
                    className="eachr-focus inline-flex items-center gap-2 rounded-lg border border-[#DDE2DB] bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-[#F5F6F2] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <FolderPlus size={16} />
                    New folder
                  </button>

                  <p className="text-xs text-slate-500">
                    {folder
                      ? `Creates a folder inside ${selectedFolder?.label}.`
                      : "Choose a folder first, then create a new one inside it."}
                  </p>
                </div>
              </fieldset>
            </section>

            {/* DROP ZONE */}
            <section className="mt-6 rounded-2xl border border-[#DDE2DB] bg-white p-5 sm:p-6">
              <h3 className="eachr-display text-xl font-semibold">Add files</h3>

              <label
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  addFiles(e.dataTransfer.files);
                }}
                className={`eachr-drop eachr-motion mt-4 flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition ${
                  dragging
                    ? "border-[#0F3D2E] bg-[#E8F0EB]"
                    : "border-[#DDE2DB] hover:bg-[#F5F6F2]"
                }`}
              >
                <input
                  type="file"
                  multiple
                  accept={ALLOWED.map((e) => `.${e}`).join(",")}
                  className="sr-only"
                  onChange={(e) => {
                    addFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
                <UploadCloud size={30} className="text-[#2F6B4F]" />
                <p className="mt-3 font-semibold">Drop files here or browse</p>
                <p className="mt-1 text-xs text-slate-500">
                  PDF, Word, Excel, PowerPoint, CSV, text and images
                </p>
              </label>

              {items.length > 0 && (
                <ul className="mt-5 divide-y divide-[#E8ECE6] border-t border-[#E8ECE6]">
                  {items.map((item) => (
                    <li key={item.id} className="flex items-center gap-3 py-3">
                      <FileText size={20} className="shrink-0 text-[#2F6B4F]" />

                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{item.file.name}</p>

                        {item.status === "uploading" ? (
                          <div
                            role="progressbar"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={item.progress}
                            aria-label={`Uploading ${item.file.name}`}
                            className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#E8ECE6]"
                          >
                            <div
                              className="h-full rounded-full bg-[#2F6B4F]"
                              style={{ width: `${item.progress}%` }}
                            />
                          </div>
                        ) : (
                          <p
                            className={`mt-0.5 text-xs ${
                              item.error ? "text-red-600" : "text-slate-500"
                            }`}
                          >
                            {item.error || formatSize(item.file.size)}
                          </p>
                        )}
                      </div>

                      {item.status === "done" && (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#2F6B4F]">
                          <CheckCircle2 size={15} /> Uploaded
                        </span>
                      )}
                      {(item.status === "error" || item.status === "invalid") && (
                        <AlertCircle size={17} className="shrink-0 text-red-600" aria-hidden="true" />
                      )}

                      <button
                        type="button"
                        onClick={() => removeItem(item.id)}
                        disabled={item.status === "uploading"}
                        aria-label={`Remove ${item.file.name}`}
                        className="eachr-focus rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"
                      >
                        <X size={16} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {uploadedCount > 0 && (
                <button
                  type="button"
                  onClick={clearUploaded}
                  disabled={busy}
                  className="eachr-focus mt-3 text-xs font-semibold text-[#2F6B4F] hover:underline disabled:opacity-40"
                >
                  Clear uploaded files
                </button>
              )}

              <div className="mt-6 flex flex-col-reverse items-stretch justify-between gap-3 sm:flex-row sm:items-center">
                <p className="text-xs text-slate-500" aria-live="polite">
                  {!folder
                    ? "Choose a folder to enable upload."
                    : pending.length === 0
                    ? "Add files to upload."
                    : `${pending.length} file${pending.length > 1 ? "s" : ""} will go to ${selectedFolder?.label}.`}
                </p>

                <button
                  type="button"
                  onClick={uploadAll}
                  disabled={!folder || pending.length === 0 || busy}
                  className="eachr-focus eachr-motion inline-flex items-center justify-center gap-2 rounded-lg bg-[#0F3D2E] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#0B2F23] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <UploadCloud size={17} />
                  {busy ? "Uploading..." : "Upload files"}
                </button>
              </div>
            </section>
          </main>
        </div>
      </div>
    </div>
  );
}

export default FileUpload;
