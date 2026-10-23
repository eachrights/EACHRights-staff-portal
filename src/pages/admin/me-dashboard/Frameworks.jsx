import { useEffect, useState } from "react";
import { DEPARTMENT_AREAS, PROGRAM_AREAS, getAccess } from "../../../access";
import { api } from "../../../meApi";
import { BTN, BTN_LIGHT, CARD, CardHead, ErrorBar, FIELD, NoFramework, Page, PageHead, useMEData } from "./Shared";

const AREAS = [...PROGRAM_AREAS, ...DEPARTMENT_AREAS];
const areaName = (slug) => AREAS.find((a) => a.slug === slug)?.name || slug || "No area";
const DEFAULT_LEVELS = ["Goal", "Outcome", "Output"];

const DANGER =
  "rounded-lg border border-[#FDA29B] bg-white px-3.5 py-2 text-sm font-semibold text-[#B42318] transition hover:bg-[#FEF3F2] disabled:cursor-not-allowed disabled:opacity-60";
const SMALL =
  "rounded-md border border-[#D0D5DD] bg-white px-2.5 py-1 text-xs font-semibold text-[#344054] transition hover:bg-[#F4F5F7] disabled:cursor-not-allowed disabled:opacity-50";
const SMALL_DANGER =
  "rounded-md border border-[#FDA29B] bg-white px-2.5 py-1 text-xs font-semibold text-[#B42318] transition hover:bg-[#FEF3F2] disabled:cursor-not-allowed disabled:opacity-50";

function MEFrameworks() {
  const { isAdmin, frameworks, selectedId, setSelectedId, data, fw, ordered, busy, error, run, loadList, reload } = useMEData();
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: "", donor: "", area: AREAS[0]?.slug || "", periods: "2026-Q1, 2026-Q2, 2026-Q3, 2026-Q4" });
  const [rf, setRf] = useState({ title: "", level: 0, parentId: "" });
  const [editingFw, setEditingFw] = useState(false);
  const [fwDraft, setFwDraft] = useState({ name: "", donor: "", area: "" });
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

  const createFramework = () =>
    run(async () => {
      const periods = form.periods.split(",").map((p) => p.trim()).filter(Boolean);
      if (!form.name.trim()) throw new Error("Give the framework a name.");
      if (periods.length === 0) throw new Error("Add at least one reporting period.");
      const { id } = await api("/me/frameworks", {
        method: "POST",
        body: { name: form.name.trim(), donor: form.donor.trim(), area: newArea, periods },
      });
      setShowNew(false);
      setForm((f) => ({ ...f, name: "", donor: "" }));
      await loadList(id);
    });

  const startEditFramework = () => {
    setFwDraft({ name: fw.name, donor: fw.donor || "", area: fw.area });
    setEditingFw(true);
  };

  const saveFramework = () =>
    run(async () => {
      if (!fwDraft.name.trim()) throw new Error("Give the framework a name.");
      await api(`/me/frameworks/${selectedId}`, {
        method: "PUT",
        body: { name: fwDraft.name.trim(), donor: fwDraft.donor.trim(), area: fwDraft.area },
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
      if (Number(rf.level) > 0 && !rf.parentId) throw new Error("Choose the result this sits under.");
      await api(`/me/frameworks/${selectedId}/results`, {
        method: "POST",
        body: { title: rf.title.trim(), level: Number(rf.level), ...(rf.parentId ? { parentId: rf.parentId } : {}) },
      });
      setRf({ title: "", level: rf.level, parentId: rf.parentId });
      await reload();
    });

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
          <CardHead title="New framework" subtitle="Periods are comma separated, for example 2026-Q1, 2026-Q2." />
          <div className="grid gap-3 sm:grid-cols-2">
            <input className={FIELD} placeholder="Framework name" aria-label="Framework name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className={FIELD} placeholder="Donor" aria-label="Donor" value={form.donor} onChange={(e) => setForm({ ...form, donor: e.target.value })} />
            <select className={FIELD} aria-label="Area" value={newArea} onChange={(e) => setForm({ ...form, area: e.target.value })}>
              {myAreas.map((a) => (
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
                      onClick={() => {
                        setSelectedId(f.id);
                        setEditingFw(false);
                        setEditingResult(null);
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
                      <select className={FIELD} aria-label="Area" value={fwDraft.area} onChange={(e) => setFwDraft({ ...fwDraft, area: e.target.value })}>
                        {myAreas.map((a) => (
                          <option key={a.slug} value={a.slug}>{a.name}</option>
                        ))}
                      </select>
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
                  </>
                )}
              </section>

              <section className={`${CARD} p-5`} aria-label="Results">
                <CardHead title="Results" subtitle="Each result can hold indicators. A result can only be deleted once nothing sits under it." />
                {ordered.length === 0 ? (
                  <p className="py-8 text-center text-sm text-[#98A2B3]">No results yet. Add the goal first.</p>
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
                            <p className="truncate text-sm font-medium text-[#101828]">{r.title}</p>
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

              {canManage && (
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
