import { useState } from "react";
import { downloadCsv } from "../../../meApi";
import {
  BTN, BTN_LIGHT, CARD, CardHead, ErrorBar, FrameworkSelect, NoFramework, Page, PageHead, PeriodTabs,
  PROGRESS, ProgressDot, StatusPill, useMEData,
} from "./Shared";

const SECTIONS = [
  ["summary", "Summary"],
  ["table", "Progress table"],
  ["highlights", "Highlights and concerns"],
  ["comments", "Comments"],
];

function MEReports() {
  const { isAdmin, frameworks, selectedId, setSelectedId, fw, rows, period, setPeriod, busy, error, run } = useMEData();
  const [on, setOn] = useState({ summary: true, table: true, highlights: true, comments: true });

  const expected = rows.filter((r) => r.target !== undefined);
  const counts = Object.fromEntries(Object.keys(PROGRESS).map((k) => [k, expected.filter((r) => r.progress === k).length]));
  const good = expected.filter((r) => r.progress === "on");
  const concerns = expected.filter((r) => r.progress === "off" || r.progress === "risk");
  const commented = expected.filter((r) => r.saved?.comment);
  const today = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

  const exportFile = (format) =>
    run(() =>
      downloadCsv(
        `/me/frameworks/${selectedId}/export?format=${format}&period=${encodeURIComponent(period)}`,
        format === "logframe" ? "logframe.csv" : `results-table-${period}.csv`
      )
    );

  return (
    <Page>
      {/* Hide the app chrome when printing or saving as PDF */}
      <style>{`@media print { aside, header[class*="sticky"], nav[aria-label="Main navigation"] { display: none !important; } }`}</style>

      <PageHead title="Smart reports" subtitle="Build a period report, then print it or save it as a PDF.">
        <FrameworkSelect frameworks={frameworks} value={selectedId} onChange={setSelectedId} />
        {fw && (
          <>
            <button type="button" onClick={() => exportFile("results")} disabled={busy} className={BTN_LIGHT}>Results CSV</button>
            <button type="button" onClick={() => exportFile("logframe")} disabled={busy} className={BTN_LIGHT}>Logframe CSV</button>
            <button type="button" onClick={() => window.print()} className={BTN}>Print or save PDF</button>
          </>
        )}
      </PageHead>

      <div className="print:hidden"><ErrorBar error={error} /></div>
      {!fw && <NoFramework isAdmin={isAdmin} busy={busy} />}

      {fw && (
        <>
          <PeriodTabs periods={fw.periods} value={period} onChange={setPeriod} />

          <fieldset className={`${CARD} flex flex-wrap items-center gap-x-5 gap-y-2 p-4 print:hidden`}>
            <legend className="sr-only">Report sections</legend>
            <span className="text-xs font-medium text-[#667085]">Include</span>
            {SECTIONS.map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm text-[#344054]">
                <input
                  type="checkbox"
                  checked={on[key]}
                  onChange={(e) => setOn({ ...on, [key]: e.target.checked })}
                  className="h-4 w-4 accent-[#5B3FD0]"
                />
                {label}
              </label>
            ))}
          </fieldset>

          <article className={`${CARD} space-y-6 p-8 print:border-0 print:p-0 print:shadow-none`} aria-label="Report preview">
            <header className="border-b border-[#EEF0F4] pb-5">
              <h2 className="text-xl font-semibold tracking-tight text-[#101828]">{fw.name}</h2>
              <p className="mt-1 text-sm text-[#667085]">
                {fw.donor || "No donor set"} · Reporting period {period} · Generated {today}
              </p>
            </header>

            {on.summary && (
              <section>
                <CardHead title="Summary" subtitle="Approved values only" />
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                  <div className="rounded-lg bg-[#F9FAFB] p-3">
                    <dt className="text-xs text-[#667085]">Indicators with a target</dt>
                    <dd className="mt-1 text-xl font-semibold text-[#101828]">{expected.length}</dd>
                  </div>
                  {Object.entries(PROGRESS).map(([k, v]) => (
                    <div key={k} className="rounded-lg bg-[#F9FAFB] p-3">
                      <dt className="flex items-center gap-1.5 text-xs text-[#667085]">
                        <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: v.color }} />
                        {v.label}
                      </dt>
                      <dd className="mt-1 text-xl font-semibold text-[#101828]">{counts[k]}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}

            {on.table && (
              <section>
                <CardHead title="Progress against target" />
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[680px] text-left text-sm">
                    <thead>
                      <tr className="border-y border-[#E5E7EB] bg-[#F9FAFB] text-xs font-medium text-[#667085]">
                        <th className="px-3 py-2.5">Indicator</th>
                        <th className="px-3 py-2.5">Baseline</th>
                        <th className="px-3 py-2.5">Target</th>
                        <th className="px-3 py-2.5">Actual</th>
                        <th className="px-3 py-2.5">Progress</th>
                        <th className="px-3 py-2.5">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {expected.map(({ ind, result, saved, target, pct, progress }) => (
                        <tr key={ind.id} className="border-t border-[#F2F4F7] align-top">
                          <td className="px-3 py-2.5">
                            <p className="font-medium text-[#101828]">{ind.name}</p>
                            <p className="text-xs text-[#667085]">{result.title}</p>
                          </td>
                          <td className="px-3 py-2.5 text-[#475467]">{ind.baseline ?? "-"}</td>
                          <td className="px-3 py-2.5 text-[#475467]">{target}</td>
                          <td className="px-3 py-2.5 text-[#475467]">{saved ? saved.actual : "-"}</td>
                          <td className="px-3 py-2.5"><ProgressDot progress={progress} pct={pct} /></td>
                          <td className="px-3 py-2.5"><StatusPill status={saved?.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {on.highlights && (
              <section className="grid gap-5 sm:grid-cols-2">
                <div>
                  <CardHead title="Highlights" subtitle="On track, 90% of target or more" />
                  {good.length === 0 ? (
                    <p className="text-sm text-[#98A2B3]">None yet.</p>
                  ) : (
                    <ul className="space-y-1.5 text-sm text-[#344054]">
                      {good.map((r) => (
                        <li key={r.ind.id}>{r.ind.name} <span className="text-[#1F7A5C]">({r.pct}%)</span></li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <CardHead title="Concerns" subtitle="At risk or off track" />
                  {concerns.length === 0 ? (
                    <p className="text-sm text-[#98A2B3]">None.</p>
                  ) : (
                    <ul className="space-y-1.5 text-sm text-[#344054]">
                      {concerns.map((r) => (
                        <li key={r.ind.id}>{r.ind.name} <span style={{ color: PROGRESS[r.progress].color }}>({r.pct}%)</span></li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>
            )}

            {on.comments && (
              <section>
                <CardHead title="Comments from reporting" />
                {commented.length === 0 ? (
                  <p className="text-sm text-[#98A2B3]">No comments for this period.</p>
                ) : (
                  <ul className="space-y-3 text-sm">
                    {commented.map((r) => (
                      <li key={r.ind.id}>
                        <p className="font-medium text-[#101828]">{r.ind.name}</p>
                        <p className="text-[#475467]">{r.saved.comment}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </article>
        </>
      )}
    </Page>
  );
}

export default MEReports;
