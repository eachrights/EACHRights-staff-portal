import { useCallback, useEffect, useState } from "react";
import { Plane, Check, X } from "lucide-react";

import { listTrips, financeDecideTrip } from "../travel/travelApi"; // src/pages/travel/travelApi.js

/*
 * Travel and field requests that need money wait here for Finance before they go to the CEO.
 * Shown on the Finance page to finance approvers. Renders nothing when there is nothing to review,
 * or when the API says this person is not a finance approver for travel (403).
 *
 *   <TravelFinanceQueue onToast={setToast} />
 */

const formatDate = (iso) => {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

const formatMoney = (amount, currency = "KES") => {
  try {
    return new Intl.NumberFormat("en-KE", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount || 0);
  } catch {
    return `${currency} ${Number(amount || 0).toLocaleString()}`;
  }
};

function TravelFinanceQueue({ onToast = () => {} }) {
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    listTrips({ scope: "finance" })
      .then(setTrips)
      .catch((e) => {
        if (e.status === 403) setAllowed(false); // not a finance approver for travel: hide the panel
        else onToast(e.message);
      })
      .finally(() => setLoading(false));
  }, [onToast]);

  useEffect(() => {
    load();
  }, [load]);

  const approve = async (trip) => {
    setBusyId(trip.id);
    try {
      await financeDecideTrip(trip.id, { decision: "approve" });
      onToast(`${trip.name}'s trip to ${trip.destination} approved. It now goes to the CEO.`);
      load();
    } catch (e) {
      onToast(e.message);
    } finally {
      setBusyId(null);
    }
  };

  const confirmReject = async (e) => {
    e.preventDefault();
    const note = reason.trim();
    if (!note || !rejecting) return;
    setBusyId(rejecting.id);
    try {
      await financeDecideTrip(rejecting.id, { decision: "reject", note });
      onToast(`${rejecting.name}'s trip to ${rejecting.destination} rejected.`);
      setRejecting(null);
      setReason("");
      load();
    } catch (err) {
      onToast(err.message);
    } finally {
      setBusyId(null);
    }
  };

  if (!allowed || (!loading && trips.length === 0)) return null;

  return (
    <div className="mb-8 rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center gap-3 border-b border-gray-200 p-6">
        <div className="rounded-lg bg-amber-100 p-2.5 text-amber-700">
          <Plane size={20} />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Travel requests awaiting Finance</h2>
          <p className="text-sm text-gray-500">
            Approve the cost first. Approved requests then go to the CEO. Rejected requests are closed.
          </p>
        </div>
      </div>

      {loading ? (
        <p className="p-6 text-sm text-gray-500">Loading travel requests…</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {trips.map((t) => (
            <li key={t.id} className="flex flex-col gap-3 p-6 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0">
                <p className="font-medium text-gray-900">
                  {t.name} · {t.destination}
                  <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-normal text-gray-600">{t.type}</span>
                </p>
                <p className="mt-0.5 text-sm text-gray-600">
                  {formatDate(t.from)} to {formatDate(t.to)} · {formatMoney(t.estCost, t.currency || "KES")}
                </p>
                {t.purpose && <p className="mt-1 text-sm text-gray-500">{t.purpose}</p>}
              </div>

              <div className="flex shrink-0 gap-2">
                <button
                  onClick={() => setRejecting(t)}
                  disabled={busyId === t.id}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
                >
                  <X size={16} /> Reject
                </button>
                <button
                  onClick={() => approve(t)}
                  disabled={busyId === t.id}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800 disabled:opacity-60"
                >
                  <Check size={16} /> Approve for CEO
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {rejecting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form onSubmit={confirmReject} className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="text-lg font-bold text-gray-900">Reject this trip?</h2>
            <p className="mt-1 text-sm text-gray-500">
              {rejecting.name}'s trip to {rejecting.destination} will be closed and will not go to the CEO. They will see your reason.
            </p>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="e.g. No budget left for this project."
              className="mt-4 w-full rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none focus:border-green-600 focus:ring-2 focus:ring-green-100"
              autoFocus
            />
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setRejecting(null);
                  setReason("");
                }}
                className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!reason.trim() || busyId === rejecting.id}
                className="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                Reject trip
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export default TravelFinanceQueue;
