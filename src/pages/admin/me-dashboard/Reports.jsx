import { useEffect, useMemo, useState } from "react";
import { DEPARTMENT_AREAS, PROGRAM_AREAS } from "../../../access";
import { api, downloadCsv } from "../../../meApi";
import { LABELS } from "../../../labels";
import {
  BTN, BTN_LIGHT, CARD, CardHead, ErrorBar, FIELD, FrameworkSelect, NoFramework, Page, PageHead, PeriodTabs,
  PROGRESS, ProgressDot, progressOf, useMEData,
} from "./Shared";

/*
 * Three report views, like Kinaki:
 *  Visual report       choose the charts and results to include, add analysis comments and images
 *  Table-based report  every result and indicator with baseline, targets and actuals for each period
 *  Program report      the projects of one programme brought together, with combined results
 * Only approved values count towards progress. Print or save as PDF from the browser.
 */

const AREAS = [...PROGRAM_AREAS, ...DEPARTMENT_AREAS];
const areaName = (slug) => AREAS.find((a) => a.slug === slug)?.name || slug || "No area";

const VIEWS = [
  ["visual", "Visual report"],
  ["table", "Table-based report"],
  ["program", LABELS.programmeReport],
];

const CHARTS = [
  ["progress", "Progress against target"],
  ["trend", "Achievement by period"],
  ["levels", "Reporting status by result"],
];

const MAX_IMAGE_BYTES = 1_500_000;
const fmt = (n) => (n === undefined || n === null || n === "" ? "-" : Number(n).toLocaleString());
const pctOf = (actual, target) => (target ? Math.round((actual / target) * 100) : null);

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

function TrendLine({ points }) {
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
      <path d={line} fill="none" stroke="#5B3FD0" strokeWidth="2" strokeLinejoin="round" />
      {seq.map((p) => (
        <circle key={p.period} cx={p.x} cy={p.y} r="3.5" fill="#fff" stroke="#5B3FD0" strokeWidth="2">
          <title>{`${p.period}: ${p.pct}%`}</title>
        </circle>
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

/* ---------- Visual project report ---------- */

function VisualReport({ fw, data, ordered, rows, period }) {
  const [charts, setCharts] = useState({ progress: true, trend: true, levels: true });
  const [included, setIncluded] = useState(null); // null means every result
  const [analysis, setAnalysis] = useState({}); // { [resultId]: { text, image } }
  const [imageError, setImageError] = useState("");

  const chosen = (id) => included === null || included.has(id);
  const toggleResult = (id) =>
    setIncluded((cur) => {
      const next = new Set(cur ?? ordered.map((r) => r.id));
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const expected = rows.filter((r) => r.target !== undefined && chosen(r.result.id));
  const counts = Object.fromEntries(Object.keys(PROGRESS).map((k) => [k, expected.filter((r) => r.progress === k).length]));

  const trend = fw.periods.map((p) => {
    const pcts = [];
    for (const ind of data.indicators) {
      if (!chosen(ind.resultId)) continue;
      const target = ind.targets?.[p];
      const v = data.values.find((x) => x.indicatorId === ind.id && x.period === p && x.status === "approved");
      if (target && v) pcts.push(Math.round((v.actual / target) * 100));
    }
    return { period: p, pct: pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : null };
  });

  const groups = ordered
    .filter((r) => chosen(r.id))
    .map((r) => {
      const rs = expected.filter((x) => x.result.id === r.id);
      const approved = rs.filter((x) => x.saved?.status === "approved").length;
      const awaiting = rs.filter((x) => x.saved?.status === "submitted").length;
      return { id: r.id, title: r.title, total: rs.length, approved, awaiting, missing: rs.length - approved - awaiting };
    })
    .filter((g) => g.total > 0);

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

  return (
    <>
      <div className={`${CARD} grid gap-5 p-4 sm:grid-cols-2 print:hidden`}>
        <fieldset>
          <legend className="text-xs font-medium text-[#667085]">Charts to include</legend>
          <div className="mt-2 space-y-1.5">
            {CHARTS.map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm text-[#344054]">
                <input type="checkbox" className="h-4 w-4 accent-[#5B3FD0]" checked={charts[key]} onChange={(e) => setCharts({ ...charts, [key]: e.target.checked })} />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="text-xs font-medium text-[#667085]">Results to include</legend>
          <div className="mt-2 max-h-40 space-y-1.5 overflow-y-auto">
            {ordered.map((r) => (
              <label key={r.id} className="flex items-center gap-2 text-sm text-[#344054]" style={{ paddingLeft: `${r.depth * 14}px` }}>
                <input type="checkbox" className="h-4 w-4 accent-[#5B3FD0]" checked={chosen(r.id)} onChange={() => toggleResult(r.id)} />
                <span className="truncate">{r.title}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {imageError && <p role="alert" className="text-sm text-red-700 sm:col-span-2">{imageError}</p>}
      </div>

      <article className={`${CARD} space-y-8 p-8 print:border-0 print:p-0 print:shadow-none`} aria-label="Visual report preview">
        <header className="border-b border-[#EEF0F4] pb-5">
          <h2 className="text-xl font-semibold tracking-tight text-[#101828]">{fw.name}</h2>
          <p className="mt-1 text-sm text-[#667085]">{fw.donor || "No donor set"} · Reporting period {period} · Approved values only</p>
        </header>

        {(charts.progress || charts.trend || charts.levels) && (
          <section className="grid gap-8 sm:grid-cols-2">
            {charts.progress && (
              <div>
                <CardHead title="Progress against target" subtitle={`${expected.length} indicators with a target`} />
                <ProgressBar counts={counts} total={expected.length} />
              </div>
            )}
            {charts.trend && (
              <div>
                <CardHead title="Achievement by period" subtitle="Average percentage of target" />
                <TrendLine points={trend} />
              </div>
            )}
            {charts.levels && (
              <div className="sm:col-span-2">
                <CardHead title="Reporting status by result" subtitle={`Indicators with a target, ${period}`} />
                <ResultBars groups={groups} />
              </div>
            )}
          </section>
        )}

        <section>
          <CardHead title="Results analysis" subtitle="Add comments and an image for each result to explain the numbers." />
          <div className="space-y-6">
            {ordered.filter((r) => chosen(r.id)).map((r) => {
              const inds = rows.filter((x) => x.result.id === r.id);
              const a = analysis[r.id] || {};
              return (
                <div key={r.id} className="break-inside-avoid rounded-lg border border-[#EAECF0] p-4">
                  <h3 className="text-sm font-semibold text-[#101828]">{r.title}</h3>
                  <p className="text-xs text-[#98A2B3]">{fw.levels?.[r.level] ?? `Level ${r.level + 1}`}</p>

                  {inds.length > 0 && (
                    <ul className="mt-3 space-y-1.5 text-sm">
                      {inds.map(({ ind, saved, target, pct, progress }) => (
                        <li key={ind.id} className="flex flex-wrap items-center gap-x-3 text-[#344054]">
                          <span className="min-w-0 flex-1">{ind.name}</span>
                          <span className="tabular-nums text-[#667085]">{saved?.status === "approved" ? fmt(saved.actual) : "-"} / {fmt(target)}</span>
                          <ProgressDot progress={progress} pct={pct} />
                        </li>
                      ))}
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
                    <label className="mt-3 inline-block cursor-pointer text-xs font-medium text-[#5B3FD0] hover:underline print:hidden">
                      Add an image
                      <input type="file" accept="image/*" className="sr-only" onChange={(e) => { setImage(r.id, e.target.files?.[0]); e.target.value = ""; }} />
                    </label>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </article>
      <p className="text-xs text-[#98A2B3] print:hidden">Comments and images are kept on this page only. Print or save as PDF before leaving it.</p>
    </>
  );
}

/* ---------- Table-based project report (logframe style) ---------- */

function TableReport({ fw, data, ordered }) {
  const approved = useMemo(
    () => new Map(data.values.filter((v) => v.status === "approved").map((v) => [`${v.indicatorId}#${v.period}`, v])),
    [data]
  );
  const levelName = (i) => fw.levels?.[i] ?? `Level ${i + 1}`;
  const withIndicators = ordered.filter((r) => data.indicators.some((i) => i.resultId === r.id));

  return (
    <article className="space-y-4 print:space-y-2" aria-label="Table-based report">
      <header className="print:mb-2">
        <h2 className="text-xl font-semibold tracking-tight text-[#101828]">{fw.name}</h2>
        <p className="mt-1 text-sm text-[#667085]">{fw.donor || "No donor set"} · Results framework with targets and approved actuals for every period</p>
      </header>

      <div className={`${CARD} overflow-x-auto print:border-0`}>
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
              <TableGroup key={r.id} result={r} levelName={levelName(r.level)} indicators={data.indicators.filter((i) => i.resultId === r.id)} periods={fw.periods} approved={approved} />
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}

function FragmentHeads() {
  return (
    <>
      <th className="border-l border-[#E5E7EB] px-3 py-1.5 text-center">Target</th>
      <th className="px-3 py-1.5 text-center">Actual</th>
    </>
  );
}

function TableGroup({ result, levelName, indicators, periods, approved }) {
  return (
    <>
      <tr className="bg-[#FDF1E8]">
        <td colSpan={5 + periods.length * 2} className="px-3 py-2 text-xs font-semibold text-[#9A5410]">
          {levelName}: <span className="text-[#3A2108]">{result.title}</span>
        </td>
      </tr>
      {indicators.map((ind) => (
        <tr key={ind.id} className="border-t border-[#F2F4F7] align-top">
          <td className="px-3 py-2.5 font-medium text-[#101828]">{ind.name}</td>
          <td className="px-3 py-2.5 text-[#475467]">{ind.unit || "-"}</td>
          <td className="px-3 py-2.5 tabular-nums text-[#475467]">{fmt(ind.baseline)}</td>
          {periods.map((p) => {
            const target = ind.targets?.[p];
            const v = approved.get(`${ind.id}#${p}`);
            const color = v && target ? PROGRESS[progressOf(pctOf(v.actual, target))].color : undefined;
            return (
              <FragmentCells key={p} target={target} actual={v?.actual} color={color} />
            );
          })}
          <td className="border-l border-[#F2F4F7] px-3 py-2.5 text-[#475467]">{ind.mov || "-"}</td>
          <td className="px-3 py-2.5 text-[#475467]">{ind.assumptions || "-"}</td>
        </tr>
      ))}
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
    avgPct: pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : null,
    combined,
  };
}

function ProgramReport({ frameworks }) {
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

  return (
    <>
      <div className={`${CARD} flex flex-wrap items-center gap-3 p-4 print:hidden`}>
        <label htmlFor="programme" className="text-xs font-medium text-[#667085]">{LABELS.programme}</label>
        <select id="programme" className={FIELD} value={slug} onChange={(e) => setSlug(e.target.value)}>
          {programmes.map((p) => (
            <option key={p.slug} value={p.slug}>{p.name}</option>
          ))}
        </select>
      </div>

      <ErrorBar error={error} />
      {loading && <p className="py-8 text-center text-sm text-[#98A2B3]">Loading projects...</p>}

      {loaded && (
        <article className={`${CARD} space-y-7 p-8 print:border-0 print:p-0 print:shadow-none`} aria-label="Program report">
          <header className="border-b border-[#EEF0F4] pb-5">
            <h2 className="text-xl font-semibold tracking-tight text-[#101828]">{areaName(slug)}: {LABELS.programmeReport.toLowerCase()}</h2>
            <p className="mt-1 text-sm text-[#667085]">
              {projects.length} {projects.length === 1 ? "project" : "projects"} · {totals.indicators} indicators · {totals.reported} of {totals.expected} targets reported and approved
            </p>
          </header>

          <section>
            <CardHead title={`${LABELS.projects} in this ${LABELS.programme.toLowerCase()}`} />
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
                    <tr key={p.fw.id} className="border-t border-[#F2F4F7]">
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
            <CardHead title="Results across projects" subtitle="Indicators with the same name and unit are added together. Percentages are averaged. Approved values only." />
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
                      <tr key={`${c.name}|${c.unit}`} className="border-t border-[#F2F4F7]">
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
        </article>
      )}
    </>
  );
}

/* ---------- Page ---------- */

function MEReports() {
  const { isAdmin, frameworks, selectedId, setSelectedId, data, fw, ordered, rows, period, setPeriod, busy, error, run } = useMEData();
  const [view, setView] = useState("visual");

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
      {/* Hide the app chrome when printing or saving as PDF */}
      <style>{`@media print { aside, header[class*="sticky"], nav[aria-label="Main navigation"] { display: none !important; } }`}</style>

      <PageHead title="Smart reports" subtitle="Build a visual, table-based or programme report, then print it or save it as a PDF.">
        {perProject && <FrameworkSelect frameworks={frameworks} value={selectedId} onChange={setSelectedId} />}
        {perProject && fw && (
          <>
            <button type="button" onClick={() => exportFile("results")} disabled={busy} className={BTN_LIGHT}>Results CSV</button>
            <button type="button" onClick={() => exportFile("logframe")} disabled={busy} className={BTN_LIGHT}>Logframe CSV</button>
          </>
        )}
        <button type="button" onClick={() => window.print()} className={BTN}>Print or save PDF</button>
      </PageHead>

      <div role="tablist" aria-label="Report type" className="flex flex-wrap gap-1 border-b border-[#E5E7EB] print:hidden">
        {VIEWS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={view === id}
            onClick={() => setView(id)}
            className={`-mb-px border-b-2 px-3 py-2.5 text-sm transition ${
              view === id ? "border-[#5B3FD0] font-semibold text-[#101828]" : "border-transparent text-[#667085] hover:text-[#344054]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="print:hidden"><ErrorBar error={error} /></div>

      {perProject && !fw && <NoFramework isAdmin={isAdmin} busy={busy} />}

      {view === "visual" && fw && data && (
        <>
          <PeriodTabs periods={fw.periods} value={period} onChange={setPeriod} />
          <VisualReport key={selectedId} fw={fw} data={data} ordered={ordered} rows={rows} period={period} />
        </>
      )}

      {view === "table" && fw && data && <TableReport fw={fw} data={data} ordered={ordered} />}

      {view === "program" && (frameworks.length > 0 ? <ProgramReport frameworks={frameworks} /> : <NoFramework isAdmin={isAdmin} busy={busy} />)}
    </Page>
  );
}

export default MEReports;
