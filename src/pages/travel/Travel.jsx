import { useCallback, useEffect, useState } from "react";
import { getAccess } from "../../access";
import { listTrips, listAway, requestTrip, cancelTrip, decideTrip } from "./travelApi";

/* ---------- date helpers (Nairobi days, kept as "YYYY-MM-DD") ---------- */

const TZ = "Africa/Nairobi";
const DAY_MS = 86400000;

const dayKey = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });
const addDays = (key, n) => new Date(+new Date(`${key}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const fullDate = (key) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
const dateRange = (from, to) => (from === to ? fullDate(from) : `${fullDate(from)} to ${fullDate(to)}`);
// Trips can run over a weekend, so every calendar day counts
const tripDays = (from, to) =>
  from && to && to >= from ? Math.round((+new Date(`${to}T12:00:00Z`) - +new Date(`${from}T12:00:00Z`)) / DAY_MS) + 1 : 0;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const money = (n) => (n || n === 0 ? `KES ${Number(n).toLocaleString("en-KE")}` : "-");

const TRIP_TYPES = ["Field visit", "Official travel", "Training or workshop", "Off-site meeting"];

const STATUS_TAG = {
  pending: { text: "Waiting for approval", cls: "bg-[#FFF4E5] text-[#8A4B00]" },
  approved: { text: "Approved", cls: "bg-[#E3F3EC] text-[#00664E]" },
  rejected: { text: "Not approved", cls: "bg-[#FDECEA] text-[#8A1C14]" },
  cancelled: { text: "Cancelled", cls: "bg-[#F1F3F2] text-[#667085]" },
};

/* ---------- shared Tailwind classes (green, same as Attendance) ---------- */

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#008060]";
const BTN = `inline-flex items-center gap-2 rounded-lg border border-[#C9CED6] bg-white px-4 py-2 text-sm text-[#0B2B24] transition hover:bg-[#F6F7F8] disabled:opacity-60 motion-reduce:transition-none ${FOCUS}`;
const BTN_PRIMARY = `inline-flex items-center gap-2 rounded-lg border border-[#008060] bg-[#008060] px-4 py-2 text-sm text-white transition hover:bg-[#00664E] disabled:opacity-60 motion-reduce:transition-none ${FOCUS}`;
const INPUT = `rounded-lg border border-[#C9CED6] bg-white px-2.5 py-2 text-sm text-[#0B2B24] ${FOCUS}`;
const CARD = "rounded-2xl border border-[#E6ECE9] bg-white p-5";
const TH = "px-3 py-2.5 text-left text-xs font-medium text-[#667085]";

/* ---------- small pieces ---------- */

function Banner({ msg }) {
  if (!msg) return null;
  return (
    <p
      role={msg.ok ? "status" : "alert"}
      className={`mb-4 rounded-lg px-3 py-2 text-sm ${
        msg.ok ? "bg-[#E3F3EC] text-[#00664E]" : "bg-[#FDECEA] text-[#8A1C14]"
      }`}
    >
      {msg.text}
    </p>
  );
}

function Chip({ text, cls }) {
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${cls}`}>{text}</span>;
}

/* ---------- request a trip ---------- */

function TripRequestForm({ onSent }) {
  const blank = { type: "Field visit", destination: "", purpose: "", from: "", to: "", estCost: "" };
  const [form, setForm] = useState(blank);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => {
    const v = e.target.value;
    setForm((f) => ({ ...f, [k]: v, ...(k === "from" && (!f.to || f.to < v) ? { to: v } : {}) }));
  };
  const days = tripDays(form.from, form.to);
  const backwards = !!form.from && !!form.to && form.to < form.from;

  async function onSubmit(e) {
    e.preventDefault();
    if (!form.from || !form.to || backwards) return;
    setBusy(true);
    setMsg(null);
    try {
      await requestTrip({
        type: form.type,
        destination: form.destination.trim(),
        purpose: form.purpose.trim(),
        from: form.from,
        to: form.to,
        estCost: form.estCost === "" ? null : Number(form.estCost),
      });
      setMsg({ ok: true, text: "Request sent. You will see the decision in the list below." });
      setForm({ ...blank, type: form.type });
      onSent();
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`${CARD} mb-6`}>
      <h3 className="font-medium">Request a trip</h3>
      <p className="mt-1 text-sm text-[#667085]">
        An administrator or the CEO will approve or decline it. Approved trips show on the calendar and explain your
        absence in attendance.
      </p>
      <div className="mt-3">
        <Banner msg={msg} />
      </div>
      <form className="flex flex-wrap items-end gap-3" onSubmit={onSubmit}>
        <label className="text-xs text-[#667085]">
          Type
          <select className={`${INPUT} mt-1 block`} value={form.type} onChange={set("type")}>
            {TRIP_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-[180px] flex-1 text-xs text-[#667085]">
          Destination
          <input
            className={`${INPUT} mt-1 block w-full`}
            value={form.destination}
            onChange={set("destination")}
            maxLength={120}
            required
          />
        </label>
        <label className="text-xs text-[#667085]">
          From
          <input type="date" className={`${INPUT} mt-1 block`} value={form.from} onChange={set("from")} required />
        </label>
        <label className="text-xs text-[#667085]">
          To
          <input type="date" className={`${INPUT} mt-1 block`} value={form.to} onChange={set("to")} required />
        </label>
        <label className="min-w-[240px] basis-full text-xs text-[#667085]">
          Purpose
          <input
            className={`${INPUT} mt-1 block w-full`}
            value={form.purpose}
            onChange={set("purpose")}
            maxLength={300}
            required
          />
        </label>
        <label className="text-xs text-[#667085]">
          Estimated cost in KES (optional)
          <input
            type="number"
            min="0"
            step="any"
            className={`${INPUT} mt-1 block w-48`}
            value={form.estCost}
            onChange={set("estCost")}
          />
        </label>
        <button className={BTN_PRIMARY} disabled={busy || backwards || !form.from || !form.to}>
          {busy ? "Sending..." : "Send request"}
        </button>
      </form>
      {backwards && <p className="mt-2 text-sm text-[#8A1C14]">The end date is before the start date.</p>}
      {!backwards && form.from && form.to && (
        <p className="mt-2 text-sm text-[#475467]">
          {dateRange(form.from, form.to)}: {plural(days, "day")}
        </p>
      )}
    </section>
  );
}

/* ---------- my trips ---------- */

function MyTrips({ tick, onChange }) {
  const [items, setItems] = useState(null);
  const [msg, setMsg] = useState(null);
  const today = dayKey(new Date().toISOString());

  useEffect(() => {
    let on = true;
    listTrips({ scope: "me" })
      .then((r) => on && setItems(r))
      .catch((e) => on && setMsg({ ok: false, text: e.message }));
    return () => {
      on = false;
    };
  }, [tick]);

  const canCancel = (r) => r.status === "pending" || (r.status === "approved" && r.from > today);

  async function onCancel(r) {
    if (!window.confirm(`Cancel your trip to ${r.destination} (${dateRange(r.from, r.to)})?`)) return;
    try {
      await cancelTrip(r.id);
      onChange();
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    }
  }

  const rows = [...(items || [])].sort((a, b) => b.from.localeCompare(a.from));

  return (
    <section className={`${CARD} mb-6`}>
      <h3 className="font-medium">My trips</h3>
      {msg && (
        <div className="mt-3">
          <Banner msg={msg} />
        </div>
      )}
      {!items ? (
        <p className="mt-3 text-sm text-[#667085]">Loading...</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-sm text-[#667085]">You haven&apos;t requested a trip yet.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead className="border-b border-[#E6ECE9] bg-[#FAFBFA]">
              <tr>
                <th className={TH}>Trip</th>
                <th className={TH}>Dates</th>
                <th className={TH}>Days</th>
                <th className={TH}>Est. cost</th>
                <th className={TH}>Status</th>
                <th className={TH}>Note</th>
                <th className={TH} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const tag = STATUS_TAG[r.status] || STATUS_TAG.pending;
                return (
                  <tr key={r.id} className="border-b border-[#EEF1F0] last:border-0">
                    <td className="px-3 py-2.5">
                      <span className="font-medium">{r.destination}</span>
                      <span className="block text-xs text-[#667085]">
                        {r.type}: {r.purpose}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5">{dateRange(r.from, r.to)}</td>
                    <td className="px-3 py-2.5">{tripDays(r.from, r.to)}</td>
                    <td className="whitespace-nowrap px-3 py-2.5">{money(r.estCost)}</td>
                    <td className="px-3 py-2.5">
                      <Chip {...tag} />
                      {r.decidedBy && r.status !== "pending" && (
                        <span className="mt-0.5 block text-xs text-[#667085]">by {r.decidedBy}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-[#667085]">{r.decisionNote || "-"}</td>
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

/* ---------- approvals (administrators and the CEO) ---------- */

function TripApprovals({ tick, onChange }) {
  const [items, setItems] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    let on = true;
    listTrips({ scope: "all", status: "pending" })
      .then((r) => on && setItems(r))
      .catch((e) => on && setMsg({ ok: false, text: e.message }));
    return () => {
      on = false;
    };
  }, [tick]);

  async function decide(r, decision) {
    let note = "";
    if (decision === "rejected") {
      note = window.prompt(`Reason for not approving ${r.name}'s trip (optional)`);
      if (note === null) return; // cancelled
    }
    setBusyId(r.id);
    setMsg(null);
    try {
      await decideTrip(r.id, { decision, note: note.trim() });
      setMsg({ ok: true, text: `${r.name}'s trip ${decision === "approved" ? "approved" : "not approved"}.` });
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
        <h3 className="font-medium">Waiting for your approval</h3>
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
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead className="border-b border-[#E6ECE9] bg-[#FAFBFA]">
              <tr>
                <th className={TH}>Name</th>
                <th className={TH}>Trip</th>
                <th className={TH}>Dates</th>
                <th className={TH}>Days</th>
                <th className={TH}>Est. cost</th>
                <th className={TH} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-[#EEF1F0] last:border-0">
                  <td className="px-3 py-2.5 font-medium">{r.name}</td>
                  <td className="px-3 py-2.5">
                    <span className="font-medium">{r.destination}</span>
                    <span className="block text-xs text-[#667085]">
                      {r.type}: {r.purpose}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5">{dateRange(r.from, r.to)}</td>
                  <td className="px-3 py-2.5">{tripDays(r.from, r.to)}</td>
                  <td className="whitespace-nowrap px-3 py-2.5">{money(r.estCost)}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right">
                    <button
                      className={`${BTN_PRIMARY} px-3 py-1.5`}
                      disabled={busyId === r.id}
                      onClick={() => decide(r, "approved")}
                    >
                      Approve
                    </button>{" "}
                    <button
                      className={`${BTN} px-3 py-1.5`}
                      disabled={busyId === r.id}
                      onClick={() => decide(r, "rejected")}
                    >
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

/* ---------- who is away (everyone) ---------- */

function WhoIsAway({ tick }) {
  const [view, setView] = useState("upcoming");
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const today = dayKey(new Date().toISOString());

  useEffect(() => {
    let on = true;
    setItems(null);
    const range =
      view === "past" ? { from: addDays(today, -90), to: addDays(today, -1) } : { from: today, to: addDays(today, 90) };
    listAway({ scope: "all", ...range })
      .then((r) => {
        if (!on) return;
        setError("");
        setItems(r);
      })
      .catch((e) => on && setError(e.message));
    return () => {
      on = false;
    };
  }, [view, today, tick]);

  const rows = [...(items || [])].sort((a, b) =>
    view === "past" ? b.to.localeCompare(a.to) : a.from.localeCompare(b.from) || a.name.localeCompare(b.name)
  );
  const awayNow = rows.filter((t) => t.from <= today && today <= t.to).length;
  const stateOf = (t) =>
    t.to < today
      ? { text: "Back", cls: "bg-[#F1F3F2] text-[#667085]" }
      : t.from <= today
      ? { text: "Away now", cls: "bg-[#EEF4FF] text-[#2E5AAC]" }
      : { text: "Upcoming", cls: "bg-[#E3F3EC] text-[#00664E]" };

  return (
    <section className={CARD}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="font-medium">Who is travelling</h3>
          {view === "upcoming" && awayNow > 0 && <Chip text={`${awayNow} away now`} cls="bg-[#EEF4FF] text-[#2E5AAC]" />}
        </div>
        <select className={INPUT} value={view} onChange={(e) => setView(e.target.value)} aria-label="Show trips">
          <option value="upcoming">Now and the next 90 days</option>
          <option value="past">Past 90 days</option>
        </select>
      </div>
      {error && (
        <div className="mt-3">
          <Banner msg={{ ok: false, text: error }} />
        </div>
      )}
      {!items && !error ? (
        <p className="mt-3 text-sm text-[#667085]">Loading...</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-sm text-[#667085]">
          {view === "past" ? "Nobody travelled in the past 90 days." : "Nobody is travelling in this period."}
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-sm">
            <thead className="border-b border-[#E6ECE9] bg-[#FAFBFA]">
              <tr>
                <th className={TH}>Name</th>
                <th className={TH}>Where</th>
                <th className={TH}>Dates</th>
                <th className={TH} />
              </tr>
            </thead>
            <tbody>
              {rows.map((t, i) => (
                <tr key={`${t.userId}|${t.from}|${i}`} className="border-b border-[#EEF1F0] last:border-0">
                  <td className="px-3 py-2.5 font-medium">{t.name}</td>
                  <td className="px-3 py-2.5">
                    {t.destination}
                    {t.type && <span className="block text-xs text-[#667085]">{t.type}</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5">{dateRange(t.from, t.to)}</td>
                  <td className="px-3 py-2.5 text-right">
                    <Chip {...stateOf(t)} />
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

/* ---------- page ---------- */

export default function Travel() {
  const [access, setAccess] = useState({ isAdmin: false });
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let mounted = true;
    getAccess()
      .then((r) => mounted && setAccess(r))
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  // Administrators and the CEO approve trips. If getAccess() returns canApproveTravel (or canApproveLeave), that wins.
  const canApprove = access.canApproveTravel ?? access.canApproveLeave ?? !!access.isAdmin;

  return (
    <div className="p-4 text-[#0B2B24] lg:p-6">
      <div className="mb-5">
        <h2 className="text-2xl font-semibold">Travel and field requests</h2>
        <p className="text-sm text-[#667085]">
          Ask to travel or go on a field visit. Dates are Nairobi days.
        </p>
      </div>

      {canApprove && <TripApprovals tick={tick} onChange={refresh} />}
      <TripRequestForm onSent={refresh} />
      <MyTrips tick={tick} onChange={refresh} />
      <WhoIsAway tick={tick} />
    </div>
  );
}
