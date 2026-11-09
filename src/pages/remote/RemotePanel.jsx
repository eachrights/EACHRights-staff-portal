// Remote work section for the Leave tab. src/pages/remote/RemotePanel.jsx
// Used in Attendance.jsx:  <RemotePanel canApprove={canApprove} />
import { useCallback, useEffect, useState } from "react";
import { WEEKEND_DAYS, holidayName } from "../../holidays";
import { listRemoteRequests, listRemote, requestRemote, cancelRemote, decideRemote } from "./remoteApi";

/* ---------- helpers and styles (same look as Attendance.jsx) ---------- */

const DAY_MS = 86400000;
const todayKey = () => new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Nairobi" });
const addDays = (key, n) => new Date(+new Date(`${key}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const weekday = (key) => new Date(`${key}T12:00:00Z`).getUTCDay();
const fullDate = (key) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const dateRange = (from, to) => (from === to ? fullDate(from) : `${fullDate(from)} to ${fullDate(to)}`);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// Weekends and public holidays don't count
function workingDays(from, to) {
  if (!from || !to) return 0;
  let n = 0;
  for (let k = from; k <= to; k = addDays(k, 1)) {
    if (!WEEKEND_DAYS.includes(weekday(k)) && !holidayName(k)) n += 1;
  }
  return n;
}

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#008060]";
const BTN = `inline-flex items-center gap-2 rounded-lg border border-[#C9CED6] bg-white px-4 py-2 text-sm text-[#0B2B24] transition hover:bg-[#F6F7F8] disabled:opacity-60 motion-reduce:transition-none ${FOCUS}`;
const BTN_PRIMARY = `inline-flex items-center gap-2 rounded-lg border border-[#008060] bg-[#008060] px-4 py-2 text-sm text-white transition hover:bg-[#00664E] disabled:opacity-60 motion-reduce:transition-none ${FOCUS}`;
const INPUT = `rounded-lg border border-[#C9CED6] bg-white px-2.5 py-2 text-sm text-[#0B2B24] ${FOCUS}`;
const CARD = "rounded-2xl border border-[#E6ECE9] bg-white p-5";
const TH = "px-3 py-2.5 text-left text-xs font-medium text-[#667085]";

const LEAVE_STATUS_TAG = {
  pending: { text: "Waiting for approval", cls: "bg-[#FFF4E5] text-[#8A4B00]" },
  approved: { text: "Approved", cls: "bg-[#E3F3EC] text-[#00664E]" },
  rejected: { text: "Not approved", cls: "bg-[#FDECEA] text-[#8A1C14]" },
  cancelled: { text: "Cancelled", cls: "bg-[#F1F3F2] text-[#667085]" },
};

function Banner({ msg }) {
  if (!msg) return null;
  return (
    <p
      role={msg.ok ? "status" : "alert"}
      className={`mb-4 rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-[#E3F3EC] text-[#00664E]" : "bg-[#FDECEA] text-[#8A1C14]"}`}
    >
      {msg.text}
    </p>
  );
}

function Chip({ text, cls }) {
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${cls}`}>{text}</span>;
}

/* ---------- pieces ---------- */

function RemoteRequestForm({ onSent }) {
  const [form, setForm] = useState({ from: "", to: "", reason: "" });
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => {
    const v = e.target.value;
    setForm((f) => ({ ...f, [k]: v, ...(k === "from" && (!f.to || f.to < v) ? { to: v } : {}) }));
  };
  const days = workingDays(form.from, form.to);
  const backwards = !!form.from && !!form.to && form.to < form.from;

  async function onSubmit(e) {
    e.preventDefault();
    if (!form.from || !form.to || backwards) return;
    if (days === 0) {
      setMsg({ ok: false, text: "Those dates are all weekends or public holidays." });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await requestRemote({ from: form.from, to: form.to, reason: form.reason.trim() });
      setMsg({ ok: true, text: "Remote work request sent. You will see the decision in the list below." });
      setForm({ from: "", to: "", reason: "" });
      onSent();
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`${CARD} mb-6`}>
      <h3 className="font-medium">Request remote work</h3>
      <p className="mt-1 text-sm text-[#667085]">
        An administrator or the CEO will approve or decline it. Approved days show as Remote in your attendance, not Absent.
      </p>
      <div className="mt-3">
        <Banner msg={msg} />
      </div>
      <form className="flex flex-wrap items-end gap-3" onSubmit={onSubmit}>
        <label className="text-xs text-[#667085]">
          From
          <input type="date" className={`${INPUT} mt-1 block`} value={form.from} min={todayKey()} onChange={set("from")} required />
        </label>
        <label className="text-xs text-[#667085]">
          To
          <input type="date" className={`${INPUT} mt-1 block`} value={form.to} min={form.from || todayKey()} onChange={set("to")} required />
        </label>
        <label className="min-w-[200px] flex-1 text-xs text-[#667085]">
          Reason (optional)
          <input className={`${INPUT} mt-1 block w-full`} value={form.reason} onChange={set("reason")} maxLength={300} />
        </label>
        <button className={BTN_PRIMARY} disabled={busy || backwards || !form.from || !form.to}>
          {busy ? "Sending..." : "Send request"}
        </button>
      </form>
      {backwards && <p className="mt-2 text-sm text-[#8A1C14]">The end date is before the start date.</p>}
      {!backwards && form.from && form.to && (
        <p className="mt-2 text-sm text-[#475467]">
          {dateRange(form.from, form.to)}: {plural(days, "working day")}
        </p>
      )}
    </section>
  );
}

function MyRemoteRequests({ tick, onChange }) {
  const [items, setItems] = useState(null);
  const [msg, setMsg] = useState(null);
  const today = todayKey();

  useEffect(() => {
    let on = true;
    listRemoteRequests({ scope: "me" })
      .then((r) => on && setItems(r))
      .catch((e) => on && setMsg({ ok: false, text: e.message }));
    return () => {
      on = false;
    };
  }, [tick]);

  const canCancel = (r) => r.status === "pending" || (r.status === "approved" && r.from > today);

  async function onCancel(r) {
    if (!window.confirm(`Cancel your remote work request for ${dateRange(r.from, r.to)}?`)) return;
    try {
      await cancelRemote(r.id);
      onChange();
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    }
  }

  const rows = [...(items || [])].sort((a, b) => b.from.localeCompare(a.from));

  return (
    <section className={`${CARD} mb-6`}>
      <h3 className="font-medium">My remote work requests</h3>
      {msg && (
        <div className="mt-3">
          <Banner msg={msg} />
        </div>
      )}
      {!items ? (
        <p className="mt-3 text-sm text-[#667085]">Loading...</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-sm text-[#667085]">You haven&apos;t asked to work remotely yet.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-sm">
            <thead className="border-b border-[#E6ECE9] bg-[#FAFBFA]">
              <tr>
                <th className={TH}>Dates</th>
                <th className={TH}>Days</th>
                <th className={TH}>Status</th>
                <th className={TH}>Note</th>
                <th className={TH} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const tag = LEAVE_STATUS_TAG[r.status] || LEAVE_STATUS_TAG.pending;
                return (
                  <tr key={r.id} className="border-b border-[#EEF1F0] last:border-0">
                    <td className="whitespace-nowrap px-3 py-2.5">{dateRange(r.from, r.to)}</td>
                    <td className="px-3 py-2.5">{workingDays(r.from, r.to)}</td>
                    <td className="px-3 py-2.5">
                      <Chip {...tag} />
                      {r.decidedBy && r.status !== "pending" && (
                        <span className="mt-0.5 block text-xs text-[#667085]">by {r.decidedBy}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-[#667085]">{r.decisionNote || r.reason || "-"}</td>
                    <td className="px-3 py-2.5 text-right">
                      {canCancel(r) && (
                        <button className={`${BTN} px-3 py-1.5`} onClick={() => onCancel(r)}>
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// Administrators and the CEO: remote work requests waiting for a decision
function RemoteApprovals({ tick, onChange }) {
  const [items, setItems] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    let on = true;
    listRemoteRequests({ scope: "all", status: "pending" })
      .then((r) => on && setItems(r))
      .catch((e) => on && setMsg({ ok: false, text: e.message }));
    return () => {
      on = false;
    };
  }, [tick]);

  async function decide(r, decision) {
    let note = "";
    if (decision === "rejected") {
      note = window.prompt(`Reason for not approving ${r.name}'s remote work (optional)`);
      if (note === null) return;
    }
    setBusyId(r.id);
    setMsg(null);
    try {
      await decideRemote(r.id, { decision, note: note.trim() });
      setMsg({ ok: true, text: `${r.name}'s remote work ${decision === "approved" ? "approved" : "not approved"}.` });
      onChange();
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusyId(null);
    }
  }

  const rows = [...(items || [])].sort((a, b) => a.from.localeCompare(b.from));

  return (
    <section className={`${CARD} mb-6`}>
      <div className="flex items-center gap-2">
        <h3 className="font-medium">Remote work waiting for your approval</h3>
        {rows.length > 0 && <Chip text={String(rows.length)} cls="bg-[#FFF4E5] text-[#8A4B00]" />}
      </div>
      {msg && (
        <div className="mt-3">
          <Banner msg={msg} />
        </div>
      )}
      {!items ? (
        <p className="mt-3 text-sm text-[#667085]">Loading...</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-sm text-[#667085]">No requests are waiting.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead className="border-b border-[#E6ECE9] bg-[#FAFBFA]">
              <tr>
                <th className={TH}>Name</th>
                <th className={TH}>Dates</th>
                <th className={TH}>Days</th>
                <th className={TH}>Reason</th>
                <th className={TH} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-[#EEF1F0] last:border-0">
                  <td className="px-3 py-2.5 font-medium">{r.name}</td>
                  <td className="whitespace-nowrap px-3 py-2.5">{dateRange(r.from, r.to)}</td>
                  <td className="px-3 py-2.5">{workingDays(r.from, r.to)}</td>
                  <td className="px-3 py-2.5 text-[#667085]">{r.reason || "-"}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right">
                    <button className={`${BTN_PRIMARY} px-3 py-1.5`} disabled={busyId === r.id} onClick={() => decide(r, "approved")}>
                      Approve
                    </button>{" "}
                    <button className={`${BTN} px-3 py-1.5`} disabled={busyId === r.id} onClick={() => decide(r, "rejected")}>
                      Decline
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// Everyone: who is working remotely now and in the next 30 days
function WhoIsRemote({ tick }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const today = todayKey();

  useEffect(() => {
    let on = true;
    listRemote({ from: today, to: addDays(today, 30) })
      .then((r) => {
        if (!on) return;
        setError("");
        setItems(r);
      })
      .catch((e) => on && setError(e.message));
    return () => {
      on = false;
    };
  }, [today, tick]);

  const rows = [...(items || [])].sort((a, b) => a.from.localeCompare(b.from) || a.name.localeCompare(b.name));
  const nowCount = rows.filter((r) => r.from <= today && today <= r.to).length;

  return (
    <section className={CARD}>
      <div className="flex items-center gap-2">
        <h3 className="font-medium">Who is working remotely</h3>
        {nowCount > 0 && <Chip text={`${nowCount} remote now`} cls="bg-[#EEF4FF] text-[#2E5AAC]" />}
      </div>
      {error && (
        <div className="mt-3">
          <Banner msg={{ ok: false, text: error }} />
        </div>
      )}
      {!items && !error ? (
        <p className="mt-3 text-sm text-[#667085]">Loading...</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-sm text-[#667085]">Nobody has approved remote days in the next 30 days.</p>
      ) : (
        <ul className="mt-3 divide-y divide-[#EEF1F0] text-sm">
          {rows.map((r, i) => (
            <li key={`${r.userId}|${r.from}|${i}`} className="flex flex-wrap items-center gap-3 py-2.5">
              <span className="flex-1 font-medium">{r.name}</span>
              <span className="text-[#475467]">{dateRange(r.from, r.to)}</span>
              <Chip
                text={r.from <= today ? "Remote now" : "Upcoming"}
                cls={r.from <= today ? "bg-[#EEF4FF] text-[#2E5AAC]" : "bg-[#F1F3F2] text-[#667085]"}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RemotePanel({ canApprove }) {
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return (
    <>
      <h2 className="mb-3 mt-10 text-lg font-semibold">Remote work</h2>
      {canApprove && <RemoteApprovals tick={tick} onChange={refresh} />}
      <RemoteRequestForm onSent={refresh} />
      <MyRemoteRequests tick={tick} onChange={refresh} />
      <WhoIsRemote tick={tick} />
    </>
  );
}

export default RemotePanel;
