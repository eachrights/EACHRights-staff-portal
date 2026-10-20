import { useEffect, useState } from "react";
import { Loader2, AlertCircle, FolderInput } from "lucide-react";

/*
 * Choose a folder to move one file into.
 *
 * folders: [{ prefix: "programs/education-justice/2027/", label: "Education Justice / 2027" }]
 * onMove(prefix) does the move and throws an Error with a readable message on failure.
 */
export function buildFolderOptions(files, roots) {
  // roots: [{ prefix, label }]. Every folder that appears in a file's key is added.
  const options = new Map(roots.map((root) => [root.prefix, root.label]));

  files.forEach((file) => {
    roots.forEach((root) => {
      if (!file.key.startsWith(root.prefix)) return;

      const parts = file.key.slice(root.prefix.length).split("/").slice(0, -1);
      let prefix = root.prefix;

      parts.forEach((part) => {
        prefix += `${part}/`;
        if (!options.has(prefix)) {
          options.set(prefix, `${root.label} / ${prefix.slice(root.prefix.length, -1).replaceAll("/", " / ")}`);
        }
      });
    });
  });

  return [...options.entries()]
    .map(([prefix, label]) => ({ prefix, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function MoveDialog({ file, folders = [], onClose, onMove }) {
  const currentPrefix = file ? file.key.slice(0, file.key.lastIndexOf("/") + 1) : "";
  const choices = folders.filter((folder) => folder.prefix !== currentPrefix);

  const [target, setTarget] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setTarget(choices[0]?.prefix || "");
    setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  useEffect(() => {
    if (!file) return undefined;

    const onKeyDown = (event) => {
      if (event.key === "Escape" && !saving) onClose();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [file, saving, onClose]);

  if (!file) return null;

  const submit = async (event) => {
    event.preventDefault();

    if (!target) return;

    setSaving(true);
    setError("");

    try {
      await onMove(target);
    } catch (err) {
      setError(err?.message || "Unable to move this file.");
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
      <div
        className="absolute inset-0 bg-[#14201A]/50"
        onClick={() => !saving && onClose()}
        aria-hidden="true"
      />

      <form
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="move-title"
        className="relative w-full max-w-md rounded-xl border border-[#D9E3DC] bg-white p-6 shadow-xl"
      >
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#E3F4EB] text-[#0A6B52]">
            <FolderInput size={20} />
          </span>

          <div className="min-w-0">
            <h2 id="move-title" className="text-lg font-semibold">
              Move file
            </h2>
            <p className="mt-1 break-all text-sm text-slate-600">{file.name}</p>
          </div>
        </div>

        {choices.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">
            There is no other folder to move this file into. Create a folder first.
          </p>
        ) : (
          <div className="mt-4">
            <label htmlFor="move-target" className="block text-sm font-medium">
              Move to
            </label>
            <select
              id="move-target"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              disabled={saving}
              className="mt-1.5 w-full rounded-lg border border-[#D9E3DC] bg-white px-3 py-2.5 text-sm"
            >
              {choices.map((folder) => (
                <option key={folder.prefix} value={folder.prefix}>
                  {folder.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="mt-4 flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
          >
            <AlertCircle size={17} className="mt-0.5 shrink-0" />
            <p className="min-w-0 flex-1">{error}</p>
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-[#D9E3DC] bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-[#F4FAF6] disabled:opacity-50"
          >
            Cancel
          </button>

          <button
            type="submit"
            disabled={saving || !target}
            className="inline-flex items-center gap-2 rounded-lg bg-[#0A6B52] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#07523F] disabled:opacity-60"
          >
            {saving && <Loader2 size={16} className="animate-spin" />}
            Move
          </button>
        </div>
      </form>
    </div>
  );
}

export default MoveDialog;
