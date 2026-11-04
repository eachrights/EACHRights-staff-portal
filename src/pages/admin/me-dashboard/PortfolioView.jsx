import { Fragment, useEffect, useMemo, useState } from "react";
import { api } from "../../../meApi";
import { LABELS } from "../../../labels";
import FundRequests from "./FundRequests";

/* ---------- Tokens ---------- */
const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5B3FD0]";
const FIELD = `rounded-lg border border-[#D0D5DD] bg-white px-3 py-2 text-sm text-[#101828] outline-none transition placeholder:text-[#98A2B3] focus:border-[#5B3FD0] focus:ring-4 focus:ring-[#5B3FD0]/15 disabled:cursor-not-allowed disabled:bg-[#F4F5F7]`;
const BTN = `rounded-lg bg-[#5B3FD0] px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-[#4A31B8] disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS}`;
const BTN_SM = `rounded-md border border-[#D0D5DD] bg-white px-3 py-1.5 text-xs font-semibold text-[#344054] transition hover:bg-[#F4F5F7] disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;
const BTN_DANGER = `rounded-md border border-[#FDA29B] bg-white px-3 py-1.5 text-xs font-semibold text-[#B42318] transition hover:bg-[#FEF3F2] disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;
const PANEL = "rounded-xl border border-[#E5E7EB] bg-white";
const LABEL = "text-xs font-medium text-[#475467]";

const P = LABELS.projectLower;
const PS = LABELS.projectsLower;
const PS_CAP = LABELS.projects;
const AREA = LABELS.programme;

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
const fmt = (n) => (n === undefined || n === null ? "-" : Number(n).toLocaleString());
const fmtDay = (s) => {
  const t = s ? new Date(s).getTime() : NaN;
  return Number.isNaN(t) ? "" : new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};

const progressOf = (pct) => (pct === null ? "none" : pct >= 90 ? "on" : pct >= 50 ? "risk" : "off");
const PROGRESS = {
  on: { label: "On track", color: "#1F7A5C" },
  risk: { label: "At risk", color: "#D4A600" },
  off: { label: "Off track", color: "#B42318" },
  none: { label: "No data", color: "#D0D5DD" },
};
const OUTLOOK = { on: "On course", risk: "At risk", off: "Unlikely to meet target", none: "No data yet" };

/* ---------- Small pieces ---------- */
function Bar({ pct, className = "h-2" }) {
  const key = progressOf(pct ?? null);
  return (
    <div className={`overflow-hidden rounded-full bg-[#EEF0F4] ${className}`} aria-hidden="true">
      <div className="h-full rounded-full" style={{ width: `${Math.min(pct ?? 0, 100)}%`, backgroundColor: PROGRESS[key].color }} />
    </div>
  );
}

function Progress({ pct, label }) {
  const key = progressOf(pct ?? null);
  return (
    <div className="w-36">
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 font-medium text-[#344054]">
          <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: PROGRESS[key].color }} />
          {label ?? PROGRESS[key].label}
        </span>
        {pct !== null && pct !== undefined && <span className="tabular-nums text-[#667085]">{pct}%</span>}
      </div>
      <Bar pct={pct} />
    </div>
  );
}

function Heading({ title, hint, children }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-[#101828]">{title}</h2>
        {hint && <p className="mt-0.5 max-w-2xl text-sm text-[#667085]">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function Empty({ children }) {
  return <p className="rounded-xl border border-dashed border-[#D0D5DD] px-6 py-10 text-center text-sm text-[#667085]">{children}</p>;
}

function Switch({ checked, onChange, disabled, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 ${FOCUS} ${checked ? "bg-[#5B3FD0]" : "bg-[#D0D5DD]"}`}
    >
      <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-5" : ""}`} />
    </button>
  );
}

function Disaggregation({ strategic, type, onType }) {
  const options = strategic.disaggregations ?? [];
  const selectId = `disagg-${strategic.id}`;
  if (options.length === 0) {
    return <p className="text-sm text-[#667085]">No approved values with a breakdown yet. Report values with a disaggregation to see them here.</p>;
  }
  const current = options.find((d) => d.type === type) ?? options[0];
  const total = current.values.reduce((n, v) => n + (Number(v.actual) || 0), 0);
  const uncovered = Math.max((strategic.actual || 0) - total, 0);
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold text-[#101828]">Results by {current.type.toLowerCase()}</p>
        <div className="flex items-center gap-2">
          <label htmlFor={selectId} className={LABEL}>Break down by</label>
          <select id={selectId} className={`${FIELD} py-1.5`} value={current.type} onChange={(e) => onType(e.target.value)}>
            {options.map((d) => <option key={d.typeId ?? d.type} value={d.type}>{d.type}</option>)}
          </select>
        </div>
      </div>
      <ul className="space-y-2.5">
        {current.values.map((v) => {
          const share = total > 0 ? Math.round(((Number(v.actual) || 0) / total) * 100) : 0;
          return (
            <li key={v.label} className="grid grid-cols-[8rem_1fr_6rem] items-center gap-3 text-sm">
              <span className="truncate text-[#344054]" title={v.label}>{v.label}</span>
              <div className="h-2 overflow-hidden rounded-full bg-[#EEF0F4]" aria-hidden="true">
                <div className="h-full rounded-full bg-[#5B3FD0]" style={{ width: `${share}%` }} />
              </div>
              <span className="text-right tabular-nums text-[#101828]">{fmt(v.actual)} <span className="text-xs text-[#667085]">{share}%</span></span>
            </li>
          );
        })}
      </ul>
      {uncovered > 0 && (
        <p className="mt-3 text-xs text-[#667085]">
          This covers {fmt(total)} of {fmt(strategic.actual)}. The rest was reported without a {current.type.toLowerCase()} breakdown.
        </p>
      )}
    </div>
  );
}

/* ---------- Page ---------- */
function PortfolioView() {
  const [portfolio, setPortfolio] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState("overview");
  const [open, setOpen] = useState({});
  const [disagg, setDisagg] = useState({});
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const [groupBy, setGroupBy] = useState("");
  const [query, setQuery] = useState("");
  const [shareFilter, setShareFilter] = useState("all");
  const [editing, setEditing] = useState(null);
  const [fundsOpen, setFundsOpen] = useState(null);
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

  /* ----- Actions (unchanged behaviour) ----- */
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
    setFundsOpen(null);
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
      if (draft.startDate && draft.endDate && draft.endDate < draft.startDate) throw new Error("The end date cannot be before the start date.");
      if (draft.budget !== "" && (Number.isNaN(Number(draft.budget)) || Number(draft.budget) < 0)) throw new Error("The budget must be a number, zero or more.");
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
      await api("/me/disaggregations", { method: "POST", body: { name: typeName, categories: splitList(typeCategories) } });
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
    if (!window.confirm(`Delete "${s.name}"?\n\nIndicators linked to it are unlinked, not deleted. This cannot be undone.`)) return;
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
      await api(`/me/frameworks/${frameworkId}/indicators/${indicatorId}/link`, { method: "PUT", body: { strategicId: s.id } });
      setLinkChoice((cur) => ({ ...cur, [s.id]: "" }));
      await load();
    }, "Indicator linked.");
  };

  const unlinkIndicator = (l) =>
    run(async () => {
      await api(`/me/frameworks/${l.frameworkId}/indicators/${l.indicatorId}/link`, { method: "PUT", body: { strategicId: "" } });
      await load();
    }, "Indicator unlinked.");

  const saveType = (t) =>
    run(async () => {
      await api(`/me/disaggregations/${t.id}`, { method: "PUT", body: { name: typeDraft.name, categories: splitList(typeDraft.categories) } });
      setEditingType(null);
      await load();
    }, "Disaggregation type updated.");

  const deleteType = (t) => {
    if (!window.confirm(`Delete the type "${t.name}"?\n\nBreakdowns already reported by ${t.name} stop appearing in results. This cannot be undone.`)) return;
    run(async () => {
      await api(`/me/disaggregations/${t.id}`, { method: "DELETE" });
      await load();
    }, "Disaggregation type deleted.");
  };

  const exportCsv = () => {
    const cell = (v) => {
      let s = v === undefined || v === null ? "" : String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [["Strategic indicator", "Unit", "Approved", "Target to date", "% of target"].map(cell).join(",")];
    strategic.forEach((s) => lines.push([s.name, s.unit, s.actual, s.reportedTarget, s.pct ?? ""].map(cell).join(",")));
    lines.push("", ["Strategic indicator", "Disaggregation", "Category", "Approved"].map(cell).join(","));
    strategic.forEach((s) =>
      (s.disaggregations ?? []).forEach((d) => d.values.forEach((v) => lines.push([s.name, d.type, v.label, v.actual].map(cell).join(","))))
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

  const openEvidence = (v, item) =>
    run(async () => {
      if (item.type === "link") {
        window.open(item.url, "_blank", "noopener,noreferrer");
        return;
      }
      const tab = window.open("about:blank", "_blank");
      try {
        const { url } = await api(`/me/frameworks/${v.frameworkId}/evidence/download-url?key=${encodeURIComponent(item.key)}`);
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

  /* ----- Derived data ----- */
  const strategic = portfolio?.strategic ?? [];
  const projects = portfolio?.projects ?? [];
  const types = portfolio?.disaggregationTypes ?? [];
  const pendingValues = portfolio?.pendingValues ?? [];
  const allIndicators = portfolio?.indicators ?? [];
  const sharedCount = projects.filter((p) => p.shared).length;

  const outlookRows = useMemo(
    () =>
      projects
        .filter((p) => (p.outlook?.total ?? 0) > 0)
        .sort((a, b) => (a.projectedPct ?? 999) - (b.projectedPct ?? 999) || a.name.localeCompare(b.name)),
    [projects]
  );
  const ratedProjects = outlookRows.filter((p) => p.projectedPct !== null && p.projectedPct !== undefined);
  const portfolioPct = ratedProjects.length ? Math.round(ratedProjects.reduce((n, p) => n + p.projectedPct, 0) / ratedProjects.length) : null;
  const outlookCounts = Object.fromEntries(
    ["on", "risk", "off", "none"].map((k) => [k, outlookRows.filter((p) => progressOf(p.projectedPct ?? null) === k).length])
  );

  const suggestions = useMemo(
    () => Object.fromEntries(DETAIL_FIELDS.map((f) => [f.key, [...new Set(projects.map((p) => p[f.key]).filter(Boolean))].sort()])),
    [projects]
  );

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = projects.filter(
      (p) =>
        (shareFilter === "all" || (shareFilter === "shared") === Boolean(p.shared)) &&
        (!q || [p.name, p.donor, p.theme, p.focusArea, p.partner, p.region, p.area].some((v) => String(v ?? "").toLowerCase().includes(q)))
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
        return { label, items, avgPct: rated.length ? Math.round(rated.reduce((n, p) => n + p.avgPct, 0) / rated.length) : null };
      });
  }, [projects, groupBy, query, shareFilter]);

  const visibleCount = groups.reduce((n, g) => n + g.items.length, 0);
  const groupLabel = GROUP_BY.find((g) => g.key === groupBy)?.label.toLowerCase();

  const TABS = [
    { id: "overview", label: "Overview" },
    { id: "approvals", label: "Approvals", count: pendingValues.length, alert: pendingValues.length > 0 },
    { id: "projects", label: PS_CAP, count: projects.length },
    { id: "strategic", label: "Strategic indicators", count: strategic.length },
    { id: "breakdowns", label: "Breakdowns", count: types.length },
  ];

  /* ----- Sections ----- */
  const overview = (
    <div className="space-y-8">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className={`${PANEL} p-6`}>
          <p className="text-sm font-medium text-[#667085]">Where the portfolio is heading</p>
          <div className="mt-2 flex items-baseline gap-3">
            <span className="text-5xl font-semibold tracking-tight tabular-nums text-[#101828]">{portfolioPct === null ? "-" : `${portfolioPct}%`}</span>
            <span className="text-sm text-[#667085]">of targets by the final quarter</span>
          </div>
          {outlookRows.length > 0 && (
            <>
              <div className="mt-5 flex h-3 gap-0.5 overflow-hidden rounded-full" role="img"
                aria-label={Object.keys(outlookCounts).map((k) => `${OUTLOOK[k]}: ${outlookCounts[k]}`).join(", ")}>
                {["on", "risk", "off", "none"].map((k) =>
                  outlookCounts[k] > 0 ? <div key={k} style={{ flex: outlookCounts[k], backgroundColor: PROGRESS[k].color }} /> : null
                )}
              </div>
              <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-[#475467]">
                {["on", "risk", "off", "none"].map((k) => (
                  <li key={k} className="flex items-center gap-1.5">
                    <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: PROGRESS[k].color }} />
                    <span className="font-semibold tabular-nums text-[#101828]">{outlookCounts[k]}</span> {OUTLOOK[k].toLowerCase()}
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="mt-4 text-sm text-[#667085]">
            {portfolioPct === null
              ? `No ${P} has approved data yet, so the portfolio cannot be projected.`
              : `Based on ${ratedProjects.length} of ${outlookRows.length} ${outlookRows.length === 1 ? P : PS} with approved data.`}
          </p>
        </div>

        <div className={`${PANEL} divide-y divide-[#EEF0F4]`}>
          {[
            { label: "Awaiting approval", value: pendingValues.length, go: "approvals", warn: pendingValues.length > 0 },
            { label: `Shared ${PS}`, value: `${sharedCount} of ${projects.length}`, go: "projects", share: "shared" },
            { label: "Strategic indicators", value: strategic.length, go: "strategic" },
            { label: "Linked indicators", value: strategic.reduce((n, s) => n + s.linked.length, 0), go: "strategic" },
          ].map((r) => (
            <button
              key={r.label}
              type="button"
              onClick={() => { if (r.share) setShareFilter(r.share); setTab(r.go); }}
              className={`flex w-full items-center justify-between px-5 py-3.5 text-left transition hover:bg-[#F9FAFB] first:rounded-t-xl last:rounded-b-xl focus-visible:-outline-offset-2 ${FOCUS}`}
            >
              <span className="text-sm text-[#475467]">{r.label}</span>
              <span className={`text-base font-semibold tabular-nums ${r.warn ? "text-[#93370D]" : "text-[#101828]"}`}>{typeof r.value === "number" ? fmt(r.value) : r.value}</span>
            </button>
          ))}
        </div>
      </div>

      <section aria-label="Project outlook">
        <Heading title="Project outlook" hint={`The ${PS} least likely to meet their targets come first.`} />
        {outlookRows.length === 0 ? (
          <Empty>No {PS} have indicators with quarterly targets yet.</Empty>
        ) : (
          <ul className={`${PANEL} divide-y divide-[#EEF0F4]`}>
            {outlookRows.map((p) => {
              const key = progressOf(p.projectedPct ?? null);
              const o = p.outlook;
              return (
                <li key={p.id} className="grid items-center gap-x-6 gap-y-2 px-5 py-4 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto]">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-[#101828]">{p.name}</p>
                    <p className="mt-0.5 text-xs text-[#667085]">
                      {p.donor || NOT_SET}
                      {p.endDate ? `, ends ${fmtDay(p.endDate)}` : ""}
                      {!p.shared && <span className="ml-2 rounded bg-[#F2F4F7] px-1.5 py-0.5 text-[11px] font-medium text-[#475467]">Not shared</span>}
                    </p>
                  </div>
                  <div>
                    <div className="mb-1.5 flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5 font-medium text-[#344054]">
                        <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: PROGRESS[key].color }} />
                        {OUTLOOK[key]}
                      </span>
                      <span className="font-semibold tabular-nums text-[#101828]">{p.projectedPct ?? "-"}{p.projectedPct != null && "%"}</span>
                    </div>
                    <Bar pct={p.projectedPct} />
                  </div>
                  <p className="text-xs text-[#667085] md:w-40 md:text-right">
                    {[o.on > 0 && `${o.on} on course`, o.risk > 0 && `${o.risk} at risk`, o.off > 0 && `${o.off} unlikely`, o.none > 0 && `${o.none} no data`].filter(Boolean).join(", ")}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
        <details className="mt-3 text-xs text-[#667085]">
          <summary className={`cursor-pointer font-medium text-[#475467] ${FOCUS}`}>How the outlook is worked out</summary>
          <p className="mt-2 max-w-3xl leading-5">
            Each {P}'s outlook averages its indicators' projected percentage of target, capped at 100% per indicator so over-achieving on one does not hide a shortfall on another. It uses the same method as the Predictions page: approved results so far, plus each remaining quarterly target at the pace reached so far. Values awaiting approval are not counted. It assumes higher is better and is a guide, not a promise.
          </p>
        </details>
      </section>
    </div>
  );

  const approvals = (
    <section aria-label="Awaiting approval">
      <Heading
        title="Awaiting approval"
        hint="Open the evidence before you decide. A value cannot be approved without evidence. Approving locks the value and adds it to the results. Rejecting lets staff report it again."
      />
      {pendingValues.length === 0 ? (
        <Empty>Nothing is waiting for approval.</Empty>
      ) : (
        <ul className="space-y-3">
          {pendingValues.map((v) => {
            const evidence = v.evidence ?? [];
            const hasEvidence = evidence.length > 0;
            return (
              <li key={`${v.frameworkId}-${v.indicatorId}-${v.period}`} className={`${PANEL} grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_auto]`}>
                <div className="min-w-0 space-y-3">
                  <div>
                    <p className="font-semibold text-[#101828]">
                      {v.indicatorName}
                      {v.correction && <span className="ml-2 rounded-full bg-[#FBF3D0] px-2 py-0.5 align-middle text-[11px] font-semibold text-[#7A5C00]">Correction</span>}
                    </p>
                    <p className="mt-0.5 text-sm text-[#667085]">
                      {v.frameworkName}, {v.period}{v.submittedBy ? `. Reported by ${v.submittedBy}` : ""}
                    </p>
                  </div>
                  <p className="text-sm text-[#475467]">
                    <span className="text-xl font-semibold tabular-nums text-[#101828]">{fmt(v.actual)}</span>
                    {v.unit && <span className="ml-1">{v.unit}</span>}
                    <span className="ml-2 text-[#667085]">against a target of {fmt(v.target)}</span>
                  </p>
                  {v.comment && <p className="text-sm text-[#475467]">{v.comment}</p>}
                  {v.correction && (
                    <div className="rounded-lg border border-[#F3D18A] bg-[#FFFAEB] px-3 py-2 text-sm text-[#7A5C00]">
                      <p className="font-semibold">Correction by {v.correction.requestedBy || "staff"}. The approved value was {fmt(v.correction.previousActual)}.</p>
                      <p className="mt-1 text-[#5C4600]">{v.correction.note}</p>
                    </div>
                  )}
                  {hasEvidence ? (
                    <ul className="flex flex-wrap gap-2">
                      {evidence.map((e, i) => (
                        <li key={`${e.type}-${e.key || e.url}-${i}`}>
                          <button
                            type="button"
                            title={e.name}
                            onClick={() => openEvidence(v, e)}
                            className={`flex max-w-[16rem] items-center gap-2 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-2.5 py-1.5 text-xs font-medium text-[#344054] transition hover:bg-[#F2F4F7] ${FOCUS}`}
                          >
                            <span className="rounded bg-white px-1.5 py-0.5 text-[11px] text-[#667085] ring-1 ring-inset ring-[#E5E7EB]">{e.type === "file" ? "File" : "Link"}</span>
                            <span className="truncate">{e.name}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-[#B54708]">No evidence attached. It cannot be approved without evidence.</p>
                  )}
                </div>
                <div className="flex items-start gap-2 lg:flex-col">
                  <button type="button" className={`${BTN} lg:w-28`} disabled={busy || !hasEvidence}
                    title={hasEvidence ? undefined : "Evidence is required before a value can be approved"}
                    onClick={() => review(v, true)} aria-label={`Approve ${v.indicatorName} for ${v.period}`}>
                    Approve
                  </button>
                  <button type="button" className={`${BTN_SM} py-2 lg:w-28`} disabled={busy} onClick={() => review(v, false)}
                    aria-label={`Reject ${v.indicatorName} for ${v.period}`}>
                    Reject
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );

  const projectRow = (p) => (
    <Fragment key={p.id}>
      <li className="grid items-center gap-x-6 gap-y-3 px-5 py-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_auto_auto]">
        <div className="min-w-0">
          <p className="truncate font-medium text-[#101828]">{p.name}</p>
          <p className="mt-0.5 truncate text-xs text-[#667085]">
            {[p.donor, p.theme, p.region].filter(Boolean).join(", ") || "No donor, theme or region set"}
            {(p.startDate || p.endDate) && ` · ${fmtDay(p.startDate) || NOT_SET} to ${fmtDay(p.endDate) || NOT_SET}`}
          </p>
          <p className="mt-0.5 text-xs text-[#667085]">
            {fmt(p.indicators)} indicators, {fmt(p.approved)} of {fmt(p.expected)} values approved
            {p.pending > 0 && <span className="text-[#B54708]">, {fmt(p.pending)} awaiting approval</span>}
          </p>
        </div>
        <Progress pct={p.avgPct} />
        <label className="flex items-center gap-2 text-xs font-medium text-[#475467]">
          <Switch checked={Boolean(p.shared)} disabled={busy} onChange={() => toggleSharing(p)} label={`Share ${p.name} for aggregation`} />
          {p.shared ? "Shared" : "Not shared"}
        </label>
        <div className="flex gap-2">
          <button type="button" className={BTN_SM} disabled={busy} aria-expanded={editing === p.id} aria-label={`Edit details for ${p.name}`}
            onClick={() => (editing === p.id ? setEditing(null) : startEdit(p))}>
            {editing === p.id ? "Close" : "Details"}
          </button>
          <button type="button" className={BTN_SM} disabled={busy} aria-expanded={fundsOpen === p.id} aria-label={`Funds for ${p.name}`}
            onClick={() => { setEditing(null); setFundsOpen(fundsOpen === p.id ? null : p.id); }}>
            {fundsOpen === p.id ? "Close funds" : "Funds"}
          </button>
        </div>
      </li>
      {editing === p.id && (
        <li className="bg-[#F9FAFB] px-5 py-5">
          <div className="flex flex-wrap items-end gap-3">
            {DETAIL_FIELDS.map((f) => (
              <label key={f.key} className={`w-44 ${LABEL}`}>
                {f.label}
                <input className={`${FIELD} mt-1 block w-full`} list={`options-${f.key}`} value={draft[f.key] ?? ""}
                  onChange={(e) => setDraft((cur) => ({ ...cur, [f.key]: e.target.value }))} />
              </label>
            ))}
            <label className={`w-44 ${LABEL}`}>Start date
              <input type="date" className={`${FIELD} mt-1 block w-full`} value={draft.startDate ?? ""} onChange={(e) => setDraft((cur) => ({ ...cur, startDate: e.target.value }))} />
            </label>
            <label className={`w-44 ${LABEL}`}>End date
              <input type="date" className={`${FIELD} mt-1 block w-full`} value={draft.endDate ?? ""} onChange={(e) => setDraft((cur) => ({ ...cur, endDate: e.target.value }))} />
            </label>
            <label className={`w-36 ${LABEL}`}>Budget
              <input type="number" min="0" className={`${FIELD} mt-1 block w-full`} value={draft.budget ?? ""} onChange={(e) => setDraft((cur) => ({ ...cur, budget: e.target.value }))} />
            </label>
            <label className={`w-24 ${LABEL}`}>Currency
              <input className={`${FIELD} mt-1 block w-full`} maxLength={8} placeholder="USD" value={draft.currency ?? ""} onChange={(e) => setDraft((cur) => ({ ...cur, currency: e.target.value }))} />
            </label>
            <label className={`w-56 ${LABEL}`}>Countries, separated by commas
              <input className={`${FIELD} mt-1 block w-full`} placeholder="Kenya, Uganda" value={draft.countries ?? ""} onChange={(e) => setDraft((cur) => ({ ...cur, countries: e.target.value }))} />
            </label>
            <button type="button" className={BTN} disabled={busy} onClick={() => saveDetails(p)}>Save details</button>
          </div>
        </li>
      )}
      {fundsOpen === p.id && (
        <li className="bg-[#F9FAFB] px-5 py-5">
          <FundRequests framework={p} onChange={load} />
        </li>
      )}
    </Fragment>
  );

  const projectsTab = (
    <section aria-label={PS_CAP}>
      <Heading title={PS_CAP} hint={`Only shared ${PS} count towards strategic indicators.`} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input type="search" aria-label={`Filter ${PS}`} className={`${FIELD} min-w-[14rem] grow basis-60`} value={query}
          onChange={(e) => setQuery(e.target.value)} placeholder="Search by name, donor, theme, partner or region" />
        <div role="group" aria-label="Sharing" className="inline-flex rounded-lg border border-[#D0D5DD] bg-white p-0.5">
          {[["all", "All"], ["shared", "Shared"], ["not-shared", "Not shared"]].map(([id, label]) => (
            <button key={id} type="button" aria-pressed={shareFilter === id} onClick={() => setShareFilter(id)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${FOCUS} ${shareFilter === id ? "bg-[#EDE9FB] text-[#5B3FD0]" : "text-[#475467] hover:bg-[#F4F5F7]"}`}>
              {label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-[#475467]">
          Group by
          <select className={`${FIELD} py-1.5`} value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
            {GROUP_BY.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
          </select>
        </label>
      </div>

      {DETAIL_FIELDS.map((f) => (
        <datalist key={f.key} id={`options-${f.key}`}>
          {suggestions[f.key]?.map((v) => <option key={v} value={v} />)}
        </datalist>
      ))}

      {projects.length === 0 ? (
        <Empty>No {PS} yet.</Empty>
      ) : visibleCount === 0 ? (
        <Empty>
          No {PS} match the current filters.{" "}
          <button type="button" className={`font-medium text-[#5B3FD0] hover:underline ${FOCUS}`} onClick={() => { setQuery(""); setShareFilter("all"); }}>
            Show all {PS}
          </button>
        </Empty>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <div key={g.label ?? "all"}>
              {g.label !== null && (
                <div className="mb-2 flex flex-wrap items-center justify-between gap-3 px-1">
                  <h3 className="text-sm font-semibold text-[#101828]">
                    {g.label} <span className="ml-1 font-normal text-[#667085]">{g.items.length} {g.items.length === 1 ? P : PS} by {groupLabel}</span>
                  </h3>
                  <Progress pct={g.avgPct} />
                </div>
              )}
              <ul className={`${PANEL} divide-y divide-[#EEF0F4]`}>{g.items.map(projectRow)}</ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );

  const strategicTab = (
    <section aria-label="Strategic indicators">
      <Heading title="Strategic indicators" hint={`Values are added together across shared ${PS}, so this suits countable indicators such as people reached. Share ${P === "project" ? "a project" : `an ${P}`} first, then link its indicators.`} />
      <div className={`${PANEL} mb-5 flex flex-wrap items-end gap-3 p-4`}>
        <label className={`grow basis-64 ${LABEL}`}>Name
          <input className={`${FIELD} mt-1 block w-full`} value={name} onChange={(e) => setName(e.target.value)} placeholder="For example, People reached with rights education" />
        </label>
        <label className={`w-40 ${LABEL}`}>Unit
          <input className={`${FIELD} mt-1 block w-full`} value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="people" />
        </label>
        <button type="button" className={BTN} disabled={busy || !name.trim()} onClick={addStrategic}>Add indicator</button>
      </div>

      {strategic.length === 0 ? (
        <Empty>No strategic indicators yet. Add one above, then link indicators to it.</Empty>
      ) : (
        <ul className={`${PANEL} divide-y divide-[#EEF0F4]`}>
          {strategic.map((s) => {
            const expanded = Boolean(open[s.id]);
            const isEditing = editingStrategic === s.id;
            return (
              <li key={s.id} className="px-5 py-4">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                  <div className="min-w-0 grow basis-64">
                    {isEditing ? (
                      <div className="flex flex-wrap gap-2">
                        <input className={`${FIELD} grow`} aria-label="Strategic indicator name" value={strategicDraft.name}
                          onChange={(e) => setStrategicDraft((d) => ({ ...d, name: e.target.value }))} />
                        <input className={`${FIELD} w-32`} aria-label="Unit" placeholder="Unit" value={strategicDraft.unit}
                          onChange={(e) => setStrategicDraft((d) => ({ ...d, unit: e.target.value }))} />
                      </div>
                    ) : (
                      <>
                        <p className="font-medium text-[#101828]">{s.name}</p>
                        <p className="mt-0.5 text-xs text-[#667085]">{s.unit ? `${s.unit}. ` : ""}{s.linked.length} linked {s.linked.length === 1 ? "indicator" : "indicators"}</p>
                      </>
                    )}
                  </div>
                  <p className="text-right text-sm tabular-nums">
                    <span className="font-semibold text-[#101828]">{fmt(s.actual)}</span>
                    <span className="text-[#667085]"> of {fmt(s.reportedTarget)} to date</span>
                  </p>
                  <Progress pct={s.pct} />
                  <div className="flex flex-wrap items-center gap-2">
                    {isEditing ? (
                      <>
                        <button type="button" className={BTN_SM} disabled={busy} onClick={() => saveStrategic(s)}>Save</button>
                        <button type="button" className={BTN_SM} onClick={() => setEditingStrategic(null)}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <button type="button" aria-expanded={expanded} className={BTN_SM} onClick={() => setOpen((cur) => ({ ...cur, [s.id]: !expanded }))}>
                          {expanded ? "Hide detail" : "Link and detail"}
                        </button>
                        <button type="button" className={BTN_SM} disabled={busy} aria-label={`Edit ${s.name}`}
                          onClick={() => { setEditingStrategic(s.id); setStrategicDraft({ name: s.name, unit: s.unit || "" }); }}>
                          Edit
                        </button>
                        <button type="button" className={BTN_DANGER} disabled={busy} aria-label={`Delete ${s.name}`} onClick={() => deleteStrategic(s)}>Delete</button>
                      </>
                    )}
                  </div>
                </div>

                {expanded && (
                  <div className="mt-5 grid gap-6 border-t border-[#F2F4F7] pt-5 xl:grid-cols-2">
                    <div>
                      <div className="flex flex-wrap items-end gap-2">
                        <label className={`grow basis-56 ${LABEL}`}>Link an indicator
                          <select className={`${FIELD} mt-1 block w-full`} value={linkChoice[s.id] ?? ""}
                            onChange={(e) => setLinkChoice((cur) => ({ ...cur, [s.id]: e.target.value }))}>
                            <option value="">Choose an indicator from a shared {P}</option>
                            {projects.filter((p) => p.shared).map((p) => {
                              const options = allIndicators.filter((i) => i.frameworkId === p.id && !i.strategicId);
                              if (options.length === 0) return null;
                              return (
                                <optgroup key={p.id} label={p.name}>
                                  {options.map((i) => <option key={i.id} value={`${i.frameworkId}|${i.id}`}>{i.name}{i.unit ? ` (${i.unit})` : ""}</option>)}
                                </optgroup>
                              );
                            })}
                          </select>
                        </label>
                        <button type="button" className={BTN} disabled={busy || !linkChoice[s.id]} onClick={() => linkIndicator(s)}>Link</button>
                      </div>
                      <p className="mt-1 text-xs text-[#667085]">Only indicators from shared {PS} that are not linked yet are listed.</p>

                      <ul className="mt-4 divide-y divide-[#F2F4F7] rounded-lg border border-[#EEF0F4]">
                        {s.linked.map((l) => (
                          <li key={l.indicatorId} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                            <div className="min-w-0">
                              <p className="truncate text-[#101828]">{l.indicatorName}</p>
                              <p className="truncate text-xs text-[#667085]">{l.frameworkName}</p>
                            </div>
                            <span className="shrink-0 text-xs tabular-nums text-[#475467]">{fmt(l.actual)} of {fmt(l.reportedTarget)}</span>
                            <button type="button" className={BTN_SM} disabled={busy} aria-label={`Unlink ${l.indicatorName}`} onClick={() => unlinkIndicator(l)}>Unlink</button>
                          </li>
                        ))}
                        {s.linked.length === 0 && <li className="px-3 py-6 text-center text-sm text-[#667085]">Nothing linked yet. Pick an indicator above.</li>}
                      </ul>
                    </div>
                    <Disaggregation strategic={s} type={disagg[s.id]} onType={(type) => setDisagg((cur) => ({ ...cur, [s.id]: type }))} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );

  const breakdownsTab = (
    <section aria-label="Disaggregation types">
      <Heading title="Breakdowns" hint="Define how results can be split, such as by gender or age group. Staff report a value across these categories and the split must add up to the value. The actual value fills in from the first breakdown they complete." />
      <div className={`${PANEL} mb-5 flex flex-wrap items-end gap-3 p-4`}>
        <label className={`w-48 ${LABEL}`}>Type
          <input className={`${FIELD} mt-1 block w-full`} value={typeName} onChange={(e) => setTypeName(e.target.value)} placeholder="Gender" />
        </label>
        <label className={`grow basis-64 ${LABEL}`}>Categories, separated by commas
          <input className={`${FIELD} mt-1 block w-full`} value={typeCategories} onChange={(e) => setTypeCategories(e.target.value)} placeholder="Women, Men, Non-binary" />
        </label>
        <button type="button" className={BTN} disabled={busy || !typeName.trim() || splitList(typeCategories).length < 2} onClick={addType}>Add type</button>
      </div>
      {types.length === 0 ? (
        <Empty>No breakdowns yet. Add one above with at least two categories.</Empty>
      ) : (
        <ul className={`${PANEL} divide-y divide-[#EEF0F4]`}>
          {types.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
              {editingType === t.id ? (
                <>
                  <input className={`${FIELD} w-48`} aria-label="Type name" value={typeDraft.name} onChange={(e) => setTypeDraft((d) => ({ ...d, name: e.target.value }))} />
                  <input className={`${FIELD} grow basis-64`} aria-label="Categories, separated by commas" value={typeDraft.categories} onChange={(e) => setTypeDraft((d) => ({ ...d, categories: e.target.value }))} />
                  <button type="button" className={BTN_SM} disabled={busy} onClick={() => saveType(t)}>Save</button>
                  <button type="button" className={BTN_SM} onClick={() => setEditingType(null)}>Cancel</button>
                </>
              ) : (
                <>
                  <span className="w-40 font-medium text-[#101828]">{t.name}</span>
                  <span className="flex grow basis-64 flex-wrap gap-1.5">
                    {t.categories.map((c) => <span key={c} className="rounded-full bg-[#F2F4F7] px-2.5 py-0.5 text-xs font-medium text-[#475467]">{c}</span>)}
                  </span>
                  <button type="button" className={BTN_SM} disabled={busy} aria-label={`Edit ${t.name}`}
                    onClick={() => { setEditingType(t.id); setTypeDraft({ name: t.name, categories: t.categories.join(", ") }); }}>Edit</button>
                  <button type="button" className={BTN_DANGER} disabled={busy} aria-label={`Delete ${t.name}`} onClick={() => deleteType(t)}>Delete</button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  const body = { overview, approvals, projects: projectsTab, strategic: strategicTab, breakdowns: breakdownsTab }[tab];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[#101828]">Portfolio</h1>
          <p className="mt-1 text-sm text-[#667085]">Approved results from every shared {P}, rolled up through strategic indicators.</p>
        </div>
        <button type="button" className={BTN_SM} disabled={strategic.length === 0} onClick={exportCsv}>Export results as CSV</button>
      </header>

      <div aria-live="polite" className="space-y-2 empty:hidden">
        {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>}
        {notice && <div role="status" className="rounded-lg border border-[#BFE3D3] bg-[#EEF8F3] px-4 py-2.5 text-sm text-[#1F7A5C]">{notice}</div>}
      </div>

      <nav aria-label="Portfolio sections" className="-mb-2 overflow-x-auto border-b border-[#E5E7EB]">
        <ul className="flex min-w-max gap-1">
          {TABS.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                aria-current={tab === t.id ? "page" : undefined}
                onClick={() => setTab(t.id)}
                className={`-mb-px flex items-center gap-2 border-b-2 px-3.5 py-2.5 text-sm font-medium transition focus-visible:-outline-offset-2 ${FOCUS} ${
                  tab === t.id ? "border-[#5B3FD0] text-[#5B3FD0]" : "border-transparent text-[#667085] hover:text-[#101828]"
                }`}
              >
                {t.label}
                {t.count !== undefined && (
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${t.alert ? "bg-[#FEF0C7] text-[#93370D]" : "bg-[#F2F4F7] text-[#475467]"}`}>{t.count}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {portfolio === null && busy ? <p className="py-16 text-center text-sm text-[#667085]">Loading portfolio.</p> : body}
    </div>
  );
}

export default PortfolioView;
