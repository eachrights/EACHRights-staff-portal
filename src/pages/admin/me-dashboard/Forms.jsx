import { useEffect, useState } from "react";
import { api } from "../../../meApi";
import {
  BTN, CARD, ErrorBar, FIELD, FrameworkSelect, NoFramework, Page, PageHead, PeriodTabs, StatusPill, useMEData,
} from "./Shared";

/* One data-collection form per reporting period: every indicator with a target, in one place.
   Each indicator can also be broken down (by sex, age group and so on) using the
   disaggregation types the administrator has set up. */

const isEmpty = (v) => v === "" || v === undefined || v === null;

/* Each type that has any numbers must add up to the actual value (the API checks this too) */
function breakdownProblem(draft, types) {
  const actual = Number(draft.actual);
  for (const t of types) {
    const cats = draft.breakdown?.[t.id] || {};
    const filled = t.categories.filter((c) => !isEmpty(cats[c]));
    if (filled.length === 0) continue;
    const sum = filled.reduce((s, c) => s + Number(cats[c]), 0);
    if (Math.abs(sum - actual) > 1e-9) return `${t.name} adds up to ${sum}, but the actual value is ${actual}.`;
  }
  return "";
}

/* Only the types and categories that have a number are sent */
function breakdownPayload(draft, types) {
  const out = {};
  for (const t of types) {
    const cats = draft.breakdown?.[t.id] || {};
    const values = {};
    for (const c of t.categories) if (!isEmpty(cats[c])) values[c] = Number(cats[c]);
    if (Object.keys(values).length) out[t.id] = values;
  }
  return out;
}

function MEForms() {
  const { isAdmin, canEnter, frameworks, selectedId, setSelectedId, data, fw, ordered, rows, period, setPeriod, busy, error, run, reload } = useMEData();
  const [drafts, setDrafts] = useState({});
  const [open, setOpen] = useState({});
  const [types, setTypes] = useState([]);

  useEffect(() => {
    setDrafts({});
    setOpen({});
  }, [selectedId, period]);

  /* Breakdown types are optional: without any, the form works as before */
  useEffect(() => {
    let mounted = true;
    api("/me/disaggregations")
      .then((r) => mounted && setTypes(r.disaggregations || []))
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const expected = rows.filter((r) => r.target !== undefined);
  const groups = ordered
    .map((res) => ({ res, items: expected.filter((r) => r.result.id === res.id) }))
    .filter((g) => g.items.length > 0);

  const draftFor = (ind, saved) =>
    drafts[ind.id] ?? { actual: saved?.actual ?? "", comment: saved?.comment ?? "", breakdown: saved?.breakdown ?? {} };
  const setDraft = (ind, saved, patch) =>
    setDrafts((cur) => ({ ...cur, [ind.id]: { ...draftFor(ind, saved), ...patch } }));
  const setCell = (ind, saved, typeId, category, value) => {
    const current = draftFor(ind, saved).breakdown || {};
    setDraft(ind, saved, {
      breakdown: { ...current, [typeId]: { ...(current[typeId] || {}), [category]: value } },
    });
  };

  const pending = expected.filter(
    (r) => r.saved?.status !== "approved" && drafts[r.ind.id] && drafts[r.ind.id].actual !== ""
  );

  /*
   * Values are saved one at a time. If one fails, the values that already went
   * through are cleared from the drafts and the data is reloaded, so a retry
   * only sends what is still unsaved. Breakdowns are checked first, so a mistake
   * is caught before anything is sent.
   */
  const submitAll = () =>
    run(async () => {
      if (pending.length === 0) throw new Error("Enter at least one actual value first.");

      for (const { ind, saved } of pending) {
        const problem = breakdownProblem(draftFor(ind, saved), types);
        if (problem) throw new Error(`${ind.name}: ${problem}`);
      }

      const savedIds = [];
      try {
        for (const { ind, saved } of pending) {
          const d = draftFor(ind, saved);
          const breakdown = breakdownPayload(d, types);
          await api(`/me/frameworks/${selectedId}/values`, {
            method: "PUT",
            body: {
              indicatorId: ind.id,
              period,
              actual: d.actual,
              comment: d.comment,
              ...(Object.keys(breakdown).length ? { breakdown } : {}),
            },
          });
          savedIds.push(ind.id);
        }
        setDrafts({});
      } catch (err) {
        setDrafts((cur) => {
          const next = { ...cur };
          savedIds.forEach((id) => delete next[id]);
          return next;
        });
        throw err;
      } finally {
        if (savedIds.length > 0) await reload();
      }
    });

  /* The breakdown inputs for one indicator */
  const renderBreakdown = (ind, saved, disabled) => {
    const draft = draftFor(ind, saved);
    return (
      <div className="mt-3 space-y-3 rounded-lg bg-[#F9FAFB] p-4">
        {types.map((t) => {
          const cats = draft.breakdown?.[t.id] || {};
          const filled = t.categories.filter((c) => !isEmpty(cats[c]));
          const sum = filled.reduce((s, c) => s + Number(cats[c]), 0);
          const matches = filled.length > 0 && !isEmpty(draft.actual) && Math.abs(sum - Number(draft.actual)) <= 1e-9;
          return (
            <fieldset key={t.id}>
              <legend className="flex w-full items-center justify-between gap-3 text-xs font-semibold text-[#344054]">
                <span>By {t.name.toLowerCase()}</span>
                {filled.length > 0 && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      matches ? "bg-[#E1F1EB] text-[#1F7A5C]" : "bg-[#FBF3D0] text-[#7A5C00]"
                    }`}
                  >
                    {sum} of {isEmpty(draft.actual) ? "?" : draft.actual}
                  </span>
                )}
              </legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {t.categories.map((c) => (
                  <label key={c} className="block text-xs text-[#667085]">
                    {c}
                    <input
                      type="number"
                      min="0"
                      aria-label={`${c} (${t.name}) for ${ind.name}`}
                      value={cats[c] ?? ""}
                      onChange={(e) => setCell(ind, saved, t.id, c, e.target.value)}
                      disabled={disabled}
                      className={`${FIELD} mt-1 w-full tabular-nums`}
                    />
                  </label>
                ))}
              </div>
            </fieldset>
          );
        })}
        <p className="text-xs text-[#98A2B3]">Each breakdown you fill in must add up to the actual value. Leave a breakdown empty to skip it.</p>
      </div>
    );
  };

  return (
    <Page>
      <PageHead title="Forms" subtitle={fw ? `Data collection form for ${fw.name}` : "Enter results for a reporting period."}>
        <FrameworkSelect frameworks={frameworks} value={selectedId} onChange={setSelectedId} />
        {fw && canEnter && (
          <button type="button" onClick={submitAll} disabled={busy || pending.length === 0} className={BTN}>
            Submit {pending.length > 0 ? `${pending.length} ` : ""}{pending.length === 1 ? "value" : "values"}
          </button>
        )}
      </PageHead>

      <ErrorBar error={error} />
      {!fw && <NoFramework isAdmin={isAdmin} busy={busy} />}

      {fw && (
        <>
          <PeriodTabs periods={fw.periods} value={period} onChange={setPeriod} />

          {!canEnter && (
            <p className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-sm text-[#667085]">
              You can view this form, but only the administrator and the owning department can enter values.
            </p>
          )}

          {groups.length === 0 && (
            <div className={`${CARD} p-10 text-center text-sm text-[#667085]`}>No indicators have a target for {period}.</div>
          )}

          {groups.map(({ res, items }) => (
            <section key={res.id} className={`${CARD} p-5`} aria-label={res.title}>
              <h2 className="text-sm font-semibold text-[#101828]">{res.title}</h2>
              <ul className="mt-3 divide-y divide-[#F2F4F7]">
                {items.map(({ ind, saved, target }) => {
                  const draft = draftFor(ind, saved);
                  const locked = saved?.status === "approved";
                  const disabled = !canEnter || locked || busy;
                  const hasBreakdown = Object.keys(saved?.breakdown || {}).length > 0;
                  const isOpen = open[ind.id] ?? hasBreakdown;
                  return (
                    <li key={ind.id} className="py-4">
                      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_8rem_14rem_9rem] md:items-start">
                        <div>
                          <p className="text-sm font-medium text-[#101828]">{ind.name}</p>
                          <p className="mt-0.5 text-xs text-[#667085]">
                            Target {target}{ind.unit ? ` ${ind.unit}` : ""} · Baseline {ind.baseline ?? "-"}
                          </p>
                          {types.length > 0 && (
                            <button
                              type="button"
                              onClick={() => setOpen((cur) => ({ ...cur, [ind.id]: !isOpen }))}
                              aria-expanded={isOpen}
                              className="mt-1.5 text-xs font-medium text-[#5B3FD0] hover:underline"
                            >
                              {isOpen ? "Hide breakdown" : hasBreakdown ? "Show breakdown" : "Add breakdown (sex, age and more)"}
                            </button>
                          )}
                        </div>
                        <input
                          type="number"
                          aria-label={`Actual for ${ind.name}`}
                          placeholder="Actual"
                          value={draft.actual}
                          onChange={(e) => setDraft(ind, saved, { actual: e.target.value })}
                          disabled={disabled}
                          className={FIELD}
                        />
                        <input
                          type="text"
                          aria-label={`Comment for ${ind.name}`}
                          placeholder="Comment"
                          value={draft.comment}
                          onChange={(e) => setDraft(ind, saved, { comment: e.target.value })}
                          disabled={disabled}
                          className={FIELD}
                        />
                        <div className="pt-1.5"><StatusPill status={saved?.status} /></div>
                      </div>

                      {isOpen && types.length > 0 && renderBreakdown(ind, saved, disabled)}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </>
      )}
    </Page>
  );
}

export default MEForms;
