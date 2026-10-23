import { useEffect, useRef, useState } from "react";
import { Folder, Loader2 } from "lucide-react";
import { nextFolderName, validateFolderName } from "./folderUtils";

/*
 * Windows-style "New folder"
 *
 * Click "New folder" -> a row appears at the top of the list with the name
 * "New folder" already selected. Type a name, press Enter (or click away) to
 * create it. Escape cancels.
 *
 * NewFolderRow props
 *   parentPrefix    key of the folder being viewed, e.g. "programs/gender-justice/"
 *   existingNames   names of the folders already shown, used for auto-numbering
 *                   and duplicate checks, e.g. ["2025 reports", "Budgets"]
 *   onCreate        async (prefix) => void   receives the full key,
 *                   e.g. "programs/gender-justice/New folder/". Throw an Error
 *                   to show its message under the row.
 *   onDone          () => void   called after success or cancel; hide the row here
 */

export function NewFolderRow({ parentPrefix = "", existingNames = [], onCreate, onDone }) {
  const inputRef = useRef(null);
  const busyRef = useRef(false);
  const [value, setValue] = useState(() => nextFolderName(existingNames));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  const commit = async () => {
    if (busyRef.current) return;

    const { name, error: nameError } = validateFolderName(value);
    if (nameError) {
      setError(nameError);
      inputRef.current?.focus();
      return;
    }

    const duplicate = existingNames.some((n) => n.trim().toLowerCase() === name.toLowerCase());
    if (duplicate) {
      setError("A folder with this name already exists.");
      inputRef.current?.focus();
      return;
    }

    busyRef.current = true;
    setSaving(true);
    setError("");

    try {
      await onCreate(`${parentPrefix}${name}/`);
      onDone?.();
    } catch (err) {
      busyRef.current = false;
      setSaving(false);
      setError(err?.message || "Unable to create this folder. Try again.");
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      if (!saving) onDone?.();
    }
  };

  // Clicking away commits a valid name (like Windows) and cancels an invalid one
  const handleBlur = () => {
    if (busyRef.current) return;
    const { error: nameError } = validateFolderName(value);
    const duplicate = existingNames.some(
      (n) => n.trim().toLowerCase() === value.trim().replace(/\s+/g, " ").toLowerCase()
    );
    if (nameError || duplicate) onDone?.();
    else commit();
  };

  return (
    <div>
      <div className="flex items-center gap-3 rounded-lg border border-[#C8963E] bg-[#FBF4E4]/60 px-3 py-2">
        <Folder size={20} className="shrink-0 text-[#C8963E]" aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            if (error) setError("");
          }}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          disabled={saving}
          aria-label="Folder name"
          aria-invalid={error ? "true" : "false"}
          autoComplete="off"
          className="min-w-0 flex-1 rounded border border-[#DDE2DB] bg-white px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[#C8963E]"
        />
        {saving && <Loader2 size={16} className="animate-spin text-slate-500" aria-hidden="true" />}
      </div>
      {error && (
        <p role="alert" className="mt-1 pl-11 text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

export default NewFolderRow;

/*
 * Example usage
 *
 *   const [creating, setCreating] = useState(false);
 *
 *   <button onClick={() => setCreating(true)}>New folder</button>
 *
 *   <ul>
 *     {creating && (
 *       <li>
 *         <NewFolderRow
 *           parentPrefix={currentPrefix}
 *           existingNames={folders.map((f) => f.name)}
 *           onCreate={handleCreateFolder}
 *           onDone={() => setCreating(false)}
 *         />
 *       </li>
 *     )}
 *     {folders.map(...)}
 *   </ul>
 */
