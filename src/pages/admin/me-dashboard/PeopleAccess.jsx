import { useCallback, useEffect, useState } from "react";
import { api } from "../../../meApi";
import { LABELS, NO_ROLE, ROLES } from "../../../labels";
import { FIELD } from "./Shared";

/*
 * The people who have been given access to an initiative, and the role each one plays.
 * Access comes from Cognito (the group of the initiative's thematic area). Only the
 * administrator gives or changes roles.
 */

const initials = (name = "") =>
  name.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join("") || "?";

const ROLE_STYLE = {
  manager: "bg-[#EDE9FB] text-[#5B3FD0]",
  officer: "bg-[#E1F1EB] text-[#1F7A5C]",
  "": "bg-[#F2F4F7] text-[#667085]",
};

function PeopleAccess({ frameworkId, isAdmin }) {
  const [people, setPeople] = useState(undefined); // undefined = loading, null = could not load
  const [error, setError] = useState("");
  const [saving, setSaving] = useState("");
  const [saveError, setSaveError] = useState("");

  const load = useCallback(
    () =>
      api(`/me/frameworks/${frameworkId}/people`)
        .then((r) => {
          setPeople(r.people || []);
          setError("");
        })
        .catch((e) => {
          setError(e.message || "");
          setPeople(null);
        }),
    [frameworkId]
  );

  useEffect(() => {
    setPeople(undefined);
    load();
  }, [load]);

  const setRole = async (person, role) => {
    setSaving(person.id);
    setSaveError("");
    try {
      await api(`/me/frameworks/${frameworkId}/people/${encodeURIComponent(person.id)}/role`, {
        method: "PUT",
        body: { role },
      });
      await load();
    } catch (e) {
      setSaveError(e.message);
    } finally {
      setSaving("");
    }
  };

  const managers = Array.isArray(people) ? people.filter((p) => p.role === "manager").length : 0;
  const officers = Array.isArray(people) ? people.filter((p) => p.role === "officer").length : 0;

  return (
    <div>
      <h2 className="text-sm text-[#667085]">People managing this {LABELS.projectLower}</h2>
      <p className="text-xs text-[#98A2B3]">
        Everyone who has been given access{isAdmin ? ". You give each person their role." : ", and the role the administrator gave them."}
      </p>

      {people === undefined && <p className="mt-2 text-sm text-[#98A2B3]">Loading...</p>}
      {people === null && (
        <p className="mt-2 text-sm text-[#B42318]">Could not load the people with access{error ? `: ${error}` : "."}</p>
      )}
      {Array.isArray(people) && people.length === 0 && (
        <p className="mt-2 text-sm text-[#98A2B3]">Nobody has been given access yet.</p>
      )}

      {Array.isArray(people) && people.length > 0 && (
        <>
          <p className="mt-2 text-xs text-[#667085]">
            {managers} {managers === 1 ? ROLES.manager.toLowerCase() : `${ROLES.manager.toLowerCase()}s`}, {officers}{" "}
            {officers === 1 ? ROLES.officer.toLowerCase() : `${ROLES.officer.toLowerCase()}s`}
          </p>
          <ul className="mt-2 space-y-2.5">
            {people.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3">
                <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#EDE9FB] text-xs font-semibold text-[#5B3FD0]">
                  {initials(p.name || p.email)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-[#101828]">{p.name || p.email}</span>
                  {p.name && <span className="block truncate text-xs text-[#667085]">{p.email}</span>}
                </span>
                {isAdmin ? (
                  <select
                    aria-label={`Role of ${p.name || p.email}`}
                    className={`${FIELD} py-1.5 text-xs`}
                    value={p.role || ""}
                    disabled={saving === p.id}
                    onChange={(e) => setRole(p, e.target.value)}
                  >
                    <option value="">{NO_ROLE}</option>
                    {Object.entries(ROLES).map(([id, label]) => (
                      <option key={id} value={id}>{label}</option>
                    ))}
                  </select>
                ) : (
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${ROLE_STYLE[p.role || ""] || ROLE_STYLE[""]}`}>
                    {ROLES[p.role] || NO_ROLE}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {saveError && <p role="alert" className="mt-2 text-sm text-[#B42318]">{saveError}</p>}
    </div>
  );
}

export default PeopleAccess;
