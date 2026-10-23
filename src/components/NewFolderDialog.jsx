import { useEffect, useId, useRef, useState } from "react";
import { FolderPlus, Loader2, AlertCircle, X } from "lucide-react";
import { MAX_NAME_LENGTH, validateFolderName } from "./folderUtils";

/*
 * NewFolderDialog
 *
 * Creates a folder inside the folder you're currently viewing.
 *
 * Props
 *   open           boolean
 *   onClose        () => void
 *   parentPrefix   key of the current folder, e.g. "programs/gender-justice/"
 *                  (use "" for the top level)
 *   parentLabel    optional friendly name of the current folder, shown in the
 *                  dialog. Falls back to parentPrefix.
 *   onCreate       async (prefix) => void   receives the full key, e.g.
 *                  "programs/gender-justice/2026-reports/". Throw an Error to
 *                  show its message inside the dialog.
 */

function NewFolderDialog({ open, onClose, parentPrefix = "", parentLabel, onCreate }) {
  const titleId = useId();
  const inputId = useId();
  const hintId = useId();
  const inputRef = useRef(null);
  const returnFocusRef = useRef(null);

  const [rawName, setRawName] = useState("");
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState("");

  // Reset every time the dialog opens, and remember where focus was
  useEffect(() => {
    if (!open) return undefined;

    returnFocusRef.current = document.activeElement;
    setRawName("");
    setTouched(false);
    setSaving(false);
    setSubmitError("");

    const id = window.setTimeout(() => inputRef.current?.focus(), 0);

    return () => {
      window.clearTimeout(id);
      returnFocusRef.current?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;

    const onKeyDown = (event) => {
      if (event.key === "Escape" && !saving) onClose();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, saving, onClose]);

  if (!open) return null;

  const { name, error } = validateFolderName(rawName);
  const fullPrefix = name && !error ? `${parentPrefix}${name}/` : "";
  const showError = touched && error;
  const location = parentLabel || parentPrefix || "this location";

  const handleSubmit = async (event) => {
    event.preventDefault();
    setTouched(true);
    setSubmitError("");

    if (error) return;

    setSaving(true);

    try {
      await onCreate(fullPrefix);
      setSaving(false);
      onClose();
    } catch (err) {
      setSaving(false);
      setSubmitError(err?.message || "Unable to create this folder. Try again.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
      <div
        className="absolute inset-0 bg-[#16211C]/50"
        onClick={() => !saving && onClose()}
        aria-hidden="true"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full max-w-md rounded-xl border border-[#DDE2DB] bg-white shadow-xl"
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-6">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#FBF4E4] text-[#C8963E]">
              <FolderPlus size={20} />
            </span>
            <h2 id={titleId} className="text-lg font-semibold text-[#0F3D2E]">
              New folder
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
            className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C8963E] disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate className="px-6 pb-6 pt-5">
          <p className="text-sm text-slate-600">
            Create a folder inside{" "}
            <span className="font-semibold text-[#16211C]">{location}</span>.
          </p>

          <div className="mt-4">
            <label htmlFor={inputId} className="block text-sm font-medium">
              Folder name
            </label>
            <input
              id={inputId}
              ref={inputRef}
              type="text"
              value={rawName}
              onChange={(event) => setRawName(event.target.value)}
              onBlur={() => setTouched(true)}
              disabled={saving}
              maxLength={MAX_NAME_LENGTH + 20}
              autoComplete="off"
              aria-invalid={showError ? "true" : "false"}
              aria-describedby={hintId}
              placeholder="2026 reports"
              className={`mt-1.5 w-full rounded-lg border bg-white px-3 py-2.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C8963E] ${
                showError ? "border-red-400" : "border-[#DDE2DB]"
              }`}
            />

            <p
              id={hintId}
              className={`mt-1.5 break-all text-xs ${showError ? "text-red-700" : "text-slate-500"}`}
            >
              {showError
                ? error
                : fullPrefix
                ? `Will be created as ${fullPrefix}`
                : "Folder names can use letters, numbers, spaces and hyphens."}
            </p>
          </div>

          {submitError && (
            <div
              role="alert"
              className="mt-4 flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
            >
              <AlertCircle size={17} className="mt-0.5 shrink-0" />
              <p className="min-w-0 flex-1">{submitError}</p>
            </div>
          )}

          <div className="mt-6 flex justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-lg border border-[#DDE2DB] bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-[#F5F6F2] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C8963E] disabled:opacity-50"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-[#0F3D2E] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#0B2F23] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C8963E] disabled:opacity-60"
            >
              {saving && <Loader2 size={16} className="animate-spin" />}
              {saving ? "Creating..." : "Create folder"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default NewFolderDialog;
