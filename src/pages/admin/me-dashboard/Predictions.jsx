import { useMemo, useState } from "react";
import {
  CARD, ErrorBar, FIELD, FrameworkSelect, NoFramework, Page, PageHead, PROGRESS, progressOf, useMEData,
} from "./Shared";

const VERDICT = {
  on: "Likely to meet target",
  risk: "At risk of missing target",
  off: "Unlikely to meet target",
  none: "Not enough data",
};

/* Same header bands as the Indicators page, cycled by result */
const BANDS = [
  { bg: "#E9F6F1", bar: "#00664E", text: "#064E3B" },
  { bg: "#EEEBFB", bar: "#5B3FD0", text: "#3B2A8F" },
  { bg: "#FEF6D8", bar: "#CA9A04", text: "#7A5B00" },
  { bg: "#E8F1FD", bar: "#2E6FD8", text: "#1E4C9A" },
];

const unitMark = (ind) => (ind.unit === "%" ? "%" : "");
const round1 = (n) => Math.round(n * 10) / 10;

/* Small chart: targets (hollow), approved actuals (solid) and the projected path (dashed) */
function Sparkline({ f }) {
  const W = 190, H = 60, P = 8;
  const n = f.periods.length;
  const x = (i) => (n === 1 ? W / 2 : P + (i * (W - 2 * P)) / (n - 1));
  const tVals = f.targetIdx.map((i) => f.ind.targets[f.periods[i]]);
  const max = Math.max(1, ...tVals, ...f.pts.map((p) => p.y), f.projected ?? 0);
  const y = (v) => H - P - (v / max) * (H - 2 * P);
  const lastPt = f.pts[f.pts.length - 1];
  const color = PROGRESS[f.verdict].color;
  const stroke = f.verdict === "none" ? "#5B3FD0" : color;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-[60px] w-full max-w-[200px]" role="img" aria-label={`Trend for ${f.ind.name}`}>
      <line x1={P} x2={W - P} y1={H - P} y2={H - P} stroke="#EEF0F4" />
      {f.targetIdx.map((i) => (
        <circle key={i} cx={x(i)} cy={y(f.ind.targets[f.periods[i]])} r="3.5" fill="#fff" stroke="#B7A8F2" strokeWidth="1.5">
          <title>{`Target ${f.periods[i]}: ${f.ind.targets[f.periods[i]]}`}</title>
        </circle>
      ))}
      {f.pts.length > 1 && (
        <polyline fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" points={f.pts.map((p) => `${x(p.i)},${y(p.y)}`).join(" ")} />
      )}
      {lastPt && f.projected !== null && lastPt.i < f.last && (
        <line x1={x(lastPt.i)} y1={y(lastPt.y)} x2={x(f.last)} y2={y(f.projected)} stroke={stroke} strokeWidth="2" strokeDasharray="4 3" />
      )}
      {f.pts.map((p) => (
        <circle key={p.i} cx={x(p.i)} cy={y(p.y)} r="3.5" fill={stroke}>
          <title>{`${f.periods[p.i]}: ${p.y}`}</title>
        </circle>
      ))}
    </svg>
  );
}

function Outlook({ verdict, ratio }) {
  const color = PROGRESS[verdict].color;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium" style={{ backgroundColor: `${color}1F`, color: verdict === "none" ? "#475467" : color }}>
      <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      {VERDICT[verdict]}
      {ratio !== null && <span className="font-normal opacity-80">{ratio}%</span>}
    </span>
  );
}

function MEPredictions() {
  const { isAdmin, frameworks, selectedId, setSelectedId, data, fw, ordered, busy, error } = useMEData();
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");

  const forecasts = useMemo(() => {
    if (!data) return [];
    const periods = data.framework.periods;
    return data.indicators
      .map((ind) => {
        const targetIdx = periods.map((p, i) => (ind.targets?.[p] !== undefined ? i : -1)).filter((i) => i >= 0);
        if (targetIdx.length === 0) return null;

        const pts = periods
          .map((p, i) => {
            const v = data.values.find((x) => x.indicatorId === ind.id && x.period === p && x.status === "approved");
            return v ? { i, y: Number(v.actual) } : null;
          })
          .filter(Boolean);

        const last = targetIdx[targetIdx.length - 1];
        const target = ind.targets[periods[last]];

        let projected = null;
        const exact = pts.find((p) => p.i === last);
        if (exact) {
          projected = exact.y;
        } else if (pts.length >= 2) {
          const k = pts.length;
          const sx = pts.reduce((a, p) => a + p.i, 0);
          const sy = pts.reduce((a, p) => a + p.y, 0);
          const sxy = pts.reduce((a, p) => a + p.i * p.y, 0);
          const sxx = pts.reduce((a, p) => a + p.i * p.i, 0);
          const slope = (k * sxy - sx * sy) / (k * sxx - sx * sx);
          projected = Math.max(0, (sy - slope * sx) / k + slope * last);
        }

        const ratio = projected !== null && target ? Math.round((projected / target) * 100) : null;
        return { ind, periods, pts, targetIdx, last, target, projected, ratio, verdict: progressOf(ratio) };
      })
      .filter(Boolean);
  }, [data]);

  const counts = Object.fromEntries(Object.keys(PROGRESS).map((k) => [k, forecasts.filter((f) => f.verdict === k).length]));

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return forecasts.filter((f) => (filter === "all" || f.verdict === filter) && (!q || f.ind.name.toLowerCase().includes(q)));
  }, [forecasts, filter, query]);

  /* Indicators grouped under their result, in framework order */
  const groups = useMemo(
    () =>
      ordered
        .map((r, i) => ({ result: r, band: BANDS[i % BANDS.length], items: shown.filter((f) => f.ind.resultId === r.id) }))
        .filter((g) => g.items.length > 0),
    [ordered, shown]
  );

  const FILTERS = [["all", "All", forecasts.length], ...Object.keys(VERDICT).map((k) => [k, VERDICT[k], counts[k]])];

  return (
    <Page>
      <PageHead title="Predictions" subtitle="Where each indicator is heading by its last reporting period.">
        <FrameworkSelect frameworks={frameworks} value={selectedId} onChange={setSelectedId} />
      </PageHead>

      <ErrorBar error={error} />
      {!fw && <NoFramework isAdmin={isAdmin} busy={busy} />}

      {fw && (
        <>
          {/* Summary: one panel, four numbers */}
          <section aria-label="Forecast summary">
            <dl className={`${CARD} grid divide-y divide-[#EEF0F4] sm:grid-cols-2 sm:divide-y-0 xl:grid-cols-4 xl:divide-x`}>
              {Object.entries(VERDICT).map(([k, label]) => (
                <div key={k} className="p-5">
                  <dt className="flex items-center gap-1.5 text-[13px] font-medium text-[#667085]">
                    <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: PROGRESS[k].color }} />
                    {label}
                  </dt>
                  <dd className="mt-1 text-[28px] font-semibold leading-9 tracking-tight tabular-nums text-[#101828]">{counts[k]}</dd>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#EEF0F4]" aria-hidden="true">
                    <div className="h-full rounded-full" style={{ width: forecasts.length ? `${(counts[k] / forecasts.length) * 100}%` : "0%", backgroundColor: PROGRESS[k].color }} />
                  </div>
                </div>
              ))}
            </dl>
          </section>

          <section aria-label="Indicator forecasts" className={`${CARD} overflow-x-auto`}>
            <div className="flex flex-wrap items-center gap-2 p-4">
              <div role="tablist" aria-label="Filter by outlook" className="flex flex-wrap gap-1.5">
                {FILTERS.map(([key, label, n]) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={filter === key}
                    onClick={() => setFilter(key)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                      filter === key ? "bg-[#EDE9FB] text-[#5B3FD0]" : "text-[#475467] hover:bg-[#F4F5F7]"
                    }`}
                  >
                    {label} <span className="ml-1 tabular-nums opacity-70">{n}</span>
                  </button>
                ))}
              </div>
              <input className={`${FIELD} ml-auto w-60`} placeholder="Search indicators" aria-label="Search indicators" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>

            <div className="min-w-[860px] text-sm">
              <div className="grid grid-cols-[minmax(220px,3fr)_minmax(190px,2fr)_1fr_1fr_minmax(190px,2fr)] gap-3 border-y border-[#E5E7EB] bg-[#F9FAFB] px-5 py-3 text-xs font-medium text-[#667085]">
                <span>Indicator</span>
                <span>Trend</span>
                <span>Final target</span>
                <span>Projected</span>
                <span>Outlook</span>
              </div>

              {groups.length === 0 && (
                <p className="px-5 py-10 text-center text-sm text-[#98A2B3]">
                  {forecasts.length === 0 ? "No indicators have targets yet." : "No indicators match."}
                </p>
              )}

              {groups.map(({ result, band, items }) => (
                <div key={result.id}>
                  <div
                    className="flex items-center gap-2 border-l-4 px-4 py-2.5 text-sm font-semibold"
                    style={{ background: band.bg, borderLeftColor: band.bar, color: band.text }}
                  >
                    {result.title}
                    <span className="rounded-full bg-white/70 px-2 text-xs font-medium">{items.length}</span>
                  </div>

                  {items.map((f) => (
                    <div key={f.ind.id} className="grid grid-cols-[minmax(220px,3fr)_minmax(190px,2fr)_1fr_1fr_minmax(190px,2fr)] items-center gap-3 border-t border-[#F2F4F7] px-5 py-3 transition hover:bg-[#FAFAFC]">
                      <div>
                        <p className="font-medium text-[#3B2A8F]">{f.ind.name}</p>
                        <p className="mt-0.5 text-xs text-[#667085]">
                          {f.pts.length} approved {f.pts.length === 1 ? "period" : "periods"}
                          {f.ind.unit ? ` · ${f.ind.unit}` : ""}
                        </p>
                      </div>
                      <Sparkline f={f} />
                      <p className="tabular-nums text-[#475467]">
                        {f.target}{unitMark(f.ind)} <span className="text-xs text-[#98A2B3]">({f.periods[f.last]})</span>
                      </p>
                      <div>
                        <p className="font-semibold tabular-nums text-[#101828]">
                          {f.projected === null ? "-" : `${round1(f.projected)}${unitMark(f.ind)}`}
                        </p>
                        {f.ratio !== null && (
                          <div className="mt-1.5 h-1.5 w-20 overflow-hidden rounded-full bg-[#EAECF0]" aria-hidden="true">
                            <div className="h-full rounded-full" style={{ width: `${Math.min(f.ratio, 100)}%`, backgroundColor: PROGRESS[f.verdict].color }} />
                          </div>
                        )}
                      </div>
                      <div><Outlook verdict={f.verdict} ratio={f.ratio} /></div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </section>

          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#98A2B3]">
            <span className="flex items-center gap-1.5">
              <svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="4" fill="#fff" stroke="#B7A8F2" strokeWidth="1.5" /></svg>
              Target
            </span>
            <span className="flex items-center gap-1.5">
              <svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="4" fill="#5B3FD0" /></svg>
              Approved value
            </span>
            <span className="flex items-center gap-1.5">
              <svg width="20" height="12" aria-hidden="true"><line x1="1" y1="6" x2="19" y2="6" stroke="#5B3FD0" strokeWidth="2" strokeDasharray="4 3" /></svg>
              Projection
            </span>
          </p>
          <p className="text-xs text-[#98A2B3]">
            Projections draw a straight line through approved values and assume higher is better. They need at least two approved periods and are a guide, not a promise.
          </p>
        </>
      )}
    </Page>
  );
}

export default MEPredictions;
