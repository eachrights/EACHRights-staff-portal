import { useEffect, useMemo, useState } from "react";
import { api, downloadCsv } from "../../../meApi";
import {
  BTN, BTN_LIGHT, CARD, ErrorBar, FIELD, FrameworkSelect, NoFramework, Page, PageHead, StatusPill, useMEData,
} from "./Shared";

/* Recognise a configured gender/sex disaggregation without assuming its ID or categories */
const isGenderType = (type) =>
  /\b(gender|sex)\b/i.test([type?.name, type?.slug, type?.code, type?.key].filter(Boolean).join(" "));

const fmt = (n) => (n === undefined || n === null || n === "" ? "-" : Number(n).toLocaleString());

/* Every value reported so far, across all periods */
function MEData() {
  const { isAdmin, frameworks, selectedId, setSelectedId, data, fw, period, busy, error, run, reload } = useMEData();
  const [periodFilter, setPeriodFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [evidenceFilter, setEvidenceFilter] = useState("");
  const [query, setQuery] = useState("");
  const [types, setTypes] = useState([]);

  /* Disaggregation types, gender first, so breakdowns show in the order they were set up */
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
      (!evidenceFilter ||
        (evidenceFilter === "with" ? (r.v.evidence || []).length > 0 : (r.v.evidence || []).length === 0)) &&
      (!query.trim() || r.ind.name.toLowerCase().includes(query.trim().toLowerCase()))
  );

  /* A value's breakdowns as readable lines, in the order the types and categories are set up */
  const breakdownLines = (v) =>
    types
      .filter((t) => v?.breakdown?.[t.id])
      .map((t) => ({
        id: t.id,
        name: t.name,
        parts: t.categories
          .filter((c) => v.breakdown[t.id][c] !== undefined)
          .map((c) => ({ label: c, value: v.breakdown[t.id][c] })),
      }));

  const review = (ind, valuePeriod, approve) =>
    run(async () => {
      await api(`/me/frameworks/${selectedId}/values/review`, {
        method: "POST",
        body: { indicatorId: ind.id, period: valuePeriod, approve },
      });
      await reload();
    });

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
            <select className={FIELD} aria-label="Filter by evidence" value={evidenceFilter} onChange={(e) => setEvidenceFilter(e.target.value)}>
              <option value="">With or without evidence</option>
              <option value="with">With evidence</option>
              <option value="without">No evidence</option>
            </select>
            <p className="ml-auto text-xs text-[#667085]">Exports use {periodFilter || period}</p>
          </div>

          <table className="w-full min-w-[1100px] text-left text-sm">
            <thead>
              <tr className="border-y border-[#E5E7EB] bg-[#F9FAFB] text-xs font-medium text-[#667085]">
                <th className="px-5 py-3">Indicator</th>
                <th className="px-3 py-3">Period</th>
                <th className="px-3 py-3">Target</th>
                <th className="px-3 py-3">Actual</th>
                <th className="px-3 py-3">% of target</th>
                <th className="px-3 py-3">Breakdown</th>
                <th className="px-3 py-3">Evidence</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Comment</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-5 py-10 text-center text-sm text-[#98A2B3]">No values match.</td>
                </tr>
              )}
              {shown.map(({ v, ind, result, target, pct }) => {
                const lines = breakdownLines(v);
                const evidence = v.evidence || [];
                return (
                  <tr key={`${ind.id}-${v.period}`} className="border-t border-[#F2F4F7] align-top">
                    <td className="px-5 py-3.5">
                      <p className="font-medium text-[#101828]">{ind.name}</p>
                      <p className="mt-0.5 text-xs text-[#667085]">{result?.title}{ind.unit ? ` · ${ind.unit}` : ""}</p>
                    </td>
                    <td className="px-3 py-3.5 text-[#475467]">{v.period}</td>
                    <td className="px-3 py-3.5 text-[#475467]">{target ?? "-"}</td>
                    <td className="px-3 py-3.5 font-medium text-[#101828]">{v.actual}</td>
                    <td className="px-3 py-3.5 text-[#475467]">{pct === null ? "-" : `${pct}%`}</td>

                    <td className="px-3 py-3.5">
                      {lines.length === 0 ? (
                        <span className="text-[#98A2B3]">-</span>
                      ) : (
                        <div className="space-y-1 text-xs">
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
                        </div>
                      )}
                    </td>

                    <td className="px-3 py-3.5">
                      {evidence.length === 0 ? (
                        <span className={v.status === "submitted" ? "text-xs text-[#7A5C00]" : "text-[#98A2B3]"}>
                          {v.status === "submitted" ? "None attached" : "-"}
                        </span>
                      ) : (
                        <ul className="space-y-1 text-xs">
                          {evidence.map((item, i) => (
                            <li key={`${item.type}-${item.key || item.url}-${i}`} className="flex items-center gap-2">
                              <span className="rounded bg-[#F2F4F7] px-1.5 py-0.5 text-[11px] font-medium text-[#475467]">
                                {item.type === "file" ? "File" : "Link"}
                              </span>
                              <span className="min-w-0 max-w-[9rem] truncate text-[#101828]" title={item.name}>{item.name}</span>
                              <button
                                type="button"
                                onClick={() => openEvidence(item)}
                                disabled={busy}
                                aria-label={`Open ${item.name}`}
                                className="font-medium text-[#5B3FD0] hover:underline disabled:opacity-50"
                              >
                                Open
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>

                    <td className="px-3 py-3.5"><StatusPill status={v.status} /></td>
                    <td className="max-w-[260px] px-3 py-3.5 text-[#475467]">
                      <p>{v.comment || "-"}</p>
                      {v.status === "submitted" && v.correction && (
                        <p className="mt-2 rounded-md border border-[#F3D18A] bg-[#FFFAEB] px-2.5 py-2 text-xs text-[#7A5C00]">
                          <span className="font-semibold">Correction from {v.correction.requestedBy || "staff"}</span>
                          {" "}(was {fmt(v.correction.previous?.actual)}): {v.correction.note}
                        </p>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      {isAdmin && v.status === "submitted" && (
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => review(ind, v.period, true)}
                            disabled={busy || evidence.length === 0}
                            title={evidence.length === 0 ? "Evidence is required before a value can be approved" : undefined}
                            className={BTN}
                          >
                            Approve
                          </button>
                          <button type="button" onClick={() => review(ind, v.period, false)} disabled={busy} className={BTN_LIGHT}>Reject</button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </Page>
  );
}

export default MEData;
