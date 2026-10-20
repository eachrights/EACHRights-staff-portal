import { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  CARD, ErrorBar, FrameworkSelect, NoFramework, Page, PageHead, PeriodTabs, buildRows, useMEData,
} from "./Shared";

const TONE = {
  bad: "#B42318",
  warn: "#D4A600",
  good: "#1F7A5C",
  info: "#5B3FD0",
};

const average = (list) => (list.length ? Math.round(list.reduce((a, b) => a + b, 0) / list.length) : null);

/* Fixed rules over the reported data. These are calculated, not written by an AI model. */
function MEInsights() {
  const { isAdmin, frameworks, selectedId, setSelectedId, data, fw, ordered, rows, period, setPeriod, busy, error } = useMEData();

  const { insights, avg, prevAvg } = useMemo(() => {
    if (!data) return { insights: [], avg: null, prevAvg: null };
    const expected = rows.filter((r) => r.target !== undefined);
    const withPct = expected.filter((r) => r.pct !== null);
    const idx = data.framework.periods.indexOf(period);
    const prevRows = idx > 0 ? buildRows(data, ordered, data.framework.periods[idx - 1]) : [];
    const prevAvg = average(prevRows.filter((r) => r.target !== undefined && r.pct !== null).map((r) => r.pct));
    const avg = average(withPct.map((r) => r.pct));

    const list = [];
    const names = (items, fmt) => items.map(fmt);
    const off = withPct.filter((r) => r.progress === "off");
    const risk = withPct.filter((r) => r.progress === "risk");
    const on = withPct.filter((r) => r.progress === "on");
    const awaiting = rows.filter((r) => r.saved?.status === "submitted");
    const rejected = rows.filter((r) => r.saved?.status === "rejected");
    const missing = expected.filter((r) => !r.saved);

    if (off.length) list.push({ tone: "bad", title: `${off.length} ${off.length === 1 ? "indicator is" : "indicators are"} off track`, body: "These are below 50% of their target for this period.", items: names(off, (r) => `${r.ind.name} (${r.pct}%)`) });
    if (risk.length) list.push({ tone: "warn", title: `${risk.length} ${risk.length === 1 ? "indicator is" : "indicators are"} at risk`, body: "These are between 50% and 89% of target.", items: names(risk, (r) => `${r.ind.name} (${r.pct}%)`) });
    if (rejected.length) list.push({ tone: "bad", title: `${rejected.length} ${rejected.length === 1 ? "value was" : "values were"} rejected`, body: "Correct and resubmit these so they count towards progress.", items: names(rejected, (r) => r.ind.name) });
    if (awaiting.length) list.push({ tone: "warn", title: `${awaiting.length} ${awaiting.length === 1 ? "value is" : "values are"} waiting for approval`, body: isAdmin ? "Review these on the Data table page." : "They count towards progress once the administrator approves them.", items: names(awaiting, (r) => r.ind.name) });
    if (missing.length) list.push({ tone: "info", title: `${missing.length} ${missing.length === 1 ? "indicator has" : "indicators have"} a target but no report`, body: "Enter these on the Forms page.", items: names(missing, (r) => r.ind.name) });
    if (on.length) {
      const best = [...on].sort((a, b) => b.pct - a.pct)[0];
      list.push({ tone: "good", title: `${on.length} ${on.length === 1 ? "indicator is" : "indicators are"} on track`, body: `Strongest result: ${best.ind.name} at ${best.pct}% of target.`, items: [] });
    }
    return { insights: list, avg, prevAvg };
  }, [data, rows, ordered, period, isAdmin]);

  const change = avg !== null && prevAvg !== null ? avg - prevAvg : null;

  return (
    <Page>
      <PageHead title="AI insights" subtitle="What needs attention in the current period, worked out from your reported data.">
        <FrameworkSelect frameworks={frameworks} value={selectedId} onChange={setSelectedId} />
      </PageHead>

      <ErrorBar error={error} />
      {!fw && <NoFramework isAdmin={isAdmin} busy={busy} />}

      {fw && (
        <>
          <PeriodTabs periods={fw.periods} value={period} onChange={setPeriod} />

          <section className={`${CARD} p-5`} aria-label="Overall">
            <p className="text-xs font-medium text-[#667085]">Average achievement, approved values</p>
            <p className="mt-1.5 text-3xl font-semibold tracking-tight text-[#101828]">{avg === null ? "No data" : `${avg}%`}</p>
            <p className="mt-1.5 text-xs text-[#667085]">
              {change === null
                ? "No earlier period to compare with."
                : change === 0
                ? "Unchanged from the previous period."
                : `${change > 0 ? "Up" : "Down"} ${Math.abs(change)} points from the previous period (${prevAvg}%).`}
            </p>
          </section>

          {insights.length === 0 && (
            <div className={`${CARD} p-10 text-center text-sm text-[#667085]`}>
              Nothing to flag for {period}. Insights appear once values are reported.
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            {insights.map((i) => (
              <article key={i.title} className={`${CARD} p-5`}>
                <div className="flex items-start gap-2.5">
                  <span aria-hidden="true" className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: TONE[i.tone] }} />
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-[#101828]">{i.title}</h2>
                    <p className="mt-1 text-xs leading-5 text-[#667085]">{i.body}</p>
                    {i.items.length > 0 && (
                      <ul className="mt-3 space-y-1 text-sm text-[#344054]">
                        {i.items.slice(0, 5).map((t) => (
                          <li key={t}>{t}</li>
                        ))}
                        {i.items.length > 5 && <li className="text-xs text-[#98A2B3]">and {i.items.length - 5} more</li>}
                      </ul>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>

          <p className="text-xs text-[#98A2B3]">
            Insights use fixed rules (90% and 50% of target) on approved values. See{" "}
            <Link to="/me-dashboard/guides" className="font-medium text-[#5B3FD0] hover:underline">Guides</Link> for how progress is read.
          </p>
        </>
      )}
    </Page>
  );
}

export default MEInsights;
