import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Folder, UploadCloud, Download, Lock, X, Loader2, AlertCircle, RefreshCw,
  ArrowUp, ArrowDown, ChevronsUpDown, FolderOpen, FolderInput, List, LayoutGrid,
} from "lucide-react";

import Header from "../../components/Header";
import Sidebar from "../../components/Sidebar";
import MoveFile from "../../components/MoveFile";
import { userPool } from "../../cognito";

/*
 * Design tokens
 * emerald #0A6B52 primary | forest #07523F headings | gold #FF9F1C accent
 * canvas  #F5F7F6 page    | line   #E3E9E5 borders  | ink  #14201A text
 */

const FONT_CSS = `
@import url("https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&display=swap");
.eachr-display { font-family: "Fraunces", Georgia, serif; font-feature-settings: "lnum" 1; }
.eachr-num { font-variant-numeric: tabular-nums; }
.eachr-focus:focus-visible { outline: 2px solid #FF9F1C; outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) {
  .eachr-motion { transition: none !important; }
  .eachr-pulse { animation: none !important; }
}
`;

// Backend contract: GET {API}/admin/files?prefix=  -> { files: [{ key, size, lastModified }] }
//                   GET {API}/admin/files/download?key= -> { url }
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api";
const FILES_PATH = "/admin/files";
const DOWNLOAD_PATH = "/admin/files/download";
const STORAGE_LIMIT_BYTES = 500 * 1024 ** 3;
const ROOT_PREFIXES = ["programs/", "departments/", "finance/"];

const FOLDERS = [
  { id: "finance", name: "Finance", group: "Organisation", prefix: "finance/", href: "/admin/finance", restricted: true, color: "#0EA47A" },
  { id: "education-justice", name: "Education Justice", group: "Programmes", prefix: "programs/education-justice/", href: "/admin/programs?area=education-justice", color: "#FF9F1C" },
  { id: "gender-justice", name: "Gender Justice", group: "Programmes", prefix: "programs/gender-justice/", href: "/admin/programs?area=gender-justice", color: "#E5484D" },
  { id: "health-justice", name: "Health Justice", group: "Programmes", prefix: "programs/health-justice/", href: "/admin/programs?area=health-justice", color: "#F2589B" },
  { id: "environment-climate-change", name: "Environment & Climate Change", group: "Programmes", prefix: "programs/environment-climate-change/", href: "/admin/programs?area=environment-climate-change", color: "#7CB518" },
  { id: "economic-justice", name: "Economic Justice", group: "Programmes", prefix: "programs/economic-justice/", href: "/admin/programs?area=economic-justice", color: "#3E7BFA" },
  { id: "business-human-rights", name: "Business & Human Rights", group: "Programmes", prefix: "programs/business-human-rights/", href: "/admin/programs?area=business-human-rights", color: "#D9480F" },
  { id: "communication", name: "Communication", group: "Departments", prefix: "departments/communication/", href: "/admin/programs?area=communication", color: "#8E4EC6" },
  { id: "it", name: "IT", group: "Departments", prefix: "departments/it/", href: "/admin/programs?area=it", restricted: true, color: "#14B8C4" },
  { id: "executive-director", name: "Executive Director", group: "Departments", prefix: "departments/executive-director/", href: "/admin/programs?area=executive-director", restricted: true, color: "#1B2A41" },
];

const MOVE_ROOTS = FOLDERS.map((f) => ({ prefix: f.prefix, label: f.name }));
const ADMIN_GROUPS = ["administrator", "administrators"];
const TABLE_LIMIT = 12;
const SEARCH_LIMIT = 100;
const FOLDERS_PREVIEW = 8;

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

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const v = bytes / 1024 ** i;
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

function formatDate(value, withTime = false) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

function formatPercent(value, bytes) {
  if (!bytes) return "0";
  return value < 0.1 ? "<0.1" : value.toFixed(1);
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
  txt: "bg-slate-100 text-slate-600 ring-slate-200",
};

function FileBadge({ name, size = "sm" }) {
  const ext = fileExtension(name);
  const dims = { sm: "h-9 w-9 rounded-lg text-[10px]", lg: "h-14 w-14 rounded-2xl text-xs", xl: "h-16 w-16 rounded-2xl text-sm" }[size];
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center font-semibold uppercase ring-1 ring-inset ${dims} ${
        BADGE_STYLES[ext] || "bg-slate-100 text-slate-600 ring-slate-200"
      }`}
    >
      {ext ? ext.slice(0, 4) : "file"}
    </span>
  );
}

function SortHeader({ label, sortKey, sort, onSort }) {
  const active = sort.key === sortKey;
  const Icon = !active ? ChevronsUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th scope="col" aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} className="px-5 py-3">
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`eachr-focus -mx-1 inline-flex items-center gap-1.5 rounded px-1 py-0.5 text-xs font-semibold hover:text-[#07523F] ${
          active ? "text-[#07523F]" : "text-slate-500"
        }`}
      >
        {label}
        <Icon size={13} className={active ? "text-[#07523F]" : "text-slate-300"} />
      </button>
    </th>
  );
}

const Card = ({ className = "", children }) => (
  <div className={`rounded-2xl border border-[#E3E9E5] bg-white ${className}`}>{children}</div>
);

const SectionTitle = ({ children, action }) => (
  <div className="mb-3 flex items-center justify-between gap-3">
    <h2 className="eachr-display text-lg font-semibold text-[#07523F]">{children}</h2>
    {action}
  </div>
);

const LinkButton = ({ onClick, children }) => (
  <button type="button" onClick={onClick} className="eachr-focus rounded px-1 text-sm font-medium text-[#0A6B52] hover:underline">
    {children}
  </button>
);

// ---------------------------------------------------------
// Page
// ---------------------------------------------------------

function AdminDashboard() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const searchTerm = (searchParams.get("q") || "").trim();

  const [email, setEmail] = useState("");
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState(true);

  const [files, setFiles] = useState([]);
  const [loadingFiles, setLoadingFiles] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [selectedKey, setSelectedKey] = useState(null);
  const [downloadingKey, setDownloadingKey] = useState(null);
  const [downloadError, setDownloadError] = useState("");
  const [moveTarget, setMoveTarget] = useState(null);

  const [sort, setSort] = useState({ key: "lastModified", dir: "desc" });
  const [showAll, setShowAll] = useState(false);
  const [showAllFolders, setShowAllFolders] = useState(false);
  const [folderFilter, setFolderFilter] = useState("all");
  const [view, setView] = useState("list");

  // Administrator access check (Cognito)
  useEffect(() => {
    let isMounted = true;

    getCognitoSession()
      .then((session) => {
        if (!isMounted) return;
        const payload = session.getIdToken().decodePayload();
        const userEmail = String(payload?.email || "").trim().toLowerCase();
        const groups = Array.isArray(payload?.["cognito:groups"]) ? payload["cognito:groups"] : [];
        const isCognitoAdmin = groups.some((g) => ADMIN_GROUPS.includes(String(g).toLowerCase()));
        const isLegacyAdmin = userEmail === "admin@eachrights.or.ke"; // same fallback as ProtectedRoute

        if (!isCognitoAdmin && !isLegacyAdmin) {
          navigate("/dashboard", { replace: true });
          return;
        }
        setEmail(userEmail);
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

  const apiRequest = useCallback(
    async (path) => {
      let token;
      try {
        const session = await getCognitoSession();
        token = session.getIdToken().getJwtToken();
      } catch (err) {
        navigate("/", { replace: true });
        throw err;
      }

      const response = await fetch(`${API_BASE_URL}${path}`, {
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
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
    setLoadingFiles(true);
    setLoadError("");

    const results = await Promise.allSettled(
      ROOT_PREFIXES.map((prefix) => apiRequest(`${FILES_PATH}?prefix=${encodeURIComponent(prefix)}`))
    );

    if (results.some((r) => r.status === "rejected" && r.reason instanceof SessionError)) return;

    const loaded = results
      .filter((r) => r.status === "fulfilled")
      .flatMap((r) => (Array.isArray(r.value) ? r.value : r.value.files || []))
      .filter((file) => file.key && !file.key.endsWith("/"));

    const failed = results.filter((r) => r.status === "rejected");
    if (failed.length > 0) {
      console.error("Failed to load some folders:", failed);
      setLoadError(
        failed.length === results.length
          ? failed[0].reason?.message || "Unable to load files from cloud storage."
          : "Some folders could not be loaded. The list below may be incomplete."
      );
    }

    setFiles(loaded);
    setLoadingFiles(false);
  }, [apiRequest]);

  useEffect(() => {
    if (!checkingAccess) loadFiles();
  }, [checkingAccess, loadFiles]);

  // ---------------------------------------------------------
  // Derived data
  // ---------------------------------------------------------

  const enrichedFiles = useMemo(
    () =>
      files.map((file) => {
        const folder = FOLDERS.find((f) => file.key.startsWith(f.prefix));
        return {
          ...file,
          name: file.key.split("/").pop(),
          folderId: folder?.id || "other",
          folderName: folder?.name || "Other",
          folderHref: folder?.href || null,
          folderColor: folder?.color || "#94A3B8",
          restricted: !!folder?.restricted,
        };
      }),
    [files]
  );

  const folderStats = useMemo(
    () =>
      FOLDERS.map((folder) => {
        const inFolder = enrichedFiles.filter((f) => f.key.startsWith(folder.prefix));
        return { ...folder, count: inFolder.length, bytes: inFolder.reduce((s, f) => s + (f.size || 0), 0) };
      }),
    [enrichedFiles]
  );

  const totalBytes = enrichedFiles.reduce((s, f) => s + (f.size || 0), 0);
  const usedPercent = Math.min(100, (totalBytes / STORAGE_LIMIT_BYTES) * 100);
  const breakdown = folderStats.filter((f) => f.bytes > 0).sort((a, b) => b.bytes - a.bytes);

  const recentFiles = useMemo(
    () =>
      [...enrichedFiles]
        .sort((a, b) => (new Date(b.lastModified).getTime() || 0) - (new Date(a.lastModified).getTime() || 0))
        .slice(0, 6),
    [enrichedFiles]
  );

  const matchingFiles = useMemo(() => {
    const query = searchTerm.toLowerCase();
    const direction = sort.dir === "asc" ? 1 : -1;

    const compare = (a, b) => {
      switch (sort.key) {
        case "name":
          return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
        case "folderName":
          return a.folderName.localeCompare(b.folderName);
        case "size":
          return (a.size || 0) - (b.size || 0);
        default:
          return (new Date(a.lastModified).getTime() || 0) - (new Date(b.lastModified).getTime() || 0);
      }
    };

    return enrichedFiles
      .filter((f) => folderFilter === "all" || f.folderId === folderFilter)
      .filter((f) => !query || f.name.toLowerCase().includes(query) || f.folderName.toLowerCase().includes(query))
      .sort((a, b) => compare(a, b) * direction);
  }, [enrichedFiles, searchTerm, sort, folderFilter]);

  const defaultLimit = searchTerm ? SEARCH_LIMIT : TABLE_LIMIT;
  const visibleFiles = showAll ? matchingFiles : matchingFiles.slice(0, defaultLimit);
  const selectedFile = enrichedFiles.find((f) => f.key === selectedKey);

  const handleSort = (key) =>
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "name" || key === "folderName" ? "asc" : "desc" }
    );

  const handleDownload = async (file) => {
    setDownloadError("");
    setDownloadingKey(file.key);
    try {
      const data = await apiRequest(`${DOWNLOAD_PATH}?key=${encodeURIComponent(file.key)}`);
      if (!data?.url) throw new Error("No download link was returned.");
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      if (err instanceof SessionError) return;
      console.error("Download failed:", err);
      setDownloadError(err.message || "Unable to download this file.");
    } finally {
      setDownloadingKey(null);
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
          <p className="mt-4 text-sm font-medium text-slate-600">Checking administrator access...</p>
        </div>
      </div>
    );
  }

  const today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const shownFolders = showAllFolders ? folderStats : folderStats.slice(0, FOLDERS_PREVIEW);
  const showEmpty = !loadingFiles && visibleFiles.length === 0;

  return (
    <div className="min-h-screen bg-[#F5F7F6] text-[#14201A]">
      <style>{FONT_CSS}</style>

      <div className="flex min-h-screen">
        <Sidebar mobileOpen={mobileSidebarOpen} onClose={() => setMobileSidebarOpen(false)} />

        <div className="min-w-0 flex-1">
          <Header email={email} onMenuClick={() => setMobileSidebarOpen(true)} onLogout={handleLogout} />

          <main className="mx-auto max-w-[1280px] space-y-8 px-4 py-8 sm:px-6 lg:px-8">
            {/* Welcome */}
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h1 className="eachr-display text-3xl font-semibold tracking-tight text-[#07523F]">All files</h1>
                <p className="mt-1 text-sm text-slate-500">
                  {getGreeting()}, Administrator. {today}.
                </p>
              </div>

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={loadFiles}
                  disabled={loadingFiles}
                  aria-label="Refresh files"
                  title="Refresh files"
                  className="eachr-focus eachr-motion rounded-lg border border-[#E3E9E5] bg-white p-2.5 text-slate-600 transition hover:bg-[#E3F4EB] disabled:opacity-50"
                >
                  <RefreshCw size={17} className={loadingFiles ? "animate-spin" : ""} />
                </button>
                <Link
                  to="/admin/upload"
                  className="eachr-focus eachr-motion inline-flex items-center gap-2 rounded-lg bg-[#0A6B52] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#07523F]"
                >
                  <UploadCloud size={17} />
                  Upload files
                </Link>
              </div>
            </div>

            {loadError && (
              <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                <AlertCircle size={19} className="mt-0.5 shrink-0" />
                <p className="min-w-0 flex-1">{loadError}</p>
                <button type="button" onClick={loadFiles} className="eachr-focus rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold hover:bg-red-100">
                  Try again
                </button>
              </div>
            )}

            {/* Storage */}
            <section aria-label="Storage">
              <Card className="p-5 sm:p-6">
                <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                  <div className="flex items-baseline gap-2">
                    <p className="eachr-display eachr-num text-4xl font-semibold tracking-tight">
                      {loadingFiles ? "–" : formatBytes(totalBytes)}
                    </p>
                    <p className="text-sm text-slate-500">used of 500 GB</p>
                  </div>
                  <p className="eachr-num text-sm text-slate-500">
                    {loadingFiles ? "Calculating usage..." : `${enrichedFiles.length} files, ${formatPercent(usedPercent, totalBytes)}% of allocation`}
                  </p>
                </div>

                <div
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(usedPercent)}
                  aria-label="Storage used"
                  className="mt-4 flex h-3 gap-0.5 overflow-hidden rounded-full bg-[#E9EEEB]"
                >
                  {!loadingFiles &&
                    breakdown.map((f) => (
                      <div
                        key={f.id}
                        title={`${f.name}: ${formatBytes(f.bytes)}`}
                        className="h-full first:rounded-l-full last:rounded-r-full"
                        style={{ width: `${(f.bytes / STORAGE_LIMIT_BYTES) * 100}%`, minWidth: 4, backgroundColor: f.color }}
                      />
                    ))}
                </div>

                {!loadingFiles && breakdown.length > 0 && (
                  <ul className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
                    {breakdown.slice(0, 8).map((f) => (
                      <li key={f.id} className="flex items-center gap-2 text-sm">
                        <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: f.color }} />
                        <span className="min-w-0 flex-1 truncate text-slate-700">{f.name}</span>
                        <span className="eachr-num text-slate-500">{formatBytes(f.bytes)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </section>

            {/* Folders */}
            <section aria-label="Folders">
              <SectionTitle
                action={
                  folderStats.length > FOLDERS_PREVIEW && (
                    <LinkButton onClick={() => setShowAllFolders((v) => !v)}>
                      {showAllFolders ? "Show fewer" : "View all"}
                    </LinkButton>
                  )
                }
              >
                Folders
              </SectionTitle>

              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {shownFolders.map((folder) => (
                  <li key={folder.id}>
                    <Link
                      to={folder.href}
                      className="eachr-focus eachr-motion group flex h-full items-center gap-3 rounded-xl border border-[#E3E9E5] bg-white px-3.5 py-3 transition hover:border-[#0A6B52]/40 hover:shadow-sm"
                    >
                      <Folder size={22} style={{ color: folder.color }} fill="currentColor" fillOpacity={0.25} className="shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 text-sm font-semibold">
                          <span className="truncate">{folder.name}</span>
                          {folder.restricted && (
                            <>
                              <Lock size={12} className="shrink-0 text-[#B9852F]" aria-hidden="true" />
                              <span className="sr-only">Restricted access</span>
                            </>
                          )}
                        </span>
                        <span className="eachr-num block text-xs text-slate-500">
                          {loadingFiles ? "Loading..." : `${folder.count} ${folder.count === 1 ? "file" : "files"}, ${formatBytes(folder.bytes)}`}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>

            {/* Recent files (hidden while searching) */}
            {!searchTerm && (loadingFiles || recentFiles.length > 0) && (
              <section aria-label="Recent files">
                <SectionTitle>Recently modified</SectionTitle>

                <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                  {loadingFiles
                    ? Array.from({ length: 6 }).map((_, i) => (
                        <li key={i} className="eachr-pulse h-36 animate-pulse rounded-2xl bg-[#E8ECE6]" />
                      ))
                    : recentFiles.map((file) => (
                        <li key={file.key}>
                          <button
                            type="button"
                            onClick={() => setSelectedKey(file.key)}
                            title={file.name}
                            className="eachr-focus eachr-motion flex h-full w-full flex-col items-center rounded-2xl border border-[#E3E9E5] bg-white px-3 py-5 text-center transition hover:border-[#0A6B52]/40 hover:shadow-sm"
                          >
                            <FileBadge name={file.name} size="lg" />
                            <span className="mt-3 w-full truncate text-sm font-medium">{file.name}</span>
                            <span className="eachr-num mt-0.5 text-xs text-slate-500">
                              {formatBytes(file.size)} · {formatDate(file.lastModified)}
                            </span>
                          </button>
                        </li>
                      ))}
                </ul>
              </section>
            )}

            {/* Files */}
            <section aria-label="Files">
              <SectionTitle
                action={
                  searchTerm && (
                    <Link to="/admin" className="eachr-focus inline-flex items-center gap-1.5 rounded text-sm font-medium text-[#0A6B52] hover:underline">
                      <X size={14} />
                      Clear search for “{searchTerm}”
                    </Link>
                  )
                }
              >
                {searchTerm ? "Search results" : "Cloud storage"}
              </SectionTitle>

              {downloadError && (
                <div role="alert" className="mb-3 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                  <AlertCircle size={18} className="mt-0.5 shrink-0" />
                  <p className="min-w-0 flex-1">{downloadError}</p>
                  <button type="button" onClick={() => setDownloadError("")} aria-label="Dismiss message" className="eachr-focus rounded p-1 hover:bg-red-100">
                    <X size={15} />
                  </button>
                </div>
              )}

              <Card className="overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E3E9E5] px-5 py-3">
                  <label className="flex items-center gap-2 text-sm text-slate-600">
                    <span>Folder</span>
                    <select
                      value={folderFilter}
                      onChange={(e) => {
                        setFolderFilter(e.target.value);
                        setShowAll(false);
                      }}
                      className="eachr-focus rounded-lg border border-[#E3E9E5] bg-white px-2.5 py-1.5 text-sm text-[#14201A]"
                    >
                      <option value="all">All folders</option>
                      {FOLDERS.map((f) => (
                        <option key={f.id} value={f.id}>{f.name}</option>
                      ))}
                    </select>
                  </label>

                  <div role="group" aria-label="Layout" className="inline-flex rounded-lg border border-[#E3E9E5] p-0.5">
                    {[["list", List, "List"], ["grid", LayoutGrid, "Grid"]].map(([id, Icon, label]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setView(id)}
                        aria-pressed={view === id}
                        className={`eachr-focus inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold ${
                          view === id ? "bg-[#E3F4EB] text-[#07523F]" : "text-slate-500 hover:text-[#07523F]"
                        }`}
                      >
                        <Icon size={14} />
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {showEmpty ? (
                  <div className="flex flex-col items-center px-5 py-16 text-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#D9F0E5] text-[#0A6B52]">
                      <FolderOpen size={22} />
                    </div>
                    <h3 className="mt-4 text-sm font-semibold">
                      {searchTerm || folderFilter !== "all" ? "No files match your search" : "No files yet"}
                    </h3>
                    <p className="mt-1 max-w-sm text-sm leading-6 text-slate-500">
                      {searchTerm || folderFilter !== "all"
                        ? "Check the spelling, or try a different folder."
                        : "Upload your first document and it will appear here."}
                    </p>
                    <Link
                      to={searchTerm ? "/admin" : "/admin/upload"}
                      className="eachr-focus eachr-motion mt-5 inline-flex items-center gap-2 rounded-lg border border-[#E3E9E5] bg-white px-3.5 py-2 text-sm font-semibold text-[#0A6B52] transition hover:bg-[#E3F4EB]"
                    >
                      {searchTerm ? "Clear search" : "Upload files"}
                    </Link>
                  </div>
                ) : view === "grid" && !loadingFiles ? (
                  <ul className="grid grid-cols-2 gap-3 p-5 md:grid-cols-3 xl:grid-cols-5">
                    {visibleFiles.map((file) => (
                      <li key={file.key}>
                        <button
                          type="button"
                          onClick={() => setSelectedKey(file.key)}
                          title={file.name}
                          className={`eachr-focus eachr-motion flex w-full flex-col items-center rounded-xl border px-3 py-4 text-center transition hover:bg-[#F4FAF6] ${
                            file.key === selectedKey ? "border-[#FF9F1C] bg-[#E3F4EB]" : "border-[#E3E9E5]"
                          }`}
                        >
                          <FileBadge name={file.name} size="lg" />
                          <span className="mt-3 w-full truncate text-sm font-medium">{file.name}</span>
                          <span className="eachr-num mt-0.5 text-xs text-slate-500">{formatBytes(file.size)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="overflow-x-auto" aria-busy={loadingFiles}>
                    <table className="w-full min-w-[680px]">
                      <thead className="bg-[#F5F8F6]">
                        <tr className="border-b border-[#E3E9E5] text-left">
                          <SortHeader label="Name" sortKey="name" sort={sort} onSort={handleSort} />
                          <SortHeader label="Folder" sortKey="folderName" sort={sort} onSort={handleSort} />
                          <SortHeader label="Last modified" sortKey="lastModified" sort={sort} onSort={handleSort} />
                          <SortHeader label="Size" sortKey="size" sort={sort} onSort={handleSort} />
                          <th scope="col" className="px-5 py-3"><span className="sr-only">Actions</span></th>
                        </tr>
                      </thead>

                      <tbody className="divide-y divide-[#EEF1EC]">
                        {loadingFiles
                          ? Array.from({ length: 6 }).map((_, i) => (
                              <tr key={i}>
                                <td className="px-5 py-3">
                                  <div className="flex items-center gap-3">
                                    <div className="eachr-pulse h-9 w-9 animate-pulse rounded-lg bg-[#E8ECE6]" />
                                    <div className="eachr-pulse h-3.5 w-48 max-w-full animate-pulse rounded bg-[#E8ECE6]" />
                                  </div>
                                </td>
                                {[24, 20, 12].map((w) => (
                                  <td key={w} className="px-5 py-3">
                                    <div className="eachr-pulse h-3.5 animate-pulse rounded bg-[#E8ECE6]" style={{ width: w * 4 }} />
                                  </td>
                                ))}
                                <td />
                              </tr>
                            ))
                          : visibleFiles.map((file) => {
                              const selected = file.key === selectedKey;
                              return (
                                <tr
                                  key={file.key}
                                  onClick={() => setSelectedKey(file.key)}
                                  className={`eachr-motion cursor-pointer transition ${selected ? "bg-[#E3F4EB]" : "hover:bg-[#F4FAF6]"}`}
                                >
                                  <td className={`w-2/5 max-w-0 px-5 py-3 ${selected ? "shadow-[inset_3px_0_0_#FF9F1C]" : ""}`}>
                                    <button
                                      type="button"
                                      onClick={() => setSelectedKey(file.key)}
                                      aria-pressed={selected}
                                      title={file.name}
                                      className="eachr-focus flex w-full min-w-0 items-center gap-3 rounded text-left"
                                    >
                                      <FileBadge name={file.name} />
                                      <span className="truncate text-sm font-medium">{file.name}</span>
                                    </button>
                                  </td>

                                  <td className="px-5 py-3">
                                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-slate-700">
                                      <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: file.folderColor }} />
                                      {file.folderName}
                                      {file.restricted && <Lock size={11} className="text-[#B9852F]" aria-label="Restricted access" />}
                                    </span>
                                  </td>

                                  <td className="eachr-num whitespace-nowrap px-5 py-3 text-sm text-slate-500">{formatDate(file.lastModified)}</td>
                                  <td className="eachr-num whitespace-nowrap px-5 py-3 text-sm text-slate-500">{formatBytes(file.size)}</td>

                                  <td className="px-5 py-3 text-right">
                                    <div className="flex justify-end gap-1">
                                      <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); setMoveTarget(file); }}
                                        aria-label={`Move ${file.name}`}
                                        title={`Move ${file.name}`}
                                        className="eachr-focus eachr-motion rounded-lg p-2 text-slate-500 transition hover:bg-[#D9F0E5] hover:text-[#0A6B52]"
                                      >
                                        <FolderInput size={17} />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); handleDownload(file); }}
                                        disabled={downloadingKey === file.key}
                                        aria-label={`Download ${file.name}`}
                                        title={`Download ${file.name}`}
                                        className="eachr-focus eachr-motion rounded-lg p-2 text-slate-500 transition hover:bg-[#D9F0E5] hover:text-[#0A6B52] disabled:cursor-not-allowed disabled:opacity-50"
                                      >
                                        {downloadingKey === file.key ? <Loader2 size={17} className="animate-spin" /> : <Download size={17} />}
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                      </tbody>
                    </table>
                  </div>
                )}

                {!loadingFiles && matchingFiles.length > 0 && (
                  <div className="eachr-num flex items-center justify-between gap-3 border-t border-[#E3E9E5] bg-[#F5F8F6] px-5 py-3 text-xs text-slate-500">
                    <p>
                      Showing {visibleFiles.length} of {matchingFiles.length} {matchingFiles.length === 1 ? "file" : "files"}
                    </p>
                    {matchingFiles.length > defaultLimit && (
                      <button type="button" onClick={() => setShowAll((v) => !v)} className="eachr-focus rounded px-1 text-xs font-semibold text-[#0A6B52] hover:underline">
                        {showAll ? "Show fewer" : `Show all ${matchingFiles.length}`}
                      </button>
                    )}
                  </div>
                )}
              </Card>
            </section>
          </main>
        </div>
      </div>

      {/* Details drawer */}
      {selectedFile && (
        <>
          <div className="fixed inset-0 z-30 bg-black/20 xl:hidden" onClick={() => setSelectedKey(null)} aria-hidden="true" />
          <aside
            aria-label="File details"
            className="fixed inset-y-0 right-0 z-40 w-full max-w-sm overflow-y-auto border-l border-[#E3E9E5] bg-white shadow-2xl"
          >
            <FileDetails
              file={selectedFile}
              downloading={downloadingKey === selectedFile.key}
              onDownload={() => handleDownload(selectedFile)}
              onMove={() => setMoveTarget(selectedFile)}
              onClose={() => setSelectedKey(null)}
            />
          </aside>
        </>
      )}

      <MoveFile
        file={moveTarget}
        files={files}
        roots={MOVE_ROOTS}
        onClose={() => setMoveTarget(null)}
        onMoved={() => {
          setMoveTarget(null);
          setSelectedKey(null);
          loadFiles();
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------
// Details drawer
// ---------------------------------------------------------

function FileDetails({ file, downloading, onDownload, onMove, onClose }) {
  const ext = fileExtension(file.name);
  const rows = [
    ["File type", ext ? ext.toUpperCase() : "—"],
    ["Size", formatBytes(file.size)],
    ["Folder", file.folderName],
    ["Last modified", formatDate(file.lastModified, true)],
  ];

  const secondary =
    "eachr-focus eachr-motion inline-flex w-full items-center justify-center gap-2 rounded-lg border border-[#E3E9E5] bg-white px-4 py-2.5 text-sm font-semibold text-[#0A6B52] transition hover:bg-[#E3F4EB]";

  return (
    <div>
      <div className="flex items-center justify-between border-b border-[#E3E9E5] px-5 py-3.5">
        <h2 className="text-sm font-semibold">Details</h2>
        <button type="button" onClick={onClose} aria-label="Close details" className="eachr-focus rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
          <X size={16} />
        </button>
      </div>

      <div className="p-5">
        <div className="flex h-36 items-center justify-center rounded-xl bg-[#E3F4EB]">
          <FileBadge name={file.name} size="xl" />
        </div>

        <p className="mt-4 break-words text-sm font-semibold leading-5">{file.name}</p>

        <dl className="mt-4 divide-y divide-[#E8ECE6] border-t border-[#E8ECE6] text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-start justify-between gap-4 py-2.5">
              <dt className="text-slate-500">{label}</dt>
              <dd className="eachr-num text-right font-medium">{value}</dd>
            </div>
          ))}
        </dl>

        <p className="mt-3 break-all text-xs text-slate-500">{file.key}</p>

        <div className="mt-5 space-y-2.5">
          <button
            type="button"
            onClick={onDownload}
            disabled={downloading}
            className="eachr-focus eachr-motion inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#0A6B52] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#07523F] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {downloading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            Download file
          </button>

          <button type="button" onClick={onMove} className={secondary}>
            <FolderInput size={16} />
            Move file
          </button>

          {file.folderHref && (
            <Link to={file.folderHref} className={secondary}>
              <FolderOpen size={16} />
              Open folder
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

export default AdminDashboard;
