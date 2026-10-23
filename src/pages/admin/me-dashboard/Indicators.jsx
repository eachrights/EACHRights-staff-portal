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
  format: "Numeric", frequency: "", kpi: false,
};

const FORMATS = ["Numeric", "Percentage", "Qualitative only"];

const SMALL =
  "rounded-md border border-[#D0D5DD] bg-white px-2.5 py-1 text-xs font-semibold text-[#344054] transition hover:bg-[#F4F5F7] disabled:cursor-not-allowed disabled:opacity-50";
const SMALL_DANGER =
  "rounded-md border border-[#FDA29B] bg-white px-2.5 py-1 text-xs font-semibold text-[#B42318] transition hover:bg-[#FEF3F2] disabled:cursor-not-allowed disabled:opacity-50";

/* Header band colours, cycled by result position (like TolaData's level colours) */
const BANDS = [
  { bg: "#E9F6F1", bar: "#00664E", text: "#064E3B" },
  { bg: "#EEEBFB", bar: "#5B3FD0", text: "#3B2A8F" },
  { bg: "#FEF6D8", bar: "#CA9A04", text: "#7A5B00" },
  { bg: "#E8F1FD", bar: "#2E6FD8", text: "#1E4C9A" },
];

const STATUS_STYLE = {
  Achieved: "#067647",
  "On track": "#067647",
  "Minor delays": "#CA9A04",
  "Off track": "#B42318",
};

const formatOf = (ind) =>
  ind.format || (/%|percent/i.test(ind.unit || "") ? "Percentage" : "Numeric");

/* Latest reported value for an indicator, and the target it is measured against.
   Values look like { indicatorId, period, actual, status }. */
function progressOf(ind, values, periods) {
  const idx = (v) => (periods || []).indexOf(v.period);
  /* Only approved values count towards progress, as elsewhere in the portal */
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
  const status = pct == null ? "" : pct >= 100 ? "Achieved" : pct >= 75 ? "On track" : pct >= 40 ? "Minor delays" : "Off track";
  return { actual, target, pct, status, last: latest?.period || "", isPct };
}

function MEIndicators() {
  const { isAdmin, frameworks, selectedId, setSelectedId, data, fw, ordered, busy, error, run, reload } = useMEData();
  const [query, setQuery] = useState("");
  const [resultFilter, setResultFilter] = useState("");
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

  const shown = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.indicators.filter(
      (i) => (!resultFilter || i.resultId === resultFilter) && (!q || i.name.toLowerCase().includes(q))
    );
  }, [data, query, resultFilter]);

  /* Indicators grouped under their result, in framework order, empty groups hidden */
  const groups = useMemo(
    () =>
      ordered
        .map((r, i) => ({ result: r, band: BANDS[i % BANDS.length], items: shown.filter((x) => x.resultId === r.id) }))
        .filter((g) => g.items.length > 0),
    [ordered, shown]
  );

  const toggleGroup = (id) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

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
      frequency: ind.frequency || "",
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
      <PageHead title="Indicators" subtitle={fw ? `${data.indicators.length} indicators in ${fw.name}, ${area}` : "Indicators, targets and how they are verified."}>
        <FrameworkSelect frameworks={frameworks} value={selectedId} onChange={setSelectedId} />
        {canManage && (
          <button type="button" onClick={openAdd} className={BTN}>
            {showForm && !editingId ? "Close" : "Add indicator"}
          </button>
        )}
      </PageHead>

      <ErrorBar error={error} />
      {!fw && <NoFramework isAdmin={isAdmin} busy={busy} />}

      {fw && showForm && canManage && (
        <section className={`${CARD} p-5`} aria-label={editingId ? "Edit indicator" : "Add indicator"}>
          <CardHead
            title={editingId ? "Edit indicator" : "Add an indicator"}
            subtitle={
              editingId
                ? "Reported values and any strategic link are kept."
                : "Targets are set per reporting period. Leave a period empty if nothing is expected."
            }
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <input className={`${FIELD} sm:col-span-2`} placeholder="Indicator name" aria-label="Indicator name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <select className={FIELD} aria-label="Result" value={form.resultId} onChange={(e) => setForm({ ...form, resultId: e.target.value })}>
              <option value="">Choose a result</option>
              {ordered.map((r) => (
                <option key={r.id} value={r.id}>{r.title}</option>
              ))}
            </select>
            <div className="grid grid-cols-2 gap-3">
              <input className={FIELD} placeholder="Unit (%, people)" aria-label="Unit" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
              <input type="number" className={FIELD} placeholder="Baseline" aria-label="Baseline" value={form.baseline} onChange={(e) => setForm({ ...form, baseline: e.target.value })} />
            </div>
            <select className={FIELD} aria-label="Format" value={form.format} onChange={(e) => setForm({ ...form, format: e.target.value })}>
              {FORMATS.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
            <input className={FIELD} placeholder="Collection frequency (Monthly)" aria-label="Collection frequency" value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })} />
            <input className={FIELD} placeholder="Means of verification" aria-label="Means of verification" value={form.mov} onChange={(e) => setForm({ ...form, mov: e.target.value })} />
            <input className={FIELD} placeholder="Assumptions" aria-label="Assumptions" value={form.assumptions} onChange={(e) => setForm({ ...form, assumptions: e.target.value })} />
            <label className="flex items-center gap-2 text-sm text-[#344054]">
              <input type="checkbox" checked={form.kpi} onChange={(e) => setForm({ ...form, kpi: e.target.checked })} />
              Key performance indicator (KPI)
            </label>
          </div>
          <div className="mt-4">
            <TargetsInput periods={fw.periods} value={form.targets} onChange={(targets) => setForm({ ...form, targets })} />
          </div>
          <div className="mt-4 flex gap-2">
            <button type="button" onClick={saveIndicator} disabled={busy} className={BTN}>
              {editingId ? "Save changes" : "Add indicator"}
            </button>
            <button type="button" onClick={closeForm} className={BTN_LIGHT}>{editingId ? "Cancel" : "Close"}</button>
          </div>
        </section>
      )}

      {fw && (
        <section aria-label="Indicators" className={`${CARD} overflow-x-auto`}>
          <div className="flex flex-wrap items-center gap-2 p-4">
            <p className="mr-auto text-xs font-medium text-[#667085]">
              {shown.length} {shown.length === 1 ? "indicator" : "indicators"} across {groups.length} {groups.length === 1 ? "group" : "groups"}
            </p>
            <input className={`${FIELD} w-64`} placeholder="Search indicators" aria-label="Search indicators" value={query} onChange={(e) => setQuery(e.target.value)} />
            <select className={FIELD} aria-label="Filter by result" value={resultFilter} onChange={(e) => setResultFilter(e.target.value)}>
              <option value="">All results</option>
              {ordered.map((r) => (
                <option key={r.id} value={r.id}>{r.title}</option>
              ))}
            </select>
          </div>

          <div className="min-w-[900px] text-sm">
            <div className="grid grid-cols-[minmax(240px,3fr)_minmax(180px,2fr)_1fr_1.2fr_1.2fr_auto] gap-3 border-y border-[#E5E7EB] bg-[#F9FAFB] px-5 py-3 text-xs font-medium text-[#667085]">
              <span>Name</span>
              <span>Actual vs target</span>
              <span>Format</span>
              <span>Collection frequency</span>
              <span>Status</span>
              <span className={canManage ? "w-[110px]" : "w-0"}>{canManage ? "Actions" : ""}</span>
            </div>

            {groups.length === 0 && (
              <p className="px-5 py-10 text-center text-sm text-[#98A2B3]">No indicators match.</p>
            )}

            {groups.map(({ result, band, items }) => {
              const open = !collapsed.has(result.id);
              return (
                <div key={result.id}>
                  <button
                    type="button"
                    onClick={() => toggleGroup(result.id)}
                    aria-expanded={open}
                    className="flex w-full items-center gap-2 border-l-4 px-4 py-2.5 text-left text-sm font-semibold"
                    style={{ background: band.bg, borderLeftColor: band.bar, color: band.text }}
                  >
                    {result.title}
                    <span className="rounded-full bg-white/70 px-2 text-xs font-medium">{items.length}</span>
                    <span className="ml-auto text-xs" aria-hidden="true">{open ? "▲" : "▼"}</span>
                  </button>

                  {open &&
                    items.map((ind) => {
                      const p = progressOf(ind, data.values, fw.periods);
                      const suffix = p.isPct ? "%" : "";
                      return (
                        <div key={ind.id} className="grid grid-cols-[minmax(240px,3fr)_minmax(180px,2fr)_1fr_1.2fr_1.2fr_auto] items-center gap-3 border-t border-[#F2F4F7] px-5 py-3">
                          <div className="flex items-start gap-2">
                            <div>
                              <p className="font-medium text-[#3B2A8F]">{ind.name}</p>
                              {(ind.mov || ind.assumptions) && (
                                <p className="mt-0.5 text-xs text-[#667085]">
                                  {ind.mov ? `Verified by: ${ind.mov}` : ""}
                                  {ind.mov && ind.assumptions ? " · " : ""}
                                  {ind.assumptions ? `Assumes: ${ind.assumptions}` : ""}
                                </p>
                              )}
                            </div>
                            {ind.kpi && (
                              <span title="Key performance indicator" className="ml-auto rounded-full bg-[#CA9A04] px-1.5 py-0.5 text-[10px] font-bold text-white">KPI</span>
                            )}
                          </div>

                          <div>
                            {p.actual == null && p.target == null ? (
                              <span className="text-[#98A2B3]">-</span>
                            ) : (
                              <>
                                <p className="text-xs font-medium text-[#344054]">
                                  {p.actual ?? "-"}{suffix} <span className="text-[#98A2B3]">/ {p.target ?? "-"}{suffix}</span>
                                </p>
                                <div
                                  className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[#EAECF0]"
                                  role="progressbar"
                                  aria-label={`Progress for ${ind.name}`}
                                  aria-valuemin={0}
                                  aria-valuemax={100}
                                  aria-valuenow={p.pct ?? 0}
                                >
                                  <div className="h-full rounded-full" style={{ width: `${p.pct ?? 0}%`, background: band.bar }} />
                                </div>
                                {p.last && <p className="mt-0.5 text-[11px] text-[#98A2B3]">Last data update: {p.last}</p>}
                              </>
                            )}
                          </div>

                          <span className="text-[#475467]">{formatOf(ind)}</span>
                          <span className="text-[#475467]">{ind.frequency || "-"}</span>
                          <span className="flex items-center gap-1.5 text-[#475467]">
                            {p.status ? (
                              <>
                                <span className="inline-block h-2 w-2 rounded-full" style={{ background: STATUS_STYLE[p.status] }} />
                                {p.status}
                              </>
                            ) : (
                              <span className="text-[#98A2B3]">-</span>
                            )}
                          </span>

                          {canManage ? (
                            <div className="flex w-[110px] gap-2">
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
        </section>
      )}
    </Page>
  );
}

export default MEIndicators;
