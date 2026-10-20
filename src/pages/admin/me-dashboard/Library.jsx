import { useMemo, useState } from "react";
import { api } from "../../../meApi";
import {
  BTN, BTN_LIGHT, CARD, ErrorBar, FIELD, FrameworkSelect, NoFramework, Page, PageHead,
  TargetsInput, cleanTargets, useMEData,
} from "./Shared";

/* Common indicators to start from. Adding one copies it into the chosen framework. */
const LIBRARY = [
  { category: "Health", name: "Percentage of women attending at least four antenatal care visits", unit: "%", mov: "Clinic registers and household survey", assumptions: "Clinics keep complete records" },
  { category: "Health", name: "Number of people reached with health rights education", unit: "people", mov: "Session attendance sheets", assumptions: "Communities attend sessions" },
  { category: "Health", name: "Percentage of surveyed patients reporting respectful treatment", unit: "%", mov: "Exit interviews", assumptions: "Patients feel safe to answer honestly" },
  { category: "Education", name: "Number of learners supported to stay in school", unit: "learners", mov: "School enrolment records", assumptions: "Schools share attendance data" },
  { category: "Education", name: "Percentage of supported learners attending at least 90% of school days", unit: "%", mov: "Attendance registers", assumptions: "Registers are kept up to date" },
  { category: "Gender", name: "Number of gender-based violence cases referred for support", unit: "cases", mov: "Referral log", assumptions: "Referral partners confirm receipt" },
  { category: "Gender", name: "Percentage of women in leadership positions in supported groups", unit: "%", mov: "Group membership and leadership lists", assumptions: "Groups hold elections as planned" },
  { category: "Environment", name: "Number of community members trained on climate adaptation", unit: "people", mov: "Training reports", assumptions: "Training is held in the planned season" },
  { category: "Environment", name: "Hectares of land under restoration", unit: "hectares", mov: "Field verification and GPS records", assumptions: "Land owners give consent" },
  { category: "Economic", name: "Number of households with a new or improved income source", unit: "households", mov: "Household follow-up survey", assumptions: "Local markets remain stable" },
  { category: "Economic", name: "Number of people with access to a savings or credit group", unit: "people", mov: "Group registers", assumptions: "Groups continue to meet" },
  { category: "Rights and governance", name: "Number of policy or budget submissions made by communities", unit: "submissions", mov: "Copies of submissions", assumptions: "Government opens public participation" },
  { category: "Rights and governance", name: "Number of rights violations documented and followed up", unit: "cases", mov: "Case management system", assumptions: "Survivors consent to follow-up" },
  { category: "Rights and governance", name: "Number of partner organisations trained", unit: "organisations", mov: "Training attendance and evaluation forms", assumptions: "Partners nominate participants" },
];

const CATEGORIES = ["All", ...new Set(LIBRARY.map((i) => i.category))];

function MELibrary() {
  const { isAdmin, frameworks, selectedId, setSelectedId, fw, ordered, busy, error, run, reload } = useMEData();
  const [category, setCategory] = useState("All");
  const [query, setQuery] = useState("");
  const [resultId, setResultId] = useState("");
  const [open, setOpen] = useState("");
  const [setup, setSetup] = useState({ baseline: "", targets: {} });
  const [added, setAdded] = useState(new Set());

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return LIBRARY.filter(
      (i) => (category === "All" || i.category === category) && (!q || i.name.toLowerCase().includes(q))
    );
  }, [category, query]);

  const startAdd = (name) => {
    setOpen(open === name ? "" : name);
    setSetup({ baseline: "", targets: {} });
  };

  const addToFramework = (item) =>
    run(async () => {
      if (!resultId) throw new Error("Choose which result this indicator measures first.");
      await api(`/me/frameworks/${selectedId}/indicators`, {
        method: "POST",
        body: {
          name: item.name,
          unit: item.unit,
          ...(setup.baseline !== "" ? { baseline: Number(setup.baseline) } : {}),
          targets: cleanTargets(setup.targets),
          mov: item.mov,
          assumptions: item.assumptions,
          resultId,
        },
      });
      setAdded((s) => new Set(s).add(`${selectedId}:${item.name}`));
      setOpen("");
      await reload();
    });

  return (
    <Page>
      <PageHead title="Indicator library" subtitle="Start from a common indicator instead of writing one from scratch.">
        <FrameworkSelect frameworks={frameworks} value={selectedId} onChange={(id) => { setSelectedId(id); setResultId(""); }} />
      </PageHead>

      <ErrorBar error={error} />
      {!fw && <NoFramework isAdmin={isAdmin} busy={busy} />}

      {fw && (
        <section className={`${CARD} flex flex-wrap items-center gap-2 p-4`} aria-label="Library filters">
          <input className={`${FIELD} w-64`} placeholder="Search the library" aria-label="Search the library" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Category">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                role="tab"
                aria-selected={c === category}
                onClick={() => setCategory(c)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  c === category ? "bg-[#EDE9FB] text-[#5B3FD0]" : "text-[#475467] hover:bg-[#F4F5F7]"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
          {isAdmin && (
            <select className={`${FIELD} ml-auto`} aria-label="Add to result" value={resultId} onChange={(e) => setResultId(e.target.value)}>
              <option value="">Add to which result?</option>
              {ordered.map((r) => (
                <option key={r.id} value={r.id}>{r.title}</option>
              ))}
            </select>
          )}
        </section>
      )}

      {fw && (
        <div className="grid gap-3 md:grid-cols-2">
          {shown.length === 0 && <p className={`${CARD} p-10 text-center text-sm text-[#98A2B3] md:col-span-2`}>Nothing in the library matches.</p>}
          {shown.map((item) => {
            const done = added.has(`${selectedId}:${item.name}`);
            return (
              <article key={item.name} className={`${CARD} p-5`}>
                <span className="rounded-full bg-[#EDE9FB] px-2.5 py-0.5 text-xs font-medium text-[#5B3FD0]">{item.category}</span>
                <h2 className="mt-3 text-sm font-semibold text-[#101828]">{item.name}</h2>
                <p className="mt-1 text-xs text-[#667085]">Unit: {item.unit}</p>
                <p className="mt-2 text-xs text-[#475467]">Verified by: {item.mov}</p>
                <p className="mt-1 text-xs text-[#475467]">Assumes: {item.assumptions}</p>

                {isAdmin && (
                  <div className="mt-4">
                    {done ? (
                      <span className="text-sm font-medium text-[#1F7A5C]">Added to this framework</span>
                    ) : (
                      <button type="button" onClick={() => startAdd(item.name)} className={BTN_LIGHT}>
                        {open === item.name ? "Cancel" : "Add to framework"}
                      </button>
                    )}
                  </div>
                )}

                {open === item.name && (
                  <div className="mt-4 space-y-3 border-t border-[#EEF0F4] pt-4">
                    <label className="block text-xs font-medium text-[#667085]">
                      Baseline
                      <input type="number" className={`${FIELD} mt-1 w-32`} value={setup.baseline} onChange={(e) => setSetup({ ...setup, baseline: e.target.value })} />
                    </label>
                    <TargetsInput periods={fw.periods} value={setup.targets} onChange={(targets) => setSetup({ ...setup, targets })} />
                    <button type="button" onClick={() => addToFramework(item)} disabled={busy} className={BTN}>Add indicator</button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </Page>
  );
}

export default MELibrary;
