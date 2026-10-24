import { useEffect, useRef, useState } from "react";
import { DEPARTMENT_AREAS, PROGRAM_AREAS, getAccess } from "../../../access";
import { api } from "../../../meApi";
import { LABELS } from "../../../labels";
import { BTN, BTN_LIGHT, CARD, CardHead, ErrorBar, FIELD, NoFramework, Page, PageHead, useMEData } from "./Shared";
import PeopleAccess from "./PeopleAccess";

const AREAS = [...PROGRAM_AREAS, ...DEPARTMENT_AREAS];
const areaName = (slug) => AREAS.find((a) => a.slug === slug)?.name || slug || "No area";

/* Levels follow the MEAL Framework (Chapter 3): impact, outcome, output */
const DEFAULT_LEVELS = ["Impact", "Outcome", "Output"];

const DANGER =
  "rounded-lg border border-[#FDA29B] bg-white px-3.5 py-2 text-sm font-semibold text-[#B42318] transition hover:bg-[#FEF3F2] disabled:cursor-not-allowed disabled:opacity-60";
const SMALL =
  "rounded-md border border-[#D0D5DD] bg-white px-2.5 py-1 text-xs font-semibold text-[#344054] transition hover:bg-[#F4F5F7] disabled:cursor-not-allowed disabled:opacity-50";
const SMALL_DANGER =
  "rounded-md border border-[#FDA29B] bg-white px-2.5 py-1 text-xs font-semibold text-[#B42318] transition hover:bg-[#FEF3F2] disabled:cursor-not-allowed disabled:opacity-50";
const SMALL_GREEN =
  "rounded-md border border-[#B7E4D4] bg-[#F0FAF6] px-2.5 py-1 text-xs font-semibold text-[#00664E] transition hover:bg-[#E0F4EC] disabled:cursor-not-allowed disabled:opacity-50";

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

const initials = (name = "") =>
  name.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join("") || "?";

/* ---------- Initiative details (dates, theme, budget and so on) ---------- */

const splitList = (s) => s.split(",").map((v) => v.trim()).filter(Boolean);

const EMPTY_DETAILS = {
  theme: "", focusArea: "", partner: "", region: "",
  startDate: "", endDate: "", budget: "", currency: "", countries: "", description: "",
};

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

  useEffect(() => {
    let mounted = true;
    getAccess().then((r) => mounted && setAccess(r)).catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

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
    setTimeout(() => addRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
  };

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

  const countFor = (id) => data?.indicators.filter((i) => i.resultId === id).length ?? 0;

  /* Indicators in framework order, each with the result it measures */
  const indicatorRows = data
    ? ordered.flatMap((r) => data.indicators.filter((i) => i.resultId === r.id).map((i) => ({ r, i })))
    : [];

  const dates = fw && (fw.startDate || fw.endDate) ? `${fmtDay(fw.startDate) || "Not set"} to ${fmtDay(fw.endDate) || "Not set"}` : "Not set";
  const themes = fw ? [fw.theme, fw.focusArea].filter(Boolean).join(", ") : "";
  const countries = Array.isArray(fw?.countries) ? fw.countries.join(", ") : "";

  return (
    <Page>
      <PageHead title="Frameworks" subtitle="Results frameworks and the indicators that measure them.">
        {canCreate && (
          <button type="button" onClick={() => setShowNew((s) => !s)} className={BTN}>
            {showNew ? "Close" : "New framework"}
          </button>
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
        <div className="grid gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
          <nav aria-label="Frameworks" className={`${CARD} h-fit p-3`}>
            <p className="px-2 pb-2 text-xs font-medium text-[#98A2B3]">All frameworks</p>
            <ul className="space-y-0.5">
              {frameworks.map((f) => {
                const active = f.id === selectedId;
                return (
                  <li key={f.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedId(f.id);
                        setEditingFw(false);
                        setEditingResult(null);
                        setShowAddResult(false);
                        setRf({ title: "", level: 0, parentId: "" });
                      }}
                      aria-current={active ? "true" : undefined}
                      className={`w-full rounded-lg px-3 py-2 text-left text-[13px] transition ${
                        active ? "bg-[#EDE9FB] font-semibold text-[#5B3FD0]" : "text-[#475467] hover:bg-[#F4F5F7]"
                      }`}
                    >
                      {f.name}
                      <span className="block text-[11px] font-normal text-[#98A2B3]">{areaName(f.area)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          {fw && (
            <div className="space-y-4">
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
                      {canManage && (
                        <div className="flex gap-2">
                          <button type="button" onClick={startEditFramework} disabled={busy} className={BTN_LIGHT}>Edit</button>
                          {isAdmin && (
                            <button type="button" onClick={deleteFramework} disabled={busy} className={DANGER}>Delete framework</button>
                          )}
                        </div>
                      )}
                    </div>
                    <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
                      <div>
                        <dt className="text-xs text-[#667085]">Donor</dt>
                        <dd className="mt-0.5 font-medium text-[#101828]">{fw.donor || "Not set"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-[#667085]">{LABELS.programme}</dt>
                        <dd className="mt-0.5 font-medium text-[#101828]">{areaName(fw.area)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-[#667085]">Indicators</dt>
                        <dd className="mt-0.5 font-medium text-[#101828]">{data.indicators.length}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-[#667085]">Dates</dt>
                        <dd className="mt-0.5 font-medium text-[#101828]">{dates}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-[#667085]">Theme</dt>
                        <dd className="mt-0.5 font-medium text-[#101828]">{themes || "Not set"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-[#667085]">Budget</dt>
                        <dd className="mt-0.5 font-medium text-[#101828]">
                          {fw.budget ? `${Number(fw.budget).toLocaleString()} ${fw.currency || ""}`.trim() : "Not set"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-[#667085]">Countries</dt>
                        <dd className="mt-0.5 font-medium text-[#101828]">{countries || "Not set"}</dd>
                      </div>
                      {(fw.partner || fw.region) && (
                        <div className="sm:col-span-2">
                          <dt className="text-xs text-[#667085]">Partner and region</dt>
                          <dd className="mt-0.5 font-medium text-[#101828]">{[fw.partner, fw.region].filter(Boolean).join(", ")}</dd>
                        </div>
                      )}
                      {fw.description && (
                        <div className="sm:col-span-3">
                          <dt className="text-xs text-[#667085]">Description</dt>
                          <dd className="mt-0.5 text-[#475467]">{fw.description}</dd>
                        </div>
                      )}
                    </dl>
                    <div className="mt-4 flex flex-wrap gap-1.5">
                      {fw.periods.map((p) => (
                        <span key={p} className="rounded-full bg-[#EDE9FB] px-2.5 py-0.5 text-xs font-medium text-[#5B3FD0]">{p}</span>
                      ))}
                    </div>

                    <div className="mt-5 border-t border-[#EEF0F4] pt-4">
                      <PeopleAccess frameworkId={selectedId} isAdmin={isAdmin} />
                    </div>
                  </>
                )}
              </section>

              {/* Results, with the add form built in */}
              <section className={`${CARD} p-5`} aria-label="Results">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <CardHead title="Results hierarchy" subtitle="Build the results chain from impact → outcome → output. Add an impact first, then link each outcome to an impact and each output to an outcome. Indicators should measure the result they are linked to. A result can only be deleted once nothing sits under it." />
                  </div>
                  {canManage && !resultsEmpty && (
                    <button type="button" onClick={toggleAddResult} className={`${BTN} shrink-0`}>
                      {showAddResult ? "Close" : "Add result"}
                    </button>
                  )}
                </div>

                {addFormOpen && (
                  <div ref={addRef} className="mb-4 rounded-lg border border-[#DDD6F7] bg-[#F8F7FE] p-4" aria-label="Add result">
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
                  <div className="mb-3 flex flex-wrap gap-2 text-xs">
                    {levels.map((levelName, index) => {
                      const count = ordered.filter((result) => result.level === index).length;
                      return (
                        <span key={levelName} className="rounded-full bg-[#F4F5F7] px-2.5 py-1 text-[#475467]">
                          {levelName}: <strong>{count}</strong>
                        </span>
                      );
                    })}
                    <span className="rounded-full bg-[#F0FAF6] px-2.5 py-1 text-[#00664E]">Indicators linked: <strong>{data.indicators.length}</strong></span>
                  </div>
                )}
                {resultsEmpty ? (
                  !canManage && <p className="py-8 text-center text-sm text-[#98A2B3]">No results yet.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {ordered.map((r) => (
                      <li
                        key={r.id}
                        style={{ marginLeft: `${r.depth * 20}px` }}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#EEF0F4] px-3 py-2.5"
                      >
                        <div className="min-w-0 grow">
                          <p className="text-[11px] font-medium text-[#98A2B3]">{levels[r.level] ?? `Level ${r.level + 1}`}</p>
                          {editingResult === r.id ? (
                            <input
                              className={`${FIELD} mt-1 w-full`}
                              aria-label="Result title"
                              value={resultTitle}
                              onChange={(e) => setResultTitle(e.target.value)}
                            />
                          ) : (
                            <p className="text-sm font-medium leading-5 text-[#101828]">{r.title}</p>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="rounded-full bg-[#F4F5F7] px-2.5 py-0.5 text-xs font-medium text-[#475467]">
                            {countFor(r.id)} {countFor(r.id) === 1 ? "indicator" : "indicators"}
                          </span>
                          {canManage &&
                            (editingResult === r.id ? (
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
                            ))}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Indicators and their targets */}
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
                    <table className="w-full min-w-[760px] text-left text-sm">
                      <caption className="sr-only">Indicators with baselines and targets by period</caption>
                      <thead>
                        <tr className="text-xs font-medium text-[#667085]">
                          <th scope="col" className="sticky top-0 border-y border-[#E5E7EB] bg-[#F9FAFB] px-5 py-3">Indicator</th>
                          <th scope="col" className="sticky top-0 border-y border-[#E5E7EB] bg-[#F9FAFB] px-3 py-3 text-right">Baseline</th>
                          <th scope="col" className="sticky top-0 border-y border-[#E5E7EB] bg-[#F9FAFB] px-3 py-3">Target by period</th>
                          <th scope="col" className="sticky top-0 border-y border-[#E5E7EB] bg-[#F9FAFB] px-5 py-3 text-right">Target total</th>
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
                          return (
                            <tr key={i.id} className="border-t border-[#F2F4F7] align-top">
                              <td className="px-5 py-3">
                                <p className="max-w-md font-medium leading-5 text-[#101828]">{i.name}</p>
                                <p className="mt-0.5 text-xs text-[#667085]">
                                  {levels[r.level] ?? `Level ${r.level + 1}`}
                                  {i.unit ? <span className="ml-2 rounded bg-[#F2F4F7] px-1.5 py-0.5 text-[11px] text-[#475467]">{i.unit}</span> : null}
                                </p>
                              </td>
                              <td className="px-3 py-3 text-right tabular-nums text-[#475467]">{fmtNum(i.baseline)}</td>
                              <td className="px-3 py-3">
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
                              <td className="px-5 py-3 text-right font-semibold tabular-nums text-[#101828]">
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
            </div>
          )}
        </div>
      )}
    </Page>
  );
}

export default MEFrameworks;
