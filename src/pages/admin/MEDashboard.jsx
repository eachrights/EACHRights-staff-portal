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
const CARD = "rounded-2xl border border-[#E5E7EB] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]";
const FONT = { fontFamily: '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif' };

const ALL_AREAS = [...PROGRAM_AREAS, ...DEPARTMENT_AREAS];

/* Progress against target, from approved values only */
const PROGRESS = {
  on: { label: "On track", hint: "90% of target or more", color: "#1F7A5C" },
  risk: { label: "At risk", hint: "50 to 89% of target", color: "#D4A600" },
  off: { label: "Off track", hint: "Below 50% of target", color: "#B42318" },
  none: { label: "Not yet approved", hint: "No approved value", color: "#D9D9DF" },
};

/* Where a reported value is in the approval workflow */
const REVIEW = {
  submitted: { label: "Awaiting approval", cls: "bg-[#FBF3D0] text-[#7A5C00]" },
  rejected: { label: "Rejected", cls: "bg-red-50 text-red-700" },
  approved: { label: "Approved", cls: "bg-[#E1F1EB] text-[#1F7A5C]" },
  none: { label: "Not reported", cls: "bg-[#F2F4F7] text-[#667085]" },
};

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

/* Recognise a configured gender/sex disaggregation without assuming its ID or categories */
const isGenderType = (type) =>
  /\b(gender|sex)\b/i.test([type?.name, type?.slug, type?.code, type?.key].filter(Boolean).join(" "));

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

function SectionHead({ title, subtitle, aside }) {
  return (
    <div className="mb-5 flex items-start justify-between gap-3">
      <div>
        <h2 className="text-base font-semibold leading-6 text-[#101828]">{title}</h2>
        {subtitle && <p className="text-[13px] leading-5 text-[#667085]">{subtitle}</p>}
      </div>
      {aside}
    </div>
  );
}

function ViewTabs({ view, onChange }) {
  return (
    <div role="tablist" aria-label="View" className="inline-flex rounded-xl border border-[#E5E7EB] bg-white p-1">
      {[["project", "Project view"], ["portfolio", "Portfolio view"]].map(([id, label]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={view === id}
          onClick={() => onChange(id)}
          className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${FOCUS} ${
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
    <div aria-busy="true" aria-label="Loading dashboard" className="space-y-5">
      <div className={`${CARD} h-48 animate-pulse bg-[#F9FAFB] motion-reduce:animate-none`} />
      <div className="grid gap-5 lg:grid-cols-2">
        <div className={`${CARD} h-64 animate-pulse bg-[#F9FAFB] motion-reduce:animate-none`} />
        <div className={`${CARD} h-64 animate-pulse bg-[#F9FAFB] motion-reduce:animate-none`} />
      </div>
    </div>
  );
}

/* Small number tile used beside the donut */
function StatTile({ label, value, note, tone, bar }) {
  return (
    <div className={`${CARD} p-5`}>
      <p className="text-[13px] font-medium text-[#667085]">{label}</p>
      <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums text-[#101828]">{value}</p>
      {bar && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#EEF0F4]" aria-hidden="true">
          <div className="h-full rounded-full" style={{ width: `${Math.min(bar.pct, 100)}%`, backgroundColor: bar.color }} />
        </div>
      )}
      <p className={`mt-2 text-[13px] leading-5 ${tone || "text-[#667085]"}`}>{note}</p>
    </div>
  );
}

/* Donut: how many indicators are on track, at risk, off track or waiting for data */
function Donut({ segments, total, centerValue, centerLabel }) {
  const size = 170;
  const r = 66;
  const stroke = 20;
  const c = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="relative h-[170px] w-[170px] shrink-0">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        className="h-full w-full -rotate-90"
        role="img"
        aria-label={segments.map((s) => `${s.label}: ${s.count}`).join(", ")}
      >
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#EEF0F4" strokeWidth={stroke} />
        {total > 0 &&
          segments.map((s) => {
            if (s.count === 0) return null;
            const dash = (s.count / total) * c;
            const el = (
              <circle
                key={s.key}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth={stroke}
                strokeDasharray={`${Math.max(dash - 2, 0)} ${c - Math.max(dash - 2, 0)}`}
                strokeDashoffset={-offset}
              >
                <title>{`${s.label}: ${s.count}`}</title>
              </circle>
            );
            offset += dash;
            return el;
          })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-3xl font-semibold tracking-tight tabular-nums text-[#101828]">{centerValue}</span>
        <span className="mt-0.5 max-w-[90px] text-[11px] leading-tight text-[#667085]">{centerLabel}</span>
      </div>
    </div>
  );
}

/* Line + soft area, average % of target per period, with a dashed line at 100% (the target) */
function TrendChart({ points }) {
  const W = 460, H = 220, L = 40, R = 14, T = 14, B = 28;
  const known = points.filter((p) => p.pct !== null);
  if (known.length === 0) {
    return (
      <p className="py-16 text-center text-sm text-[#667085]">
        No approved values yet. The trend appears here once values are approved.
      </p>
    );
  }
  const yMax = Math.max(125, Math.ceil(Math.max(...known.map((p) => p.pct)) / 25) * 25);
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
      <line x1={L} x2={W - R} y1={y(100)} y2={y(100)} stroke="#1F7A5C" strokeWidth="1.5" strokeDasharray="5 4" />
      <text x={W - R} y={y(100) - 5} textAnchor="end" fontSize="10" fill="#1F7A5C">Target (100%)</text>
      <path d={area} fill={PURPLE_LIGHT} opacity="0.7" />
      <path d={line} fill="none" stroke={PURPLE} strokeWidth="2.5" strokeLinejoin="round" />
      {seq.map((p) => (
        <g key={p.period}>
          <circle cx={p.x} cy={p.y} r="4" fill="#fff" stroke={PURPLE} strokeWidth="2.5">
            <title>{`${p.period}: ${p.pct}%`}</title>
          </circle>
          <text x={p.x} y={p.y - 10} textAnchor="middle" fontSize="11" fontWeight="600" fill="#344054">{p.pct}%</text>
        </g>
      ))}
      {points.map((p, i) => (
        <text key={p.period} x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fill={SOFT}>{p.period}</text>
      ))}
    </svg>
  );
}

/* Horizontal bars: one per result, average % of target. Click a bar to filter the table. */
function ResultBars({ tiles, activeId, onPick }) {
  if (tiles.length === 0) {
    return <p className="py-16 text-center text-sm text-[#667085]">No results have a target this period.</p>;
  }
  return (
    <ul className="space-y-3.5">
      {tiles.map(({ result, pct, progress }) => {
        const active = activeId === result.id;
        return (
          <li key={result.id}>
            <button
              type="button"
              onClick={() => onPick(active ? "" : result.id)}
              aria-pressed={active}
              title={result.title}
              className={`block w-full rounded-lg px-2 py-1.5 text-left transition hover:bg-[#F9FAFB] ${FOCUS} ${active ? "bg-[#F5F2FD]" : ""}`}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-[13px] font-medium text-[#344054]" style={{ paddingLeft: `${result.depth * 10}px` }}>
                  {result.title}
                </span>
                <span className="shrink-0 text-[13px] font-semibold tabular-nums text-[#101828]">
                  {pct === null ? "No data" : `${pct}%`}
                </span>
              </div>
              <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-[#EEF0F4]" aria-hidden="true">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${Math.min(pct ?? 0, 100)}%`, backgroundColor: PROGRESS[progress].color }}
                />
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/* Stacked columns: how many indicators per level are approved, awaiting, or not reported */
const STACK = [
  { key: "approved", label: "Approved", color: "#1F7A5C" },
  { key: "awaiting", label: "Awaiting approval", color: "#D4A600" },
  { key: "missing", label: "Not reported", color: "#D9D9DF" },
];

function StackedColumns({ groups }) {
  if (groups.length === 0) {
    return <p className="py-16 text-center text-sm text-[#667085]">No indicators have a target this period.</p>;
  }
  const max = Math.max(...groups.map((g) => g.total));
  return (
    <>
      <div className="flex h-48 items-end justify-around gap-4 border-b border-[#EEF0F4] px-2">
        {groups.map((g) => (
          <div
            key={g.name}
            className="flex h-full w-full max-w-[80px] flex-col justify-end"
            title={`${g.name}: ${g.approved} approved, ${g.awaiting} awaiting approval, ${g.missing} not reported`}
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
      <div className="mt-2 flex justify-around gap-4 px-2">
        {groups.map((g) => (
          <p key={g.name} className="w-full max-w-[80px] truncate text-center text-xs text-[#667085]" title={g.name}>
            {g.name}
          </p>
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

/* Order of importance for the "needs attention" list */
const ATTENTION_ORDER = { review: 0, rejected: 1, off: 2, risk: 3, missing: 4 };
const ATTENTION_STYLE = {
  review: "bg-[#FBF3D0] text-[#7A5C00]",
  rejected: "bg-red-50 text-red-700",
  off: "bg-red-50 text-red-700",
  risk: "bg-[#FBF3D0] text-[#7A5C00]",
  missing: "bg-[#F2F4F7] text-[#475467]",
};

/* ---------- Page ---------- */

function MEDashboard() {
  const [access, setAccess] = useState({ isAdmin: false, departments: new Set() });
  const [frameworks, setFrameworks] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [data, setData] = useState(null);
  const [period, setPeriod] = useState("");
  const [resultFilter, setResultFilter] = useState("");
  const [rowFilter, setRowFilter] = useState("all");
  const [drafts, setDrafts] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [view, setView] = useState("project");
  const [strategic, setStrategic] = useState([]);
  const [types, setTypes] = useState([]);

  useEffect(() => {
    let mounted = true;
    getAccess().then((r) => mounted && setAccess(r)).catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  /* Disaggregation types, gender first, so breakdowns can be shown with their category order */
  useEffect(() => {
    let mounted = true;
    api("/me/disaggregations")
      .then((r) => {
        if (!mounted) return;
        const configured = r.disaggregations || [];
        setTypes([...configured.filter(isGenderType), ...configured.filter((t) => !isGenderType(t))]);
      })
      .catch(() => {});
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
    setRowFilter("all");
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
  const resultRows = useMemo(() => {
    if (!resultFilter) return rows;
    const ids = new Set([resultFilter]);
    for (const r of ordered) if (ids.has(r.parentId)) ids.add(r.id);
    return rows.filter((row) => ids.has(row.result.id));
  }, [rows, ordered, resultFilter]);

  const expected = useMemo(() => rows.filter((r) => r.target !== undefined), [rows]);
  const counts = Object.fromEntries(Object.keys(PROGRESS).map((k) => [k, expected.filter((r) => r.progress === k).length]));
  const reported = expected.filter((r) => r.saved && r.saved.status !== "rejected").length;
  const awaiting = rows.filter((r) => r.saved?.status === "submitted").length;

  /* Table filters */
  const filterTests = {
    all: () => true,
    todo: (r) => r.target !== undefined && (!r.saved || r.saved.status === "rejected"),
    review: (r) => r.saved?.status === "submitted",
    behind: (r) => r.progress === "off" || r.progress === "risk",
  };
  const filterCounts = Object.fromEntries(
    Object.entries(filterTests).map(([k, test]) => [k, resultRows.filter(test).length])
  );
  const shownRows = resultRows.filter(filterTests[rowFilter]);

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

  /* One bar per result: average % of target, selected period */
  const tiles = useMemo(() => {
    return ordered
      .map((result) => {
        const own = rows.filter((r) => r.result.id === result.id && r.target !== undefined);
        if (own.length === 0) return null;
        const known = own.filter((r) => r.pct !== null);
        const pct = known.length ? Math.round(known.reduce((a, r) => a + r.pct, 0) / known.length) : null;
        return { result, pct, progress: progressOf(pct) };
      })
      .filter(Boolean);
  }, [ordered, rows]);

  /* Plain-language to-do list, most important first */
  const attention = useMemo(() => {
    const list = [];
    for (const row of expected) {
      if (isAdmin && row.saved?.status === "submitted") list.push({ row, tone: "review", text: "A value is waiting for your approval" });
      else if (row.saved?.status === "rejected") list.push({ row, tone: "rejected", text: "Value was rejected, enter a new one" });
      else if (row.progress === "off") list.push({ row, tone: "off", text: `Off track, at ${row.pct}% of target` });
      else if (row.progress === "risk") list.push({ row, tone: "risk", text: `At risk, at ${row.pct}% of target` });
      else if (!row.saved) list.push({ row, tone: "missing", text: "No value reported yet" });
    }
    return list.sort((a, b) => ATTENTION_ORDER[a.tone] - ATTENTION_ORDER[b.tone]);
  }, [expected, isAdmin]);

  const knownPcts = expected.filter((r) => r.pct !== null).map((r) => r.pct);
  const overallPct = knownPcts.length ? Math.round(knownPcts.reduce((a, b) => a + b, 0) / knownPcts.length) : null;
  const reportedPct = expected.length ? Math.round((reported / expected.length) * 100) : 0;

  const draftFor = (ind, saved) => drafts[ind.id] ?? { actual: saved?.actual ?? "", comment: saved?.comment ?? "" };
  const setDraft = (ind, saved, patch) =>
    setDrafts((cur) => ({ ...cur, [ind.id]: { ...draftFor(ind, saved), ...patch } }));

  /* A save replaces the whole value, so the breakdown and evidence already on it are sent back unchanged */
  const submitValue = (ind, saved) =>
    run(async () => {
      const draft = draftFor(ind, saved);
      if (draft.actual === "") throw new Error("Enter the actual value first.");
      const hasBreakdown = Object.keys(saved?.breakdown || {}).length > 0;
      if (hasBreakdown && Number(draft.actual) !== Number(saved.actual)) {
        throw new Error("This value has a breakdown that adds up to its total. Change it on the Forms page so the breakdown is updated too.");
      }
      await api(`/me/frameworks/${selectedId}/values`, {
        method: "PUT",
        body: {
          indicatorId: ind.id,
          period,
          actual: draft.actual,
          comment: draft.comment,
          ...(hasBreakdown ? { breakdown: saved.breakdown } : {}),
          ...((saved?.evidence || []).length ? { evidence: saved.evidence } : {}),
        },
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

  /* A reported value's breakdowns as readable lines, in the order the types and categories are set up */
  const breakdownLines = (saved) =>
    types
      .filter((t) => saved?.breakdown?.[t.id])
      .map((t) => ({
        id: t.id,
        name: t.name,
        parts: t.categories
          .filter((c) => saved.breakdown[t.id][c] !== undefined)
          .map((c) => ({ label: c, value: saved.breakdown[t.id][c] })),
      }));

  /* Files open through a short-lived private link; links open directly */
  const openEvidence = (item) =>
    run(async () => {
      if (item.type === "link") {
        window.open(item.url, "_blank", "noopener,noreferrer");
        return;
      }
      const tab = window.open("about:blank", "_blank");
      try {
        const { url } = await api(`/me/frameworks/${selectedId}/evidence/download-url?key=${encodeURIComponent(item.key)}`);
        if (tab) {
          tab.opener = null;
          tab.location.href = url;
        } else {
          window.location.assign(url);
        }
      } catch (err) {
        tab?.close();
        throw err;
      }
    });

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

  /* Jump from the to-do list to the matching row in the table */
  const goToIndicator = (row) => {
    setResultFilter(row.result.id);
    setRowFilter("all");
    setTimeout(() => document.getElementById("indicator-table")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  if (view === "portfolio") {
    return (
      <div className="space-y-6" style={FONT}>
        <ViewTabs view={view} onChange={setView} />
        <PortfolioView />
      </div>
    );
  }

  const donutSegments = Object.entries(PROGRESS).map(([key, v]) => ({ key, label: v.label, color: v.color, count: counts[key] }));

  const overallSentence =
    expected.length === 0
      ? "No indicators have a target in this period."
      : overallPct === null
        ? "No values have been approved yet for this period."
        : overallPct >= 90
          ? "Results are on track against targets."
          : overallPct >= 50
            ? "Results are partly meeting targets. Some need attention."
            : "Results are well below target. Action is needed.";

  const FILTERS = [
    ["all", "All"],
    ["todo", "Still to report"],
    ...(isAdmin ? [["review", "To approve"]] : []),
    ["behind", "Behind target"],
  ];

  return (
    <div className="space-y-6" style={FONT}>
      {isAdmin && <ViewTabs view={view} onChange={setView} />}

      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-[#101828]">M&amp;E dashboard</h1>
          {fw ? (
            <p className="mt-1 text-sm text-[#667085]">
              {fw.donor ? <>Donor: <span className="font-medium text-[#344054]">{fw.donor}</span> · </> : null}
              Showing <span className="font-medium text-[#344054]">{period}</span>
            </p>
          ) : (
            <p className="mt-1 text-sm text-[#667085]">See how results are progressing against targets.</p>
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
            <>
              <button type="button" onClick={() => exportFile("results")} disabled={busy} className={BTN_LIGHT}>
                Download results (CSV)
              </button>
              <button type="button" onClick={() => exportFile("logframe")} disabled={busy} className={BTN_LIGHT}>
                Download logframe (CSV)
              </button>
            </>
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
          <h2 className="text-base font-semibold text-[#101828]">
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
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-medium text-[#667085]">Reporting period</span>
            <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Reporting period">
              {fw.periods.map((p) => (
                <button
                  key={p}
                  type="button"
                  role="tab"
                  aria-selected={p === period}
                  onClick={() => setPeriod(p)}
                  className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition ${FOCUS} ${
                    p === period ? "bg-[#5B3FD0] text-white" : "bg-white text-[#475467] ring-1 ring-inset ring-[#E5E7EB] hover:bg-[#F4F5F7]"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* 1. The headline: how are we doing overall? */}
          <section aria-label="Overall summary" className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <div className={`${CARD} p-6`}>
              <SectionHead title="How are we doing?" subtitle={overallSentence} />
              <div className="flex flex-wrap items-center gap-8">
                <Donut
                  segments={donutSegments}
                  total={expected.length}
                  centerValue={overallPct === null ? "-" : `${overallPct}%`}
                  centerLabel="average of target reached"
                />
                <ul className="min-w-[220px] flex-1 space-y-3">
                  {Object.entries(PROGRESS).map(([k, v]) => (
                    <li key={k} className="flex items-center gap-3">
                      <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-[4px]" style={{ backgroundColor: v.color }} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-[#101828]">{v.label}</span>
                        <span className="block text-xs text-[#667085]">{v.hint}</span>
                      </span>
                      <span className="text-lg font-semibold tabular-nums text-[#101828]">{counts[k]}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="grid gap-5 sm:grid-cols-3 xl:grid-cols-1">
              <StatTile
                label="Reported so far"
                value={`${reported} of ${expected.length}`}
                note="Indicators with a value entered"
                bar={{ pct: reportedPct, color: PURPLE }}
              />
              <StatTile
                label="Awaiting approval"
                value={fmt(awaiting)}
                note={isAdmin ? (awaiting ? "Ready for your review" : "Nothing to review") : "With the administrator"}
                tone={awaiting ? "text-[#7A5C00]" : undefined}
              />
              <StatTile
                label="Indicators in this project"
                value={fmt(data.indicators.length)}
                note={`Across ${data.results.length} ${data.results.length === 1 ? "result" : "results"}`}
              />
            </div>
          </section>

          {/* 2. What should I do next? + trend */}
          <div className="grid gap-5 lg:grid-cols-2">
            <section aria-label="Needs attention" className={`${CARD} p-6`}>
              <SectionHead
                title="Needs attention"
                subtitle={attention.length ? "The most important items first. Select one to open it." : "Everything is in order for this period."}
                aside={
                  attention.length > 0 ? (
                    <span className="rounded-full bg-[#EDE9FB] px-2.5 py-0.5 text-xs font-semibold text-[#5B3FD0]">{attention.length}</span>
                  ) : null
                }
              />
              {attention.length === 0 ? (
                <p className="rounded-xl bg-[#EEF8F3] px-4 py-8 text-center text-sm font-medium text-[#1F7A5C]">
                  Nothing needs attention right now.
                </p>
              ) : (
                <ul className="divide-y divide-[#F2F4F7]">
                  {attention.slice(0, 6).map(({ row, tone, text }) => (
                    <li key={row.ind.id}>
                      <button
                        type="button"
                        onClick={() => goToIndicator(row)}
                        className={`flex w-full items-start gap-3 rounded-lg px-2 py-3 text-left transition hover:bg-[#F9FAFB] ${FOCUS}`}
                      >
                        <span className={`mt-0.5 shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${ATTENTION_STYLE[tone]}`}>
                          {tone === "review" ? "Approve" : tone === "rejected" ? "Rejected" : tone === "missing" ? "Report" : tone === "off" ? "Off track" : "At risk"}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-[#101828]">{row.ind.name}</span>
                          <span className="block text-xs text-[#667085]">{text}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {attention.length > 6 && (
                <p className="mt-3 text-center text-xs text-[#667085]">
                  and {attention.length - 6} more. Use the filters in the indicator table to see them all.
                </p>
              )}
            </section>

            <section aria-label="Achievement by period" className={`${CARD} p-6`}>
              <SectionHead title="Progress over time" subtitle="Average percentage of target reached in each period (approved values)" />
              <TrendChart points={trend} />
            </section>
          </div>

          {/* 3. Where is the progress strong or weak? */}
          <div className="grid gap-5 lg:grid-cols-2">
            <section aria-label="Progress by result" className={`${CARD} p-6`}>
              <SectionHead title="Progress by result" subtitle={`Select a result to filter the table below. ${period}`} />
              <ResultBars tiles={tiles} activeId={resultFilter} onPick={setResultFilter} />
            </section>

            <section aria-label="Reporting status" className={`${CARD} p-6`}>
              <SectionHead title="Reporting status by level" subtitle={`How many indicators are approved, waiting or missing. ${period}`} />
              <StackedColumns groups={levelGroups} />
            </section>
          </div>

          {/* 4. The detail: every indicator */}
          <section id="indicator-table" aria-label="Indicators" className={`${CARD} scroll-mt-20 overflow-hidden`}>
            <div className="px-6 pt-6">
              <SectionHead
                title="Indicator results"
                subtitle={`Targets, reported values and approval status for ${period}`}
                aside={
                  resultFilter ? (
                    <button type="button" onClick={() => setResultFilter("")} className={BTN_SM_LIGHT}>
                      Showing one result · Show all
                    </button>
                  ) : null
                }
              />

              <div role="group" aria-label="Filter indicators" className="mb-4 flex flex-wrap gap-1.5">
                {FILTERS.map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={rowFilter === id}
                    onClick={() => setRowFilter(id)}
                    className={`rounded-full px-3.5 py-1.5 text-[13px] font-medium transition ${FOCUS} ${
                      rowFilter === id ? "bg-[#EDE9FB] text-[#5B3FD0]" : "text-[#475467] ring-1 ring-inset ring-[#E5E7EB] hover:bg-[#F4F5F7]"
                    }`}
                  >
                    {label} <span className="ml-1 tabular-nums opacity-70">{filterCounts[id]}</span>
                  </button>
                ))}
              </div>

              {!canEnter && (
                <p className="mb-4 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-[13px] text-[#667085]">
                  You can view these results. Only the administrator and the owning programme can report values.
                </p>
              )}
            </div>

            <div className="max-h-[70vh] overflow-auto">
              <table className="w-full min-w-[980px] text-left text-sm">
                <caption className="sr-only">Indicator results for {period}</caption>
                <thead>
                  <tr className="text-xs font-medium text-[#667085]">
                    {[
                      ["Indicator", "px-6 text-left"],
                      ["Target", "px-3 text-right"],
                      ["Reported value", "px-3 text-left"],
                      ["Progress to target", "px-3 text-left"],
                      ["Approval", "px-3 text-left"],
                    ].map(([label, cls]) => (
                      <th key={label} scope="col" className={`sticky top-0 z-10 border-y border-[#E5E7EB] bg-[#F9FAFB] py-3 ${cls}`}>
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
                      <td colSpan={6} className="px-6 py-12 text-center text-sm text-[#667085]">
                        No indicators match this view.
                      </td>
                    </tr>
                  )}

                  {shownRows.map(({ ind, result, saved, target, pct, progress }) => {
                    const draft = draftFor(ind, saved);
                    const locked = saved?.status === "approved";
                    const correction = saved?.status === "submitted" ? saved.correction : null;
                    const review = correction
                      ? { label: "Correction awaiting approval", cls: "bg-[#FBF3D0] text-[#7A5C00]" }
                      : REVIEW[saved?.status] ?? REVIEW.none;
                    const lines = breakdownLines(saved);
                    const evidence = saved?.evidence || [];
                    const hasBreakdown = lines.length > 0;

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

                        <td className="px-3 py-4 text-right">
                          <p className="font-semibold tabular-nums text-[#101828]">{fmt(target)}</p>
                          <p className="mt-0.5 text-xs text-[#98A2B3]">Baseline {fmt(ind.baseline)}</p>
                        </td>

                        <td className="px-3 py-4">
                          <div className="space-y-1.5">
                            <input
                              type="number"
                              inputMode="decimal"
                              placeholder="Enter value"
                              aria-label={`Actual for ${ind.name}`}
                              value={draft.actual}
                              onChange={(e) => setDraft(ind, saved, { actual: e.target.value })}
                              disabled={!canEnter || locked || busy || hasBreakdown}
                              className={`${FIELD} w-32 tabular-nums`}
                            />
                            <input
                              type="text"
                              placeholder="Add a comment (optional)"
                              aria-label={`Comment for ${ind.name}`}
                              value={draft.comment}
                              onChange={(e) => setDraft(ind, saved, { comment: e.target.value })}
                              disabled={!canEnter || locked || busy}
                              className={`${FIELD} w-52`}
                            />
                          </div>

                          {correction && (
                            <div className="mt-3 rounded-lg border border-[#F3D18A] bg-[#FFFAEB] p-3 text-xs text-[#7A5C00]">
                              <p className="font-semibold">
                                Correction by {correction.requestedBy || "staff"}. Was {fmt(correction.previous?.actual)}, now {fmt(saved.actual)}.
                              </p>
                              <p className="mt-1 text-[#5C4600]">{correction.note}</p>
                            </div>
                          )}

                          {saved && (
                            <div className="mt-3 space-y-2.5 text-xs">
                              {hasBreakdown && (
                                <div className="space-y-1">
                                  {lines.map((line) => (
                                    <p key={line.id} className="leading-5 text-[#475467]">
                                      <span className="font-semibold text-[#344054]">{line.name}:</span>{" "}
                                      {line.parts.map((p, i) => (
                                        <span key={p.label}>
                                          {i > 0 ? " · " : ""}
                                          {p.label} <span className="font-semibold tabular-nums text-[#101828]">{fmt(p.value)}</span>
                                        </span>
                                      ))}
                                    </p>
                                  ))}
                                  <p className="text-[11px] text-[#98A2B3]">The total comes from the breakdown. Edit it on the Forms page.</p>
                                </div>
                              )}

                              {evidence.length > 0 ? (
                                <ul className="space-y-1">
                                  {evidence.map((item, i) => (
                                    <li key={`${item.type}-${item.key || item.url}-${i}`} className="flex items-center gap-2">
                                      <span className="rounded bg-[#F2F4F7] px-1.5 py-0.5 text-[11px] font-medium text-[#475467]">
                                        {item.type === "file" ? "File" : "Link"}
                                      </span>
                                      <span className="min-w-0 max-w-[10rem] truncate text-[#101828]" title={item.name}>{item.name}</span>
                                      <button
                                        type="button"
                                        onClick={() => openEvidence(item)}
                                        disabled={busy}
                                        aria-label={`Open ${item.name}`}
                                        className={`font-medium text-[#5B3FD0] hover:underline ${FOCUS}`}
                                      >
                                        Open
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                saved.status === "submitted" && <p className="text-[#B54708]">No evidence attached. It cannot be approved without evidence.</p>
                              )}
                            </div>
                          )}
                        </td>

                        <td className="px-3 py-4">
                          <div className="w-40">
                            <div className="flex items-center justify-between text-xs">
                              <span className="flex items-center gap-1.5 font-medium text-[#344054]">
                                <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: PROGRESS[progress].color }} />
                                {PROGRESS[progress].label}
                              </span>
                              {pct !== null && <span className="font-semibold tabular-nums text-[#101828]">{pct}%</span>}
                            </div>
                            <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-[#EEF0F4]" aria-hidden="true">
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
                                <button
                                  type="button"
                                  onClick={() => reviewValue(ind, true)}
                                  disabled={busy || evidence.length === 0}
                                  title={evidence.length === 0 ? "Evidence is required before a value can be approved" : undefined}
                                  className={BTN_SM}
                                >
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
        </>
      )}
    </div>
  );
}

export default MEDashboard;
