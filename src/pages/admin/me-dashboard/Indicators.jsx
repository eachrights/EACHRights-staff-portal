import { useEffect, useMemo, useRef, useState } from "react";
import { DEPARTMENT_AREAS, PROGRAM_AREAS, getAccess } from "../../../access";
import { api } from "../../../meApi";
import {
  BTN, BTN_LIGHT, CARD, ErrorBar, FIELD, FrameworkSelect, NoFramework, Page, PageHead,
  TargetsInput, cleanTargets, useMEData,
} from "./Shared";

const AREAS = [...PROGRAM_AREAS, ...DEPARTMENT_AREAS];
const areaName = (slug) => AREAS.find((a) => a.slug === slug)?.name || slug || "No area";

const EMPTY = {
  name: "", resultId: "", unit: "", baseline: "", targets: {}, mov: "", assumptions: "",
  format: "Numeric", frequency: "Quarterly", kpi: false,
};

const FORMATS = ["Numeric", "Percentage", "Qualitative only"];
const FREQUENCIES = ["Monthly", "Quarterly", "Biannual", "Annual"];

/* Status order: the ones that need attention come first */
const STATUS_ORDER = ["Off track", "Minor delays", "No data yet", "On track", "Achieved", "No target"];
const SEVERITY = Object.fromEntries(STATUS_ORDER.map((s, i) => [s, i]));

const SORTS = [
  ["attention", "Needs attention first"],
  ["framework", "Framework order"],
  ["name", "Name (A to Z)"],
];

const STATUS_STYLE = {
  Achieved: { dot: "#067647", bg: "#ECFDF3", text: "#067647" },
  "On track": { dot: "#17B26A", bg: "#ECFDF3", text: "#067647" },
  "Minor delays": { dot: "#CA9A04", bg: "#FEF6D8", text: "#7A5B00" },
  "Off track": { dot: "#D92D20", bg: "#FEF3F2", text: "#B42318" },
  "No data yet": { dot: "#98A2B3", bg: "#F2F4F7", text: "#475467" },
  "No target": { dot: "#D0D5DD", bg: "#F9FAFB", text: "#667085" },
};

/* Result colours, cycled by position */
const BANDS = [
  { bg: "#E9F6F1", bar: "#00664E", text: "#064E3B" },
  { bg: "#EEEBFB", bar: "#5B3FD0", text: "#3B2A8F" },
  { bg: "#FEF6D8", bar: "#CA9A04", text: "#7A5B00" },
  { bg: "#E8F1FD", bar: "#2E6FD8", text: "#1E4C9A" },
];

const SMALL =
  "rounded-md border border-[#D0D5DD] bg-white px-3 py-1.5 text-xs font-semibold text-[#344054] transition hover:bg-[#F4F5F7] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00664E] disabled:cursor-not-allowed disabled:opacity-50";
const SMALL_DANGER =
  "rounded-md border border-[#FDA29B] bg-white px-3 py-1.5 text-xs font-semibold text-[#B42318] transition hover:bg-[#FEF3F2] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B42318] disabled:cursor-not-allowed disabled:opacity-50";

const short = (p) => String(p).replace(/^\d{4}-/, "");
const fmt = (n) => (n === undefined || n === null || n === "" ? "-" : Number(n).toLocaleString());

const formatOf = (ind) =>
  ind.format || (/%|percent/i.test(ind.unit || "") ? "Percentage" : "Numeric");

/*
 * Progress for one indicator, from approved values only.
 *  Counts: the approved values are added up and measured against the total of all quarterly targets.
 *  Percentages: the latest approved value is measured against the final target.
 * The status is about pace: the result so far against the targets for the quarters already reported
 * (90% or more is on track, 50% to 89% has minor delays, below 50% is off track), the same bands the
 * other pages use. It is Achieved once the full target is met.
 */
function progressOf(ind, values, periods) {
  const targets = ind.targets || {};
  const isPct = formatOf(ind) === "Percentage";
  const rows = (periods || Object.keys(targets))
    .filter((p) => targets[p] !== undefined && targets[p] !== "")
    .map((p) => {
      const mine = values.filter((v) => v.indicatorId === ind.id && v.period === p);
      const approved = mine.find((v) => v.status === "approved" && (v.actual ?? v.value) != null);
      return {
        p,
        t: Number(targets[p]),
        actual: approved ? Number(approved.actual ?? approved.value) : null,
        waiting: !approved && mine.some((v) => v.status === "submitted"),
      };
    });

  const base = { rows, isPct, target: null, actual: null, pct: null, pace: null, waiting: rows.filter((r) => r.waiting).length };
  if (rows.length === 0) return { ...base, status: "No target" };

  const reported = rows.filter((r) => r.actual !== null);
  const target = isPct ? rows[rows.length - 1].t : rows.reduce((s, r) => s + r.t, 0);
  if (reported.length === 0) return { ...base, target, status: "No data yet" };

  const lastReported = reported[reported.length - 1];
  const actual = isPct ? lastReported.actual : reported.reduce((s, r) => s + r.actual, 0);
  const toDate = isPct ? lastReported.t : reported.reduce((s, r) => s + r.t, 0);
  const pct = target > 0 ? Math.min(100, Math.round((actual / target) * 100)) : null;
  const pace = toDate > 0 ? Math.round((actual / toDate) * 100) : null;
  const status =
    target > 0 && actual >= target ? "Achieved"
    : pace === null ? "No data yet"
    : pace >= 90 ? "On track"
    : pace >= 50 ? "Minor delays"
    : "Off track";
  return { ...base, target, actual, pct, pace, status };
}

function Field({ label, className = "", children }) {
  return (
    <label className={`flex flex-col gap-1.5 ${className}`}>
      <span className="text-xs font-semibold text-[#344054]">{label}</span>
      {children}
    </label>
  );
}

function StatusPill({ status }) {
  const s = STATUS_STYLE[status];
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: s.bg, color: s.text }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.dot }} />
      {status}
    </span>
  );
}

/* One quarter: its target, and the approved result when there is one */
function QuarterChip({ row, suffix }) {
  const ratio = row.actual !== null && row.t > 0 ? row.actual / row.t : null;
  const color = ratio === null ? "#D0D5DD" : ratio >= 0.9 ? "#17B26A" : ratio >= 0.5 ? "#CA9A04" : "#D92D20";
  const title =
    row.actual !== null
      ? `${row.p}: approved ${row.actual} against a target of ${row.t}`
      : row.waiting
        ? `${row.p}: a value is awaiting approval. Target ${row.t}`
        : `${row.p}: target ${row.t}, not reported yet`;
  return (
    <li
      title={title}
      className="min-w-[64px] rounded-lg border bg-white px-2.5 py-1.5"
      style={{ borderColor: color, borderStyle: row.waiting ? "dashed" : "solid", borderLeftWidth: 3 }}
    >
      <p className="flex items-center gap-1 text-[11px] font-medium text-[#98A2B3]">
        {short(row.p)}
        {row.waiting && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[#D4A600]" />}
      </p>
      <p className="text-sm font-semibold tabular-nums text-[#101828]">
        {row.actual !== null ? fmt(row.actual) : "-"}
        <span className="font-normal text-[#98A2B3]"> / {fmt(row.t)}{suffix}</span>
      </p>
    </li>
  );
}

function IndicatorCard({ ind, p, band, resultTitle, canManage, busy, expanded, onToggle, onEdit, onDuplicate, onDelete }) {
  const suffix = p.isPct ? "%" : "";
  const hasDetails = Boolean(ind.mov || ind.assumptions);
  return (
    <article className={`${CARD} overflow-hidden`} style={{ borderLeft: `4px solid ${band.bar}` }}>
      <div className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="flex flex-wrap items-center gap-2 text-[15px] font-semibold leading-5 text-[#101828]">
              {ind.name}
              {ind.kpi && (
                <span title="Key performance indicator" className="rounded-md bg-[#FEF6D8] px-1.5 py-0.5 text-[11px] font-bold text-[#7A5B00]">KPI</span>
              )}
            </h3>
            {resultTitle && <p className="mt-1 truncate text-xs text-[#667085]" title={resultTitle}>{resultTitle}</p>}
          </div>
          <StatusPill status={p.status} />
        </div>

        <div className="mt-4 grid gap-5 md:grid-cols-[minmax(0,260px)_minmax(0,1fr)] md:items-center">
          <div>
            {p.target === null ? (
              <p className="text-sm text-[#98A2B3]">No target set</p>
            ) : (
              <>
                <div className="flex items-baseline justify-between gap-3">
                  <p className="tabular-nums">
                    <span className="text-2xl font-semibold tracking-tight text-[#101828]">{p.actual === null ? "-" : fmt(p.actual)}{p.actual === null ? "" : suffix}</span>
                    <span className="text-sm text-[#98A2B3]"> / {fmt(p.target)}{suffix}</span>
                  </p>
                  {p.pct !== null && <span className="text-sm font-semibold tabular-nums text-[#475467]">{p.pct}%</span>}
                </div>
                <div
                  className="mt-2 h-2.5 overflow-hidden rounded-full bg-[#EAECF0]"
                  role="progressbar"
                  aria-label={`Progress for ${ind.name}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={p.pct ?? 0}
                >
                  <div className="h-full rounded-full transition-[width]" style={{ width: `${p.pct ?? 0}%`, background: band.bar }} />
                </div>
                <p className="mt-1.5 text-xs text-[#98A2B3]">
                  {p.pace !== null ? `${p.pace}% of the target for the quarters reported` : "Waiting for the first approved value"}
                </p>
              </>
            )}
          </div>

          {p.rows.length > 0 && (
            <ul className="flex flex-wrap gap-2" aria-label={`Quarterly targets and results for ${ind.name}`}>
              {p.rows.map((r) => (
                <QuarterChip key={r.p} row={r} suffix={suffix} />
              ))}
            </ul>
          )}
        </div>

        <p className="mt-4 text-xs text-[#667085]">
          {[formatOf(ind), ind.unit || null, ind.frequency || "Quarterly", ind.baseline !== undefined && ind.baseline !== "" ? `Baseline ${fmt(ind.baseline)}` : null]
            .filter(Boolean)
            .join(" · ")}
          {p.waiting > 0 && <span className="ml-2 font-medium text-[#7A5C00]">{p.waiting} awaiting approval</span>}
        </p>

        {expanded && hasDetails && (
          <dl className="mt-3 grid gap-3 rounded-lg bg-[#F9FAFB] p-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-semibold text-[#667085]">Means of verification</dt>
              <dd className="mt-0.5 text-[#344054]">{ind.mov || "-"}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-[#667085]">Assumptions</dt>
              <dd className="mt-0.5 text-[#344054]">{ind.assumptions || "-"}</dd>
            </div>
          </dl>
        )}
      </div>

      {(hasDetails || canManage) && (
        <div className="flex flex-wrap items-center gap-2 border-t border-[#F2F4F7] bg-[#FCFCFD] px-5 py-2.5">
          {hasDetails && (
            <button type="button" onClick={onToggle} aria-expanded={expanded} className="text-xs font-semibold text-[#5B3FD0] hover:underline">
              {expanded ? "Hide details" : "Details"}
            </button>
          )}
          {canManage && (
            <div className="ml-auto flex gap-2">
              <button type="button" className={SMALL} disabled={busy} aria-label={`Edit ${ind.name}`} onClick={onEdit}>Edit</button>
              <button type="button" className={SMALL} disabled={busy} aria-label={`Duplicate ${ind.name}`} onClick={onDuplicate}>Duplicate</button>
              <button type="button" className={SMALL_DANGER} disabled={busy} aria-label={`Delete ${ind.name}`} onClick={onDelete}>Delete</button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function MEIndicators() {
  const { isAdmin, frameworks, selectedId, setSelectedId, data, fw, ordered, busy, error, run, reload } = useMEData();
  const [query, setQuery] = useState("");
  const [resultFilter, setResultFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sortBy, setSortBy] = useState("attention");
  const [drawer, setDrawer] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [expanded, setExpanded] = useState(new Set());
  const [access, setAccess] = useState({ isAdmin: false, departments: new Set() });
  const firstField = useRef(null);

  useEffect(() => {
    let mounted = true;
    getAccess().then((r) => mounted && setAccess(r)).catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  /* A new framework starts with clean filters */
  useEffect(() => {
    setQuery("");
    setResultFilter("");
    setStatusFilter("");
    setDrawer(false);
    setEditingId(null);
  }, [selectedId]);

  const canManage = Boolean(fw) && (isAdmin || access.departments.has(fw.area));

  /* Results to choose from: framework order first, with fallbacks if it is empty */
  const resultOptions = useMemo(() => {
    const list = ordered?.length ? ordered : data?.results || fw?.results || [];
    return list.map((r, i) => ({
      id: r.id,
      title: r.title || r.name || r.statement || String(r.id),
      depth: r.depth || 0,
      parentId: r.parentId || "",
      band: BANDS[i % BANDS.length],
    }));
  }, [ordered, data, fw]);
  const resultById = useMemo(() => new Map(resultOptions.map((r) => [r.id, r])), [resultOptions]);

  /* Progress for every indicator, computed once */
  const progress = useMemo(() => {
    const map = new Map();
    if (data && fw) data.indicators.forEach((i) => map.set(i.id, progressOf(i, data.values, fw.periods)));
    return map;
  }, [data, fw]);

  /* A chosen result also shows everything beneath it */
  const idsUnder = useMemo(() => {
    if (!resultFilter) return null;
    const ids = new Set([resultFilter]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const r of resultOptions) {
        if (!ids.has(r.id) && ids.has(r.parentId)) {
          ids.add(r.id);
          grew = true;
        }
      }
    }
    return ids;
  }, [resultFilter, resultOptions]);

  const inResult = useMemo(
    () => (data ? data.indicators.filter((i) => !idsUnder || idsUnder.has(i.resultId)) : []),
    [data, idsUnder]
  );

  const statusCounts = useMemo(() => {
    const c = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0]));
    inResult.forEach((i) => {
      const s = progress.get(i.id)?.status;
      if (s) c[s] += 1;
    });
    return c;
  }, [inResult, progress]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = inResult.filter(
      (i) => (!statusFilter || progress.get(i.id)?.status === statusFilter) && (!q || i.name.toLowerCase().includes(q))
    );
    const order = new Map(resultOptions.map((r, idx) => [r.id, idx]));
    const by = {
      attention: (a, b) =>
        SEVERITY[progress.get(a.id)?.status] - SEVERITY[progress.get(b.id)?.status] || a.name.localeCompare(b.name),
      framework: (a, b) => (order.get(a.resultId) ?? 0) - (order.get(b.resultId) ?? 0),
      name: (a, b) => a.name.localeCompare(b.name),
    };
    return [...list].sort(by[sortBy]);
  }, [inResult, query, statusFilter, sortBy, progress, resultOptions]);

  /* In framework order the cards sit under their result; otherwise it is one list */
  const sections = useMemo(() => {
    if (sortBy !== "framework") return [{ id: "all", result: null, items: shown }];
    return resultOptions
      .map((r) => ({ id: r.id, result: r, items: shown.filter((i) => i.resultId === r.id) }))
      .filter((s) => s.items.length > 0);
  }, [sortBy, shown, resultOptions]);

  const kpiCount = inResult.filter((i) => i.kpi).length;
  const filtering = Boolean(query || statusFilter || resultFilter);
  const clearFilters = () => {
    setQuery("");
    setStatusFilter("");
    setResultFilter("");
  };

  /* ---------- Form drawer ---------- */

  const openAdd = (resultId = "") => {
    setEditingId(null);
    setForm({ ...EMPTY, resultId: resultId || resultFilter });
    setDrawer(true);
  };

  const closeDrawer = () => {
    setDrawer(false);
    setEditingId(null);
    setForm(EMPTY);
  };

  const formFrom = (ind) => ({
    name: ind.name,
    resultId: ind.resultId,
    unit: ind.unit || "",
    baseline: ind.baseline ?? "",
    targets: { ...(ind.targets || {}) },
    mov: ind.mov || "",
    assumptions: ind.assumptions || "",
    format: formatOf(ind),
    frequency: ind.frequency || "Quarterly",
    kpi: Boolean(ind.kpi),
  });

  const startEdit = (ind) => {
    setEditingId(ind.id);
    setForm(formFrom(ind));
    setDrawer(true);
  };

  /* A copy opens as a new indicator, so a similar one takes seconds to add */
  const startDuplicate = (ind) => {
    setEditingId(null);
    setForm({ ...formFrom(ind), name: `${ind.name} (copy)` });
    setDrawer(true);
  };

  useEffect(() => {
    if (!drawer) return undefined;
    const t = setTimeout(() => firstField.current?.focus(), 50);
    const onKey = (e) => e.key === "Escape" && closeDrawer();
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [drawer]);

  const saveIndicator = (addAnother = false) =>
    run(async () => {
      if (!form.name.trim()) throw new Error("Give the indicator a name.");
      if (!form.resultId) throw new Error("Choose the result it measures.");
      const body = {
        name: form.name.trim(),
        unit: form.unit.trim(),
        ...(form.baseline !== "" ? { baseline: Number(form.baseline) } : {}),
        targets: cleanTargets(form.targets),
        mov: form.mov.trim(),
        assumptions: form.assumptions.trim(),
        resultId: form.resultId,
        format: form.format,
        frequency: form.frequency.trim(),
        kpi: form.kpi,
      };
      if (editingId) {
        await api(`/me/frameworks/${selectedId}/indicators/${editingId}`, { method: "PUT", body });
        closeDrawer();
      } else {
        await api(`/me/frameworks/${selectedId}/indicators`, { method: "POST", body });
        if (addAnother) {
          setForm({ ...EMPTY, resultId: form.resultId });
          firstField.current?.focus();
        } else {
          closeDrawer();
        }
      }
      await reload();
    });

  const deleteIndicator = (ind) => {
    const reported = data.values.filter((v) => v.indicatorId === ind.id).length;
    const warning = reported
      ? `\n\nThis also deletes ${reported} reported ${reported === 1 ? "value" : "values"}, including any that were approved.`
      : "";
    if (!window.confirm(`Delete the indicator "${ind.name}"?${warning}\n\nThis cannot be undone.`)) return;
    run(async () => {
      await api(`/me/frameworks/${selectedId}/indicators/${ind.id}`, { method: "DELETE" });
      if (editingId === ind.id) closeDrawer();
      await reload();
    });
  };

  const toggleExpanded = (id) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const area = fw ? areaName(fw.area) : "";
  const total = data ? data.indicators.length : 0;
  const activeStatuses = STATUS_ORDER.filter((s) => statusCounts[s] > 0);

  return (
    <Page>
      <PageHead title="Indicators" subtitle={fw ? `${fw.name}, ${area}` : ""}>
        <FrameworkSelect frameworks={frameworks} value={selectedId} onChange={setSelectedId} />
        {canManage && (
          <button type="button" onClick={() => openAdd()} className={BTN}>
            Add indicator
          </button>
        )}
      </PageHead>

      <ErrorBar error={error} />
      {!fw && <NoFramework isAdmin={isAdmin} busy={busy} />}

      {fw && data && (
        <>
          {/* Summary: how the indicators stand, and a way to filter by status */}
          <section aria-label="Indicator summary" className={`${CARD} p-5`}>
            <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
              <div>
                <p className="text-3xl font-semibold tracking-tight tabular-nums text-[#101828]">
                  {inResult.length}
                  <span className="ml-2 text-base font-medium text-[#667085]">{inResult.length === 1 ? "indicator" : "indicators"}</span>
                </p>
                <p className="mt-0.5 text-xs text-[#667085]">
                  {resultFilter ? `Under ${resultById.get(resultFilter)?.title ?? "this result"}` : `Across ${resultOptions.length} ${resultOptions.length === 1 ? "result" : "results"}`}
                  {kpiCount > 0 ? ` · ${kpiCount} ${kpiCount === 1 ? "KPI" : "KPIs"}` : ""}
                </p>
              </div>

              <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  aria-pressed={!statusFilter}
                  onClick={() => setStatusFilter("")}
                  className={`rounded-full px-3.5 py-1.5 text-[13px] font-medium transition ${
                    !statusFilter ? "bg-[#EDE9FB] text-[#5B3FD0]" : "text-[#475467] ring-1 ring-inset ring-[#E5E7EB] hover:bg-[#F4F5F7]"
                  }`}
                >
                  All <span className="ml-1 tabular-nums opacity-70">{inResult.length}</span>
                </button>
                {activeStatuses.map((s) => (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={statusFilter === s}
                    onClick={() => setStatusFilter(statusFilter === s ? "" : s)}
                    className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition ${
                      statusFilter === s ? "bg-[#EDE9FB] text-[#5B3FD0]" : "text-[#475467] ring-1 ring-inset ring-[#E5E7EB] hover:bg-[#F4F5F7]"
                    }`}
                  >
                    <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: STATUS_STYLE[s].dot }} />
                    {s} <span className="tabular-nums opacity-70">{statusCounts[s]}</span>
                  </button>
                ))}
              </div>
            </div>

            {inResult.length > 0 && (
              <div className="mt-4 flex h-2 gap-0.5 overflow-hidden rounded-full bg-[#EEF0F4]" role="img" aria-label={activeStatuses.map((s) => `${s}: ${statusCounts[s]}`).join(", ")}>
                {activeStatuses.map((s) => (
                  <div key={s} title={`${s}: ${statusCounts[s]}`} style={{ width: `${(statusCounts[s] / inResult.length) * 100}%`, background: STATUS_STYLE[s].dot }} />
                ))}
              </div>
            )}
          </section>

          <div className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
            {/* Results navigator */}
            <nav aria-label="Results" className="hidden lg:block">
              <div className={`${CARD} sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto p-3`}>
                <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-[#667085]">Results</p>
                <ul className="space-y-0.5">
                  <li>
                    <button
                      type="button"
                      aria-current={!resultFilter ? "true" : undefined}
                      onClick={() => setResultFilter("")}
                      className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-[13px] transition ${
                        !resultFilter ? "bg-[#EDE9FB] font-semibold text-[#5B3FD0]" : "text-[#475467] hover:bg-[#F4F5F7]"
                      }`}
                    >
                      All results
                      <span className="tabular-nums text-xs opacity-70">{total}</span>
                    </button>
                  </li>
                  {resultOptions.map((r) => {
                    const own = data.indicators.filter((i) => i.resultId === r.id).length;
                    const active = resultFilter === r.id;
                    return (
                      <li key={r.id} style={{ paddingLeft: `${r.depth * 12}px` }}>
                        <button
                          type="button"
                          aria-current={active ? "true" : undefined}
                          onClick={() => setResultFilter(active ? "" : r.id)}
                          title={r.title}
                          className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] transition ${
                            active ? "bg-[#EDE9FB] font-semibold text-[#5B3FD0]" : "text-[#475467] hover:bg-[#F4F5F7]"
                          }`}
                        >
                          <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: r.band.bar }} />
                          <span className="min-w-0 flex-1 truncate">{r.title}</span>
                          <span className="tabular-nums text-xs opacity-70">{own}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </nav>

            <div className="min-w-0 space-y-4">
              {/* Toolbar */}
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="search"
                  className={`${FIELD} w-full sm:w-64`}
                  aria-label="Search indicators"
                  placeholder="Search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <select className={`${FIELD} max-w-[260px] lg:hidden`} aria-label="Filter by result" value={resultFilter} onChange={(e) => setResultFilter(e.target.value)}>
                  <option value="">All results</option>
                  {resultOptions.map((r) => (
                    <option key={r.id} value={r.id} style={{ color: "#101828", background: "#FFFFFF" }}>{r.title}</option>
                  ))}
                </select>
                <label className="ml-auto flex items-center gap-2 text-xs font-medium text-[#475467]">
                  Sort
                  <select className={FIELD} value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                    {SORTS.map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </label>
                {filtering && (
                  <button type="button" onClick={clearFilters} className="text-xs font-semibold text-[#00664E] hover:underline">
                    Clear filters
                  </button>
                )}
              </div>

              {shown.length === 0 && (
                <div className={`${CARD} px-6 py-14 text-center`}>
                  <p className="text-sm font-medium text-[#101828]">{total === 0 ? "No indicators yet" : "No indicators match"}</p>
                  <p className="mx-auto mt-1 max-w-sm text-sm text-[#667085]">
                    {total === 0
                      ? resultOptions.length === 0
                        ? "Add a result on the Frameworks page first, then add indicators to it."
                        : canManage
                          ? "Add the first indicator to start tracking targets."
                          : "Indicators appear here once they are added."
                      : "Try a different search, or clear the filters."}
                  </p>
                  {total === 0 && canManage && resultOptions.length > 0 && (
                    <button type="button" onClick={() => openAdd()} className={`${BTN} mt-5`}>Add indicator</button>
                  )}
                </div>
              )}

              {sections.map((s) => (
                <section key={s.id} aria-label={s.result?.title || "Indicators"} className="space-y-3">
                  {s.result && (
                    <div
                      className="flex items-center gap-2 rounded-lg border-l-4 px-4 py-2.5 text-sm font-semibold"
                      style={{ background: s.result.band.bg, borderLeftColor: s.result.band.bar, color: s.result.band.text }}
                    >
                      <span className="min-w-0 flex-1 truncate">{s.result.title}</span>
                      <span className="rounded-full bg-white/80 px-2.5 py-0.5 text-xs font-semibold">{s.items.length}</span>
                      {canManage && (
                        <button type="button" className="rounded-md bg-white/80 px-2.5 py-1 text-xs font-semibold hover:bg-white" onClick={() => openAdd(s.result.id)}>
                          Add indicator
                        </button>
                      )}
                    </div>
                  )}
                  <div className="space-y-3">
                    {s.items.map((ind) => {
                      const res = resultById.get(ind.resultId);
                      return (
                        <IndicatorCard
                          key={ind.id}
                          ind={ind}
                          p={progress.get(ind.id) || progressOf(ind, data.values, fw.periods)}
                          band={res?.band ?? BANDS[0]}
                          resultTitle={s.result ? "" : res?.title}
                          canManage={canManage}
                          busy={busy}
                          expanded={expanded.has(ind.id)}
                          onToggle={() => toggleExpanded(ind.id)}
                          onEdit={() => startEdit(ind)}
                          onDuplicate={() => startDuplicate(ind)}
                          onDelete={() => deleteIndicator(ind)}
                        />
                      );
                    })}
                  </div>
                </section>
              ))}

              <p className="text-xs text-[#98A2B3]">
                Progress uses approved values only. Counts add up the approved quarters against the total of all quarterly targets. Percentages use the latest approved value against the final target. The status compares the result with the targets for the quarters already reported: 90% or more is on track, 50% to 89% has minor delays, and below 50% is off track.
              </p>
            </div>
          </div>
        </>
      )}

      {/* Add or edit, in a panel that slides in from the right */}
      {fw && drawer && canManage && (
        <div className="fixed inset-0 z-50 flex justify-end" role="presentation">
          <button type="button" aria-label="Close" tabIndex={-1} className="absolute inset-0 bg-[#101828]/40" onClick={closeDrawer} />
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="indicator-form-title"
            className="relative flex h-full w-full max-w-xl flex-col bg-white shadow-2xl"
          >
            <header className="flex items-center justify-between gap-3 border-b border-[#EAECF0] px-6 py-4">
              <h2 id="indicator-form-title" className="text-lg font-semibold text-[#101828]">
                {editingId ? "Edit indicator" : "Add indicator"}
              </h2>
              <button type="button" onClick={closeDrawer} className={SMALL} aria-label="Close">Close</button>
            </header>

            <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
              <ErrorBar error={error} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Indicator name" className="sm:col-span-2">
                  <input ref={firstField} className={FIELD} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </Field>
                <Field label="Result" className="sm:col-span-2">
                  <select className={`${FIELD} w-full`} value={form.resultId} onChange={(e) => setForm({ ...form, resultId: e.target.value })}>
                    <option value="">Choose a result</option>
                    {resultOptions.map((r) => (
                      <option key={r.id} value={r.id} style={{ color: "#101828", background: "#FFFFFF" }}>{r.title}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Format">
                  <select className={FIELD} value={form.format} onChange={(e) => setForm({ ...form, format: e.target.value })}>
                    {FORMATS.map((f) => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Unit">
                  <input className={FIELD} value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
                </Field>
                <Field label="Baseline">
                  <input type="number" className={FIELD} value={form.baseline} onChange={(e) => setForm({ ...form, baseline: e.target.value })} />
                </Field>
                <Field label="Collection frequency">
                  <select className={FIELD} value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })}>
                    {[...new Set([...FREQUENCIES, form.frequency].filter(Boolean))].map((f) => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                </Field>
                <label className="flex h-[42px] cursor-pointer items-center gap-2.5 rounded-lg border border-[#D0D5DD] bg-white px-3.5 text-sm font-medium text-[#344054] hover:bg-[#F9FAFB] sm:col-span-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[#00664E]"
                    checked={form.kpi}
                    onChange={(e) => setForm({ ...form, kpi: e.target.checked })}
                  />
                  Key performance indicator (KPI)
                </label>
              </div>

              <div className="border-t border-[#EAECF0] pt-5">
                <p className="mb-3 text-xs font-semibold text-[#344054]">Quarterly targets</p>
                <TargetsInput periods={fw.periods} value={form.targets} onChange={(targets) => setForm({ ...form, targets })} />
              </div>

              <div className="grid gap-4 border-t border-[#EAECF0] pt-5">
                <Field label="Means of verification">
                  <input className={FIELD} value={form.mov} onChange={(e) => setForm({ ...form, mov: e.target.value })} />
                </Field>
                <Field label="Assumptions">
                  <input className={FIELD} value={form.assumptions} onChange={(e) => setForm({ ...form, assumptions: e.target.value })} />
                </Field>
              </div>
            </div>

            <footer className="flex flex-wrap justify-end gap-2 border-t border-[#EAECF0] bg-[#FCFCFD] px-6 py-4">
              <button type="button" onClick={closeDrawer} className={BTN_LIGHT}>Cancel</button>
              {!editingId && (
                <button type="button" onClick={() => saveIndicator(true)} disabled={busy} className={BTN_LIGHT}>
                  Save and add another
                </button>
              )}
              <button type="button" onClick={() => saveIndicator(false)} disabled={busy} className={BTN}>
                {editingId ? "Save changes" : "Add indicator"}
              </button>
            </footer>
          </section>
        </div>
      )}
    </Page>
  );
}

export default MEIndicators;
