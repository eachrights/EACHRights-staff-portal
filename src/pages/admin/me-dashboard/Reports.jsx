import { useEffect, useMemo, useState } from "react";
import { DEPARTMENT_AREAS, PROGRAM_AREAS } from "../../../access";
import { api, downloadCsv } from "../../../meApi";
import { LABELS } from "../../../labels";
import {
  BTN, BTN_LIGHT, CARD, ErrorBar, FIELD, FrameworkSelect, NoFramework, Page, PageHead, PeriodTabs,
  PROGRESS, ProgressDot, progressOf, useMEData,
} from "./Shared";

/*
 * Three report types, built in a two-column workspace: choose what goes in on the left,
 * see the finished page on the right, then print it or save it as a PDF.
 *  Visual report       summary, key figures, charts, outlook, results with analysis, data notes,
 *                      next steps and an evidence index. The summary and next steps can be drafted
 *                      from the figures, or written by the AI assistant, and are always editable.
 *  Table-based report  every result and indicator with baseline, targets and actuals for each period
 *  Program report      the projects of one programme brought together, with combined results
 * Only approved values count towards progress and results.
 */

const AREAS = [...PROGRAM_AREAS, ...DEPARTMENT_AREAS];
const areaName = (slug) => AREAS.find((a) => a.slug === slug)?.name || slug || "No area";

const VIEWS = [
  ["visual", "Visual report", "Summary, charts, outlook and analysis"],
  ["table", "Table-based report", "Targets and actuals for every period"],
  ["program", LABELS.programmeReport, "The projects of one programme together"],
];

const ACCENTS = [
  ["#00664E", "EACHRights Green"],
  ["#1F7A5C", "Forest Green"],
  ["#2D8A68", "Leaf Green"],
  ["#344054", "Charcoal"],
  ["#B54708", "Amber"],
];

const DEFAULT_SECTIONS = {
  summary: true,
  figures: true,
  charts: true,
  outlook: true,
  results: true,
  quality: true,
  recs: true,
  evidence: false,
};
const SECTION_LABELS = [
  ["summary", "Executive summary", "A short written overview"],
  ["figures", "Key figures", "The headline numbers"],
  ["charts", "Charts", "Progress, trend and reporting status"],
  ["outlook", "Outlook", "Where the project is heading"],
  ["results", "Results and analysis", "Each result with your comments"],
  ["quality", "Data notes", "What is waiting, rejected or missing"],
  ["recs", "Next steps", "Recommended follow-up"],
  ["evidence", "Evidence index", "Files and links behind the values"],
];
const CHARTS = [
  ["progress", "Progress against target"],
  ["trend", "Achievement by period"],
  ["levels", "Reporting status by result"],
];

const MAX_IMAGE_BYTES = 1_500_000;
const fmt = (n) => (n === undefined || n === null || n === "" ? "-" : Number(n).toLocaleString());
const pctOf = (actual, target) => (target ? Math.round((actual / target) * 100) : null);
const average = (list) => (list.length ? Math.round(list.reduce((a, b) => a + b, 0) / list.length) : null);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const isGenderType = (type) =>
  /\b(gender|sex)\b/i.test([type?.name, type?.slug, type?.code, type?.key].filter(Boolean).join(" "));

/* Where an indicator is heading by its last period, as a share of its full-year target.
   The same method as the Predictions page and the portfolio: approved results so far, plus each
   remaining quarter's target at the pace reached so far. Percentage indicators use their final target. */
function projectIndicator(ind, approved, periods) {
  const rows = periods
    .filter((p) => ind.targets?.[p] !== undefined && ind.targets[p] !== "")
    .map((p) => {
      const v = approved.get(`${ind.id}#${p}`);
      return { t: Number(ind.targets[p]), actual: v ? Number(v.actual) : null };
    });
  if (rows.length === 0) return null;
  const isPct = (ind.format || (/%|percent/i.test(ind.unit || "") ? "Percentage" : "Numeric")) === "Percentage";
  const reported = rows.filter((r) => r.actual !== null);
  const remaining = rows.filter((r) => r.actual === null);
  const ratios = reported.filter((r) => r.t > 0).map((r) => r.actual / r.t);
  if (ratios.length === 0) return { ind, ratio: null };
  const pace = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  const last = rows[rows.length - 1];
  const targetTotal = isPct ? last.t : rows.reduce((s, r) => s + r.t, 0);
  const actualSoFar = reported.reduce((s, r) => s + r.actual, 0);
  const remainingTargets = remaining.reduce((s, r) => s + r.t, 0);
  const projected =
    remaining.length === 0 ? (isPct ? last.actual : actualSoFar) : isPct ? last.t * pace : actualSoFar + remainingTargets * pace;
  return { ind, ratio: targetTotal > 0 ? Math.round((projected / targetTotal) * 100) : null };
}

/* ---------- Small charts (plain SVG and CSS, so they print cleanly) ---------- */

function ProgressBar({ counts, total }) {
  return (
    <div>
      <div
        className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-[#EEF0F4]"
        role="img"
        aria-label={Object.entries(PROGRESS).map(([k, v]) => `${v.label}: ${counts[k]}`).join(", ")}
      >
        {total > 0 &&
          Object.entries(PROGRESS).map(([k, v]) =>
            counts[k] > 0 ? <div key={k} style={{ width: `${(counts[k] / total) * 100}%`, backgroundColor: v.color }} /> : null
          )}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
        {Object.entries(PROGRESS).map(([k, v]) => (
          <li key={k} className="flex items-center gap-2 text-[#475467]">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[3px]" style={{ backgroundColor: v.color }} />
            {v.label}
            <span className="ml-auto font-semibold tabular-nums text-[#101828]">{counts[k]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TrendLine({ points, accent }) {
  const known = points.filter((p) => p.pct !== null);
  if (known.length === 0) return <p className="py-8 text-center text-sm text-[#98A2B3]">No approved values yet.</p>;
  const W = 420, H = 170, L = 36, R = 10, T = 10, B = 24;
  const yMax = Math.max(100, Math.ceil(Math.max(...known.map((p) => p.pct)) / 25) * 25);
  const x = (i) => (points.length === 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (points.length - 1));
  const y = (v) => T + (1 - v / yMax) * (H - T - B);
  const seq = points.map((p, i) => (p.pct === null ? null : { x: x(i), y: y(p.pct), ...p })).filter(Boolean);
  const line = seq.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Average achievement against target by period">
      {[0, 0.5, 1].map((t) => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={y(yMax * t)} y2={y(yMax * t)} stroke="#EEF0F4" />
          <text x={L - 5} y={y(yMax * t) + 3} textAnchor="end" fontSize="10" fill="#98A2B3">{Math.round(yMax * t)}%</text>
        </g>
      ))}
      <line x1={L} x2={W - R} y1={y(100)} y2={y(100)} stroke="#1F7A5C" strokeWidth="1" strokeDasharray="4 3" />
      <path d={line} fill="none" stroke={accent} strokeWidth="2.5" strokeLinejoin="round" />
      {seq.map((p) => (
        <g key={p.period}>
          <circle cx={p.x} cy={p.y} r="4" fill="#fff" stroke={accent} strokeWidth="2.5">
            <title>{`${p.period}: ${p.pct}%`}</title>
          </circle>
          <text x={p.x} y={p.y - 9} textAnchor="middle" fontSize="10" fontWeight="600" fill="#344054">{p.pct}%</text>
        </g>
      ))}
      {points.map((p, i) => (
        <text key={p.period} x={x(i)} y={H - 7} textAnchor="middle" fontSize="10" fill="#98A2B3">{p.period}</text>
      ))}
    </svg>
  );
}

function ResultBars({ groups }) {
  if (groups.length === 0) return <p className="py-8 text-center text-sm text-[#98A2B3]">No indicators have a target this period.</p>;
  const colors = { approved: "#1F7A5C", awaiting: "#D4A600", missing: "#DDDDE0" };
  return (
    <ul className="space-y-2.5">
      {groups.map((g) => (
        <li key={g.id}>
          <p className="truncate text-xs text-[#475467]" title={g.title}>{g.title}</p>
          <div className="mt-1 flex h-2.5 overflow-hidden rounded-full bg-[#EEF0F4]">
            {["approved", "awaiting", "missing"].map((k) =>
              g[k] > 0 ? <div key={k} style={{ width: `${(g[k] / g.total) * 100}%`, backgroundColor: colors[k] }} title={`${g[k]} ${k}`} /> : null
            )}
          </div>
        </li>
      ))}
      <li className="flex flex-wrap gap-x-4 pt-1 text-xs text-[#475467]">
        {Object.entries(colors).map(([k, c]) => (
          <span key={k} className="flex items-center gap-1.5">
            <span aria-hidden="true" className="h-2 w-2 rounded-[3px]" style={{ backgroundColor: c }} />
            {k === "approved" ? "Approved" : k === "awaiting" ? "Awaiting approval" : "Not reported"}
          </span>
        ))}
      </li>
    </ul>
  );
}

/* ---------- Workspace pieces ---------- */

function Toggle({ label, hint, checked, onChange }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 text-sm text-[#344054] transition hover:bg-[#F9FAFB]">
      <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[#00664E]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="min-w-0">
        {label}
        {hint && <span className="block text-xs text-[#98A2B3]">{hint}</span>}
      </span>
    </label>
  );
}

function PanelTitle({ children }) {
  return <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#667085]">{children}</h2>;
}

/* Title, branding and who prepared it. Used by every report type. */
function DetailsPanel({ brand, setBrand, titleHint }) {
  const [imageError, setImageError] = useState("");
  const set = (key) => (e) => setBrand((b) => ({ ...b, [key]: e.target.value }));

  const setLogo = (file) => {
    setImageError("");
    if (!file) return;
    if (!file.type.startsWith("image/")) return setImageError("Choose an image file.");
    if (file.size > MAX_IMAGE_BYTES) return setImageError("Images must be 1.5 MB or smaller.");
    const reader = new FileReader();
    reader.onload = () => setBrand((b) => ({ ...b, logo: String(reader.result) }));
    reader.readAsDataURL(file);
  };

  return (
    <section className={`${CARD} p-4`} aria-label="Report details">
      <PanelTitle>Report details</PanelTitle>
      <div className="space-y-3">
        <label className="block text-xs font-medium text-[#475467]">
          Title
          <input className={`${FIELD} mt-1 w-full`} value={brand.title} placeholder={titleHint} onChange={set("title")} />
        </label>
        <label className="block text-xs font-medium text-[#475467]">
          Subtitle
          <input className={`${FIELD} mt-1 w-full`} value={brand.subtitle} placeholder="For example, Quarterly results report" onChange={set("subtitle")} />
        </label>
        <label className="block text-xs font-medium text-[#475467]">
          Prepared by
          <input className={`${FIELD} mt-1 w-full`} value={brand.preparedBy} onChange={set("preparedBy")} />
        </label>
        <label className="block text-xs font-medium text-[#475467]">
          Organisation name
          <input className={`${FIELD} mt-1 w-full`} value={brand.org} onChange={set("org")} />
        </label>

        <fieldset>
          <legend className="text-xs font-medium text-[#475467]">Colour</legend>
          <div className="mt-1.5 flex gap-2">
            {ACCENTS.map(([color, name]) => (
              <button
                key={color}
                type="button"
                aria-label={name}
                aria-pressed={brand.accent === color}
                title={name}
                onClick={() => setBrand((b) => ({ ...b, accent: color }))}
                className={`h-7 w-7 rounded-full border-2 border-white transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00664E] ${
                  brand.accent === color ? "ring-2 ring-[#101828]" : "ring-1 ring-[#D0D5DD]"
                }`}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        </fieldset>

        <div>
          <p className="text-xs font-medium text-[#475467]">Logo</p>
          {brand.logo ? (
            <div className="mt-1.5 flex items-center gap-3">
              <img src={brand.logo} alt="Logo preview" className="h-10 max-w-[120px] rounded border border-[#EAECF0] bg-white object-contain p-1" />
              <button type="button" className="text-xs font-medium text-[#B42318] hover:underline" onClick={() => setBrand((b) => ({ ...b, logo: "" }))}>
                Remove
              </button>
            </div>
          ) : (
            <label className="mt-1.5 inline-block cursor-pointer text-xs font-medium text-[#00664E] hover:underline">
              Add a logo
              <input type="file" accept="image/*" className="sr-only" onChange={(e) => { setLogo(e.target.files?.[0]); e.target.value = ""; }} />
            </label>
          )}
          {imageError && <p role="alert" className="mt-1 text-xs text-red-700">{imageError}</p>}
        </div>
      </div>
      <p className="mt-3 text-[11px] leading-snug text-[#98A2B3]">Comments, images and details are kept on this page only. Print or save as PDF before leaving it.</p>
    </section>
  );
}

function Workspace({ side, children }) {
  return (
    <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)] print:block">
      <aside className="space-y-4 print:hidden lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto">{side}</aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/* The sheet of paper. Print removes the frame so it fills the page. */
function Paper({ children, label }) {
  return (
    <article
      aria-label={label}
      className="mx-auto w-full max-w-[900px] space-y-8 overflow-hidden rounded-xl border border-[#E5E7EB] bg-white p-8 shadow-[0_2px_8px_rgba(16,24,40,0.06)] print:max-w-none print:space-y-6 print:rounded-none print:border-0 print:p-0 print:shadow-none"
    >
      {children}
    </article>
  );
}

function Letterhead({ brand, meta }) {
  const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  return (
    <div className="-mx-8 -mt-8 px-8 py-5 text-white print:mx-0 print:mt-0 print:px-6" style={{ backgroundColor: brand.accent }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {brand.logo && <img src={brand.logo} alt="Organisation logo" className="h-10 max-w-[120px] rounded bg-white/95 object-contain p-1" />}
          <span className="text-sm font-semibold tracking-wide">{brand.org || "Organisation"}</span>
        </div>
        <div className="text-right text-xs leading-5 opacity-90">
          {meta && <p>{meta}</p>}
          <p>Generated {today}{brand.preparedBy ? ` · Prepared by ${brand.preparedBy}` : ""}</p>
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ title, subtitle, accent }) {
  return (
    <div className="mb-4 flex items-start gap-3">
      <span aria-hidden="true" className="mt-1 h-5 w-1 shrink-0 rounded-full" style={{ backgroundColor: accent }} />
      <div>
        <h3 className="text-base font-semibold leading-6 text-[#101828]">{title}</h3>
        {subtitle && <p className="text-[13px] leading-5 text-[#667085]">{subtitle}</p>}
      </div>
    </div>
  );
}

function Figure({ label, value, note, color }) {
  return (
    <div className="break-inside-avoid rounded-lg border border-[#EAECF0] p-4">
      <p className="text-xs font-medium text-[#667085]">{label}</p>
      <p className="mt-1 flex items-center gap-2 text-2xl font-semibold tabular-nums tracking-tight text-[#101828]">
        {color && <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />}
        {value}
      </p>
      {note && <p className="mt-0.5 text-xs text-[#98A2B3]">{note}</p>}
    </div>
  );
}

/* A text box that is editable on screen and plain paragraphs in print */
function WriteBox({ id, value, onChange, rows = 4, placeholder }) {
  return (
    <>
      <textarea
        id={id}
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`${FIELD} w-full print:hidden`}
      />
      {value && (
        <div className="hidden space-y-2 text-sm leading-6 text-[#344054] print:block">
          {value.split(/\n{2,}/).map((para, i) => (
            <p key={i} className="whitespace-pre-line">{para}</p>
          ))}
        </div>
      )}
    </>
  );
}

/* ---------- Visual report ---------- */

function VisualReport({ fw, frameworkId, data, ordered, rows, period, brand, setBrand, types }) {
  const [sections, setSections] = useState(DEFAULT_SECTIONS);
  const [charts, setCharts] = useState({ progress: true, trend: true, levels: true });
  const [included, setIncluded] = useState(null); // null means every result
  const [analysis, setAnalysis] = useState({}); // { [resultId]: { text, image } }
  const [summary, setSummary] = useState("");
  const [recs, setRecs] = useState("");
  const [ai, setAi] = useState({ busy: "", error: "" });
  const [imageError, setImageError] = useState("");

  const setSection = (key, on) => setSections((s) => ({ ...s, [key]: on }));
  const chosen = (id) => included === null || included.has(id);
  const toggleResult = (id) =>
    setIncluded((cur) => {
      const next = new Set(cur ?? ordered.map((r) => r.id));
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const expected = rows.filter((r) => r.target !== undefined && chosen(r.result.id));
  const withPct = expected.filter((r) => r.pct !== null);
  const counts = Object.fromEntries(Object.keys(PROGRESS).map((k) => [k, expected.filter((r) => r.progress === k).length]));
  const avgPct = average(withPct.map((r) => r.pct));
  const chosenRows = rows.filter((r) => chosen(r.result.id));
  const awaiting = chosenRows.filter((r) => r.saved?.status === "submitted");
  const corrections = awaiting.filter((r) => r.saved?.correction);
  const rejected = chosenRows.filter((r) => r.saved?.status === "rejected");
  const missing = expected.filter((r) => !r.saved);

  const approvedMap = useMemo(
    () => new Map(data.values.filter((v) => v.status === "approved").map((v) => [`${v.indicatorId}#${v.period}`, v])),
    [data]
  );

  /* Outlook: each indicator's projected % of target, averaged (each counts up to 100%) */
  const outlook = useMemo(() => {
    const list = data.indicators
      .filter((i) => chosen(i.resultId))
      .map((i) => projectIndicator(i, approvedMap, fw.periods))
      .filter(Boolean);
    const rated = list.filter((o) => o.ratio !== null);
    return {
      total: list.length,
      rated: rated.length,
      pct: rated.length ? Math.round(rated.reduce((s, o) => s + Math.min(o.ratio, 100), 0) / rated.length) : null,
      behind: rated.filter((o) => o.ratio < 90).sort((a, b) => a.ratio - b.ratio),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, approvedMap, fw.periods, included]);

  const trend = fw.periods.map((p) => {
    const pcts = [];
    for (const ind of data.indicators) {
      if (!chosen(ind.resultId)) continue;
      const target = ind.targets?.[p];
      const v = data.values.find((x) => x.indicatorId === ind.id && x.period === p && x.status === "approved");
      if (target && v) pcts.push(Math.round((v.actual / target) * 100));
    }
    return { period: p, pct: average(pcts) };
  });

  const levelGroups = ordered
    .filter((r) => chosen(r.id))
    .map((r) => {
      const rs = expected.filter((x) => x.result.id === r.id);
      const approved = rs.filter((x) => x.saved?.status === "approved").length;
      const waiting = rs.filter((x) => x.saved?.status === "submitted").length;
      return { id: r.id, title: r.title, total: rs.length, approved, awaiting: waiting, missing: rs.length - approved - waiting };
    })
    .filter((g) => g.total > 0);

  /* Evidence behind the values for the selected period */
  const evidenceRows = data.values
    .filter((v) => v.period === period && (v.evidence || []).length > 0)
    .map((v) => ({ v, ind: data.indicators.find((i) => i.id === v.indicatorId) }))
    .filter((x) => x.ind && chosen(x.ind.resultId))
    .sort((a, b) => a.ind.name.localeCompare(b.ind.name));

  /* A value's breakdowns as readable lines, gender first */
  const sortedTypes = useMemo(() => [...types.filter(isGenderType), ...types.filter((t) => !isGenderType(t))], [types]);
  const breakdownLines = (v) =>
    sortedTypes
      .filter((t) => v?.breakdown?.[t.id])
      .map((t) => ({
        id: t.id,
        name: t.name,
        parts: t.categories.filter((c) => v.breakdown[t.id][c] !== undefined).map((c) => `${c} ${fmt(v.breakdown[t.id][c])}`),
      }));

  /* A summary written from the figures alone, with no AI */
  const calculatedSummary = () => {
    const parts = [];
    parts.push(
      avgPct === null
        ? `No values have been approved for ${period} yet, so there is no progress to report.`
        : `${fw.name} reached an average of ${avgPct}% of its ${period} targets, across ${plural(withPct.length, "indicator", "indicators")} with approved values out of ${expected.length} with a target.`
    );
    if (withPct.length) parts.push(`${counts.on} on track, ${counts.risk} at risk and ${counts.off} off track.`);
    const notes = [];
    if (awaiting.length) notes.push(`${plural(awaiting.length, "value is", "values are")} awaiting approval`);
    if (missing.length) notes.push(`${plural(missing.length, "indicator has", "indicators have")} not been reported`);
    if (rejected.length) notes.push(`${plural(rejected.length, "value was", "values were")} rejected`);
    if (notes.length) parts.push(`${notes.join(", ")}.`);
    if (outlook.pct !== null) parts.push(`If the current pace continues, the project is on course to reach about ${outlook.pct}% of its targets.`);
    return parts.join(" ");
  };

  /* The figures the AI assistant is allowed to use. It never produces numbers of its own. */
  const buildFacts = () => ({
    framework: { name: fw.name, donor: fw.donor || "", reportingPeriods: fw.periods, levels: fw.levels || [], startDate: fw.startDate || "", endDate: fw.endDate || "" },
    selectedPeriod: period,
    progressBands: { onTrack: "90% of target or more", atRisk: "50% to 89%", offTrack: "below 50%" },
    summaryForSelectedPeriod: {
      indicatorsWithTarget: expected.length,
      indicatorsApproved: withPct.length,
      averagePercentOfTarget: avgPct,
      onTrack: counts.on,
      atRisk: counts.risk,
      offTrack: counts.off,
      awaitingApproval: awaiting.length,
      rejected: rejected.length,
      notReported: missing.length,
    },
    indicatorsByPeriod: {
      [period]: expected.map((r) => ({
        indicator: r.ind.name,
        unit: r.ind.unit || "",
        result: r.result.title,
        target: r.target,
        actual: r.saved?.status === "approved" ? r.saved.actual : null,
        status: r.saved?.status || "not reported",
        percentOfTarget: r.pct ?? null,
        band: r.progress ?? null,
      })),
    },
    projectOutlook: {
      projectedPercentOfTargets: outlook.pct,
      indicatorsProjectedBelow90Percent: outlook.behind.slice(0, 20).map((o) => ({ indicator: o.ind.name, projectedPercentOfTarget: o.ratio })),
    },
  });

  const draftWithAI = async (field, mode, question, current, apply) => {
    if (current.trim() && !window.confirm("Replace what you have written with a new draft?")) return;
    setAi({ busy: field, error: "" });
    try {
      const reply = await api(`/me/frameworks/${frameworkId}/assistant`, {
        method: "POST",
        body: { question, mode, history: [], facts: buildFacts() },
      });
      const answer = String(reply?.answer || "").trim();
      if (!answer) throw new Error("The assistant returned no answer.");
      apply(answer);
      setAi({ busy: "", error: "" });
    } catch (err) {
      setAi({ busy: "", error: err?.message || "The assistant could not be reached." });
    }
  };

  const setText = (id, value) => setAnalysis((a) => ({ ...a, [id]: { ...a[id], text: value } }));
  const setImage = (id, file) => {
    setImageError("");
    if (!file) return;
    if (!file.type.startsWith("image/")) return setImageError("Choose an image file.");
    if (file.size > MAX_IMAGE_BYTES) return setImageError("Images must be 1.5 MB or smaller.");
    const reader = new FileReader();
    reader.onload = () => setAnalysis((a) => ({ ...a, [id]: { ...a[id], image: String(reader.result) } }));
    reader.readAsDataURL(file);
  };
  const removeImage = (id) => setAnalysis((a) => ({ ...a, [id]: { ...a[id], image: "" } }));

  const accent = brand.accent;
  const anyChart = charts.progress || charts.trend || charts.levels;

  const side = (
    <>
      <section className={`${CARD} p-4`} aria-label="Sections">
        <PanelTitle>Sections</PanelTitle>
        <div className="-mx-2">
          {SECTION_LABELS.map(([key, label, hint]) => (
            <Toggle key={key} label={label} hint={hint} checked={sections[key]} onChange={(on) => setSection(key, on)} />
          ))}
        </div>
        {sections.charts && (
          <div className="mt-2 border-t border-[#F2F4F7] pt-2">
            <PanelTitle>Charts</PanelTitle>
            <div className="-mx-2">
              {CHARTS.map(([key, label]) => (
                <Toggle key={key} label={label} checked={charts[key]} onChange={(on) => setCharts((c) => ({ ...c, [key]: on }))} />
              ))}
            </div>
          </div>
        )}
      </section>

      <section className={`${CARD} p-4`} aria-label="Results to include">
        <PanelTitle>Results to include</PanelTitle>
        <div className="-mx-2 max-h-48 overflow-y-auto">
          {ordered.map((r) => (
            <div key={r.id} style={{ paddingLeft: `${r.depth * 12}px` }}>
              <Toggle label={r.title} checked={chosen(r.id)} onChange={() => toggleResult(r.id)} />
            </div>
          ))}
        </div>
      </section>

      <DetailsPanel brand={brand} setBrand={setBrand} titleHint={fw.name} />
    </>
  );

  return (
    <Workspace side={side}>
      {(ai.error || imageError) && (
        <p role="alert" className="mb-3 rounded-lg border border-[#FDA29B] bg-[#FEF3F2] px-4 py-2.5 text-sm text-[#B42318] print:hidden">
          {ai.error || imageError}
        </p>
      )}

      <Paper label="Visual report preview">
        <Letterhead brand={brand} meta={`Reporting period ${period}`} />

        <header>
          <h2 className="text-2xl font-semibold tracking-tight text-[#101828]">{brand.title || fw.name}</h2>
          <p className="mt-1 text-sm text-[#667085]">
            {[brand.subtitle, fw.donor || null, `Reporting period ${period}`, "Approved values only"].filter(Boolean).join(" · ")}
          </p>
        </header>

        {sections.summary && (
          <section className={summary ? "" : "print:hidden"}>
            <SectionTitle title="Executive summary" subtitle="A short overview for the reader." accent={accent} />
            <WriteBox id="summary" value={summary} onChange={setSummary} rows={5} placeholder="Write the summary, or draft it from the figures." />
            <div className="mt-2 flex flex-wrap gap-2 print:hidden">
              <button type="button" className={BTN_LIGHT} onClick={() => setSummary(calculatedSummary())}>
                Draft from the figures
              </button>
              <button
                type="button"
                className={BTN_LIGHT}
                disabled={Boolean(ai.busy)}
                onClick={() =>
                  draftWithAI(
                    "summary",
                    "report",
                    "Write a short executive summary of this project's progress in the selected period, suitable for a donor report. Use two or three plain paragraphs.",
                    summary,
                    setSummary
                  )
                }
              >
                {ai.busy === "summary" ? "Writing" : "Write with AI"}
              </button>
            </div>
          </section>
        )}

        {sections.figures && (
          <section>
            <SectionTitle title="Key figures" subtitle={`${period}, ${expected.length} indicators with a target`} accent={accent} />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Figure label="Average achievement" value={avgPct === null ? "-" : `${avgPct}%`} note="of target, approved values" />
              <Figure label="Approved" value={`${withPct.length} of ${expected.length}`} note="indicators with an approved value" color="#1F7A5C" />
              <Figure label="Awaiting approval" value={awaiting.length} note={corrections.length ? `${corrections.length} are corrections` : "values"} color={awaiting.length ? "#D4A600" : undefined} />
              <Figure label="Project outlook" value={outlook.pct === null ? "-" : `${outlook.pct}%`} note="projected share of targets" color={outlook.pct === null ? undefined : PROGRESS[progressOf(outlook.pct)].color} />
            </div>
          </section>
        )}

        {sections.charts && anyChart && (
          <section className="grid gap-8 sm:grid-cols-2">
            {charts.progress && (
              <div className="break-inside-avoid">
                <SectionTitle title="Progress against target" subtitle={`${expected.length} indicators`} accent={accent} />
                <ProgressBar counts={counts} total={expected.length} />
              </div>
            )}
            {charts.trend && (
              <div className="break-inside-avoid">
                <SectionTitle title="Achievement by period" subtitle="Average percentage of target" accent={accent} />
                <TrendLine points={trend} accent={accent} />
              </div>
            )}
            {charts.levels && (
              <div className="break-inside-avoid sm:col-span-2">
                <SectionTitle title="Reporting status by result" subtitle={`Indicators with a target, ${period}`} accent={accent} />
                <ResultBars groups={levelGroups} />
              </div>
            )}
          </section>
        )}

        {sections.outlook && (
          <section className="break-inside-avoid">
            <SectionTitle title="Outlook" subtitle="Where the project is heading by its last period, at the pace reached so far." accent={accent} />
            {outlook.pct === null ? (
              <p className="text-sm text-[#98A2B3]">No indicator has approved data yet, so the project cannot be projected.</p>
            ) : (
              <>
                <p className="text-sm leading-6 text-[#344054]">
                  Averaging the projected result of {outlook.rated} of {outlook.total} {outlook.total === 1 ? "indicator" : "indicators"}, the project is on course to reach about{" "}
                  <strong className="text-[#101828]">{outlook.pct}%</strong> of its targets
                  {fw.endDate ? ` by its end date` : ""}.{" "}
                  {outlook.behind.length
                    ? `${plural(outlook.behind.length, "indicator is", "indicators are")} projected to finish below 90% of target.`
                    : "No indicator is projected to fall short."}
                </p>
                {outlook.behind.length > 0 && (
                  <ul className="mt-3 divide-y divide-[#F2F4F7] rounded-lg border border-[#EAECF0] text-sm">
                    {outlook.behind.slice(0, 8).map((o) => (
                      <li key={o.ind.id} className="flex items-center gap-3 px-4 py-2">
                        <span className="min-w-0 flex-1 text-[#344054]">{o.ind.name}</span>
                        <ProgressDot progress={progressOf(o.ratio)} pct={o.ratio} />
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </section>
        )}

        {sections.results && (
          <section>
            <SectionTitle title="Results and analysis" subtitle="Add comments and an image for each result to explain the numbers." accent={accent} />
            <div className="space-y-5">
              {ordered.filter((r) => chosen(r.id)).map((r) => {
                const inds = rows.filter((x) => x.result.id === r.id);
                const a = analysis[r.id] || {};
                return (
                  <div key={r.id} className="break-inside-avoid rounded-lg border border-[#EAECF0] p-4">
                    <h4 className="text-sm font-semibold text-[#101828]">{r.title}</h4>
                    <p className="text-xs text-[#98A2B3]">{fw.levels?.[r.level] ?? `Level ${r.level + 1}`}</p>

                    {inds.length > 0 && (
                      <ul className="mt-3 divide-y divide-[#F2F4F7] text-sm">
                        {inds.map(({ ind, saved, target, pct, progress }) => {
                          const lines = saved?.status === "approved" ? breakdownLines(saved) : [];
                          const evidenceCount = (saved?.evidence || []).length;
                          return (
                            <li key={ind.id} className="py-2">
                              <div className="flex flex-wrap items-center gap-x-3 text-[#344054]">
                                <span className="min-w-0 flex-1">{ind.name}</span>
                                <span className="tabular-nums text-[#667085]">
                                  {saved?.status === "approved" ? fmt(saved.actual) : "-"} / {fmt(target)}
                                </span>
                                <ProgressDot progress={progress} pct={pct} />
                              </div>
                              {(lines.length > 0 || evidenceCount > 0) && (
                                <p className="mt-1 text-xs leading-5 text-[#667085]">
                                  {lines.map((l) => `${l.name}: ${l.parts.join(", ")}`).join(" · ")}
                                  {lines.length > 0 && evidenceCount > 0 ? " · " : ""}
                                  {evidenceCount > 0 ? plural(evidenceCount, "piece of evidence", "pieces of evidence") : ""}
                                </p>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}

                    <label className="mt-3 block text-xs font-medium text-[#667085] print:hidden" htmlFor={`an-${r.id}`}>Analysis</label>
                    <textarea
                      id={`an-${r.id}`}
                      rows={3}
                      value={a.text || ""}
                      onChange={(e) => setText(r.id, e.target.value)}
                      placeholder="What explains these results? What should the reader know?"
                      className={`${FIELD} mt-1 w-full print:hidden`}
                    />
                    {a.text && <p className="mt-3 hidden whitespace-pre-wrap text-sm text-[#344054] print:block">{a.text}</p>}

                    {a.image ? (
                      <div className="mt-3">
                        <img src={a.image} alt={`Illustration for ${r.title}`} className="max-h-64 rounded-md border border-[#EAECF0]" />
                        <button type="button" onClick={() => removeImage(r.id)} className="mt-1 text-xs font-medium text-[#B42318] hover:underline print:hidden">Remove image</button>
                      </div>
                    ) : (
                      <label className="mt-3 inline-block cursor-pointer text-xs font-medium text-[#00664E] hover:underline print:hidden">
                        Add an image
                        <input type="file" accept="image/*" className="sr-only" onChange={(e) => { setImage(r.id, e.target.files?.[0]); e.target.value = ""; }} />
                      </label>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {sections.quality && (
          <section className="break-inside-avoid">
            <SectionTitle title="Data notes" subtitle="What the reader should know about the completeness of the data." accent={accent} />
            {awaiting.length + rejected.length + missing.length === 0 ? (
              <p className="text-sm text-[#344054]">Every indicator with a target has an approved value for {period}.</p>
            ) : (
              <ul className="space-y-2 text-sm text-[#344054]">
                {awaiting.length > 0 && (
                  <li>
                    <strong>{plural(awaiting.length, "value is", "values are")} awaiting approval</strong> and not counted
                    {corrections.length ? `, including ${plural(corrections.length, "correction", "corrections")} to earlier approved values` : ""}:{" "}
                    <span className="text-[#667085]">{awaiting.slice(0, 6).map((r) => r.ind.name).join("; ")}{awaiting.length > 6 ? `; and ${awaiting.length - 6} more` : ""}.</span>
                  </li>
                )}
                {rejected.length > 0 && (
                  <li>
                    <strong>{plural(rejected.length, "value was", "values were")} rejected</strong> and needs correcting:{" "}
                    <span className="text-[#667085]">{rejected.slice(0, 6).map((r) => r.ind.name).join("; ")}.</span>
                  </li>
                )}
                {missing.length > 0 && (
                  <li>
                    <strong>{plural(missing.length, "indicator has", "indicators have")} not been reported:</strong>{" "}
                    <span className="text-[#667085]">{missing.slice(0, 6).map((r) => r.ind.name).join("; ")}{missing.length > 6 ? `; and ${missing.length - 6} more` : ""}.</span>
                  </li>
                )}
              </ul>
            )}
          </section>
        )}

        {sections.recs && (
          <section className={recs ? "" : "print:hidden"}>
            <SectionTitle title="Next steps" subtitle="Recommended follow-up for the next period." accent={accent} />
            <WriteBox id="recs" value={recs} onChange={setRecs} rows={5} placeholder="Write the recommended next steps." />
            <div className="mt-2 flex flex-wrap gap-2 print:hidden">
              <button
                type="button"
                className={BTN_LIGHT}
                disabled={Boolean(ai.busy)}
                onClick={() =>
                  draftWithAI(
                    "recs",
                    "recommendations",
                    "Suggest three to five practical next steps for the next reporting period, based only on these figures. Write them as short plain paragraphs.",
                    recs,
                    setRecs
                  )
                }
              >
                {ai.busy === "recs" ? "Writing" : "Suggest with AI"}
              </button>
            </div>
          </section>
        )}

        {sections.evidence && (
          <section className="print:break-before-page">
            <SectionTitle title="Evidence index" subtitle={`Files and links attached to the values for ${period}. Files are kept in the portal.`} accent={accent} />
            {evidenceRows.length === 0 ? (
              <p className="text-sm text-[#98A2B3]">No evidence is attached to values for this period.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-y border-[#E5E7EB] bg-[#F9FAFB] text-xs font-medium text-[#667085]">
                      <th className="px-3 py-2">Indicator</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Evidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {evidenceRows.map(({ v, ind }) => (
                      <tr key={`${ind.id}-${v.period}`} className="break-inside-avoid border-t border-[#F2F4F7] align-top">
                        <td className="px-3 py-2 font-medium text-[#101828]">{ind.name}</td>
                        <td className="px-3 py-2 text-[#475467]">{v.status === "approved" ? "Approved" : v.status === "submitted" ? "Awaiting approval" : "Rejected"}</td>
                        <td className="px-3 py-2 text-[#475467]">
                          <ul className="space-y-0.5">
                            {v.evidence.map((e, i) => (
                              <li key={i}>
                                {e.type === "file" ? "File" : "Link"}: {e.name}
                                {e.type === "link" && <span className="block break-all text-xs text-[#98A2B3]">{e.url}</span>}
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </Paper>
    </Workspace>
  );
}

/* ---------- Table-based project report (logframe style) ---------- */

function FragmentHeads() {
  return (
    <>
      <th className="border-l border-[#E5E7EB] px-3 py-1.5 text-center">Target</th>
      <th className="px-3 py-1.5 text-center">Actual</th>
    </>
  );
}

function FragmentCells({ target, actual, color }) {
  return (
    <>
      <td className="border-l border-[#F2F4F7] px-3 py-2.5 text-center tabular-nums text-[#475467]">{fmt(target)}</td>
      <td className="px-3 py-2.5 text-center font-medium tabular-nums" style={{ color: color || "#475467" }}>{fmt(actual)}</td>
    </>
  );
}

function TableGroup({ result, levelName, indicators, periods, approved, accent }) {
  return (
    <>
      <tr className="break-inside-avoid bg-[#F9FAFB]">
        <td colSpan={5 + periods.length * 2} className="border-l-4 px-3 py-2 text-xs font-semibold text-[#101828]" style={{ borderLeftColor: accent }}>
          <span className="text-[#667085]">{levelName}:</span> {result.title}
        </td>
      </tr>
      {indicators.map((ind) => (
        <tr key={ind.id} className="break-inside-avoid border-t border-[#F2F4F7] align-top">
          <td className="px-3 py-2.5 font-medium text-[#101828]">{ind.name}</td>
          <td className="px-3 py-2.5 text-[#475467]">{ind.unit || "-"}</td>
          <td className="px-3 py-2.5 tabular-nums text-[#475467]">{fmt(ind.baseline)}</td>
          {periods.map((p) => {
            const target = ind.targets?.[p];
            const v = approved.get(`${ind.id}#${p}`);
            const color = v && target ? PROGRESS[progressOf(pctOf(v.actual, target))].color : undefined;
            return <FragmentCells key={p} target={target} actual={v?.actual} color={color} />;
          })}
          <td className="border-l border-[#F2F4F7] px-3 py-2.5 text-[#475467]">{ind.mov || "-"}</td>
          <td className="px-3 py-2.5 text-[#475467]">{ind.assumptions || "-"}</td>
        </tr>
      ))}
    </>
  );
}

function TableReport({ fw, data, ordered, brand, setBrand }) {
  const approved = useMemo(
    () => new Map(data.values.filter((v) => v.status === "approved").map((v) => [`${v.indicatorId}#${v.period}`, v])),
    [data]
  );
  const levelName = (i) => fw.levels?.[i] ?? `Level ${i + 1}`;
  const withIndicators = ordered.filter((r) => data.indicators.some((i) => i.resultId === r.id));

  return (
    <Workspace side={<DetailsPanel brand={brand} setBrand={setBrand} titleHint={fw.name} />}>
      <Paper label="Table-based report">
        <Letterhead brand={brand} meta="Results framework" />
        <header>
          <h2 className="text-2xl font-semibold tracking-tight text-[#101828]">{brand.title || fw.name}</h2>
          <p className="mt-1 text-sm text-[#667085]">
            {[brand.subtitle, fw.donor || null, "Targets and approved actuals for every period"].filter(Boolean).join(" · ")}
          </p>
        </header>

        <div className="-mx-2 overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead>
              <tr className="border-b border-[#E5E7EB] bg-[#F9FAFB] text-xs font-medium text-[#667085]">
                <th className="px-3 py-2.5" rowSpan={2}>Indicator</th>
                <th className="px-3 py-2.5" rowSpan={2}>Unit</th>
                <th className="px-3 py-2.5" rowSpan={2}>Baseline</th>
                {fw.periods.map((p) => (
                  <th key={p} colSpan={2} className="border-l border-[#E5E7EB] px-3 py-2 text-center">{p}</th>
                ))}
                <th className="border-l border-[#E5E7EB] px-3 py-2.5" rowSpan={2}>Means of verification</th>
                <th className="px-3 py-2.5" rowSpan={2}>Assumptions</th>
              </tr>
              <tr className="border-b border-[#E5E7EB] bg-[#F9FAFB] text-[11px] font-medium text-[#98A2B3]">
                {fw.periods.map((p) => (
                  <FragmentHeads key={p} />
                ))}
              </tr>
            </thead>
            <tbody>
              {withIndicators.length === 0 && (
                <tr><td colSpan={5 + fw.periods.length * 2} className="px-5 py-10 text-center text-[#98A2B3]">No indicators yet.</td></tr>
              )}
              {withIndicators.map((r) => (
                <TableGroup
                  key={r.id}
                  result={r}
                  levelName={levelName(r.level)}
                  indicators={data.indicators.filter((i) => i.resultId === r.id)}
                  periods={fw.periods}
                  approved={approved}
                  accent={brand.accent}
                />
              ))}
            </tbody>
          </table>
        </div>
      </Paper>
    </Workspace>
  );
}

/* ---------- Program report (projects of one programme together) ---------- */

/* Summary of one framework, from approved values only */
function summarise(d) {
  const approved = new Map(d.values.filter((v) => v.status === "approved").map((v) => [`${v.indicatorId}#${v.period}`, v]));
  let expected = 0;
  let reported = 0;
  const pcts = [];
  const combined = [];
  for (const ind of d.indicators) {
    let target = 0, reportedTarget = 0, actual = 0;
    for (const [p, t] of Object.entries(ind.targets || {})) {
      expected += 1;
      target += t;
      const v = approved.get(`${ind.id}#${p}`);
      if (v) {
        reported += 1;
        reportedTarget += t;
        actual += v.actual;
        if (t > 0) pcts.push(Math.round((v.actual / t) * 100));
      }
    }
    combined.push({ name: ind.name, unit: ind.unit || "", target, reportedTarget, actual, hasData: reportedTarget > 0 || actual > 0 });
  }
  return {
    indicators: d.indicators.length,
    expected,
    reported,
    avgPct: average(pcts),
    combined,
  };
}

function ProgramReport({ frameworks, brand, setBrand }) {
  const programmes = useMemo(() => {
    const slugs = [...new Set(frameworks.map((f) => f.area))];
    return slugs.map((slug) => ({ slug, name: areaName(slug) })).sort((a, b) => a.name.localeCompare(b.name));
  }, [frameworks]);

  const [slug, setSlug] = useState("");
  const [loaded, setLoaded] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!slug && programmes.length) setSlug(programmes[0].slug);
  }, [programmes, slug]);

  useEffect(() => {
    if (!slug) return undefined;
    let mounted = true;
    setLoading(true);
    setError("");
    setLoaded(null);
    Promise.all(frameworks.filter((f) => f.area === slug).map((f) => api(`/me/frameworks/${f.id}`)))
      .then((all) => mounted && setLoaded(all))
      .catch((e) => mounted && setError(e.message))
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, [slug, frameworks]);

  const projects = useMemo(
    () => (loaded || []).map((d) => ({ fw: d.framework, ...summarise(d) })).sort((a, b) => a.fw.name.localeCompare(b.fw.name)),
    [loaded]
  );

  /* Same name and unit across projects are added together. Percentages are averaged instead. */
  const combined = useMemo(() => {
    const map = new Map();
    for (const p of projects) {
      for (const c of p.combined) {
        const key = `${c.name.toLowerCase()}|${c.unit.toLowerCase()}`;
        const cur = map.get(key) || { name: c.name, unit: c.unit, target: 0, reportedTarget: 0, actual: 0, projects: new Set(), n: 0 };
        cur.target += c.target;
        cur.reportedTarget += c.reportedTarget;
        cur.actual += c.actual;
        if (c.hasData) cur.n += 1;
        cur.projects.add(p.fw.id);
        map.set(key, cur);
      }
    }
    return [...map.values()]
      .filter((c) => c.projects.size > 1 || projects.length === 1)
      .map((c) => {
        const isPct = /%|percent/i.test(c.unit);
        const div = isPct && c.n > 0 ? c.n : 1;
        const actual = c.actual / div;
        const reportedTarget = c.reportedTarget / div;
        return { ...c, isPct, actual, reportedTarget, pct: reportedTarget > 0 ? pctOf(actual, reportedTarget) : null };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [projects]);

  const totals = projects.reduce(
    (t, p) => ({ indicators: t.indicators + p.indicators, expected: t.expected + p.expected, reported: t.reported + p.reported }),
    { indicators: 0, expected: 0, reported: 0 }
  );

  const side = (
    <>
      <section className={`${CARD} p-4`} aria-label={LABELS.programme}>
        <PanelTitle>{LABELS.programme}</PanelTitle>
        <select id="programme" aria-label={LABELS.programme} className={`${FIELD} w-full`} value={slug} onChange={(e) => setSlug(e.target.value)}>
          {programmes.map((p) => (
            <option key={p.slug} value={p.slug}>{p.name}</option>
          ))}
        </select>
      </section>
      <DetailsPanel brand={brand} setBrand={setBrand} titleHint={`${areaName(slug)}: ${LABELS.programmeReport.toLowerCase()}`} />
    </>
  );

  return (
    <Workspace side={side}>
      <ErrorBar error={error} />
      {loading && <p className="py-8 text-center text-sm text-[#98A2B3]">Loading projects...</p>}

      {loaded && (
        <Paper label="Program report">
          <Letterhead brand={brand} meta={areaName(slug)} />

          <header>
            <h2 className="text-2xl font-semibold tracking-tight text-[#101828]">
              {brand.title || `${areaName(slug)}: ${LABELS.programmeReport.toLowerCase()}`}
            </h2>
            <p className="mt-1 text-sm text-[#667085]">
              {[
                brand.subtitle,
                `${projects.length} ${projects.length === 1 ? "project" : "projects"}`,
                `${totals.indicators} indicators`,
                `${totals.reported} of ${totals.expected} targets reported and approved`,
              ].filter(Boolean).join(" · ")}
            </p>
          </header>

          <section>
            <SectionTitle title={`${LABELS.projects} in this ${LABELS.programme.toLowerCase()}`} accent={brand.accent} />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-y border-[#E5E7EB] bg-[#F9FAFB] text-xs font-medium text-[#667085]">
                    <th className="px-3 py-2.5">Project</th>
                    <th className="px-3 py-2.5">Donor</th>
                    <th className="px-3 py-2.5 text-right">Indicators</th>
                    <th className="px-3 py-2.5 text-right">Reported</th>
                    <th className="px-3 py-2.5">Average progress</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((p) => (
                    <tr key={p.fw.id} className="break-inside-avoid border-t border-[#F2F4F7]">
                      <td className="px-3 py-2.5 font-medium text-[#101828]">{p.fw.name}</td>
                      <td className="px-3 py-2.5 text-[#475467]">{p.fw.donor || "-"}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-[#475467]">{p.indicators}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-[#475467]">{p.reported} of {p.expected}</td>
                      <td className="px-3 py-2.5"><ProgressDot progress={progressOf(p.avgPct)} pct={p.avgPct} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <SectionTitle title="Results across projects" subtitle="Indicators with the same name and unit are added together. Percentages are averaged. Approved values only." accent={brand.accent} />
            {combined.length === 0 ? (
              <p className="text-sm text-[#98A2B3]">No indicators are shared between these projects yet. Use the same name and unit for the same indicator in each project to combine them.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead>
                    <tr className="border-y border-[#E5E7EB] bg-[#F9FAFB] text-xs font-medium text-[#667085]">
                      <th className="px-3 py-2.5">Indicator</th>
                      <th className="px-3 py-2.5">Unit</th>
                      <th className="px-3 py-2.5 text-right">Projects</th>
                      <th className="px-3 py-2.5 text-right">Target (reported periods)</th>
                      <th className="px-3 py-2.5 text-right">Actual</th>
                      <th className="px-3 py-2.5">Progress</th>
                    </tr>
                  </thead>
                  <tbody>
                    {combined.map((c) => (
                      <tr key={`${c.name}|${c.unit}`} className="break-inside-avoid border-t border-[#F2F4F7]">
                        <td className="px-3 py-2.5 font-medium text-[#101828]">{c.name}</td>
                        <td className="px-3 py-2.5 text-[#475467]">{c.unit || "-"}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-[#475467]">{c.projects.size}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-[#475467]">{fmt(Math.round(c.reportedTarget * 100) / 100)}</td>
                        <td className="px-3 py-2.5 text-right font-medium tabular-nums text-[#101828]">{fmt(Math.round(c.actual * 100) / 100)}</td>
                        <td className="px-3 py-2.5"><ProgressDot progress={progressOf(c.pct)} pct={c.pct} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </Paper>
      )}
    </Workspace>
  );
}

/* ---------- Page ---------- */

function MEReports() {
  const { isAdmin, frameworks, selectedId, setSelectedId, data, fw, ordered, rows, period, setPeriod, busy, error, run } = useMEData();
  const [view, setView] = useState("visual");
  const [types, setTypes] = useState([]);
  const [brand, setBrand] = useState({ title: "", subtitle: "", preparedBy: "", org: "EACHRights", accent: "#00664E", logo: "" });

  /* Breakdown types, so gender and other breakdowns can be shown with their categories in order */
  useEffect(() => {
    let mounted = true;
    api("/me/disaggregations")
      .then((r) => mounted && setTypes(r.disaggregations || []))
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const exportFile = (format) =>
    run(() =>
      downloadCsv(
        `/me/frameworks/${selectedId}/export?format=${format}&period=${encodeURIComponent(period)}`,
        format === "logframe" ? "logframe.csv" : `results-table-${period}.csv`
      )
    );

  const perProject = view !== "program";

  return (
    <Page>
      {/* Hide the app chrome when printing or saving as PDF, and keep the colours */}
      <style>{`@media print { aside, header[class*="sticky"], nav[aria-label="Main navigation"] { display: none !important; } * { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }`}</style>

      <div className="print:hidden">
        <PageHead title="Smart reports" subtitle="Build a report on the left, check the page on the right, then print it or save it as a PDF.">
          {perProject && <FrameworkSelect frameworks={frameworks} value={selectedId} onChange={setSelectedId} />}
          {perProject && fw && (
            <>
              <button type="button" onClick={() => exportFile("results")} disabled={busy} className={BTN_LIGHT}>Results CSV</button>
              <button type="button" onClick={() => exportFile("logframe")} disabled={busy} className={BTN_LIGHT}>Logframe CSV</button>
            </>
          )}
          <button type="button" onClick={() => window.print()} className={BTN}>Print or save PDF</button>
        </PageHead>
      </div>

      <div role="tablist" aria-label="Report type" className="grid gap-3 sm:grid-cols-3 print:hidden">
        {VIEWS.map(([id, label, hint]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={view === id}
            onClick={() => setView(id)}
            className={`rounded-xl border p-4 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00664E] ${
              view === id ? "border-[#00664E] bg-[#ECFDF3]" : "border-[#E5E7EB] bg-white hover:border-[#A6F4C5]"
            }`}
          >
            <span className={`block text-sm font-semibold ${view === id ? "text-[#00523F]" : "text-[#101828]"}`}>{label}</span>
            <span className="mt-0.5 block text-xs text-[#667085]">{hint}</span>
          </button>
        ))}
      </div>

      <div className="print:hidden"><ErrorBar error={error} /></div>

      {perProject && !fw && <NoFramework isAdmin={isAdmin} busy={busy} />}

      {perProject && fw && data && (
        <div className="print:hidden">
          <PeriodTabs periods={fw.periods} value={period} onChange={setPeriod} />
        </div>
      )}

      {view === "visual" && fw && data && (
        <VisualReport
          key={selectedId}
          fw={fw}
          frameworkId={selectedId}
          data={data}
          ordered={ordered}
          rows={rows}
          period={period}
          brand={brand}
          setBrand={setBrand}
          types={types}
        />
      )}

      {view === "table" && fw && data && <TableReport fw={fw} data={data} ordered={ordered} brand={brand} setBrand={setBrand} />}

      {view === "program" &&
        (frameworks.length > 0 ? (
          <ProgramReport frameworks={frameworks} brand={brand} setBrand={setBrand} />
        ) : (
          <NoFramework isAdmin={isAdmin} busy={busy} />
        ))}
    </Page>
  );
}

export default MEReports;
