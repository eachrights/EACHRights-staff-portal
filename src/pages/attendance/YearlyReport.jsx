import { useCallback, useEffect, useMemo, useState } from "react";
import { Fingerprint, Download, Trash2, Printer } from "lucide-react";
import { getAccess } from "../../access";
import { WEEKEND_DAYS, holidayName } from "../../holidays";
import { listAway } from "../travel/travelApi";
import YearlyReport from "./YearlyReport";
import {
  fingerprintSupported,
  getStatus,
  registerDevice,
  punch,
  listAllRecords,
  listStaffLinks,
  saveStaffLink,
  deleteStaffLink,
  importPunches,
  listLeave,
  listLeaveRequests,
  requestLeave,
  cancelLeave,
  decideLeave,
  listDeviceRequests,
  decideDeviceRequest,
  listApprovedDevices,
  revokeDevice,
} from "./attendanceApi";

/* ---------- time helpers (all shown in Nairobi time) ---------- */

const TZ = "Africa/Nairobi";
const DAY_MS = 86400000;
const DOUBLE_TAP_MS = 60000; // a second press within a minute counts once

// True when the portal is open in a phone's own browser
const onPhone = typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

const timeOf = (iso) =>
  new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
const dayKey = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });
const dayLabel = (key) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
const addDays = (key, n) => new Date(+new Date(`${key}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const weekday = (key) => new Date(`${key}T12:00:00Z`).getUTCDay(); // 0 = Sunday
const dayStart = (key) => new Date(`${key}T00:00:00+03:00`).toISOString();
const dayEnd = (key) => new Date(`${key}T23:59:59.999+03:00`).toISOString();
const hoursText = (ms) => (ms > 0 ? `${Math.floor(ms / 3600000)}h ${Math.round((ms % 3600000) / 60000)}m` : "-");
const fullDate = (key) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

function rangeDays(range) {
  const today = dayKey(new Date().toISOString());
  if (range === "month") return { from: `${today.slice(0, 7)}-01`, to: today };
  if (range === "30d") return { from: addDays(today, -29), to: today };
  const dow = weekday(today);
  return { from: addDays(today, -((dow + 6) % 7)), to: today }; // week starts Monday
}

/* ---------- days off: weekends, public holidays, leave ---------- */

// Approved leave plus approved trips in one list. Trips are tagged kind "travel" so they can be told apart.
// If either can't be loaded the page still works, it just won't mark those days.
async function loadAway(scope, from, to) {
  const [leave, trips] = await Promise.all([
    listLeave({ scope, from, to }).catch(() => []),
    listAway({ scope, from, to }).catch(() => []),
  ]);
  return [...leave, ...trips.map((t) => ({ ...t, kind: "travel" }))];
}

// Leave looks like { userId, name, email, from: "YYYY-MM-DD", to: "YYYY-MM-DD", type }.
// Pass userId to match one person; leave it out when the list is already just the signed-in user's.
function dayOff(key, leaves, userId) {
  return {
    weekend: WEEKEND_DAYS.includes(weekday(key)),
    holiday: holidayName(key),
    leave: leaves.find((l) => (!userId || l.userId === userId) && l.from <= key && key <= l.to) || null,
  };
}

function offTag(o) {
  if (!o) return null;
  if (o.holiday) return { text: o.holiday, cls: "bg-[#EEF4FF] text-[#2E5AAC]" };
  if (o.weekend) return { text: "Weekend", cls: "bg-[#F1F3F2] text-[#667085]" };
  if (o.leave) {
    if (o.leave.kind === "travel") {
      return {
        text: `Away: ${o.leave.destination || o.leave.type || "official travel"}`,
        cls: "bg-[#E8F5F2] text-[#0F6B55]",
      };
    }
    return { text: `On leave${o.leave.type ? ` (${o.leave.type})` : ""}`, cls: "bg-[#FFF4E5] text-[#8A4B00]" };
  }
  return null;
}

const sortRows = (a, b) => b.day.localeCompare(a.day) || (a.name || "").localeCompare(b.name || "");

// The scanner logs plain "punches". Within each person's day, the 1st is a clock-in,
// the 2nd a clock-out, and so on. Presses within a minute of each other count once.
function withDirection(records) {
  const out = [];
  const days = new Map();
  [...records]
    .sort((a, b) => a.at.localeCompare(b.at))
    .forEach((r) => {
      if (r.type !== "punch") {
        out.push(r);
        return;
      }
      const key = `${r.userId}|${dayKey(r.at)}`;
      const s = days.get(key) || { last: null, n: 0 };
      if (s.last && new Date(r.at) - s.last < DOUBLE_TAP_MS) return;
      out.push({ ...r, type: s.n % 2 === 0 ? "in" : "out" });
      days.set(key, { last: new Date(r.at), n: s.n + 1 });
    });
  return out;
}

// One row per person per day, pairing in and out for hours worked
function summarize(records) {
  const map = new Map();
  withDirection(records).forEach((r) => {
    const key = `${r.userId}|${dayKey(r.at)}`;
    const d = map.get(key) || { key, userId: r.userId, name: r.name, day: dayKey(r.at), punches: [] };
    d.punches.push(r);
    map.set(key, d);
  });

  return [...map.values()]
    .map((d) => {
      let ms = 0;
      let open = null;
      d.punches.forEach((p) => {
        if (p.type === "in") open = new Date(p.at);
        else if (open) {
          ms += new Date(p.at) - open;
          open = null;
        }
      });
      return {
        ...d,
        firstIn: d.punches.find((p) => p.type === "in")?.at,
        lastOut: [...d.punches].reverse().find((p) => p.type === "out")?.at,
        ms,
        open,
      };
    })
    .sort(sortRows);
}

// My history: one row for every day in the range, so weekends, holidays and leave show up even with no punches
function mineRows(records, range, leaves) {
  const { from, to } = rangeDays(range);
  const byDay = new Map(summarize(records).map((d) => [d.day, d]));
  const out = [];
  for (let k = to; k >= from; k = addDays(k, -1)) {
    const d = byDay.get(k) || { key: `empty|${k}`, day: k, punches: [], ms: 0 };
    out.push({ ...d, off: dayOff(k, leaves) });
  }
  return out;
}

// Team: the usual rows, tagged, plus a row for each person on leave on a working day with no punches
function teamRows(records, range, leaves) {
  const { from, to } = rangeDays(range);
  const rows = summarize(records).map((d) => ({ ...d, off: dayOff(d.day, leaves, d.userId) }));
  const seen = new Set(rows.map((d) => d.key));
  leaves.forEach((l) => {
    const last = l.to < to ? l.to : to;
    for (let k = l.from > from ? l.from : from; k <= last; k = addDays(k, 1)) {
      const off = dayOff(k, [l], l.userId);
      if (off.weekend || off.holiday) continue;
      const key = `${l.userId}|${k}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ key, userId: l.userId, name: l.name, day: k, punches: [], ms: 0, off });
    }
  });
  return rows.sort(sortRows);
}

function useNow() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function friendly(e) {
  if (e.code === "NOT_IN_OFFICE") return "You can only clock in or out from the office Wi-Fi.";
  if (e.name === "NotAllowedError")
    return onPhone
      ? "The fingerprint check was cancelled or timed out. Please try again and touch the fingerprint sensor when your phone asks."
      : "The fingerprint check was cancelled or timed out. For the easiest way, open this page on your phone and clock in there. On a computer, your phone must be close by with Bluetooth on for both devices.";
  if (e.name === "InvalidStateError") return "This device is already set up.";
  if (e.name === "SecurityError") return "Fingerprint sign-in is not available on this web address.";
  return e.message || "Something went wrong.";
}

/* ---------- shared Tailwind classes (green, like the file pages) ---------- */

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#008060]";
const BTN = `inline-flex items-center gap-2 rounded-lg border border-[#C9CED6] bg-white px-4 py-2 text-sm text-[#0B2B24] transition hover:bg-[#F6F7F8] disabled:opacity-60 motion-reduce:transition-none ${FOCUS}`;
const BTN_PRIMARY = `inline-flex items-center gap-2 rounded-lg border border-[#008060] bg-[#008060] px-4 py-2 text-sm text-white transition hover:bg-[#00664E] disabled:opacity-60 motion-reduce:transition-none ${FOCUS}`;
const INPUT = `rounded-lg border border-[#C9CED6] bg-white px-2.5 py-2 text-sm text-[#0B2B24] ${FOCUS}`;
const CARD = "rounded-2xl border border-[#E6ECE9] bg-white p-5";
const TH = "px-3 py-2.5 text-left text-xs font-medium text-[#667085]";

/* ---------- print: only the element with id="attendance-print" is printed ---------- */

const PRINT_CSS = `
@media print {
  @page { margin: 12mm; }
  body * { visibility: hidden !important; }
  #attendance-print, #attendance-print * { visibility: visible !important; }
  #attendance-print {
    position: absolute !important;
    left: 0;
    top: 0;
    width: 100%;
    border: 0 !important;
    border-radius: 0 !important;
  }
}
`;

function PrintHeader({ title, subtitle, range }) {
  const { from, to } = rangeDays(range);
  return (
    <div className="hidden px-1 pb-3 print:block">
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="text-sm text-[#475467]">
        {subtitle ? `${subtitle} | ` : ""}
        {fullDate(from)} to {fullDate(to)} (Nairobi time) | Printed {fullDate(dayKey(new Date().toISOString()))}
      </p>
    </div>
  );
}

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

// Tells the person when today is a holiday, a weekend, or (for "You are") a leave day
function DayNote({ off, who }) {
  const tag = offTag(off);
  if (!tag) return null;
  const text = off.holiday
    ? `Today is a public holiday: ${off.holiday}.`
    : off.weekend
    ? "Today is a weekend."
    : off.leave.kind === "travel"
    ? `${who} away on official travel today (${off.leave.destination || off.leave.type || "trip"}).`
    : `${who} on leave today${off.leave.type ? ` (${off.leave.type})` : ""}.`;
  return (
    <p role="status" className={`mb-4 rounded-lg px-3 py-2 text-sm ${tag.cls}`}>
      {text}
    </p>
  );
}

function RangeSelect({ value, onChange }) {
  return (
    <select className={INPUT} value={value} onChange={(e) => onChange(e.target.value)} aria-label="Date range">
      <option value="week">This week</option>
      <option value="month">This month</option>
      <option value="30d">Last 30 days</option>
    </select>
  );
}

function SummaryTable({ rows, showName }) {
  const today = dayKey(new Date().toISOString());
  if (!rows.length) {
    return <p className="px-4 py-10 text-center text-sm text-[#667085]">No attendance recorded in this period.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-sm">
        <thead className="border-b border-[#E6ECE9] bg-[#FAFBFA]">
          <tr>
            <th className={TH}>Date</th>
            {showName && <th className={TH}>Name</th>}
            <th className={TH}>First in</th>
            <th className={TH}>Last out</th>
            <th className={TH}>Hours</th>
            <th className={TH}>Punches</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => {
            const tag = offTag(d.off);
            const quiet = d.punches.length === 0;
            return (
              <tr
                key={d.key}
                className={`border-b border-[#EEF1F0] last:border-0 ${tag && quiet ? "bg-[#FAFBFA] text-[#667085]" : ""}`}
              >
                <td className="whitespace-nowrap px-3 py-2.5">
                  {dayLabel(d.day)}
                  {tag && <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${tag.cls}`}>{tag.text}</span>}
                  {!tag && quiet && <span className="ml-2 text-xs text-[#98A2B3]">No punches</span>}
                </td>
                {showName && <td className="px-3 py-2.5">{d.name}</td>}
                <td className="px-3 py-2.5">{d.firstIn ? timeOf(d.firstIn) : "-"}</td>
                <td className="px-3 py-2.5">
                  {d.open ? (
                    d.day === today ? (
                      <span className="text-[#00664E]">In progress</span>
                    ) : (
                      <span className="text-[#B54708]">No clock-out</span>
                    )
                  ) : d.lastOut ? (
                    timeOf(d.lastOut)
                  ) : (
                    "-"
                  )}
                </td>
                <td className="px-3 py-2.5 font-medium">{hoursText(d.ms)}</td>
                <td className="px-3 py-2.5 text-[#667085]">{d.punches.length || "-"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function EnrolForm({ onEnrol, busy, compact }) {
  const [label, setLabel] = useState("");
  return (
    <form
      className={`flex flex-wrap items-center gap-2 ${compact ? "" : "mt-4"}`}
      onSubmit={(e) => {
        e.preventDefault();
        onEnrol(label.trim() || "My phone");
      }}
    >
      <input
        className={`${INPUT} w-56`}
        placeholder="Phone name, e.g. My Samsung"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        aria-label="Phone name"
      />
      <button className={BTN_PRIMARY} disabled={busy}>
        <Fingerprint size={16} /> {busy ? "Waiting for fingerprint..." : "Set up fingerprint"}
      </button>
    </form>
  );
}

/* ---------- download (CSV) ---------- */

function exportCsv(records, prefix = "attendance") {
  const head = ["Date", "Time (EAT)", "Name", "Email", "Type", "Source", "Day note"];
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = withDirection(records).map((r) =>
    [
      dayKey(r.at),
      timeOf(r.at),
      r.name,
      r.email,
      r.type === "in" ? "Clock in" : "Clock out",
      r.method === "scanner" ? "Office scanner" : "Phone or laptop",
      offTag(dayOff(dayKey(r.at), []))?.text || "",
    ]
      .map(esc)
      .join(",")
  );
  const blob = new Blob(["\uFEFF" + [head.map(esc).join(","), ...lines].join("\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${prefix}-${dayKey(new Date().toISOString())}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ---------- my attendance ---------- */

function MyAttendance() {
  const [status, setStatus] = useState(null);
  const [records, setRecords] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [range, setRange] = useState("week");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const now = useNow();

  const loadStatus = useCallback(
    () => getStatus().then(setStatus).catch((e) => setMsg({ ok: false, text: e.message })),
    []
  );
  const loadRecords = useCallback(() => {
    const { from, to } = rangeDays(range);
    return listAllRecords({ scope: "me", from: dayStart(from), to: dayEnd(to) })
      .then(setRecords)
      .catch((e) => setMsg({ ok: false, text: e.message }));
  }, [range]);
  const loadLeave = useCallback(() => {
    const { from, to } = rangeDays(range);
    return loadAway("me", from, to).then(setLeaves);
  }, [range]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);
  useEffect(() => {
    loadRecords();
  }, [loadRecords]);
  useEffect(() => {
    loadLeave();
  }, [loadLeave]);

  // Refresh now and then so a punch at the scanner shows up without reloading
  useEffect(() => {
    const t = setInterval(() => {
      loadStatus();
      loadRecords();
    }, 60000);
    return () => clearInterval(t);
  }, [loadStatus, loadRecords]);

  // Re-check the office network as soon as the connection changes or the tab regains focus
  useEffect(() => {
    const refresh = () => loadStatus();
    window.addEventListener("online", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("online", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [loadStatus]);

  const webEnabled = !!status?.webPunchEnabled;
  const atOffice = status?.onOfficeNetwork !== false; // undefined = backend not updated yet
  // A PC without a fingerprint reader is fine: it can use a phone through a QR code.
  const supported = fingerprintSupported();
  const rows = useMemo(() => mineRows(records, range, leaves), [records, range, leaves]);
  const todayOff = dayOff(dayKey(now.toISOString()), leaves);
  const todayPunches = useMemo(() => withDirection(status?.today || []), [status]);
  const todayRow = useMemo(() => summarize(status?.today || [])[0], [status]);
  const clockedIn = webEnabled ? status?.last?.type === "in" : !!todayRow?.open;
  const inSince = webEnabled ? status?.last?.at : todayRow?.open?.toISOString();

  async function onPunch() {
    if (!atOffice) return;
    setBusy(true);
    setMsg(null);
    try {
      const type = clockedIn ? "out" : "in";
      const rec = await punch(type);
      setMsg({ ok: true, text: `Clocked ${type} at ${timeOf(rec.at)}.` });
      await Promise.all([loadStatus(), loadRecords()]);
    } catch (e) {
      setMsg({ ok: false, text: friendly(e) });
    } finally {
      setBusy(false);
    }
  }

  async function onEnrol(label) {
    setBusy(true);
    setMsg(null);
    try {
      await registerDevice(label);
      setMsg({
        ok: true,
        text: "Phone registered. An administrator must approve it before you can clock in. It will show here once it is approved.",
      });
      await loadStatus();
    } catch (e) {
      setMsg({ ok: false, text: friendly(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Banner msg={msg} />
      <DayNote off={todayOff} who="You are" />

      <div className="mb-6 grid gap-4 lg:grid-cols-[2fr_1fr]">
        {/* STATUS CARD */}
        <section className={CARD} aria-label="Attendance status">
          {!status ? (
            <p className="text-sm text-[#667085]">Loading...</p>
          ) : !webEnabled ? (
            <div className="flex flex-wrap items-center gap-5">
              <span
                className={`flex h-24 w-24 shrink-0 items-center justify-center rounded-full ${
                  clockedIn ? "bg-[#E3F3EC] text-[#008060]" : "bg-[#F1F3F2] text-[#98A2B3]"
                }`}
              >
                <Fingerprint size={40} />
              </span>
              <div>
                <p className="text-3xl font-semibold tabular-nums">
                  {now.toLocaleTimeString("en-GB", { timeZone: TZ })}
                </p>
                <p className="text-sm text-[#667085]">
                  {now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: TZ })}
                </p>
                {!status.linked ? (
                  <p className="mt-2 rounded-lg bg-[#FFF4E5] px-3 py-2 text-sm text-[#8A4B00]">
                    Your scanner ID isn&apos;t linked to your account yet. Ask an administrator to link it.
                  </p>
                ) : (
                  <p className="mt-2 text-sm">
                    {clockedIn ? (
                      <span className="font-medium text-[#00664E]">
                        In the office since {timeOf(inSince)} ({hoursText(now - new Date(inSince))})
                      </span>
                    ) : (
                      <span className="text-[#475467]">Not clocked in.</span>
                    )}
                  </p>
                )}
                <p className="mt-0.5 text-xs text-[#667085]">
                  Attendance is recorded when you press your finger on the office fingerprint scanner.
                </p>
              </div>
            </div>
          ) : !supported ? (
            <p className="rounded-lg bg-[#FFF4E5] px-3 py-2 text-sm text-[#8A4B00]">
              This browser can&apos;t use fingerprint sign-in. Use a recent Chrome, Edge or Safari, and open the portal
              over HTTPS.
            </p>
          ) : !status.enrolled && status.pendingDevice ? (
            <div>
              <h3 className="text-lg font-medium">Waiting for approval</h3>
              <p className="mt-1 text-sm text-[#667085]">
                Your phone &ldquo;{status.pendingDevice.label}&rdquo; was registered on{" "}
                {new Date(status.pendingDevice.createdAt).toLocaleDateString("en-GB")}. An administrator needs to
                approve it before you can clock in. This page updates by itself once it is approved.
              </p>
            </div>
          ) : !status.enrolled ? (
            <>
              <h3 className="text-lg font-medium">Set up your fingerprint</h3>
              <p className="mt-1 text-sm text-[#667085]">
                Your phone checks your fingerprint itself. The portal never sees or stores it. For the quickest setup,
                open this page in your phone&apos;s browser (Chrome or Safari) and touch the fingerprint sensor when
                asked.
                {!onPhone &&
                  " On a computer, choose “Use a phone or tablet”, scan the QR code with your phone and keep Bluetooth on for both devices."}{" "}
                An administrator approves your phone once, and only one phone can be approved for each person.
              </p>
              <EnrolForm onEnrol={onEnrol} busy={busy} />
            </>
          ) : (
            <div className="flex flex-wrap items-center gap-5">
              <button
                onClick={onPunch}
                disabled={busy || !atOffice}
                className={`flex h-28 w-28 shrink-0 flex-col items-center justify-center gap-1 rounded-full text-white transition disabled:opacity-60 motion-reduce:transition-none ${FOCUS} ${
                  clockedIn ? "bg-[#B54708] hover:bg-[#93390A]" : "bg-[#008060] hover:bg-[#00664E]"
                }`}
              >
                <Fingerprint size={34} />
                <span className="text-sm font-medium">
                  {busy ? (onPhone ? "Touch sensor" : "Use your phone") : clockedIn ? "Clock out" : "Clock in"}
                </span>
              </button>
              <div>
                <p className="text-3xl font-semibold tabular-nums">
                  {now.toLocaleTimeString("en-GB", { timeZone: TZ })}
                </p>
                <p className="mt-2 text-sm">
                  {clockedIn ? (
                    <span className="font-medium text-[#00664E]">
                      Clocked in since {timeOf(inSince)} ({hoursText(now - new Date(inSince))})
                    </span>
                  ) : (
                    <span className="text-[#475467]">Not clocked in.</span>
                  )}
                </p>
                <p className="mt-0.5 text-xs text-[#667085]">
                  {onPhone
                    ? "Tap the button and touch your fingerprint sensor."
                    : "Tip: clock in from your phone's browser for a one-tap fingerprint check. On a computer you need your phone nearby with Bluetooth on."}
                </p>
                {!atOffice && (
                  <p role="status" className="mt-2 rounded-lg bg-[#FFF4E5] px-3 py-2 text-sm text-[#8A4B00]">
                    Connect to the office Wi-Fi to clock in or out.
                  </p>
                )}
              </div>
            </div>
          )}
        </section>

        {/* TODAY */}
        <section className={CARD} aria-label="Today">
          <h3 className="text-sm font-medium text-[#667085]">Today</h3>
          <p className="mt-1 text-2xl font-semibold">
            {hoursText((todayRow?.ms || 0) + (todayRow?.open ? now - todayRow.open : 0))}
          </p>
          <ul className="mt-3 space-y-1.5 text-sm">
            {todayPunches.length === 0 && <li className="text-[#667085]">No punches yet.</li>}
            {todayPunches.map((p) => (
              <li key={p.id} className="flex items-center gap-2">
                <i className={`h-2 w-2 rounded-full ${p.type === "in" ? "bg-[#0F9F77]" : "bg-[#B54708]"}`} />
                {p.type === "in" ? "Clocked in" : "Clocked out"} at {timeOf(p.at)}
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* HISTORY */}
      <section id="attendance-print" className="mb-6 rounded-2xl border border-[#E6ECE9] bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E6ECE9] px-5 py-3 print:hidden">
          <h3 className="font-medium">My history</h3>
          <div className="flex flex-wrap items-center gap-2">
            <RangeSelect value={range} onChange={setRange} />
            <button className={BTN} onClick={() => exportCsv(records, "my-attendance")} disabled={!records.length}>
              <Download size={16} /> Download CSV
            </button>
            <button className={BTN} onClick={() => window.print()} disabled={!records.length}>
              <Printer size={16} /> Print
            </button>
          </div>
        </div>
        <PrintHeader title="My attendance" subtitle={records[0]?.name} range={range} />
        <SummaryTable rows={rows} />
      </section>

      {/* DEVICES (only when phone or laptop clocking is switched on) */}
      {webEnabled && status?.enrolled && (
        <section className={`${CARD} print:hidden`}>
          <h3 className="font-medium">My fingerprint devices</h3>
          <ul className="mt-3 divide-y divide-[#EEF1F0]">
            {status.devices.map((d) => (
              <li key={d.id} className="flex items-center gap-3 py-2.5 text-sm">
                <Fingerprint size={18} className="text-[#008060]" />
                <span className="flex-1">
                  <span className="font-medium">{d.label}</span>
                  <span className="block text-xs text-[#667085]">
                    Added {new Date(d.createdAt).toLocaleDateString("en-GB")}
                    {d.lastUsedAt ? `, last used ${new Date(d.lastUsedAt).toLocaleDateString("en-GB")}` : ""}
                  </span>
                </span>
                <Chip text="Approved" cls="bg-[#E3F3EC] text-[#00664E]" />
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-[#667085]">
            Only one phone can be approved for attendance. To replace it, contact IT or an administrator.
          </p>
        </section>
      )}
    </>
  );
}

/* ---------- team (administrator) ---------- */

function TeamDaily({ onOpenScanner }) {
  const [range, setRange] = useState("week");
  const [q, setQ] = useState("");
  const [records, setRecords] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const { from, to } = rangeDays(range);
    setLoading(true);
    Promise.all([
      listAllRecords({ scope: "all", from: dayStart(from), to: dayEnd(to) }),
      loadAway("all", from, to),
    ])
      .then(([r, l]) => {
        setError("");
        setRecords(r);
        setLeaves(l || []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [range]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? records.filter((r) => `${r.name} ${r.email}`.toLowerCase().includes(needle)) : records;
  }, [records, q]);
  const filteredLeaves = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? leaves.filter((l) => `${l.name} ${l.email || ""}`.toLowerCase().includes(needle)) : leaves;
  }, [leaves, q]);

  const rows = useMemo(() => teamRows(filtered, range, filteredLeaves), [filtered, range, filteredLeaves]);
  const today = dayKey(new Date().toISOString());
  const todayOff = dayOff(today, []);
  const todayRows = useMemo(() => summarize(records).filter((d) => d.day === today), [records, today]);
  const inNow = todayRows.filter((d) => d.open).length;
  const onLeaveToday = useMemo(() => {
    const off = dayOff(today, []);
    if (off.weekend || off.holiday) return 0;
    return new Set(
      leaves.filter((l) => l.kind !== "travel" && l.from <= today && today <= l.to).map((l) => l.userId)
    ).size;
  }, [leaves, today]);
  const awayToday = useMemo(() => {
    const off = dayOff(today, []);
    if (off.weekend || off.holiday) return 0;
    return new Set(
      leaves.filter((l) => l.kind === "travel" && l.from <= today && today <= l.to).map((l) => l.userId)
    ).size;
  }, [leaves, today]);
  const unlinked = useMemo(
    () => new Set(records.filter((r) => r.userId?.startsWith("scan:")).map((r) => r.scannerId)).size,
    [records]
  );

  return (
    <>
      {error && <p className="mb-4 rounded-lg bg-[#FDECEA] px-3 py-2 text-sm text-[#8A1C14]">{error}</p>}
      <DayNote off={todayOff} who="Staff are" />

      {unlinked > 0 && (
        <p className="mb-4 rounded-lg bg-[#FFF4E5] px-3 py-2 text-sm text-[#8A4B00]">
          {unlinked} scanner {unlinked === 1 ? "ID isn't" : "IDs aren't"} linked to a person yet.{" "}
          <button className="font-medium underline" onClick={onOpenScanner}>
            Link them
          </button>
        </p>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className={CARD}>
          <p className="text-xs font-medium text-[#667085]">In the office now</p>
          <p className="mt-1 text-2xl font-semibold text-[#00664E]">{inNow}</p>
        </div>
        <div className={CARD}>
          <p className="text-xs font-medium text-[#667085]">Present today</p>
          <p className="mt-1 text-2xl font-semibold">{todayRows.length}</p>
        </div>
        <div className={CARD}>
          <p className="text-xs font-medium text-[#667085]">On leave today</p>
          <p className="mt-1 text-2xl font-semibold text-[#8A4B00]">{onLeaveToday}</p>
        </div>
        <div className={CARD}>
          <p className="text-xs font-medium text-[#667085]">On official travel today</p>
          <p className="mt-1 text-2xl font-semibold text-[#0F6B55]">{awayToday}</p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          type="search"
          className={`${INPUT} w-56`}
          placeholder="Search by name"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search by name"
        />
        <RangeSelect value={range} onChange={setRange} />
        <span className="flex-1" />
        <button className={BTN} onClick={() => exportCsv(filtered, "team-attendance")} disabled={!filtered.length}>
          <Download size={16} /> Download CSV
        </button>
        <button className={BTN} onClick={() => window.print()} disabled={!rows.length}>
          <Printer size={16} /> Print
        </button>
      </div>

      <div id="attendance-print" className="rounded-2xl border border-[#E6ECE9] bg-white">
        <PrintHeader title="Team attendance" subtitle={q.trim() ? `Filter: ${q.trim()}` : "All staff"} range={range} />
        {loading ? (
          <p className="px-4 py-10 text-center text-sm text-[#667085]">Loading...</p>
        ) : (
          <SummaryTable rows={rows} showName />
        )}
      </div>
    </>
  );
}

function TeamAttendance({ onOpenScanner }) {
  const [view, setView] = useState("daily");
  const viewBtn = (key, label) => (
    <button
      key={key}
      onClick={() => setView(key)}
      aria-pressed={view === key}
      className={`px-4 py-2 text-sm ${FOCUS} ${
        view === key ? "bg-[#E3F3EC] font-medium text-[#00664E]" : "bg-white text-[#667085] hover:bg-[#F6F7F8]"
      }`}
    >
      {label}
    </button>
  );
  return (
    <>
      <div
        className="mb-4 inline-flex overflow-hidden rounded-lg border border-[#C9CED6] print:hidden"
        role="group"
        aria-label="Team view"
      >
        {viewBtn("daily", "Attendance records")}
        {viewBtn("yearly", "Yearly report")}
      </div>
      {view === "yearly" ? <YearlyReport /> : <TeamDaily onOpenScanner={onOpenScanner} />}
    </>
  );
}

/* ---------- scanner setup (administrator) ---------- */

const DELIMS = [",", "\t", ";"];

function parseTable(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const delim = DELIMS.map((d) => [d, lines[0].split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  return lines.map((l) => l.split(delim).map((c) => c.trim().replace(/^"|"$/g, "")));
}

// Understands 2026-10-31 08:02:11 and 31/10/2026 08:02 (day first). Treated as Nairobi time.
function parseWhen(s) {
  const pad = (v) => String(v).padStart(2, "0");
  let m = String(s).match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}T${pad(m[4])}:${m[5]}:${m[6] || "00"}+03:00`;
  m = String(s).match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}T${pad(m[4])}:${m[5]}:${m[6] || "00"}+03:00`;
  return null;
}

function StaffLinks() {
  const [links, setLinks] = useState([]);
  const [form, setForm] = useState({ scannerId: "", name: "", email: "" });
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () => listStaffLinks().then((r) => setLinks(r.items)).catch((e) => setMsg({ ok: false, text: e.message })),
    []
  );
  useEffect(() => {
    load();
  }, [load]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function onAdd(e) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await saveStaffLink(form);
      setForm({ scannerId: "", name: "", email: "" });
      await load();
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function onRemove(l) {
    if (!window.confirm(`Unlink scanner ID ${l.scannerId} from ${l.name}?`)) return;
    try {
      await deleteStaffLink(l.scannerId);
      await load();
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    }
  }

  return (
    <section className={`${CARD} mb-6`}>
      <h3 className="font-medium">Link scanner IDs to staff</h3>
      <p className="mt-1 text-sm text-[#667085]">
        Each person has an ID number on the scanner. Enter it with the email they sign in to the portal with, so
        their punches show up in their own attendance.
      </p>
      <Banner msg={msg} />
      <form className="mt-3 flex flex-wrap items-center gap-2" onSubmit={onAdd}>
        <input className={`${INPUT} w-28`} placeholder="Scanner ID" value={form.scannerId} onChange={set("scannerId")} aria-label="Scanner ID" />
        <input className={`${INPUT} w-48`} placeholder="Full name" value={form.name} onChange={set("name")} aria-label="Full name" />
        <input className={`${INPUT} w-64`} type="email" placeholder="Portal email" value={form.email} onChange={set("email")} aria-label="Portal email" />
        <button className={BTN_PRIMARY} disabled={busy}>Link</button>
      </form>

      {links.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[480px] border-collapse text-sm">
            <thead className="border-b border-[#E6ECE9] bg-[#FAFBFA]">
              <tr>
                <th className={TH}>Scanner ID</th>
                <th className={TH}>Name</th>
                <th className={TH}>Email</th>
                <th className={TH} />
              </tr>
            </thead>
            <tbody>
              {[...links]
                .sort((a, b) => a.scannerId.localeCompare(b.scannerId, undefined, { numeric: true }))
                .map((l) => (
                  <tr key={l.scannerId} className="border-b border-[#EEF1F0] last:border-0">
                    <td className="px-3 py-2.5 font-medium">{l.scannerId}</td>
                    <td className="px-3 py-2.5">{l.name}</td>
                    <td className="px-3 py-2.5 text-[#667085]">{l.email || "-"}</td>
                    <td className="px-3 py-2.5 text-right">
                      <button
                        className={`rounded-full p-2 text-[#667085] hover:bg-[#F1F3F2] hover:text-[#B42318] ${FOCUS}`}
                        aria-label={`Unlink scanner ID ${l.scannerId}`}
                        onClick={() => onRemove(l)}
                      >
                        <Trash2 size={16} />
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

function ImportFile() {
  const [rows, setRows] = useState([]);
  const [hasHeader, setHasHeader] = useState(true);
  const [idCol, setIdCol] = useState(0);
  const [timeCol, setTimeCol] = useState(1);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const table = parseTable(await file.text());
    setRows(table);
    setMsg(null);
    if (table.length) {
      // Guess: the time column is the first one that looks like a date and time
      const sample = table[Math.min(1, table.length - 1)];
      const t = sample.findIndex((c) => parseWhen(c));
      const tc = t >= 0 ? t : 1;
      setTimeCol(tc);
      setIdCol(tc === 0 ? 1 : 0);
      setHasHeader(!table[0].some((c) => parseWhen(c)));
    }
  }

  const body = hasHeader ? rows.slice(1) : rows;
  const labels = rows[0]?.map((c, i) => (hasHeader && c ? c : `Column ${i + 1}`)) || [];
  const punches = body
    .map((r) => ({ scannerId: (r[idCol] || "").trim(), at: parseWhen(r[timeCol] || "") }))
    .filter((p) => p.scannerId && p.at);
  const skipped = body.length - punches.length;

  async function onImport() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await importPunches(punches);
      setMsg({
        ok: true,
        text: `${r.accepted} added, ${r.duplicates} already there${r.rejectedCount ? `, ${r.rejectedCount} refused` : ""}.`,
      });
      setRows([]);
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`${CARD} mb-6`}>
      <h3 className="font-medium">Import from a scanner file</h3>
      <p className="mt-1 text-sm text-[#667085]">
        Upload the attendance export from the scanner (CSV or text). Times are read as Nairobi time. Punches that were
        already imported are skipped, so re-uploading a file is safe.
      </p>
      <Banner msg={msg} />
      <input type="file" accept=".csv,.txt,.dat,.tsv" onChange={onFile} className="mt-3 text-sm" aria-label="Scanner export file" />

      {rows.length > 0 && (
        <div className="mt-4">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} className="h-4 w-4 accent-[#008060]" />
              First row is headings
            </label>
            <label className="flex items-center gap-2">
              Scanner ID
              <select className={INPUT} value={idCol} onChange={(e) => setIdCol(Number(e.target.value))}>
                {labels.map((l, i) => (
                  <option key={i} value={i}>{l}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              Date and time
              <select className={INPUT} value={timeCol} onChange={(e) => setTimeCol(Number(e.target.value))}>
                {labels.map((l, i) => (
                  <option key={i} value={i}>{l}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-3 overflow-x-auto rounded-lg border border-[#E6ECE9]">
            <table className="w-full text-xs">
              <tbody>
                {body.slice(0, 5).map((r, i) => (
                  <tr key={i} className="border-b border-[#EEF1F0] last:border-0">
                    <td className="px-3 py-1.5">{r[idCol]}</td>
                    <td className="px-3 py-1.5">{r[timeCol]}</td>
                    <td className="px-3 py-1.5 text-[#667085]">{parseWhen(r[timeCol] || "") ? "OK" : "Can't read this time"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-2 text-sm text-[#475467]">
            {punches.length} punches ready{skipped > 0 ? `, ${skipped} rows can't be read and will be skipped` : ""}.
          </p>
          <button className={`${BTN_PRIMARY} mt-3`} onClick={onImport} disabled={busy || !punches.length}>
            {busy ? "Importing..." : `Import ${punches.length} punches`}
          </button>
        </div>
      )}
    </section>
  );
}

function ScannerSetup() {
  return (
    <>
      <section className={`${CARD} mb-6`}>
        <h3 className="font-medium">How the office scanner connects</h3>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-[#475467]">
          <li>Staff press their finger on the scanner. The scanner itself matches the real fingerprint.</li>
          <li>
            A small sync program on an office computer reads the scanner every few minutes and sends the new punches
            to the portal.
          </li>
          <li>The portal stores each punch once, links it to the person by scanner ID, and works out in and out times.</li>
        </ol>
        <p className="mt-2 text-xs text-[#667085]">
          If the sync program isn&apos;t running yet, use the file import below to load punches by hand.
        </p>
      </section>
      <StaffLinks />
      <ImportFile />
    </>
  );
}

/* ---------- phone approvals (administrator) ---------- */

const when = (iso) =>
  iso
    ? new Date(iso).toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: TZ,
      })
    : "-";

function DeviceApprovals({ onPendingChange }) {
  const [pending, setPending] = useState(null);
  const [approved, setApproved] = useState(null); // null = loading, false = the API can't list approved phones yet
  const [msg, setMsg] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try {
      const list = await listDeviceRequests();
      setPending(list);
      onPendingChange?.(list.length);
    } catch (e) {
      setMsg({ ok: false, text: e.message });
      setPending([]);
    }
    try {
      setApproved(await listApprovedDevices());
    } catch {
      setApproved(false);
    }
  }, [onPendingChange]);

  useEffect(() => {
    load();
  }, [load]);

  async function decide(r, decision) {
    let note = "";
    if (decision === "rejected") {
      note = window.prompt(`Reason for not approving ${r.staffName}'s phone (optional)`);
      if (note === null) return; // cancelled
    }
    setBusyId(r.requestId);
    setMsg(null);
    try {
      await decideDeviceRequest(r.requestId, { decision, note: note.trim() });
      setMsg({
        ok: true,
        text: `${r.staffName}'s phone ${decision === "approved" ? "approved. They can now clock in." : "not approved."}`,
      });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusyId(null);
    }
  }

  async function revoke(d) {
    if (
      !window.confirm(
        `Revoke ${d.staffName}'s phone "${d.label}"? They won't be able to clock in until they register a new phone and you approve it.`
      )
    )
      return;
    setBusyId(d.requestId);
    setMsg(null);
    try {
      await revokeDevice(d.userId, d.credentialId);
      setMsg({ ok: true, text: `${d.staffName}'s phone was revoked.` });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusyId(null);
    }
  }

  const rows = [...(pending || [])].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));

  return (
    <>
      <Banner msg={msg} />

      <section className={`${CARD} mb-6`}>
        <div className="flex items-center gap-2">
          <h3 className="font-medium">Phones waiting for approval</h3>
          {rows.length > 0 && <Chip text={String(rows.length)} cls="bg-[#FFF4E5] text-[#8A4B00]" />}
        </div>
        <p className="mt-1 text-sm text-[#667085]">
          Staff register their own phone, and it can only be used for clocking in once you approve it. Check that the
          person asking is the owner of the phone.
        </p>
        {!pending ? (
          <p className="mt-3 text-sm text-[#667085]">Loading...</p>
        ) : rows.length === 0 ? (
          <p className="mt-3 text-sm text-[#667085]">No phones are waiting.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-sm">
              <thead className="border-b border-[#E6ECE9] bg-[#FAFBFA]">
                <tr>
                  <th className={TH}>Staff member</th>
                  <th className={TH}>Phone</th>
                  <th className={TH}>Registered</th>
                  <th className={TH} />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.requestId} className="border-b border-[#EEF1F0] last:border-0">
                    <td className="px-3 py-2.5">
                      <span className="font-medium">{r.staffName}</span>
                      {r.staffEmail && <span className="block text-xs text-[#667085]">{r.staffEmail}</span>}
                    </td>
                    <td className="px-3 py-2.5">{r.label}</td>
                    <td className="whitespace-nowrap px-3 py-2.5">{when(r.createdAt)}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right">
                      <button
                        className={`${BTN_PRIMARY} px-3 py-1.5`}
                        disabled={busyId === r.requestId}
                        onClick={() => decide(r, "approved")}
                      >
                        Approve
                      </button>{" "}
                      <button
                        className={`${BTN} px-3 py-1.5`}
                        disabled={busyId === r.requestId}
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

      <section className={CARD}>
        <h3 className="font-medium">Approved phones</h3>
        {approved === null ? (
          <p className="mt-3 text-sm text-[#667085]">Loading...</p>
        ) : approved === false ? (
          <p className="mt-3 text-sm text-[#667085]">
            The list of approved phones isn&apos;t available yet. It needs the devices endpoint on the attendance API.
          </p>
        ) : approved.length === 0 ? (
          <p className="mt-3 text-sm text-[#667085]">No phones have been approved yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-sm">
              <thead className="border-b border-[#E6ECE9] bg-[#FAFBFA]">
                <tr>
                  <th className={TH}>Staff member</th>
                  <th className={TH}>Phone</th>
                  <th className={TH}>Approved</th>
                  <th className={TH} />
                </tr>
              </thead>
              <tbody>
                {[...approved]
                  .sort((a, b) => String(a.staffName).localeCompare(String(b.staffName)))
                  .map((d) => (
                    <tr key={d.requestId} className="border-b border-[#EEF1F0] last:border-0">
                      <td className="px-3 py-2.5">
                        <span className="font-medium">{d.staffName}</span>
                        {d.staffEmail && <span className="block text-xs text-[#667085]">{d.staffEmail}</span>}
                      </td>
                      <td className="px-3 py-2.5">{d.label}</td>
                      <td className="whitespace-nowrap px-3 py-2.5">{when(d.decidedAt || d.createdAt)}</td>
                      <td className="px-3 py-2.5 text-right">
                        <button
                          className={`${BTN} px-3 py-1.5`}
                          disabled={busyId === d.requestId}
                          onClick={() => revoke(d)}
                        >
                          Revoke
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

/* ---------- leave: requests, approvals, who is away ---------- */

const LEAVE_TYPES = ["Annual", "Sick", "Maternity", "Paternity", "Compassionate", "Study", "Unpaid", "Other"];

// Working days in a range: weekends and public holidays don't count against the person's leave
function workingDays(from, to) {
  if (!from || !to) return 0;
  let n = 0;
  for (let k = from; k <= to; k = addDays(k, 1)) {
    const o = dayOff(k, []);
    if (!o.weekend && !o.holiday) n += 1;
  }
  return n;
}

const dateRange = (from, to) => (from === to ? fullDate(from) : `${fullDate(from)} to ${fullDate(to)}`);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

const STATUS_TAG = {
  pending: { text: "Waiting for approval", cls: "bg-[#FFF4E5] text-[#8A4B00]" },
  approved: { text: "Approved", cls: "bg-[#E3F3EC] text-[#00664E]" },
  rejected: { text: "Not approved", cls: "bg-[#FDECEA] text-[#8A1C14]" },
  cancelled: { text: "Cancelled", cls: "bg-[#F1F3F2] text-[#667085]" },
};

function Chip({ text, cls }) {
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${cls}`}>{text}</span>;
}

function LeaveRequestForm({ onSent }) {
  const [form, setForm] = useState({ type: "Annual", from: "", to: "", reason: "" });
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
      setMsg({ ok: false, text: "Those dates are all weekends or public holidays, so there is nothing to take as leave." });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await requestLeave({ type: form.type, from: form.from, to: form.to, reason: form.reason.trim() });
      setMsg({ ok: true, text: "Leave request sent. You will see the decision in the list below." });
      setForm({ type: form.type, from: "", to: "", reason: "" });
      onSent();
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`${CARD} mb-6`}>
      <h3 className="font-medium">Request leave</h3>
      <p className="mt-1 text-sm text-[#667085]">
        An administrator or the CEO will approve or decline it. Weekends and public holidays are not counted.
      </p>
      <div className="mt-3">
        <Banner msg={msg} />
      </div>
      <form className="flex flex-wrap items-end gap-3" onSubmit={onSubmit}>
        <label className="text-xs text-[#667085]">
          Type
          <select className={`${INPUT} mt-1 block`} value={form.type} onChange={set("type")}>
            {LEAVE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-[#667085]">
          From
          <input type="date" className={`${INPUT} mt-1 block`} value={form.from} onChange={set("from")} required />
        </label>
        <label className="text-xs text-[#667085]">
          To
          <input type="date" className={`${INPUT} mt-1 block`} value={form.to} onChange={set("to")} required />
        </label>
        <label className="min-w-[200px] flex-1 text-xs text-[#667085]">
          Reason (optional)
          <input
            className={`${INPUT} mt-1 block w-full`}
            value={form.reason}
            onChange={set("reason")}
            maxLength={300}
          />
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

function MyLeaveRequests({ tick, onChange }) {
  const [items, setItems] = useState(null);
  const [msg, setMsg] = useState(null);
  const today = dayKey(new Date().toISOString());

  useEffect(() => {
    let on = true;
    listLeaveRequests({ scope: "me" })
      .then((r) => on && setItems(r))
      .catch((e) => on && setMsg({ ok: false, text: e.message }));
    return () => {
      on = false;
    };
  }, [tick]);

  const canCancel = (r) => r.status === "pending" || (r.status === "approved" && r.from > today);

  async function onCancel(r) {
    if (!window.confirm(`Cancel your ${r.type.toLowerCase()} leave request for ${dateRange(r.from, r.to)}?`)) return;
    try {
      await cancelLeave(r.id);
      onChange();
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    }
  }

  const rows = [...(items || [])].sort((a, b) => b.from.localeCompare(a.from));

  return (
    <section className={`${CARD} mb-6`}>
      <h3 className="font-medium">My leave requests</h3>
      {msg && (
        <div className="mt-3">
          <Banner msg={msg} />
        </div>
      )}
      {!items ? (
        <p className="mt-3 text-sm text-[#667085]">Loading...</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-sm text-[#667085]">You haven&apos;t asked for leave yet.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead className="border-b border-[#E6ECE9] bg-[#FAFBFA]">
              <tr>
                <th className={TH}>Type</th>
                <th className={TH}>Dates</th>
                <th className={TH}>Days</th>
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
                    <td className="px-3 py-2.5 font-medium">{r.type}</td>
                    <td className="whitespace-nowrap px-3 py-2.5">{dateRange(r.from, r.to)}</td>
                    <td className="px-3 py-2.5">{r.days ?? workingDays(r.from, r.to)}</td>
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

// Administrators and the CEO: requests waiting for a decision
function LeaveApprovals({ tick, onChange }) {
  const [items, setItems] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    let on = true;
    listLeaveRequests({ scope: "all", status: "pending" })
      .then((r) => on && setItems(r))
      .catch((e) => on && setMsg({ ok: false, text: e.message }));
    return () => {
      on = false;
    };
  }, [tick]);

  async function decide(r, decision) {
    let note = "";
    if (decision === "rejected") {
      note = window.prompt(`Reason for not approving ${r.name}'s leave (optional)`);
      if (note === null) return; // cancelled
    }
    setBusyId(r.id);
    setMsg(null);
    try {
      await decideLeave(r.id, { decision, note: note.trim() });
      setMsg({
        ok: true,
        text: `${r.name}'s leave ${decision === "approved" ? "approved" : "not approved"}.`,
      });
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
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead className="border-b border-[#E6ECE9] bg-[#FAFBFA]">
              <tr>
                <th className={TH}>Name</th>
                <th className={TH}>Type</th>
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
                  <td className="px-3 py-2.5">{r.type}</td>
                  <td className="whitespace-nowrap px-3 py-2.5">{dateRange(r.from, r.to)}</td>
                  <td className="px-3 py-2.5">{r.days ?? workingDays(r.from, r.to)}</td>
                  <td className="px-3 py-2.5 text-[#667085]">{r.reason || "-"}</td>
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

// Everyone: approved leave, so people can see who is away
function WhoIsOnLeave({ tick }) {
  const [view, setView] = useState("upcoming");
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const today = dayKey(new Date().toISOString());

  useEffect(() => {
    let on = true;
    setItems(null);
    const range =
      view === "past" ? { from: addDays(today, -90), to: addDays(today, -1) } : { from: today, to: addDays(today, 90) };
    listLeave({ scope: "all", ...range })
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
  const showType = rows.some((l) => l.type);
  const onNow = rows.filter((l) => l.from <= today && today <= l.to).length;
  const stateOf = (l) =>
    l.to < today
      ? { text: "Returned", cls: "bg-[#F1F3F2] text-[#667085]" }
      : l.from <= today
      ? { text: "On leave now", cls: "bg-[#FFF4E5] text-[#8A4B00]" }
      : { text: "Upcoming", cls: "bg-[#EEF4FF] text-[#2E5AAC]" };

  return (
    <section className={CARD}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="font-medium">Who is on leave</h3>
          {view === "upcoming" && onNow > 0 && <Chip text={`${onNow} away now`} cls="bg-[#FFF4E5] text-[#8A4B00]" />}
        </div>
        <select className={INPUT} value={view} onChange={(e) => setView(e.target.value)} aria-label="Show leave">
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
          {view === "past" ? "Nobody was on leave in the past 90 days." : "Nobody is on leave in this period."}
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-sm">
            <thead className="border-b border-[#E6ECE9] bg-[#FAFBFA]">
              <tr>
                <th className={TH}>Name</th>
                {showType && <th className={TH}>Type</th>}
                <th className={TH}>Dates</th>
                <th className={TH}>Days</th>
                <th className={TH} />
              </tr>
            </thead>
            <tbody>
              {rows.map((l, i) => (
                <tr key={`${l.userId}|${l.from}|${i}`} className="border-b border-[#EEF1F0] last:border-0">
                  <td className="px-3 py-2.5 font-medium">{l.name}</td>
                  {showType && <td className="px-3 py-2.5">{l.type || "-"}</td>}
                  <td className="whitespace-nowrap px-3 py-2.5">{dateRange(l.from, l.to)}</td>
                  <td className="px-3 py-2.5">{workingDays(l.from, l.to)}</td>
                  <td className="px-3 py-2.5 text-right">
                    <Chip {...stateOf(l)} />
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

function LeavePanel({ canApprove }) {
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return (
    <>
      {canApprove && <LeaveApprovals tick={tick} onChange={refresh} />}
      <LeaveRequestForm onSent={refresh} />
      <MyLeaveRequests tick={tick} onChange={refresh} />
      <WhoIsOnLeave tick={tick} />
    </>
  );
}

/* ---------- page ---------- */

export default function Attendance() {
  const [tab, setTab] = useState("mine");
  const [access, setAccess] = useState({ isAdmin: false });
  const [pendingPhones, setPendingPhones] = useState(0);

  useEffect(() => {
    let mounted = true;
    getAccess()
      .then((r) => mounted && setAccess(r))
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  // Show how many phones are waiting for approval on the Phones tab
  useEffect(() => {
    if (!access.isAdmin) return;
    listDeviceRequests()
      .then((list) => setPendingPhones(list.length))
      .catch(() => {});
  }, [access.isAdmin]);

  // Administrators and the CEO approve leave. If getAccess() returns canApproveLeave, that wins.
  const canApprove = access.canApproveLeave ?? !!access.isAdmin;

  const tabBtn = (key, label) => (
    <button
      key={key}
      role="tab"
      aria-selected={tab === key}
      onClick={() => setTab(key)}
      className={`-mb-px border-b-2 px-4 py-2 text-sm ${FOCUS} ${
        tab === key
          ? "border-[#008060] font-medium text-[#00664E]"
          : "border-transparent text-[#667085] hover:text-[#0B2B24]"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="p-4 text-[#0B2B24] lg:p-6">
      <style>{PRINT_CSS}</style>

      <div className="mb-5">
        <h2 className="text-2xl font-semibold">Attendance</h2>
        <p className="text-sm text-[#667085]">Recorded at the office fingerprint scanner. Times are in Nairobi time.</p>
      </div>

      <div className="mb-5 flex overflow-x-auto border-b border-[#E6ECE9]" role="tablist">
        {tabBtn("mine", "My attendance")}
        {tabBtn("leave", "Leave")}
        {access.isAdmin && tabBtn("team", "Team")}
        {access.isAdmin && tabBtn("devices", pendingPhones ? `Phones (${pendingPhones})` : "Phones")}
        {access.isAdmin && tabBtn("scanner", "Scanner")}
      </div>

      {tab === "leave" ? (
        <LeavePanel canApprove={canApprove} />
      ) : access.isAdmin && tab === "team" ? (
        <TeamAttendance onOpenScanner={() => setTab("scanner")} />
      ) : access.isAdmin && tab === "devices" ? (
        <DeviceApprovals onPendingChange={setPendingPhones} />
      ) : access.isAdmin && tab === "scanner" ? (
        <ScannerSetup />
      ) : (
        <MyAttendance />
      )}
    </div>
  );
}
