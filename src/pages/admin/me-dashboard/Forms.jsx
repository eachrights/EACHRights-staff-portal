import { useEffect, useState } from "react";
import { api } from "../../../meApi";
import {
  BTN, CARD, ErrorBar, FIELD, FrameworkSelect, NoFramework, Page, PageHead, PeriodTabs, StatusPill, useMEData,
} from "./Shared";

/* One data-collection form per reporting period: every indicator with a target, in one place.
   Each indicator can also be broken down (by sex, age group and so on) using the
   disaggregation types the administrator has set up, and can carry evidence
   (uploaded files and links) that backs up the reported value.
   An approved value is locked, but it can be corrected: the correction needs a note for the
   administrator, and goes back to "awaiting approval". */

const isEmpty = (v) => v === "" || v === undefined || v === null;

/* Recognise a configured gender/sex disaggregation without assuming its ID or categories. */
const isGenderType = (type) =>
  /\b(gender|sex)\b/i.test(
    [type?.name, type?.slug, type?.code, type?.key].filter(Boolean).join(" ")
  );

const SMALL =
  "rounded-md border border-[#D0D5DD] bg-white px-2.5 py-1 text-xs font-semibold text-[#344054] transition hover:bg-[#F4F5F7] disabled:cursor-not-allowed disabled:opacity-50";
const SMALL_DANGER =
  "rounded-md border border-[#FDA29B] bg-white px-2.5 py-1 text-xs font-semibold text-[#B42318] transition hover:bg-[#FEF3F2] disabled:cursor-not-allowed disabled:opacity-50";

/* Evidence files: the same limits the API enforces */
const MAX_EVIDENCE = 10;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const FILE_TYPES = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  csv: "text/csv",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};
const ACCEPT = Object.keys(FILE_TYPES).map((e) => `.${e}`).join(",");
const contentTypeOf = (file) => {
  const ext = file.name.split(".").pop().toLowerCase();
  return FILE_TYPES[ext] || "";
};

/* The total of the numbers filled in for one breakdown type */
const sumOf = (cats, type) =>
  type.categories.filter((c) => !isEmpty(cats?.[c])).reduce((s, c) => s + Number(cats[c]), 0);

/* The breakdown that drives the actual value: the first type (gender first) with any number in it */
const driverType = (breakdown, types) =>
  types.find((t) => t.categories.some((c) => !isEmpty(breakdown?.[t.id]?.[c])));

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
  const [evOpen, setEvOpen] = useState({});
  const [links, setLinks] = useState({});
  const [correcting, setCorrecting] = useState({});
  const [uploading, setUploading] = useState(null);
  const [types, setTypes] = useState([]);
  const [typesVersion, setTypesVersion] = useState(0);
  const [setupCats, setSetupCats] = useState("");

  useEffect(() => {
    setDrafts({});
    setOpen({});
    setEvOpen({});
    setLinks({});
    setCorrecting({});
  }, [selectedId, period]);

  /* Disaggregation categories are administrator-configured. Gender/sex is prioritised
     and automatically expanded when available; no categories are invented in the UI. */
  useEffect(() => {
    let mounted = true;
    api("/me/disaggregations")
      .then((r) => {
        if (!mounted) return;
        const configured = r.disaggregations || [];
        setTypes([...configured.filter(isGenderType), ...configured.filter((type) => !isGenderType(type))]);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [typesVersion]);

  /* Administrator: add the Gender type with the categories they choose */
  const addGenderType = () =>
    run(async () => {
      const categories = [...new Set(setupCats.split(",").map((c) => c.trim()).filter(Boolean))];
      if (categories.length < 2) throw new Error("Add at least two categories, separated by commas.");
      await api("/me/disaggregations", { method: "POST", body: { name: "Gender", categories } });
      setSetupCats("");
      setTypesVersion((v) => v + 1);
    });

  const expected = rows.filter((r) => r.target !== undefined);
  const groups = ordered
    .map((res) => ({ res, items: expected.filter((r) => r.result.id === res.id) }))
    .filter((g) => g.items.length > 0);

  const draftFor = (ind, saved) =>
    drafts[ind.id] ?? {
      actual: saved?.actual ?? "",
      comment: saved?.comment ?? "",
      breakdown: saved?.breakdown ?? {},
      evidence: saved?.evidence ?? [],
      correctionNote: "",
    };
  const setDraft = (ind, saved, patch) =>
    setDrafts((cur) => ({ ...cur, [ind.id]: { ...draftFor(ind, saved), ...patch } }));
  /* Typing a breakdown number also fills the actual value: it becomes the total of the
     driving breakdown (gender first), so the two can never disagree. */
  const setCell = (ind, saved, typeId, category, value) => {
    const current = draftFor(ind, saved).breakdown || {};
    const next = { ...current, [typeId]: { ...(current[typeId] || {}), [category]: value } };
    const driver = driverType(next, types);
    setDraft(ind, saved, {
      breakdown: next,
      ...(driver ? { actual: String(sumOf(next[driver.id], driver)) } : {}),
    });
  };

  /* An approved value is only included once the person has chosen to correct it */
  const pending = expected.filter(
    (r) =>
      (r.saved?.status !== "approved" || correcting[r.ind.id]) &&
      drafts[r.ind.id] &&
      drafts[r.ind.id].actual !== ""
  );

  /* ---------- Corrections ---------- */

  const startCorrection = (ind) => {
    setCorrecting((cur) => ({ ...cur, [ind.id]: true }));
    setEvOpen((cur) => ({ ...cur, [ind.id]: true }));
  };

  const cancelCorrection = (ind) => {
    setCorrecting((cur) => {
      const { [ind.id]: _gone, ...rest } = cur;
      return rest;
    });
    setDrafts((cur) => {
      const { [ind.id]: _gone, ...rest } = cur;
      return rest;
    });
  };

  /* ---------- Evidence ---------- */

  const addEvidence = (ind, saved, item) => {
    const current = draftFor(ind, saved).evidence || [];
    if (current.length >= MAX_EVIDENCE) throw new Error(`A value can have at most ${MAX_EVIDENCE} pieces of evidence.`);
    setDraft(ind, saved, { evidence: [...current, item] });
  };

  const removeEvidence = (ind, saved, index) =>
    setDraft(ind, saved, { evidence: (draftFor(ind, saved).evidence || []).filter((_, i) => i !== index) });

  /* Upload straight to storage with a short-lived link from the API, then attach the file to the value */
  const uploadFile = (ind, saved, file) =>
    run(async () => {
      if (!file) return;
      const contentType = contentTypeOf(file);
      if (!contentType) throw new Error("Use a PDF, JPG, PNG, CSV, Word or Excel file.");
      if (file.size > MAX_FILE_BYTES) throw new Error("Files must be 10 MB or smaller.");
      if ((draftFor(ind, saved).evidence || []).length >= MAX_EVIDENCE) {
        throw new Error(`A value can have at most ${MAX_EVIDENCE} pieces of evidence.`);
      }
      setUploading(ind.id);
      try {
        const { url, key } = await api(`/me/frameworks/${selectedId}/evidence/upload-url`, {
          method: "POST",
          body: { fileName: file.name, contentType, size: file.size },
        });
        const res = await fetch(url, { method: "PUT", headers: { "Content-Type": contentType }, body: file });
        if (!res.ok) throw new Error("The file could not be uploaded. Try again.");
        addEvidence(ind, saved, { type: "file", name: file.name, key });
      } finally {
        setUploading(null);
      }
    });

  const addLink = (ind, saved) =>
    run(async () => {
      const entry = links[ind.id] || { name: "", url: "" };
      let url;
      try {
        url = new URL(entry.url.trim());
      } catch {
        throw new Error("Enter a valid link, starting with https://");
      }
      if (url.protocol !== "https:") throw new Error("Links must start with https://");
      addEvidence(ind, saved, { type: "link", name: entry.name.trim() || url.hostname, url: url.toString() });
      setLinks((cur) => ({ ...cur, [ind.id]: { name: "", url: "" } }));
    });

  /* Files open through a short-lived link, so they stay private */
  const openEvidence = (item) =>
    run(async () => {
      if (item.type === "link") {
        window.open(item.url, "_blank", "noopener,noreferrer");
        return;
      }
      const tab = window.open("about:blank", "_blank");
      try {
        const { url } = await api(`/me/frameworks/${selectedId}/evidence/download-url?key=${encodeURIComponent(item.key)}`);
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

  /*
   * Values are saved one at a time. If one fails, the values that already went
   * through are cleared from the drafts and the data is reloaded, so a retry
   * only sends what is still unsaved. Breakdowns and correction notes are checked
   * first, so a mistake is caught before anything is sent.
   */
  const submitAll = () =>
    run(async () => {
      if (pending.length === 0) throw new Error("Enter at least one actual value first.");

      for (const { ind, saved } of pending) {
        const d = draftFor(ind, saved);
        const problem = breakdownProblem(d, types);
        if (problem) throw new Error(`${ind.name}: ${problem}`);
        if (saved?.status === "approved" && !d.correctionNote.trim()) {
          throw new Error(`${ind.name}: write a note for the administrator explaining the correction.`);
        }
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
              evidence: d.evidence || [],
              ...(saved?.status === "approved" ? { correctionNote: d.correctionNote.trim() } : {}),
              ...(Object.keys(breakdown).length ? { breakdown } : {}),
            },
          });
          savedIds.push(ind.id);
        }
        setDrafts({});
        setCorrecting({});
      } catch (err) {
        setDrafts((cur) => {
          const next = { ...cur };
          savedIds.forEach((id) => delete next[id]);
          return next;
        });
        setCorrecting((cur) => {
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

  /* The evidence list and the controls to add to it */
  const renderEvidence = (ind, saved, disabled) => {
    const list = draftFor(ind, saved).evidence || [];
    const link = links[ind.id] || { name: "", url: "" };
    const isUploading = uploading === ind.id;
    const full = list.length >= MAX_EVIDENCE;
    return (
      <div className="mt-3 space-y-3 rounded-lg bg-[#F9FAFB] p-4">
        {list.length === 0 ? (
          <p className="text-xs text-[#98A2B3]">No evidence yet</p>
        ) : (
          <ul className="space-y-1.5">
            {list.map((item, i) => (
              <li
                key={`${item.type}-${item.key || item.url}-${i}`}
                className="flex items-center gap-2 rounded-md border border-[#EAECF0] bg-white px-3 py-2"
              >
                <span className="rounded bg-[#F2F4F7] px-1.5 py-0.5 text-[11px] font-medium text-[#475467]">
                  {item.type === "file" ? "File" : "Link"}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-[#101828]" title={item.name}>{item.name}</span>
                <button type="button" className={SMALL} onClick={() => openEvidence(item)} aria-label={`Open ${item.name}`}>
                  Open
                </button>
                {!disabled && (
                  <button
                    type="button"
                    className={SMALL_DANGER}
                    onClick={() => removeEvidence(ind, saved, i)}
                    aria-label={`Remove ${item.name}`}
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {!disabled && (
          <div className="grid gap-3 border-t border-[#EAECF0] pt-3 sm:grid-cols-[auto_minmax(0,1fr)]">
            <div>
              <label
                className={`inline-flex cursor-pointer items-center rounded-lg border border-[#D0D5DD] bg-white px-3.5 py-2 text-sm font-semibold text-[#344054] transition hover:bg-[#F4F5F7] focus-within:ring-2 focus-within:ring-[#00664E] ${
                  isUploading || full ? "pointer-events-none opacity-50" : ""
                }`}
              >
                {isUploading ? "Uploading" : "Upload file"}
                <input
                  type="file"
                  accept={ACCEPT}
                  className="sr-only"
                  disabled={isUploading || full}
                  aria-label={`Upload evidence for ${ind.name}`}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    uploadFile(ind, saved, file);
                  }}
                />
              </label>
            </div>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto]">
              <input
                className={FIELD}
                aria-label={`Link name for ${ind.name}`}
                placeholder="Name"
                value={link.name}
                onChange={(e) => setLinks((cur) => ({ ...cur, [ind.id]: { ...link, name: e.target.value } }))}
              />
              <input
                type="url"
                className={FIELD}
                aria-label={`Link address for ${ind.name}`}
                placeholder="https://"
                value={link.url}
                onChange={(e) => setLinks((cur) => ({ ...cur, [ind.id]: { ...link, url: e.target.value } }))}
                onKeyDown={(e) => e.key === "Enter" && link.url && !full && addLink(ind, saved)}
              />
              <button type="button" className={SMALL} disabled={!link.url.trim() || full || busy} onClick={() => addLink(ind, saved)}>
                Add link
              </button>
            </div>
          </div>
        )}
        <p className="text-xs text-[#98A2B3]">
          PDF, JPG, PNG, CSV, Word or Excel, up to 10 MB each. Evidence is saved when you submit the value. The administrator cannot approve a value without evidence.
        </p>
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

          {!types.some(isGenderType) && (
            <div className="rounded-lg border border-[#F3D18A] bg-[#FFFAEB] px-4 py-3 text-sm text-[#7A5C00]" role="status">
              <p className="font-semibold">Gender disaggregation is not configured</p>
              <p className="mt-1">
                Add the categories you want people to report against, separated by commas. The gender fields then appear on every indicator, and the actual value fills in from them automatically.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  className={`${FIELD} w-full max-w-md`}
                  aria-label="Gender categories, separated by commas"
                  placeholder="Type the categories, separated by commas"
                  value={setupCats}
                  onChange={(e) => setSetupCats(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && setupCats.trim() && addGenderType()}
                />
                <button type="button" onClick={addGenderType} disabled={busy || !setupCats.trim()} className={BTN}>
                  Add gender breakdown
                </button>
              </div>
            </div>
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
                  const approved = saved?.status === "approved";
                  const isCorrecting = Boolean(correcting[ind.id]);
                  const locked = approved && !isCorrecting;
                  const disabled = !canEnter || locked || busy;
                  const hasBreakdown = Object.keys(saved?.breakdown || {}).length > 0;
                  const hasGenderType = types.some(isGenderType);
                  const isOpen = open[ind.id] ?? (hasBreakdown || hasGenderType);
                  const evidenceCount = (draft.evidence || []).length;
                  const evidenceOpen = evOpen[ind.id] ?? false;
                  const showEvidenceToggle = canEnter || evidenceCount > 0;
                  const pendingCorrection = saved?.status === "submitted" ? saved.correction : null;
                  /* Actual over target, updating as the person types */
                  const actualNum = isEmpty(draft.actual) || Number.isNaN(Number(draft.actual)) ? null : Number(draft.actual);
                  const targetNum = Number(target);
                  const pct = actualNum !== null && targetNum > 0 ? Math.round((actualNum / targetNum) * 100) : null;
                  const barColor = pct === null ? "#D9D9DF" : pct >= 90 ? "#1F7A5C" : pct >= 50 ? "#D4A600" : "#B42318";
                  return (
                    <li key={ind.id} className="py-4">
                      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_8rem_14rem_9rem] md:items-start">
                        <div>
                          <p className="text-sm font-medium text-[#101828]">{ind.name}</p>
                          <div className="mt-2 max-w-xs">
                            <div className="flex items-baseline justify-between gap-3">
                              <p className="tabular-nums">
                                <span className="text-lg font-semibold text-[#101828]">{actualNum ?? "-"}</span>
                                <span className="text-sm text-[#98A2B3]"> / {target}</span>
                                {ind.unit ? <span className="ml-1.5 text-xs text-[#667085]">{ind.unit}</span> : null}
                              </p>
                              {pct !== null && <span className="text-xs font-semibold tabular-nums text-[#475467]">{pct}%</span>}
                            </div>
                            <div
                              className="mt-1.5 h-2 overflow-hidden rounded-full bg-[#EEF0F4]"
                              role="progressbar"
                              aria-label={`Actual against ${period} target for ${ind.name}`}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-valuenow={Math.min(pct ?? 0, 100)}
                            >
                              <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(pct ?? 0, 100)}%`, backgroundColor: barColor }} />
                            </div>
                          </div>
                          <p className="mt-1.5 text-xs text-[#98A2B3]">
                            {period} target · Baseline {ind.baseline ?? "-"}
                          </p>
                          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                            {types.length > 0 && (
                              <button
                                type="button"
                                onClick={() => setOpen((cur) => ({ ...cur, [ind.id]: !isOpen }))}
                                aria-expanded={isOpen}
                                className="text-xs font-medium text-[#5B3FD0] hover:underline"
                              >
                                {isOpen ? "Hide gender and other breakdowns" : hasBreakdown ? "Show gender and other breakdowns" : "Add gender and other breakdowns"}
                              </button>
                            )}
                            {showEvidenceToggle && (
                              <button
                                type="button"
                                onClick={() => setEvOpen((cur) => ({ ...cur, [ind.id]: !evidenceOpen }))}
                                aria-expanded={evidenceOpen}
                                className="text-xs font-medium text-[#00664E] hover:underline"
                              >
                                {evidenceOpen ? "Hide evidence" : evidenceCount > 0 ? `Evidence (${evidenceCount})` : "Add evidence"}
                              </button>
                            )}
                          </div>
                        </div>
                        <div>
                          <input
                            type="number"
                            aria-label={`Actual for ${ind.name}`}
                            placeholder="Actual"
                            value={draft.actual}
                            onChange={(e) => setDraft(ind, saved, { actual: e.target.value })}
                            disabled={disabled}
                            readOnly={Boolean(driverType(draft.breakdown, types))}
                            className={`${FIELD} w-full ${driverType(draft.breakdown, types) ? "bg-[#F4F5F7]" : ""}`}
                          />
                          {driverType(draft.breakdown, types) && (
                            <p className="mt-1 text-[11px] leading-tight text-[#667085]">
                              Total of {driverType(draft.breakdown, types).name.toLowerCase()}. Clear it to type a value.
                            </p>
                          )}
                        </div>
                        <input
                          type="text"
                          aria-label={`Comment for ${ind.name}`}
                          placeholder="Comment"
                          value={draft.comment}
                          onChange={(e) => setDraft(ind, saved, { comment: e.target.value })}
                          disabled={disabled}
                          className={FIELD}
                        />
                        <div className="space-y-2 pt-1.5">
                          <StatusPill status={saved?.status} />
                          {canEnter && locked && (
                            <button type="button" className={SMALL} disabled={busy} onClick={() => startCorrection(ind)}>
                              Correct this value
                            </button>
                          )}
                        </div>
                      </div>

                      {pendingCorrection && (
                        <p className="mt-3 rounded-lg border border-[#F3D18A] bg-[#FFFAEB] px-4 py-3 text-xs text-[#7A5C00]">
                          <span className="font-semibold">Correction awaiting approval.</span> The approved value was {pendingCorrection.previous?.actual ?? "-"}.
                          {" "}Your note: {pendingCorrection.note}
                        </p>
                      )}

                      {approved && saved?.lastCorrectionRejected && !isCorrecting && (
                        <p className="mt-3 rounded-lg border border-[#FDA29B] bg-[#FEF3F2] px-4 py-3 text-xs text-[#B42318]">
                          A correction was rejected by {saved.lastCorrectionRejected.by || "the administrator"}. The approved value was kept.
                        </p>
                      )}

                      {isCorrecting && (
                        <div className="mt-3 rounded-lg border border-[#F3D18A] bg-[#FFFAEB] p-4">
                          <label className="block text-xs font-semibold text-[#7A5C00]">
                            Note for the administrator (required)
                            <textarea
                              rows={2}
                              maxLength={1000}
                              aria-label={`Correction note for ${ind.name}`}
                              className={`${FIELD} mt-1 w-full font-normal`}
                              value={draft.correctionNote}
                              onChange={(e) => setDraft(ind, saved, { correctionNote: e.target.value })}
                            />
                          </label>
                          <p className="mt-2 text-[11px] leading-snug text-[#7A5C00]">
                            When you submit, this value goes back to awaiting approval and leaves the approved results until the administrator approves it. If the correction is rejected, the earlier approved value is restored.
                          </p>
                          <button type="button" className={`${SMALL} mt-3`} onClick={() => cancelCorrection(ind)}>
                            Cancel correction
                          </button>
                        </div>
                      )}

                      {isOpen && types.length > 0 && renderBreakdown(ind, saved, disabled)}
                      {evidenceOpen && showEvidenceToggle && renderEvidence(ind, saved, disabled)}
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
