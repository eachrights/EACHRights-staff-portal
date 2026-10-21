import { useEffect, useState } from "react";
import { api } from "../../../meApi";
import {
  BTN, CARD, ErrorBar, FIELD, FrameworkSelect, NoFramework, Page, PageHead, PeriodTabs, StatusPill, useMEData,
} from "./Shared";

/* One data-collection form per reporting period: every indicator with a target, in one place. */
function MEForms() {
  const { isAdmin, canEnter, frameworks, selectedId, setSelectedId, data, fw, ordered, rows, period, setPeriod, busy, error, run, reload } = useMEData();
  const [drafts, setDrafts] = useState({});

  useEffect(() => setDrafts({}), [selectedId, period]);

  const expected = rows.filter((r) => r.target !== undefined);
  const groups = ordered
    .map((res) => ({ res, items: expected.filter((r) => r.result.id === res.id) }))
    .filter((g) => g.items.length > 0);

  const draftFor = (ind, saved) => drafts[ind.id] ?? { actual: saved?.actual ?? "", comment: saved?.comment ?? "" };
  const setDraft = (ind, saved, patch) =>
    setDrafts((cur) => ({ ...cur, [ind.id]: { ...draftFor(ind, saved), ...patch } }));

  const pending = expected.filter(
    (r) => r.saved?.status !== "approved" && drafts[r.ind.id] && drafts[r.ind.id].actual !== ""
  );

  /*
   * Values are saved one at a time. If one fails, the values that already went
   * through are cleared from the drafts and the data is reloaded, so a retry
   * only sends what is still unsaved.
   */
  const submitAll = () =>
    run(async () => {
      if (pending.length === 0) throw new Error("Enter at least one actual value first.");
      const savedIds = [];
      try {
        for (const { ind, saved } of pending) {
          const d = draftFor(ind, saved);
          await api(`/me/frameworks/${selectedId}/values`, {
            method: "PUT",
            body: { indicatorId: ind.id, period, actual: d.actual, comment: d.comment },
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
                  return (
                    <li key={ind.id} className="grid gap-3 py-4 md:grid-cols-[minmax(0,1fr)_8rem_14rem_9rem] md:items-start">
                      <div>
                        <p className="text-sm font-medium text-[#101828]">{ind.name}</p>
                        <p className="mt-0.5 text-xs text-[#667085]">
                          Target {target}{ind.unit ? ` ${ind.unit}` : ""} · Baseline {ind.baseline ?? "-"}
                        </p>
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
