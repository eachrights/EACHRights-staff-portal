import { useEffect, useState } from "react";
import { api } from "../../../meApi";
import { BTN, CARD, ErrorBar, FIELD, Page, PageHead, useMEData } from "./Shared";

const TYPES = ["text", "number", "date", "select", "multiselect", "checkbox", "file"];
const newField = () => ({ id: crypto.randomUUID(), type: "text", label: "", required: false, options: [] });

function FieldEditor({ field, onChange, onRemove, indicators }) {
  const needsOptions = field.type === "select" || field.type === "multiselect";
  return (
    <li className="grid gap-2 py-3 md:grid-cols-[minmax(0,1fr)_9rem_12rem_auto] md:items-start">
      <input
        className={FIELD}
        placeholder="Field label"
        aria-label="Field label"
        value={field.label}
        onChange={(e) => onChange({ label: e.target.value })}
      />
      <select
        className={FIELD}
        aria-label="Field type"
        value={field.type}
        onChange={(e) => onChange({ type: e.target.value })}
      >
        {TYPES.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>
      <select
        className={FIELD}
        aria-label="Linked indicator"
        value={field.indicatorId ?? ""}
        onChange={(e) => onChange({ indicatorId: e.target.value || undefined })}
      >
        <option value="">No indicator</option>
        {indicators.map((i) => (
          <option key={i.id} value={i.id}>{i.name}</option>
        ))}
      </select>
      <div className="flex items-center gap-3 text-sm">
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={field.required} onChange={(e) => onChange({ required: e.target.checked })} />
          Required
        </label>
        <button type="button" className="text-[#B42318]" onClick={onRemove}>Remove</button>
      </div>
      {needsOptions && (
        <input
          className={`${FIELD} md:col-span-4`}
          placeholder="Options, comma separated"
          aria-label="Options"
          value={field.options.join(", ")}
          onChange={(e) => onChange({ options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
        />
      )}
    </li>
  );
}

function FormBuilder({ form, indicators, onSave, onCancel, busy }) {
  const [draft, setDraft] = useState(form);
  const patchField = (id, patch) =>
    setDraft((d) => ({ ...d, fields: d.fields.map((f) => (f.id === id ? { ...f, ...patch } : f)) }));

  return (
    <section className={`${CARD} space-y-4 p-5`} aria-label="Form builder">
      <input
        className={FIELD}
        placeholder="Form name"
        aria-label="Form name"
        value={draft.name}
        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
      />
      <ul className="divide-y divide-[#F2F4F7]">
        {draft.fields.map((f) => (
          <FieldEditor
            key={f.id}
            field={f}
            indicators={indicators}
            onChange={(p) => patchField(f.id, p)}
            onRemove={() => setDraft((d) => ({ ...d, fields: d.fields.filter((x) => x.id !== f.id) }))}
          />
        ))}
      </ul>
      <div className="flex items-center gap-2">
        <button type="button" className={BTN} onClick={() => setDraft((d) => ({ ...d, fields: [...d.fields, newField()] }))}>
          Add field
        </button>
        <button type="button" className={BTN} disabled={busy || !draft.name.trim()} onClick={() => onSave(draft)}>
          Save form
        </button>
        <button type="button" onClick={onCancel} className="text-sm text-[#667085]">Cancel</button>
      </div>
    </section>
  );
}

function FormLibrary() {
  const { selectedId, data, busy, error, run } = useMEData();
  const [forms, setForms] = useState([]);
  const [editing, setEditing] = useState(null);

  const refresh = async () => setForms((await api("/me/forms")).forms);

  useEffect(() => {
    run(refresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const indicators = data?.indicators ?? [];

  return (
    <Page>
      <PageHead title="Form library" subtitle="Build, store, copy and share data collection forms.">
        <button
          type="button"
          className={BTN}
          onClick={() =>
            setEditing({ name: "", fields: [newField()], isTemplate: false, sharedWith: [], frameworkId: selectedId })
          }
        >
          New form
        </button>
      </PageHead>

      <ErrorBar error={error} />

      {editing && (
        <FormBuilder
          key={editing.id ?? "new"}
          form={editing}
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
        {forms.map((f) => (
          <li key={f.id} className={`${CARD} p-4`}>
            <p className="text-sm font-semibold text-[#101828]">
              {f.name}
              {f.isTemplate && <span className="ml-2 text-xs text-[#667085]">Template</span>}
            </p>
            <p className="mt-0.5 text-xs text-[#667085]">
              {f.fields.length} {f.fields.length === 1 ? "field" : "fields"} · shared with {(f.sharedWith ?? []).length}
            </p>
            <div className="mt-3 flex flex-wrap gap-3 text-sm">
              <button type="button" disabled={busy} onClick={() => setEditing(f)}>Edit</button>
              <button type="button" disabled={busy} onClick={() => copy(f)}>Make a copy</button>
              <button type="button" disabled={busy} onClick={() => toggleTemplate(f)}>
                {f.isTemplate ? "Remove template" : "Save as template"}
              </button>
              <button type="button" disabled={busy} onClick={() => share(f)}>Share</button>
            </div>
          </li>
        ))}
      </ul>
    </Page>
  );
}

export default FormLibrary;
