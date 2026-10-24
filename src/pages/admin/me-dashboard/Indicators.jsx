import { useEffect, useMemo, useState } from "react";
import { DEPARTMENT_AREAS, PROGRAM_AREAS, getAccess } from "../../../access";
import { api } from "../../../meApi";
import {
  BTN, BTN_LIGHT, CARD, CardHead, ErrorBar, FIELD, FrameworkSelect, NoFramework, Page, PageHead,
  TargetsInput, cleanTargets, useMEData,
} from "./Shared";

const AREAS = [...PROGRAM_AREAS, ...DEPARTMENT_AREAS];
const areaName = (slug) => AREAS.find((a) => a.slug === slug)?.name || slug || "No area";

const EMPTY = {
  name: "", resultId: "", unit: "", baseline: "", targets: {}, mov: "", assumptions: "",
  format: "Numeric", frequency: "Quarterly", kpi: false,
};

const FORMATS = ["Numeric", "Percentage", "Qualitative only"];
const STATUSES = ["Achieved", "On track", "Minor delays", "Off track", "No data yet", "No target"];
const FREQUENCIES = ["Monthly", "Quarterly", "Biannual", "Annual"];

const GRID = "grid grid-cols-[minmax(260px,3fr)_minmax(200px,2fr)_110px_130px_140px_120px] items-center gap-4";

const SMALL =
  "rounded-md border border-[#D0D5DD] bg-white px-3 py-1.5 text-xs font-semibold text-[#344054] transition hover:bg-[#F4F5F7] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00664E] disabled:cursor-not-allowed disabled:opacity-50";
const SMALL_DANGER =
  "rounded-md border border-[#FDA29B] bg-white px-3 py-1.5 text-xs font-semibold text-[#B42318] transition hover:bg-[#FEF3F2] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B42318] disabled:cursor-not-allowed disabled:opacity-50";

/* Result group colours, cycled by position */
const BANDS = [
  { bg: "#E9F6F1", bar: "#00664E", text: "#064E3B" },
  { bg: "#EEEBFB", bar: "#5B3FD0", text: "#3B2A8F" },
  { bg: "#FEF6D8", bar: "#CA9A04", text: "#7A5B00" },
  { bg: "#E8F1FD", bar: "#2E6FD8", text: "#1E4C9A" },
];

const STATUS_STYLE = {
  Achieved: { dot: "#067647", bg: "#ECFDF3", text: "#067647" },
  "On track": { dot: "#17B26A", bg: "#ECFDF3", text: "#067647" },
  "Minor delays": { dot: "#CA9A04", bg: "#FEF6D8", text: "#7A5B00" },
  "Off track": { dot: "#D92D20", bg: "#FEF3F2", text: "#B42318" },
  "No data yet": { dot: "#98A2B3", bg: "#F2F4F7", text: "#475467" },
  "No target": { dot: "#D0D5DD", bg: "#F9FAFB", text: "#667085" },
};

const formatOf = (ind) =>
  ind.format || (/%|percent/i.test(ind.unit || "") ? "Percentage" : "Numeric");

/* Latest approved value for an indicator, and the target it is measured against. */
function progressOf(ind, values, periods) {
  const idx = (v) => (periods || []).indexOf(v.period);
  const mine = values
    .filter((v) => v.indicatorId === ind.id && v.status === "approved" && (v.actual ?? v.value) != null)
    .sort((a, b) => idx(a) - idx(b));
  const latest = mine[mine.length - 1];
  const targets = ind.targets || {};
  const ordered = (periods || Object.keys(targets)).filter((p) => targets[p] !== undefined && targets[p] !== "");
  const isPct = formatOf(ind) === "Percentage";
  /* Percentages: the final target. Counts: the sum across periods. */
  const target = ordered.length
    ? isPct
      ? Number(targets[ordered[ordered.length - 1]])
      : ordered.reduce((s, p) => s + Number(targets[p] || 0), 0)
    : null;
  const actual = latest ? Number(latest.actual ?? latest.value) : null;
  const pct = actual != null && target ? Math.min(100, Math.round((actual / target) * 100)) : null;
  const status =
    target == null ? "No target"
    : pct == null ? "No data yet"
    : pct >= 100 ? "Achieved"
    : pct >= 75 ? "On track"
    : pct >= 40 ? "Minor delays"
    : "Off track";
  return { actual, target, pct, status, last: latest?.period || "", isPct };
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
  if (!status) return <span className="text-[#98A2B3]">-</span>;
  const s = STATUS_STYLE[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
      style={{ background: s.bg, color: s.text }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.dot }} />
      {status}
    </span>
  );
}

function Stat({ label, value, color }) {
  return (
    <div className={`${CARD} flex items-center gap-3 px-5 py-4`}>
      <span className="h-9 w-1.5 rounded-full" style={{ background: color }} aria-hidden="true" />
      <div>
        <p className="text-2xl font-semibold leading-none text-[#101828]">{value}</p>
        <p className="mt-1.5 text-xs font-medium text-[#667085]">{label}</p>
      </div>
    </div>
  );
}

function MEIndicators() {
  const { isAdmin, frameworks, selectedId, setSelectedId, data, fw, ordered, busy, error, run, reload } = useMEData();
  const [query, setQuery] = useState("");
  const [resultFilter, setResultFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [collapsed, setCollapsed] = useState(new Set());
  const [access, setAccess] = useState({ isAdmin: false, departments: new Set() });
  useEffect(() => {
    let mounted = true;
    getAccess().then((r) => mounted && setAccess(r)).catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const canManage = Boolean(fw) && (isAdmin || access.departments.has(fw.area));

  /* Results to choose from: framework order first, with fallbacks if it is empty */
  const resultOptions = useMemo(() => {
    const list = ordered?.length ? ordered : data?.results || fw?.results || [];
    return list.map((r) => ({ id: r.id, title: r.title || r.name || r.statement || String(r.id) }));
  }, [ordered, data, fw]);

  /* Progress for every indicator, computed once */
  const progress = useMemo(() => {
    const map = new Map();
    if (data && fw) data.indicators.forEach((i) => map.set(i.id, progressOf(i, data.values, fw.periods)));
    return map;
  }, [data, fw]);

  const summary = useMemo(() => {
    const all = data ? data.indicators : [];
    const st = (i) => progress.get(i.id)?.status || "";
    return {
      total: all.length,
      kpis: all.filter((i) => i.kpi).length,
      good: all.filter((i) => st(i) === "Achieved" || st(i) === "On track").length,
      attention: all.filter((i) => st(i) === "Minor delays" || st(i) === "Off track").length,
    };
  }, [data, progress]);

  const shown = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.indicators.filter(
      (i) =>
        (!resultFilter || i.resultId === resultFilter) &&
        (!statusFilter || progress.get(i.id)?.status === statusFilter) &&
        (!q || i.name.toLowerCase().includes(q))
    );
  }, [data, query, resultFilter, statusFilter, progress]);

  /* Indicators grouped under their result, in framework order, empty groups hidden */
  const groups = useMemo(
    () =>
      ordered
        .map((r, i) => ({ result: r, band: BANDS[i % BANDS.length], items: shown.filter((x) => x.resultId === r.id) }))
        .filter((g) => g.items.length > 0),
    [ordered, shown]
  );

  const filtering = Boolean(query || resultFilter || statusFilter);
  const clearFilters = () => {
    setQuery("");
    setResultFilter("");
    setStatusFilter("");
  };

  const toggleGroup = (id) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const allCollapsed = groups.length > 0 && groups.every((g) => collapsed.has(g.result.id));
  const toggleAll = () => setCollapsed(allCollapsed ? new Set() : new Set(groups.map((g) => g.result.id)));

  const openAdd = () => {
    if (showForm && !editingId) {
      setShowForm(false);
      return;
    }
    setEditingId(null);
    setForm(EMPTY);
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY);
  };

  const startEdit = (ind) => {
    setEditingId(ind.id);
    setForm({
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
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const saveIndicator = () =>
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
        closeForm();
      } else {
        await api(`/me/frameworks/${selectedId}/indicators`, { method: "POST", body });
        setForm({ ...EMPTY, resultId: form.resultId });
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
      if (editingId === ind.id) closeForm();
      await reload();
    });
  };

  const area = fw ? areaName(fw.area) : "";

  return (
    <Page>
      <PageHead title="Indicators" subtitle={fw ? `${fw.name}, ${area}` : ""}>
        <FrameworkSelect frameworks={frameworks} value={selectedId} onChange={setSelectedId} />
        {canManage && (
          <button type="button" onClick={openAdd} className={BTN}>
            {showForm && !editingId ? "Close" : "Add indicator"}
          </button>
        )}
      </PageHead>

      <ErrorBar error={error} />
      {!fw && <NoFramework isAdmin={isAdmin} busy={busy} />}

      {fw && data && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Indicators" value={summary.total} color="#344054" />
          <Stat label="KPIs" value={summary.kpis} color="#CA9A04" />
          <Stat label="On track" value={summary.good} color="#17B26A" />
          <Stat label="Needs attention" value={summary.attention} color="#D92D20" />
        </div>
      )}

      {fw && showForm && canManage && (
        <section className={`${CARD} p-6`} aria-label={editingId ? "Edit indicator" : "Add indicator"}>
          <CardHead title={editingId ? "Edit indicator" : "Add indicator"} />

          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Indicator name" className="sm:col-span-2">
                <input className={FIELD} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              <Field label="Result">
                <select
                  className={`${FIELD} w-full`}
                  value={form.resultId}
                  onChange={(e) => setForm({ ...form, resultId: e.target.value })}
                >
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
              <div className="flex items-end">
                <label className="flex h-[42px] cursor-pointer items-center gap-2.5 rounded-lg border border-[#D0D5DD] bg-white px-3.5 text-sm font-medium text-[#344054] hover:bg-[#F9FAFB]">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[#00664E]"
                    checked={form.kpi}
                    onChange={(e) => setForm({ ...form, kpi: e.target.checked })}
                  />
                  KPI
                </label>
              </div>
            </div>

            <div className="grid gap-4 border-t border-[#EAECF0] pt-6 sm:grid-cols-2">
              <Field label="Means of verification">
                <input className={FIELD} value={form.mov} onChange={(e) => setForm({ ...form, mov: e.target.value })} />
              </Field>
              <Field label="Assumptions">
                <input className={FIELD} value={form.assumptions} onChange={(e) => setForm({ ...form, assumptions: e.target.value })} />
              </Field>
            </div>

            <div className="border-t border-[#EAECF0] pt-6">
              <p className="mb-3 text-xs font-semibold text-[#344054]">Quarterly targets</p>
              <TargetsInput periods={fw.periods} value={form.targets} onChange={(targets) => setForm({ ...form, targets })} />
            </div>
          </div>

          <div className="mt-6 flex justify-end gap-2 border-t border-[#EAECF0] pt-4">
            <button type="button" onClick={closeForm} className={BTN_LIGHT}>Cancel</button>
            <button type="button" onClick={saveIndicator} disabled={busy} className={BTN}>
              {editingId ? "Save changes" : "Add indicator"}
            </button>
          </div>
        </section>
      )}

      {fw && (
        <section aria-label="Indicators" className={`${CARD} overflow-hidden`}>
          <div className="flex flex-wrap items-center gap-2 border-b border-[#EAECF0] p-4">
            <input
              type="search"
              className={`${FIELD} w-full sm:w-64`}
              aria-label="Search indicators"
              placeholder="Search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select className={`${FIELD} max-w-[260px]`} aria-label="Filter by result" value={resultFilter} onChange={(e) => setResultFilter(e.target.value)}>
              <option value="">All results</option>
              {resultOptions.map((r) => (
                <option key={r.id} value={r.id} style={{ color: "#101828", background: "#FFFFFF" }}>{r.title}</option>
              ))}
            </select>
            <select className={FIELD} aria-label="Filter by status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            {filtering && (
              <button type="button" onClick={clearFilters} className="text-xs font-semibold text-[#00664E] hover:underline">
                Clear
              </button>
            )}
            <button type="button" onClick={toggleAll} className={`${SMALL} ml-auto`} disabled={groups.length === 0}>
              {allCollapsed ? "Expand all" : "Collapse all"}
            </button>
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[960px] text-sm">
              <div className={`${GRID} border-b border-[#E5E7EB] bg-[#F9FAFB] px-5 py-3 text-xs font-semibold text-[#667085]`}>
                <span>Indicator</span>
                <span>Progress vs quarterly targets</span>
                <span>Format</span>
                <span>Frequency</span>
                <span>Status</span>
                <span className="text-right">{canManage ? "Actions" : ""}</span>
              </div>

              {groups.length === 0 && (
                <p className="px-5 py-12 text-center text-sm text-[#98A2B3]">No indicators</p>
              )}

              {groups.map(({ result, band, items }) => {
                const open = !collapsed.has(result.id);
                return (
                  <div key={result.id} className="border-b border-[#EAECF0] last:border-b-0">
                    <button
                      type="button"
                      onClick={() => toggleGroup(result.id)}
                      aria-expanded={open}
                      className="flex w-full items-center gap-3 border-l-4 px-5 py-3 text-left text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#00664E]"
                      style={{ background: band.bg, borderLeftColor: band.bar, color: band.text }}
                    >
                      <svg
                        width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true"
                        className={`shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
                      >
                        <path d="M7 4l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <span className="min-w-0 flex-1 truncate">{result.title}</span>
                      <span className="rounded-full bg-white/80 px-2.5 py-0.5 text-xs font-semibold">{items.length}</span>
                    </button>

                    {open &&
                      items.map((ind) => {
                        const p = progress.get(ind.id) || progressOf(ind, data.values, fw.periods);
                        const suffix = p.isPct ? "%" : "";
                        return (
                          <div
                            key={ind.id}
                            className={`${GRID} border-t border-[#F2F4F7] px-5 py-4 transition-colors hover:bg-[#FCFCFD]`}
                          >
                            <div className="flex min-w-0 items-center gap-2">
                              <p className="min-w-0 font-medium leading-snug text-[#101828]">{ind.name}</p>
                              {ind.kpi && (
                                <span
                                  title="Key performance indicator"
                                  className="shrink-0 rounded-md bg-[#FEF6D8] px-1.5 py-0.5 text-[11px] font-bold text-[#7A5B00]"
                                >
                                  KPI
                                </span>
                              )}
                            </div>

                            <div>
                              {p.actual == null && p.target == null ? (
                                <span className="text-[#98A2B3]">-</span>
                              ) : (
                                <>
                                  <div className="flex items-baseline justify-between gap-2">
                                    <p className="text-sm font-semibold text-[#101828]">
                                      {p.actual ?? "-"}{suffix}
                                      <span className="font-normal text-[#98A2B3]"> / {p.target ?? "-"}{suffix}</span>
                                    </p>
                                    {p.pct != null && <span className="text-xs font-semibold text-[#475467]">{p.pct}%</span>}
                                  </div>
                                  <div
                                    className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-[#EAECF0]"
                                    role="progressbar"
                                    aria-label={`Progress for ${ind.name}`}
                                    aria-valuemin={0}
                                    aria-valuemax={100}
                                    aria-valuenow={p.pct ?? 0}
                                  >
                                    <div
                                      className="h-full rounded-full transition-[width]"
                                      style={{ width: `${p.pct ?? 0}%`, background: band.bar }}
                                    />
                                  </div>
                                  <div className="mt-1.5 flex flex-wrap gap-1">
                                    {(fw.periods || [])
                                      .filter((q) => ind.targets?.[q] !== undefined && ind.targets[q] !== "")
                                      .map((q) => (
                                        <span
                                          key={q}
                                          title={`${q} target`}
                                          className="rounded bg-[#F2F4F7] px-1.5 py-0.5 text-[11px] font-medium text-[#475467]"
                                        >
                                          {q.replace(/^\d{4}-/, "")}: {ind.targets[q]}{suffix}
                                        </span>
                                      ))}
                                  </div>
                                </>
                              )}
                            </div>

                            <span className="text-[#475467]">{formatOf(ind)}</span>
                            <span className="text-[#475467]">{ind.frequency || "Quarterly"}</span>
                            <span><StatusPill status={p.status} /></span>

                            {canManage ? (
                              <div className="flex justify-end gap-2">
                                <button type="button" className={SMALL} disabled={busy} aria-label={`Edit ${ind.name}`} onClick={() => startEdit(ind)}>
                                  Edit
                                </button>
                                <button type="button" className={SMALL_DANGER} disabled={busy} aria-label={`Delete ${ind.name}`} onClick={() => deleteIndicator(ind)}>
                                  Delete
                                </button>
                              </div>
                            ) : (
                              <span />
                            )}
                          </div>
                        );
                      })}
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}
    </Page>
  );
}

export default MEIndicators;
