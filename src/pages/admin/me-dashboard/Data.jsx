import { useMemo, useState } from "react";
import { api, downloadCsv } from "../../../meApi";
import {
  BTN, BTN_LIGHT, CARD, ErrorBar, FIELD, FrameworkSelect, NoFramework, Page, PageHead, StatusPill, useMEData,
} from "./Shared";

/* Every value reported so far, across all periods */
function MEData() {
  const { isAdmin, frameworks, selectedId, setSelectedId, data, fw, period, busy, error, run, reload } = useMEData();
  const [periodFilter, setPeriodFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [query, setQuery] = useState("");

  const table = useMemo(() => {
    if (!data) return [];
    const inds = new Map(data.indicators.map((i) => [i.id, i]));
    const results = new Map(data.results.map((r) => [r.id, r]));
    return data.values
      .map((v) => {
        const ind = inds.get(v.indicatorId);
        if (!ind) return null;
        const target = ind.targets?.[v.period];
        const pct = v.status === "approved" && target ? Math.round((v.actual / target) * 100) : null;
        return { v, ind, result: results.get(ind.resultId), target, pct };
      })
      .filter(Boolean)
      .sort((a, b) => a.v.period.localeCompare(b.v.period) || a.ind.name.localeCompare(b.ind.name));
  }, [data]);

  const shown = table.filter(
    (r) =>
      (!periodFilter || r.v.period === periodFilter) &&
      (!statusFilter || r.v.status === statusFilter) &&
      (!query.trim() || r.ind.name.toLowerCase().includes(query.trim().toLowerCase()))
  );

  const review = (ind, valuePeriod, approve) =>
    run(async () => {
      await api(`/me/frameworks/${selectedId}/values/review`, {
        method: "POST",
        body: { indicatorId: ind.id, period: valuePeriod, approve },
      });
      await reload();
    });

  const exportFile = (format) => {
    const p = periodFilter || period;
    return run(() =>
      downloadCsv(
        `/me/frameworks/${selectedId}/export?format=${format}&period=${encodeURIComponent(p)}`,
        format === "logframe" ? "logframe.csv" : `results-table-${p}.csv`
      )
    );
  };

  return (
    <Page>
      <PageHead title="Data table" subtitle={fw ? `${table.length} reported values in ${fw.name}` : "All reported values."}>
        <FrameworkSelect frameworks={frameworks} value={selectedId} onChange={setSelectedId} />
        {fw && (
          <>
            <button type="button" onClick={() => exportFile("results")} disabled={busy} className={BTN_LIGHT}>Results table</button>
            <button type="button" onClick={() => exportFile("logframe")} disabled={busy} className={BTN_LIGHT}>Logframe</button>
          </>
        )}
      </PageHead>

      <ErrorBar error={error} />
      {!fw && <NoFramework isAdmin={isAdmin} busy={busy} />}

      {fw && (
        <section aria-label="Reported values" className={`${CARD} overflow-x-auto`}>
          <div className="flex flex-wrap items-center gap-2 p-4">
            <input className={`${FIELD} w-64`} placeholder="Search indicators" aria-label="Search indicators" value={query} onChange={(e) => setQuery(e.target.value)} />
            <select className={FIELD} aria-label="Filter by period" value={periodFilter} onChange={(e) => setPeriodFilter(e.target.value)}>
              <option value="">All periods</option>
              {fw.periods.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <select className={FIELD} aria-label="Filter by status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              <option value="submitted">Awaiting approval</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
            <p className="ml-auto text-xs text-[#667085]">Exports use {periodFilter || period}</p>
          </div>

          <table className="w-full min-w-[920px] text-left text-sm">
            <thead>
              <tr className="border-y border-[#E5E7EB] bg-[#F9FAFB] text-xs font-medium text-[#667085]">
                <th className="px-5 py-3">Indicator</th>
                <th className="px-3 py-3">Period</th>
                <th className="px-3 py-3">Target</th>
                <th className="px-3 py-3">Actual</th>
                <th className="px-3 py-3">% of target</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Comment</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-10 text-center text-sm text-[#98A2B3]">No values match.</td>
                </tr>
              )}
              {shown.map(({ v, ind, result, target, pct }) => (
                <tr key={`${ind.id}-${v.period}`} className="border-t border-[#F2F4F7] align-top">
                  <td className="px-5 py-3.5">
                    <p className="font-medium text-[#101828]">{ind.name}</p>
                    <p className="mt-0.5 text-xs text-[#667085]">{result?.title}{ind.unit ? ` · ${ind.unit}` : ""}</p>
                  </td>
                  <td className="px-3 py-3.5 text-[#475467]">{v.period}</td>
                  <td className="px-3 py-3.5 text-[#475467]">{target ?? "-"}</td>
                  <td className="px-3 py-3.5 font-medium text-[#101828]">{v.actual}</td>
                  <td className="px-3 py-3.5 text-[#475467]">{pct === null ? "-" : `${pct}%`}</td>
                  <td className="px-3 py-3.5"><StatusPill status={v.status} /></td>
                  <td className="max-w-[220px] px-3 py-3.5 text-[#475467]">{v.comment || "-"}</td>
                  <td className="px-5 py-3.5">
                    {isAdmin && v.status === "submitted" && (
                      <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => review(ind, v.period, true)} disabled={busy} className={BTN}>Approve</button>
                        <button type="button" onClick={() => review(ind, v.period, false)} disabled={busy} className={BTN_LIGHT}>Reject</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </Page>
  );
}

export default MEData;
