import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  BTN, BTN_LIGHT, CARD, ErrorBar, FIELD, FrameworkSelect, NoFramework, Page, PageHead, PeriodTabs, buildRows, useMEData,
} from "./Shared";

const TONE = {
  bad: "#B42318",
  warn: "#D4A600",
  good: "#1F7A5C",
  info: "#5B3FD0",
};

const STATUS_LABEL = {
  approved: "Approved",
  submitted: "Awaiting approval",
  rejected: "Rejected",
};

const SUGGESTIONS = [
  "How are we doing overall?",
  "Which indicators are off track?",
  "Which indicators will miss their targets by year end?",
  "What is waiting for approval?",
  "What has not been reported?",
  "Show progress by period",
  "Show progress by result",
];

const STOP_WORDS = new Set(["what", "which", "show", "about", "have", "with", "that", "this", "from", "number", "percentage", "how", "many", "much", "the", "are", "for", "and", "our", "their"]);

const average = (list) => (list.length ? Math.round(list.reduce((a, b) => a + b, 0) / list.length) : null);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const statusOf = (row) => STATUS_LABEL[row.saved?.status] ?? "Not reported";

/* Open in Excel: a CSV with a byte order mark so accents and symbols display correctly */
function downloadTable(filename, columns, rows) {
  const cell = (v) => {
    let s = v === undefined || v === null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const text = [columns, ...rows].map((r) => r.map(cell).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF", text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);

/* Indicator figures: one line per indicator for a period */
const INDICATOR_COLUMNS = ["Indicator", "Result", "Target", "Actual", "% of target", "Status"];
const indicatorRow = (r) => [r.ind.name, r.result.title, r.target ?? "", r.saved?.actual ?? "", r.pct ?? "", statusOf(r)];

/* Project the full-year result if the pace so far continues. Approved values only. */
function forecastFor(data, ind) {
  let targetSum = 0;
  let actualSum = 0;
  let remaining = 0;
  let remainingPeriods = 0;
  const ratios = [];
  for (const p of data.framework.periods) {
    const t = ind.targets?.[p];
    if (!t) continue;
    targetSum += t;
    const v = data.values.find((x) => x.indicatorId === ind.id && x.period === p && x.status === "approved");
    if (v) {
      actualSum += v.actual;
      ratios.push(v.actual / t);
    } else {
      remaining += t;
      remainingPeriods += 1;
    }
  }
  if (ratios.length === 0 || remainingPeriods === 0) return null;
  const pace = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  const projected = actualSum + remaining * pace;
  return {
    ind,
    pace: Math.round(pace * 100),
    targetSum,
    projected: Math.round(projected),
    projectedPct: Math.round((projected / targetSum) * 100),
    remainingPeriods,
  };
}

const FORECAST_COLUMNS = ["Indicator", "Pace so far (%)", "Full-year target", "Projected total", "Projected (% of target)", "Periods still to report"];
const forecastRow = (f) => [f.ind.name, f.pace, f.targetSum, f.projected, f.projectedPct, f.remainingPeriods];

/* Turn a question into an answer: { title, text, columns, rows } */
function answerQuestion(question, ctx) {
  const { data, fw, period, rows, rowsByPeriod, ordered } = ctx;
  const q = question.toLowerCase();
  const expected = rows.filter((r) => r.target !== undefined);
  const withPct = expected.filter((r) => r.pct !== null);
  const list = (rs, title, empty, intro) =>
    rs.length === 0
      ? { title, text: empty, columns: [], rows: [] }
      : { title, text: `${intro(rs.length)} for ${period}.`, columns: INDICATOR_COLUMNS, rows: rs.map(indicatorRow) };

  /* A question naming an indicator gets that indicator across every period */
  const tokens = q.split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !STOP_WORDS.has(w));
  let best = null;
  for (const ind of data.indicators) {
    const name = ind.name.toLowerCase();
    const score = tokens.filter((t) => name.includes(t)).length;
    if (score >= 2 && (!best || score > best.score)) best = { ind, score };
  }
  if (best) {
    const { ind } = best;
    const result = ordered.find((r) => r.id === ind.resultId);
    const perPeriod = fw.periods.map((p) => {
      const target = ind.targets?.[p];
      const v = data.values.find((x) => x.indicatorId === ind.id && x.period === p);
      const pct = v?.status === "approved" && target ? Math.round((v.actual / target) * 100) : "";
      return [p, target ?? "", v?.actual ?? "", pct, STATUS_LABEL[v?.status] ?? "Not reported"];
    });
    const f = forecastFor(data, ind);
    return {
      title: ind.name,
      text:
        `Figures for every period under ${result?.title ?? "its result"}.` +
        (f ? ` At the current pace (${f.pace}% of target), it is projected to finish at ${f.projectedPct}% of its full-year target.` : ""),
      columns: ["Period", "Target", "Actual", "% of target", "Status"],
      rows: perPeriod,
    };
  }

  if (/forecast|project|year.?end|early warning|will (we )?(miss|meet|reach)|likely|pace|going to miss|end of year|deadline/.test(q)) {
    const all = data.indicators.map((i) => forecastFor(data, i)).filter(Boolean).sort((a, b) => a.projectedPct - b.projectedPct);
    const warn = all.filter((f) => f.projectedPct < 90);
    return warn.length
      ? {
          title: "Indicators projected to miss their targets",
          text: `${plural(warn.length, "indicator is", "indicators are")} projected to finish below 90% of the full-year target if the current pace continues.`,
          columns: FORECAST_COLUMNS,
          rows: warn.map(forecastRow),
        }
      : {
          title: "Indicators projected to miss their targets",
          text: all.length
            ? "No indicator is projected to miss its full-year target at the current pace."
            : "There is not enough approved data to project yet. Projections need at least one approved period and one period still to report.",
          columns: all.length ? FORECAST_COLUMNS : [],
          rows: all.map(forecastRow),
        };
  }

  if (/trend|by period|over time|quarter|compare|previous|last period|change/.test(q)) {
    const table = fw.periods.map((p) => {
      const rs = rowsByPeriod[p] ?? [];
      const exp = rs.filter((r) => r.target !== undefined);
      const known = exp.filter((r) => r.pct !== null);
      return [p, average(known.map((r) => r.pct)) ?? "", known.length, exp.length];
    });
    return {
      title: "Progress by period",
      text: "Average percentage of target per period, from approved values.",
      columns: ["Period", "Average % of target", "Indicators approved", "Indicators with a target"],
      rows: table,
    };
  }

  if (/by result|per result|each result|by level|per level|outcome|output|goal/.test(q)) {
    const table = ordered
      .map((res) => {
        const own = expected.filter((r) => r.result.id === res.id);
        if (own.length === 0) return null;
        return [res.title, fw.levels?.[res.level] ?? `Level ${res.level + 1}`, own.length, average(own.filter((r) => r.pct !== null).map((r) => r.pct)) ?? ""];
      })
      .filter(Boolean);
    return {
      title: "Progress by result",
      text: `Average percentage of target for each result in ${period}, from approved values.`,
      columns: ["Result", "Level", "Indicators", "Average % of target"],
      rows: table,
    };
  }

  if (/off.?track|behind|failing|worst|struggl|poor/.test(q)) {
    return list(withPct.filter((r) => r.progress === "off"), "Indicators off track", `No indicator is off track in ${period}.`, (n) => `${plural(n, "indicator is", "indicators are")} below 50% of target`);
  }
  if (/at.?risk|risky|slipping/.test(q)) {
    return list(withPct.filter((r) => r.progress === "risk"), "Indicators at risk", `No indicator is at risk in ${period}.`, (n) => `${plural(n, "indicator is", "indicators are")} between 50% and 89% of target`);
  }
  if (/on.?track|doing well|best|strong|ahead|success/.test(q)) {
    return list([...withPct.filter((r) => r.progress === "on")].sort((a, b) => b.pct - a.pct), "Indicators on track", `No indicator has reached 90% of target in ${period} yet.`, (n) => `${plural(n, "indicator is", "indicators are")} at 90% of target or more`);
  }
  if (/reject/.test(q)) {
    return list(rows.filter((r) => r.saved?.status === "rejected"), "Rejected values", `No values were rejected in ${period}.`, (n) => `${plural(n, "value was", "values were")} rejected and need correcting`);
  }
  if (/await|pending|approv|review|waiting/.test(q)) {
    return list(rows.filter((r) => r.saved?.status === "submitted"), "Waiting for approval", `Nothing is waiting for approval in ${period}.`, (n) => `${plural(n, "value is", "values are")} waiting for approval`);
  }
  if (/missing|not (yet )?(been )?reported|unreported|outstanding|overdue|no report|haven.?t/.test(q)) {
    return list(expected.filter((r) => !r.saved), "Not yet reported", `Every indicator with a target has a report in ${period}.`, (n) => `${plural(n, "indicator has", "indicators have")} a target but no report`);
  }
  if (/overall|summary|summar|how are|how is|where|stand|status|progress|doing/.test(q)) {
    const count = (k) => withPct.filter((r) => r.progress === k).length;
    const avg = average(withPct.map((r) => r.pct));
    return {
      title: "Where the programme stands",
      text:
        avg === null
          ? `No values have been approved for ${period} yet, so there is no progress to measure.`
          : `Average achievement is ${avg}% of target in ${period}, across ${plural(withPct.length, "approved indicator", "approved indicators")} out of ${expected.length} with a target.`,
      columns: ["Measure", "Indicators"],
      rows: [
        ["On track (90% or more)", count("on")],
        ["At risk (50% to 89%)", count("risk")],
        ["Off track (below 50%)", count("off")],
        ["Awaiting approval", rows.filter((r) => r.saved?.status === "submitted").length],
        ["Not reported", expected.filter((r) => !r.saved).length],
      ],
    };
  }

  return {
    title: "I can't answer that yet",
    text: "Try asking about progress overall, indicators that are off track or at risk, values waiting for approval, what has not been reported, projections to year end, progress by period or result, or name an indicator.",
    columns: [],
    rows: [],
  };
}

function AnswerTable({ columns, rows }) {
  if (columns.length === 0) return null;
  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-[#EEF0F4]">
      <table className="w-full min-w-[520px] text-left text-sm">
        <thead>
          <tr className="bg-[#F9FAFB] text-xs font-medium text-[#667085]">
            {columns.map((c, i) => (
              <th key={c} scope="col" className={`px-3 py-2.5 ${i === 0 ? "pl-4" : ""}`}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="border-t border-[#F2F4F7]">
              {r.map((v, ci) => (
                <td key={ci} className={`px-3 py-2.5 ${ci === 0 ? "pl-4 font-medium text-[#101828]" : "tabular-nums text-[#475467]"}`}>
                  {v === "" || v === null || v === undefined ? "-" : v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExportButton({ title, period, columns, rows }) {
  if (columns.length === 0) return null;
  return (
    <button type="button" className={BTN_LIGHT} onClick={() => downloadTable(`${slug(title)}-${period}.csv`, columns, rows)}>
      Export to Excel
    </button>
  );
}

/* Fixed rules over the reported data. These are calculated, not written by an AI model. */
function MEInsights() {
  const { isAdmin, frameworks, selectedId, setSelectedId, data, fw, ordered, rows, period, setPeriod, busy, error } = useMEData();
  const [question, setQuestion] = useState("");
  const [answers, setAnswers] = useState([]);

  const rowsByPeriod = useMemo(
    () => (data ? Object.fromEntries(data.framework.periods.map((p) => [p, buildRows(data, ordered, p)])) : {}),
    [data, ordered]
  );

  const ask = (text) => {
    const q = text.trim();
    if (!q || !data) return;
    const answer = answerQuestion(q, { data, fw, period, rows, rowsByPeriod, ordered });
    setAnswers((cur) => [{ ...answer, question: q, period, id: Date.now() }, ...cur].slice(0, 5));
    setQuestion("");
  };

  /* Early warnings: indicators projected to finish the year below 90% of target */
  const warnings = useMemo(() => {
    if (!data) return [];
    return data.indicators
      .map((i) => forecastFor(data, i))
      .filter((f) => f && f.projectedPct < 90)
      .sort((a, b) => a.projectedPct - b.projectedPct);
  }, [data]);
  const hasApproved = Boolean(data?.values.some((v) => v.status === "approved"));

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
      <PageHead title="Data analytics assistant" subtitle="Know where your programme stands. Ask a question, spot problems early, and export the figures.">
        <FrameworkSelect frameworks={frameworks} value={selectedId} onChange={setSelectedId} />
      </PageHead>

      <ErrorBar error={error} />
      {!fw && <NoFramework isAdmin={isAdmin} busy={busy} />}

      {fw && (
        <>
          <PeriodTabs periods={fw.periods} value={period} onChange={setPeriod} />

          {/* Ask */}
          <section className={`${CARD} p-5`} aria-label="Ask a question">
            <h2 className="text-[15px] font-semibold text-[#101828]">Ask about your programme</h2>
            <p className="mt-0.5 text-[13px] text-[#667085]">
              Answers use the reported data for {fw.name}, {period}. Every answer comes with its figures.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <input
                className={`${FIELD} grow basis-72`}
                placeholder="For example, which indicators are off track?"
                aria-label="Your question"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && ask(question)}
              />
              <button type="button" className={BTN} disabled={!question.trim()} onClick={() => ask(question)}>
                Ask
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => ask(s)}
                  className="rounded-full border border-[#E5E7EB] bg-white px-3 py-1 text-xs font-medium text-[#475467] transition hover:border-[#5B3FD0] hover:text-[#5B3FD0]"
                >
                  {s}
                </button>
              ))}
            </div>

            <div aria-live="polite" className="mt-4 space-y-3 empty:hidden">
              {answers.map((a) => (
                <article key={a.id} className="rounded-lg border border-[#EEF0F4] p-4">
                  <p className="text-xs text-[#98A2B3]">You asked: {a.question}</p>
                  <h3 className="mt-1 text-sm font-semibold text-[#101828]">{a.title}</h3>
                  <p className="mt-1 text-sm text-[#475467]">{a.text}</p>
                  <AnswerTable columns={a.columns} rows={a.rows} />
                  <div className="mt-3">
                    <ExportButton title={a.title} period={a.period} columns={a.columns} rows={a.rows} />
                  </div>
                </article>
              ))}
            </div>
          </section>

          {/* Early warnings */}
          <section className={`${CARD} p-5`} aria-label="Early warnings">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-[15px] font-semibold text-[#101828]">Early warnings</h2>
                <p className="mt-0.5 text-[13px] text-[#667085]">
                  Indicators projected to finish below 90% of their full-year target if the current pace continues. Approved values only.
                </p>
              </div>
              <ExportButton title="Early warnings" period={fw.name.slice(0, 20)} columns={warnings.length ? FORECAST_COLUMNS : []} rows={warnings.map(forecastRow)} />
            </div>
            {warnings.length === 0 ? (
              <p className="mt-4 text-sm text-[#667085]">
                {hasApproved
                  ? "No indicator is projected to miss its full-year target at the current pace."
                  : "Early warnings appear once values are approved."}
              </p>
            ) : (
              <AnswerTable columns={FORECAST_COLUMNS} rows={warnings.map(forecastRow)} />
            )}
            {warnings.length > 0 && (
              <p className="mt-2 text-xs text-[#98A2B3]">
                Projected total = approved values so far, plus each remaining target at the pace achieved so far.
              </p>
            )}
          </section>

          {/* This period */}
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
            Answers and warnings come from fixed rules (90% and 50% of target) on your reported data. They are calculated, not written by an AI model. See{" "}
            <Link to="/me-dashboard/guides" className="font-medium text-[#5B3FD0] hover:underline">Guides</Link> for how progress is read.
          </p>
        </>
      )}
    </Page>
  );
}

export default MEInsights;
