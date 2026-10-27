import { useEffect, useMemo, useState } from "react";
import { api } from "../../../meApi";
import { BTN, BTN_LIGHT, CARD, ErrorBar, FIELD, FrameworkSelect, Page, PageHead, useMEData } from "./Shared";

/*
 * A form collects data for one framework. To be useful for reporting it follows the same rules as the Forms page:
 *  - each indicator is reported as a number, so a field linked to an indicator is always a number and required
 *  - every indicator should appear once
 *  - a value cannot be approved without evidence, so a file field for evidence is worth including
 * Comment is optional. The limits below match what the API accepts.
 */

const TYPES = [
  ["text", "Short text"],
  ["number", "Number"],
  ["date", "Date"],
  ["select", "Choose one"],
  ["multiselect", "Choose several"],
  ["checkbox", "Yes or no"],
  ["file", "File"],
];
const typeLabel = (t) => TYPES.find(([k]) => k === t)?.[1] ?? t;

const MAX_FIELDS = 100;
const MAX_LABEL = 200;
const MAX_OPTION = 100;

const SMALL =
  "rounded-md border border-[#D0D5DD] bg-white px-2.5 py-1 text-xs font-semibold text-[#344054] transition hover:bg-[#F4F5F7] disabled:cursor-not-allowed disabled:opacity-50";
const SMALL_DANGER =
  "rounded-md border border-[#FDA29B] bg-white px-2.5 py-1 text-xs font-semibold text-[#B42318] transition hover:bg-[#FEF3F2] disabled:cursor-not-allowed disabled:opacity-50";

const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `f-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const blankField = () => ({ id: uid(), type: "text", label: "", required: false, options: [] });
const indicatorField = (ind) => ({ id: uid(), type: "number", label: ind.name.slice(0, MAX_LABEL), required: true, options: [], indicatorId: ind.id });
const commentField = () => ({ id: uid(), type: "text", label: "Comment", required: false, options: [] });
const evidenceField = () => ({ id: uid(), type: "file", label: "Evidence", required: true, options: [] });

/* Everything that would make the API refuse the form, or make it unhelpful for reporting */
function problemsOf(draft) {
  const problems = [];
  if (!draft.name.trim()) problems.push("Give the form a name.");
  if (draft.fields.length === 0) problems.push("Add at least one field.");
  if (draft.fields.length > MAX_FIELDS) problems.push(`A form can have at most ${MAX_FIELDS} fields.`);
  const seen = new Set();
  draft.fields.forEach((f, i) => {
    const n = i + 1;
    if (!f.label.trim()) problems.push(`Field ${n} needs a label.`);
    if ((f.type === "select" || f.type === "multiselect") && f.options.length === 0) problems.push(`Field ${n} needs at least one option.`);
    if (f.indicatorId) {
      if (seen.has(f.indicatorId)) problems.push(`Field ${n} repeats an indicator that another field already reports.`);
      seen.add(f.indicatorId);
    }
  });
  return problems;
}

function FieldEditor({ field, index, indicators, usedIndicatorIds, onChange, onRemove }) {
  const needsOptions = field.type === "select" || field.type === "multiselect";
  const linked = indicators.find((i) => i.id === field.indicatorId);

  /* Linking an indicator makes the field a required number, named after the indicator unless it already has its own label */
  const link = (indicatorId) => {
    if (!indicatorId) return onChange({ indicatorId: undefined });
    const ind = indicators.find((i) => i.id === indicatorId);
    const previous = indicators.find((i) => i.id === field.indicatorId);
    const keepLabel = field.label.trim() && field.label !== previous?.name.slice(0, MAX_LABEL);
    onChange({
      indicatorId,
      type: "number",
      required: true,
      options: [],
      label: keepLabel ? field.label : (ind?.name || "").slice(0, MAX_LABEL),
    });
  };

  return (
    <li className="py-3">
      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_9rem_13rem_auto] md:items-start">
        <input
          className={FIELD}
          placeholder="Field label"
          aria-label={`Label for field ${index + 1}`}
          maxLength={MAX_LABEL}
          value={field.label}
          onChange={(e) => onChange({ label: e.target.value })}
        />
        <select
          className={FIELD}
          aria-label={`Type of field ${index + 1}`}
          value={field.type}
          disabled={Boolean(field.indicatorId)}
          title={field.indicatorId ? "A field linked to an indicator is always a number" : undefined}
          onChange={(e) => onChange({ type: e.target.value, options: [] })}
        >
          {TYPES.map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
        <select
          className={FIELD}
          aria-label={`Indicator for field ${index + 1}`}
          value={field.indicatorId ?? ""}
          onChange={(e) => link(e.target.value)}
        >
          <option value="">Not linked to an indicator</option>
          {indicators.map((i) => (
            <option key={i.id} value={i.id} disabled={usedIndicatorIds.has(i.id) && i.id !== field.indicatorId}>
              {i.name}
              {usedIndicatorIds.has(i.id) && i.id !== field.indicatorId ? " (already used)" : ""}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-3 text-sm">
          <label className="flex items-center gap-1.5 text-[#344054]">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[#5B3FD0]"
              checked={field.required}
              onChange={(e) => onChange({ required: e.target.checked })}
            />
            Required
          </label>
          <button type="button" className={SMALL_DANGER} aria-label={`Remove field ${index + 1}`} onClick={onRemove}>Remove</button>
        </div>
      </div>

      {linked && (
        <p className="mt-1.5 text-xs text-[#667085]">
          Reported as the actual value for this indicator{linked.unit ? ` (${linked.unit})` : ""}.
        </p>
      )}
      {field.type === "file" && !linked && (
        <p className="mt-1.5 text-xs text-[#667085]">PDF, JPG, PNG, CSV, Word or Excel, up to 10 MB each.</p>
      )}
      {needsOptions && (
        <input
          className={`${FIELD} mt-2 w-full`}
          placeholder="Options, comma separated"
          aria-label={`Options for field ${index + 1}`}
          value={field.options.join(", ")}
          onChange={(e) =>
            onChange({ options: e.target.value.split(",").map((s) => s.trim().slice(0, MAX_OPTION)).filter(Boolean) })
          }
        />
      )}
    </li>
  );
}

function FormBuilder({ form, frameworkName, indicators, onSave, onCancel, busy }) {
  const [draft, setDraft] = useState(form);
  const [showProblems, setShowProblems] = useState(false);

  const patchField = (id, patch) =>
    setDraft((d) => ({ ...d, fields: d.fields.map((f) => (f.id === id ? { ...f, ...patch } : f)) }));
  const addFields = (...added) => setDraft((d) => ({ ...d, fields: [...d.fields, ...added] }));

  const usedIndicatorIds = useMemo(() => new Set(draft.fields.map((f) => f.indicatorId).filter(Boolean)), [draft.fields]);
  const missing = indicators.filter((i) => !usedIndicatorIds.has(i.id));
  const covered = indicators.length - missing.length;
  const hasEvidence = draft.fields.some((f) => f.type === "file");
  const hasComment = draft.fields.some((f) => f.type === "text" && /comment/i.test(f.label));
  const problems = problemsOf(draft);

  const save = () => {
    if (problems.length > 0) {
      setShowProblems(true);
      return;
    }
    onSave({ ...draft, name: draft.name.trim(), description: (draft.description || "").trim() });
  };

  return (
    <section className={`${CARD} space-y-5 p-5`} aria-label="Form builder">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-medium text-[#475467] sm:col-span-2">
          Form name
          <input
            className={`${FIELD} mt-1 w-full`}
            maxLength={120}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>
        <label className="block text-xs font-medium text-[#475467] sm:col-span-2">
          Description (optional)
          <input
            className={`${FIELD} mt-1 w-full`}
            maxLength={500}
            value={draft.description || ""}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          />
        </label>
      </div>

      {/* What the data needs: which indicators this form covers, and whether it can collect evidence */}
      <div className="rounded-lg bg-[#F9FAFB] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-[#101828]">
              Covers {covered} of {indicators.length} {indicators.length === 1 ? "indicator" : "indicators"}
              {frameworkName ? <span className="font-normal text-[#667085]"> in {frameworkName}</span> : null}
            </p>
            <p className="mt-0.5 text-xs text-[#667085]">
              Each indicator is reported as a required number. A value cannot be approved without evidence.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {missing.length > 0 && (
              <button type="button" className={SMALL} onClick={() => addFields(...missing.map(indicatorField))}>
                Add {missing.length === indicators.length ? "every" : `the ${missing.length} missing`} {missing.length === 1 ? "indicator" : "indicators"}
              </button>
            )}
            {!hasEvidence && (
              <button type="button" className={SMALL} onClick={() => addFields(evidenceField())}>Add an evidence field</button>
            )}
            {!hasComment && (
              <button type="button" className={SMALL} onClick={() => addFields(commentField())}>Add a comment field</button>
            )}
          </div>
        </div>

        {indicators.length > 0 && (
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#EAECF0]" role="img" aria-label={`${covered} of ${indicators.length} indicators covered`}>
            <div className="h-full rounded-full bg-[#00664E]" style={{ width: `${(covered / indicators.length) * 100}%` }} />
          </div>
        )}
        {indicators.length === 0 && (
          <p className="mt-2 text-xs text-[#9A6700]">This framework has no indicators yet, so there is nothing to link. Add indicators first.</p>
        )}
        {!hasEvidence && <p className="mt-2 text-xs text-[#9A6700]">This form has no file field, so it cannot collect evidence.</p>}
        {missing.length > 0 && missing.length <= 5 && covered > 0 && (
          <p className="mt-2 text-xs text-[#667085]">Not covered: {missing.map((i) => i.name).join("; ")}.</p>
        )}
      </div>

      {draft.fields.length === 0 ? (
        <p className="py-4 text-center text-sm text-[#98A2B3]">No fields yet. Add an indicator, a comment or a field of your own.</p>
      ) : (
        <ul className="divide-y divide-[#F2F4F7]">
          {draft.fields.map((f, i) => (
            <FieldEditor
              key={f.id}
              field={f}
              index={i}
              indicators={indicators}
              usedIndicatorIds={usedIndicatorIds}
              onChange={(p) => patchField(f.id, p)}
              onRemove={() => setDraft((d) => ({ ...d, fields: d.fields.filter((x) => x.id !== f.id) }))}
            />
          ))}
        </ul>
      )}

      {showProblems && problems.length > 0 && (
        <ul role="alert" className="space-y-1 rounded-lg border border-[#FDA29B] bg-[#FEF3F2] px-4 py-3 text-sm text-[#B42318]">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={BTN_LIGHT}
          disabled={draft.fields.length >= MAX_FIELDS}
          onClick={() => addFields(blankField())}
        >
          Add field
        </button>
        <button type="button" className={BTN} disabled={busy} onClick={save}>Save form</button>
        <button type="button" onClick={onCancel} className="text-sm font-medium text-[#667085] hover:underline">Cancel</button>
      </div>
    </section>
  );
}

function FormLibrary() {
  const { frameworks, selectedId, setSelectedId, data, fw, busy, error, run } = useMEData();
  const [forms, setForms] = useState([]);
  const [editing, setEditing] = useState(null);

  const refresh = async () => setForms((await api("/me/forms")).forms);

  useEffect(() => {
    run(refresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const frameworkName = (id) => frameworks.find((f) => f.id === id)?.name || "";

  const save = (f) =>
    run(async () => {
      await api(f.id ? `/me/forms/${f.id}` : "/me/forms", { method: f.id ? "PUT" : "POST", body: f });
      setEditing(null);
      await refresh();
    });

  const copy = (f) =>
    run(async () => {
      await api(`/me/forms/${f.id}/copy`, { method: "POST" });
      await refresh();
    });

  const toggleTemplate = (f) => save({ ...f, isTemplate: !f.isTemplate });

  const share = (f) => {
    const who = window.prompt(
      "Share with (comma-separated department slugs or user ids)",
      (f.sharedWith ?? []).join(", ")
    );
    if (who === null) return;
    run(async () => {
      await api(`/me/forms/${f.id}/share`, {
        method: "PUT",
        body: { sharedWith: who.split(",").map((s) => s.trim()).filter(Boolean) },
      });
      await refresh();
    });
  };

  /* A form belongs to one framework, so editing it loads that framework's indicators */
  const startEdit = (f) => {
    if (f.frameworkId && f.frameworkId !== selectedId) setSelectedId(f.frameworkId);
    setEditing({ ...f, fields: f.fields.map((x) => ({ options: [], ...x })) });
  };

  const indicators = data?.indicators ?? [];
  const editingOtherFramework = editing && editing.frameworkId && editing.frameworkId !== selectedId;

  return (
    <Page>
      <PageHead title="Form library" subtitle="Build, store, copy and share data collection forms.">
        {!editing && <FrameworkSelect frameworks={frameworks} value={selectedId} onChange={setSelectedId} />}
        <button
          type="button"
          className={BTN}
          disabled={!selectedId || Boolean(editing)}
          onClick={() =>
            setEditing({ name: "", description: "", fields: [blankField()], isTemplate: false, sharedWith: [], frameworkId: selectedId })
          }
        >
          New form
        </button>
      </PageHead>

      <ErrorBar error={error} />

      {editing && editingOtherFramework && (
        <p className="text-sm text-[#667085]">Loading the indicators for {frameworkName(editing.frameworkId) || "this form's framework"}.</p>
      )}

      {editing && !editingOtherFramework && (
        <FormBuilder
          key={editing.id ?? "new"}
          form={editing}
          frameworkName={frameworkName(editing.frameworkId) || fw?.name || ""}
          indicators={indicators}
          busy={busy}
          onSave={save}
          onCancel={() => setEditing(null)}
        />
      )}

      {forms.length === 0 && !editing && (
        <div className={`${CARD} p-10 text-center text-sm text-[#667085]`}>
          No forms yet. Choose New form to build one.
        </div>
      )}

      <ul className="grid gap-3 md:grid-cols-2">
        {forms.map((f) => {
          const indicatorFields = f.fields.filter((x) => x.indicatorId).length;
          const hasEvidence = f.fields.some((x) => x.type === "file");
          return (
            <li key={f.id} className={`${CARD} p-4`}>
              <p className="text-sm font-semibold text-[#101828]">
                {f.name}
                {f.isTemplate && <span className="ml-2 rounded bg-[#EDE9FB] px-1.5 py-0.5 text-[11px] font-semibold text-[#5B3FD0]">Template</span>}
              </p>
              {f.description && <p className="mt-0.5 text-xs text-[#667085]">{f.description}</p>}
              <p className="mt-1 text-xs text-[#667085]">
                {frameworkName(f.frameworkId) ? `${frameworkName(f.frameworkId)} · ` : ""}
                {f.fields.length} {f.fields.length === 1 ? "field" : "fields"} · {indicatorFields} {indicatorFields === 1 ? "indicator" : "indicators"}
                {" · "}
                {hasEvidence ? "collects evidence" : <span className="text-[#9A6700]">no evidence field</span>}
                {" · "}shared with {(f.sharedWith ?? []).length}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className={SMALL} disabled={busy || Boolean(editing)} onClick={() => startEdit(f)}>Edit</button>
                <button type="button" className={SMALL} disabled={busy} onClick={() => copy(f)}>Make a copy</button>
                <button type="button" className={SMALL} disabled={busy} onClick={() => toggleTemplate(f)}>
                  {f.isTemplate ? "Remove template" : "Save as template"}
                </button>
                <button type="button" className={SMALL} disabled={busy} onClick={() => share(f)}>Share</button>
              </div>
            </li>
          );
        })}
      </ul>
    </Page>
  );
}

export default FormLibrary;
