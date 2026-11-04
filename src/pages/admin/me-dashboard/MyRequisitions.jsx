import { useEffect, useState } from "react";
import { api } from "../../../meApi";
import FundRequests from "./FundRequests";

/* Same tokens as FundRequests / PortfolioView */
const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5B3FD0]";
const FIELD = `rounded-lg border border-[#D0D5DD] bg-white px-3 py-2 text-sm text-[#101828] outline-none transition placeholder:text-[#98A2B3] focus:border-[#5B3FD0] focus:ring-4 focus:ring-[#5B3FD0]/15 ${FOCUS}`;

/*
  Staff entry point for financial requisitions.
  Lists the projects (frameworks) the signed-in person can raise a request
  against, then shows the FundRequests panel for the chosen one.
  What they may do inside the panel is decided by the server
  (canRaise, canEdit, canSubmit, canDecide, ...).

  GET /me/frameworks returns { frameworks: [...] } (the same shape useMEData
  reads in Shared.jsx). A bare array or { items: [...] } is also accepted.
*/
const LIST_PATH = "/me/frameworks";

function MyRequisitions() {
  const [frameworks, setFrameworks] = useState(null);
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    api(LIST_PATH)
      .then((result) => {
        if (cancelled) return;
        const items = Array.isArray(result) ? result : result?.frameworks || result?.items || [];
        setFrameworks(items);
        if (items.length === 1) setSelectedId(String(items[0].id));
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = frameworks?.find((f) => String(f.id) === selectedId) || null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-[#101828]">Financial requisitions</h1>
        <p className="mt-0.5 text-sm text-[#667085]">
          Choose a project to raise a request or follow one you have already raised.
        </p>
      </div>

      <div aria-live="polite" className="empty:hidden">
        {error && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
            {error}
          </div>
        )}
      </div>

      {!frameworks && !error && <p className="text-sm text-[#667085]">Loading projects.</p>}

      {frameworks && frameworks.length === 0 && (
        <p className="text-sm text-[#667085]">
          There are no projects you can raise a requisition against yet.
        </p>
      )}

      {frameworks && frameworks.length > 0 && (
        <label className="block text-xs font-medium text-[#475467]">
          Project
          <select
            className={`${FIELD} mt-1 block w-full max-w-sm`}
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
          >
            <option value="">Choose a project</option>
            {frameworks.map((f) => (
              <option key={f.id} value={String(f.id)}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {selected && <FundRequests key={selected.id} framework={selected} />}
    </div>
  );
}

export default MyRequisitions;
