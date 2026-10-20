import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../meApi";

const FIELD =
  "rounded-xl border border-[#D0D9D5] bg-white px-3 py-2 text-sm text-[#0B2B24] outline-none transition placeholder:text-[#98A2B3] focus:border-[#008060] focus:ring-4 focus:ring-[#008060]/15 disabled:bg-[#F3F6F5]";
const BTN =
  "rounded-xl bg-[#008060] px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-[#006B52] disabled:opacity-60";
const CARD = "rounded-2xl border border-[#E6ECE9] bg-white";
const DISPLAY = { fontFamily: '"Fraunces", Georgia, serif' };

const PROGRESS = {
  on: { label: "On track", color: "#008060" },
  risk: { label: "At risk", color: "#D98A00" },
  off: { label: "Off track", color: "#E5484D" },
  none: { label: "No data", color: "#CBD5D1" },
};

const GROUPS = [
  { id: "donor", label: "Donor" },
  { id: "area", label: "Program area" },
  { id: "country", label: "Country" },
  { id: "program", label: "Large program" },
];

const progressOf = (pct) => (pct === null ? "none" : pct >= 90 ? "on" : pct >= 50 ? "risk" : "off");

function StatusBar({ counts, total }) {
  return (
    <div
      role="img"
      aria-label={Object.entries(PROGRESS).map(([k, v]) => `${v.label}: ${counts[k]}`).join(", ")}
      className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-[#E9EEEB]"
    >
      {total > 0 &&
        Object.entries(PROGRESS).map(([k, v]) =>
          counts[k] > 0 ? (
            <div key={k} style={{ width: `${(counts[k] / total) * 100}%`, backgroundColor: v.color }} />
          ) : null
        )}
    </div>
  );
}

const emptyCounts = () => ({ on: 0, risk: 0, off: 0, none: 0 });

function PortfolioView() {
  const [data, setData] = useState(null);
  const [period, setPeriod] = useState("");
  const [groupBy, setGroupBy] = useState("donor");
  const [form, setForm] = useState({ name: "", unit: "", aggregation: "sum" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (wanted) => {
    const query = wanted ? `?period=${encodeURIComponent(wanted)}` : "";
    const loaded = await api(`/me/portfolio${query}`);
    setData(loaded);
    setPeriod(loaded.period);
  }, []);

  const run = async (task) => {
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    run(() => load(""));
  }, [load]);

  const groups = useMemo(() => {
    if (!data) return [];
    const map = new Map();

    for (const project of data.frameworks) {
      const key = project[groupBy] || "Not set";
      if (!map.has(key)) map.set(key, { name: key, projects: 0, expected: 0, reported: 0, awaiting: 0, counts: emptyCounts() });
      const group = map.get(key);

      group.projects += 1;
      group.expected += project.expected;
      group.reported += project.reported;
      group.awaiting += project.awaiting;
      for (const k of Object.keys(group.counts)) group.counts[k] += project.counts[k];
    }

    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [data, groupBy]);

  const totals = useMemo(() => {
    const t = { expected: 0, reported: 0, awaiting: 0, counts: emptyCounts() };
    for (const g of groups) {
      t.expected += g.expected;
      t.reported += g.reported;
      t.awaiting += g.awaiting;
      for (const k of Object.keys(t.counts)) t.counts[k] += g.counts[k];
    }
    return t;
  }, [groups]);

  const saveTag = (id, patch) =>
    run(async () => {
      await api(`/me/frameworks/${id}/tags`, { method: "PUT", body: patch });
      await load(period);
    });

  const addStrategic = (event) => {
    event.preventDefault();
    run(async () => {
      await api("/me/strategic", { method: "POST", body: form });
      setForm({ name: "", unit: "", aggregation: "sum" });
      await load(period);
    });
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-[#0B2B24]" style={DISPLAY}>
            Portfolio
          </h2>
          <p className="mt-1 text-sm text-[#667085]">
            All projects together, grouped and rolled up into strategic indicators.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-[#475467]">
            Group by
            <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)} className={FIELD}>
              {GROUPS.map((g) => (
                <option key={g.id} value={g.id}>{g.label}</option>
              ))}
            </select>
          </label>

          {data && data.periods.length > 0 && (
            <label className="flex items-center gap-2 text-sm text-[#475467]">
              Period
              <select value={period} onChange={(e) => run(() => load(e.target.value))} className={FIELD}>
                {data.periods.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </label>
          )}
        </div>
      </header>

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {data && data.frameworks.length === 0 && !busy && (
        <div className={`${CARD} p-10 text-center text-sm text-[#667085]`}>
          No projects have this period yet. Create a framework or load the sample from the project view.
        </div>
      )}

      {data && data.frameworks.length > 0 && (
        <>
          {/* Overall */}
          <section aria-label="Portfolio summary" className={`${CARD} p-5`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-3xl font-semibold tracking-tight text-[#0B2B24]" style={DISPLAY}>
                {totals.reported}/{totals.expected}
                <span className="ml-2 text-sm font-normal text-[#667085]">indicators reported across {data.frameworks.length} projects</span>
              </p>
              {totals.awaiting > 0 && (
                <span className="rounded-full bg-[#FFF4E0] px-2.5 py-1 text-xs font-medium text-[#7A4A00]">
                  {totals.awaiting} awaiting approval
                </span>
              )}
            </div>
            <div className="mt-3">
              <StatusBar counts={totals.counts} total={totals.expected} />
            </div>
            <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 text-sm">
              {Object.entries(PROGRESS).map(([k, v]) => (
                <li key={k} className="flex items-center gap-2 text-[#475467]">
                  <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: v.color }} />
                  {v.label}
                  <span className="font-semibold text-[#0B2B24]">{totals.counts[k]}</span>
                </li>
              ))}
            </ul>
          </section>

          {/* Groups */}
          <section aria-label={`Progress by ${groupBy}`} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {groups.map((group) => (
              <div key={group.name} className={`${CARD} p-5`}>
                <p className="truncate text-sm font-semibold text-[#0B2B24]">{group.name}</p>
                <p className="mt-0.5 text-xs text-[#667085]">
                  {group.projects} {group.projects === 1 ? "project" : "projects"} · {group.reported}/{group.expected} reported
                </p>
                <div className="mt-3">
                  <StatusBar counts={group.counts} total={group.expected} />
                </div>
                <p className="mt-2 text-xs text-[#667085]">
                  {group.counts.on} on track, {group.counts.risk} at risk, {group.counts.off} off track
                </p>
              </div>
            ))}
          </section>

          {/* Projects */}
          <section aria-label="Projects" className={`${CARD} overflow-x-auto`}>
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead>
                <tr className="border-b border-[#E6ECE9] text-xs font-medium text-[#667085]">
                  <th className="px-5 py-3">Project</th>
                  <th className="px-3 py-3">Donor</th>
                  <th className="px-3 py-3">Country</th>
                  <th className="px-3 py-3">Large program</th>
                  <th className="px-3 py-3">Reported</th>
                  <th className="px-5 py-3">Progress</th>
                </tr>
              </thead>
              <tbody>
                {data.frameworks.map((p) => (
                  <tr key={p.id} className="border-t border-[#EEF2F0] align-middle">
                    <td className="px-5 py-3">
                      <p className="font-medium text-[#0B2B24]">{p.name}</p>
                      <p className="mt-0.5 text-xs text-[#667085]">{p.area || "No program area"}</p>
                    </td>
                    <td className="px-3 py-3 text-[#475467]">{p.donor || "-"}</td>
                    {["country", "program"].map((field) => (
                      <td key={field} className="px-3 py-3">
                        <input
                          key={`${p.id}-${field}-${p[field]}`}
                          type="text"
                          defaultValue={p[field]}
                          placeholder="Not set"
                          aria-label={`${field === "country" ? "Country" : "Large program"} for ${p.name}`}
                          onBlur={(e) => e.target.value.trim() !== p[field] && saveTag(p.id, { [field]: e.target.value })}
                          disabled={busy}
                          className={`${FIELD} w-36 py-1.5`}
                        />
                      </td>
                    ))}
                    <td className="px-3 py-3 text-[#475467]">{p.reported}/{p.expected}</td>
                    <td className="px-5 py-3">
                      <div className="w-40">
                        <StatusBar counts={p.counts} total={p.expected} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}

      {/* Strategic indicators */}
      {data && (
        <section aria-label="Strategic indicators">
          <h3 className="mb-3 text-lg font-semibold text-[#07523F]" style={DISPLAY}>
            Strategic indicators
          </h3>

          <div className={`${CARD} overflow-x-auto`}>
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-[#E6ECE9] text-xs font-medium text-[#667085]">
                  <th className="px-5 py-3">Indicator</th>
                  <th className="px-3 py-3">Rolls up by</th>
                  <th className="px-3 py-3">Linked</th>
                  <th className="px-3 py-3">Target</th>
                  <th className="px-3 py-3">Actual</th>
                  <th className="px-5 py-3">Progress</th>
                </tr>
              </thead>
              <tbody>
                {data.strategic.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-sm text-[#98A2B3]">
                      No strategic indicators yet. Add one below, then link project indicators to it from the project view.
                    </td>
                  </tr>
                )}

                {data.strategic.map((s) => {
                  const progress = progressOf(s.pct);
                  return (
                    <tr key={s.id} className="border-t border-[#EEF2F0]">
                      <td className="px-5 py-3">
                        <p className="font-medium text-[#0B2B24]">{s.name}</p>
                        {s.unit && <p className="mt-0.5 text-xs text-[#667085]">Unit: {s.unit}</p>}
                      </td>
                      <td className="px-3 py-3 text-[#475467]">{s.aggregation === "average" ? "Average" : "Sum"}</td>
                      <td className="px-3 py-3 text-[#475467]">
                        {s.indicators} in {s.projects} {s.projects === 1 ? "project" : "projects"}
                      </td>
                      <td className="px-3 py-3 text-[#475467]">{s.target ?? "-"}</td>
                      <td className="px-3 py-3 text-[#475467]">
                        {s.actual ?? "-"}
                        {s.indicators > 0 && (
                          <span className="block text-xs text-[#98A2B3]">
                            {s.reportedIndicators}/{s.indicators} approved
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <div className="w-36">
                          <div className="flex items-center justify-between text-xs">
                            <span className="flex items-center gap-1.5 font-medium text-[#344054]">
                              <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: PROGRESS[progress].color }} />
                              {PROGRESS[progress].label}
                            </span>
                            {s.pct !== null && <span className="text-[#667085]">{s.pct}%</span>}
                          </div>
                          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[#E9EEEB]">
                            <div className="h-full rounded-full" style={{ width: `${Math.min(s.pct ?? 0, 100)}%`, backgroundColor: PROGRESS[progress].color }} />
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <form onSubmit={addStrategic} className="mt-3 flex flex-wrap items-end gap-2">
            <label className="flex-1 text-xs font-medium text-[#475467]" style={{ minWidth: "14rem" }}>
              New strategic indicator
              <input
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. People reached with health rights training"
                className={`${FIELD} mt-1 w-full`}
              />
            </label>
            <label className="text-xs font-medium text-[#475467]">
              Unit
              <input
                type="text"
                value={form.unit}
                onChange={(e) => setForm({ ...form, unit: e.target.value })}
                placeholder="people"
                className={`${FIELD} mt-1 block w-28`}
              />
            </label>
            <label className="text-xs font-medium text-[#475467]">
              Rolls up by
              <select
                value={form.aggregation}
                onChange={(e) => setForm({ ...form, aggregation: e.target.value })}
                className={`${FIELD} mt-1 block`}
              >
                <option value="sum">Sum</option>
                <option value="average">Average</option>
              </select>
            </label>
            <button type="submit" disabled={busy} className={BTN}>Add</button>
          </form>
        </section>
      )}
    </div>
  );
}

export default PortfolioView;
