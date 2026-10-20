// Shared helpers for the new-folder dialog and the inline new-folder row.
// Kept in a plain .js file (no components) so Vite Fast Refresh keeps working.

export const MAX_NAME_LENGTH = 60;

// Letters, numbers, spaces, hyphen, underscore, dot and brackets. No slashes.
const NAME_PATTERN = /^[\p{L}\p{N} _().-]+$/u;

export function validateFolderName(raw) {
  const name = raw.trim().replace(/\s+/g, " ");

  if (!name) return { name, error: "Enter a folder name." };
  if (name.length > MAX_NAME_LENGTH)
    return { name, error: `Use ${MAX_NAME_LENGTH} characters or fewer.` };
  if (name.startsWith(".") || name.includes(".."))
    return { name, error: "The name can't start with a dot or contain two dots in a row." };
  if (!NAME_PATTERN.test(name))
    return {
      name,
      error: "Use letters, numbers, spaces, hyphens, underscores or brackets. Slashes aren't allowed.",
    };

  return { name, error: "" };
}

export function nextFolderName(existingNames = [], base = "New folder") {
  const taken = new Set(existingNames.map((n) => n.trim().toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;

  let i = 2;
  while (taken.has(`${base} (${i})`.toLowerCase())) i += 1;
  return `${base} (${i})`;
}
