import { useMemo, useState } from "react";
import {
  CARD, ErrorBar, FIELD, FrameworkSelect, NoFramework, Page, PageHead, PROGRESS, progressOf, useMEData,
} from "./Shared";

/* Where each indicator is heading by its last reporting period.
   Method (the same one the Insights page uses): approved results so far, plus each remaining
   quarter's target at the pace reached so far (the average share of target achieved).
   Percentage indicators are projected against their final target instead of a total.
   Values awaiting approval, including corrections, are not counted until they are approved. */

const VERDICT = {
  on: "On course",
  risk: "At risk",
  off: "Unlikely to meet target",
  none: "No data yet",
};

/* Most urgent first */
const SEVERITY = { off: 0, risk: 1, none: 2, on: 3 };
const ORDER = ["off", "risk", "none", "on"];

/* Same header bands as the Indicators page, cycled by result */
const BANDS = [
  { bg: "#E9F6F1", bar: "#00664E", text: "#064E3B" },
  { bg: "#EEEBFB", bar: "#5B3FD0", text: "#3B2A8F" },
  { bg: "#FEF6D8", bar: "#CA9A04", text: "#7A5B00" },
  { bg: "#E8F1FD", bar: "#2E6FD8", text: "#1E4C9A" },
];

const GROUPS = [
  ["outlook", "Outlook"],
  ["result", "Result"],
  ["none", "No grouping"],
];

const short = (p) => String(p).replace(/^\d{4}-/, "");
const round1 = (n) => Math.round(n * 10) / 10;
const fmtDay = (s) => {
  const t = s ? new Date(s).getTime() : NaN;
  return Number.isNaN(t) ? "" : new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};
const fmt = (n) => Number(round1(n)).toLocaleString();

const formatOf = (ind) =>
  ind.format || (/%|percent/i.test(ind.unit || "") ? "Percentage" : "Numeric");

/* One indicator's outlook, from its quarterly targets and approved values */
function forecastFor(data, ind) {
  const periods = data.framework.periods;
  const rows = periods
    .filter((p) => ind.targets?.[p] !== undefined && ind.targets[p] !== "")
    .map((p) => {
      const t = Number(ind.targets[p]);
      const approved = data.values.find((v) => v.indicatorId === ind.id && v.period === p && v.status === "approved");
      const waiting = data.values.find((v) => v.indicatorId === ind.id && v.period === p && v.status === "submitted");
      return {
        p,
        short: short(p),
        t,
        actual: approved ? Number(approved.actual) : null,
        waiting: !approved && Boolean(waiting),
        projected: null,
      };
    });
  if (rows.length === 0) return null;

  const isPct = formatOf(ind) === "Percentage";
  const reported = rows.filter((r) => r.actual !== null);
  const remaining = rows.filter((r) => r.actual === null);
  const ratios = reported.filter((r) => r.t > 0).map((r) => r.actual / r.t);
  const pace = ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : null;
  const waiting = rows.filter((r) => r.waiting).length;
  const lastRow = rows[rows.length - 1];

  const targetTotal = isPct ? lastRow.t : rows.reduce((s, r) => s + r.t, 0);
  const base = { ind, rows, isPct, pace, waiting, reportedCount: reported.length, targetTotal, lastRow };

  if (reported.length === 0 || pace === null) {
    return { ...base, state: "nodata", actualSoFar: 0, projectedTotal: null, ratio: null, verdict: "none" };
  }

  const actualSoFar = reported.reduce((s, r) => s + r.actual, 0);

  /* Every quarter reported: this is a result, not a projection */
  if (remaining.length === 0) {
    const finalValue = isPct ? lastRow.actual : actualSoFar;
    const ratio = targetTotal > 0 ? Math.round((finalValue / targetTotal) * 100) : null;
    return { ...base, state: "complete", actualSoFar, projectedTotal: finalValue, ratio, verdict: progressOf(ratio) };
  }

  for (const r of remaining) r.projected = r.t * pace;

  /* Percentages: the final target at the pace so far. Counts: reported total plus remaining targets at that pace. */
  const projectedTotal = isPct ? lastRow.t * pace : actualSoFar + remaining.reduce((s, r) => s + r.t, 0) * pace;
  const ratio = targetTotal > 0 ? Math.round((projectedTotal / targetTotal) * 100) : null;
  return { ...base, state: "projected", actualSoFar, projectedTotal, ratio, verdict: progressOf(ratio) };
}

/* A plain sentence explaining the outlook */
function explain(f) {
  const mark = f.isPct ? "%" : "";
  const unit = !f.isPct && f.ind.unit ? ` ${f.ind.unit}` : "";
  const last = f.lastRow.short;
  const waiting = f.waiting ? ` ${f.waiting} ${f.waiting === 1 ? "value is" : "values are"} awaiting approval.` : "";

  if (f.state === "nodata") return `No approved values yet.${waiting}`;
  if (f.state === "complete") {
    return f.isPct
      ? `All quarters are reported. The final result is ${fmt(f.projectedTotal)}% against a target of ${fmt(f.targetTotal)}%.`
      : `All quarters are reported: ${fmt(f.actualSoFar)} of ${fmt(f.targetTotal)}${unit}.`;
  }
  const pace = Math.round(f.pace * 100);
  return f.isPct
    ? `At ${pace}% of each target so far, it is on course to reach about ${fmt(f.projectedTotal)}% by ${last}, against a final target of ${fmt(f.targetTotal)}%.${waiting}`
    : `At ${pace}% of target so far, it is on course for about ${fmt(f.projectedTotal)} of ${fmt(f.targetTotal)}${unit} by ${last}.${waiting}`;
}

const confidenceOf = (f) =>
  f.state !== "projected" ? "" : f.reportedCount >= 3 ? "" : f.reportedCount === 2 ? "Based on two quarters" : "Early estimate, one quarter";

/* Quarter by quarter: target (grey), approved result (solid), projected (dashed) */
function QuarterChart({ f }) {
  const W = 300, H = 104, L = 6, R = 6, T = 10, B = 20;
  const n = f.rows.length;
  const slot = (W - L - R) / n;
  const barW = Math.min(40, slot * 0.72);
  const color = f.verdict === "none" ? "#98A2B3" : PROGRESS[f.verdict].color;
  const max = Math.max(1, ...f.rows.map((r) => r.t), ...f.rows.map((r) => r.actual ?? 0), ...f.rows.map((r) => r.projected ?? 0)) * 1.06;
  const base = H - B;
  const y = (v) => T + (1 - v / max) * (base - T);
  const label = `Quarterly targets and results for ${f.ind.name}`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={label}>
      <line x1={L} x2={W - R} y1={base} y2={base} stroke="#E5E7EB" />
      {f.rows.map((r, i) => {
        const cx = L + slot * i + slot / 2;
        return (
          <g key={r.p}>
            <rect x={cx - barW / 2} y={y(r.t)} width={barW} height={Math.max(base - y(r.t), 0)} rx="3" fill="#F2F4F7" stroke="#D0D5DD">
              <title>{`${r.p} target: ${r.t}`}</title>
            </rect>
            {r.actual !== null && (
              <rect x={cx - barW * 0.3} y={y(r.actual)} width={barW * 0.6} height={Math.max(base - y(r.actual), 0)} rx="2" fill={color}>
                <title>{`${r.p} approved: ${r.actual}`}</title>
              </rect>
            )}
            {r.projected !== null && (
              <rect x={cx - barW * 0.3} y={y(r.projected)} width={barW * 0.6} height={Math.max(base - y(r.projected), 0)} rx="2" fill={`${color}26`} stroke={color} strokeWidth="1.5" strokeDasharray="3 2">
                <title>{`${r.p} projected: ${round1(r.projected)}`}</title>
              </rect>
            )}
            {r.waiting && (
              <circle cx={cx} cy={base - 6} r="3" fill="#D4A600">
                <title>{`${r.p}: a value is awaiting approval`}</title>
              </circle>
            )}
            <text x={cx} y={H - 5} textAnchor="middle" fontSize="10" fill="#98A2B3">{r.short}</text>
          </g>
        );
      })}
    </svg>
  );
}

function Outlook({ verdict }) {
  const color = PROGRESS[verdict].color;
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold"
      style={{ backgroundColor: `${color}1F`, color: verdict === "none" ? "#475467" : color }}
    >
      <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      {VERDICT[verdict]}
    </span>
  );
}

function ForecastCard({ f, resultTitle, band }) {
  const color = f.verdict === "none" ? "#D0D5DD" : PROGRESS[f.verdict].color;
  const mark = f.isPct ? "%" : "";
  const unit = !f.isPct && f.ind.unit ? f.ind.unit : "";
  const note = confidenceOf(f);

  return (
    <article className={`${CARD} flex flex-col overflow-hidden`} style={{ borderTop: `4px solid ${color}` }}>
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="flex flex-wrap items-center gap-2 text-[15px] font-semibold leading-5 text-[#101828]">
              {f.ind.name}
              {f.ind.kpi && (
                <span title="Key performance indicator" className="rounded-md bg-[#FEF6D8] px-1.5 py-0.5 text-[11px] font-bold text-[#7A5B00]">KPI</span>
              )}
            </h3>
            {resultTitle && (
              <p className="mt-1 flex items-center gap-1.5 text-xs text-[#667085]">
                <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: band.bar }} />
                <span className="truncate">{resultTitle}</span>
              </p>
            )}
          </div>
          <Outlook verdict={f.verdict} />
        </div>

        <div className="mt-4 flex items-end justify-between gap-4">
          <div>
            <p className="text-3xl font-semibold tracking-tight tabular-nums text-[#101828]">
              {f.state === "nodata" ? "-" : fmt(f.projectedTotal)}
              {f.state !== "nodata" && <span className="text-lg font-medium text-[#98A2B3]">{mark}</span>}
              <span className="ml-1.5 text-sm font-normal text-[#98A2B3]">/ {fmt(f.targetTotal)}{mark}</span>
            </p>
            <p className="mt-0.5 text-xs text-[#667085]">
              {f.state === "complete" ? "Final result" : f.state === "projected" ? "Projected by " + f.lastRow.short : "Target by " + f.lastRow.short}
              {unit ? ` · ${unit}` : ""}
            </p>
          </div>
          {f.ratio !== null && (
            <div className="w-28 text-right">
              <p className="text-sm font-semibold tabular-nums text-[#344054]">{f.ratio}% of target</p>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[#EEF0F4]" aria-hidden="true">
                <div className="h-full rounded-full" style={{ width: `${Math.min(f.ratio, 100)}%`, backgroundColor: color }} />
              </div>
            </div>
          )}
        </div>

        <div className="mt-4">
          <QuarterChart f={f} />
        </div>

        <p className="mt-3 text-[13px] leading-5 text-[#475467]">{explain(f)}</p>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[#F2F4F7] bg-[#FCFCFD] px-5 py-2.5 text-xs text-[#667085]">
        <span>{f.reportedCount} of {f.rows.length} quarters approved</span>
        {f.waiting > 0 && <span className="font-medium text-[#7A5C00]">{f.waiting} awaiting approval</span>}
        {note && <span className="ml-auto text-[#98A2B3]">{note}</span>}
      </div>
    </article>
  );
}

function MEPredictions() {
  const { isAdmin, frameworks, selectedId, setSelectedId, data, fw, ordered, busy, error } = useMEData();
  const [filter, setFilter] = useState("all");
  const [groupBy, setGroupBy] = useState("outlook");
  const [resultFilter, setResultFilter] = useState("");
  const [query, setQuery] = useState("");

  const forecasts = useMemo(
    () => (data ? data.indicators.map((ind) => forecastFor(data, ind)).filter(Boolean) : []),
    [data]
  );

  const counts = Object.fromEntries(Object.keys(VERDICT).map((k) => [k, forecasts.filter((f) => f.verdict === k).length]));

  /* Project outlook: each indicator's projected % of target, averaged. Every indicator counts up to 100%,
     so over-achieving on one does not hide a shortfall on another, and units do not matter. */
  const rated = forecasts.filter((f) => f.ratio !== null);
  const projectPct = rated.length ? Math.round(rated.reduce((s, f) => s + Math.min(f.ratio, 100), 0) / rated.length) : null;
  const projectVerdict = progressOf(projectPct);
  const lastPeriod = fw?.periods?.[fw.periods.length - 1] || "";

  const resultById = useMemo(() => new Map(ordered.map((r, i) => [r.id, { title: r.title, band: BANDS[i % BANDS.length] }])), [ordered]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return forecasts
      .filter(
        (f) =>
          (filter === "all" || f.verdict === filter) &&
          (!resultFilter || f.ind.resultId === resultFilter) &&
          (!q || f.ind.name.toLowerCase().includes(q))
      )
      .sort((a, b) => SEVERITY[a.verdict] - SEVERITY[b.verdict] || (a.ratio ?? 999) - (b.ratio ?? 999) || a.ind.name.localeCompare(b.ind.name));
  }, [forecasts, filter, resultFilter, query]);

  /* Sections: by outlook (most urgent first), by result (framework order), or one flat list */
  const sections = useMemo(() => {
    if (groupBy === "outlook") {
      return ORDER.map((k) => ({
        key: k,
        title: VERDICT[k],
        color: PROGRESS[k].color,
        items: shown.filter((f) => f.verdict === k),
      })).filter((s) => s.items.length > 0);
    }
    if (groupBy === "result") {
      return ordered
        .map((r, i) => ({ key: r.id, title: r.title, band: BANDS[i % BANDS.length], items: shown.filter((f) => f.ind.resultId === r.id) }))
        .filter((s) => s.items.length > 0);
    }
    return [{ key: "all", title: "", items: shown }].filter((s) => s.items.length > 0);
  }, [groupBy, shown, ordered]);

  const total = forecasts.length;
  const needAttention = counts.off + counts.risk;
  const headline =
    total === 0
      ? "No indicators have quarterly targets yet."
      : `${counts.on} of ${total} ${total === 1 ? "indicator is" : "indicators are"} on course to meet ${total === 1 ? "its" : "their"} targets.`;
  const subline =
    total === 0
      ? ""
      : needAttention > 0
        ? `${needAttention} ${needAttention === 1 ? "needs" : "need"} attention.${counts.none ? ` ${counts.none} ${counts.none === 1 ? "has" : "have"} no approved data yet.` : ""}`
        : counts.none
          ? `${counts.none} ${counts.none === 1 ? "has" : "have"} no approved data yet.`
          : "Nothing is projected to fall short.";

  const FILTERS = [["all", "All", total], ...ORDER.map((k) => [k, VERDICT[k], counts[k]])];

  return (
    <Page>
      <PageHead title="Predictions" subtitle={fw ? `Where each indicator is heading by its last quarter, ${fw.name}` : ""}>
        <FrameworkSelect frameworks={frameworks} value={selectedId} onChange={setSelectedId} />
      </PageHead>

      <ErrorBar error={error} />
      {!fw && <NoFramework isAdmin={isAdmin} busy={busy} />}

      {fw && (
        <>
          {/* Headline: one sentence and one bar */}
          <section aria-label="Forecast summary" className={`${CARD} p-6`}>
            <div className="mb-5 flex flex-wrap items-center gap-x-8 gap-y-3 border-b border-[#F2F4F7] pb-5">
              <div>
                <p className="text-xs font-medium text-[#667085]">Project outlook</p>
                <p className="mt-1 text-4xl font-semibold tracking-tight tabular-nums text-[#101828]">
                  {projectPct === null ? "-" : `${projectPct}%`}
                </p>
                <p className="mt-0.5 text-xs text-[#667085]">
                  projected share of targets{lastPeriod ? ` by ${short(lastPeriod)}` : ""}
                </p>
              </div>
              <div className="min-w-[240px] flex-1">
                <Outlook verdict={projectVerdict} />
                <p className="mt-2 text-sm leading-6 text-[#475467]">
                  {projectPct === null
                    ? "No indicator has approved data yet, so the project cannot be projected."
                    : `Averaging the projected result of ${rated.length} of ${total} ${total === 1 ? "indicator" : "indicators"}${
                        rated.length < total ? " (the rest have no approved data yet)" : ""
                      }, the project is on course to reach about ${projectPct}% of its targets.${
                        fw.endDate ? ` It ends on ${fmtDay(fw.endDate)}.` : ""
                      }`}
                </p>
              </div>
            </div>

            <h2 className="text-lg font-semibold text-[#101828]">{headline}</h2>
            {subline && <p className="mt-0.5 text-sm text-[#667085]">{subline}</p>}

            {total > 0 && (
              <>
                <div
                  className="mt-4 flex h-3 overflow-hidden rounded-full bg-[#EEF0F4]"
                  role="img"
                  aria-label={ORDER.map((k) => `${VERDICT[k]}: ${counts[k]}`).join(", ")}
                >
                  {ORDER.map((k) =>
                    counts[k] > 0 ? (
                      <div key={k} title={`${VERDICT[k]}: ${counts[k]}`} style={{ width: `${(counts[k] / total) * 100}%`, backgroundColor: PROGRESS[k].color }} />
                    ) : null
                  )}
                </div>
                <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 text-sm text-[#475467]">
                  {ORDER.map((k) => (
                    <li key={k} className="flex items-center gap-2">
                      <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: PROGRESS[k].color }} />
                      {VERDICT[k]}
                      <span className="font-semibold tabular-nums text-[#101828]">{counts[k]}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          {/* Controls */}
          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label="Filter by outlook" className="flex flex-wrap gap-1.5">
              {FILTERS.map(([key, label, n]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={filter === key}
                  onClick={() => setFilter(key)}
                  className={`rounded-full px-3.5 py-1.5 text-[13px] font-medium transition ${
                    filter === key ? "bg-[#EDE9FB] text-[#5B3FD0]" : "text-[#475467] ring-1 ring-inset ring-[#E5E7EB] hover:bg-[#F4F5F7]"
                  }`}
                >
                  {label} <span className="ml-1 tabular-nums opacity-70">{n}</span>
                </button>
              ))}
            </div>

            <div className="ml-auto flex flex-wrap items-center gap-2">
              <input className={`${FIELD} w-52`} placeholder="Search" aria-label="Search indicators" value={query} onChange={(e) => setQuery(e.target.value)} />
              <select className={`${FIELD} max-w-[240px]`} aria-label="Filter by result" value={resultFilter} onChange={(e) => setResultFilter(e.target.value)}>
                <option value="">All results</option>
                {ordered.map((r) => (
                  <option key={r.id} value={r.id} style={{ color: "#101828", background: "#FFFFFF" }}>{r.title}</option>
                ))}
              </select>
              <label className="flex items-center gap-2 text-xs font-medium text-[#475467]">
                Group by
                <select className={FIELD} value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
                  {GROUPS.map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {sections.length === 0 && (
            <div className={`${CARD} px-6 py-12 text-center text-sm text-[#98A2B3]`}>
              {forecasts.length === 0 ? "No indicators have quarterly targets yet." : "No indicators match."}
            </div>
          )}

          {sections.map((s) => (
            <section key={s.key} aria-label={s.title || "Indicators"} className="space-y-3">
              {s.title && (
                <h2
                  className={`flex items-center gap-2 text-sm font-semibold ${s.band ? "rounded-lg border-l-4 px-4 py-2.5" : ""}`}
                  style={s.band ? { background: s.band.bg, borderLeftColor: s.band.bar, color: s.band.text } : { color: "#101828" }}
                >
                  {s.color && <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />}
                  {s.title}
                  <span className="rounded-full bg-white/70 px-2 text-xs font-medium text-[#475467] ring-1 ring-inset ring-[#E5E7EB]">{s.items.length}</span>
                </h2>
              )}
              <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
                {s.items.map((f) => {
                  const res = resultById.get(f.ind.resultId);
                  return <ForecastCard key={f.ind.id} f={f} resultTitle={res?.title} band={res?.band ?? BANDS[0]} />;
                })}
              </div>
            </section>
          ))}

          <p className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-[#98A2B3]">
            <span className="flex items-center gap-1.5">
              <svg width="14" height="12" aria-hidden="true"><rect x="1" y="1" width="12" height="10" rx="2" fill="#F2F4F7" stroke="#D0D5DD" /></svg>
              Quarterly target
            </span>
            <span className="flex items-center gap-1.5">
              <svg width="14" height="12" aria-hidden="true"><rect x="3" y="2" width="8" height="9" rx="1.5" fill="#5B3FD0" /></svg>
              Approved result
            </span>
            <span className="flex items-center gap-1.5">
              <svg width="14" height="12" aria-hidden="true"><rect x="3" y="2" width="8" height="9" rx="1.5" fill="#5B3FD01F" stroke="#5B3FD0" strokeDasharray="3 2" /></svg>
              Projected
            </span>
            <span className="flex items-center gap-1.5">
              <svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="3.5" fill="#D4A600" /></svg>
              Awaiting approval
            </span>
          </p>
          <p className="text-xs text-[#98A2B3]">
            The project outlook averages each indicator's projected percentage of target, so units do not matter. Each indicator counts up to 100%, so over-achieving on one does not hide a shortfall on another. Projected total = approved results so far, plus each remaining quarterly target at the pace reached so far. Percentage indicators are projected against their final target. A value that is awaiting approval, including a correction, is not counted until it is approved. A projection assumes higher is better and is a guide, not a promise: with only one or two approved quarters it is an early estimate.
          </p>
        </>
      )}
    </Page>
  );
}

export default MEPredictions;
