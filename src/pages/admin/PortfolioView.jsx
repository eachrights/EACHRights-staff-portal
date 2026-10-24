import { Fragment, useEffect, useMemo, useState } from "react";
import { api } from "../../meApi";
import { LABELS } from "../../labels";

/* Same tokens as the project view */
const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5B3FD0]";
const FIELD = `rounded-lg border border-[#D0D5DD] bg-white px-3 py-2 text-sm text-[#101828] outline-none transition placeholder:text-[#98A2B3] focus:border-[#5B3FD0] focus:ring-4 focus:ring-[#5B3FD0]/15 disabled:cursor-not-allowed disabled:bg-[#F4F5F7]`;
const BTN = `rounded-lg bg-[#5B3FD0] px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-[#4A31B8] disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS}`;
const BTN_SM = `rounded-md border border-[#D0D5DD] bg-white px-3 py-1.5 text-xs font-semibold text-[#344054] transition hover:bg-[#F4F5F7] disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;
const CARD = "rounded-xl border border-[#E5E7EB] bg-white";

/* Words come from labels.js, so they follow the organisation's wording */
const P = LABELS.projectLower;
const PS = LABELS.projectsLower;
const PS_CAP = LABELS.projects;
const AREA = LABELS.programme;

/* Ways initiatives can be grouped. Each reads a field on the record. */
const GROUP_BY = [
  { key: "", label: "No grouping" },
  { key: "theme", label: "Theme" },
  { key: "focusArea", label: "Focus area" },
  { key: "donor", label: "Donor" },
  { key: "partner", label: "Partner" },
  { key: "region", label: "Region" },
  { key: "area", label: AREA },
];
const DETAIL_FIELDS = [
  { key: "donor", label: "Donor" },
  { key: "theme", label: "Theme" },
  { key: "focusArea", label: "Focus area" },
  { key: "partner", label: "Partner" },
  { key: "region", label: "Region" },
];
const NOT_SET = "Not set";

const splitList = (s) => s.split(",").map((v) => v.trim()).filter(Boolean);

const fmtDay = (s) => {
  const t = s ? new Date(s).getTime() : NaN;
  return Number.isNaN(t) ? "" : new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};

const progressOf = (pct) => (pct === null ? "none" : pct >= 90 ? "on" : pct >= 50 ? "risk" : "off");
const PROGRESS = {
  on: { label: "On track", color: "#1F7A5C" },
  risk: { label: "At risk", color: "#D4A600" },
  off: { label: "Off track", color: "#B42318" },
  none: { label: "No data", color: "#D9D9DF" },
};
const fmt = (n) => (n === undefined || n === null ? "-" : Number(n).toLocaleString());

function SectionHead({ title, subtitle }) {
  return (
    <div className="mb-4">
      <h2 className="text-[15px] font-semibold leading-6 text-[#101828]">{title}</h2>
      {subtitle && <p className="text-[13px] leading-5 text-[#667085]">{subtitle}</p>}
    </div>
  );
}

function Progress({ pct }) {
  const key = progressOf(pct ?? null);
  return (
    <div className="w-40">
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 font-medium text-[#344054]">
          <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: PROGRESS[key].color }} />
          {PROGRESS[key].label}
        </span>
        {pct !== null && pct !== undefined && <span className="tabular-nums text-[#667085]">{pct}%</span>}
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[#EEF0F4]" aria-hidden="true">
        <div className="h-full rounded-full" style={{ width: `${Math.min(pct ?? 0, 100)}%`, backgroundColor: PROGRESS[key].color }} />
      </div>
    </div>
  );
}

/* Breakdown of an aggregated result by one disaggregation type (for example sex or age group) */
function Disaggregation({ strategic, type, onType }) {
  const options = strategic.disaggregations ?? [];
  const selectId = `disagg-${strategic.id}`;

  if (options.length === 0) {
    return (
      <p className="mt-4 rounded-lg border border-dashed border-[#D0D5DD] px-4 py-3 text-sm text-[#667085]">
        No approved values with a breakdown yet. Report values with a disaggregation to see them here.
      </p>
    );
  }

  const current = options.find((d) => d.type === type) ?? options[0];
  const total = current.values.reduce((n, v) => n + (Number(v.actual) || 0), 0);
  const uncovered = Math.max((strategic.actual || 0) - total, 0);

  return (
    <div className="mt-4 rounded-lg border border-[#EEF0F4] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold text-[#101828]">Results by disaggregation</p>
        <div className="flex items-center gap-2">
          <label htmlFor={selectId} className="text-xs font-medium text-[#475467]">
            Disaggregate by
          </label>
          <select id={selectId} className={`${FIELD} py-1.5`} value={current.type} onChange={(e) => onType(e.target.value)}>
            {options.map((d) => (
              <option key={d.typeId ?? d.type} value={d.type}>
                {d.type}
              </option>
            ))}
          </select>
        </div>
      </div>

      <table className="mt-3 w-full text-left text-sm">
        <caption className="sr-only">
          {strategic.name} by {current.type}
        </caption>
        <thead>
          <tr className="text-xs font-medium text-[#667085]">
            <th scope="col" className="py-2 pr-3">{current.type}</th>
            <th scope="col" className="px-3 py-2 text-right">Approved</th>
            <th scope="col" className="py-2 pl-3">Share of breakdown</th>
          </tr>
        </thead>
        <tbody>
          {current.values.map((v) => {
            const share = total > 0 ? Math.round(((Number(v.actual) || 0) / total) * 100) : 0;
            return (
              <tr key={v.label} className="border-t border-[#F2F4F7]">
                <td className="py-2 pr-3 text-[#344054]">{v.label}</td>
                <td className="px-3 py-2 text-right tabular-nums text-[#101828]">{fmt(v.actual)}</td>
                <td className="py-2 pl-3">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-28 overflow-hidden rounded-full bg-[#EEF0F4]" aria-hidden="true">
                      <div className="h-full rounded-full bg-[#5B3FD0]" style={{ width: `${share}%` }} />
                    </div>
                    <span className="text-xs tabular-nums text-[#667085]">{share}%</span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {uncovered > 0 && (
        <p className="mt-3 text-xs text-[#667085]">
          This breakdown covers {fmt(total)} of {fmt(strategic.actual)}. The rest comes from approved values reported without a{" "}
          {current.type.toLowerCase()} breakdown.
        </p>
      )}
    </div>
  );
}

function PortfolioView() {
  const [portfolio, setPortfolio] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [open, setOpen] = useState({});
  const [disagg, setDisagg] = useState({});
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const [groupBy, setGroupBy] = useState("");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState({});
  const [typeName, setTypeName] = useState("");
  const [typeCategories, setTypeCategories] = useState("");
  const [editingStrategic, setEditingStrategic] = useState(null);
  const [strategicDraft, setStrategicDraft] = useState({ name: "", unit: "" });
  const [editingType, setEditingType] = useState(null);
  const [typeDraft, setTypeDraft] = useState({ name: "", categories: "" });
  const [linkChoice, setLinkChoice] = useState({});

  const load = async () => setPortfolio(await api("/me/portfolio"));

  const run = async (task, success) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
      if (success) setNotice(success);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    run(load);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  const addStrategic = () =>
    run(async () => {
      await api("/me/strategic", { method: "POST", body: { name, unit } });
      setName("");
      setUnit("");
      await load();
    }, "Strategic indicator added.");

  const toggleSharing = (p) =>
    run(
      async () => {
        await api(`/me/frameworks/${p.id}/sharing`, { method: "PUT", body: { shared: !p.shared } });
        await load();
      },
      p.shared ? `${p.name} is no longer shared. It is left out of strategic indicators.` : `${p.name} is now shared. Its linked indicators count towards strategic indicators.`
    );

  const startEdit = (p) => {
    setEditing(p.id);
    setDraft({
      ...Object.fromEntries(DETAIL_FIELDS.map((f) => [f.key, p[f.key] || ""])),
      startDate: p.startDate || "",
      endDate: p.endDate || "",
      budget: p.budget ?? "",
      currency: p.currency || "",
      countries: (p.countries || []).join(", "),
    });
  };

  const saveDetails = (p) =>
    run(async () => {
      if (draft.startDate && draft.endDate && draft.endDate < draft.startDate) {
        throw new Error("The end date cannot be before the start date.");
      }
      if (draft.budget !== "" && (Number.isNaN(Number(draft.budget)) || Number(draft.budget) < 0)) {
        throw new Error("The budget must be a number, zero or more.");
      }
      await api(`/me/frameworks/${p.id}/details`, {
        method: "PUT",
        body: {
          donor: (draft.donor || "").trim(),
          theme: (draft.theme || "").trim(),
          focusArea: (draft.focusArea || "").trim(),
          partner: (draft.partner || "").trim(),
          region: (draft.region || "").trim(),
          startDate: draft.startDate,
          endDate: draft.endDate,
          budget: draft.budget === "" ? "" : Number(draft.budget),
          currency: (draft.currency || "").trim(),
          countries: splitList(draft.countries || ""),
        },
      });
      setEditing(null);
      await load();
    }, `Details saved for ${p.name}.`);

  const addType = () =>
    run(async () => {
      const categories = typeCategories.split(",").map((c) => c.trim()).filter(Boolean);
      await api("/me/disaggregations", { method: "POST", body: { name: typeName, categories } });
      setTypeName("");
      setTypeCategories("");
      await load();
    }, "Disaggregation type added.");

  const saveStrategic = (s) =>
    run(async () => {
      if (!strategicDraft.name.trim()) throw new Error("Give the strategic indicator a name.");
      await api(`/me/strategic/${s.id}`, { method: "PUT", body: strategicDraft });
      setEditingStrategic(null);
      await load();
    }, "Strategic indicator updated.");

  const deleteStrategic = (s) => {
    const ok = window.confirm(
      `Delete "${s.name}"?\n\nIndicators linked to it are unlinked, not deleted. This cannot be undone.`
    );
    if (!ok) return;
    run(async () => {
      await api(`/me/strategic/${s.id}`, { method: "DELETE" });
      await load();
    }, "Strategic indicator deleted.");
  };

  const linkIndicator = (s) => {
    const choice = linkChoice[s.id];
    if (!choice) return;
    const [frameworkId, indicatorId] = choice.split("|");
    run(async () => {
      await api(`/me/frameworks/${frameworkId}/indicators/${indicatorId}/link`, {
        method: "PUT",
        body: { strategicId: s.id },
      });
      setLinkChoice((cur) => ({ ...cur, [s.id]: "" }));
      await load();
    }, "Indicator linked.");
  };

  const unlinkIndicator = (l) =>
    run(async () => {
      await api(`/me/frameworks/${l.frameworkId}/indicators/${l.indicatorId}/link`, {
        method: "PUT",
        body: { strategicId: "" },
      });
      await load();
    }, "Indicator unlinked.");

  const saveType = (t) =>
    run(async () => {
      const categories = typeDraft.categories.split(",").map((c) => c.trim()).filter(Boolean);
      await api(`/me/disaggregations/${t.id}`, { method: "PUT", body: { name: typeDraft.name, categories } });
      setEditingType(null);
      await load();
    }, "Disaggregation type updated.");

  const deleteType = (t) => {
    const ok = window.confirm(
      `Delete the type "${t.name}"?\n\nBreakdowns already reported by ${t.name} stop appearing in results. This cannot be undone.`
    );
    if (!ok) return;
    run(async () => {
      await api(`/me/disaggregations/${t.id}`, { method: "DELETE" });
      await load();
    }, "Disaggregation type deleted.");
  };

  /* Download the roll-up as CSV: strategic totals first, then the disaggregated results */
  const exportCsv = () => {
    const cell = (v) => {
      let s = v === undefined || v === null ? "" : String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [["Strategic indicator", "Unit", "Approved", "Target to date", "% of target"].map(cell).join(",")];
    strategic.forEach((s) =>
      lines.push([s.name, s.unit, s.actual, s.reportedTarget, s.pct ?? ""].map(cell).join(","))
    );
    lines.push("", ["Strategic indicator", "Disaggregation", "Category", "Approved"].map(cell).join(","));
    strategic.forEach((s) =>
      (s.disaggregations ?? []).forEach((d) =>
        d.values.forEach((v) => lines.push([s.name, d.type, v.label, v.actual].map(cell).join(",")))
      )
    );
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "portfolio-results.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const review = (v, approve) =>
    run(
      async () => {
        await api(`/me/frameworks/${v.frameworkId}/values/review`, {
          method: "POST",
          body: { indicatorId: v.indicatorId, period: v.period, approve },
        });
        await load();
      },
      approve ? `Approved ${v.indicatorName} for ${v.period}.` : `Rejected ${v.indicatorName} for ${v.period}. Staff can report it again.`
    );

  /* Evidence attached to a reported value. Files open through a short-lived link, so they stay private. */
  const openEvidence = (v, item) =>
    run(async () => {
      if (item.type === "link") {
        window.open(item.url, "_blank", "noopener,noreferrer");
        return;
      }
      const tab = window.open("about:blank", "_blank");
      try {
        const { url } = await api(
          `/me/frameworks/${v.frameworkId}/evidence/download-url?key=${encodeURIComponent(item.key)}`
        );
        if (tab) {
          tab.opener = null;
          tab.location.href = url;
        } else {
          window.location.assign(url);
        }
      } catch (err) {
        tab?.close();
        throw err;
      }
    });

  const strategic = portfolio?.strategic ?? [];
  const projects = portfolio?.projects ?? [];
  const types = portfolio?.disaggregationTypes ?? [];
  const pendingValues = portfolio?.pendingValues ?? [];
  const allIndicators = portfolio?.indicators ?? [];
  const linkedCount = strategic.reduce((n, s) => n + s.linked.length, 0);
  const sharedCount = projects.filter((p) => p.shared).length;
  const pendingCount = projects.reduce((n, p) => n + (p.pending || 0), 0);

  /* Existing values for each field, offered as suggestions so spellings stay consistent */
  const suggestions = useMemo(
    () =>
      Object.fromEntries(
        DETAIL_FIELDS.map((f) => [f.key, [...new Set(projects.map((p) => p[f.key]).filter(Boolean))].sort()])
      ),
    [projects]
  );

  /* Filter by text across the classification fields, then group by the chosen one */
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = projects.filter(
      (p) =>
        !q ||
        [p.name, p.donor, p.theme, p.focusArea, p.partner, p.region, p.area].some((v) => String(v ?? "").toLowerCase().includes(q))
    );
    if (!groupBy) return [{ label: null, items: matches }];

    const byLabel = new Map();
    matches.forEach((p) => {
      const label = p[groupBy] || NOT_SET;
      if (!byLabel.has(label)) byLabel.set(label, []);
      byLabel.get(label).push(p);
    });
    return [...byLabel.entries()]
      .sort(([a], [b]) => (a === NOT_SET ? 1 : b === NOT_SET ? -1 : a.localeCompare(b)))
      .map(([label, items]) => {
        const rated = items.filter((p) => p.avgPct !== null && p.avgPct !== undefined);
        const avgPct = rated.length ? Math.round(rated.reduce((n, p) => n + p.avgPct, 0) / rated.length) : null;
        return { label, items, avgPct };
      });
  }, [projects, groupBy, query]);

  const visibleCount = groups.reduce((n, g) => n + g.items.length, 0);
  const groupLabel = GROUP_BY.find((g) => g.key === groupBy)?.label.toLowerCase();

  const projectRows = (p) => (
    <Fragment key={p.id}>
      <tr className="border-t border-[#F2F4F7]">
        <td className="px-6 py-3.5">
          <p className="font-medium text-[#101828]">{p.name}</p>
          <p className="mt-0.5 text-xs text-[#667085]">
            {[p.theme, p.region].filter(Boolean).join(", ") || "No theme or region set"}
          </p>
          {(p.startDate || p.endDate) && (
            <p className="mt-0.5 text-xs text-[#98A2B3]">
              {fmtDay(p.startDate) || "Not set"} to {fmtDay(p.endDate) || "Not set"}
            </p>
          )}
        </td>
        <td className="px-3 py-3.5 text-[#475467]">{p.donor || NOT_SET}</td>
        <td className="px-3 py-3.5 text-right tabular-nums text-[#475467]">{fmt(p.indicators)}</td>
        <td className="px-3 py-3.5 text-right tabular-nums text-[#475467]">
          {fmt(p.approved)} of {fmt(p.expected)}
          {p.pending > 0 && <p className="text-xs text-[#B54708]">{fmt(p.pending)} awaiting approval</p>}
        </td>
        <td className="px-3 py-3.5">
          <Progress pct={p.avgPct} />
        </td>
        <td className="px-6 py-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-xs font-medium ${p.shared ? "text-[#1F7A5C]" : "text-[#667085]"}`}>
              {p.shared ? "Shared" : "Not shared"}
            </span>
            <button
              type="button"
              className={BTN_SM}
              disabled={busy}
              onClick={() => toggleSharing(p)}
              aria-label={`${p.shared ? "Stop sharing" : "Share"} ${p.name} for aggregation`}
            >
              {p.shared ? "Stop sharing" : "Share"}
            </button>
            <button
              type="button"
              className={BTN_SM}
              disabled={busy}
              aria-expanded={editing === p.id}
              onClick={() => (editing === p.id ? setEditing(null) : startEdit(p))}
              aria-label={`Edit details for ${p.name}`}
            >
              {editing === p.id ? "Close" : "Edit details"}
            </button>
          </div>
        </td>
      </tr>
      {editing === p.id && (
        <tr className="bg-[#F9FAFB]">
          <td colSpan={6} className="px-6 py-4">
            <div className="flex flex-wrap items-end gap-3">
              {DETAIL_FIELDS.map((f) => (
                <label key={f.key} className="w-44 text-xs font-medium text-[#475467]">
                  {f.label}
                  <input
                    className={`${FIELD} mt-1 block w-full`}
                    list={`options-${f.key}`}
                    value={draft[f.key] ?? ""}
                    onChange={(e) => setDraft((cur) => ({ ...cur, [f.key]: e.target.value }))}
                  />
                </label>
              ))}
              <label className="w-44 text-xs font-medium text-[#475467]">
                Start date
                <input type="date" className={`${FIELD} mt-1 block w-full`} value={draft.startDate ?? ""} onChange={(e) => setDraft((cur) => ({ ...cur, startDate: e.target.value }))} />
              </label>
              <label className="w-44 text-xs font-medium text-[#475467]">
                End date
                <input type="date" className={`${FIELD} mt-1 block w-full`} value={draft.endDate ?? ""} onChange={(e) => setDraft((cur) => ({ ...cur, endDate: e.target.value }))} />
              </label>
              <label className="w-36 text-xs font-medium text-[#475467]">
                Budget
                <input type="number" min="0" className={`${FIELD} mt-1 block w-full`} value={draft.budget ?? ""} onChange={(e) => setDraft((cur) => ({ ...cur, budget: e.target.value }))} />
              </label>
              <label className="w-24 text-xs font-medium text-[#475467]">
                Currency
                <input className={`${FIELD} mt-1 block w-full`} maxLength={8} placeholder="USD" value={draft.currency ?? ""} onChange={(e) => setDraft((cur) => ({ ...cur, currency: e.target.value }))} />
              </label>
              <label className="w-56 text-xs font-medium text-[#475467]">
                Countries (commas)
                <input className={`${FIELD} mt-1 block w-full`} placeholder="Kenya, Uganda" value={draft.countries ?? ""} onChange={(e) => setDraft((cur) => ({ ...cur, countries: e.target.value }))} />
              </label>
              <button type="button" className={BTN} disabled={busy} onClick={() => saveDetails(p)}>
                Save details
              </button>
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[#101828]">Portfolio</h1>
          <p className="mt-1 text-sm text-[#667085]">
            Approved results from every shared {P}, rolled up through strategic indicators.
          </p>
        </div>
        <button type="button" className={BTN_SM} disabled={strategic.length === 0} onClick={exportCsv}>
          Export results as CSV
        </button>
      </header>

      <div aria-live="polite" className="space-y-2 empty:hidden">
        {error && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
            {error}
          </div>
        )}
        {notice && (
          <div role="status" className="rounded-lg border border-[#BFE3D3] bg-[#EEF8F3] px-4 py-2.5 text-sm text-[#1F7A5C]">
            {notice}
          </div>
        )}
      </div>

      <dl className={`${CARD} grid divide-y divide-[#EEF0F4] sm:grid-cols-5 sm:divide-x sm:divide-y-0`}>
        {[
          ["Strategic indicators", strategic.length],
          [PS_CAP, projects.length],
          [`Shared ${PS}`, sharedCount],
          ["Linked indicators", linkedCount],
          ["Awaiting approval", pendingCount],
        ].map(([label, value]) => (
          <div key={label} className="p-5">
            <dt className="text-[13px] font-medium text-[#667085]">{label}</dt>
            <dd className="mt-1 text-[28px] font-semibold leading-9 tracking-tight tabular-nums text-[#101828]">{fmt(value)}</dd>
          </div>
        ))}
      </dl>

      <section aria-label="Awaiting approval" className={`${CARD} overflow-hidden`}>
        <div className="px-6 pt-6">
          <SectionHead
            title="Awaiting approval"
            subtitle="Values staff have reported, with the evidence they attached. Open the evidence before you decide. Approving a value locks it and adds it to the results. Rejecting it lets staff report it again."
          />
        </div>
        {pendingValues.length === 0 ? (
          <p className="px-6 pb-8 text-center text-sm text-[#667085]">Nothing is waiting for approval.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <caption className="sr-only">Reported values awaiting approval</caption>
              <thead>
                <tr className="text-xs font-medium text-[#667085]">
                  <th scope="col" className="border-y border-[#E5E7EB] bg-[#F9FAFB] px-6 py-3">{LABELS.project} and indicator</th>
                  <th scope="col" className="border-y border-[#E5E7EB] bg-[#F9FAFB] px-3 py-3">Period</th>
                  <th scope="col" className="border-y border-[#E5E7EB] bg-[#F9FAFB] px-3 py-3 text-right">Reported</th>
                  <th scope="col" className="border-y border-[#E5E7EB] bg-[#F9FAFB] px-3 py-3 text-right">Target</th>
                  <th scope="col" className="border-y border-[#E5E7EB] bg-[#F9FAFB] px-3 py-3">Comment and evidence</th>
                  <th scope="col" className="border-y border-[#E5E7EB] bg-[#F9FAFB] px-6 py-3">Decision</th>
                </tr>
              </thead>
              <tbody>
                {pendingValues.map((v) => (
                  <tr key={`${v.frameworkId}-${v.indicatorId}-${v.period}`} className="border-t border-[#F2F4F7]">
                    <td className="px-6 py-3.5">
                      <p className="font-medium text-[#101828]">{v.indicatorName}</p>
                      <p className="mt-0.5 text-xs text-[#667085]">
                        {v.frameworkName}
                        {v.submittedBy ? `, reported by ${v.submittedBy}` : ""}
                      </p>
                    </td>
                    <td className="px-3 py-3.5 text-[#475467]">{v.period}</td>
                    <td className="px-3 py-3.5 text-right tabular-nums text-[#101828]">
                      {fmt(v.actual)} {v.unit && <span className="text-xs text-[#667085]">{v.unit}</span>}
                    </td>
                    <td className="px-3 py-3.5 text-right tabular-nums text-[#475467]">{fmt(v.target)}</td>
                    <td className="max-w-[280px] px-3 py-3.5 text-[#475467]">
                      <p>{v.comment || "No comment"}</p>
                      {(v.evidence ?? []).length > 0 ? (
                        <ul className="mt-2 space-y-1">
                          {v.evidence.map((e, i) => (
                            <li key={`${e.type}-${e.key || e.url}-${i}`} className="flex items-center gap-1.5">
                              <span className="rounded bg-[#F2F4F7] px-1.5 py-0.5 text-[11px] font-medium text-[#475467]">
                                {e.type === "file" ? "File" : "Link"}
                              </span>
                              <button
                                type="button"
                                className="min-w-0 truncate text-left text-xs font-medium text-[#00664E] hover:underline"
                                title={e.name}
                                onClick={() => openEvidence(v, e)}
                              >
                                {e.name}
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-1 text-xs text-[#98A2B3]">No evidence attached</p>
                      )}
                    </td>
                    <td className="px-6 py-3.5">
                      <div className="flex items-center gap-2">
                        <button type="button" className={BTN} disabled={busy} onClick={() => review(v, true)}
                          aria-label={`Approve ${v.indicatorName} for ${v.period}`}>
                          Approve
                        </button>
                        <button type="button" className={BTN_SM} disabled={busy} onClick={() => review(v, false)}
                          aria-label={`Reject ${v.indicatorName} for ${v.period}`}>
                          Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-label="Strategic indicators" className={`${CARD} p-6`}>
        <SectionHead
          title="Strategic indicators"
          subtitle={`Values are added together across shared ${PS}, so this suits countable indicators such as people reached. Share an ${P} below, then link its indicators.`}
        />

        <div className="mb-5 flex flex-wrap items-end gap-2">
          <label className="grow text-xs font-medium text-[#475467]">
            Name
            <input
              className={`${FIELD} mt-1 block w-full`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="For example, People reached with rights education"
            />
          </label>
          <label className="w-40 text-xs font-medium text-[#475467]">
            Unit
            <input
              className={`${FIELD} mt-1 block w-full`}
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="people"
            />
          </label>
          <button type="button" className={BTN} disabled={busy || !name.trim()} onClick={addStrategic}>
            Add indicator
          </button>
        </div>

        {strategic.length === 0 ? (
          <p className="rounded-lg border border-dashed border-[#D0D5DD] px-6 py-10 text-center text-sm text-[#667085]">
            No strategic indicators yet. Add one above, then link indicators to it.
          </p>
        ) : (
          <ul className="divide-y divide-[#F2F4F7] border-t border-[#F2F4F7]">
            {strategic.map((s) => {
              const expanded = Boolean(open[s.id]);
              return (
                <li key={s.id} className="py-4">
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                    <div className="min-w-0 grow basis-64">
                      {editingStrategic === s.id ? (
                        <div className="flex flex-wrap gap-2">
                          <input
                            className={`${FIELD} grow`}
                            aria-label="Strategic indicator name"
                            value={strategicDraft.name}
                            onChange={(e) => setStrategicDraft((d) => ({ ...d, name: e.target.value }))}
                          />
                          <input
                            className={`${FIELD} w-32`}
                            aria-label="Unit"
                            placeholder="Unit"
                            value={strategicDraft.unit}
                            onChange={(e) => setStrategicDraft((d) => ({ ...d, unit: e.target.value }))}
                          />
                        </div>
                      ) : (
                        <>
                          <p className="font-medium text-[#101828]">{s.name}</p>
                          <p className="mt-0.5 text-xs text-[#667085]">
                            {s.unit ? `${s.unit}. ` : ""}
                            {s.linked.length} linked {s.linked.length === 1 ? "indicator" : "indicators"}
                          </p>
                        </>
                      )}
                    </div>

                    <div className="text-right text-sm tabular-nums">
                      <p className="font-semibold text-[#101828]">
                        {fmt(s.actual)} <span className="font-normal text-[#667085]">of {fmt(s.reportedTarget)}</span>
                      </p>
                      <p className="text-xs text-[#667085]">approved, against targets to date</p>
                    </div>

                    <Progress pct={s.pct} />

                    <div className="flex flex-wrap items-center gap-2">
                      {editingStrategic === s.id ? (
                        <>
                          <button type="button" className={BTN_SM} disabled={busy} onClick={() => saveStrategic(s)}>
                            Save
                          </button>
                          <button type="button" className={BTN_SM} onClick={() => setEditingStrategic(null)}>
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => setOpen((cur) => ({ ...cur, [s.id]: !expanded }))}
                            aria-expanded={expanded}
                            className={BTN_SM}
                          >
                            {expanded ? "Hide detail" : "Link and detail"}
                          </button>
                          <button
                            type="button"
                            className={BTN_SM}
                            disabled={busy}
                            aria-label={`Edit ${s.name}`}
                            onClick={() => {
                              setEditingStrategic(s.id);
                              setStrategicDraft({ name: s.name, unit: s.unit || "" });
                            }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="rounded-md border border-[#FDA29B] bg-white px-3 py-1.5 text-xs font-semibold text-[#B42318] transition hover:bg-[#FEF3F2] disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={busy}
                            aria-label={`Delete ${s.name}`}
                            onClick={() => deleteStrategic(s)}
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {expanded && (
                    <>
                      <div className="mt-4 flex flex-wrap items-end gap-2">
                        <label className="grow basis-64 text-xs font-medium text-[#475467]">
                          Link an indicator
                          <select
                            className={`${FIELD} mt-1 block w-full`}
                            value={linkChoice[s.id] ?? ""}
                            onChange={(e) => setLinkChoice((cur) => ({ ...cur, [s.id]: e.target.value }))}
                          >
                            <option value="">Choose an indicator from a shared {P}</option>
                            {projects
                              .filter((p) => p.shared)
                              .map((p) => {
                                const options = allIndicators.filter((i) => i.frameworkId === p.id && !i.strategicId);
                                if (options.length === 0) return null;
                                return (
                                  <optgroup key={p.id} label={p.name}>
                                    {options.map((i) => (
                                      <option key={i.id} value={`${i.frameworkId}|${i.id}`}>
                                        {i.name}
                                        {i.unit ? ` (${i.unit})` : ""}
                                      </option>
                                    ))}
                                  </optgroup>
                                );
                              })}
                          </select>
                        </label>
                        <button
                          type="button"
                          className={BTN}
                          disabled={busy || !linkChoice[s.id]}
                          onClick={() => linkIndicator(s)}
                        >
                          Link indicator
                        </button>
                      </div>
                      <p className="mt-1 text-xs text-[#667085]">
                        Only indicators from shared {PS} that are not linked yet are listed.
                      </p>

                      <div className="mt-4 overflow-x-auto rounded-lg border border-[#EEF0F4]">
                        <table className="w-full min-w-[640px] text-left text-sm">
                          <caption className="sr-only">Indicators linked to {s.name}</caption>
                          <thead>
                            <tr className="bg-[#F9FAFB] text-xs font-medium text-[#667085]">
                              <th scope="col" className="px-4 py-2.5">{LABELS.project}</th>
                              <th scope="col" className="px-3 py-2.5">Indicator</th>
                              <th scope="col" className="px-3 py-2.5 text-right">Approved</th>
                              <th scope="col" className="px-4 py-2.5 text-right">Target to date</th>
                              <th scope="col" className="px-4 py-2.5"><span className="sr-only">Actions</span></th>
                            </tr>
                          </thead>
                          <tbody>
                            {s.linked.map((l) => (
                              <tr key={l.indicatorId} className="border-t border-[#F2F4F7]">
                                <td className="px-4 py-2.5 text-[#344054]">{l.frameworkName}</td>
                                <td className="px-3 py-2.5 text-[#475467]">{l.indicatorName}</td>
                                <td className="px-3 py-2.5 text-right tabular-nums text-[#101828]">{fmt(l.actual)}</td>
                                <td className="px-4 py-2.5 text-right tabular-nums text-[#475467]">{fmt(l.reportedTarget)}</td>
                                <td className="px-4 py-2.5 text-right">
                                  <button
                                    type="button"
                                    className={BTN_SM}
                                    disabled={busy}
                                    aria-label={`Unlink ${l.indicatorName}`}
                                    onClick={() => unlinkIndicator(l)}
                                  >
                                    Unlink
                                  </button>
                                </td>
                              </tr>
                            ))}
                            {s.linked.length === 0 && (
                              <tr>
                                <td colSpan={5} className="px-4 py-6 text-center text-sm text-[#667085]">
                                  Nothing linked yet. Pick an indicator above.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>

                      <Disaggregation
                        strategic={s}
                        type={disagg[s.id]}
                        onType={(type) => setDisagg((cur) => ({ ...cur, [s.id]: type }))}
                      />
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-label="Disaggregation types" className={`${CARD} p-6`}>
        <SectionHead
          title="Disaggregation types"
          subtitle="Define how results can be broken down, such as gender or age group. Staff then report a value split across these categories, and each split must add up to the value. The actual value fills in from the first breakdown they complete."
        />

        <div className="mb-5 flex flex-wrap items-end gap-2">
          <label className="w-48 text-xs font-medium text-[#475467]">
            Type
            <input
              className={`${FIELD} mt-1 block w-full`}
              value={typeName}
              onChange={(e) => setTypeName(e.target.value)}
              placeholder="Gender"
            />
          </label>
          <label className="grow text-xs font-medium text-[#475467]">
            Categories, separated by commas
            <input
              className={`${FIELD} mt-1 block w-full`}
              value={typeCategories}
              onChange={(e) => setTypeCategories(e.target.value)}
              placeholder="Type the categories, separated by commas"
            />
          </label>
          <button
            type="button"
            className={BTN}
            disabled={busy || !typeName.trim() || typeCategories.split(",").filter((c) => c.trim()).length < 2}
            onClick={addType}
          >
            Add type
          </button>
        </div>

        {types.length === 0 ? (
          <p className="rounded-lg border border-dashed border-[#D0D5DD] px-6 py-8 text-center text-sm text-[#667085]">
            No disaggregation types yet. Add one above with at least two categories.
          </p>
        ) : (
          <ul className="divide-y divide-[#F2F4F7] border-t border-[#F2F4F7]">
            {types.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                {editingType === t.id ? (
                  <>
                    <input
                      className={`${FIELD} w-48`}
                      aria-label="Type name"
                      value={typeDraft.name}
                      onChange={(e) => setTypeDraft((d) => ({ ...d, name: e.target.value }))}
                    />
                    <input
                      className={`${FIELD} grow basis-64`}
                      aria-label="Categories, separated by commas"
                      value={typeDraft.categories}
                      onChange={(e) => setTypeDraft((d) => ({ ...d, categories: e.target.value }))}
                    />
                    <button type="button" className={BTN_SM} disabled={busy} onClick={() => saveType(t)}>
                      Save
                    </button>
                    <button type="button" className={BTN_SM} onClick={() => setEditingType(null)}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <span className="w-48 font-medium text-[#101828]">{t.name}</span>
                    <span className="grow basis-64 text-sm text-[#475467]">{t.categories.join(", ")}</span>
                    <button
                      type="button"
                      className={BTN_SM}
                      disabled={busy}
                      aria-label={`Edit ${t.name}`}
                      onClick={() => {
                        setEditingType(t.id);
                        setTypeDraft({ name: t.name, categories: t.categories.join(", ") });
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-[#FDA29B] bg-white px-3 py-1.5 text-xs font-semibold text-[#B42318] transition hover:bg-[#FEF3F2] disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={busy}
                      aria-label={`Delete ${t.name}`}
                      onClick={() => deleteType(t)}
                    >
                      Delete
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label={PS_CAP} className={`${CARD} overflow-hidden`}>
        <div className="px-6 pt-6">
          <SectionHead
            title={PS_CAP}
            subtitle={`Group ${PS} by theme, focus area, donor, partner, region or ${AREA.toLowerCase()}. Only shared ${PS} count towards strategic indicators.`}
          />
          <div className="mb-5 flex flex-wrap items-end gap-2">
            <label className="grow basis-56 text-xs font-medium text-[#475467]">
              Filter {PS}
              <input
                type="search"
                className={`${FIELD} mt-1 block w-full`}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name, donor, theme, partner or region"
              />
            </label>
            <label className="w-44 text-xs font-medium text-[#475467]">
              Group by
              <select className={`${FIELD} mt-1 block w-full`} value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
                {GROUP_BY.map((g) => (
                  <option key={g.key} value={g.key}>
                    {g.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {DETAIL_FIELDS.map((f) => (
          <datalist key={f.key} id={`options-${f.key}`}>
            {suggestions[f.key]?.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        ))}

        {projects.length === 0 ? (
          <p className="px-6 pb-10 text-center text-sm text-[#667085]">No {PS} yet.</p>
        ) : visibleCount === 0 ? (
          <p className="px-6 pb-10 text-center text-sm text-[#667085]">No {PS} match “{query}”. Clear the filter to see all {PS}.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-left text-sm">
              <caption className="sr-only">Reporting progress by {P}</caption>
              <thead>
                <tr className="text-xs font-medium text-[#667085]">
                  <th scope="col" className="border-y border-[#E5E7EB] bg-[#F9FAFB] px-6 py-3">{LABELS.project}</th>
                  <th scope="col" className="border-y border-[#E5E7EB] bg-[#F9FAFB] px-3 py-3">Donor</th>
                  <th scope="col" className="border-y border-[#E5E7EB] bg-[#F9FAFB] px-3 py-3 text-right">Indicators</th>
                  <th scope="col" className="border-y border-[#E5E7EB] bg-[#F9FAFB] px-3 py-3 text-right">Approved values</th>
                  <th scope="col" className="border-y border-[#E5E7EB] bg-[#F9FAFB] px-3 py-3">Average achievement</th>
                  <th scope="col" className="border-y border-[#E5E7EB] bg-[#F9FAFB] px-6 py-3">Sharing and details</th>
                </tr>
              </thead>
              {groups.map((g) => (
                <tbody key={g.label ?? "all"}>
                  {g.label !== null && (
                    <tr className="bg-[#F9FAFB]">
                      <th scope="colgroup" colSpan={6} className="border-b border-[#EEF0F4] px-6 py-3 text-left font-normal">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <span className="text-sm font-semibold text-[#101828]">
                            {g.label}
                            <span className="ml-2 text-xs font-normal text-[#667085]">
                              {g.items.length} {g.items.length === 1 ? P : PS} by {groupLabel}
                            </span>
                          </span>
                          <Progress pct={g.avgPct} />
                        </div>
                      </th>
                    </tr>
                  )}
                  {g.items.map(projectRows)}
                </tbody>
              ))}
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export default PortfolioView;
