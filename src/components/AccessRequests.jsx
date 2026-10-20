import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Check, CheckCircle2, Inbox, Loader2, RefreshCw, X } from "lucide-react";

import PageShell from "../../components/PageShell";
import { apiRequest } from "../../api";

/*
 * Access requests (administrators). Staff ask for another department from
 * their dashboard; approving adds them to that department's Cognito group.
 */

const formatWhen = (value) => {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};

function RequestsPage() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const data = await apiRequest("/admin/access-requests");
      setRequests(data.requests || []);
    } catch (err) {
      setError(err.message || "Unable to load requests.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const decide = async (request, decision) => {
    setBusyId(request.id);
    setError("");
    setMessage("");

    try {
      const data = await apiRequest(`/admin/access-requests/${encodeURIComponent(request.id)}`, {
        method: "PATCH",
        body: { decision },
      });

      setMessage(
        decision === "approve"
          ? `${request.email} now has access to ${request.departmentName}. They need to sign out and back in.`
          : data.message
      );
      await load();
    } catch (err) {
      setError(err.message || "Unable to save the decision.");
    } finally {
      setBusyId(null);
    }
  };

  const pending = requests.filter((r) => r.status === "pending");
  const decided = requests.filter((r) => r.status !== "pending").slice(0, 30);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-slate-500">Administration</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-[#07523F]">Access requests</h1>
          <p className="mt-1.5 max-w-xl text-sm leading-6 text-slate-600">
            Approve or deny staff who ask to see another department's files.
          </p>
        </div>

        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-[#D9E3DC] bg-white px-4 py-2.5 text-sm font-semibold hover:bg-[#F4FAF6] disabled:opacity-50"
        >
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {error && (
        <div role="alert" className="mt-5 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {message && (
        <div role="status" className="mt-5 flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
          <p>{message}</p>
        </div>
      )}

      <h2 className="mt-8 border-l-4 border-[#FF9F1C] pl-3 text-lg font-semibold text-[#07523F]">
        Waiting for a decision
      </h2>

      <section className="mt-3 overflow-hidden rounded-xl border border-[#D9E3DC] bg-white shadow-sm">
        {loading ? (
          <div className="px-5 py-12 text-center">
            <Loader2 size={26} className="mx-auto animate-spin text-[#0A6B52]" />
          </div>
        ) : pending.length === 0 ? (
          <div className="flex flex-col items-center px-5 py-12 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#D9F0E5] text-[#0A6B52]">
              <Inbox size={22} />
            </span>
            <p className="mt-3 text-sm font-semibold">No requests waiting</p>
          </div>
        ) : (
          <ul className="divide-y divide-[#EEF1EC]">
            {pending.map((request) => (
              <li key={request.id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">
                    {request.email} <span className="font-normal text-slate-500">wants</span>{" "}
                    {request.departmentName}
                  </p>
                  {request.reason && (
                    <p className="mt-1 text-sm text-slate-600">“{request.reason}”</p>
                  )}
                  <p className="mt-1 text-xs text-slate-500">{formatWhen(request.createdAt)}</p>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => decide(request, "deny")}
                    disabled={busyId === request.id}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    <X size={15} />
                    Deny
                  </button>

                  <button
                    type="button"
                    onClick={() => decide(request, "approve")}
                    disabled={busyId === request.id}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#0A6B52] px-3 py-2 text-sm font-semibold text-white hover:bg-[#07523F] disabled:opacity-50"
                  >
                    {busyId === request.id ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                    Approve
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {decided.length > 0 && (
        <>
          <h2 className="mt-8 border-l-4 border-[#FF9F1C] pl-3 text-lg font-semibold text-[#07523F]">
            Recent decisions
          </h2>

          <ul className="mt-3 divide-y divide-[#EEF1EC] overflow-hidden rounded-xl border border-[#D9E3DC] bg-white shadow-sm">
            {decided.map((request) => (
              <li key={request.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                <span>
                  {request.email} · {request.departmentName}
                </span>
                <span
                  className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                    request.status === "approved"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                      : "border-red-200 bg-red-50 text-red-800"
                  }`}
                >
                  {request.status === "approved" ? "Approved" : "Denied"}
                  {request.decidedBy ? ` by ${request.decidedBy}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

export default function AccessRequests() {
  return <PageShell adminOnly>{() => <RequestsPage />}</PageShell>;
}
