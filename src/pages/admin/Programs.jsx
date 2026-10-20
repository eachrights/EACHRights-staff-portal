import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  GraduationCap,
  Coins,
  Users,
  MessageSquare,
  Monitor,
  Briefcase,
  Lock,
  Stethoscope,
  Leaf,
  FileText,
  Folder,
  FolderPlus,
  HardDrive,
  Layers,
  Search,
  Upload,
  Download,
  Eye,
  Pencil,
  Trash2,
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  Clock3,
  X,
  AlertCircle,
  Loader2,
  RefreshCw,
} from "lucide-react";

import Header from "../../components/Header";
import Sidebar from "../../components/Sidebar";
import NewFolderRow from "../../components/NewFolderRow";
import { validateFolderName } from "../../components/folderUtils";
import { userPool } from "../../cognito";
import { accessFromPayload, canSeeDepartment } from "../../access";

/*
 * Design tokens (shared with the rest of the admin console)
 * forest  #0F3D2E  primary surface and actions
 * moss    #2F6B4F  secondary green for icons
 * ochre   #C8963E  focus accent
 * paper   #F5F6F2  page background
 * line    #DDE2DB  hairlines and borders
 * ink     #16211C  body text
 */

const FONT_CSS = `
@import url("https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&display=swap");
.eachr-display { font-family: "Fraunces", Georgia, "Times New Roman", serif; font-feature-settings: "lnum" 1; }
.eachr-focus:focus-visible { outline: 2px solid #C8963E; outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) {
  .eachr-motion { transition: none !important; animation: none !important; }
}
`;

/* ---------------------------------------------------------
 * Backend contract (adjust these to match your API)
 *
 * GET  {API}/admin/files?prefix=programs/
 *      -> { files: [{ key, size, lastModified }] }
 *         `key` is the full S3 object key, e.g.
 *         "programs/education-justice/2027/report.pdf".
 *         Keys ending in "/" are empty-folder placeholders and are
 *         used to show folders that have no files yet.
 *
 * GET  {API}/admin/files/download?key=<s3 key>&disposition=inline|attachment
 *      -> { url }   (short-lived pre-signed S3 URL). "inline" is used by
 *         View and "attachment" by Download; the server should pass it to
 *         S3 as ResponseContentDisposition so the browser shows or saves
 *         the file accordingly.
 *
 * DELETE {API}/admin/files?key=<s3 key>
 *      -> 200/204   (permanently deletes that one object)
 *
 * POST {API}/admin/files/rename     body: { key, newName }
 *      newName is the new file name only (no folders), same extension.
 *      -> { key }   the new full key. 409 if that name is already taken.
 *
 * POST {API}/admin/files/rename-folder   body: { prefix, newName }
 *      prefix is the folder's full key with a trailing slash; newName is the
 *      new folder name only. The server moves every file inside it.
 *      -> { prefix }   the new full prefix. 409 if that name is already taken.
 *
 * POST {API}/admin/files/folder     body: { prefix }
 *      prefix is the full folder key with a trailing slash, e.g.
 *      "programs/education-justice/2027/Reports/". The server should
 *      create an empty object with that key so the folder persists.
 *      -> 200/201
 * ------------------------------------------------------- */
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api";
const FILES_PATH = "/admin/files";
const DOWNLOAD_PATH = "/admin/files/download";
const FOLDERS_PATH = "/admin/files/folder";
const RENAME_PATH = "/admin/files/rename";
const RENAME_FOLDER_PATH = "/admin/files/rename-folder";
// Programmes live under programs/<slug>/, departments under departments/<slug>/
const ROOT_PREFIXES = ["programs/", "departments/"];

/* The areas shown on this page. `slug` is the folder name in cloud storage:
 * <root><slug>/...  (programs/education-justice/, departments/it/, ...)
 * Every area gets the same file browser (folders, files, view, download,
 * rename, delete, upload). Access follows the Cognito group "dept-<slug>".
 * The Executive Director is the CEO, so "dept-CEO" can read everything. */
const THEMATIC_AREAS = [
  {
    slug: "education-justice",
    name: "Education Justice",
    group: "Programmes",
    root: "programs/",
    description:
      "Promoting access to quality, inclusive and equitable education.",
    icon: GraduationCap,
  },
  {
    slug: "gender-justice",
    name: "Gender Justice",
    group: "Programmes",
    root: "programs/",
    description:
      "Advancing gender equality, equity and the rights of women and girls.",
    icon: Users,
  },
  {
    slug: "health-justice",
    name: "Health Justice",
    group: "Programmes",
    root: "programs/",
    description:
      "Advocating for accessible, quality and equitable health services.",
    icon: Stethoscope,
  },
  {
    slug: "environment-climate-change",
    name: "Environment & Climate Change",
    group: "Programmes",
    root: "programs/",
    description:
      "Environmental protection, climate action and the rights of communities affected by climate change.",
    icon: Leaf,
  },
  {
    slug: "economic-justice",
    name: "Economic Justice",
    group: "Programmes",
    root: "programs/",
    description:
      "Economic and social rights for vulnerable communities.",
    icon: Coins,
  },
  {
    slug: "communication",
    name: "Communication",
    group: "Departments",
    root: "departments/",
    description:
      "Communication, media and outreach documents.",
    icon: MessageSquare,
  },
  {
    slug: "it",
    name: "IT",
    group: "Departments",
    root: "departments/",
    restricted: true,
    description:
      "Systems, equipment, licences and technical documentation.",
    icon: Monitor,
  },
  {
    slug: "executive-director",
    name: "Executive Director",
    group: "Departments",
    root: "departments/",
    restricted: true,
    description:
      "Office of the Executive Director: board, leadership and confidential documents.",
    icon: Briefcase,
  },
];

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

  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  const value = bytes / 1024 ** index;

  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${
    units[index]
  }`;
}

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const sumBytes = (files) => files.reduce((sum, f) => sum + (f.size || 0), 0);

const latestModified = (files) =>
  files.reduce(
    (latest, f) =>
      !latest || new Date(f.lastModified) > new Date(latest)
        ? f.lastModified
        : latest,
    null
  );

function fileNameProblem(name) {
  if (!name) return "Enter a file name.";
  if (name.length > 150) return "Use 150 characters or fewer.";
  if (/[\\/]/.test(name)) return "The name can't contain slashes.";
  if (name.startsWith(".") || name.includes(".."))
    return "The name can't start with a dot or contain two dots in a row.";
  if (/[\u0000-\u001f]/.test(name)) return "The name contains characters that aren't allowed.";
  return "";
}

/**
 * Inline rename, like Windows: the name (without its extension) is selected,
 * Enter or clicking away saves, Escape cancels. The extension stays fixed.
 */
function RenameField({ name, onSave, onCancel, variant = "file" }) {
  const isFolder = variant === "folder";
  const problemOf = isFolder ? (n) => validateFolderName(n).error : fileNameProblem;
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

  const commit = async () => {
    if (busyRef.current) return;

    const trimmed = value.trim().replace(/\s+/g, " ");
    const problem = problemOf(trimmed);

    if (problem) {
      setError(problem);
      inputRef.current?.focus();
      return;
    }

    if (trimmed === base) {
      onCancel();
      return;
    }

    busyRef.current = true;
    setSaving(true);
    setError("");

    try {
      await onSave(`${trimmed}${ext}`);
    } catch (err) {
      if (err instanceof SessionError) return;

      busyRef.current = false;
      setSaving(false);
      setError(err?.message || `Unable to rename this ${isFolder ? "folder" : "file"}.`);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      if (!saving) onCancel();
    }
  };

  // Clicking away saves a valid name and cancels an invalid one
  const handleBlur = () => {
    if (busyRef.current) return;

    const trimmed = value.trim().replace(/\s+/g, " ");
    if (problemOf(trimmed)) onCancel();
    else commit();
  };

  return (
    <div>
      <div className="flex min-w-0 items-center gap-3">
        {isFolder ? (
          <Folder size={17} className="shrink-0 text-[#C8963E]" />
        ) : (
          <FileText size={17} className="shrink-0 text-[#2F6B4F]" />
        )}

        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            if (error) setError("");
          }}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          disabled={saving}
          autoComplete="off"
          aria-label={isFolder ? "Folder name" : "File name"}
          aria-invalid={error ? "true" : "false"}
          className="min-w-0 flex-1 rounded border border-[#C8963E] bg-white px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[#C8963E]"
        />

        {ext && <span className="shrink-0 text-sm text-slate-500">{ext}</span>}
        {saving && <Loader2 size={15} className="shrink-0 animate-spin text-slate-500" />}
      </div>

      {error && (
        <p role="alert" className="mt-1 pl-8 text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------
// Page
// ---------------------------------------------------------

function Programs() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [access, setAccess] = useState({ isAdmin: false, departments: new Set() });
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const [files, setFiles] = useState([]);
  const [serverFolders, setServerFolders] = useState([]); // placeholder keys from storage
  const [createdFolders, setCreatedFolders] = useState([]); // folders made during this visit
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // The selected area lives in the URL (?area=slug) so the sidebar can link to it
  const [searchParams, setSearchParams] = useSearchParams();
  const areaParam = searchParams.get("area");
  const selectedSlug = THEMATIC_AREAS.some((a) => a.slug === areaParam)
    ? areaParam
    : null;
  const setSelectedSlug = (slug) =>
    setSearchParams(slug ? { area: slug } : {});

  // ---------------------------------------------------------
  // API helper (Cognito ID token, refreshed automatically)
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

      if (response.status === 403) {
        throw new Error("You do not have permission to do this.");
      }

      if (!response.ok) {
        throw new Error(
          data?.message ||
            data?.error ||
            `Request failed with status ${response.status}`
        );
      }

      return data;
    },
    [navigate]
  );

  // ---------------------------------------------------------
  // Signed-in administrator (for the Header)
  // ---------------------------------------------------------

  useEffect(() => {
    let isMounted = true;

    getCognitoSession()
      .then((session) => {
        if (!isMounted) return;

        const payload = session.getIdToken().decodePayload();
        setEmail(String(payload?.email || "").trim().toLowerCase());
        setAccess(accessFromPayload(payload));
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

    navigate("/", { replace: true });
  };

  // ---------------------------------------------------------
  // Load program files from cloud storage
  // ---------------------------------------------------------

  const loadFiles = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) setLoading(true);
      setError("");

      try {
        // Programmes and departments are stored under different top-level folders
        const results = await Promise.allSettled(
          ROOT_PREFIXES.map((prefix) =>
            apiRequest(`${FILES_PATH}?prefix=${encodeURIComponent(prefix)}`)
          )
        );

        if (
          results.some(
            (r) => r.status === "rejected" && r.reason instanceof SessionError
          )
        ) {
          return;
        }

        const failed = results.filter((r) => r.status === "rejected");

        if (failed.length === results.length) throw failed[0].reason;

        const list = results
          .filter((r) => r.status === "fulfilled")
          .flatMap((r) => (Array.isArray(r.value) ? r.value : r.value.files || []))
          .filter((item) => item.key);

        if (failed.length > 0) {
          console.error("Failed to load some folders:", failed);
          setError("Some folders could not be loaded. The list below may be incomplete.");
        }

        // Keys ending in "/" are folder placeholders, not files
        setFiles(list.filter((item) => !item.key.endsWith("/")));
        setServerFolders(
          list.filter((item) => item.key.endsWith("/")).map((item) => item.key)
        );
      } catch (err) {
        if (err instanceof SessionError) return;

        console.error("Failed to load program files:", err);
        setError(err.message || "Unable to load files from cloud storage.");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [apiRequest]
  );

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  // ---------------------------------------------------------
  // Create a folder (full key with trailing slash)
  // ---------------------------------------------------------

  const createFolder = useCallback(
    async (prefix) => {
      await apiRequest(FOLDERS_PATH, {
        method: "POST",
        body: JSON.stringify({ prefix }),
      });

      // Show it straight away, then sync with storage in the background
      setCreatedFolders((prev) => (prev.includes(prefix) ? prev : [...prev, prefix]));
      loadFiles({ silent: true });
    },
    [apiRequest, loadFiles]
  );

  // ---------------------------------------------------------
  // Delete a file (full key)
  // ---------------------------------------------------------

  const deleteFile = useCallback(
    async (key) => {
      await apiRequest(`${FILES_PATH}?key=${encodeURIComponent(key)}`, {
        method: "DELETE",
      });

      // Remove it from the list straight away, then sync in the background
      setFiles((prev) => prev.filter((file) => file.key !== key));
      loadFiles({ silent: true });
    },
    [apiRequest, loadFiles]
  );

  // ---------------------------------------------------------
  // Rename a file (same folder, same extension)
  // ---------------------------------------------------------

  const renameFile = useCallback(
    async (key, newName) => {
      const data = await apiRequest(RENAME_PATH, {
        method: "POST",
        body: JSON.stringify({ key, newName }),
      });

      const newKey =
        data?.key || `${key.slice(0, key.lastIndexOf("/") + 1)}${newName}`;

      // Show the new name straight away, then sync in the background
      setFiles((prev) =>
        prev.map((file) => (file.key === key ? { ...file, key: newKey } : file))
      );
      loadFiles({ silent: true });
    },
    [apiRequest, loadFiles]
  );

  // ---------------------------------------------------------
  // Rename a folder (the server moves every file inside it)
  // ---------------------------------------------------------

  const renameFolder = useCallback(
    async (prefix, newName) => {
      const data = await apiRequest(RENAME_FOLDER_PATH, {
        method: "POST",
        body: JSON.stringify({ prefix, newName }),
      });

      const parent = prefix.slice(0, prefix.slice(0, -1).lastIndexOf("/") + 1);
      const newPrefix = data?.prefix || `${parent}${newName}/`;
      const move = (key) =>
        key.startsWith(prefix) ? `${newPrefix}${key.slice(prefix.length)}` : key;

      // Show the new name straight away, then sync in the background
      setFiles((prev) => prev.map((file) => ({ ...file, key: move(file.key) })));
      setServerFolders((prev) => prev.map(move));
      setCreatedFolders((prev) => prev.map(move));
      loadFiles({ silent: true });
    },
    [apiRequest, loadFiles]
  );

  // ---------------------------------------------------------
  // Group files by thematic area
  // ---------------------------------------------------------

  const allAreas = useMemo(() => {
    const folderKeys = [...new Set([...serverFolders, ...createdFolders])];

    return THEMATIC_AREAS.map((area) => {
      const prefix = `${area.root}${area.slug}/`;
      const areaFiles = files
        .filter((file) => file.key.startsWith(prefix))
        .map((file) => ({
          ...file,
          name: file.key.slice(prefix.length),
        }));

      const folderPaths = folderKeys
        .filter((key) => key.startsWith(prefix) && key !== prefix)
        .map((key) => key.slice(prefix.length));

      return {
        ...area,
        prefix,
        files: areaFiles,
        folderPaths,
        bytes: sumBytes(areaFiles),
        updated: latestModified(areaFiles),
      };
    });
  }, [files, serverFolders, createdFolders]);

  // People only see the departments (Cognito groups "dept-<slug>") they belong to
  const areas = useMemo(
    () =>
      allAreas.filter((area) => canSeeDepartment(access, area.slug)),
    [allAreas, access]
  );

  const totalFiles = areas.reduce((sum, a) => sum + a.files.length, 0);
  const totalBytes = areas.reduce((sum, a) => sum + a.bytes, 0);

  const selectedArea = areas.find((area) => area.slug === selectedSlug);

  const summary = [
    { label: "Areas", value: areas.length, icon: Layers },
    { label: "Files stored", value: loading ? "–" : totalFiles, icon: FileText },
    {
      label: "Storage used",
      value: loading ? "–" : formatBytes(totalBytes),
      icon: HardDrive,
    },
  ];

  // ---------------------------------------------------------
  // Render
  // ---------------------------------------------------------

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

          <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            {error && (
              <div
                role="alert"
                className="mb-5 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
              >
                <AlertCircle size={19} className="mt-0.5 shrink-0" />

                <div className="min-w-0 flex-1">
                  <p className="font-semibold">Unable to load files</p>
                  <p className="mt-1">{error}</p>
                </div>

                <button
                  type="button"
                  onClick={() => loadFiles()}
                  className="eachr-focus rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold hover:bg-red-100"
                >
                  Try again
                </button>
              </div>
            )}

            {selectedArea ? (
              <AreaView
                key={selectedArea.slug}
                area={selectedArea}
                loading={loading}
                apiRequest={apiRequest}
                onBack={() => setSelectedSlug(null)}
                onCreateFolder={createFolder}
                onDeleteFile={deleteFile}
                onRenameFile={renameFile}
                onRenameFolder={renameFolder}
                onUpload={(prefix) =>
                  navigate("/admin/upload", {
                    state: { area: selectedArea.name, prefix },
                  })
                }
              />
            ) : (
              <>
                {/* PAGE HEADER */}
                <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                  <div>
                    <p className="text-sm text-slate-500">
                      Administration <span aria-hidden="true">/</span> Programs
                    </p>

                    <h1 className="eachr-display mt-2 text-3xl font-semibold tracking-tight">
                      Programs
                    </h1>

                    <p className="mt-1.5 max-w-xl text-sm leading-6 text-slate-500">
                      Program documents organised by thematic area and stored
                      in private cloud storage.
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => loadFiles()}
                      disabled={loading}
                      className="eachr-focus eachr-motion inline-flex items-center gap-2 rounded-lg border border-[#DDE2DB] bg-white px-4 py-2.5 text-sm font-semibold transition hover:bg-[#F5F6F2] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <RefreshCw
                        size={16}
                        className={loading ? "animate-spin" : ""}
                      />
                      Refresh
                    </button>

                    <Link
                      to="/admin/upload"
                      className="eachr-focus eachr-motion inline-flex items-center gap-2 rounded-lg bg-[#0F3D2E] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#0B2F23]"
                    >
                      <Upload size={16} />
                      Upload file
                    </Link>
                  </div>
                </div>

                {/* SUMMARY STRIP */}
                <section
                  aria-label="Program storage summary"
                  className="mb-6 grid overflow-hidden rounded-2xl border border-[#DDE2DB] bg-white sm:grid-cols-3"
                >
                  {summary.map((item, index) => {
                    const Icon = item.icon;

                    return (
                      <div
                        key={item.label}
                        className={`p-5 sm:p-6 ${
                          index > 0
                            ? "border-t border-[#DDE2DB] sm:border-l sm:border-t-0"
                            : ""
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium text-slate-500">
                            {item.label}
                          </p>
                          <Icon size={18} className="text-[#2F6B4F]" />
                        </div>

                        <p className="eachr-display mt-3 text-3xl font-semibold tracking-tight">
                          {item.value}
                        </p>
                      </div>
                    );
                  })}
                </section>

                {/* THEMATIC AREAS */}
                <section aria-label="Thematic areas">
                  {areas.length === 0 && (
                    <p className="rounded-2xl border border-[#DDE2DB] bg-white p-6 text-sm text-slate-500">
                      You haven't been added to a department yet. Ask an
                      administrator for access.
                    </p>
                  )}

                  {["Programmes", "Departments"].map((group) => {
                    const groupAreas = areas.filter((a) => a.group === group);

                    if (groupAreas.length === 0) return null;

                    return (
                  <div key={group} className="mb-8 last:mb-0">
                  <h2 className="eachr-display mb-3 text-lg font-semibold text-[#0F3D2E]">
                    {group}
                  </h2>

                  <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {groupAreas.map((area) => {
                      const Icon = area.icon;

                      return (
                        <li key={area.slug}>
                          <button
                            type="button"
                            onClick={() => setSelectedSlug(area.slug)}
                            className="eachr-focus eachr-motion group flex h-full w-full flex-col rounded-2xl border border-[#DDE2DB] bg-white p-5 text-left transition hover:border-[#2F6B4F] hover:shadow-sm sm:p-6"
                          >
                            <div className="flex items-start justify-between">
                              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[#E8F0EB] text-[#0F3D2E]">
                                <Icon size={21} />
                              </div>

                              <ArrowRight
                                size={18}
                                className="eachr-motion text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-[#0F3D2E]"
                              />
                            </div>

                            <h2 className="eachr-display mt-5 flex items-center gap-2 text-xl font-semibold">
                              {area.name}
                              {area.restricted && (
                                <>
                                  <Lock size={14} className="shrink-0 text-[#B9852F]" aria-hidden="true" />
                                  <span className="sr-only">Restricted access</span>
                                </>
                              )}
                            </h2>

                            <p className="mt-1.5 flex-1 text-sm leading-6 text-slate-500">
                              {area.description}
                            </p>

                            <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-[#E8ECE6] pt-4 text-xs">
                              <div>
                                <dt className="text-slate-400">Files</dt>
                                <dd className="mt-1 text-sm font-semibold">
                                  {loading ? "–" : area.files.length}
                                </dd>
                              </div>

                              <div>
                                <dt className="text-slate-400">Size</dt>
                                <dd className="mt-1 text-sm font-semibold">
                                  {loading ? "–" : formatBytes(area.bytes)}
                                </dd>
                              </div>

                              <div>
                                <dt className="text-slate-400">Updated</dt>
                                <dd className="mt-1 text-sm font-semibold">
                                  {loading
                                    ? "–"
                                    : area.updated
                                    ? formatDate(area.updated)
                                    : "No files"}
                                </dd>
                              </div>
                            </dl>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  </div>
                    );
                  })}
                </section>
              </>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------
// Thematic area detail (folders and files from cloud storage)
// ---------------------------------------------------------

function AreaView({
  area,
  loading,
  apiRequest,
  onBack,
  onUpload,
  onCreateFolder,
  onDeleteFile,
  onRenameFile,
  onRenameFolder,
}) {
  const Icon = area.icon;

  // Where we are inside the area: "" (top), "2027/", "2027/Reports/" ...
  const [path, setPath] = useState("");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [working, setWorking] = useState(null); // { key, action } while a link is being fetched
  const [downloadError, setDownloadError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [renamingKey, setRenamingKey] = useState(null);
  const [renamingFolder, setRenamingFolder] = useState(null);

  const segments = path.split("/").filter(Boolean);
  const currentName = segments.length ? segments[segments.length - 1] : area.name;
  const currentPrefix = `${area.prefix}${path}`;

  const openFolder = (nextPath) => {
    setPath(nextPath);
    setSearch("");
    setCreating(false);
  };

  // Everything directly inside the current folder
  const { allFolders, allFiles } = useMemo(() => {
    const folderNames = new Set();
    const here = [];

    for (const file of area.files) {
      if (!file.name.startsWith(path)) continue;

      const rest = file.name.slice(path.length);
      const slash = rest.indexOf("/");

      if (slash === -1) here.push({ ...file, displayName: rest });
      else folderNames.add(rest.slice(0, slash));
    }

    for (const folderPath of area.folderPaths) {
      if (!folderPath.startsWith(path)) continue;

      const rest = folderPath.slice(path.length);
      const slash = rest.indexOf("/");

      if (slash > 0) folderNames.add(rest.slice(0, slash));
    }

    const folders = [...folderNames]
      .sort((a, b) => a.localeCompare(b))
      .map((name) => {
        const inside = area.files.filter((f) => f.name.startsWith(`${path}${name}/`));

        return {
          name,
          count: inside.length,
          bytes: sumBytes(inside),
          updated: latestModified(inside),
        };
      });

    return { allFolders: folders, allFiles: here };
  }, [area.files, area.folderPaths, path]);

  const query = search.trim().toLowerCase();

  const visibleFolders = allFolders.filter(
    (folder) => !query || folder.name.toLowerCase().includes(query)
  );

  const visibleFiles = allFiles
    .filter((file) => !query || file.displayName.toLowerCase().includes(query))
    .sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));

  const hasEntries = allFolders.length > 0 || allFiles.length > 0;
  const hasVisible = visibleFolders.length > 0 || visibleFiles.length > 0;

  const isWorking = (file, action) =>
    working?.key === file.key && working?.action === action;

  const iconButton =
    "eachr-focus eachr-motion rounded-lg p-2 text-slate-500 transition hover:bg-[#E8F0EB] hover:text-[#0F3D2E] disabled:cursor-not-allowed disabled:opacity-50";

  // View: open the file in a new tab. Download: save it to the computer.
  const handleFileAction = async (file, action) => {
    setDownloadError("");
    setWorking({ key: file.key, action });

    // Open the tab now (while the click is still "fresh") so browsers don't
    // block it, then point it at the file once the link arrives.
    const viewWindow = action === "view" ? window.open("about:blank", "_blank") : null;

    try {
      const disposition = action === "view" ? "inline" : "attachment";
      const data = await apiRequest(
        `${DOWNLOAD_PATH}?key=${encodeURIComponent(file.key)}&disposition=${disposition}`
      );

      if (!data?.url) throw new Error("No link was returned for this file.");

      if (viewWindow) {
        viewWindow.opener = null;
        viewWindow.location.href = data.url;
      } else {
        const link = document.createElement("a");
        link.href = data.url;
        link.download = file.displayName;
        document.body.appendChild(link);
        link.click();
        link.remove();
      }
    } catch (err) {
      viewWindow?.close();

      if (err instanceof SessionError) return;

      console.error(`${action} failed:`, err);
      setDownloadError(
        err.message ||
          (action === "view" ? "Unable to open this file." : "Unable to download this file.")
      );
    } finally {
      setWorking(null);
    }
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
      await onDeleteFile(deleteTarget.key);
      setDeleteTarget(null);
    } catch (err) {
      if (err instanceof SessionError) return;

      console.error("Delete failed:", err);
      setDeleteError(err.message || "Unable to delete this file.");
    } finally {
      setDeleting(false);
    }
  };

  useEffect(() => {
    if (!deleteTarget) return undefined;

    const onKeyDown = (event) => {
      if (event.key === "Escape" && !deleting) {
        setDeleteTarget(null);
        setDeleteError("");
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [deleteTarget, deleting]);

  return (
    <>
      <button
        type="button"
        onClick={onBack}
        className="eachr-focus mb-4 inline-flex items-center gap-1.5 rounded text-sm font-medium text-[#2F6B4F] hover:underline"
      >
        <ArrowLeft size={15} />
        All thematic areas
      </button>

      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#E8F0EB] text-[#0F3D2E]">
            <Icon size={24} />
          </div>

          <div>
            <h1 className="eachr-display text-3xl font-semibold tracking-tight">
              {area.name}
            </h1>

            <p className="mt-1.5 max-w-xl text-sm leading-6 text-slate-500">
              {area.description}
            </p>

            {!loading && (
              <p className="mt-2 text-xs text-slate-400">
                {area.files.length} {area.files.length === 1 ? "file" : "files"}{" "}
                · {formatBytes(area.bytes)}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setCreating(true)}
            disabled={loading || creating}
            className="eachr-focus eachr-motion inline-flex items-center gap-2 rounded-lg border border-[#DDE2DB] bg-white px-4 py-2.5 text-sm font-semibold transition hover:bg-[#F5F6F2] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <FolderPlus size={16} />
            New folder
          </button>

          <button
            type="button"
            onClick={() => onUpload(currentPrefix)}
            className="eachr-focus eachr-motion inline-flex items-center gap-2 rounded-lg bg-[#0F3D2E] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#0B2F23]"
          >
            <Upload size={16} />
            Upload to {currentName}
          </button>
        </div>
      </div>

      {segments.length > 0 && (
        <nav aria-label="Folder path" className="mb-4 flex flex-wrap items-center gap-1 text-sm">
          <button
            type="button"
            onClick={() => openFolder("")}
            className="eachr-focus rounded font-medium text-[#2F6B4F] hover:underline"
          >
            {area.name}
          </button>

          {segments.map((segment, index) => {
            const segmentPath = `${segments.slice(0, index + 1).join("/")}/`;
            const isLast = index === segments.length - 1;

            return (
              <span key={segmentPath} className="inline-flex items-center gap-1">
                <ChevronRight size={14} className="text-slate-300" aria-hidden="true" />
                {isLast ? (
                  <span aria-current="page" className="font-semibold">
                    {segment}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => openFolder(segmentPath)}
                    className="eachr-focus rounded font-medium text-[#2F6B4F] hover:underline"
                  >
                    {segment}
                  </button>
                )}
              </span>
            );
          })}
        </nav>
      )}

      {downloadError && (
        <div
          role="alert"
          className="mb-5 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
          <AlertCircle size={19} className="mt-0.5 shrink-0" />
          <p className="min-w-0 flex-1">{downloadError}</p>
          <button
            type="button"
            onClick={() => setDownloadError("")}
            aria-label="Dismiss message"
            className="eachr-focus rounded p-1 hover:bg-red-100"
          >
            <X size={16} />
          </button>
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border border-[#DDE2DB] bg-white">
        {hasEntries && (
          <div className="border-b border-[#DDE2DB] p-4 sm:p-5">
            <div className="relative max-w-md">
              <Search
                size={17}
                aria-hidden="true"
                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
              />

              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`Search ${currentName}`}
                aria-label={`Search ${currentName}`}
                className="eachr-focus w-full rounded-lg border border-[#DDE2DB] bg-[#F5F6F2] py-2.5 pl-10 pr-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-[#2F6B4F] focus:bg-white"
              />
            </div>
          </div>
        )}

        {creating && (
          <div className="border-b border-[#DDE2DB] p-4 sm:p-5">
            <NewFolderRow
              parentPrefix={currentPrefix}
              existingNames={allFolders.map((folder) => folder.name)}
              onCreate={onCreateFolder}
              onDone={() => setCreating(false)}
            />
          </div>
        )}

        {loading ? (
          <div className="px-5 py-16 text-center">
            <Loader2
              size={28}
              className="eachr-motion mx-auto mb-3 animate-spin text-[#2F6B4F]"
            />
            <p className="text-sm font-medium">Loading files...</p>
            <p className="mt-1 text-xs text-slate-400">
              Retrieving documents from cloud storage
            </p>
          </div>
        ) : !hasEntries ? (
          !creating && (
            <div className="flex flex-col items-center px-5 py-16 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#E8F0EB] text-[#0F3D2E]">
                <FileText size={22} />
              </div>

              <h3 className="mt-4 text-sm font-semibold">
                {segments.length ? "This folder is empty" : "No files in this area yet"}
              </h3>

              <p className="mt-1 max-w-sm text-sm leading-6 text-slate-500">
                Documents uploaded to {currentName} will be listed here.
              </p>

              <button
                type="button"
                onClick={() => onUpload(currentPrefix)}
                className="eachr-focus eachr-motion mt-5 inline-flex items-center gap-2 rounded-lg border border-[#DDE2DB] bg-white px-4 py-2.5 text-sm font-semibold transition hover:bg-[#F5F6F2]"
              >
                <Upload size={16} />
                Upload first file
              </button>
            </div>
          )
        ) : !hasVisible ? (
          <p className="px-5 py-12 text-center text-sm text-slate-500">
            Nothing here matches your search.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px]">
              <thead>
                <tr className="border-b border-[#DDE2DB] bg-[#F5F6F2] text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  <th scope="col" className="px-6 py-3.5">
                    Name
                  </th>
                  <th scope="col" className="px-6 py-3.5">
                    Size
                  </th>
                  <th scope="col" className="px-6 py-3.5">
                    Last updated
                  </th>
                  <th scope="col" className="px-6 py-3.5 text-right">
                    Actions
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-[#E8ECE6]">
                {visibleFolders.map((folder) => (
                  <tr key={`folder-${folder.name}`} className="hover:bg-[#F5F6F2]/70">
                    <td className="px-6 py-4">
                      {renamingFolder === folder.name ? (
                        <RenameField
                          variant="folder"
                          name={folder.name}
                          onCancel={() => setRenamingFolder(null)}
                          onSave={async (newName) => {
                            await onRenameFolder(`${currentPrefix}${folder.name}/`, newName);
                            setRenamingFolder(null);
                          }}
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => openFolder(`${path}${folder.name}/`)}
                          className="eachr-focus flex min-w-0 max-w-full items-center gap-3 rounded text-left text-sm font-medium hover:underline"
                        >
                          <Folder size={17} className="shrink-0 text-[#C8963E]" />
                          <span className="truncate">{folder.name}</span>
                        </button>
                      )}
                    </td>

                    <td className="px-6 py-4 text-sm text-slate-500">
                      {folder.count > 0 ? formatBytes(folder.bytes) : "—"}
                    </td>

                    <td className="px-6 py-4 text-sm text-slate-500">
                      {folder.updated ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Clock3 size={13} aria-hidden="true" />
                          {formatDate(folder.updated)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>

                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => setRenamingFolder(folder.name)}
                          disabled={renamingFolder === folder.name}
                          aria-label={`Rename folder ${folder.name}`}
                          title="Rename"
                          className={iconButton}
                        >
                          <Pencil size={17} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}

                {visibleFiles.map((file) => (
                  <tr key={file.key} className="hover:bg-[#F5F6F2]/70">
                    <td className="px-6 py-4">
                      {renamingKey === file.key ? (
                        <RenameField
                          name={file.displayName}
                          onCancel={() => setRenamingKey(null)}
                          onSave={async (newName) => {
                            await onRenameFile(file.key, newName);
                            setRenamingKey(null);
                          }}
                        />
                      ) : (
                        <div className="flex min-w-0 items-center gap-3 text-sm font-medium">
                          <FileText
                            size={17}
                            className="shrink-0 text-[#2F6B4F]"
                          />
                          <span className="truncate">{file.displayName}</span>
                        </div>
                      )}
                    </td>

                    <td className="px-6 py-4 text-sm text-slate-500">
                      {formatBytes(file.size)}
                    </td>

                    <td className="px-6 py-4 text-sm text-slate-500">
                      <span className="inline-flex items-center gap-1.5">
                        <Clock3 size={13} aria-hidden="true" />
                        {formatDate(file.lastModified)}
                      </span>
                    </td>

                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => handleFileAction(file, "view")}
                          disabled={working?.key === file.key}
                          aria-label={`View ${file.displayName}`}
                          title="View"
                          className={iconButton}
                        >
                          {isWorking(file, "view") ? (
                            <Loader2 size={17} className="animate-spin" />
                          ) : (
                            <Eye size={17} />
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => handleFileAction(file, "download")}
                          disabled={working?.key === file.key}
                          aria-label={`Download ${file.displayName}`}
                          title="Download"
                          className={iconButton}
                        >
                          {isWorking(file, "download") ? (
                            <Loader2 size={17} className="animate-spin" />
                          ) : (
                            <Download size={17} />
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => setRenamingKey(file.key)}
                          disabled={working?.key === file.key || renamingKey === file.key}
                          aria-label={`Rename ${file.displayName}`}
                          title="Rename"
                          className={iconButton}
                        >
                          <Pencil size={17} />
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setDeleteError("");
                            setDeleteTarget(file);
                          }}
                          disabled={working?.key === file.key}
                          aria-label={`Delete ${file.displayName}`}
                          title="Delete"
                          className="eachr-focus eachr-motion rounded-lg p-2 text-slate-500 transition hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Trash2 size={17} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
          <div
            className="absolute inset-0 bg-[#16211C]/50"
            onClick={closeDeleteDialog}
            aria-hidden="true"
          />

          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-file-title"
            aria-describedby="delete-file-desc"
            className="relative w-full max-w-md rounded-xl border border-[#DDE2DB] bg-white p-6 shadow-xl"
          >
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-700">
                <Trash2 size={20} />
              </span>

              <div className="min-w-0">
                <h2 id="delete-file-title" className="text-lg font-semibold">
                  Delete this file?
                </h2>
                <p id="delete-file-desc" className="mt-1.5 text-sm leading-6 text-slate-600">
                  <span className="break-all font-semibold text-[#16211C]">
                    {deleteTarget.displayName}
                  </span>{" "}
                  will be permanently removed from cloud storage. This can't be
                  undone.
                </p>
              </div>
            </div>

            {deleteError && (
              <div
                role="alert"
                className="mt-4 flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
              >
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
                className="eachr-focus rounded-lg border border-[#DDE2DB] bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-[#F5F6F2] disabled:opacity-50"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={confirmDelete}
                disabled={deleting}
                className="eachr-focus inline-flex items-center gap-2 rounded-lg bg-red-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-60"
              >
                {deleting && <Loader2 size={16} className="animate-spin" />}
                {deleting ? "Deleting..." : "Delete file"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default Programs;
