import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getAccess } from "../../../access";
import { api } from "../../../meApi";

/* Shared tokens, helpers and data hook for the M&E pages (TolaData-style). */
export const FIELD =
  "rounded-lg border border-[#D0D5DD] bg-white px-3 py-2 text-sm text-[#101828] outline-none transition placeholder:text-[#98A2B3] focus:border-[#5B3FD0] focus:ring-4 focus:ring-[#5B3FD0]/15 disabled:bg-[#F4F5F7] disabled:text-[#667085]";
export const BTN =
  "rounded-lg bg-[#5B3FD0] px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-[#4A31B8] disabled:opacity-60";
export const BTN_LIGHT =
  "rounded-lg border border-[#D0D5DD] bg-white px-3.5 py-2 text-sm font-semibold text-[#344054] transition hover:bg-[#F4F5F7] disabled:opacity-60";
export const CARD = "rounded-xl border border-[#E5E7EB] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]";
export const FONT = { fontFamily: '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif' };
export const PURPLE = "#5B3FD0";

export const PROGRESS = {
  on: { label: "On track", color: "#1F7A5C" },
  risk: { label: "At risk", color: "#D4A600" },
  off: { label: "Off track", color: "#B42318" },
  none: { label: "No data", color: "#D9D9DF" },
};

export const REVIEW = {
  submitted: { label: "Awaiting approval", cls: "bg-[#FBF3D0] text-[#7A5C00]" },
  rejected: { label: "Rejected", cls: "bg-red-50 text-red-700" },
  approved: { label: "Approved", cls: "bg-[#E1F1EB] text-[#1F7A5C]" },
};

export const progressOf = (pct) => (pct === null ? "none" : pct >= 90 ? "on" : pct >= 50 ? "risk" : "off");

export function orderResults(results) {
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

/* One row per indicator for a period; progress uses approved values only */
export function buildRows(data, ordered, period) {
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
}

export function useMEData() {
  const [access, setAccess] = useState({ isAdmin: false, departments: new Set() });
  const [frameworks, setFrameworks] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [data, setData] = useState(null);
  const [period, setPeriod] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    getAccess().then((r) => mounted && setAccess(r)).catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const run = useCallback(async (task) => {
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
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

  useEffect(() => {
    run(() => loadList());
  }, [loadList, run]);

  useEffect(() => {
    run(() => loadFramework(selectedId));
  }, [selectedId, loadFramework, run]);

  const reload = useCallback(() => loadFramework(selectedId), [loadFramework, selectedId]);

  const fw = data?.framework;
  const ordered = useMemo(() => (data ? orderResults(data.results) : []), [data]);
  const rows = useMemo(() => buildRows(data, ordered, period), [data, ordered, period]);
  const canEnter = Boolean(fw) && (access.isAdmin || access.departments.has(fw.area));

  return {
    access, isAdmin: access.isAdmin, canEnter,
    frameworks, selectedId, setSelectedId,
    data, fw, ordered, rows,
    period, setPeriod,
    busy, error, run, loadList, reload,
  };
}

export function Page({ children }) {
  return (
    <div className="space-y-5" style={FONT}>
      {children}
    </div>
  );
}

export function PageHead({ title, subtitle, children }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 print:hidden">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-[#101828]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-[#667085]">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </header>
  );
}

export function CardHead({ title, subtitle }) {
  return (
    <div className="mb-4">
      <h2 className="text-sm font-semibold text-[#101828]">{title}</h2>
      {subtitle && <p className="mt-0.5 text-xs text-[#667085]">{subtitle}</p>}
    </div>
  );
}

export function FrameworkSelect({ frameworks, value, onChange }) {
  if (frameworks.length === 0) return null;
  return (
    <select aria-label="Framework" value={value} onChange={(e) => onChange(e.target.value)} className={FIELD}>
      {frameworks.map((f) => (
        <option key={f.id} value={f.id}>{f.name}</option>
      ))}
    </select>
  );
}

export function PeriodTabs({ periods, value, onChange }) {
  return (
    <div className="flex flex-wrap gap-1.5 print:hidden" role="tablist" aria-label="Reporting period">
      {periods.map((p) => (
        <button
          key={p}
          type="button"
          role="tab"
          aria-selected={p === value}
          onClick={() => onChange(p)}
          className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition ${
            p === value ? "bg-[#EDE9FB] text-[#5B3FD0]" : "text-[#475467] hover:bg-[#F4F5F7]"
          }`}
        >
          {p}
        </button>
      ))}
    </div>
  );
}

export function ErrorBar({ error }) {
  if (!error) return null;
  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      {error}
    </div>
  );
}

export function NoFramework({ isAdmin, busy }) {
  if (busy) return null;
  return (
    <div className={`${CARD} p-10 text-center text-sm text-[#667085]`}>
      {isAdmin ? (
        <>
          No frameworks yet.{" "}
          <Link to="/me-dashboard/frameworks" className="font-semibold text-[#5B3FD0] hover:underline">
            Create one
          </Link>{" "}
          or load the sample from the dashboard.
        </>
      ) : (
        "There are no frameworks for your department yet."
      )}
    </div>
  );
}

export function StatusPill({ status }) {
  const r = REVIEW[status];
  if (!r) return <span className="text-xs text-[#98A2B3]">Not reported</span>;
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${r.cls}`}>{r.label}</span>;
}

export function ProgressDot({ progress, pct }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#344054]">
      <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: PROGRESS[progress].color }} />
      {PROGRESS[progress].label}
      {pct !== null && pct !== undefined && <span className="font-normal text-[#667085]">{pct}%</span>}
    </span>
  );
}

/* Baseline + one target box per reporting period */
export function TargetsInput({ periods, value, onChange }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {periods.map((p) => (
        <label key={p} className="text-xs font-medium text-[#667085]">
          {p}
          <input
            type="number"
            value={value[p] ?? ""}
            onChange={(e) => onChange({ ...value, [p]: e.target.value })}
            className={`${FIELD} mt-1 w-full`}
            placeholder="Target"
          />
        </label>
      ))}
    </div>
  );
}

export const cleanTargets = (targets) =>
  Object.fromEntries(Object.entries(targets).filter(([, v]) => v !== "" && v !== null && !Number.isNaN(Number(v))).map(([k, v]) => [k, Number(v)]));
