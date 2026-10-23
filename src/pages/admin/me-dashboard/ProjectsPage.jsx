import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { DEPARTMENT_AREAS, PROGRAM_AREAS, getAccess } from "../../../access";
import { api } from "../../../meApi";
import { BTN, BTN_LIGHT, CARD, ErrorBar, FIELD, Page, PageHead, orderResults } from "./Shared";

/* One page for projects: the list (current to previous), and the dashboard of the
   project you open from it. The chosen project is kept in the address as ?project=<id>,
   so it can be bookmarked and the browser back button returns to the list. */

const AREAS = [...PROGRAM_AREAS, ...DEPARTMENT_AREAS];
const areaName = (slug) => AREAS.find((a) => a.slug === slug)?.name || slug || "-";

const time = (s) => {
  const t = s ? new Date(s).getTime() : NaN;
  return Number.isNaN(t) ? null : t;
};

const fmtDate = (s) => {
  const t = time(s);
  if (t === null) return "-";
  const d = new Date(t);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
};

/* current = today is between start and end (open ended counts), upcoming = not started, past = ended */
function stateOf(f, now) {
  const start = time(f.startDate);
  const end = time(f.endDate);
  if (start !== null && start > now) return "upcoming";
  if (end !== null && end < now) return "past";
  return "current";
}

const DOT = { current: "#1F7A5C", upcoming: "#D4A600", past: "#98A2B3" };
const LABEL = { current: "Current", upcoming: "Upcoming", past: "Previous" };
const RANK = { current: 0, upcoming: 1, past: 2 };

function ProjectList({ onOpen }) {
  const [frameworks, setFrameworks] = useState(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let mounted = true;
    api("/me/frameworks")
      .then((r) => mounted && setFrameworks(r.frameworks))
      .catch((e) => mounted && setError(e.message));
    getAccess().then((r) => mounted && setIsAdmin(r.isAdmin)).catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  /* Current first, then upcoming, then previous; newest start date first inside each group */
  const projects = useMemo(() => {
    if (!frameworks) return [];
    const now = Date.now();
    const q = query.trim().toLowerCase();
    return frameworks
      .filter((f) => !q || f.name.toLowerCase().includes(q))
      .map((f) => ({ f, state: stateOf(f, now), sort: time(f.startDate) ?? time(f.createdAt) ?? 0 }))
      .sort((a, b) => RANK[a.state] - RANK[b.state] || b.sort - a.sort);
  }, [frameworks, query]);

  return (
    <Page>
      <PageHead title="Projects" subtitle="All projects, from current to previous.">
        <input className={`${FIELD} w-64`} placeholder="Search projects" aria-label="Search projects" value={query} onChange={(e) => setQuery(e.target.value)} />
        {isAdmin && (
          <Link to="/me-dashboard/frameworks" className={BTN}>+ Add new project</Link>
        )}
      </PageHead>

      <ErrorBar error={error} />

      <section className={`${CARD} overflow-x-auto`} aria-label="Projects">
        <p className="border-b border-[#EAECF0] px-5 py-3 text-sm font-semibold text-[#101828]">
          Projects {frameworks && <span className="font-normal text-[#667085]">({projects.length})</span>}
        </p>
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead>
            <tr className="bg-[#F9FAFB] text-xs font-medium text-[#667085]">
              <th className="px-5 py-3">Name</th>
              <th className="px-3 py-3">Thematic area</th>
              <th className="px-3 py-3">Theme</th>
              <th className="px-3 py-3">Start date</th>
              <th className="px-3 py-3">End date</th>
              <th className="px-5 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {!frameworks && !error && (
              <tr><td colSpan={6} className="px-5 py-10 text-center text-[#98A2B3]">Loading projects...</td></tr>
            )}
            {frameworks && projects.length === 0 && (
              <tr><td colSpan={6} className="px-5 py-10 text-center italic text-[#98A2B3]">No projects found</td></tr>
            )}
            {projects.map(({ f, state }) => (
              <tr key={f.id} className="border-t border-[#F2F4F7]">
                <td className="px-5 py-3">
                  <button type="button" onClick={() => onOpen(f.id)} className="text-left font-medium text-[#5B3FD0] hover:underline">
                    {f.name}
                  </button>
                </td>
                <td className="px-3 py-3 text-[#475467]">{areaName(f.area)}</td>
                <td className="px-3 py-3 text-[#475467]">{[f.theme, f.focusArea].filter(Boolean).join(", ") || "-"}</td>
                <td className="px-3 py-3 text-[#475467]">{fmtDate(f.startDate)}</td>
                <td className="px-3 py-3 text-[#475467]">{fmtDate(f.endDate)}</td>
                <td className="px-5 py-3">
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#344054]">
                    <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: DOT[state] }} />
                    {LABEL[state]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </Page>
  );
}

/* ---------- One project ---------- */

/* Status choices, coloured like Kinaki's */
const STATUSES = [
  { id: "on-track", label: "On track", bg: "#1FAE7A", soft: "#E1F1EB", fg: "#1F7A5C" },
  { id: "delayed", label: "Delayed", bg: "#2E86C1", soft: "#E6F1FA", fg: "#1F5F8F" },
  { id: "at-risk", label: "At risk", bg: "#F28C28", soft: "#FDEEDB", fg: "#9A5410" },
  { id: "alert", label: "Alert", bg: "#E5484D", soft: "#FDECEC", fg: "#B42318" },
];
const statusOf = (id) => STATUSES.find((s) => s.id === id) || STATUSES[0];

const fmtLong = (s) => {
  const t = time(s);
  if (t === null) return "";
  return new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};
const fmtStamp = (s) => {
  const t = time(s);
  return t === null ? "" : new Date(t).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};
const daysBetween = (a, b) => Math.round((b - a) / 86400000) + 1;
const initials = (name = "") =>
  name.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join("") || "?";

function Chip({ children, dark = false }) {
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${dark ? "bg-[#2B2F36] text-white" : "bg-[#E9F3D9] text-[#33541A]"}`}>
      {children}
    </span>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-1.5">
      <dt className="w-28 shrink-0 text-sm text-[#667085]">{label}</dt>
      <dd className="flex min-w-0 flex-wrap gap-1.5 text-sm text-[#101828]">{children}</dd>
    </div>
  );
}

function ProjectView({ frameworkId, onBack }) {
  const [data, setData] = useState(null);
  const [updates, setUpdates] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [choice, setChoice] = useState("");
  const [message, setMessage] = useState("");
  const [access, setAccess] = useState({ isAdmin: false, departments: new Set() });

  const load = useCallback(async () => {
    const loaded = await api(`/me/frameworks/${frameworkId}`);
    setData(loaded);
    /* Status updates are optional: an API without them just shows an empty log */
    api(`/me/frameworks/${frameworkId}/status`)
      .then((r) => setUpdates(r.updates || []))
      .catch(() => setUpdates([]));
  }, [frameworkId]);

  useEffect(() => {
    setData(null);
    /* No id in the URL means the route is missing ":frameworkId"; do not call the API with "undefined" */
    if (!frameworkId) {
      setError('No project was chosen.');
      return;
    }
    setError("");
    load().catch((e) => setError(e.message));
  }, [load, frameworkId]);

  useEffect(() => {
    let mounted = true;
    getAccess().then((r) => mounted && setAccess(r)).catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const fw = data?.framework;
  const canManage = Boolean(fw) && (access.isAdmin || access.departments.has(fw.area));
  const ordered = useMemo(() => (data ? orderResults(data.results) : []), [data]);

  const stats = useMemo(() => {
    if (!data) return null;
    const resultIds = new Set(data.results.map((r) => r.id));
    const connected = data.indicators.filter((i) => resultIds.has(i.resultId)).length;
    const approved = new Set(data.values.filter((v) => v.status === "approved").map((v) => v.indicatorId)).size;
    const awaiting = data.values.filter((v) => v.status === "submitted").length;
    const perResult = new Map();
    for (const i of data.indicators) perResult.set(i.resultId, (perResult.get(i.resultId) || 0) + 1);
    return { connected, unconnected: data.indicators.length - connected, approved, awaiting, perResult };
  }, [data]);

  const latest = [...updates].sort((a, b) => (time(b.at) ?? 0) - (time(a.at) ?? 0));
  const current = latest[0];

  const setStatus = async () => {
    if (!choice) return setError("Choose a status first.");
    if (!message.trim()) return setError("Write a short note about the status.");
    setBusy(true);
    setError("");
    try {
      await api(`/me/frameworks/${frameworkId}/status`, { method: "POST", body: { status: choice, message: message.trim() } });
      setChoice("");
      setMessage("");
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const start = time(fw?.startDate);
  const end = time(fw?.endDate);
  const themes = [fw?.theme, fw?.focusArea].filter(Boolean);
  const countries = Array.isArray(fw?.countries) ? fw.countries : fw?.country ? [fw.country] : [];
  const team = Array.isArray(fw?.team) ? fw.team : [];

  if (!fw) {
    return (
      <Page>
        <ErrorBar error={error} />
        {!error && <p className="py-10 text-center text-sm text-[#98A2B3]">Loading project...</p>}
        {error && <button type="button" className={BTN_LIGHT} onClick={() => onBack()}>All projects</button>}
      </Page>
    );
  }

  return (
    <Page>
      <div>
        <button type="button" onClick={onBack} className="text-sm font-medium text-[#5B3FD0] hover:underline">
          &larr; All projects
        </button>
      </div>

      <ErrorBar error={error} />

      {/* Header card */}
      <section className={`${CARD} p-6`} aria-label="Project overview">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-xl font-semibold text-[#101828]">Project: {fw.name}</h1>
          {current && (
            <span className="rounded-md px-3 py-1 text-xs font-semibold" style={{ background: statusOf(current.status).soft, color: statusOf(current.status).fg }}>
              {statusOf(current.status).label}
            </span>
          )}
        </div>

        <div className="mt-4 grid gap-x-10 gap-y-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <div>
            <dl>
              <Row label="Thematic area"><Chip dark>{areaName(fw.area) || "-"}</Chip></Row>
              {themes.length > 0 && (
                <Row label="Themes">
                  {themes.map((t) => (
                    <Chip key={t} dark>{t}</Chip>
                  ))}
                </Row>
              )}
              <Row label="Periods">
                {fw.periods.map((p) => (
                  <Chip key={p}>{p}</Chip>
                ))}
              </Row>
              <Row label="Project duration">
                {start !== null || end !== null ? (
                  <span className="rounded bg-[#E9F3D9] px-2 py-0.5 text-xs font-medium text-[#33541A]">
                    {fmtLong(fw.startDate) || "Not set"} - {fmtLong(fw.endDate) || "Not set"}
                    {start !== null && end !== null ? `, (${daysBetween(start, end)} days)` : ""}
                  </span>
                ) : (
                  <span className="text-[#98A2B3]">Not set</span>
                )}
              </Row>
            </dl>

            {/* Project status */}
            <div className="mt-4">
              <h2 className="text-sm font-semibold text-[#101828]">Project status</h2>

              {current ? (
                <div className="mt-2 flex items-start gap-3 rounded-md bg-[#EDF1F5] p-3 text-sm">
                  <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#5B3FD0] text-xs font-semibold text-white">
                    {initials(current.by)}
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs text-[#667085]">
                      {current.by} <span className="ml-1">{fmtStamp(current.at)}</span>
                    </p>
                    <p className="mt-0.5">
                      <span className="mr-2 rounded px-1.5 py-0.5 text-[11px] font-semibold text-white" style={{ background: statusOf(current.status).bg }}>
                        {statusOf(current.status).label}
                      </span>
                      {current.message}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="mt-2 text-sm italic text-[#98A2B3]">No status has been set yet.</p>
              )}

              {canManage && (
                <div className="mt-3 flex gap-3">
                  <textarea
                    aria-label="Project status note"
                    placeholder="Project status"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={5}
                    className="min-h-[110px] w-full flex-1 rounded-md border border-[#D0D5DD] bg-white p-3 text-sm outline-none focus:border-[#5B3FD0] focus:ring-4 focus:ring-[#5B3FD0]/15"
                  />
                  <div role="radiogroup" aria-label="Status" className="flex w-28 shrink-0 flex-col gap-2">
                    {STATUSES.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        role="radio"
                        aria-checked={choice === s.id}
                        onClick={() => setChoice(s.id)}
                        className="rounded-md px-2 py-2 text-xs font-semibold text-white transition"
                        style={{ background: s.bg, opacity: choice && choice !== s.id ? 0.45 : 1, outline: choice === s.id ? "2px solid #101828" : "none", outlineOffset: 1 }}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {canManage && (
                <button type="button" onClick={setStatus} disabled={busy || !choice || !message.trim()} className={`${BTN} mt-3`}>
                  Set status
                </button>
              )}

              {latest.length > 1 && (
                <details className="mt-4">
                  <summary className="cursor-pointer text-sm font-medium text-[#5B3FD0]">Earlier updates ({latest.length - 1})</summary>
                  <ul className="mt-2 space-y-2">
                    {latest.slice(1).map((u) => (
                      <li key={u.id || u.at} className="rounded-md border border-[#EAECF0] p-2.5 text-sm">
                        <p className="text-xs text-[#667085]">{u.by} · {fmtStamp(u.at)}</p>
                        <p className="mt-0.5">
                          <span className="mr-2 rounded px-1.5 py-0.5 text-[11px] font-semibold" style={{ background: statusOf(u.status).soft, color: statusOf(u.status).fg }}>
                            {statusOf(u.status).label}
                          </span>
                          {u.message}
                        </p>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          </div>

          {/* Right column */}
          <div>
            <dl>
              <Row label="Donor"><span className="font-semibold">{fw.donor || "Not set"}</span></Row>
              <Row label="Budget"><span className="font-semibold">{fw.budget ? `${Number(fw.budget).toLocaleString()} ${fw.currency || ""}`.trim() : "Not set"}</span></Row>
              {fw.description && <Row label="About"><span className="text-[#475467]">{fw.description}</span></Row>}
              <Row label="Countries">
                {countries.length ? countries.map((c) => <span key={c} className="font-semibold text-[#5B3FD0]">{c}</span>) : <span className="text-[#98A2B3]">Not set</span>}
              </Row>
            </dl>

            <div className="mt-3">
              <h2 className="text-sm text-[#667085]">Project team</h2>
              <div className="mt-2 flex flex-wrap gap-2">
                {team.length === 0 && <span className="text-sm text-[#98A2B3]">No team members listed</span>}
                {team.map((m) => (
                  <span key={m} title={m} className="flex h-9 w-9 items-center justify-center rounded-full bg-[#EDE9FB] text-xs font-semibold text-[#5B3FD0]">
                    {initials(m)}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Project logic & indicators */}
      <section className={CARD} aria-label="Project logic and indicators">
        <h2 className="rounded-t-xl border-b border-[#F4D9C6] bg-[#FDF1E8] px-5 py-3 text-sm font-semibold text-[#9A5410]">
          Project logic &amp; indicators
        </h2>

        <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <div>
            <div className="mb-3 flex items-center gap-2">
              <h3 className="text-sm font-semibold text-[#101828]">Project logic</h3>
              <Link to={`/me-dashboard/indicators?framework=${frameworkId}`} className="text-xs font-medium text-[#5B3FD0] hover:underline">
                Open results
              </Link>
            </div>

            {ordered.length === 0 ? (
              <p className="text-sm italic text-[#98A2B3]">No results have been added to this project yet.</p>
            ) : (
              <ul className="space-y-2">
                {ordered.map((r) => (
                  <li key={r.id} style={{ marginLeft: `${r.depth * 20}px` }} className="flex items-center gap-3">
                    <span className="w-28 shrink-0 text-xs text-[#98A2B3]">{fw.levels?.[r.level] ?? `Level ${r.level + 1}`}</span>
                    <span className="min-w-0 flex-1 rounded-md bg-[#F7A35C] px-3 py-2 text-xs font-medium text-[#3A2108]">
                      {r.title}
                    </span>
                    <span className="shrink-0 rounded-full bg-[#F2F4F7] px-2 py-0.5 text-[11px] font-medium text-[#475467]" title="Indicators">
                      {stats.perResult.get(r.id) || 0}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <div className="mb-3 flex items-center gap-2">
              <h3 className="text-sm font-semibold text-[#101828]">Indicators</h3>
              <Link to={`/me-dashboard/indicators?framework=${frameworkId}`} className="text-xs font-medium text-[#5B3FD0] hover:underline">
                Open indicators
              </Link>
            </div>
            <ul className="space-y-2 text-sm text-[#475467]">
              <li>There {stats.connected === 1 ? "is" : "are"} <strong className="text-[#101828]">{stats.connected} {stats.connected === 1 ? "indicator" : "indicators"}</strong> connected to project results.</li>
              <li>There {stats.unconnected === 1 ? "is" : "are"} <strong className="text-[#101828]">{stats.unconnected} {stats.unconnected === 1 ? "indicator" : "indicators"}</strong> not connected to project results.</li>
              <li><strong className="text-[#101828]">{stats.approved}</strong> {stats.approved === 1 ? "indicator has" : "indicators have"} approved values.</li>
              <li><strong className="text-[#101828]">{stats.awaiting}</strong> {stats.awaiting === 1 ? "value is" : "values are"} awaiting approval.</li>
            </ul>
          </div>
        </div>
      </section>
    </Page>
  );
}


function Projects() {
  const [params, setParams] = useSearchParams();
  const projectId = params.get("project");

  if (projectId) {
    return <ProjectView key={projectId} frameworkId={projectId} onBack={() => setParams({})} />;
  }
  return <ProjectList onOpen={(id) => setParams({ project: id })} />;
}

export default Projects;
