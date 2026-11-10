// Clickable stat cards + graphical statistics for the Attendance page.
// Save next to Attendance.jsx (src/pages/.../attendanceStats.jsx). No chart library needed: charts are plain SVG/Tailwind.

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#008060]";

export const METRICS = {
  present: { label: "Present", color: "#0F9F77", text: "text-[#00664E]" },
  late: { label: "Late", color: "#F79009", text: "text-[#8A4B00]" },
  absent: { label: "Absent", color: "#D92D20", text: "text-[#8A1C14]" },
  leave: { label: "On leave", color: "#D4A017", text: "text-[#8A4B00]" },
  away: { label: "Away on duty", color: "#4F7CD8", text: "text-[#2E5AAC]" },
  remote: { label: "Remote", color: "#7A5AF8", text: "text-[#5B3FD0]" },
  hours: { label: "Hours worked", color: "#98A2B3", text: "text-[#0B2B24]" },
};
const ORDER = ["present", "late", "absent", "leave", "away", "remote", "hours"];

/* ---------- filtering a list of days by a card ---------- */

export function filterDays(days, key) {
  if (!key) return days;
  return days.filter((d) => {
    const r = d.record;
    switch (key) {
      case "present":
        return !!r?.in;
      case "late":
        return !!r?.late;
      case "hours":
        return (r?.hours || 0) > 0;
      default:
        return d.state === key;
    }
  });
}

/* ---------- cards ---------- */

// Same look as before. Pass `onSelect` to make the cards clickable (click again to clear).
export function SummaryCards({ summary, active = null, onSelect }) {
  if (!summary) return null;
  const value = (k) => (k === "hours" ? Math.round((summary.hours || 0) * 10) / 10 : summary[k] ?? 0);
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7 print:hidden">
      {ORDER.map((k) => {
        const m = METRICS[k];
        const isActive = active === k;
        const inner = (
          <>
            <span className="flex items-center gap-1.5 text-xs font-medium text-[#667085]">
              <i className="h-1.5 w-1.5 rounded-full" style={{ background: m.color }} />
              {m.label}
            </span>
            <span className={`mt-1.5 block text-2xl font-semibold tabular-nums ${m.text}`}>{value(k)}</span>
          </>
        );
        const base = "rounded-xl border bg-white px-4 py-3.5 text-left shadow-[0_1px_2px_rgba(11,43,36,0.04)]";
        if (!onSelect)
          return (
            <div key={k} className={`${base} border-[#E3E8E5]`}>
              {inner}
            </div>
          );
        return (
          <button
            type="button"
            key={k}
            aria-pressed={isActive}
            title={isActive ? "Click to show everything again" : `Click to show only: ${m.label}`}
            onClick={() => onSelect(isActive ? null : k)}
            className={`${base} w-full cursor-pointer transition hover:border-[#008060] hover:shadow-md motion-reduce:transition-none ${FOCUS} ${
              isActive ? "border-[#008060] bg-[#F2FAF6] ring-2 ring-[#008060]/30" : "border-[#E3E8E5]"
            }`}
          >
            {inner}
          </button>
        );
      })}
    </div>
  );
}

// Team page tile. Pass `onClick` to make it clickable.
export function StatTile({ label, value, cls = "", dot, active = false, onClick }) {
  const base = "rounded-xl border bg-white p-5 text-left shadow-[0_1px_2px_rgba(11,43,36,0.04)]";
  const inner = (
    <>
      <span className="flex items-center gap-1.5 text-xs font-medium text-[#667085]">
        {dot && <i className={`h-1.5 w-1.5 rounded-full ${dot}`} />}
        {label}
      </span>
      <span className={`mt-1.5 block text-3xl font-semibold tabular-nums ${cls}`}>{value}</span>
    </>
  );
  if (!onClick) return <div className={`${base} border-[#E3E8E5]`}>{inner}</div>;
  return (
    <button
      type="button"
      aria-pressed={active}
      title={active ? "Click to show everyone again" : `Click to show only: ${label}`}
      onClick={onClick}
      className={`${base} w-full cursor-pointer transition hover:border-[#008060] hover:shadow-md motion-reduce:transition-none ${FOCUS} ${
        active ? "border-[#008060] bg-[#F2FAF6] ring-2 ring-[#008060]/30" : "border-[#E3E8E5]"
      }`}
    >
      {inner}
    </button>
  );
}

/* ---------- charts ---------- */

function Donut({ parts, active, onPick }) {
  const R = 54;
  const C = 2 * Math.PI * R;
  const total = parts.reduce((s, p) => s + p.value, 0);
  let offset = 0;
  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg viewBox="0 0 140 140" className="h-40 w-40 shrink-0" role="img" aria-label="Share of working days by status">
        <circle cx="70" cy="70" r={R} fill="none" stroke="#EEF1F0" strokeWidth="18" />
        {total > 0 &&
          parts
            .filter((p) => p.value > 0)
            .map((p) => {
              const len = (p.value / total) * C;
              const el = (
                <circle
                  key={p.key}
                  cx="70"
                  cy="70"
                  r={R}
                  fill="none"
                  stroke={p.color}
                  strokeWidth={active === p.key ? 23 : 18}
                  strokeDasharray={`${len} ${C - len}`}
                  strokeDashoffset={-offset}
                  transform="rotate(-90 70 70)"
                  style={{ cursor: "pointer" }}
                  onClick={() => onPick(active === p.key ? null : p.key)}
                >
                  <title>{`${p.label}: ${p.value} (${Math.round((p.value / total) * 100)}%)`}</title>
                </circle>
              );
              offset += len;
              return el;
            })}
        <text x="70" y="68" textAnchor="middle" fontSize="22" fontWeight="600" fill="#0B2B24">
          {total}
        </text>
        <text x="70" y="84" textAnchor="middle" fontSize="9" fill="#667085">
          person-days
        </text>
      </svg>
      <ul className="space-y-1.5 text-sm">
        {parts.map((p) => (
          <li key={p.key}>
            <button
              type="button"
              onClick={() => onPick(active === p.key ? null : p.key)}
              aria-pressed={active === p.key}
              className={`flex items-center gap-2 rounded-md px-1.5 py-0.5 hover:bg-[#F6F8F7] ${FOCUS} ${
                active === p.key ? "font-semibold" : ""
              }`}
            >
              <i className="h-2.5 w-2.5 rounded-full" style={{ background: p.color }} />
              <span className="w-24 text-left text-[#475467]">{p.label}</span>
              <span className="tabular-nums">{p.value}</span>
              <span className="w-10 text-right text-xs tabular-nums text-[#667085]">
                {total ? `${Math.round((p.value / total) * 100)}%` : "-"}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const STACK_KEYS = ["present", "absent", "leave", "away", "remote"];

function StackedBars({ people, active, onPick }) {
  const rows = people.slice(0, 30);
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 print:hidden">
        {STACK_KEYS.map((k) => (
          <button
            type="button"
            key={k}
            aria-pressed={active === k}
            onClick={() => onPick(active === k ? null : k)}
            className={`inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs text-[#475467] hover:bg-[#F6F8F7] ${FOCUS} ${
              active === k ? "font-semibold text-[#0B2B24]" : ""
            }`}
          >
            <i className="h-2.5 w-2.5 rounded-full" style={{ background: METRICS[k].color }} />
            {METRICS[k].label}
          </button>
        ))}
      </div>
      <ul className="space-y-2.5">
        {rows.map((p) => {
          const total = STACK_KEYS.reduce((s, k) => s + (p[k] || 0), 0);
          return (
            <li key={p.userId} className="flex items-center gap-3 text-sm">
              <span className="w-32 shrink-0 truncate font-medium" title={p.userName || p.userId}>
                {p.userName || p.userId}
              </span>
              <div
                className="flex h-4 flex-1 overflow-hidden rounded-full bg-[#EEF1F0]"
                role="img"
                aria-label={STACK_KEYS.map((k) => `${METRICS[k].label} ${p[k] || 0}`).join(", ")}
              >
                {total > 0 &&
                  STACK_KEYS.map(
                    (k) =>
                      p[k] > 0 && (
                        <div
                          key={k}
                          title={`${METRICS[k].label}: ${p[k]}`}
                          style={{ width: `${(p[k] / total) * 100}%`, background: METRICS[k].color }}
                        />
                      )
                  )}
              </div>
              <span className="w-10 shrink-0 text-right text-xs tabular-nums text-[#667085]">{total}d</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function MetricBars({ people, metric }) {
  const m = METRICS[metric];
  const rows = [...people].sort((a, b) => (b[metric] || 0) - (a[metric] || 0)).slice(0, 30);
  const max = Math.max(0, ...rows.map((p) => p[metric] || 0));
  const fmt = (v) => (metric === "hours" ? `${Math.round(v * 10) / 10} h` : String(v));
  return (
    <ul className="space-y-2.5">
      {rows.map((p) => {
        const v = p[metric] || 0;
        return (
          <li key={p.userId} className="flex items-center gap-3 text-sm">
            <span className="w-32 shrink-0 truncate font-medium" title={p.userName || p.userId}>
              {p.userName || p.userId}
            </span>
            <div className="h-4 flex-1 overflow-hidden rounded-full bg-[#EEF1F0]">
              <div
                className="h-full rounded-full"
                style={{ width: max ? `${(v / max) * 100}%` : 0, background: m.color }}
                title={`${m.label}: ${fmt(v)}`}
              />
            </div>
            <span className="w-14 shrink-0 text-right text-xs font-medium tabular-nums">{fmt(v)}</span>
          </li>
        );
      })}
    </ul>
  );
}

// metric = the card currently selected (or null). Charts follow it; the donut and stacked bars let you pick one too.
export function ReportCharts({ people, totals, metric, onMetric }) {
  const chartMetric = metric || "hours";
  const parts = STACK_KEYS.map((k) => ({
    key: k,
    label: METRICS[k].label,
    color: METRICS[k].color,
    value: totals[k] || 0,
  }));
  return (
    <div className="grid gap-8 border-b border-[#EEF1F0] p-5 [-webkit-print-color-adjust:exact] [print-color-adjust:exact] lg:grid-cols-2 print:grid-cols-2">
      <section>
        <h4 className="mb-3 text-sm font-semibold">Where the working days went</h4>
        <Donut parts={parts} active={metric} onPick={onMetric} />
      </section>
      <section>
        <h4 className="mb-3 text-sm font-semibold">Days per person</h4>
        <StackedBars people={people} active={metric} onPick={onMetric} />
      </section>
      <section className="lg:col-span-2 print:col-span-2">
        <h4 className="text-sm font-semibold">{METRICS[chartMetric].label} per person</h4>
        <p className="mb-3 mt-0.5 text-xs text-[#667085] print:hidden">
          Select a card above (or a legend item) to chart a different measure.
        </p>
        <MetricBars people={people} metric={chartMetric} />
      </section>
    </div>
  );
}
