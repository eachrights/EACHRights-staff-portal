import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  UploadCloud,
  FolderPlus,
  X,
  Loader2,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";

import Header from "../../components/Header";
import Sidebar from "../../components/Sidebar";
import NewFolderDialog from "../../components/NewFolderDialog";
import { userPool } from "../../cognito";

/* ---------------------------------------------------------
 * Backend contract
 *
 * POST {API}/admin/files/upload-url
 *      body: { prefix, filename, contentType, size }
 *      -> { url, key }   (pre-signed PUT; the browser uploads straight to S3)
 * POST {API}/admin/files/folder
 *      body: { prefix } -> { prefix }
 *
 * The bucket needs a CORS rule that allows PUT from this site's origin.
 * Access is enforced by the API; this page only needs a valid session.
 *
 * The Programs page opens this page with { area, prefix } in the router
 * state, so the folder you were looking at is already selected.
 * ------------------------------------------------------- */
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api";
const UPLOAD_URL_PATH = "/admin/files/upload-url";
const FOLDER_PATH = "/admin/files/folder";
const MAX_BYTES = 200 * 1024 * 1024; // 200 MB per file

// Programmes live under programs/<slug>/, departments under departments/<slug>/
const BASE_DESTINATIONS = [
  { label: "Communication", prefix: "departments/communication/", group: "Departments" },
  { label: "IT", prefix: "departments/it/", group: "Departments" },
  { label: "Executive Director", prefix: "departments/executive-director/", group: "Departments" },
  { label: "Education Justice", prefix: "programs/education-justice/", group: "Programmes" },
  { label: "Gender Justice", prefix: "programs/gender-justice/", group: "Programmes" },
  { label: "Health Justice", prefix: "programs/health-justice/", group: "Programmes" },
  {
    label: "Environment & Climate Change",
    prefix: "programs/environment-climate-change/",
    group: "Programmes",
  },
  { label: "Economic Justice", prefix: "programs/economic-justice/", group: "Programmes" },
  {
    label: "Business & Human Rights",
    prefix: "programs/business-human-rights/",
    group: "Programmes",
  },
  { label: "Finance", prefix: "finance/", group: "Organisation" },
];

const FONT_CSS = `
@import url("https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&display=swap");
.eachr-display { font-family: "Fraunces", Georgia, "Times New Roman", serif; font-feature-settings: "lnum" 1; }
.eachr-num { font-variant-numeric: tabular-nums; }
.eachr-focus:focus-visible { outline: 2px solid #C8963E; outline-offset: 2px; }
.eachr-panel { box-shadow: 0 1px 2px rgba(15, 61, 46, 0.06), 0 8px 24px -16px rgba(15, 61, 46, 0.18); }
@media (prefers-reduced-motion: reduce) { .eachr-motion { transition: none !important; } }
`;

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

function formatBytes(bytes) {
  if (!bytes) return "0 B";

  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;

  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

const fileExtension = (name) =>
  name.includes(".") ? name.split(".").pop().toLowerCase() : "";

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

// PUT with progress events (fetch can't report upload progress)
function putFile(url, file, contentType, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };

    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Storage rejected the upload (status ${xhr.status}).`));

    xhr.onerror = () =>
      reject(
        new Error("Network error. Check your connection and the bucket's CORS settings.")
      );

    xhr.send(file);
  });
}

let idCounter = 0;
const nextId = () => `${Date.now()}-${idCounter++}`;

// ---------------------------------------------------------
// Page
// ---------------------------------------------------------

function AdminUpload() {
  const navigate = useNavigate();
  const location = useLocation();
  const inputRef = useRef(null);

  // The folder the person was looking at (sent by the Programs page)
  const requestedPrefix =
    typeof location.state?.prefix === "string" ? location.state.prefix : "";

  const [email, setEmail] = useState("");
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);

  // A subfolder that isn't in the base list becomes its own selectable destination
  const [extraDestinations, setExtraDestinations] = useState(() =>
    requestedPrefix && !BASE_DESTINATIONS.some((d) => d.prefix === requestedPrefix)
      ? [
          {
            label: requestedPrefix.replace(/\/$/, "").split("/").pop(),
            prefix: requestedPrefix,
            group: "Current folder",
          },
        ]
      : []
  );
  const [destination, setDestination] = useState(
    requestedPrefix || BASE_DESTINATIONS[0].prefix
  );
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);

  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let isMounted = true;

    getCognitoSession()
      .then((session) => {
        if (!isMounted) return;

        const payload = session.getIdToken().decodePayload();
        setEmail(String(payload?.email || "").trim().toLowerCase());
        setCheckingSession(false);
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

  // ---------------------------------------------------------
  // API helper
  // ---------------------------------------------------------

  const apiRequest = useCallback(
    async (path, options = {}) => {
      let token;

      try {
        const session = await getCognitoSession();
        token = session.getIdToken().getJwtToken();
      } catch (err) {
        navigate("/", { replace: true });
        throw err;
      }

      const response = await fetch(`${API_BASE_URL}${path}`, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
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
        throw new Error(
          data?.message || data?.error || `Request failed with status ${response.status}`
        );
      }

      return data;
    },
    [navigate]
  );

  // ---------------------------------------------------------
  // Destinations and new folders
  // ---------------------------------------------------------

  const destinations = useMemo(
    () => [...extraDestinations, ...BASE_DESTINATIONS],
    [extraDestinations]
  );

  const destinationGroups = useMemo(
    () =>
      [...new Set(destinations.map((d) => d.group))].map((group) => ({
        group,
        items: destinations.filter((d) => d.group === group),
      })),
    [destinations]
  );

  const destinationLabel =
    destinations.find((d) => d.prefix === destination)?.label || destination;

  const handleCreateFolder = async (prefix) => {
    await apiRequest(FOLDER_PATH, { method: "POST", body: JSON.stringify({ prefix }) });

    setExtraDestinations((prev) =>
      prev.some((d) => d.prefix === prefix)
        ? prev
        : [...prev, { label: prefix.replace(/\/$/, ""), prefix, group: "New folders" }]
    );
    setDestination(prefix);
  };

  // ---------------------------------------------------------
  // File queue
  // ---------------------------------------------------------

  const addFiles = (fileList) => {
    const accepted = [];
    const rejected = [];

    Array.from(fileList || []).forEach((file) => {
      if (file.size === 0) rejected.push(`${file.name} is empty`);
      else if (file.size > MAX_BYTES)
        rejected.push(`${file.name} is larger than ${formatBytes(MAX_BYTES)}`);
      else
        accepted.push({ id: nextId(), file, status: "queued", progress: 0, error: "", key: "" });
    });

    if (accepted.length) setItems((prev) => [...prev, ...accepted]);
    setNotice(rejected.length ? `Not added: ${rejected.join("; ")}.` : "");
  };

  const patchItem = (id, patch) =>
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));

  const uploadOne = async (item) => {
    const contentType = item.file.type || "application/octet-stream";

    patchItem(item.id, { status: "uploading", progress: 0, error: "" });

    try {
      const data = await apiRequest(UPLOAD_URL_PATH, {
        method: "POST",
        body: JSON.stringify({
          prefix: destination,
          filename: item.file.name,
          contentType,
          size: item.file.size,
        }),
      });

      if (!data?.url || !data?.key) throw new Error("No upload link was returned.");

      await putFile(data.url, item.file, contentType, (progress) =>
        patchItem(item.id, { progress })
      );

      patchItem(item.id, { status: "done", progress: 100, key: data.key });
    } catch (err) {
      if (err instanceof SessionError) return;

      patchItem(item.id, {
        status: "error",
        error: err.message || "Upload failed. Try again.",
      });
    }
  };

  const pending = items.filter((i) => i.status === "queued" || i.status === "error");
  const doneCount = items.filter((i) => i.status === "done").length;

  const uploadAll = async () => {
    setBusy(true);
    setNotice("");

    for (const item of pending) {
      // eslint-disable-next-line no-await-in-loop
      await uploadOne(item);
    }

    setBusy(false);
  };

  // ---------------------------------------------------------
  // Render
  // ---------------------------------------------------------

  if (checkingSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F5F6F2]">
        <div className="text-center">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-[#DDE2DB] border-t-[#0F3D2E]" />
          <p className="mt-4 text-sm font-medium text-slate-600">Checking your session...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F6F2] text-[#16211C]">
      <style>{FONT_CSS}</style>

      <div className="flex min-h-screen">
        <Sidebar mobileOpen={mobileSidebarOpen} onClose={() => setMobileSidebarOpen(false)} />

        <div className="min-w-0 flex-1">
          <Header
            email={email}
            onMenuClick={() => setMobileSidebarOpen(true)}
            onLogout={handleLogout}
          />

          <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
            <div className="border-b border-[#DDE2DB] pb-6">
              <h1 className="eachr-display text-[2rem] font-semibold leading-tight tracking-tight text-[#0F3D2E]">
                Upload files
              </h1>
              <p className="mt-1.5 text-sm text-slate-500">
                Files go straight to private storage and appear in the folder you choose.
              </p>
            </div>

            {/* Destination */}
            <section className="eachr-panel mt-6 rounded-xl border border-[#DDE2DB] bg-white p-5">
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-0 flex-1 basis-64">
                  <label htmlFor="destination" className="block text-sm font-medium">
                    Upload to
                  </label>
                  <select
                    id="destination"
                    value={destination}
                    onChange={(event) => setDestination(event.target.value)}
                    disabled={busy}
                    className="eachr-focus mt-1.5 w-full rounded-lg border border-[#DDE2DB] bg-white px-3 py-2.5 text-sm"
                  >
                    {destinationGroups.map(({ group, items: groupItems }) => (
                      <optgroup key={group} label={group}>
                        {groupItems.map((d) => (
                          <option key={d.prefix} value={d.prefix}>
                            {d.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>

                <button
                  type="button"
                  onClick={() => setFolderDialogOpen(true)}
                  disabled={busy}
                  className="eachr-focus eachr-motion inline-flex items-center gap-2 rounded-lg border border-[#DDE2DB] bg-white px-4 py-2.5 text-sm font-semibold text-[#0F3D2E] transition hover:bg-[#F5F6F2] disabled:opacity-50"
                >
                  <FolderPlus size={17} />
                  New folder
                </button>
              </div>
            </section>

            {/* Drop zone */}
            <div
              onDragOver={(event) => {
                event.preventDefault();
                if (!busy) setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                if (!busy) addFiles(event.dataTransfer.files);
              }}
              className={`eachr-motion mt-5 flex flex-col items-center rounded-2xl border-2 border-dashed px-6 py-10 text-center transition ${
                dragging
                  ? "border-[#2F6B4F] bg-[#E8F0EB]"
                  : "border-[#B9CFC2] bg-[#EEF4F0]"
              }`}
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-white text-[#2F6B4F] shadow-sm">
                <UploadCloud size={24} />
              </span>

              <p className="mt-3 text-sm font-medium text-slate-700">Drag files here, or</p>

              <input
                ref={inputRef}
                type="file"
                multiple
                className="sr-only"
                tabIndex={-1}
                onChange={(event) => {
                  addFiles(event.target.files);
                  event.target.value = "";
                }}
              />

              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={busy}
                className="eachr-focus eachr-motion mt-3 rounded-lg border border-[#DDE2DB] bg-white px-4 py-2 text-sm font-semibold text-[#0F3D2E] transition hover:bg-[#F5F6F2] disabled:opacity-50"
              >
                Choose files
              </button>

              <p className="mt-3 text-xs text-slate-500">
                Up to {formatBytes(MAX_BYTES)} per file.
              </p>
            </div>

            {notice && (
              <div
                role="alert"
                className="mt-4 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"
              >
                <AlertCircle size={18} className="mt-0.5 shrink-0" />
                <p className="min-w-0 flex-1">{notice}</p>
                <button
                  type="button"
                  onClick={() => setNotice("")}
                  aria-label="Dismiss message"
                  className="eachr-focus rounded p-1 hover:bg-red-100"
                >
                  <X size={15} />
                </button>
              </div>
            )}

            {/* Queue */}
            {items.length > 0 && (
              <section aria-label="Files to upload" className="mt-6">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="eachr-display text-lg font-semibold text-[#0F3D2E]">
                    {items.length} {items.length === 1 ? "file" : "files"} for {destinationLabel}
                  </h2>

                  {!busy && (
                    <button
                      type="button"
                      onClick={() => setItems((prev) => prev.filter((i) => i.status !== "done"))}
                      className={`eachr-focus rounded text-sm font-medium text-[#2F6B4F] hover:underline ${
                        doneCount ? "" : "invisible"
                      }`}
                    >
                      Clear finished
                    </button>
                  )}
                </div>

                <ul className="eachr-panel mt-3 divide-y divide-[#EEF1EC] overflow-hidden rounded-xl border border-[#DDE2DB] bg-white">
                  {items.map((item) => (
                    <li key={item.id} className="flex items-center gap-3 px-4 py-3">
                      <FileBadge name={item.file.name} />

                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium" title={item.file.name}>
                          {item.file.name}
                        </p>

                        {item.status === "uploading" ? (
                          <div
                            role="progressbar"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={item.progress}
                            aria-label={`Uploading ${item.file.name}`}
                            className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#E8ECE6]"
                          >
                            <div
                              className="h-full rounded-full bg-[#2F6B4F]"
                              style={{ width: `${item.progress}%` }}
                            />
                          </div>
                        ) : (
                          <p
                            className={`eachr-num mt-0.5 text-xs ${
                              item.status === "error" ? "text-red-700" : "text-slate-500"
                            }`}
                          >
                            {item.status === "error"
                              ? item.error
                              : item.status === "done"
                              ? `Uploaded as ${item.key.split("/").pop()}`
                              : formatBytes(item.file.size)}
                          </p>
                        )}
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        {item.status === "uploading" && (
                          <>
                            <Loader2 size={16} className="animate-spin text-[#2F6B4F]" />
                            <span className="eachr-num w-9 text-right text-xs text-slate-500">
                              {item.progress}%
                            </span>
                          </>
                        )}

                        {item.status === "done" && (
                          <CheckCircle2 size={18} className="text-[#2F6B4F]" aria-label="Uploaded" />
                        )}

                        {item.status === "error" && (
                          <AlertCircle size={18} className="text-red-600" aria-label="Failed" />
                        )}

                        {!busy && item.status !== "done" && (
                          <button
                            type="button"
                            onClick={() =>
                              setItems((prev) => prev.filter((i) => i.id !== item.id))
                            }
                            aria-label={`Remove ${item.file.name}`}
                            className="eachr-focus rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                          >
                            <X size={16} />
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <p role="status" className="text-sm text-slate-600">
                    {!busy && pending.length === 0 && doneCount > 0
                      ? `${doneCount} ${doneCount === 1 ? "file" : "files"} uploaded to ${destinationLabel}.`
                      : ""}
                  </p>

                  <div className="flex items-center gap-2.5">
                    {doneCount > 0 && !busy && (
                      <Link
                        to="/admin"
                        className="eachr-focus eachr-motion rounded-lg border border-[#DDE2DB] bg-white px-4 py-2.5 text-sm font-semibold text-[#0F3D2E] transition hover:bg-[#F5F6F2]"
                      >
                        View all files
                      </Link>
                    )}

                    <button
                      type="button"
                      onClick={uploadAll}
                      disabled={busy || pending.length === 0}
                      className="eachr-focus eachr-motion inline-flex items-center gap-2 rounded-lg bg-[#0F3D2E] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#0B2F23] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {busy ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <UploadCloud size={16} />
                      )}
                      {busy
                        ? "Uploading..."
                        : `Upload ${pending.length} ${pending.length === 1 ? "file" : "files"}`}
                    </button>
                  </div>
                </div>
              </section>
            )}
          </main>
        </div>
      </div>

      <NewFolderDialog
        open={folderDialogOpen}
        onClose={() => setFolderDialogOpen(false)}
        parents={destinations}
        defaultParent={destination}
        onCreate={handleCreateFolder}
      />
    </div>
  );
}

export default AdminUpload;
