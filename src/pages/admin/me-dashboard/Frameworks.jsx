import { Fragment, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { DEPARTMENT_AREAS, PROGRAM_AREAS, getAccess } from "../../../access";
import { api } from "../../../meApi";
import { LABELS } from "../../../labels";
import { BTN, BTN_LIGHT, CARD, CardHead, ErrorBar, FIELD, FrameworkSelect, NoFramework, Page, PageHead, useMEData } from "./Shared";
import PeopleAccess from "./PeopleAccess";
import LogFrame from "./LogFrame";
import FundRequests from "./FundRequests";
import { buildFrameworkFile, downloadJson, fileSlug } from "./frameworkFile";

const AREAS = [...PROGRAM_AREAS, ...DEPARTMENT_AREAS];
const areaName = (slug) => AREAS.find((a) => a.slug === slug)?.name || slug || "No area";

/* Levels follow the MEAL Framework (Chapter 3): impact, outcome, output, with activities at the bottom of the logframe */
const DEFAULT_LEVELS = ["Impact", "Outcome", "Output", "Activity"];

/* One soft colour per level, so the hierarchy reads at a glance */
const LEVEL_STYLE = [
  { bg: "#EDE9FB", text: "#5B3FD0" },
  { bg: "#E8F1FD", text: "#1E4C9A" },
  { bg: "#E9F6F1", text: "#00664E" },
  { bg: "#FEF6D8", text: "#7A5B00" },
];
const levelStyle = (i) => LEVEL_STYLE[i % LEVEL_STYLE.length];

const VIEWS = [
  ["results", "Results and indicators"],
  ["logframe", "Logical framework"],
  ["milestones", "Milestones"],
  ["requisitions", "Requisitions"],
];

const DANGER =
  "rounded-lg border border-[#FDA29B] bg-white px-3.5 py-2 text-sm font-semibold text-[#B42318] transition hover:bg-[#FEF3F2] disabled:cursor-not-allowed disabled:opacity-60";
const SMALL =
  "rounded-md border border-[#D0D5DD] bg-white px-2.5 py-1 text-xs font-semibold text-[#344054] transition hover:bg-[#F4F5F7] disabled:cursor-not-allowed disabled:opacity-50";
const SMALL_DANGER =
  "rounded-md border border-[#FDA29B] bg-white px-2.5 py-1 text-xs font-semibold text-[#B42318] transition hover:bg-[#FEF3F2] disabled:cursor-not-allowed disabled:opacity-50";
const SMALL_GREEN =
  "rounded-md border border-[#B7E4D4] bg-[#F0FAF6] px-2.5 py-1 text-xs font-semibold text-[#00664E] transition hover:bg-[#E0F4EC] disabled:cursor-not-allowed disabled:opacity-50";

/* Table header and cell styles shared by every table on this page */
const TH = "sticky top-0 border-y border-[#E5E7EB] bg-[#F9FAFB] px-4 py-3 text-left text-xs font-semibold text-[#667085]";
const TD = "px-4 py-3";

const fmtNum = (n) => {
  if (n === undefined || n === null || n === "") return "-";
  const value = Number(n);
  return Number.isFinite(value) ? value.toLocaleString() : "-";
};

const quarterForDate = (date) => {
  if (!date) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year, quarter: Math.floor((month - 1) / 3) + 1 };
};

const quarterLabel = ({ year, quarter }) => `${year}-Q${quarter}`;

/* Generates every calendar quarter touched by the framework dates, inclusive. */
function generateQuarterPeriods(startDate, endDate) {
  const start = quarterForDate(startDate);
  const end = quarterForDate(endDate);
  if (!start || !end) return [];
  const startIndex = start.year * 4 + start.quarter - 1;
  const endIndex = end.year * 4 + end.quarter - 1;
  if (endIndex < startIndex) return [];
  const periods = [];
  for (let index = startIndex; index <= endIndex; index += 1) {
    periods.push(quarterLabel({ year: Math.floor(index / 4), quarter: (index % 4) + 1 }));
  }
  return periods;
}

function parsePeriods(raw) {
  const periods = String(raw || "").split(",").map((period) => period.trim()).filter(Boolean);
  const seen = new Set();
  const duplicates = [];
  periods.forEach((period) => {
    const key = period.toLocaleLowerCase();
    if (seen.has(key)) duplicates.push(period);
    seen.add(key);
  });
  return { periods, duplicates };
}

function periodProblem(raw) {
  const { periods, duplicates } = parsePeriods(raw);
  if (!periods.length) return "Add at least one reporting period.";
  if (duplicates.length) return `Remove duplicate reporting period${duplicates.length > 1 ? "s" : ""}: ${[...new Set(duplicates)].join(", ")}.`;
  return "";
}

/* Only quarter labels can be compared automatically with framework dates. */
function periodsOutsideDates(periods, startDate, endDate) {
  const start = quarterForDate(startDate);
  const end = quarterForDate(endDate);
  if (!start && !end) return [];
  return periods.filter((period) => {
    const match = /^(\d{4})-Q([1-4])$/i.exec(period);
    if (!match) return false;
    const value = { year: Number(match[1]), quarter: Number(match[2]) };
    const index = value.year * 4 + value.quarter - 1;
    const startIndex = start ? start.year * 4 + start.quarter - 1 : -Infinity;
    const endIndex = end ? end.year * 4 + end.quarter - 1 : Infinity;
    return index < startIndex || index > endIndex;
  });
}

const fmtDay = (s) => {
  const t = s ? new Date(s).getTime() : NaN;
  return Number.isNaN(t) ? "" : new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};

const datesOf = (f) =>
  f && (f.startDate || f.endDate) ? `${fmtDay(f.startDate) || "Not set"} to ${fmtDay(f.endDate) || "Not set"}` : "Not set";

/* ---------- Initiative details (dates, theme, budget and so on) ---------- */

const splitList = (s) => s.split(",").map((v) => v.trim()).filter(Boolean);

const EMPTY_DETAILS = {
  theme: "", focusArea: "", partner: "", region: "",
  startDate: "", endDate: "", budget: "", currency: "", countries: "", description: "",
};

const EMPTY_MILESTONE = { title: "", dueDate: "", resultId: "" };

const detailsFrom = (fw) => ({
  theme: fw.theme || "",
  focusArea: fw.focusArea || "",
  partner: fw.partner || "",
  region: fw.region || "",
  startDate: fw.startDate || "",
  endDate: fw.endDate || "",
  budget: fw.budget ?? "",
  currency: fw.currency || "",
  countries: (fw.countries || []).join(", "),
  description: fw.description || "",
});

/* The request body for these fields. Theme, focus area, partner and region always go together. */
const detailsBody = (d) => ({
  theme: d.theme.trim(),
  focusArea: d.focusArea.trim(),
  partner: d.partner.trim(),
  region: d.region.trim(),
  startDate: d.startDate,
  endDate: d.endDate,
  budget: d.budget === "" ? "" : Number(d.budget),
  currency: d.currency.trim(),
  description: d.description.trim(),
  countries: splitList(d.countries),
});

function detailsProblem(d) {
  if (d.startDate && d.endDate && d.endDate < d.startDate) return "The end date cannot be before the start date.";
  if (d.budget !== "" && (Number.isNaN(Number(d.budget)) || Number(d.budget) < 0)) return "The budget must be a number, zero or more.";
  return "";
}

/* Defined outside the forms so typing does not remount the inputs */
function Field({ label, children, wide = false }) {
  return (
    <label className={`block text-xs font-medium text-[#667085] ${wide ? "sm:col-span-2" : ""}`}>
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}

function DetailFields({ value, onChange }) {
  const set = (key) => (e) => onChange({ ...value, [key]: e.target.value });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Start date"><input type="date" className={`${FIELD} w-full`} value={value.startDate} onChange={set("startDate")} /></Field>
      <Field label="End date"><input type="date" className={`${FIELD} w-full`} value={value.endDate} onChange={set("endDate")} /></Field>
      <Field label="Theme"><input className={`${FIELD} w-full`} value={value.theme} onChange={set("theme")} placeholder="For example Health" /></Field>
      <Field label="Focus area"><input className={`${FIELD} w-full`} value={value.focusArea} onChange={set("focusArea")} placeholder="For example Gender" /></Field>
      <Field label="Partner"><input className={`${FIELD} w-full`} value={value.partner} onChange={set("partner")} /></Field>
      <Field label="Region"><input className={`${FIELD} w-full`} value={value.region} onChange={set("region")} /></Field>
      <div className="grid grid-cols-[1fr_6rem] gap-3">
        <Field label="Budget"><input type="number" min="0" className={`${FIELD} w-full`} value={value.budget} onChange={set("budget")} /></Field>
        <Field label="Currency"><input className={`${FIELD} w-full`} value={value.currency} onChange={set("currency")} placeholder="USD" maxLength={8} /></Field>
      </div>
      <Field label="Countries (separate with commas)"><input className={`${FIELD} w-full`} value={value.countries} onChange={set("countries")} placeholder="Kenya, Uganda" /></Field>
      <Field label="Description" wide><textarea rows={3} maxLength={500} className={`${FIELD} w-full`} value={value.description} onChange={set("description")} /></Field>
    </div>
  );
}

/* One label and value pair of the details table */
function DetailRow({ a, b }) {
  const cell = ([label, value]) => (
    <>
      <th scope="row" className="w-[15%] bg-[#F9FAFB] px-4 py-2.5 text-left text-xs font-semibold text-[#667085]">{label}</th>
      <td className="w-[35%] px-4 py-2.5 font-medium text-[#101828]">{value}</td>
    </>
  );
  return (
    <tr className="border-t border-[#EEF0F4] first:border-t-0">
      {cell(a)}
      {b ? cell(b) : <td colSpan={2} />}
    </tr>
  );
}

function MEFrameworks() {
  const { isAdmin, frameworks, selectedId, setSelectedId, data, fw, ordered, busy, error, run, loadList, reload } = useMEData();
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState(() => {
    const now = new Date();
    const current = { year: now.getFullYear(), quarter: Math.floor(now.getMonth() / 3) + 1 };
    const defaults = Array.from({ length: 4 }, (_, offset) => {
      const index = current.year * 4 + current.quarter - 1 + offset;
      return quarterLabel({ year: Math.floor(index / 4), quarter: (index % 4) + 1 });
    });
    return { name: "", donor: "", area: AREAS[0]?.slug || "", periods: defaults.join(", ") };
  });
  const [newDetails, setNewDetails] = useState(EMPTY_DETAILS);
  const [rf, setRf] = useState({ title: "", level: 0, parentId: "" });
  const [showAddResult, setShowAddResult] = useState(false);
  const addRef = useRef(null);
  const [editingFw, setEditingFw] = useState(false);
  const [fwDraft, setFwDraft] = useState({ name: "", donor: "", area: "" });
  const [detailsDraft, setDetailsDraft] = useState(EMPTY_DETAILS);
  const [editingResult, setEditingResult] = useState(null);
  const [resultTitle, setResultTitle] = useState("");
  const [access, setAccess] = useState({ isAdmin: false, departments: new Set() });
  /* Which view of the selected framework is open: the results list, the logframe table, the milestones or the requisitions */
  const [view, setView] = useState("results");
  /* Results whose rows are open to show the indicators beneath them */
  const [expandedResults, setExpandedResults] = useState(new Set());
  /* Which chip is pressed: a level number, "linked" (has indicators), or null for everything */
  const [resultFilter, setResultFilter] = useState(null);
  /* Milestones of the selected framework */
  const [milestones, setMilestones] = useState([]);
  const [showAddMilestone, setShowAddMilestone] = useState(false);
  const [mf, setMf] = useState(EMPTY_MILESTONE);

  useEffect(() => {
    let mounted = true;
    getAccess().then((r) => mounted && setAccess(r)).catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const loadMilestones = async () => {
    try {
      const rows = await api(`/me/frameworks/${selectedId}/milestones`);
      setMilestones(Array.isArray(rows) ? rows : []);
    } catch {
      setMilestones([]);
    }
  };

  useEffect(() => {
    if (selectedId) loadMilestones();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  /* Programme staff manage frameworks in their own programmes. The administrator manages all of them. */
  const myAreas = isAdmin ? AREAS : AREAS.filter((a) => access.departments.has(a.slug));
  const canCreate = isAdmin || myAreas.length > 0;
  const canManage = Boolean(fw) && (isAdmin || access.departments.has(fw.area));
  const newArea = myAreas.some((a) => a.slug === form.area) ? form.area : myAreas[0]?.slug || "";

  const levels = fw?.levels?.length ? fw.levels : DEFAULT_LEVELS;
  const parents = ordered.filter((r) => r.level === Number(rf.level) - 1);

  /* The add form is always open while a framework has no results, so the first step is obvious */
  const resultsEmpty = ordered.length === 0;
  const addFormOpen = canManage && (showAddResult || resultsEmpty);

  /* Choosing a framework clears anything half-finished on the previous one */
  const selectFramework = (id) => {
    setSelectedId(id);
    setEditingFw(false);
    setEditingResult(null);
    setShowAddResult(false);
    setRf({ title: "", level: 0, parentId: "" });
    setExpandedResults(new Set());
    setResultFilter(null);
    setShowAddMilestone(false);
    setMf(EMPTY_MILESTONE);
  };

  const toggleResult = (id) =>
    setExpandedResults((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const createFramework = () =>
    run(async () => {
      const { periods } = parsePeriods(form.periods);
      if (!form.name.trim()) throw new Error("Give the framework a name.");
      const periodsIssue = periodProblem(form.periods);
      if (periodsIssue) throw new Error(periodsIssue);
      const problem = detailsProblem(newDetails);
      if (problem) throw new Error(problem);
      const { id } = await api("/me/frameworks", {
        method: "POST",
        body: { name: form.name.trim(), donor: form.donor.trim(), area: newArea, periods, ...detailsBody(newDetails) },
      });
      setShowNew(false);
      setForm((f) => ({ ...f, name: "", donor: "" }));
      setNewDetails(EMPTY_DETAILS);
      await loadList(id);
    });

  const startEditFramework = () => {
    setFwDraft({ name: fw.name, donor: fw.donor || "", area: fw.area });
    setDetailsDraft(detailsFrom(fw));
    setEditingFw(true);
  };

  const saveFramework = () =>
    run(async () => {
      if (!fwDraft.name.trim()) throw new Error("Give the framework a name.");
      const problem = detailsProblem(detailsDraft);
      if (problem) throw new Error(problem);
      await api(`/me/frameworks/${selectedId}`, {
        method: "PUT",
        body: { name: fwDraft.name.trim(), donor: fwDraft.donor.trim(), area: fwDraft.area },
      });
      await api(`/me/frameworks/${selectedId}/details`, {
        method: "PUT",
        body: { donor: fwDraft.donor.trim(), ...detailsBody(detailsDraft) },
      });
      setEditingFw(false);
      await loadList(selectedId);
      await reload();
    });

  const deleteFramework = () => {
    const counts = `${ordered.length} ${ordered.length === 1 ? "result" : "results"} and ${data.indicators.length} ${
      data.indicators.length === 1 ? "indicator" : "indicators"
    }`;
    const ok = window.confirm(
      `Delete "${fw.name}"?\n\nThis also deletes its ${counts}, and every value reported against them. This cannot be undone.`
    );
    if (!ok) return;
    run(async () => {
      await api(`/me/frameworks/${selectedId}`, { method: "DELETE" });
      setEditingFw(false);
      await loadList();
    });
  };

  const addResult = () =>
    run(async () => {
      if (!rf.title.trim()) throw new Error("Give the result a title.");
      const level = Number(rf.level);
      if (!Number.isInteger(level) || level < 0 || level >= levels.length) throw new Error("Choose a valid result level.");
      if (level === 0 && rf.parentId) throw new Error("An impact-level result cannot sit under another result.");
      if (level > 0 && !rf.parentId) throw new Error(`Choose the ${levels[level - 1]?.toLowerCase() || "parent result"} this sits under.`);
      if (level > 0) {
        const parent = ordered.find((result) => String(result.id) === String(rf.parentId));
        if (!parent || parent.level !== level - 1) throw new Error(`Choose a valid ${levels[level - 1]?.toLowerCase() || "parent result"}.`);
      }
      await api(`/me/frameworks/${selectedId}/results`, {
        method: "POST",
        body: { title: rf.title.trim(), level: Number(rf.level), ...(rf.parentId ? { parentId: rf.parentId } : {}) },
      });
      setRf({ title: "", level: rf.level, parentId: rf.parentId });
      await reload();
    });

  /* Opens the form already set to the next level down, under the chosen result */
  const openAddUnder = (r) => {
    setRf({ title: "", level: r.level + 1, parentId: r.id });
    setShowAddResult(true);
    setView("results");
    setTimeout(() => addRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
  };

  /* Frameworks made before the logframe have three levels. This adds Activity at the bottom. */
  const addActivityLevel = () =>
    run(async () => {
      await api(`/me/frameworks/${selectedId}/levels`, { method: "POST", body: { name: "Activity" } });
      await loadList(selectedId);
      await reload();
    });

  const toggleAddResult = () => {
    if (showAddResult) {
      setShowAddResult(false);
      return;
    }
    setRf({ title: "", level: 0, parentId: "" });
    setShowAddResult(true);
  };

  const saveResult = (r) =>
    run(async () => {
      if (!resultTitle.trim()) throw new Error("Give the result a title.");
      await api(`/me/frameworks/${selectedId}/results/${r.id}`, { method: "PUT", body: { title: resultTitle.trim() } });
      setEditingResult(null);
      await reload();
    });

  const deleteResult = (r) => {
    if (!window.confirm(`Delete the result "${r.title}"? This cannot be undone.`)) return;
    run(async () => {
      await api(`/me/frameworks/${selectedId}/results/${r.id}`, { method: "DELETE" });
      await reload();
    });
  };

  /* ---------- Milestones ---------- */

  const addMilestone = () =>
    run(async () => {
      if (!mf.title.trim()) throw new Error("Give the milestone a title.");
      if (!mf.dueDate) throw new Error("Choose a due date.");
      if (fw.startDate && mf.dueDate < fw.startDate) throw new Error("The due date is before the framework starts.");
      if (fw.endDate && mf.dueDate > fw.endDate) throw new Error("The due date is after the framework ends.");
      await api(`/me/frameworks/${selectedId}/milestones`, {
        method: "POST",
        body: {
          title: mf.title.trim(),
          dueDate: mf.dueDate,
          status: "planned",
          ...(mf.resultId ? { resultId: mf.resultId } : {}),
        },
      });
      setMf(EMPTY_MILESTONE);
      setShowAddMilestone(false);
      await loadMilestones();
    });

  const toggleMilestone = (m) =>
    run(async () => {
      await api(`/me/frameworks/${selectedId}/milestones/${m.id}`, {
        method: "PUT",
        body: { status: m.status === "done" ? "planned" : "done" },
      });
      await loadMilestones();
    });

  const deleteMilestone = (m) => {
    if (!window.confirm(`Delete the milestone "${m.title}"? This cannot be undone.`)) return;
    run(async () => {
      await api(`/me/frameworks/${selectedId}/milestones/${m.id}`, { method: "DELETE" });
      await loadMilestones();
    });
  };

  /* Everything on this page as a file that can be imported back (see the Import page) */
  const exportFramework = () =>
    downloadJson(`${fileSlug(fw.name)}-framework.json`, buildFrameworkFile(fw, ordered, data.indicators));

  const countFor = (id) => data?.indicators.filter((i) => i.resultId === id).length ?? 0;

  /* Results shown in the hierarchy table, narrowed by the chip that is pressed */
  const shownResults = ordered.filter((r) =>
    resultFilter === null ? true : resultFilter === "linked" ? countFor(r.id) > 0 : r.level === resultFilter
  );

  /* Indicators in framework order, each with the result it measures */
  const indicatorRows = data
    ? ordered.flatMap((r) => data.indicators.filter((i) => i.resultId === r.id).map((i) => ({ r, i })))
    : [];

  /* Milestones in date order, with today's date to flag the overdue ones */
  const today = new Date().toISOString().slice(0, 10);
  const sortedMilestones = [...milestones].sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));

  const dates = datesOf(fw);
  const themes = fw ? [fw.theme, fw.focusArea].filter(Boolean).join(", ") : "";
  const countries = Array.isArray(fw?.countries) ? fw.countries.join(", ") : "";
  const budget = fw?.budget ? `${Number(fw.budget).toLocaleString()} ${fw.currency || ""}`.trim() : "Not set";
  const partnerRegion = fw ? [fw.partner, fw.region].filter(Boolean).join(", ") : "";

  return (
    <Page>
      <PageHead title="Frameworks" subtitle="Results frameworks and the indicators that measure them.">
        {canCreate && (
          <>
            <Link to="/me-dashboard/import-framework" className={`${BTN_LIGHT} inline-flex items-center`}>
              Import a framework
            </Link>
            <button type="button" onClick={() => setShowNew((s) => !s)} className={BTN}>
              {showNew ? "Close" : "New framework"}
            </button>
          </>
        )}
      </PageHead>

      <ErrorBar error={error} />

      {showNew && canCreate && (
        <section className={`${CARD} p-5`} aria-label="New framework">
          <CardHead title="New framework" subtitle="Periods are comma separated, for example 2026-Q1, 2026-Q2. Dates decide whether it shows as current, upcoming or previous." />
          <div className="grid gap-3 sm:grid-cols-2">
            <input className={FIELD} placeholder="Framework name" aria-label="Framework name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className={FIELD} placeholder="Donor" aria-label="Donor" value={form.donor} onChange={(e) => setForm({ ...form, donor: e.target.value })} />
            <select className={FIELD} aria-label={LABELS.programme} value={newArea} onChange={(e) => setForm({ ...form, area: e.target.value })}>
              {myAreas.map((a) => (
                <option key={a.slug} value={a.slug}>{a.name}</option>
              ))}
            </select>
            <div>
              <label className="block text-xs font-medium text-[#667085]" htmlFor="new-framework-periods">Reporting periods (comma separated)</label>
              <input id="new-framework-periods" className={`${FIELD} mt-1 w-full`} placeholder="2026-Q4, 2027-Q1" aria-label="Reporting periods" value={form.periods} onChange={(e) => setForm({ ...form, periods: e.target.value })} />
              <p className="mt-1 text-[11px] text-[#667085]">Use quarter labels such as 2026-Q4. Custom labels are also allowed. Avoid duplicates.</p>
            </div>
          </div>
          <div className="mt-4">
            <DetailFields value={newDetails} onChange={setNewDetails} />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={BTN_LIGHT}
                onClick={() => {
                  const generated = generateQuarterPeriods(newDetails.startDate, newDetails.endDate);
                  if (generated.length) setForm((current) => ({ ...current, periods: generated.join(", ") }));
                }}
                disabled={!newDetails.startDate || !newDetails.endDate || newDetails.endDate < newDetails.startDate}
              >
                Generate quarters from dates
              </button>
              <span className="text-xs text-[#667085]">Creates every calendar quarter touched by the start and end dates.</span>
            </div>
            {periodProblem(form.periods) && <p role="alert" className="mt-2 text-xs text-[#B42318]">{periodProblem(form.periods)}</p>}
            {periodsOutsideDates(parsePeriods(form.periods).periods, newDetails.startDate, newDetails.endDate).length > 0 && (
              <p role="status" className="mt-2 text-xs text-[#9A6700]">Some quarter periods fall outside the framework dates: {periodsOutsideDates(parsePeriods(form.periods).periods, newDetails.startDate, newDetails.endDate).join(", ")}. Review the dates or reporting periods before creating the framework.</p>
            )}
          </div>
          <div className="mt-4 flex gap-2">
            <button type="button" onClick={createFramework} disabled={busy} className={BTN}>Create framework</button>
            <button type="button" onClick={() => setShowNew(false)} className={BTN_LIGHT}>Cancel</button>
          </div>
        </section>
      )}

      {frameworks.length === 0 && <NoFramework isAdmin={isAdmin} busy={busy} />}

      {frameworks.length > 0 && (
        <div className="space-y-4">
          {/* SELECT A FRAMEWORK */}
          <section className={`${CARD} p-5`} aria-label="Select a framework">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <CardHead
                  title="Select a framework"
                  subtitle="Choose the framework to view or edit. Everything below shows the framework you select."
                />
              </div>
              <FrameworkSelect frameworks={frameworks} value={selectedId} onChange={selectFramework} />
            </div>
          </section>

          {fw && (
            <>
              {/* FRAMEWORK DETAILS */}
              <section className={`${CARD} p-5`} aria-label="Framework details">
                {editingFw ? (
                  <>
                    <CardHead title="Edit framework" subtitle="Reporting periods can't be changed once a framework exists." />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <input className={`${FIELD} sm:col-span-2`} aria-label="Framework name" value={fwDraft.name} onChange={(e) => setFwDraft({ ...fwDraft, name: e.target.value })} />
                      <input className={FIELD} placeholder="Donor" aria-label="Donor" value={fwDraft.donor} onChange={(e) => setFwDraft({ ...fwDraft, donor: e.target.value })} />
                      <select className={FIELD} aria-label={LABELS.programme} value={fwDraft.area} onChange={(e) => setFwDraft({ ...fwDraft, area: e.target.value })}>
                        {myAreas.map((a) => (
                          <option key={a.slug} value={a.slug}>{a.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="mt-4">
                      <DetailFields value={detailsDraft} onChange={setDetailsDraft} />
                    </div>
                    <div className="mt-4 flex gap-2">
                      <button type="button" onClick={saveFramework} disabled={busy} className={BTN}>Save changes</button>
                      <button type="button" onClick={() => setEditingFw(false)} className={BTN_LIGHT}>Cancel</button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <h2 className="text-base font-semibold text-[#101828]">{fw.name}</h2>
                      <div className="flex gap-2">
                        <button type="button" onClick={exportFramework} disabled={busy} className={BTN_LIGHT}>Export</button>
                        {canManage && (
                          <>
                            <button type="button" onClick={startEditFramework} disabled={busy} className={BTN_LIGHT}>Edit</button>
                            {isAdmin && (
                              <button type="button" onClick={deleteFramework} disabled={busy} className={DANGER}>Delete framework</button>
                            )}
                          </>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 overflow-x-auto rounded-lg border border-[#EEF0F4]">
                      <table className="w-full min-w-[560px] border-collapse text-sm">
                        <caption className="sr-only">Details of {fw.name}</caption>
                        <tbody>
                          <DetailRow a={["Donor", fw.donor || "Not set"]} b={[LABELS.programme, areaName(fw.area)]} />
                          <DetailRow a={["Dates", dates]} b={["Budget", budget]} />
                          <DetailRow a={["Theme", themes || "Not set"]} b={["Countries", countries || "Not set"]} />
                          <DetailRow
                            a={["Partner and region", partnerRegion || "Not set"]}
                            b={["Indicators", data.indicators.length]}
                          />
                          <DetailRow a={["Milestones", milestones.length]} />
                          {fw.description && (
                            <tr className="border-t border-[#EEF0F4]">
                              <th scope="row" className="bg-[#F9FAFB] px-4 py-2.5 text-left text-xs font-semibold text-[#667085]">Description</th>
                              <td colSpan={3} className="px-4 py-2.5 text-[#475467]">{fw.description}</td>
                            </tr>
                          )}
                          <tr className="border-t border-[#EEF0F4]">
                            <th scope="row" className="bg-[#F9FAFB] px-4 py-2.5 text-left text-xs font-semibold text-[#667085]">Reporting periods</th>
                            <td colSpan={3} className="px-4 py-2.5">
                              <div className="flex flex-wrap gap-1.5">
                                {fw.periods.map((p) => (
                                  <span key={p} className="rounded-full bg-[#EDE9FB] px-2.5 py-0.5 text-xs font-medium text-[#5B3FD0]">{p}</span>
                                ))}
                              </div>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    <div className="mt-5 border-t border-[#EEF0F4] pt-4">
                      <PeopleAccess frameworkId={selectedId} isAdmin={isAdmin} />
                    </div>
                  </>
                )}
              </section>

              {/* Switch between the results list, the logframe table, the milestones and the requisitions */}
              <div role="tablist" aria-label="Framework views" className="flex gap-1">
                {VIEWS.map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={view === key}
                    onClick={() => setView(key)}
                    className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
                      view === key ? "bg-[#EDE9FB] text-[#5B3FD0]" : "text-[#475467] hover:bg-[#F4F5F7]"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {view === "logframe" && (
                <LogFrame
                  frameworkId={selectedId}
                  framework={fw}
                  data={data}
                  ordered={ordered}
                  levels={levels}
                  canManage={canManage}
                  busy={busy}
                  run={run}
                  reload={reload}
                />
              )}

              {view === "requisitions" && (
                <FundRequests key={fw.id ?? selectedId} framework={{ ...fw, id: fw.id ?? selectedId }} />
              )}

              {view === "milestones" && (
                <section className={`${CARD} overflow-hidden`} aria-label="Milestones">
                  <div className="flex items-start justify-between gap-3 p-5 pb-3">
                    <div className="min-w-0 flex-1">
                      <CardHead
                        title="Milestones"
                        subtitle="Key dates for this framework. Link a milestone to a result if it marks progress on it."
                      />
                    </div>
                    {canManage && (
                      <button type="button" onClick={() => setShowAddMilestone((s) => !s)} className={BTN}>
                        {showAddMilestone ? "Close" : "Add milestone"}
                      </button>
                    )}
                  </div>

                  {canManage && showAddMilestone && (
                    <div className="mx-5 mb-4 rounded-lg border border-[#DDD6F7] bg-[#F8F7FE] p-4" aria-label="Add milestone">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Title" wide>
                          <input
                            className={`${FIELD} w-full`}
                            value={mf.title}
                            onChange={(e) => setMf({ ...mf, title: e.target.value })}
                            onKeyDown={(e) => e.key === "Enter" && !busy && addMilestone()}
                          />
                        </Field>
                        <Field label="Due date">
                          <input
                            type="date"
                            className={`${FIELD} w-full`}
                            min={fw.startDate || undefined}
                            max={fw.endDate || undefined}
                            value={mf.dueDate}
                            onChange={(e) => setMf({ ...mf, dueDate: e.target.value })}
                          />
                        </Field>
                        <Field label="Linked result (optional)">
                          <select
                            className={`${FIELD} w-full`}
                            value={mf.resultId}
                            onChange={(e) => setMf({ ...mf, resultId: e.target.value })}
                          >
                            <option value="">None</option>
                            {ordered.map((r) => (
                              <option key={r.id} value={r.id}>{levels[r.level]}: {r.title}</option>
                            ))}
                          </select>
                        </Field>
                      </div>
                      <div className="mt-4 flex gap-2">
                        <button type="button" onClick={addMilestone} disabled={busy} className={BTN}>Add milestone</button>
                        <button type="button" onClick={() => setShowAddMilestone(false)} className={BTN_LIGHT}>Cancel</button>
                      </div>
                    </div>
                  )}

                  {sortedMilestones.length === 0 ? (
                    <p className="px-5 pb-8 pt-3 text-center text-sm text-[#98A2B3]">No milestones yet.</p>
                  ) : (
                    <div className="max-h-[60vh] overflow-auto">
                      <table className="w-full min-w-[640px] border-collapse text-sm">
                        <caption className="sr-only">Milestones of {fw.name}</caption>
                        <thead>
                          <tr>
                            <th scope="col" className={`${TH} pl-5`}>Milestone</th>
                            <th scope="col" className={TH}>Due</th>
                            <th scope="col" className={TH}>Linked result</th>
                            <th scope="col" className={TH}>Status</th>
                            {canManage && <th scope="col" className={`${TH} pr-5 text-right`}><span className="sr-only">Actions</span></th>}
                          </tr>
                        </thead>
                        <tbody>
                          {sortedMilestones.map((m) => {
                            const done = m.status === "done";
                            const overdue = !done && m.dueDate && m.dueDate < today;
                            const linked = ordered.find((r) => String(r.id) === String(m.resultId));
                            return (
                              <tr key={m.id} className="border-t border-[#F2F4F7] align-middle hover:bg-[#FCFCFD]">
                                <td className={`${TD} pl-5 font-medium text-[#101828] ${done ? "line-through opacity-60" : ""}`}>{m.title}</td>
                                <td className={`${TD} whitespace-nowrap text-[#475467]`}>{fmtDay(m.dueDate) || "-"}</td>
                                <td className={`${TD} text-[#475467]`}>{linked ? linked.title : "-"}</td>
                                <td className={TD}>
                                  <span
                                    className="whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold"
                                    style={
                                      done
                                        ? { background: "#E9F6F1", color: "#00664E" }
                                        : overdue
                                        ? { background: "#FEF3F2", color: "#B42318" }
                                        : { background: "#E8F1FD", color: "#1E4C9A" }
                                    }
                                  >
                                    {done ? "Done" : overdue ? "Overdue" : "Planned"}
                                  </span>
                                </td>
                                {canManage && (
                                  <td className="whitespace-nowrap py-3 pl-4 pr-5 text-right">
                                    <div className="flex items-center justify-end gap-2">
                                      <button type="button" className={SMALL_GREEN} disabled={busy} onClick={() => toggleMilestone(m)}>
                                        {done ? "Reopen" : "Mark done"}
                                      </button>
                                      <button type="button" className={SMALL_DANGER} disabled={busy} aria-label={`Delete ${m.title}`} onClick={() => deleteMilestone(m)}>
                                        Delete
                                      </button>
                                    </div>
                                  </td>
                                )}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              )}

              {view === "results" && (
                <>
                  {/* RESULTS HIERARCHY, with the add form built in */}
                  <section className={`${CARD} overflow-hidden`} aria-label="Results">
                    <div className="flex items-start justify-between gap-3 p-5 pb-3">
                      <div className="min-w-0 flex-1">
                        <CardHead title="Results hierarchy" subtitle="Build the results chain from impact → outcome → output → activity. Add an impact first, then link each outcome to an impact, each output to an outcome and each activity to an output. Indicators should measure the result they are linked to. A result can only be deleted once nothing sits under it." />
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        {canManage && !levels.some((l) => l.toLowerCase() === "activity") && (
                          <button type="button" onClick={addActivityLevel} disabled={busy} className={BTN_LIGHT}>
                            Add activity level
                          </button>
                        )}
                        {canManage && !resultsEmpty && (
                          <button type="button" onClick={toggleAddResult} className={BTN}>
                            {showAddResult ? "Close" : "Add result"}
                          </button>
                        )}
                      </div>
                    </div>

                    {addFormOpen && (
                      <div ref={addRef} className="mx-5 mb-4 rounded-lg border border-[#DDD6F7] bg-[#F8F7FE] p-4" aria-label="Add result">
                        <p className="mb-3 text-sm font-semibold text-[#3B2A8F]">
                          {resultsEmpty ? "Start with the impact" : "New result"}
                        </p>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Field label="Title" wide>
                            <input
                              className={`${FIELD} w-full`}
                              value={rf.title}
                              onChange={(e) => setRf({ ...rf, title: e.target.value })}
                              onKeyDown={(e) => e.key === "Enter" && !busy && addResult()}
                            />
                          </Field>
                          <Field label="Level">
                            <select
                              className={`${FIELD} w-full`}
                              value={rf.level}
                              onChange={(e) => setRf({ ...rf, level: Number(e.target.value), parentId: "" })}
                            >
                              {levels.map((name, i) => (
                                <option key={name} value={i} disabled={resultsEmpty && i > 0}>{name}</option>
                              ))}
                            </select>
                          </Field>
                          <Field label={Number(rf.level) === 0 ? "Parent result (not required for impact)" : `Parent ${levels[Number(rf.level) - 1] || "result"} (required)`}>
                            <select
                              className={`${FIELD} w-full`}
                              value={rf.parentId}
                              disabled={Number(rf.level) === 0}
                              onChange={(e) => setRf({ ...rf, parentId: e.target.value })}
                            >
                              <option value="">{Number(rf.level) === 0 ? "Not needed for impact" : `Choose a ${levels[Number(rf.level) - 1]?.toLowerCase() || "parent result"}`}</option>
                              {parents.map((p) => (
                                <option key={p.id} value={p.id}>{p.title}</option>
                              ))}
                            </select>
                          </Field>
                        </div>
                        <div className="mt-4 flex gap-2">
                          <button type="button" onClick={addResult} disabled={busy} className={BTN}>Add result</button>
                          {!resultsEmpty && (
                            <button type="button" onClick={() => setShowAddResult(false)} className={BTN_LIGHT}>Close</button>
                          )}
                        </div>
                      </div>
                    )}

                    {!resultsEmpty && (
                      <div className="mb-3 flex flex-wrap items-center gap-2 px-5 text-xs" role="group" aria-label="Filter results">
                        {levels.map((levelName, index) => {
                          const count = ordered.filter((result) => result.level === index).length;
                          const st = levelStyle(index);
                          const on = resultFilter === index;
                          return (
                            <button
                              key={levelName}
                              type="button"
                              aria-pressed={on}
                              onClick={() => setResultFilter(on ? null : index)}
                              className="rounded-full px-2.5 py-1 transition hover:brightness-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5B3FD0]"
                              style={{
                                background: st.bg,
                                color: st.text,
                                boxShadow: on ? `inset 0 0 0 2px ${st.text}` : "none",
                              }}
                            >
                              {levelName}: <strong>{count}</strong>
                            </button>
                          );
                        })}
                        <button
                          type="button"
                          aria-pressed={resultFilter === "linked"}
                          onClick={() => setResultFilter(resultFilter === "linked" ? null : "linked")}
                          className="rounded-full bg-[#F0FAF6] px-2.5 py-1 text-[#00664E] transition hover:brightness-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00664E]"
                          style={{ boxShadow: resultFilter === "linked" ? "inset 0 0 0 2px #00664E" : "none" }}
                        >
                          Indicators linked: <strong>{data.indicators.length}</strong>
                        </button>
                        {resultFilter !== null && (
                          <button type="button" onClick={() => setResultFilter(null)} className="font-semibold text-[#00664E] hover:underline">
                            Show all
                          </button>
                        )}
                      </div>
                    )}

                    {resultsEmpty ? (
                      !canManage && <p className="px-5 pb-8 pt-3 text-center text-sm text-[#98A2B3]">No results yet.</p>
                    ) : (
                      <div className="max-h-[60vh] overflow-auto">
                        <table className="w-full min-w-[640px] border-collapse text-sm">
                          <caption className="sr-only">Results of {fw.name}, from impact down to activities</caption>
                          <thead>
                            <tr>
                              <th scope="col" className={`${TH} pl-5`}>Result</th>
                              <th scope="col" className={TH}>Level</th>
                              <th scope="col" className={`${TH} text-right`}>Indicators</th>
                              {canManage && (
                                <th scope="col" className={`${TH} pr-5 text-right`}><span className="sr-only">Actions</span></th>
                              )}
                            </tr>
                          </thead>
                          <tbody>
                            {shownResults.length === 0 && (
                              <tr>
                                <td colSpan={canManage ? 4 : 3} className="px-5 py-8 text-center text-sm text-[#98A2B3]">
                                  {resultFilter === "linked" ? "No results have indicators linked yet." : "No results at this level yet."}
                                </td>
                              </tr>
                            )}
                            {shownResults.map((r) => {
                              const s = levelStyle(r.level);
                              const count = countFor(r.id);
                              const open = expandedResults.has(r.id);
                              const mine = data.indicators.filter((ind) => ind.resultId === r.id);
                              const children = ordered.filter((x) => x.parentId === r.id).length;
                              return (
                                <Fragment key={r.id}>
                                <tr
                                  className={`cursor-pointer border-t border-[#F2F4F7] align-middle hover:bg-[#FCFCFD] ${open ? "bg-[#FCFCFD]" : ""}`}
                                  onClick={() => toggleResult(r.id)}
                                >
                                  <td
                                    className="py-3 pr-4"
                                    style={{ paddingLeft: `${20 + r.depth * 22}px`, borderLeft: `4px solid ${s.text}` }}
                                  >
                                    {editingResult === r.id ? (
                                      <input
                                        className={`${FIELD} w-full`}
                                        aria-label="Result title"
                                        onClick={(e) => e.stopPropagation()}
                                        value={resultTitle}
                                        onChange={(e) => setResultTitle(e.target.value)}
                                      />
                                    ) : (
                                      <button
                                        type="button"
                                        aria-expanded={open}
                                        aria-label={`${open ? "Hide" : "Show"} details of ${r.title}`}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          toggleResult(r.id);
                                        }}
                                        className="flex max-w-xl items-start gap-2 text-left"
                                      >
                                        <span aria-hidden="true" className={`mt-0.5 inline-block text-xs text-[#98A2B3] transition-transform ${open ? "rotate-90" : ""}`}>&#9656;</span>
                                        <span className={`leading-5 text-[#101828] ${r.depth === 0 ? "font-semibold" : "font-medium"}`}>{r.title}</span>
                                      </button>
                                    )}
                                  </td>
                                  <td className={TD}>
                                    <span className="whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold" style={{ background: s.bg, color: s.text }}>
                                      {levels[r.level] ?? `Level ${r.level + 1}`}
                                    </span>
                                  </td>
                                  <td className={`${TD} text-right tabular-nums text-[#475467]`}>{count}</td>
                                  {canManage && (
                                    <td className="whitespace-nowrap py-3 pl-4 pr-5 text-right" onClick={(e) => e.stopPropagation()}>
                                      <div className="flex items-center justify-end gap-2">
                                        {editingResult === r.id ? (
                                          <>
                                            <button type="button" className={SMALL} disabled={busy} onClick={() => saveResult(r)}>Save</button>
                                            <button type="button" className={SMALL} onClick={() => setEditingResult(null)}>Cancel</button>
                                          </>
                                        ) : (
                                          <>
                                            {r.level + 1 < levels.length && (
                                              <button
                                                type="button"
                                                className={SMALL_GREEN}
                                                disabled={busy}
                                                aria-label={`Add ${(levels[r.level + 1] || "result").toLowerCase()} under ${r.title}`}
                                                onClick={() => openAddUnder(r)}
                                              >
                                                + {levels[r.level + 1]}
                                              </button>
                                            )}
                                            <button
                                              type="button"
                                              className={SMALL}
                                              disabled={busy}
                                              aria-label={`Edit ${r.title}`}
                                              onClick={() => {
                                                setEditingResult(r.id);
                                                setResultTitle(r.title);
                                              }}
                                            >
                                              Edit
                                            </button>
                                            <button type="button" className={SMALL_DANGER} disabled={busy} aria-label={`Delete ${r.title}`} onClick={() => deleteResult(r)}>
                                              Delete
                                            </button>
                                          </>
                                        )}
                                      </div>
                                    </td>
                                  )}
                                </tr>
                                {open && (
                                  <tr className="border-t border-[#F2F4F7] bg-[#F9FAFB]">
                                    <td colSpan={canManage ? 4 : 3} className="py-3 pl-12 pr-5" style={{ borderLeft: `4px solid ${s.text}` }}>
                                      <p className="text-xs text-[#667085]">
                                        {levels[r.level] ?? `Level ${r.level + 1}`}
                                        {children > 0 ? ` | ${children} ${children === 1 ? "result" : "results"} directly beneath` : ""}
                                        {` | ${mine.length} ${mine.length === 1 ? "indicator" : "indicators"} linked`}
                                      </p>
                                      {mine.length === 0 ? (
                                        <p className="mt-2 text-sm text-[#98A2B3]">No indicators linked to this result yet.</p>
                                      ) : (
                                        <ul className="mt-2 divide-y divide-[#EEF0F4] rounded-lg border border-[#EEF0F4] bg-white">
                                          {mine.map((ind) => {
                                            const t = ind.targets && typeof ind.targets === "object" ? ind.targets : {};
                                            return (
                                              <li key={ind.id} className="flex flex-wrap items-start justify-between gap-3 px-3 py-2.5">
                                                <div className="min-w-0">
                                                  <p className="text-sm font-medium text-[#101828]">{ind.name}</p>
                                                  <p className="mt-0.5 text-xs text-[#667085]">
                                                    {ind.unit ? `${ind.unit} | ` : ""}Baseline {fmtNum(ind.baseline)}
                                                  </p>
                                                </div>
                                                <div className="flex flex-wrap gap-1.5">
                                                  {(fw.periods || []).map((period) => {
                                                    const ok = t[period] !== undefined && t[period] !== null && t[period] !== "" && Number.isFinite(Number(t[period]));
                                                    return (
                                                      <span key={period} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${ok ? "bg-[#EDE9FB] text-[#5B3FD0]" : "bg-[#FBF3D0] text-[#7A5C00]"}`}>
                                                        {period}: {ok ? fmtNum(t[period]) : "Not set"}
                                                      </span>
                                                    );
                                                  })}
                                                </div>
                                              </li>
                                            );
                                          })}
                                        </ul>
                                      )}
                                    </td>
                                  </tr>
                                )}
                                </Fragment>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>

                  {/* INDICATORS AND TARGETS */}
                  <section className={`${CARD} overflow-hidden`} aria-label="Indicators and targets">
                    <div className="p-5 pb-3">
                      <CardHead
                        title="Indicators and targets"
                        subtitle="Where each indicator starts (baseline) and the target set for each reporting period. A blank target means it is still to be set."
                      />
                    </div>
                    {indicatorRows.length === 0 ? (
                      <p className="px-5 pb-8 text-center text-sm text-[#98A2B3]">No indicators yet.</p>
                    ) : (
                      <div className="max-h-[60vh] overflow-auto">
                        <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                          <caption className="sr-only">Indicators with baselines and targets by period</caption>
                          <thead>
                            <tr>
                              <th scope="col" className={`${TH} pl-5`}>Indicator</th>
                              <th scope="col" className={`${TH} text-right`}>Baseline</th>
                              <th scope="col" className={TH}>Target by period</th>
                              <th scope="col" className={`${TH} pr-5 text-right`}>Target total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {indicatorRows.map(({ r, i }) => {
                              const targets = i.targets && typeof i.targets === "object" ? i.targets : {};
                              const periodTargets = (fw.periods || []).map((period) => ({
                                period,
                                value: targets[period],
                                set: targets[period] !== undefined && targets[period] !== null && targets[period] !== "" && Number.isFinite(Number(targets[period])),
                              }));
                              const setTargets = periodTargets.filter((target) => target.set);
                              const total = setTargets.reduce((sum, target) => sum + Number(target.value), 0);
                              const isPercent = i.unit === "%";
                              const hasTargets = setTargets.length > 0;
                              const missingTargets = periodTargets.length - setTargets.length;
                              const s = levelStyle(r.level);
                              return (
                                <tr key={i.id} className="border-t border-[#F2F4F7] align-top hover:bg-[#FCFCFD]">
                                  <td className="py-3 pl-5 pr-4" style={{ borderLeft: `4px solid ${s.text}` }}>
                                    <p className="max-w-md font-medium leading-5 text-[#101828]">{i.name}</p>
                                    <p className="mt-0.5 text-xs text-[#667085]">
                                      <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: s.bg, color: s.text }}>
                                        {levels[r.level] ?? `Level ${r.level + 1}`}
                                      </span>
                                      <span className="ml-2">{r.title}</span>
                                      {i.unit ? <span className="ml-2 rounded bg-[#F2F4F7] px-1.5 py-0.5 text-[11px] text-[#475467]">{i.unit}</span> : null}
                                    </p>
                                  </td>
                                  <td className={`${TD} text-right tabular-nums text-[#475467]`}>{fmtNum(i.baseline)}</td>
                                  <td className={TD}>
                                    <div className="flex flex-wrap gap-1.5">
                                      {periodTargets.map(({ period, value, set }) => (
                                        <span key={period} className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${set ? "bg-[#EDE9FB] text-[#5B3FD0]" : "bg-[#FBF3D0] text-[#7A5C00]"}`}>
                                          {period}: {set ? fmtNum(value) : "Not set"}
                                        </span>
                                      ))}
                                    </div>
                                    {missingTargets > 0 && (
                                      <p className="mt-1.5 text-[11px] text-[#9A6700]">{missingTargets} of {periodTargets.length} period {missingTargets === 1 ? "target is" : "targets are"} still missing.</p>
                                    )}
                                  </td>
                                  <td className="py-3 pl-4 pr-5 text-right font-semibold tabular-nums text-[#101828]">
                                    {hasTargets && !isPercent ? fmtNum(total) : isPercent && hasTargets ? "Not additive" : "-"}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                </>
              )}
            </>
          )}
        </div>
      )}
    </Page>
  );
}

export default MEFrameworks;
