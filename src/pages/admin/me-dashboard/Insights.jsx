import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../../meApi";
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
  "What should we focus on this quarter?",
];

const Icon = ({ children }) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);
const BrainIcon = () => (
  <Icon>
    <path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1V5a3 3 0 0 0-3-1Z" />
    <path d="M15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1" />
    <path d="M9 9h1.5M13.5 9H15M9 14h1.5M13.5 14H15" />
  </Icon>
);
const ChartIcon = () => (
  <Icon>
    <path d="M4 20V10M9 20V4M14 20v-7M19 20V8" />
  </Icon>
);
const ShieldIcon = () => (
  <Icon>
    <path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6l-7-3Z" />
    <path d="M12 8v4M12 15.5v.01" />
  </Icon>
);
const BulbIcon = () => (
  <Icon>
    <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3Z" />
  </Icon>
);
const TableIcon = () => (
  <Icon>
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <path d="M4 10h16M10 10v10" />
  </Icon>
);

/* The four ways to start. The mode steers the AI's focus; the figures are always the calculated ones. */
const MODES = [
  {
    key: "performance",
    title: "Performance analysis",
    blurb: "Explain progress and compare results.",
    Glyph: ChartIcon,
    tone: "#5B3FD0",
    prompts: ["How are we doing overall?", "Show progress by period", "Show progress by result", "Which indicators are on track?"],
  },
  {
    key: "risk",
    title: "Risk detection",
    blurb: "Identify lagging indicators and reporting gaps.",
    Glyph: ShieldIcon,
    tone: "#B54708",
    prompts: ["Which indicators are off track?", "Which indicators will miss their targets by year end?", "What has not been reported?", "What is waiting for approval?"],
  },
  {
    key: "recommendations",
    title: "Recommendations",
    blurb: "Suggest follow-up actions based on evidence.",
    Glyph: BulbIcon,
    tone: "#1F7A5C",
    prompts: ["What should we focus on this quarter?", "What actions would get off-track indicators back on course?", "Which reporting gaps should we close first?"],
  },
  {
    key: "report",
    title: "Report generation",
    blurb: "Prepare summaries and exportable tables.",
    Glyph: TableIcon,
    tone: "#5B3FD0",
    prompts: ["Write a progress summary for this period", "Summarise risks for a donor update", "Summarise results by level"],
  },
];

const NO_MATCH_TITLE = "I can't answer that yet";

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

/* Turn a question into a calculated answer: { title, text, columns, rows }. This is the source of truth for figures. */
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
    title: NO_MATCH_TITLE,
    text: "Try asking about progress overall, indicators that are off track or at risk, values waiting for approval, what has not been reported, projections to year end, progress by period or result, or name an indicator.",
    columns: [],
    rows: [],
  };
}

/*
 * The facts the AI assistant is allowed to use. Every figure comes from the same calculations
 * that drive the rest of this page (buildRows, forecastFor), so the assistant explains numbers
 * and never produces its own. Comments and evidence are not sent.
 */
const MAX_FACTS_CHARS = 70000;
const clip = (s, n = 300) => (typeof s === "string" ? s.slice(0, n) : "");

function buildFacts({ data, fw, ordered, rowsByPeriod, period }) {
  const levelName = (i) => fw.levels?.[i] ?? `Level ${i + 1}`;

  const detail = (periods) =>
    Object.fromEntries(
      periods.map((p) => [
        p,
        (rowsByPeriod[p] ?? [])
          .filter((r) => r.target !== undefined)
          .map((r) => ({
            indicator: r.ind.name,
            unit: r.ind.unit || "",
            result: r.result.title,
            level: levelName(r.result.level),
            target: r.target,
            actual: r.saved?.actual ?? null,
            status: statusOf(r),
            percentOfTarget: r.pct ?? null,
            band: r.progress ?? null,
          })),
      ])
    );

  const rows = rowsByPeriod[period] ?? [];
  const expected = rows.filter((r) => r.target !== undefined);
  const withPct = expected.filter((r) => r.pct !== null);
  const count = (k) => withPct.filter((r) => r.progress === k).length;

  const base = {
    framework: {
      name: fw.name,
      donor: fw.donor || "",
      reportingPeriods: fw.periods,
      levels: fw.levels || [],
      startDate: fw.startDate || "",
      endDate: fw.endDate || "",
    },
    selectedPeriod: period,
    progressBands: { onTrack: "90% of target or more", atRisk: "50% to 89%", offTrack: "below 50%" },
    summaryForSelectedPeriod: {
      indicatorsWithTarget: expected.length,
      indicatorsApproved: withPct.length,
      averagePercentOfTarget: average(withPct.map((r) => r.pct)),
      onTrack: count("on"),
      atRisk: count("risk"),
      offTrack: count("off"),
      awaitingApproval: rows.filter((r) => r.saved?.status === "submitted").length,
      rejected: rows.filter((r) => r.saved?.status === "rejected").length,
      notReported: expected.filter((r) => !r.saved).length,
    },
    results: ordered.slice(0, 80).map((res) => ({
      title: res.title,
      level: levelName(res.level),
      meansOfVerification: clip(res.meansOfVerification),
      assumptions: clip(res.assumptions),
      risks: clip(res.risks),
    })),
    yearEndProjections: data.indicators
      .map((i) => forecastFor(data, i))
      .filter(Boolean)
      .slice(0, 100)
      .map((f) => ({
        indicator: f.ind.name,
        paceSoFarPercent: f.pace,
        fullYearTarget: f.targetSum,
        projectedTotal: f.projected,
        projectedPercentOfTarget: f.projectedPct,
        periodsStillToReport: f.remainingPeriods,
      })),
  };

  const full = { ...base, indicatorsByPeriod: detail(fw.periods) };
  if (JSON.stringify(full).length <= MAX_FACTS_CHARS) return full;
  return { ...base, note: "Because of the size of this framework, only the selected period is shown in detail.", indicatorsByPeriod: detail([period]) };
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

/* One answer: the AI's written reply, then the calculated figures behind it */
function AnswerCard({ a }) {
  const showFigures = a.columns.length > 0;
  return (
    <article className="rounded-lg border border-[#EEF0F4] p-4">
      <p className="text-xs text-[#98A2B3]">You asked: {a.question}</p>

      {a.ai ? (
        <>
          <div className="mt-2 space-y-2 text-sm leading-6 text-[#344054]">
            {a.ai.split(/\n{2,}/).map((para, i) => (
              <p key={i} className="whitespace-pre-line">{para}</p>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-[#98A2B3]">
            Written by an AI assistant from the figures calculated for {a.period}. Check the figures below.
          </p>
        </>
      ) : (
        <>
          <h3 className="mt-1 text-sm font-semibold text-[#101828]">{a.title}</h3>
          <p className="mt-1 text-sm text-[#475467]">{a.text}</p>
          {a.aiError && (
            <p role="status" className="mt-2 rounded-md bg-[#FFFAEB] px-3 py-2 text-xs text-[#7A5C00]">
              The AI assistant is not available right now ({a.aiError}). This answer comes from the calculated figures only.
            </p>
          )}
        </>
      )}

      {showFigures && (
        <div className="mt-3">
          {a.ai && (
            <h3 className="text-xs font-semibold text-[#344054]">
              {a.title} <span className="font-normal text-[#98A2B3]">(calculated)</span>
            </h3>
          )}
          <AnswerTable columns={a.columns} rows={a.rows} />
          <div className="mt-3">
            <ExportButton title={a.title} period={a.period} columns={a.columns} rows={a.rows} />
          </div>
        </div>
      )}
    </article>
  );
}

/* The figures and flags are calculated by fixed rules. The conversational answers are written by an AI model from those figures. */
function MEInsights() {
  const { isAdmin, frameworks, selectedId, setSelectedId, data, fw, ordered, rows, period, setPeriod, busy, error } = useMEData();
  const [question, setQuestion] = useState("");
  const [answers, setAnswers] = useState([]);
  const [asking, setAsking] = useState(false);
  const [mode, setMode] = useState("");

  /* A new framework starts a new conversation */
  useEffect(() => {
    setAnswers([]);
    setQuestion("");
    setMode("");
  }, [selectedId]);

  const rowsByPeriod = useMemo(
    () => (data ? Object.fromEntries(data.framework.periods.map((p) => [p, buildRows(data, ordered, p)])) : {}),
    [data, ordered]
  );

  const ask = async (text) => {
    const q = text.trim();
    if (!q || !data || asking) return;

    /* The calculated answer always runs first. It supplies the figures and is the fallback. */
    const calculated = answerQuestion(q, { data, fw, period, rows, rowsByPeriod, ordered });
    const id = Date.now();

    /* Earlier exchanges, oldest first, so follow-up questions make sense */
    const history = [...answers]
      .reverse()
      .filter((a) => a.ai)
      .slice(-4)
      .map((a) => ({ question: a.question, answer: a.ai }));

    setQuestion("");
    setAsking(true);
    let ai = "";
    let aiError = "";
    try {
      const reply = await api(`/me/frameworks/${selectedId}/assistant`, {
        method: "POST",
        body: { question: q, mode, history, facts: buildFacts({ data, fw, ordered, rowsByPeriod, period }) },
      });
      ai = String(reply?.answer || "").trim();
      if (!ai) aiError = "it returned no answer";
    } catch (err) {
      aiError = err?.message || "it could not be reached";
    }

    /* A question the rules could not match has no figures to show; keep only the AI reply (or the error) */
    const matched = calculated.title !== NO_MATCH_TITLE;
    setAnswers((cur) =>
      [
        {
          ...(matched ? calculated : { title: calculated.title, text: calculated.text, columns: [], rows: [] }),
          ai,
          aiError,
          question: q,
          period,
          id,
        },
        ...cur,
      ].slice(0, 5)
    );
    setAsking(false);
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

          {/* EACHRights Intelligence */}
          <section className={`${CARD} overflow-hidden`} aria-label="EACHRights Intelligence">
            <div className="bg-[#F5F3FF] px-5 py-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-4">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#5B3FD0] text-white">
                    <BrainIcon />
                  </span>
                  <div>
                    <h2 className="text-xl font-semibold text-[#101828]">EACHRights Intelligence</h2>
                    <p className="text-sm text-[#667085]">AI-powered monitoring and evaluation</p>
                  </div>
                </div>
                <span className="rounded-full bg-[#E9E3FB] px-3 py-1 text-xs font-semibold text-[#5B3FD0]">AI assistant</span>
              </div>
              <p className="mt-4 text-sm leading-6 text-[#475467]">
                Ask questions, investigate performance, identify risks and turn programme data into actionable recommendations.
              </p>
            </div>

            <div className="p-5">
              <h3 className="text-[15px] font-semibold text-[#101828]">What should we investigate?</h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {MODES.map(({ key, title, blurb, Glyph, tone }) => {
                  const active = mode === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setMode(active ? "" : key)}
                      className={`rounded-xl border p-4 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#5B3FD0] ${
                        active ? "border-[#5B3FD0] bg-[#F8F7FE]" : "border-[#E5E7EB] bg-white hover:border-[#C9BDF2]"
                      }`}
                    >
                      <span style={{ color: tone }}><Glyph /></span>
                      <span className="mt-3 block text-base font-semibold text-[#101828]">{title}</span>
                      <span className="mt-1 block text-sm text-[#667085]">{blurb}</span>
                    </button>
                  );
                })}
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <input
                  className={`${FIELD} grow basis-72`}
                  placeholder={
                    mode === "report"
                      ? "For example, write a progress summary for this period"
                      : "For example, why might our outputs be behind?"
                  }
                  aria-label="Your question"
                  value={question}
                  maxLength={1000}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && ask(question)}
                />
                <button type="button" className={BTN} disabled={!question.trim() || asking} onClick={() => ask(question)}>
                  {asking ? "Thinking" : "Ask"}
                </button>
                {answers.length > 0 && (
                  <button type="button" className={BTN_LIGHT} onClick={() => setAnswers([])} disabled={asking}>
                    Clear conversation
                  </button>
                )}
              </div>
              <p className="mt-2 text-xs text-[#667085]">
                Answers use the figures calculated for {fw.name}, {period}, and always show those figures.
              </p>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {(mode ? MODES.find((m) => m.key === mode).prompts : SUGGESTIONS).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => ask(s)}
                    disabled={asking}
                    className="rounded-full border border-[#E5E7EB] bg-white px-3 py-1 text-xs font-medium text-[#475467] transition hover:border-[#5B3FD0] hover:text-[#5B3FD0] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {s}
                  </button>
                ))}
              </div>

              <div aria-live="polite" className="mt-4 space-y-3 empty:hidden">
                {asking && <p className="text-sm text-[#667085]">Working on your answer.</p>}
                {answers.map((a) => (
                  <AnswerCard key={a.id} a={a} />
                ))}
              </div>
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
            Figures, tables, early warnings and the cards on this page are calculated by fixed rules (90% and 50% of target) on your reported data. Conversational answers are written by an AI model that is given only those figures, so it can make mistakes: check them against the tables. Indicator names, targets and values are sent to the AI service to write an answer; comments and evidence are not. See{" "}
            <Link to="/me-dashboard/guides" className="font-medium text-[#5B3FD0] hover:underline">Guides</Link> for how progress is read.
          </p>
        </>
      )}
    </Page>
  );
}

export default MEInsights;
