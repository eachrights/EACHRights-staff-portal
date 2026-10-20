import { useMemo } from "react";
import {
  CARD, ErrorBar, FrameworkSelect, NoFramework, Page, PageHead, PROGRESS, progressOf, useMEData,
} from "./Shared";

const VERDICT = {
  on: "Likely to meet target",
  risk: "At risk of missing target",
  off: "Unlikely to meet target",
  none: "Not enough data",
};

/* Small chart: targets (hollow), approved actuals (solid) and the projected path (dashed) */
function Sparkline({ f }) {
  const W = 170, H = 54, P = 6;
  const n = f.periods.length;
  const x = (i) => (n === 1 ? W / 2 : P + (i * (W - 2 * P)) / (n - 1));
  const tVals = f.targetIdx.map((i) => f.ind.targets[f.periods[i]]);
  const max = Math.max(1, ...tVals, ...f.pts.map((p) => p.y), f.projected ?? 0);
  const y = (v) => H - P - (v / max) * (H - 2 * P);
  const lastPt = f.pts[f.pts.length - 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-14 w-full max-w-[190px]" role="img" aria-label={`Trend for ${f.ind.name}`}>
      {f.targetIdx.map((i) => (
        <circle key={i} cx={x(i)} cy={y(f.ind.targets[f.periods[i]])} r="3" fill="#fff" stroke="#B7A8F2" strokeWidth="1.5" />
      ))}
      {f.pts.length > 1 && (
        <polyline fill="none" stroke="#5B3FD0" strokeWidth="2" points={f.pts.map((p) => `${x(p.i)},${y(p.y)}`).join(" ")} />
      )}
      {lastPt && f.projected !== null && lastPt.i < f.last && (
        <line x1={x(lastPt.i)} y1={y(lastPt.y)} x2={x(f.last)} y2={y(f.projected)} stroke="#5B3FD0" strokeWidth="2" strokeDasharray="4 3" />
      )}
      {f.pts.map((p) => (
        <circle key={p.i} cx={x(p.i)} cy={y(p.y)} r="3" fill="#5B3FD0" />
      ))}
    </svg>
  );
}

function MEPredictions() {
  const { isAdmin, frameworks, selectedId, setSelectedId, data, fw, busy, error } = useMEData();

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

  return (
    <Page>
      <PageHead title="Predictions" subtitle="Where each indicator is heading by its last reporting period.">
        <FrameworkSelect frameworks={frameworks} value={selectedId} onChange={setSelectedId} />
      </PageHead>

      <ErrorBar error={error} />
      {!fw && <NoFramework isAdmin={isAdmin} busy={busy} />}

      {fw && (
        <>
          <section aria-label="Forecast summary" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {Object.entries(VERDICT).map(([k, label]) => (
              <div key={k} className={`${CARD} p-4`}>
                <p className="flex items-center gap-1.5 text-xs font-medium text-[#667085]">
                  <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: PROGRESS[k].color }} />
                  {label}
                </p>
                <p className="mt-1.5 text-2xl font-semibold tracking-tight text-[#101828]">{counts[k]}</p>
              </div>
            ))}
          </section>

          <section aria-label="Indicator forecasts" className={`${CARD} overflow-x-auto`}>
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead>
                <tr className="border-b border-[#E5E7EB] bg-[#F9FAFB] text-xs font-medium text-[#667085]">
                  <th className="px-5 py-3">Indicator</th>
                  <th className="px-3 py-3">Trend</th>
                  <th className="px-3 py-3">Final target</th>
                  <th className="px-3 py-3">Projected</th>
                  <th className="px-5 py-3">Outlook</th>
                </tr>
              </thead>
              <tbody>
                {forecasts.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-5 py-10 text-center text-sm text-[#98A2B3]">No indicators have targets yet.</td>
                  </tr>
                )}
                {forecasts.map((f) => (
                  <tr key={f.ind.id} className="border-t border-[#F2F4F7] align-middle">
                    <td className="px-5 py-3.5">
                      <p className="font-medium text-[#101828]">{f.ind.name}</p>
                      <p className="mt-0.5 text-xs text-[#667085]">{f.pts.length} approved {f.pts.length === 1 ? "period" : "periods"}</p>
                    </td>
                    <td className="px-3 py-3.5"><Sparkline f={f} /></td>
                    <td className="px-3 py-3.5 text-[#475467]">{f.target}{f.ind.unit === "%" ? "%" : ""} <span className="text-xs text-[#98A2B3]">({f.periods[f.last]})</span></td>
                    <td className="px-3 py-3.5 font-medium text-[#101828]">
                      {f.projected === null ? "-" : `${Math.round(f.projected * 10) / 10}${f.ind.unit === "%" ? "%" : ""}`}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#344054]">
                        <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: PROGRESS[f.verdict].color }} />
                        {VERDICT[f.verdict]}
                        {f.ratio !== null && <span className="font-normal text-[#667085]">{f.ratio}%</span>}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <p className="text-xs text-[#98A2B3]">
            Projections draw a straight line through approved values and assume higher is better. They need at least two approved periods and are a guide, not a promise.
          </p>
        </>
      )}
    </Page>
  );
}

export default MEPredictions;
