import { useState } from "react";
import { DEPARTMENT_AREAS, PROGRAM_AREAS } from "../../../access";
import { api } from "../../../meApi";
import { BTN, BTN_LIGHT, CARD, CardHead, ErrorBar, FIELD, NoFramework, Page, PageHead, useMEData } from "./Shared";

const AREAS = [...PROGRAM_AREAS, ...DEPARTMENT_AREAS];
const areaName = (slug) => AREAS.find((a) => a.slug === slug)?.name || slug || "No area";
const DEFAULT_LEVELS = ["Goal", "Outcome", "Output"];

function MEFrameworks() {
  const { isAdmin, frameworks, selectedId, setSelectedId, data, fw, ordered, busy, error, run, loadList, reload } = useMEData();
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: "", donor: "", area: AREAS[0]?.slug || "", periods: "2026-Q1, 2026-Q2, 2026-Q3, 2026-Q4" });
  const [rf, setRf] = useState({ title: "", level: 0, parentId: "" });

  const levels = fw?.levels?.length ? fw.levels : DEFAULT_LEVELS;
  const parents = ordered.filter((r) => r.level === Number(rf.level) - 1);

  const createFramework = () =>
    run(async () => {
      const periods = form.periods.split(",").map((p) => p.trim()).filter(Boolean);
      if (!form.name.trim()) throw new Error("Give the framework a name.");
      if (periods.length === 0) throw new Error("Add at least one reporting period.");
      const { id } = await api("/me/frameworks", {
        method: "POST",
        body: { name: form.name.trim(), donor: form.donor.trim(), area: form.area, periods },
      });
      setShowNew(false);
      setForm((f) => ({ ...f, name: "", donor: "" }));
      await loadList(id);
    });

  const addResult = () =>
    run(async () => {
      if (!rf.title.trim()) throw new Error("Give the result a title.");
      if (Number(rf.level) > 0 && !rf.parentId) throw new Error("Choose the result this sits under.");
      await api(`/me/frameworks/${selectedId}/results`, {
        method: "POST",
        body: { title: rf.title.trim(), level: Number(rf.level), ...(rf.parentId ? { parentId: rf.parentId } : {}) },
      });
      setRf({ title: "", level: rf.level, parentId: rf.parentId });
      await reload();
    });

  const countFor = (id) => data?.indicators.filter((i) => i.resultId === id).length ?? 0;

  return (
    <Page>
      <PageHead title="Frameworks" subtitle="Results frameworks and the indicators that measure them.">
        {isAdmin && (
          <button type="button" onClick={() => setShowNew((s) => !s)} className={BTN}>
            {showNew ? "Close" : "New framework"}
          </button>
        )}
      </PageHead>

      <ErrorBar error={error} />

      {showNew && isAdmin && (
        <section className={`${CARD} p-5`} aria-label="New framework">
          <CardHead title="New framework" subtitle="Periods are comma separated, for example 2026-Q1, 2026-Q2." />
          <div className="grid gap-3 sm:grid-cols-2">
            <input className={FIELD} placeholder="Framework name" aria-label="Framework name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className={FIELD} placeholder="Donor" aria-label="Donor" value={form.donor} onChange={(e) => setForm({ ...form, donor: e.target.value })} />
            <select className={FIELD} aria-label="Area" value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })}>
              {AREAS.map((a) => (
                <option key={a.slug} value={a.slug}>{a.name}</option>
              ))}
            </select>
            <input className={FIELD} placeholder="Periods" aria-label="Periods" value={form.periods} onChange={(e) => setForm({ ...form, periods: e.target.value })} />
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
                      onClick={() => setSelectedId(f.id)}
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
                <h2 className="text-base font-semibold text-[#101828]">{fw.name}</h2>
                <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-xs text-[#667085]">Donor</dt>
                    <dd className="mt-0.5 font-medium text-[#101828]">{fw.donor || "Not set"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[#667085]">Area</dt>
                    <dd className="mt-0.5 font-medium text-[#101828]">{areaName(fw.area)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[#667085]">Indicators</dt>
                    <dd className="mt-0.5 font-medium text-[#101828]">{data.indicators.length}</dd>
                  </div>
                </dl>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {fw.periods.map((p) => (
                    <span key={p} className="rounded-full bg-[#EDE9FB] px-2.5 py-0.5 text-xs font-medium text-[#5B3FD0]">{p}</span>
                  ))}
                </div>
              </section>

              <section className={`${CARD} p-5`} aria-label="Results">
                <CardHead title="Results" subtitle="Each result can hold indicators." />
                {ordered.length === 0 ? (
                  <p className="py-8 text-center text-sm text-[#98A2B3]">No results yet. Add the goal first.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {ordered.map((r) => (
                      <li
                        key={r.id}
                        style={{ marginLeft: `${r.depth * 20}px` }}
                        className="flex items-center justify-between gap-3 rounded-lg border border-[#EEF0F4] px-3 py-2.5"
                      >
                        <div className="min-w-0">
                          <p className="text-[11px] font-medium text-[#98A2B3]">{levels[r.level] ?? `Level ${r.level + 1}`}</p>
                          <p className="truncate text-sm font-medium text-[#101828]">{r.title}</p>
                        </div>
                        <span className="shrink-0 rounded-full bg-[#F4F5F7] px-2.5 py-0.5 text-xs font-medium text-[#475467]">
                          {countFor(r.id)} {countFor(r.id) === 1 ? "indicator" : "indicators"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {isAdmin && (
                <section className={`${CARD} p-5`} aria-label="Add result">
                  <CardHead title="Add a result" subtitle="Outcomes and outputs sit under a result one level up." />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <input className={`${FIELD} sm:col-span-2`} placeholder="Result title" aria-label="Result title" value={rf.title} onChange={(e) => setRf({ ...rf, title: e.target.value })} />
                    <select className={FIELD} aria-label="Level" value={rf.level} onChange={(e) => setRf({ ...rf, level: Number(e.target.value), parentId: "" })}>
                      {levels.map((name, i) => (
                        <option key={name} value={i}>{name}</option>
                      ))}
                    </select>
                    <select className={FIELD} aria-label="Parent result" value={rf.parentId} disabled={Number(rf.level) === 0} onChange={(e) => setRf({ ...rf, parentId: e.target.value })}>
                      <option value="">{Number(rf.level) === 0 ? "No parent needed" : "Choose parent result"}</option>
                      {parents.map((p) => (
                        <option key={p.id} value={p.id}>{p.title}</option>
                      ))}
                    </select>
                  </div>
                  <button type="button" onClick={addResult} disabled={busy} className={`${BTN} mt-4`}>Add result</button>
                </section>
              )}
            </div>
          )}
        </div>
      )}
    </Page>
  );
}

export default MEFrameworks;
