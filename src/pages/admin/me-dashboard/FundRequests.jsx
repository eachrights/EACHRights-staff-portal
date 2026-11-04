import { useEffect, useState } from "react";
import { api } from "../../../meApi";

/* Same tokens as PortfolioView */
const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5B3FD0]";
const FIELD = `rounded-lg border border-[#D0D5DD] bg-white px-3 py-2 text-sm text-[#101828] outline-none transition placeholder:text-[#98A2B3] focus:border-[#5B3FD0] focus:ring-4 focus:ring-[#5B3FD0]/15 disabled:cursor-not-allowed disabled:bg-[#F4F5F7]`;
const BTN = `rounded-lg bg-[#5B3FD0] px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-[#4A31B8] disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS}`;
const BTN_SM = `rounded-md border border-[#D0D5DD] bg-white px-3 py-1.5 text-xs font-semibold text-[#344054] transition hover:bg-[#F4F5F7] disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;
const BTN_DANGER = `rounded-md border border-[#FDA29B] bg-white px-3 py-1.5 text-xs font-semibold text-[#B42318] transition hover:bg-[#FEF3F2] disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;

const STATUS = {
  draft: { label: "Draft", bg: "#F2F4F7", fg: "#475467" },
  submitted: { label: "Submitted", bg: "#FEF0C7", fg: "#93370D" },
  approved: { label: "Approved", bg: "#DCFAE6", fg: "#067647" },
  rejected: { label: "Rejected", bg: "#FEE4E2", fg: "#B42318" },
  paid: { label: "Paid", bg: "#E0EAFF", fg: "#3538CD" },
};
const STATUS_FILTERS = ["all", "draft", "submitted", "approved", "rejected", "paid"];

const num = (n) => Number(n) || 0;
const money = (n, cur) => `${cur ? `${cur} ` : ""}${num(n).toLocaleString()}`;
const day = (s) => {
  const t = s ? new Date(s).getTime() : NaN;
  return Number.isNaN(t) ? "" : new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};

function StatusPill({ status }) {
  const s = STATUS[status] ?? STATUS.draft;
  return (
    <span className="inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold" style={{ backgroundColor: s.bg, color: s.fg }}>
      {s.label}
    </span>
  );
}

/*
  Funds raised against one framework (project).
  The server decides what the signed-in person may do and returns it as
  canRaise (panel) and canEdit / canSubmit / canWithdraw / canDecide / canMarkPaid (each request),
  so the rules live in one place and this panel only reflects them.
*/
function FundRequests({ framework, onChange }) {
  const base = `/me/frameworks/${framework.id}/fund-requests`;
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState("all");
  const [form, setForm] = useState({ amount: "", purpose: "", activityId: "" });
  const [editingId, setEditingId] = useState(null);
  /* Inline note box on a row: { id, kind: "reject" | "pay", text } */
  const [inline, setInline] = useState(null);

  const load = async () => setData(await api(base));

  const run = async (task, success) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
      if (success) setNotice(success);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    run(load);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [framework.id]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  const refresh = async () => {
    await load();
    onChange?.();
  };

  const resetForm = () => {
    setForm({ amount: "", purpose: "", activityId: "" });
    setEditingId(null);
  };

  const saveForm = () =>
    run(async () => {
      const amount = Number(form.amount);
      if (!form.amount || Number.isNaN(amount) || amount <= 0) throw new Error("Enter an amount greater than zero.");
      if (!form.purpose.trim()) throw new Error("Say what the funds are for.");
      const body = { amount, purpose: form.purpose.trim(), activityId: form.activityId || "" };
      if (editingId) await api(`${base}/${editingId}`, { method: "PUT", body });
      else await api(base, { method: "POST", body });
      resetForm();
      await refresh();
    }, editingId ? "Request updated." : "Request saved as a draft. Submit it when it is ready.");

  const startEdit = (r) => {
    setEditingId(r.id);
    setForm({ amount: String(r.amount), purpose: r.purpose, activityId: r.activityId || "" });
    setInline(null);
  };

  const transition = (r, action, extra = {}, success) =>
    run(async () => {
      await api(`${base}/${r.id}/transition`, { method: "POST", body: { action, ...extra } });
      setInline(null);
      await refresh();
    }, success);

  const remove = (r) => {
    if (!window.confirm(`Delete this draft request for ${money(r.amount, data?.currency)}?\n\nThis cannot be undone.`)) return;
    run(async () => {
      await api(`${base}/${r.id}`, { method: "DELETE" });
      if (editingId === r.id) resetForm();
      await refresh();
    }, "Draft deleted.");
  };

  if (!data) {
    return (
      <div aria-live="polite">
        {error ? (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>
        ) : (
          <p className="text-sm text-[#667085]">Loading fund requests.</p>
        )}
      </div>
    );
  }

  const cur = data.currency || framework.currency || "";
  const budget = data.budget === null || data.budget === undefined || data.budget === "" ? null : num(data.budget);
  const t = data.totals ?? {};
  const pending = num(t.submitted);
  const committed = num(t.approved) + num(t.paid); // approved or already paid
  const remaining = budget === null ? null : budget - committed;
  const pendingPct = budget ? Math.min((pending / budget) * 100, 100) : 0;
  const committedPct = budget ? Math.min((committed / budget) * 100, 100) : 0;
  const requests = (data.requests ?? []).filter((r) => filter === "all" || r.status === filter);
  const activities = data.activities ?? [];
  const activityName = (id) => activities.find((a) => a.id === id)?.name;

  const figures = [
    { label: "Budget", value: budget === null ? "Not set" : money(budget, cur) },
    { label: "Awaiting approval", value: money(pending, cur) },
    { label: "Approved", value: money(committed, cur), sub: num(t.paid) > 0 ? `${money(t.paid, cur)} paid` : "" },
    { label: "Remaining", value: remaining === null ? "-" : money(remaining, cur), warn: remaining !== null && remaining < 0 },
  ];

  return (
    <div className="space-y-4">
      <div aria-live="polite" className="space-y-2 empty:hidden">
        {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>}
        {notice && <div role="status" className="rounded-lg border border-[#BFE3D3] bg-[#EEF8F3] px-4 py-2.5 text-sm text-[#1F7A5C]">{notice}</div>}
      </div>

      {/* Requested and approved against what is available */}
      <div className="rounded-lg border border-[#E5E7EB] bg-white p-4">
        <p className="text-sm font-semibold text-[#101828]">Funds for {framework.name}</p>
        <dl className="mt-3 grid gap-4 sm:grid-cols-4">
          {figures.map((f) => (
            <div key={f.label}>
              <dt className="text-xs font-medium text-[#667085]">{f.label}</dt>
              <dd className={`mt-0.5 text-lg font-semibold tabular-nums ${f.warn ? "text-[#B42318]" : "text-[#101828]"}`}>{f.value}</dd>
              {f.sub && <dd className="text-xs text-[#667085]">{f.sub}</dd>}
            </div>
          ))}
        </dl>
        {budget === null ? (
          <p className="mt-3 text-xs text-[#B54708]">
            No budget is set here, so requests are not checked against one. Set it under Edit details.
          </p>
        ) : (
          <>
            <div
              className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-[#EEF0F4]"
              role="img"
              aria-label={`${Math.round(committedPct)}% of the budget approved, a further ${Math.round(pendingPct)}% awaiting approval`}
            >
              <div style={{ width: `${committedPct}%`, backgroundColor: "#5B3FD0" }} />
              <div style={{ width: `${Math.min(pendingPct, 100 - committedPct)}%`, backgroundColor: "#D4A600" }} />
            </div>
            <p className="mt-1.5 flex flex-wrap gap-x-4 text-xs text-[#667085]">
              <span className="flex items-center gap-1.5"><span aria-hidden="true" className="h-2 w-2 rounded-full bg-[#5B3FD0]" />Approved or paid</span>
              <span className="flex items-center gap-1.5"><span aria-hidden="true" className="h-2 w-2 rounded-full bg-[#D4A600]" />Awaiting approval</span>
            </p>
          </>
        )}
      </div>

      {/* Raise or edit a request */}
      {data.canRaise && (
        <div className="rounded-lg border border-[#E5E7EB] bg-white p-4">
          <p className="text-sm font-semibold text-[#101828]">{editingId ? "Edit request" : "Raise a request"}</p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="w-40 text-xs font-medium text-[#475467]">
              Amount{cur ? ` (${cur})` : ""}
              <input
                type="number"
                min="0"
                step="any"
                className={`${FIELD} mt-1 block w-full`}
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              />
            </label>
            <label className="grow basis-64 text-xs font-medium text-[#475467]">
              Purpose
              <input
                className={`${FIELD} mt-1 block w-full`}
                placeholder="What the funds are for"
                value={form.purpose}
                onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))}
              />
            </label>
            {activities.length > 0 && (
              <label className="w-56 text-xs font-medium text-[#475467]">
                Activity (optional)
                <select
                  className={`${FIELD} mt-1 block w-full`}
                  value={form.activityId}
                  onChange={(e) => setForm((f) => ({ ...f, activityId: e.target.value }))}
                >
                  <option value="">Not linked to an activity</option>
                  {activities.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </label>
            )}
            <button type="button" className={BTN} disabled={busy} onClick={saveForm}>
              {editingId ? "Save changes" : "Save as draft"}
            </button>
            {editingId && (
              <button type="button" className={BTN_SM} onClick={resetForm}>Cancel</button>
            )}
          </div>
        </div>
      )}

      {/* The requests */}
      <div className="rounded-lg border border-[#E5E7EB] bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4">
          <p className="text-sm font-semibold text-[#101828]">Requests</p>
          <label className="flex items-center gap-2 text-xs font-medium text-[#475467]">
            Show
            <select className={`${FIELD} py-1.5`} value={filter} onChange={(e) => setFilter(e.target.value)}>
              {STATUS_FILTERS.map((s) => (
                <option key={s} value={s}>{s === "all" ? "All statuses" : STATUS[s].label}</option>
              ))}
            </select>
          </label>
        </div>

        {requests.length === 0 ? (
          <p className="px-4 pb-6 pt-4 text-center text-sm text-[#667085]">
            {(data.requests ?? []).length === 0
              ? data.canRaise
                ? "No requests yet. Raise one above."
                : "No requests yet."
              : "No requests with this status."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="mt-3 w-full min-w-[760px] text-left text-sm">
              <caption className="sr-only">Fund requests for {framework.name}</caption>
              <thead>
                <tr className="text-xs font-medium text-[#667085]">
                  <th scope="col" className="border-y border-[#E5E7EB] bg-[#F9FAFB] px-4 py-2.5 text-right">Amount</th>
                  <th scope="col" className="border-y border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2.5">Purpose</th>
                  <th scope="col" className="border-y border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2.5">Requested by</th>
                  <th scope="col" className="border-y border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2.5">Status</th>
                  <th scope="col" className="border-y border-[#E5E7EB] bg-[#F9FAFB] px-4 py-2.5"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => {
                  const over = r.status === "submitted" && remaining !== null && num(r.amount) > remaining;
                  const open = inline?.id === r.id ? inline : null;
                  return (
                    <tr key={r.id} className="border-t border-[#F2F4F7] align-top">
                      <td className="px-4 py-3 text-right font-medium tabular-nums text-[#101828]">{money(r.amount, cur)}</td>
                      <td className="max-w-[320px] px-3 py-3 text-[#344054]">
                        <p>{r.purpose}</p>
                        {(r.activityName || activityName(r.activityId)) && (
                          <p className="mt-0.5 text-xs text-[#667085]">Activity: {r.activityName || activityName(r.activityId)}</p>
                        )}
                        {r.status === "rejected" && r.decisionNote && (
                          <p className="mt-1 text-xs text-[#B42318]">Rejected: {r.decisionNote}</p>
                        )}
                        {r.status === "paid" && r.paymentRef && (
                          <p className="mt-1 text-xs text-[#667085]">Payment reference: {r.paymentRef}</p>
                        )}
                        {over && (
                          <p className="mt-1 text-xs text-[#B54708]">More than the budget remaining. It cannot be approved as it stands.</p>
                        )}
                      </td>
                      <td className="px-3 py-3 text-[#475467]">
                        <p>{r.requestedBy || "-"}</p>
                        <p className="text-xs text-[#98A2B3]">{day(r.submittedAt || r.createdAt)}</p>
                      </td>
                      <td className="px-3 py-3">
                        <StatusPill status={r.status} />
                        {r.decidedBy && (r.status === "approved" || r.status === "rejected" || r.status === "paid") && (
                          <p className="mt-1 text-xs text-[#98A2B3]">by {r.decidedBy}</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          {r.canEdit && (
                            <button type="button" className={BTN_SM} disabled={busy} aria-label={`Edit request for ${money(r.amount, cur)}`} onClick={() => startEdit(r)}>Edit</button>
                          )}
                          {r.canSubmit && (
                            <button type="button" className={BTN} disabled={busy} onClick={() => transition(r, "submit", {}, "Request submitted for approval.")}>Submit</button>
                          )}
                          {r.canWithdraw && (
                            <button type="button" className={BTN_SM} disabled={busy} onClick={() => transition(r, "withdraw", {}, "Request withdrawn. It is a draft again.")}>Withdraw</button>
                          )}
                          {r.canDecide && (
                            <>
                              <button
                                type="button"
                                className={BTN}
                                disabled={busy || over}
                                aria-label={`Approve request for ${money(r.amount, cur)}`}
                                onClick={() => transition(r, "approve", {}, "Request approved.")}
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                className={BTN_SM}
                                disabled={busy}
                                aria-label={`Reject request for ${money(r.amount, cur)}`}
                                onClick={() => setInline(open?.kind === "reject" ? null : { id: r.id, kind: "reject", text: "" })}
                              >
                                Reject
                              </button>
                            </>
                          )}
                          {r.canMarkPaid && (
                            <button
                              type="button"
                              className={BTN_SM}
                              disabled={busy}
                              aria-label={`Mark request for ${money(r.amount, cur)} as paid`}
                              onClick={() => setInline(open?.kind === "pay" ? null : { id: r.id, kind: "pay", text: "" })}
                            >
                              Mark as paid
                            </button>
                          )}
                          {r.canDelete && (
                            <button type="button" className={BTN_DANGER} disabled={busy} aria-label={`Delete draft for ${money(r.amount, cur)}`} onClick={() => remove(r)}>Delete</button>
                          )}
                        </div>

                        {open?.kind === "reject" && (
                          <div className="mt-3 flex flex-wrap items-end gap-2">
                            <label className="grow basis-48 text-xs font-medium text-[#475467]">
                              Why is it rejected?
                              <input
                                className={`${FIELD} mt-1 block w-full`}
                                value={open.text}
                                onChange={(e) => setInline({ ...open, text: e.target.value })}
                              />
                            </label>
                            <button
                              type="button"
                              className={BTN}
                              disabled={busy || !open.text.trim()}
                              onClick={() => transition(r, "reject", { note: open.text.trim() }, "Request rejected. The requester can edit and resubmit it.")}
                            >
                              Confirm reject
                            </button>
                          </div>
                        )}
                        {open?.kind === "pay" && (
                          <div className="mt-3 flex flex-wrap items-end gap-2">
                            <label className="grow basis-48 text-xs font-medium text-[#475467]">
                              Payment reference (optional)
                              <input
                                className={`${FIELD} mt-1 block w-full`}
                                value={open.text}
                                onChange={(e) => setInline({ ...open, text: e.target.value })}
                              />
                            </label>
                            <button
                              type="button"
                              className={BTN}
                              disabled={busy}
                              onClick={() => transition(r, "markPaid", { reference: open.text.trim() }, "Request marked as paid.")}
                            >
                              Confirm paid
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="h-3" />
      </div>
    </div>
  );
}

export default FundRequests;
