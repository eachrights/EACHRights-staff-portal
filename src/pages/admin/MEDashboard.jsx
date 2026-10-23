import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { DEPARTMENT_AREAS, PROGRAM_AREAS, getAccess } from "../../access";
import { api, downloadCsv } from "../../meApi";
import PortfolioView from "./PortfolioView";

/* Design tokens. White surfaces on a quiet page, purple as the single brand colour,
   green / amber / red reserved for status. */
const PURPLE = "#5B3FD0";
const PURPLE_LIGHT = "#EDE9FB";
const SOFT = "#98A2B3";

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5B3FD0]";
const FIELD = `rounded-lg border border-[#D0D5DD] bg-white px-3 py-2 text-sm text-[#101828] outline-none transition placeholder:text-[#98A2B3] focus:border-[#5B3FD0] focus:ring-4 focus:ring-[#5B3FD0]/15 disabled:cursor-not-allowed disabled:bg-[#F4F5F7] disabled:text-[#667085]`;
const BTN = `rounded-lg bg-[#5B3FD0] px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-[#4A31B8] disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS}`;
const BTN_LIGHT = `rounded-lg border border-[#D0D5DD] bg-white px-3.5 py-2 text-sm font-semibold text-[#344054] transition hover:bg-[#F4F5F7] disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS}`;
const BTN_SM = `rounded-md bg-[#5B3FD0] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#4A31B8] disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS}`;
const BTN_SM_LIGHT = `rounded-md border border-[#D0D5DD] bg-white px-3 py-1.5 text-xs font-semibold text-[#344054] transition hover:bg-[#F4F5F7] disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS}`;
const CARD = "rounded-xl border border-[#E5E7EB] bg-white";
const FONT = { fontFamily: '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif' };

const ALL_AREAS = [...PROGRAM_AREAS, ...DEPARTMENT_AREAS];

/* Progress against target, from approved values only */
const PROGRESS = {
  on: { label: "On track", color: "#1F7A5C" },
  risk: { label: "At risk", color: "#D4A600" },
  off: { label: "Off track", color: "#B42318" },
  none: { label: "No data", color: "#D9D9DF" },
};

/* Where a reported value is in the approval workflow */
const REVIEW = {
  submitted: { label: "Awaiting approval", cls: "bg-[#FBF3D0] text-[#7A5C00]" },
  rejected: { label: "Rejected", cls: "bg-red-50 text-red-700" },
  approved: { label: "Approved", cls: "bg-[#E1F1EB] text-[#1F7A5C]" },
  none: { label: "Not reported", cls: "bg-[#F2F4F7] text-[#667085]" },
};

/* Heatmap bands, light to dark purple */
const HEAT = [
  { min: 90, label: "90% and above", bg: PURPLE, fg: "#FFFFFF" },
  { min: 70, label: "70 to 89%", bg: "#9C87EA", fg: "#FFFFFF" },
  { min: 50, label: "50 to 69%", bg: "#D5CCF6", fg: "#2E1F7A" },
  { min: 0, label: "Below 50%", bg: "#EDE9FB", fg: "#2E1F7A" },
];
const heatOf = (pct) => HEAT.find((h) => pct >= h.min) || HEAT[HEAT.length - 1];

/* Placeholder content so there is something to edit later */
const SAMPLE = {
  framework: {
    name: "Sample: Community health rights project",
    donor: "Sample donor",
    area: "health-justice",
    periods: ["2026-Q1", "2026-Q2", "2026-Q3", "2026-Q4"],
  },
  goal: "Communities can claim their right to health",
  outcome: "Women report better access to health services",
  output: "Community members trained on health rights",
  indicators: [
    { on: "outcome", name: "Percentage of women reporting improved access to services", unit: "%", baseline: 20, targets: { "2026-Q2": 25, "2026-Q4": 40 }, mov: "Annual household survey", assumptions: "Clinics stay open and staffed" },
    { on: "output", name: "Number of people trained", unit: "people", baseline: 0, targets: { "2026-Q1": 50, "2026-Q2": 50, "2026-Q3": 50, "2026-Q4": 50 }, mov: "Training attendance sheets", assumptions: "Communities attend sessions" },
  ],
};

const progressOf = (pct) => (pct === null ? "none" : pct >= 90 ? "on" : pct >= 50 ? "risk" : "off");
const fmt = (n) => (n === undefined || n === null || n === "" ? "-" : Number(n).toLocaleString());

function orderResults(results) {
  const children = new Map();
  for (const r of results) {
    const key = r.parentId || "";
    if (!children.has(key)) children.set(key, []);
    children.get(key).push(r);
  }
  for (const list of children.values()) {
    list.sort((a, b) => a.level - b.level || a.createdAt.localeCompare(b.createdAt));
  }
  const ordered = [];
  const visit = (key, depth) => {
    for (const r of children.get(key) || []) {
      ordered.push({ ...r, depth });
      visit(r.id, depth + 1);
    }
  };
  visit("", 0);
  return ordered;
}

/* ---------- Building blocks ---------- */

function SectionHead({ title, subtitle }) {
  return (
    <div className="mb-4">
      <h2 className="text-[15px] font-semibold leading-6 text-[#101828]">{title}</h2>
      {subtitle && <p className="text-[13px] leading-5 text-[#667085]">{subtitle}</p>}
    </div>
  );
}

/* The four headline numbers share one panel, separated by rules */
function StatStrip({ stats }) {
  return (
    <dl className={`${CARD} grid divide-y divide-[#EEF0F4] sm:grid-cols-2 sm:divide-y-0 xl:grid-cols-4 xl:divide-x`}>
      {stats.map((s) => (
        <div key={s.label} className="p-5 sm:[&:nth-child(n+3)]:border-t sm:[&:nth-child(n+3)]:border-[#EEF0F4] xl:[&:nth-child(n+3)]:border-t-0">
          <dt className="text-[13px] font-medium text-[#667085]">{s.label}</dt>
          <dd className="mt-1 text-[28px] font-semibold leading-9 tracking-tight tabular-nums text-[#101828]">{s.value}</dd>
          {s.bar && (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#EEF0F4]" aria-hidden="true">
              <div className="h-full rounded-full" style={{ width: `${Math.min(s.bar.pct, 100)}%`, backgroundColor: s.bar.color }} />
            </div>
          )}
          <p className={`mt-2 text-[13px] ${s.tone || "text-[#667085]"}`}>{s.note}</p>
        </div>
      ))}
    </dl>
  );
}

function ViewTabs({ view, onChange }) {
  return (
    <div role="tablist" aria-label="View" className="inline-flex rounded-lg border border-[#E5E7EB] bg-white p-1">
      {[["project", "Project view"], ["portfolio", "Portfolio view"]].map(([id, label]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={view === id}
          onClick={() => onChange(id)}
          className={`rounded-md px-3.5 py-1.5 text-sm font-medium transition ${FOCUS} ${
            view === id ? "bg-[#EDE9FB] text-[#5B3FD0]" : "text-[#475467] hover:bg-[#F4F5F7]"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Skeleton() {
  return (
    <div aria-busy="true" aria-label="Loading dashboard" className="space-y-4">
      <div className={`${CARD} h-28 animate-pulse bg-[#F9FAFB] motion-reduce:animate-none`} />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className={`${CARD} h-56 animate-pulse bg-[#F9FAFB] motion-reduce:animate-none`} />
        <div className={`${CARD} h-56 animate-pulse bg-[#F9FAFB] motion-reduce:animate-none`} />
      </div>
    </div>
  );
}

/* Line + soft area, average % of target per period (approved values only) */
function TrendChart({ points }) {
  const W = 420, H = 190, L = 38, R = 12, T = 12, B = 26;
  const known = points.filter((p) => p.pct !== null);
  if (known.length === 0) {
    return <p className="py-14 text-center text-sm text-[#667085]">No approved values yet. Results appear here once values are approved.</p>;
  }
  const yMax = Math.max(100, Math.ceil(Math.max(...known.map((p) => p.pct)) / 25) * 25);
  const x = (i) => (points.length === 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (points.length - 1));
  const y = (v) => T + (1 - v / yMax) * (H - T - B);
  const pts = points.map((p, i) => (p.pct === null ? null : { x: x(i), y: y(p.pct), ...p }));
  const seq = pts.filter(Boolean);
  const line = seq.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ");
  const area = `${line} L${seq[seq.length - 1].x},${y(0)} L${seq[0].x},${y(0)} Z`;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(yMax * t));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Average achievement against target by period">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="#EEF0F4" />
          <text x={L - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill={SOFT}>{t}%</text>
        </g>
      ))}
      <path d={area} fill={PURPLE_LIGHT} opacity="0.7" />
      <path d={line} fill="none" stroke={PURPLE} strokeWidth="2" strokeLinejoin="round" />
      {seq.map((p) => (
        <circle key={p.period} cx={p.x} cy={p.y} r="3.5" fill="#fff" stroke={PURPLE} strokeWidth="2">
          <title>{`${p.period}: ${p.pct}%`}</title>
        </circle>
      ))}
      {points.map((p, i) => (
        <text key={p.period} x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fill={SOFT}>{p.period}</text>
      ))}
    </svg>
  );
}

/* Stacked columns: how many indicators per level are approved, awaiting, or not reported */
const STACK = [
  { key: "approved", label: "Approved", color: "#1F7A5C" },
  { key: "awaiting", label: "Awaiting approval", color: "#D4A600" },
  { key: "missing", label: "Not reported", color: "#DDDDE0" },
];

function StackedColumns({ groups }) {
  if (groups.length === 0) {
    return <p className="py-14 text-center text-sm text-[#667085]">No indicators have a target this period.</p>;
  }
  const max = Math.max(...groups.map((g) => g.total));
  return (
    <>
      <div className="flex h-44 items-end justify-around gap-4 border-b border-[#EEF0F4] px-2">
        {groups.map((g) => (
          <div
            key={g.name}
            className="flex h-full w-full max-w-[72px] flex-col justify-end"
            title={`${g.name}: ${g.approved} approved, ${g.awaiting} awaiting approval, ${g.missing} not reported`}
          >
            <div className="flex flex-col-reverse overflow-hidden rounded-t-md" style={{ height: `${(g.total / max) * 100}%` }}>
              {STACK.map((s) =>
                g[s.key] > 0 ? <div key={s.key} style={{ height: `${(g[s.key] / g.total) * 100}%`, backgroundColor: s.color }} /> : null
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-around gap-4 px-2">
        {groups.map((g) => (
          <p key={g.name} className="w-full max-w-[72px] truncate text-center text-xs text-[#667085]" title={g.name}>
            {g.name}
          </p>
        ))}
      </div>
      <ul className="mt-4 flex flex-wrap justify-center gap-x-5 gap-y-1 text-xs text-[#475467]">
        {STACK.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span aria-hidden="true" className="h-2 w-2 rounded-[3px]" style={{ backgroundColor: s.color }} />
            {s.label}
          </li>
        ))}
      </ul>
    </>
  );
}

/* ---------- Page ---------- */

function MEDashboard() {
  const [access, setAccess] = useState({ isAdmin: false, departments: new Set() });
  const [frameworks, setFrameworks] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [data, setData] = useState(null);
  const [period, setPeriod] = useState("");
  const [resultFilter, setResultFilter] = useState("");
  const [drafts, setDrafts] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [view, setView] = useState("project");
  const [strategic, setStrategic] = useState([]);

  useEffect(() => {
    let mounted = true;
    getAccess().then((r) => mounted && setAccess(r)).catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const loadList = useCallback(async (selectId) => {
    const { frameworks: list } = await api("/me/frameworks");
    setFrameworks(list);
    setSelectedId((cur) => selectId || cur || list[0]?.id || "");
  }, []);

  const loadFramework = useCallback(async (id) => {
    if (!id) return setData(null);
    const loaded = await api(`/me/frameworks/${id}`);
    setData(loaded);
    setPeriod((cur) => (loaded.framework.periods.includes(cur) ? cur : loaded.framework.periods[0]));
  }, []);

  /* `success` is the confirmation shown when the task finishes without an error */
  const run = async (task, success) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
      if (success) setNotice(success);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    run(() => loadList());
  }, [loadList]);

  useEffect(() => {
    setDrafts({});
    setResultFilter("");
    run(() => loadFramework(selectedId));
  }, [selectedId, loadFramework]);

  // Unsaved entries belong to one period, so they are dropped when the period changes
  useEffect(() => {
    setDrafts({});
  }, [period]);

  const { isAdmin } = access;

  /* The programmes this person belongs to (their "dept-<slug>" groups) */
  const myProgrammes = ALL_AREAS.filter((a) => access.departments.has(a.slug));

  useEffect(() => {
    if (!isAdmin) return;
    api("/me/strategic")
      .then((result) => setStrategic(result.strategic))
      .catch(() => {});
  }, [isAdmin, view]);

  const fw = data?.framework;
  const canEnter = Boolean(fw) && (isAdmin || access.departments.has(fw.area));
  const ordered = useMemo(() => (data ? orderResults(data.results) : []), [data]);

  /* One row per indicator for the chosen period */
  const rows = useMemo(() => {
    if (!data) return [];
    return ordered.flatMap((result) =>
      data.indicators
        .filter((ind) => ind.resultId === result.id)
        .map((ind) => {
          const saved = data.values.find((v) => v.indicatorId === ind.id && v.period === period);
          const target = ind.targets?.[period];
          const approved = saved?.status === "approved";
          const pct = approved && target ? Math.round((saved.actual / target) * 100) : null;
          return { ind, result, saved, target, pct, progress: progressOf(pct) };
        })
    );
  }, [data, ordered, period]);

  /* Selecting a result also shows everything beneath it */
  const shownRows = useMemo(() => {
    if (!resultFilter) return rows;
    const ids = new Set([resultFilter]);
    for (const r of ordered) if (ids.has(r.parentId)) ids.add(r.id);
    return rows.filter((row) => ids.has(row.result.id));
  }, [rows, ordered, resultFilter]);

  const expected = useMemo(() => rows.filter((r) => r.target !== undefined), [rows]);
  const counts = Object.fromEntries(Object.keys(PROGRESS).map((k) => [k, expected.filter((r) => r.progress === k).length]));
  const reported = expected.filter((r) => r.saved && r.saved.status !== "rejected").length;
  const awaiting = rows.filter((r) => r.saved?.status === "submitted").length;

  /* Average % of target per period, approved values only */
  const trend = useMemo(() => {
    if (!data) return [];
    return data.framework.periods.map((p) => {
      const pcts = [];
      for (const ind of data.indicators) {
        const target = ind.targets?.[p];
        const v = data.values.find((x) => x.indicatorId === ind.id && x.period === p && x.status === "approved");
        if (target && v) pcts.push(Math.round((v.actual / target) * 100));
      }
      return { period: p, pct: pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : null };
    });
  }, [data]);

  /* Reporting status per framework level, selected period */
  const levelGroups = useMemo(() => {
    if (!fw) return [];
    return (fw.levels || [])
      .map((name, i) => {
        const rs = expected.filter((r) => r.result.level === i);
        const approved = rs.filter((r) => r.saved?.status === "approved").length;
        const awaitingN = rs.filter((r) => r.saved?.status === "submitted").length;
        return { name, total: rs.length, approved, awaiting: awaitingN, missing: rs.length - approved - awaitingN };
      })
      .filter((g) => g.total > 0);
  }, [fw, expected]);

  /* Heatmap tiles: average % of target per result, selected period */
  const tiles = useMemo(() => {
    return ordered
      .map((result) => {
        const own = rows.filter((r) => r.result.id === result.id && r.target !== undefined);
        if (own.length === 0) return null;
        const known = own.filter((r) => r.pct !== null);
        const pct = known.length ? Math.round(known.reduce((a, r) => a + r.pct, 0) / known.length) : null;
        return { result, pct };
      })
      .filter(Boolean);
  }, [ordered, rows]);

  const onTrackPct = expected.length ? Math.round((counts.on / expected.length) * 100) : 0;
  const reportedPct = expected.length ? Math.round((reported / expected.length) * 100) : 0;

  const draftFor = (ind, saved) => drafts[ind.id] ?? { actual: saved?.actual ?? "", comment: saved?.comment ?? "" };
  const setDraft = (ind, saved, patch) =>
    setDrafts((cur) => ({ ...cur, [ind.id]: { ...draftFor(ind, saved), ...patch } }));

  const submitValue = (ind, saved) =>
    run(async () => {
      const draft = draftFor(ind, saved);
      if (draft.actual === "") throw new Error("Enter the actual value first.");
      await api(`/me/frameworks/${selectedId}/values`, {
        method: "PUT",
        body: { indicatorId: ind.id, period, actual: draft.actual, comment: draft.comment },
      });
      setDrafts((cur) => {
        const { [ind.id]: _gone, ...rest } = cur;
        return rest;
      });
      await loadFramework(selectedId);
    }, "Value submitted for approval.");

  const reviewValue = (ind, approve) =>
    run(async () => {
      await api(`/me/frameworks/${selectedId}/values/review`, {
        method: "POST",
        body: { indicatorId: ind.id, period, approve },
      });
      await loadFramework(selectedId);
    }, approve ? "Value approved." : "Value rejected.");

  const linkIndicator = (ind, strategicId) =>
    run(async () => {
      await api(`/me/frameworks/${selectedId}/indicators/${ind.id}/link`, {
        method: "PUT",
        body: { strategicId },
      });
      await loadFramework(selectedId);
    }, "Strategic link updated.");

  const exportFile = (format) =>
    run(() =>
      downloadCsv(
        `/me/frameworks/${selectedId}/export?format=${format}&period=${encodeURIComponent(period)}`,
        format === "logframe" ? "logframe.csv" : `results-table-${period}.csv`
      )
    );

  const loadSample = () =>
    run(async () => {
      const { id } = await api("/me/frameworks", { method: "POST", body: SAMPLE.framework });
      const post = (path, body) => api(`/me/frameworks/${id}/${path}`, { method: "POST", body });
      const goal = await post("results", { title: SAMPLE.goal, level: 0 });
      const outcome = await post("results", { title: SAMPLE.outcome, level: 1, parentId: goal.id });
      const output = await post("results", { title: SAMPLE.output, level: 2, parentId: outcome.id });
      const ids = { outcome: outcome.id, output: output.id };
      for (const { on, ...indicator } of SAMPLE.indicators) {
        await post("indicators", { ...indicator, resultId: ids[on] });
      }
      await loadList(id);
    }, "Sample framework loaded.");

  if (view === "portfolio") {
    return (
      <div className="space-y-6" style={FONT}>
        <ViewTabs view={view} onChange={setView} />
        <PortfolioView />
      </div>
    );
  }

  const stats = fw
    ? [
        { label: "Indicators", value: fmt(data.indicators.length), note: `Across ${data.results.length} ${data.results.length === 1 ? "result" : "results"}` },
        {
          label: "Reported this period",
          value: `${reported} of ${expected.length}`,
          note: "Indicators with a target",
          bar: { pct: reportedPct, color: PURPLE },
        },
        {
          label: "On track",
          value: fmt(counts.on),
          note: "At 90% of target or more",
          tone: "text-[#1F7A5C]",
          bar: { pct: onTrackPct, color: PROGRESS.on.color },
        },
        {
          label: "Awaiting approval",
          value: fmt(awaiting),
          note: isAdmin ? (awaiting ? "Ready for your review" : "Nothing to review") : "With the administrator",
          tone: awaiting ? "text-[#7A5C00]" : undefined,
        },
      ]
    : [];

  return (
    <div className="space-y-6" style={FONT}>
      {isAdmin && <ViewTabs view={view} onChange={setView} />}

      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-[#101828]">M&amp;E dashboard</h1>
          {fw ? (
            <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <div className="flex gap-1.5">
                <dt className="text-[#667085]">Donor</dt>
                <dd className="font-medium text-[#344054]">{fw.donor || "Not set"}</dd>
              </div>
              <div className="flex gap-1.5">
                <dt className="text-[#667085]">Reporting period</dt>
                <dd className="font-medium text-[#344054]">{period}</dd>
              </div>
            </dl>
          ) : (
            <p className="mt-1 text-sm text-[#667085]">Progress against indicator targets.</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {frameworks.length > 0 && (
            <select aria-label="Framework" value={selectedId} onChange={(e) => setSelectedId(e.target.value)} className={FIELD}>
              {frameworks.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          )}
          {fw && (
            <div role="group" aria-label="Export" className="inline-flex overflow-hidden rounded-lg border border-[#D0D5DD] bg-white">
              <button
                type="button"
                onClick={() => exportFile("results")}
                disabled={busy}
                className={`border-r border-[#D0D5DD] px-3.5 py-2 text-sm font-semibold text-[#344054] transition hover:bg-[#F4F5F7] disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS}`}
              >
                Export results table
              </button>
              <button
                type="button"
                onClick={() => exportFile("logframe")}
                disabled={busy}
                className={`px-3.5 py-2 text-sm font-semibold text-[#344054] transition hover:bg-[#F4F5F7] disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS}`}
              >
                Export logframe
              </button>
            </div>
          )}
          {isAdmin && frameworks.length === 0 && (
            <button type="button" onClick={loadSample} disabled={busy} className={BTN}>
              Load sample framework
            </button>
          )}
          {!isAdmin && myProgrammes.length > 0 && (
            <Link to="/me-dashboard/frameworks" className={BTN_LIGHT}>
              Manage frameworks
            </Link>
          )}
        </div>
      </header>

      <div aria-live="polite" className="space-y-2 empty:hidden">
        {error && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
            {error}
          </div>
        )}
        {notice && (
          <div role="status" className="rounded-lg border border-[#BFE3D3] bg-[#EEF8F3] px-4 py-2.5 text-sm text-[#1F7A5C]">
            {notice}
          </div>
        )}
      </div>

      {!fw && busy && <Skeleton />}

      {!fw && !busy && (
        <div className={`${CARD} px-6 py-14 text-center`}>
          <h2 className="text-[15px] font-semibold text-[#101828]">
            {isAdmin
              ? "No frameworks yet"
              : myProgrammes.length > 0
                ? "No frameworks in your programmes yet"
                : "You are not assigned to a programme yet"}
          </h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-[#667085]">
            {isAdmin
              ? "Load the sample framework to see how results and indicators fit together, then edit it to match your project."
              : myProgrammes.length > 0
                ? `Create the first framework for ${myProgrammes.map((a) => a.name).join(", ")}, then add results and indicators and start reporting.`
                : "Ask the administrator to add you to a programme. You will then see its frameworks here and can report on them."}
          </p>
          {!isAdmin && myProgrammes.length > 0 && (
            <Link to="/me-dashboard/frameworks" className={`${BTN} mt-5 inline-block`}>
              Create a framework
            </Link>
          )}
        </div>
      )}

      {fw && (
        <>
          {/* Reporting period */}
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Reporting period">
            {fw.periods.map((p) => (
              <button
                key={p}
                type="button"
                role="tab"
                aria-selected={p === period}
                onClick={() => setPeriod(p)}
                className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition ${FOCUS} ${
                  p === period ? "bg-[#EDE9FB] text-[#5B3FD0]" : "text-[#475467] hover:bg-[#F4F5F7]"
                }`}
              >
                {p}
              </button>
            ))}
          </div>

          <section aria-label="Summary">
            <StatStrip stats={stats} />
          </section>

          {/* Charts */}
          <div className="grid gap-5 lg:grid-cols-2">
            <section aria-label="Progress overview" className={`${CARD} p-6`}>
              <SectionHead title="Progress against target" subtitle={`Approved values only, ${period}`} />
              <div
                className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-[#EEF0F4]"
                role="img"
                aria-label={Object.entries(PROGRESS).map(([k, v]) => `${v.label}: ${counts[k]}`).join(", ")}
              >
                {expected.length > 0 &&
                  Object.entries(PROGRESS).map(([k, v]) =>
                    counts[k] > 0 ? (
                      <div key={k} style={{ width: `${(counts[k] / expected.length) * 100}%`, backgroundColor: v.color }} />
                    ) : null
                  )}
              </div>
              <ul className="mt-5 grid grid-cols-2 gap-x-8 gap-y-2.5 text-sm">
                {Object.entries(PROGRESS).map(([k, v]) => (
                  <li key={k} className="flex items-center gap-2 text-[#475467]">
                    <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[3px]" style={{ backgroundColor: v.color }} />
                    {v.label}
                    <span className="ml-auto font-semibold tabular-nums text-[#101828]">{counts[k]}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section aria-label="Achievement by period" className={`${CARD} p-6`}>
              <SectionHead title="Achievement by period" subtitle="Average percentage of target, approved values" />
              <TrendChart points={trend} />
            </section>

            <section aria-label="Reporting status" className={`${CARD} p-6`}>
              <SectionHead title="Reporting status by level" subtitle={`Indicators with a target, ${period}`} />
              <StackedColumns groups={levelGroups} />
            </section>

            <section aria-label="Result heatmap" className={`${CARD} p-6`}>
              <SectionHead title="Result coverage" subtitle={`Average percentage of target per result, ${period}`} />
              {tiles.length === 0 ? (
                <p className="py-14 text-center text-sm text-[#667085]">No results have a target this period.</p>
              ) : (
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                  {tiles.map(({ result, pct }) => {
                    const heat = pct === null ? { bg: "#F2F4F7", fg: "#667085" } : heatOf(pct);
                    return (
                      <button
                        key={result.id}
                        type="button"
                        onClick={() => setResultFilter(result.id)}
                        title={result.title}
                        className={`flex min-h-[68px] flex-col justify-between rounded-md p-2.5 text-left transition hover:opacity-90 ${FOCUS}`}
                        style={{ backgroundColor: heat.bg, color: heat.fg }}
                      >
                        <span className="line-clamp-2 text-[11px] font-medium leading-tight">{result.title}</span>
                        <span className="text-xs font-semibold tabular-nums">{pct === null ? "No data" : `${pct}%`}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#475467]">
                {HEAT.map((h) => (
                  <li key={h.label} className="flex items-center gap-1.5">
                    <span aria-hidden="true" className="h-2 w-2 rounded-[3px]" style={{ backgroundColor: h.bg }} />
                    {h.label}
                  </li>
                ))}
              </ul>
            </section>
          </div>

          {/* Framework tree + indicators */}
          <div className="grid gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
            <nav aria-label="Results framework" className={`${CARD} h-fit p-3`}>
              <p className="px-2 pb-2 text-[13px] font-medium text-[#667085]">Results framework</p>
              <ul className="space-y-0.5">
                {[{ id: "", title: "All results", depth: 0, level: -1 }, ...ordered].map((r) => {
                  const active = resultFilter === r.id;
                  return (
                    <li key={r.id || "all"}>
                      <button
                        type="button"
                        onClick={() => setResultFilter(r.id)}
                        aria-current={active ? "true" : undefined}
                        style={{ paddingLeft: `${10 + r.depth * 14}px` }}
                        className={`w-full rounded-lg py-2 pr-2 text-left text-[13px] transition ${FOCUS} ${
                          active ? "bg-[#EDE9FB] font-semibold text-[#5B3FD0]" : "text-[#475467] hover:bg-[#F4F5F7]"
                        }`}
                      >
                        {r.level >= 0 && (
                          <span className="block text-[11px] font-medium text-[#98A2B3]">
                            {fw.levels[r.level] ?? `Level ${r.level + 1}`}
                          </span>
                        )}
                        {r.title}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>

            <section aria-label="Indicators" className={`${CARD} overflow-hidden`}>
              <div className="px-6 pt-6">
                <SectionHead title="Indicator results" subtitle={`Targets, reported values and approval status for ${period}`} />
              </div>

              {!canEnter && (
                <p className="mx-6 mb-4 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-[13px] text-[#667085]">
                  You can view these results. Only the administrator and the owning programme can report values.
                </p>
              )}

              <div className="max-h-[70vh] overflow-auto">
                <table className="w-full min-w-[980px] text-left text-sm">
                  <caption className="sr-only">Indicator results for {period}</caption>
                  <thead>
                    <tr className="text-xs font-medium text-[#667085]">
                      {[
                        ["Indicator", "px-6 text-left"],
                        ["Baseline", "px-3 text-right"],
                        ["Target", "px-3 text-right"],
                        ["Reported value", "px-3 text-left"],
                        ["Progress", "px-3 text-left"],
                        ["Status", "px-3 text-left"],
                      ].map(([label, cls]) => (
                        <th
                          key={label}
                          scope="col"
                          className={`sticky top-0 z-10 border-y border-[#E5E7EB] bg-[#F9FAFB] py-3 ${cls}`}
                        >
                          {label}
                        </th>
                      ))}
                      <th scope="col" className="sticky top-0 z-10 border-y border-[#E5E7EB] bg-[#F9FAFB] px-6 py-3 text-right">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {shownRows.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-6 py-12 text-center text-sm text-[#667085]">
                          No indicators under this result yet.
                        </td>
                      </tr>
                    )}

                    {shownRows.map(({ ind, result, saved, target, pct, progress }) => {
                      const draft = draftFor(ind, saved);
                      const locked = saved?.status === "approved";
                      const review = REVIEW[saved?.status] ?? REVIEW.none;

                      return (
                        <tr key={ind.id} className="border-t border-[#F2F4F7] align-top transition hover:bg-[#FAFAFC]">
                          <td className="px-6 py-4">
                            <p className="max-w-sm font-medium leading-5 text-[#101828]">{ind.name}</p>
                            <p className="mt-0.5 text-xs text-[#667085]">
                              {result.title}
                              {ind.unit ? <span className="ml-2 rounded bg-[#F2F4F7] px-1.5 py-0.5 text-[11px] text-[#475467]">{ind.unit}</span> : null}
                            </p>
                            {isAdmin && strategic.length > 0 && (
                              <select
                                aria-label={`Strategic indicator for ${ind.name}`}
                                value={ind.strategicId || ""}
                                onChange={(e) => linkIndicator(ind, e.target.value)}
                                disabled={busy}
                                className={`${FIELD} mt-2 w-full max-w-xs py-1.5 text-xs`}
                              >
                                <option value="">Not linked to a strategic indicator</option>
                                {strategic.map((s) => (
                                  <option key={s.id} value={s.id}>{s.name}</option>
                                ))}
                              </select>
                            )}
                          </td>

                          <td className="px-3 py-4 text-right tabular-nums text-[#475467]">{fmt(ind.baseline)}</td>
                          <td className="px-3 py-4 text-right font-medium tabular-nums text-[#101828]">{fmt(target)}</td>

                          <td className="px-3 py-4">
                            <div className="space-y-1.5">
                              <input
                                type="number"
                                inputMode="decimal"
                                placeholder="Value"
                                aria-label={`Actual for ${ind.name}`}
                                value={draft.actual}
                                onChange={(e) => setDraft(ind, saved, { actual: e.target.value })}
                                disabled={!canEnter || locked || busy}
                                className={`${FIELD} w-28 tabular-nums`}
                              />
                              <input
                                type="text"
                                placeholder="Add a comment"
                                aria-label={`Comment for ${ind.name}`}
                                value={draft.comment}
                                onChange={(e) => setDraft(ind, saved, { comment: e.target.value })}
                                disabled={!canEnter || locked || busy}
                                className={`${FIELD} w-48`}
                              />
                            </div>
                          </td>

                          <td className="px-3 py-4">
                            <div className="w-36">
                              <div className="flex items-center justify-between text-xs">
                                <span className="flex items-center gap-1.5 font-medium text-[#344054]">
                                  <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: PROGRESS[progress].color }} />
                                  {PROGRESS[progress].label}
                                </span>
                                {pct !== null && <span className="tabular-nums text-[#667085]">{pct}%</span>}
                              </div>
                              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[#EEF0F4]" aria-hidden="true">
                                <div className="h-full rounded-full" style={{ width: `${Math.min(pct ?? 0, 100)}%`, backgroundColor: PROGRESS[progress].color }} />
                              </div>
                            </div>
                          </td>

                          <td className="px-3 py-4">
                            <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${review.cls}`}>
                              {review.label}
                            </span>
                          </td>

                          <td className="px-6 py-4">
                            <div className="flex justify-end gap-2">
                              {canEnter && !locked && (
                                <button type="button" onClick={() => submitValue(ind, saved)} disabled={busy} className={BTN_SM}>
                                  Submit
                                </button>
                              )}
                              {isAdmin && saved?.status === "submitted" && (
                                <>
                                  <button type="button" onClick={() => reviewValue(ind, true)} disabled={busy} className={BTN_SM}>
                                    Approve
                                  </button>
                                  <button type="button" onClick={() => reviewValue(ind, false)} disabled={busy} className={BTN_SM_LIGHT}>
                                    Reject
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

export default MEDashboard;
