import { useMemo, useState } from "react";
import { api } from "../../../meApi";
import {
  BTN, BTN_LIGHT, CARD, CardHead, ErrorBar, FIELD, FrameworkSelect, NoFramework, Page, PageHead,
  TargetsInput, cleanTargets, useMEData,
} from "./Shared";

const EMPTY = { name: "", resultId: "", unit: "", baseline: "", targets: {}, mov: "", assumptions: "" };

function MEIndicators() {
  const { isAdmin, frameworks, selectedId, setSelectedId, data, fw, ordered, busy, error, run, reload } = useMEData();
  const [query, setQuery] = useState("");
  const [resultFilter, setResultFilter] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(EMPTY);

  const resultOf = useMemo(() => new Map(ordered.map((r) => [r.id, r])), [ordered]);

  const shown = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.indicators.filter(
      (i) => (!resultFilter || i.resultId === resultFilter) && (!q || i.name.toLowerCase().includes(q))
    );
  }, [data, query, resultFilter]);

  const addIndicator = () =>
    run(async () => {
      if (!form.name.trim()) throw new Error("Give the indicator a name.");
      if (!form.resultId) throw new Error("Choose the result it measures.");
      await api(`/me/frameworks/${selectedId}/indicators`, {
        method: "POST",
        body: {
          name: form.name.trim(),
          unit: form.unit.trim(),
          ...(form.baseline !== "" ? { baseline: Number(form.baseline) } : {}),
          targets: cleanTargets(form.targets),
          mov: form.mov.trim(),
          assumptions: form.assumptions.trim(),
          resultId: form.resultId,
        },
      });
      setForm({ ...EMPTY, resultId: form.resultId });
      await reload();
    });

  return (
    <Page>
      <PageHead title="Indicators" subtitle={fw ? `${data.indicators.length} indicators in ${fw.name}` : "Indicators, targets and how they are verified."}>
        <FrameworkSelect frameworks={frameworks} value={selectedId} onChange={setSelectedId} />
        {isAdmin && fw && (
          <button type="button" onClick={() => setShowAdd((s) => !s)} className={BTN}>
            {showAdd ? "Close" : "Add indicator"}
          </button>
        )}
      </PageHead>

      <ErrorBar error={error} />
      {!fw && <NoFramework isAdmin={isAdmin} busy={busy} />}

      {fw && showAdd && isAdmin && (
        <section className={`${CARD} p-5`} aria-label="Add indicator">
          <CardHead title="Add an indicator" subtitle="Targets are set per reporting period. Leave a period empty if nothing is expected." />
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
            <input className={FIELD} placeholder="Means of verification" aria-label="Means of verification" value={form.mov} onChange={(e) => setForm({ ...form, mov: e.target.value })} />
            <input className={FIELD} placeholder="Assumptions" aria-label="Assumptions" value={form.assumptions} onChange={(e) => setForm({ ...form, assumptions: e.target.value })} />
          </div>
          <div className="mt-4">
            <TargetsInput periods={fw.periods} value={form.targets} onChange={(targets) => setForm({ ...form, targets })} />
          </div>
          <div className="mt-4 flex gap-2">
            <button type="button" onClick={addIndicator} disabled={busy} className={BTN}>Add indicator</button>
            <button type="button" onClick={() => setShowAdd(false)} className={BTN_LIGHT}>Close</button>
          </div>
        </section>
      )}

      {fw && (
        <section aria-label="Indicators" className={`${CARD} overflow-x-auto`}>
          <div className="flex flex-wrap items-center gap-2 p-4">
            <input className={`${FIELD} w-64`} placeholder="Search indicators" aria-label="Search indicators" value={query} onChange={(e) => setQuery(e.target.value)} />
            <select className={FIELD} aria-label="Filter by result" value={resultFilter} onChange={(e) => setResultFilter(e.target.value)}>
              <option value="">All results</option>
              {ordered.map((r) => (
                <option key={r.id} value={r.id}>{r.title}</option>
              ))}
            </select>
          </div>
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead>
              <tr className="border-y border-[#E5E7EB] bg-[#F9FAFB] text-xs font-medium text-[#667085]">
                <th className="px-5 py-3">Indicator</th>
                <th className="px-3 py-3">Baseline</th>
                <th className="px-3 py-3">Targets</th>
                <th className="px-3 py-3">Means of verification</th>
                <th className="px-5 py-3">Assumptions</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-sm text-[#98A2B3]">No indicators match.</td>
                </tr>
              )}
              {shown.map((ind) => (
                <tr key={ind.id} className="border-t border-[#F2F4F7] align-top">
                  <td className="px-5 py-4">
                    <p className="font-medium text-[#101828]">{ind.name}</p>
                    <p className="mt-0.5 text-xs text-[#667085]">
                      {resultOf.get(ind.resultId)?.title}{ind.unit ? ` · ${ind.unit}` : ""}
                    </p>
                  </td>
                  <td className="px-3 py-4 text-[#475467]">{ind.baseline ?? "-"}</td>
                  <td className="px-3 py-4">
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(ind.targets || {}).map(([p, t]) => (
                        <span key={p} className="rounded-md bg-[#EDE9FB] px-2 py-0.5 text-xs text-[#5B3FD0]">{p}: {t}</span>
                      ))}
                      {Object.keys(ind.targets || {}).length === 0 && <span className="text-[#98A2B3]">-</span>}
                    </div>
                  </td>
                  <td className="px-3 py-4 text-[#475467]">{ind.mov || "-"}</td>
                  <td className="px-5 py-4 text-[#475467]">{ind.assumptions || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </Page>
  );
}

export default MEIndicators;
