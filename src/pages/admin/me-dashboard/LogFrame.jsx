import { useMemo, useState } from "react";
import { api } from "../../../meApi";
import { BTN, BTN_LIGHT, CARD, CardHead, FIELD } from "./Shared";
import { buildRows, exportLogframePdf, exportLogframeDocx } from "./logframeExport";

/* Logframe wording for the results levels. Impact is called Goal in a logframe. */
const TERM = { Impact: "Goal", Outcome: "Outcome", Output: "Output", Activity: "Activity" };
const term = (name) => TERM[name] || name;

const SMALL =
  "rounded-md border border-[#D0D5DD] bg-white px-2.5 py-1 text-xs font-semibold text-[#344054] transition hover:bg-[#F4F5F7] disabled:cursor-not-allowed disabled:opacity-50";

const fmtNum = (n) => {
  if (n === undefined || n === null || n === "") return "-";
  const value = Number(n);
  return Number.isFinite(value) ? value.toLocaleString() : "-";
};

const isSet = (v) => v !== undefined && v !== null && v !== "" && Number.isFinite(Number(v));

/* Activities are tracked by milestones, so they do not need an indicator to count as complete. */
const needsIndicator = (levelName) => levelName !== "Activity";

const joinField = (list, field) =>
  list.map((i) => String(i[field] || "").trim()).filter(Boolean).join("\n");

const csvCell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;

function indicatorSummary(indicator, periods) {
  const targets = indicator.targets && typeof indicator.targets === "object" ? indicator.targets : {};
  const set = periods.filter((p) => isSet(targets[p]));
  return {
    set: set.length,
    total: periods.length,
    sum: set.reduce((acc, p) => acc + Number(targets[p]), 0),
    additive: indicator.unit !== "%",
  };
}

export default function LogFrame({ frameworkId, framework, data, ordered, levels, canManage, busy, run, reload }) {
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState({ meansOfVerification: "", assumptions: "", risks: "" });
  const [linkId, setLinkId] = useState("");
  const [exporting, setExporting] = useState("");

  const periods = framework?.periods || [];
  const indicators = data?.indicators || [];

  const byResult = useMemo(() => {
    const map = new Map();
    indicators.forEach((i) => {
      const list = map.get(i.resultId) || [];
      list.push(i);
      map.set(i.resultId, list);
    });
    return map;
  }, [indicators]);

  const titleOf = useMemo(() => new Map(ordered.map((r) => [r.id, r.title])), [ordered]);

  const rowState = (r) => {
    const linked = byResult.get(r.id) || [];
    const levelName = levels[r.level] ?? "";
    const gaps = [];
    if (needsIndicator(levelName) && linked.length === 0) gaps.push("No indicator");
    if (!String(r.meansOfVerification || "").trim() && !joinField(linked, "mov")) gaps.push("No means of verification");
    return { linked, gaps };
  };

  const completeRows = ordered.filter((r) => rowState(r).gaps.length === 0).length;

  const startEdit = (r) => {
    setEditing(r.id);
    setLinkId("");
    setDraft({
      meansOfVerification: r.meansOfVerification || "",
      assumptions: r.assumptions || "",
      risks: r.risks || "",
    });
  };

  const save = (r) =>
    run(async () => {
      await api(`/me/frameworks/${frameworkId}/results/${r.id}`, {
        method: "PUT",
        body: {
          title: r.title,
          meansOfVerification: draft.meansOfVerification.trim(),
          assumptions: draft.assumptions.trim(),
          risks: draft.risks.trim(),
        },
      });
      setEditing(null);
      await reload();
    });

  /* Links an indicator to this row by pointing it at this result. */
  const link = (r) =>
    run(async () => {
      if (!linkId) throw new Error("Choose an indicator to link.");
      await api(`/me/frameworks/${frameworkId}/indicators/${linkId}/result`, {
        method: "PUT",
        body: { resultId: r.id },
      });
      setLinkId("");
      await reload();
    });

  const exportCsv = () => {
    const header = ["Level", "Narrative summary", "Indicators", "Means of verification", "Assumptions", "Risks"];
    const rows = ordered.map((r) => {
      const linked = byResult.get(r.id) || [];
      const indicatorText = linked
        .map((i) => {
          const s = indicatorSummary(i, periods);
          const target = s.set === 0 ? "targets not set" : s.additive ? `target total ${s.sum}` : "targets set";
          return `${i.name} (baseline ${i.baseline ?? "-"}; ${target})`;
        })
        .join("; ");
      return [
        term(levels[r.level] ?? `Level ${r.level + 1}`),
        r.title,
        indicatorText,
        r.meansOfVerification || "",
        r.assumptions || "",
        r.risks || "",
      ];
    });
    const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(framework?.name || "logframe").replace(/[^\w-]+/g, "-")}-logframe.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportFile = async (kind) => {
    setExporting(kind);
    try {
      const rows = buildRows({ ordered, levels, byResult, periods });
      await (kind === "pdf" ? exportLogframePdf : exportLogframeDocx)({ framework, rows });
    } catch (err) {
      window.alert(`Could not create the ${kind === "pdf" ? "PDF" : "Word"} file. ${err.message || ""}`.trim());
    } finally {
      setExporting("");
    }
  };

  if (ordered.length === 0) {
    return (
      <section className={`${CARD} p-5`} aria-label="Logical framework">
        <CardHead title="Logical framework" subtitle="Add results first. Each result becomes a row in the logframe." />
        <p className="py-8 text-center text-sm text-[#98A2B3]">No results yet. Add a goal on the Results tab to start.</p>
      </section>
    );
  }

  return (
    <section className={`${CARD} overflow-hidden`} aria-label="Logical framework">
      <div className="flex flex-wrap items-start justify-between gap-3 p-5 pb-3">
        <div className="min-w-0 flex-1">
          <CardHead
            title="Logical framework"
            subtitle="Each row is a result from your hierarchy, read from goal down to activity. Add how it is verified, what must hold true, and what could go wrong. Indicators linked to a row appear beside it."
          />
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button type="button" className={BTN_LIGHT} disabled={Boolean(exporting)} onClick={() => exportFile("pdf")}>
            {exporting === "pdf" ? "Preparing PDF" : "Download PDF"}
          </button>
          <button type="button" className={BTN_LIGHT} disabled={Boolean(exporting)} onClick={() => exportFile("docx")}>
            {exporting === "docx" ? "Preparing Word file" : "Download Word"}
          </button>
          <button type="button" className={BTN_LIGHT} onClick={exportCsv}>Download CSV</button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 px-5 pb-3 text-xs">
        <span className="rounded-full bg-[#F4F5F7] px-2.5 py-1 text-[#475467]">
          Rows: <strong>{ordered.length}</strong>
        </span>
        <span className="rounded-full bg-[#F0FAF6] px-2.5 py-1 text-[#00664E]">
          Complete: <strong>{completeRows}</strong> of {ordered.length}
        </span>
        {ordered.length - completeRows > 0 && (
          <span className="rounded-full bg-[#FBF3D0] px-2.5 py-1 text-[#7A5C00]">
            Need attention: <strong>{ordered.length - completeRows}</strong>
          </span>
        )}
      </div>

      <div className="max-h-[70vh] overflow-auto">
        <table className="w-full min-w-[980px] table-fixed text-left text-sm">
          <caption className="sr-only">Logical framework with indicators, means of verification, assumptions and risks</caption>
          <colgroup>
            <col style={{ width: "28%" }} />
            <col style={{ width: "26%" }} />
            <col style={{ width: "20%" }} />
            <col style={{ width: "26%" }} />
          </colgroup>
          <thead>
            <tr className="text-xs font-medium text-[#667085]">
              <th scope="col" className="sticky top-0 z-10 border-y border-[#E5E7EB] bg-[#F9FAFB] px-5 py-3">Narrative summary</th>
              <th scope="col" className="sticky top-0 z-10 border-y border-[#E5E7EB] bg-[#F9FAFB] px-3 py-3">Indicators</th>
              <th scope="col" className="sticky top-0 z-10 border-y border-[#E5E7EB] bg-[#F9FAFB] px-3 py-3">Means of verification</th>
              <th scope="col" className="sticky top-0 z-10 border-y border-[#E5E7EB] bg-[#F9FAFB] px-5 py-3">Assumptions and risks</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((r) => {
              const levelName = levels[r.level] ?? `Level ${r.level + 1}`;
              const { linked, gaps } = rowState(r);
              /* Indicators already carry their own means of verification and assumptions; show them when the row has none */
              const indMeans = joinField(linked, "mov");
              const indAssumptions = joinField(linked, "assumptions");
              const isEditing = editing === r.id;
              const linkable = indicators.filter((i) => i.resultId !== r.id);

              return (
                <tr key={r.id} className="border-t border-[#F2F4F7] align-top">
                  <td className="px-5 py-3">
                    <div style={{ paddingLeft: `${r.depth * 14}px` }}>
                      <p className="text-[11px] font-medium text-[#98A2B3]">{term(levelName)}</p>
                      <p className="mt-0.5 font-medium leading-5 text-[#101828]">{r.title}</p>
                      {gaps.length > 0 && (
                        <p className="mt-1.5 text-[11px] text-[#9A6700]">{gaps.join(". ")}.</p>
                      )}
                      {canManage && (
                        <div className="mt-2 flex gap-2">
                          {isEditing ? (
                            <>
                              <button type="button" className={SMALL} disabled={busy} onClick={() => save(r)}>Save</button>
                              <button type="button" className={SMALL} onClick={() => setEditing(null)}>Cancel</button>
                            </>
                          ) : (
                            <button type="button" className={SMALL} disabled={busy} aria-label={`Edit logframe row for ${r.title}`} onClick={() => startEdit(r)}>
                              Edit row
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </td>

                  <td className="px-3 py-3">
                    {linked.length === 0 ? (
                      <p className="text-xs text-[#98A2B3]">{needsIndicator(levelName) ? "No indicators linked." : "Not required for activities."}</p>
                    ) : (
                      <ul className="space-y-2">
                        {linked.map((i) => {
                          const s = indicatorSummary(i, periods);
                          return (
                            <li key={i.id} className="rounded-md border border-[#EEF0F4] px-2.5 py-2">
                              <p className="text-[13px] font-medium leading-5 text-[#101828]">
                                {i.name}
                                {i.unit ? <span className="ml-2 rounded bg-[#F2F4F7] px-1.5 py-0.5 text-[11px] font-normal text-[#475467]">{i.unit}</span> : null}
                              </p>
                              <p className="mt-0.5 text-[11px] text-[#667085]">
                                Baseline {fmtNum(i.baseline)}
                                {" "}
                                {s.set === 0
                                  ? "· Targets not set"
                                  : s.additive
                                    ? `· Target total ${fmtNum(s.sum)}`
                                    : `· ${s.set} of ${s.total} targets set`}
                                {s.set > 0 && s.set < s.total ? ` (${s.total - s.set} missing)` : ""}
                              </p>
                            </li>
                          );
                        })}
                      </ul>
                    )}

                    {isEditing && (
                      <div className="mt-3">
                        <label className="block text-xs font-medium text-[#667085]" htmlFor={`link-${r.id}`}>Link an indicator to this row</label>
                        <div className="mt-1 flex gap-2">
                          <select id={`link-${r.id}`} className={`${FIELD} min-w-0 flex-1`} value={linkId} onChange={(e) => setLinkId(e.target.value)}>
                            <option value="">Choose an indicator</option>
                            {linkable.map((i) => (
                              <option key={i.id} value={i.id}>
                                {i.name} (now under {titleOf.get(i.resultId) || "no result"})
                              </option>
                            ))}
                          </select>
                          <button type="button" className={SMALL} disabled={busy || !linkId} onClick={() => link(r)}>Link</button>
                        </div>
                        <p className="mt-1 text-[11px] text-[#667085]">An indicator measures one result, so linking moves it from its current row.</p>
                      </div>
                    )}
                  </td>

                  <td className="px-3 py-3">
                    {isEditing ? (
                      <textarea
                        rows={4}
                        maxLength={500}
                        className={`${FIELD} w-full`}
                        aria-label={`Means of verification for ${r.title}`}
                        placeholder="Where the data comes from, for example household survey, clinic registers"
                        value={draft.meansOfVerification}
                        onChange={(e) => setDraft({ ...draft, meansOfVerification: e.target.value })}
                      />
                    ) : r.meansOfVerification ? (
                      <p className="whitespace-pre-line text-[13px] leading-5 text-[#475467]">{r.meansOfVerification}</p>
                    ) : indMeans ? (
                      <div>
                        <p className="whitespace-pre-line text-[13px] leading-5 text-[#475467]">{indMeans}</p>
                        <p className="mt-1 text-[11px] text-[#98A2B3]">From the linked indicators</p>
                      </div>
                    ) : (
                      <p className="text-xs text-[#98A2B3]">Not set</p>
                    )}
                  </td>

                  <td className="px-5 py-3">
                    {isEditing ? (
                      <div className="space-y-2">
                        <label className="block text-xs font-medium text-[#667085]">
                          Assumptions
                          <textarea
                            rows={3}
                            maxLength={500}
                            className={`${FIELD} mt-1 w-full`}
                            placeholder="What must hold true for this level to lead to the next"
                            value={draft.assumptions}
                            onChange={(e) => setDraft({ ...draft, assumptions: e.target.value })}
                          />
                        </label>
                        <label className="block text-xs font-medium text-[#667085]">
                          Risks
                          <textarea
                            rows={3}
                            maxLength={500}
                            className={`${FIELD} mt-1 w-full`}
                            placeholder="What could prevent this from being achieved"
                            value={draft.risks}
                            onChange={(e) => setDraft({ ...draft, risks: e.target.value })}
                          />
                        </label>
                      </div>
                    ) : r.assumptions || indAssumptions || r.risks ? (
                      <dl className="space-y-2 text-[13px] leading-5">
                        {r.assumptions || indAssumptions ? (
                          <div>
                            <dt className="text-[11px] font-medium text-[#98A2B3]">
                              Assumptions{!r.assumptions ? " (from the linked indicators)" : ""}
                            </dt>
                            <dd className="whitespace-pre-line text-[#475467]">{r.assumptions || indAssumptions}</dd>
                          </div>
                        ) : null}
                        {r.risks ? (
                          <div>
                            <dt className="text-[11px] font-medium text-[#98A2B3]">Risks</dt>
                            <dd className="whitespace-pre-line text-[#475467]">{r.risks}</dd>
                          </div>
                        ) : null}
                      </dl>
                    ) : (
                      <p className="text-xs text-[#98A2B3]">Not set</p>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
