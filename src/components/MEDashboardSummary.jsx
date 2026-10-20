import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../meApi";

const MAX_FRAMEWORKS = 3;

/* The reporting period we are in now, if the framework has it */
function currentPeriod(periods) {
  const now = new Date();
  const quarter = `${now.getFullYear()}-Q${Math.floor(now.getMonth() / 3) + 1}`;
  const year = String(now.getFullYear());

  return periods.find((p) => p === quarter) || periods.find((p) => p === year) || periods[0];
}

function summarise(data) {
  const period = currentPeriod(data.framework.periods);

  // Indicators that have a target this period are the ones we expect a report for
  const expected = data.indicators.filter((i) => i.targets?.[period] !== undefined);
  const forPeriod = data.values.filter((v) => v.period === period);

  const reported = expected.filter((i) =>
    forPeriod.some((v) => v.indicatorId === i.id && v.status !== "rejected")
  ).length;

  return {
    id: data.framework.id,
    name: data.framework.name,
    period,
    expected: expected.length,
    reported,
    awaiting: forPeriod.filter((v) => v.status === "submitted").length,
  };
}

function MEDashboardSummary({ isAdmin = false }) {
  const [rows, setRows] = useState(null);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const { frameworks } = await api("/me/frameworks");
        const loaded = await Promise.all(
          frameworks.slice(0, MAX_FRAMEWORKS).map((fw) => api(`/me/frameworks/${fw.id}`))
        );
        if (mounted) setRows(loaded.map(summarise));
      } catch (err) {
        // The dashboard must keep working if the results service is unavailable
        console.error("M&E dashboard summary unavailable:", err);
        if (mounted) setRows(null);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  // Not loaded yet, or the service failed: show nothing
  if (rows === null) return null;
  // Staff with nothing to report on do not need an empty card
  if (rows.length === 0 && !isAdmin) return null;

  return (
    <section aria-label="M&amp;E Dashboard">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2
          className="text-lg font-semibold text-[#07523F]"
          style={{ fontFamily: '"Fraunces", Georgia, serif' }}
        >
          M&amp;E Dashboard
        </h2>
        <Link
          to="/me-dashboard"
          className="rounded px-1 text-sm font-medium text-[#008060] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#008060]"
        >
          Open M&amp;E Dashboard
        </Link>
      </div>

      <div className="rounded-2xl border border-[#E3E9E5] bg-white">
        {rows.length === 0 ? (
          <p className="p-5 text-sm text-[#667085]">
            No frameworks yet. Open the M&amp;E Dashboard to load the sample or create one.
          </p>
        ) : (
          <ul className="divide-y divide-[#EEF1EC]">
            {rows.map((row) => {
              const percent = row.expected ? Math.round((row.reported / row.expected) * 100) : 0;

              return (
                <li key={row.id} className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-4">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-[#14201A]">{row.name}</p>
                    <p className="mt-0.5 text-xs text-[#667085]">
                      {row.period}: {row.reported} of {row.expected} indicators reported
                    </p>
                  </div>

                  <div
                    role="progressbar"
                    aria-label={`${row.name} reporting progress`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={percent}
                    className="h-2 w-40 overflow-hidden rounded-full bg-[#E9EEEB]"
                  >
                    <div className="h-full rounded-full bg-[#008060]" style={{ width: `${percent}%` }} />
                  </div>

                  {isAdmin && row.awaiting > 0 && (
                    <span className="rounded-full bg-[#FFF4E0] px-2.5 py-1 text-xs font-medium text-[#7A4A00]">
                      {row.awaiting} awaiting approval
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

export default MEDashboardSummary;
