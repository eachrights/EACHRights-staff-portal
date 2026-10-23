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

const DAY = 86400000;

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

/* How far through its dates a project is, with a short plain label */
function timeInfo(f, now) {
  const start = time(f.startDate);
  const end = time(f.endDate);
  if (start === null || end === null || end <= start) return null;
  const pct = Math.min(100, Math.max(0, Math.round(((now - start) / (end - start)) * 100)));
  const label =
    now < start
      ? `Starts in ${Math.ceil((start - now) / DAY)} days`
      : now > end
        ? "Ended"
        : `${Math.max(0, Math.ceil((end - now) / DAY))} days left`;
  return { pct, label };
}

const DOT = { current: "#1F7A5C", upcoming: "#D4A600", past: "#98A2B3" };
const LABEL = { current: "Current", upcoming: "Upcoming", past: "Previous" };
const RANK = { current: 0, upcoming: 1, past: 2 };

const SORTS = {
  state: "Current first",
  newest: "Newest start date",
  oldest: "Oldest start date",
  name: "Name (A to Z)",
  ending: "Ending soonest",
};

/* ---------- Small shared pieces ---------- */

function Tile({ label, value, note, color }) {
  return (
    <div className={`${CARD} p-5`}>
      <p className="text-[13px] font-medium text-[#667085]">{label}</p>
      <p className="mt-1 flex items-center gap-2 text-3xl font-semibold tracking-tight tabular-nums text-[#101828]">
        {color && <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />}
        {value}
      </p>
      {note && <p className="mt-1 text-[13px] text-[#667085]">{note}</p>}
    </div>
  );
}

function TimeBar({ info, state }) {
  if (!info) return <span className="text-xs text-[#98A2B3]">No dates set</span>;
  return (
    <div className="w-36">
      <div className="flex items-center justify-between text-[11px] text-[#667085]">
        <span>{info.label}</span>
        <span className="tabular-nums">{info.pct}%</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#EEF0F4]" aria-hidden="true">
        <div className="h-full rounded-full" style={{ width: `${info.pct}%`, backgroundColor: DOT[state] }} />
      </div>
    </div>
  );
}

function StateBadge({ state }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#344054]">
      <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: DOT[state] }} />
      {LABEL[state]}
    </span>
  );
}

/* Donut with a total in the middle */
function Donut({ segments, total, centerValue, centerLabel }) {
  const size = 150;
  const r = 58;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="relative h-[150px] w-[150px] shrink-0">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        className="h-full w-full -rotate-90"
        role="img"
        aria-label={segments.map((s) => `${s.label}: ${s.count}`).join(", ")}
      >
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#EEF0F4" strokeWidth="18" />
        {total > 0 &&
          segments.map((s) => {
            if (s.count === 0) return null;
            const dash = Math.max((s.count / total) * c - 2, 0);
            const el = (
              <circle
                key={s.key}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth="18"
                strokeDasharray={`${dash} ${c - dash}`}
                strokeDashoffset={-offset}
              >
                <title>{`${s.label}: ${s.count}`}</title>
              </circle>
            );
            offset += (s.count / total) * c;
            return el;
          })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-2xl font-semibold tabular-nums text-[#101828]">{centerValue}</span>
        <span className="max-w-[80px] text-[11px] leading-tight text-[#667085]">{centerLabel}</span>
      </div>
    </div>
  );
}

/* ---------- Project list ---------- */

function ProjectList({ onOpen }) {
  const [frameworks, setFrameworks] = useState(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState("all");
  const [areaFilter, setAreaFilter] = useState("");
  const [sortBy, setSortBy] = useState("state");
  const [layout, setLayout] = useState("table");
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

  /* Every project with its state, before any filter is applied */
  const all = useMemo(() => {
    if (!frameworks) return [];
    const now = Date.now();
    return frameworks.map((f) => ({
      f,
      state: stateOf(f, now),
      info: timeInfo(f, now),
      start: time(f.startDate) ?? time(f.createdAt) ?? 0,
      end: time(f.endDate),
    }));
  }, [frameworks]);

  const counts = useMemo(
    () => ({
      all: all.length,
      current: all.filter((p) => p.state === "current").length,
      upcoming: all.filter((p) => p.state === "upcoming").length,
      past: all.filter((p) => p.state === "past").length,
    }),
    [all]
  );

  /* Thematic areas that actually have projects */
  const areaOptions = useMemo(() => [...new Set(all.map((p) => p.f.area).filter(Boolean))], [all]);

  const projects = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = all.filter(
      (p) =>
        (!q || p.f.name.toLowerCase().includes(q)) &&
        (stateFilter === "all" || p.state === stateFilter) &&
        (!areaFilter || p.f.area === areaFilter)
    );
    const by = {
      state: (a, b) => RANK[a.state] - RANK[b.state] || b.start - a.start,
      newest: (a, b) => b.start - a.start,
      oldest: (a, b) => a.start - b.start,
      name: (a, b) => a.f.name.localeCompare(b.f.name),
      ending: (a, b) => (a.end ?? Infinity) - (b.end ?? Infinity),
    };
    return [...list].sort(by[sortBy]);
  }, [all, query, stateFilter, areaFilter, sortBy]);

  const pills = [
    ["all", "All"],
    ["current", "Current"],
    ["upcoming", "Upcoming"],
    ["past", "Previous"],
  ];
  const filtered = stateFilter !== "all" || areaFilter || query.trim();
  const missingDates = frameworks && frameworks.length > 0 && frameworks.some((f) => !f.startDate || !f.endDate);

  return (
    <Page>
      <PageHead title="Projects" subtitle="All projects, from current to previous.">
        {isAdmin && (
          <Link to="/me-dashboard/frameworks" className={BTN}>+ Add new project</Link>
        )}
      </PageHead>

      <ErrorBar error={error} />

      {/* Summary */}
      {frameworks && (
        <section aria-label="Project summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Tile label="All projects" value={counts.all} note="Across every thematic area" />
          <Tile label="Current" value={counts.current} color={DOT.current} note="Running today" />
          <Tile label="Upcoming" value={counts.upcoming} color={DOT.upcoming} note="Not started yet" />
          <Tile label="Previous" value={counts.past} color={DOT.past} note="Already ended" />
        </section>
      )}

      {missingDates && (
        <p className="rounded-lg border border-[#F4D9C6] bg-[#FDF1E8] px-4 py-2.5 text-[13px] text-[#9A5410]">
          Some projects have no start or end date, theme or other details, so they all count as current.
          {isAdmin
            ? " Open a project and choose Edit details to fill them in."
            : " Ask the administrator to fill them in."}
        </p>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-1.5">
          {pills.map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={stateFilter === id}
              onClick={() => setStateFilter(id)}
              className={`rounded-full px-3.5 py-1.5 text-[13px] font-medium transition ${
                stateFilter === id ? "bg-[#EDE9FB] text-[#5B3FD0]" : "text-[#475467] ring-1 ring-inset ring-[#E5E7EB] hover:bg-[#F4F5F7]"
              }`}
            >
              {label} <span className="ml-1 tabular-nums opacity-70">{counts[id]}</span>
            </button>
          ))}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <input className={`${FIELD} w-56`} placeholder="Search projects" aria-label="Search projects" value={query} onChange={(e) => setQuery(e.target.value)} />
          <select aria-label="Thematic area" className={FIELD} value={areaFilter} onChange={(e) => setAreaFilter(e.target.value)}>
            <option value="">All thematic areas</option>
            {areaOptions.map((slug) => (
              <option key={slug} value={slug}>{areaName(slug)}</option>
            ))}
          </select>
          <select aria-label="Sort projects" className={FIELD} value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            {Object.entries(SORTS).map(([id, label]) => (
              <option key={id} value={id}>{label}</option>
            ))}
          </select>
          <div role="group" aria-label="Layout" className="inline-flex overflow-hidden rounded-lg border border-[#D0D5DD] bg-white">
            {[["table", "Table"], ["cards", "Cards"]].map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={layout === id}
                onClick={() => setLayout(id)}
                className={`px-3 py-2 text-sm font-medium transition ${layout === id ? "bg-[#EDE9FB] text-[#5B3FD0]" : "text-[#475467] hover:bg-[#F4F5F7]"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {filtered && frameworks && (
        <p className="text-[13px] text-[#667085]">
          Showing {projects.length} of {counts.all}.{" "}
          <button
            type="button"
            className="font-medium text-[#5B3FD0] hover:underline"
            onClick={() => {
              setQuery("");
              setStateFilter("all");
              setAreaFilter("");
            }}
          >
            Clear filters
          </button>
        </p>
      )}

      {!frameworks && !error && <p className="py-10 text-center text-[#98A2B3]">Loading projects...</p>}

      {frameworks && projects.length === 0 && (
        <div className={`${CARD} px-6 py-12 text-center`}>
          <p className="text-sm font-medium text-[#101828]">No projects found</p>
          <p className="mt-1 text-sm text-[#667085]">Try a different search or clear the filters.</p>
        </div>
      )}

      {frameworks && projects.length > 0 && layout === "table" && (
        <section className={`${CARD} overflow-x-auto`} aria-label="Projects">
          <table className="w-full min-w-[900px] text-left text-sm">
            <caption className="sr-only">Projects</caption>
            <thead>
              <tr className="bg-[#F9FAFB] text-xs font-medium text-[#667085]">
                <th scope="col" className="px-5 py-3">Name</th>
                <th scope="col" className="px-3 py-3">Thematic area</th>
                <th scope="col" className="px-3 py-3">Theme</th>
                <th scope="col" className="px-3 py-3">Start date</th>
                <th scope="col" className="px-3 py-3">End date</th>
                <th scope="col" className="px-3 py-3">Time elapsed</th>
                <th scope="col" className="px-5 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {projects.map(({ f, state, info }) => (
                <tr key={f.id} className="border-t border-[#F2F4F7] transition hover:bg-[#FAFAFC]">
                  <td className="px-5 py-3">
                    <button type="button" onClick={() => onOpen(f.id)} className="text-left font-medium text-[#5B3FD0] hover:underline">
                      {f.name}
                    </button>
                  </td>
                  <td className="px-3 py-3 text-[#475467]">{areaName(f.area)}</td>
                  <td className="px-3 py-3 text-[#475467]">{[f.theme, f.focusArea].filter(Boolean).join(", ") || "-"}</td>
                  <td className="px-3 py-3 text-[#475467]">{fmtDate(f.startDate)}</td>
                  <td className="px-3 py-3 text-[#475467]">{fmtDate(f.endDate)}</td>
                  <td className="px-3 py-3"><TimeBar info={info} state={state} /></td>
                  <td className="px-5 py-3"><StateBadge state={state} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {frameworks && projects.length > 0 && layout === "cards" && (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Projects">
          {projects.map(({ f, state, info }) => (
            <li key={f.id}>
              <button
                type="button"
                onClick={() => onOpen(f.id)}
                className={`${CARD} flex h-full w-full flex-col p-5 text-left transition hover:-translate-y-0.5 hover:shadow-md motion-reduce:hover:translate-y-0`}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="text-[15px] font-semibold leading-5 text-[#101828]">{f.name}</span>
                  <StateBadge state={state} />
                </div>
                <p className="mt-1.5 text-[13px] text-[#667085]">{areaName(f.area)}</p>
                {[f.theme, f.focusArea].filter(Boolean).length > 0 && (
                  <p className="mt-0.5 text-xs text-[#98A2B3]">{[f.theme, f.focusArea].filter(Boolean).join(", ")}</p>
                )}
                <div className="mt-auto pt-5">
                  <TimeBar info={info} state={state} />
                  <p className="mt-2 text-xs text-[#667085]">
                    {fmtDate(f.startDate)} to {fmtDate(f.endDate)}
                  </p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
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
const daysBetween = (a, b) => Math.round((b - a) / DAY) + 1;
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

function SectionHead({ title, subtitle }) {
  return (
    <div className="mb-4">
      <h2 className="text-base font-semibold leading-6 text-[#101828]">{title}</h2>
      {subtitle && <p className="text-[13px] text-[#667085]">{subtitle}</p>}
    </div>
  );
}

/* Stacked columns: per reporting period, approved / awaiting / not yet reported */
const STACK = [
  { key: "approved", label: "Approved", color: "#1F7A5C" },
  { key: "awaiting", label: "Awaiting approval", color: "#D4A600" },
  { key: "missing", label: "Not reported", color: "#D9D9DF" },
];

function PeriodColumns({ groups }) {
  const max = Math.max(1, ...groups.map((g) => g.total));
  if (groups.every((g) => g.total === 0)) {
    return <p className="py-12 text-center text-sm text-[#667085]">No indicator targets have been set for these periods yet.</p>;
  }
  return (
    <>
      <div className="flex h-44 items-end justify-around gap-3 border-b border-[#EEF0F4] px-2">
        {groups.map((g) => (
          <div
            key={g.period}
            className="flex h-full w-full max-w-[72px] flex-col justify-end"
            title={`${g.period}: ${g.approved} approved, ${g.awaiting} awaiting approval, ${g.missing} not reported`}
          >
            <p className="mb-1 text-center text-xs font-semibold tabular-nums text-[#344054]">{g.total}</p>
            <div className="flex flex-col-reverse overflow-hidden rounded-t-md" style={{ height: `${(g.total / max) * 85}%` }}>
              {STACK.map((s) =>
                g[s.key] > 0 ? <div key={s.key} style={{ height: `${(g[s.key] / g.total) * 100}%`, backgroundColor: s.color }} /> : null
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-around gap-3 px-2">
        {groups.map((g) => (
          <p key={g.period} className="w-full max-w-[72px] truncate text-center text-xs text-[#667085]">{g.period}</p>
        ))}
      </div>
      <ul className="mt-4 flex flex-wrap justify-center gap-x-5 gap-y-1 text-xs text-[#475467]">
        {STACK.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[3px]" style={{ backgroundColor: s.color }} />
            {s.label}
          </li>
        ))}
      </ul>
    </>
  );
}

/* ---------- Edit a project's details (administrator) ---------- */

const splitList = (s) => s.split(",").map((v) => v.trim()).filter(Boolean);

function DetailsEditor({ fw, frameworkId, onSaved, onCancel }) {
  const [form, setForm] = useState({
    donor: fw.donor || "",
    theme: fw.theme || "",
    focusArea: fw.focusArea || "",
    partner: fw.partner || "",
    region: fw.region || "",
    startDate: fw.startDate || "",
    endDate: fw.endDate || "",
    budget: fw.budget ?? "",
    currency: fw.currency || "",
    description: fw.description || "",
    countries: (fw.countries || []).join(", "),
    team: (fw.team || []).join(", "),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const save = async () => {
    setError("");
    if (form.startDate && form.endDate && form.endDate < form.startDate) {
      return setError("The end date cannot be before the start date.");
    }
    if (form.budget !== "" && (Number.isNaN(Number(form.budget)) || Number(form.budget) < 0)) {
      return setError("The budget must be a number, zero or more.");
    }
    setBusy(true);
    try {
      /* Theme, focus area, partner and region are always sent together, so none is cleared by accident */
      await api(`/me/frameworks/${frameworkId}/details`, {
        method: "PUT",
        body: {
          donor: form.donor.trim(),
          theme: form.theme.trim(),
          focusArea: form.focusArea.trim(),
          partner: form.partner.trim(),
          region: form.region.trim(),
          startDate: form.startDate,
          endDate: form.endDate,
          budget: form.budget === "" ? "" : Number(form.budget),
          currency: form.currency.trim(),
          description: form.description.trim(),
          countries: splitList(form.countries),
          team: splitList(form.team),
        },
      });
      await onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const Field = ({ label, children, wide = false }) => (
    <label className={`block text-xs font-medium text-[#667085] ${wide ? "sm:col-span-2" : ""}`}>
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );

  return (
    <section className={`${CARD} p-6`} aria-label="Edit project details">
      <SectionHead title="Edit project details" subtitle="Dates decide whether a project is current, upcoming or previous." />
      <ErrorBar error={error} />
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <Field label="Start date"><input type="date" className={`${FIELD} w-full`} value={form.startDate} onChange={set("startDate")} /></Field>
        <Field label="End date"><input type="date" className={`${FIELD} w-full`} value={form.endDate} onChange={set("endDate")} /></Field>
        <Field label="Theme"><input className={`${FIELD} w-full`} value={form.theme} onChange={set("theme")} placeholder="For example Health" /></Field>
        <Field label="Focus area"><input className={`${FIELD} w-full`} value={form.focusArea} onChange={set("focusArea")} placeholder="For example Gender" /></Field>
        <Field label="Donor"><input className={`${FIELD} w-full`} value={form.donor} onChange={set("donor")} /></Field>
        <Field label="Partner"><input className={`${FIELD} w-full`} value={form.partner} onChange={set("partner")} /></Field>
        <Field label="Region"><input className={`${FIELD} w-full`} value={form.region} onChange={set("region")} /></Field>
        <div className="grid grid-cols-[1fr_6rem] gap-3">
          <Field label="Budget"><input type="number" min="0" className={`${FIELD} w-full`} value={form.budget} onChange={set("budget")} /></Field>
          <Field label="Currency"><input className={`${FIELD} w-full`} value={form.currency} onChange={set("currency")} placeholder="USD" maxLength={8} /></Field>
        </div>
        <Field label="Countries (separate with commas)" wide><input className={`${FIELD} w-full`} value={form.countries} onChange={set("countries")} placeholder="Kenya, Uganda" /></Field>
        <Field label="Project team (names or emails, separated with commas)" wide><input className={`${FIELD} w-full`} value={form.team} onChange={set("team")} /></Field>
        <Field label="Description" wide><textarea rows={3} maxLength={500} className={`${FIELD} w-full`} value={form.description} onChange={set("description")} /></Field>
      </div>
      <div className="mt-5 flex gap-2">
        <button type="button" onClick={save} disabled={busy} className={BTN}>{busy ? "Saving..." : "Save details"}</button>
        <button type="button" onClick={onCancel} disabled={busy} className={BTN_LIGHT}>Cancel</button>
      </div>
    </section>
  );
}

function ProjectView({ frameworkId, onBack }) {
  const [data, setData] = useState(null);
  const [updates, setUpdates] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [choice, setChoice] = useState("");
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState(false);
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
      setError("No project was chosen.");
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
    const approvedIds = new Set(data.values.filter((v) => v.status === "approved").map((v) => v.indicatorId));
    const awaitingValues = data.values.filter((v) => v.status === "submitted");
    const awaitingIds = new Set(awaitingValues.map((v) => v.indicatorId));
    /* Awaiting only counts indicators that have nothing approved yet */
    const awaitingOnly = [...awaitingIds].filter((id) => !approvedIds.has(id)).length;
    const perResult = new Map();
    for (const i of data.indicators) perResult.set(i.resultId, (perResult.get(i.resultId) || 0) + 1);
    const total = data.indicators.length;
    return {
      connected,
      unconnected: total - connected,
      approved: approvedIds.size,
      awaiting: awaitingValues.length,
      awaitingOnly,
      noData: Math.max(total - approvedIds.size - awaitingOnly, 0),
      perResult,
    };
  }, [data]);

  /* Per reporting period: indicators with a target, and how many are approved / awaiting / missing */
  const periodGroups = useMemo(() => {
    if (!data) return [];
    return data.framework.periods.map((p) => {
      const expected = data.indicators.filter((i) => i.targets?.[p] !== undefined);
      const valueOf = (i) => data.values.find((v) => v.indicatorId === i.id && v.period === p);
      const approved = expected.filter((i) => valueOf(i)?.status === "approved").length;
      const awaiting = expected.filter((i) => valueOf(i)?.status === "submitted").length;
      return { period: p, total: expected.length, approved, awaiting, missing: expected.length - approved - awaiting };
    });
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

  const now = Date.now();
  const state = stateOf(fw, now);
  const info = timeInfo(fw, now);

  const donutSegments = [
    { key: "approved", label: "Approved values", color: "#1F7A5C", count: stats.approved },
    { key: "awaiting", label: "Awaiting approval", color: "#D4A600", count: stats.awaitingOnly },
    { key: "none", label: "No value yet", color: "#D9D9DF", count: stats.noData },
  ];
  const totalIndicators = data.indicators.length;
  const coveragePct = totalIndicators ? Math.round((stats.approved / totalIndicators) * 100) : 0;

  return (
    <Page>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={onBack} className="text-sm font-medium text-[#5B3FD0] hover:underline">
          &larr; All projects
        </button>
        {access.isAdmin && !editing && (
          <button type="button" onClick={() => setEditing(true)} className={BTN_LIGHT}>Edit details</button>
        )}
      </div>

      <ErrorBar error={error} />

      {editing && (
        <DetailsEditor
          fw={fw}
          frameworkId={frameworkId}
          onCancel={() => setEditing(false)}
          onSaved={async () => {
            await load();
            setEditing(false);
          }}
        />
      )}

      {/* Header card */}
      <section className={`${CARD} p-6`} aria-label="Project overview">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-[#101828]">Project: {fw.name}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-3">
              <StateBadge state={state} />
              {info && <span className="text-[13px] text-[#667085]">{info.label}</span>}
            </div>
          </div>
          {current && (
            <span className="rounded-md px-3 py-1 text-xs font-semibold" style={{ background: statusOf(current.status).soft, color: statusOf(current.status).fg }}>
              {statusOf(current.status).label}
            </span>
          )}
        </div>

        {info && (
          <div className="mt-4">
            <div className="flex justify-between text-[11px] text-[#667085]">
              <span>{fmtLong(fw.startDate)}</span>
              <span>{info.pct}% of the project time has passed</span>
              <span>{fmtLong(fw.endDate)}</span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-[#EEF0F4]" role="img" aria-label={`${info.pct}% of project time has passed`}>
              <div className="h-full rounded-full" style={{ width: `${info.pct}%`, backgroundColor: DOT[state] }} />
            </div>
          </div>
        )}

        <div className="mt-5 grid gap-x-10 gap-y-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
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
                  <summary className="cursor-pointer text-sm font-medium text-[#5B3FD0]">Status history ({latest.length - 1} earlier)</summary>
                  <ol className="mt-3 space-y-0 border-l-2 border-[#EAECF0] pl-4">
                    {latest.slice(1).map((u) => (
                      <li key={u.id || u.at} className="relative pb-4 last:pb-0">
                        <span
                          aria-hidden="true"
                          className="absolute -left-[23px] top-1 h-3 w-3 rounded-full border-2 border-white"
                          style={{ backgroundColor: statusOf(u.status).bg }}
                        />
                        <p className="text-xs text-[#667085]">{u.by} · {fmtStamp(u.at)}</p>
                        <p className="mt-0.5 text-sm">
                          <span className="mr-2 rounded px-1.5 py-0.5 text-[11px] font-semibold" style={{ background: statusOf(u.status).soft, color: statusOf(u.status).fg }}>
                            {statusOf(u.status).label}
                          </span>
                          {u.message}
                        </p>
                      </li>
                    ))}
                  </ol>
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

      {/* Key numbers */}
      <section aria-label="Key numbers" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label="Results" value={data.results.length} note="In the project logic" />
        <Tile label="Indicators" value={totalIndicators} note={`${stats.connected} connected to results`} />
        <Tile label="With approved values" value={`${stats.approved} of ${totalIndicators}`} note={`${coveragePct}% coverage`} color="#1F7A5C" />
        <Tile
          label="Awaiting approval"
          value={stats.awaiting}
          note={access.isAdmin ? (stats.awaiting ? "Ready for your review" : "Nothing to review") : "With the administrator"}
          color={stats.awaiting ? "#D4A600" : undefined}
        />
      </section>

      {/* Charts */}
      <div className="grid gap-5 lg:grid-cols-2">
        <section className={`${CARD} p-6`} aria-label="Indicator coverage">
          <SectionHead title="Indicator coverage" subtitle="How many indicators have approved values" />
          <div className="flex flex-wrap items-center gap-8">
            <Donut segments={donutSegments} total={totalIndicators} centerValue={`${coveragePct}%`} centerLabel="have approved values" />
            <ul className="min-w-[180px] flex-1 space-y-2.5">
              {donutSegments.map((s) => (
                <li key={s.key} className="flex items-center gap-2.5 text-sm text-[#475467]">
                  <span aria-hidden="true" className="h-3 w-3 rounded-[4px]" style={{ backgroundColor: s.color }} />
                  {s.label}
                  <span className="ml-auto font-semibold tabular-nums text-[#101828]">{s.count}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className={`${CARD} p-6`} aria-label="Reporting by period">
          <SectionHead title="Reporting by period" subtitle="Indicators with a target, and where each stands" />
          <PeriodColumns groups={periodGroups} />
        </section>
      </div>

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
