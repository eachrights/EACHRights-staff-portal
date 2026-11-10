import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Fingerprint,
  Download,
  Trash2,
  Printer,
  Wifi,
  ScanLine,
  Clock,
  CalendarDays,
  Users,
  Settings,
  QrCode,
  Upload,
  Plus,
  Search,
  FileText,
} from "lucide-react";
import QRCode from "qrcode";
import { getAccess } from "../../access";
import { WEEKEND_DAYS, holidayName } from "../../holidays";
import RemotePanel from "../remote/RemotePanel";
import {
  getConfig,
  saveConfig,
  listHolidays,
  addHoliday,
  deleteHoliday,
  getToday,
  clock,
  getRecords,
  getDay,
  correctRecord,
  importPunches,
  getPasskeys,
  deletePasskey,
  getQr,
  rotateQr,
  listLeave,
  listLeaveRequests,
  requestLeave,
  cancelLeave,
  decideLeave,
} from "./attendanceApi";
import {
  passkeysSupported,
  registerThisDevice,
  getAssertion,
  prepareRegistration,
  prepareAssertion,
} from "./passkeyClient";
import ResetProject from "./ResetProject";
import { SummaryCards, StatTile, filterDays, METRICS } from "./attendanceStats";

/* =====================================================================
   Helpers: time, dates, text
   All times are shown in Nairobi time.
   ===================================================================== */

const TZ = "Africa/Nairobi";
const DAY_MS = 86400000;
const BRAND_FONT = '"Fraunces", Georgia, serif';
const REFRESH_MS = 60000;
const COMPANY = "EACHRights";

// True when the portal is open in a phone's own browser
const onPhone = typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

// The printed QR opens this page with ?clock=<token>. Keep the token for the rest of the day and tidy the address bar.
// localStorage, not sessionStorage: captureClockToken.js also fills it in before the login page appears.
const QR_KEY = "eachrights_clock_qr";
const QR_KEEP_MS = 12 * 3600 * 1000;
function readScan() {
  try {
    const url = new URL(window.location.href);
    const t = url.searchParams.get("clock");
    if (t) {
      localStorage.setItem(QR_KEY, JSON.stringify({ t, at: Date.now() }));
      url.searchParams.delete("clock");
      window.history.replaceState({}, "", url.pathname + url.search + url.hash);
    }
    const saved = JSON.parse(localStorage.getItem(QR_KEY) || "null");
    if (saved && Date.now() - saved.at < QR_KEEP_MS) return saved;
  } catch {
    /* ignore */
  }
  return null;
}

const timeOf = (iso) =>
  new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
const dayKey = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });
const todayKey = () => dayKey(new Date().toISOString());
const noon = (key) => new Date(`${key}T12:00:00Z`);
const dayLabel = (key) =>
  noon(key).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const fullDate = (key) =>
  noon(key).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const addDays = (key, n) => new Date(+noon(key) + n * DAY_MS).toISOString().slice(0, 10);
const weekday = (key) => noon(key).getUTCDay(); // 0 = Sunday
const monthEnd = (ym) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
const prevMonthOf = (today) => {
  const last = addDays(`${today.slice(0, 7)}-01`, -1);
  return { from: `${last.slice(0, 7)}-01`, to: last };
};

// 7.5 hours -> "7h 30m"
const hoursText = (h) => {
  if (!h || h <= 0) return "-";
  const m = Math.round(h * 60);
  return `${Math.floor(m / 60)}h ${m % 60}m`;
};

// "08:00" -> minutes since midnight (NaN when it can't be read)
const toMinutes = (s) => {
  const [h, m] = String(s || "").split(":").map(Number);
  return h * 60 + m;
};

const initials = (name) =>
  String(name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join("");

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const dateRange = (from, to) => (from === to ? fullDate(from) : `${fullDate(from)} to ${fullDate(to)}`);
const matches = (needle, ...parts) => !needle || parts.join(" ").toLowerCase().includes(needle);

/* ---------- ranges ----------
   The API wants plain dates (YYYY-MM-DD) for from and to, not timestamps.
   - rangeDays: history ranges, never later than today.
   - periodDays: whole months or years for reports and leave, not cut off at today. */

function rangeDays(range) {
  const today = todayKey();
  const year = Number(today.slice(0, 4));
  const cap = (to) => (to > today ? today : to);

  if (range === "month") return { from: `${today.slice(0, 7)}-01`, to: today };
  if (range === "lastmonth") return prevMonthOf(today);
  if (range === "30d") return { from: addDays(today, -29), to: today };
  if (range === "year") return { from: `${year}-01-01`, to: today };
  if (range === "lastyear") return { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` };
  if (range.startsWith("m:")) {
    const ym = range.slice(2);
    return { from: `${ym}-01`, to: cap(monthEnd(ym)) };
  }
  if (range.startsWith("y:")) {
    const y = range.slice(2);
    return { from: `${y}-01-01`, to: cap(`${y}-12-31`) };
  }
  // "week": starts Monday
  return { from: addDays(today, -((weekday(today) + 6) % 7)), to: today };
}

function periodDays(p) {
  const today = todayKey();
  const year = Number(today.slice(0, 4));
  if (p === "lastmonth") return prevMonthOf(today);
  if (p === "year") return { from: `${year}-01-01`, to: `${year}-12-31` };
  if (p === "lastyear") return { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` };
  if (p.startsWith("m:")) {
    const ym = p.slice(2);
    return { from: `${ym}-01`, to: monthEnd(ym) };
  }
  if (p.startsWith("y:")) {
    const y = p.slice(2);
    return { from: `${y}-01-01`, to: `${y}-12-31` };
  }
  const ym = today.slice(0, 7); // "month"
  return { from: `${ym}-01`, to: monthEnd(ym) };
}

// Weekends and public holidays from the local holidays file
const dayOff = (key) => ({ weekend: WEEKEND_DAYS.includes(weekday(key)), holiday: holidayName(key) });

// Working days in a range: weekends and public holidays don't count against anyone's leave
function workingDays(from, to) {
  if (!from || !to) return 0;
  let n = 0;
  for (let k = from; k <= to; k = addDays(k, 1)) {
    const o = dayOff(k);
    if (!o.weekend && !o.holiday) n += 1;
  }
  return n;
}

/* ---------- hooks ---------- */

function useNow() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

// Runs fn now and then every minute while enabled.
// Used to fetch passkey challenges ahead of the tap (see passkeyClient.js: Safari wants the prompt to open straight after a tap).
function usePrepare(fn, enabled) {
  useEffect(() => {
    if (!enabled) return undefined;
    fn();
    const t = setInterval(fn, REFRESH_MS);
    return () => clearInterval(t);
  }, [fn, enabled]);
}

/* =====================================================================
   Design tokens (Tailwind classes)
   Staff-sheet look: green title and column bars, dotted row lines, white sheets.
   green #008060 / #00664E | ink #0B2B24 | canvas #F6F8F7 | line #E3E8E5 | muted #667085
   ===================================================================== */

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#008060]";
const BTN = `inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-[#D5DBD8] bg-white px-3.5 text-sm font-medium text-[#0B2B24] shadow-[0_1px_1px_rgba(11,43,36,0.04)] transition hover:border-[#B8C2BD] hover:bg-[#F6F8F7] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none ${FOCUS}`;
const BTN_PRIMARY = `inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-[#008060] bg-[#008060] px-3.5 text-sm font-medium text-white shadow-[0_1px_1px_rgba(11,43,36,0.12)] transition hover:border-[#00664E] hover:bg-[#00664E] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none ${FOCUS}`;
const BTN_SM = `inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-[#D5DBD8] bg-white px-2.5 text-xs font-medium text-[#0B2B24] transition hover:border-[#B8C2BD] hover:bg-[#F6F8F7] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none ${FOCUS}`;
const BTN_SM_PRIMARY = `inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-[#008060] bg-[#008060] px-2.5 text-xs font-medium text-white transition hover:bg-[#00664E] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none ${FOCUS}`;
const INPUT = `h-9 rounded-lg border border-[#D5DBD8] bg-white px-3 text-sm text-[#0B2B24] placeholder:text-[#98A2B3] transition hover:border-[#B8C2BD] motion-reduce:transition-none ${FOCUS}`;
const CARD = "rounded-xl border border-[#E3E8E5] bg-white p-5 shadow-[0_1px_2px_rgba(11,43,36,0.04)]";
const SURFACE = "rounded-xl border border-[#E3E8E5] bg-white shadow-[0_1px_2px_rgba(11,43,36,0.04)]";
const THEAD = "bg-[#008060] text-white";
const TH = "whitespace-nowrap px-4 py-2.5 text-left text-xs font-semibold text-white";
const TD = "px-4 py-3";
const ROW = "border-b border-dotted border-[#008060]/50 transition-colors last:border-0 hover:bg-[#FAFBFA] motion-reduce:transition-none";
const NUM = `${TD} text-right tabular-nums`;
const NUM_HEAD = `${TH} text-right`;
const TOOLBAR = `mb-4 flex flex-wrap items-center gap-2 p-3 print:hidden ${SURFACE}`;
const SUMMARY_BAR =
  "flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-[#EEF1F0] bg-[#F9FAFA] px-5 py-3 text-sm text-[#475467]";

const STATE_TAG = {
  present: { text: "Present", cls: "bg-[#E3F3EC] text-[#00664E]" },
  absent: { text: "Absent", cls: "bg-[#FDECEA] text-[#8A1C14]" },
  weekend: { text: "Weekend", cls: "bg-[#F1F3F2] text-[#667085]" },
  holiday: { text: "Holiday", cls: "bg-[#EEF4FF] text-[#2E5AAC]" },
  leave: { text: "On leave", cls: "bg-[#FFF4E5] text-[#8A4B00]" },
  away: { text: "Away on duty", cls: "bg-[#EEF4FF] text-[#2E5AAC]" },
  remote: { text: "Remote", cls: "bg-[#E8F1FB] text-[#1F5FA8]" },
  upcoming: { text: "Upcoming", cls: "bg-[#F1F3F2] text-[#667085]" },
};
const LATE_CLS = "bg-[#FFF4E5] text-[#8A4B00]";

/* ---------- print: only the element with id="attendance-print" is printed ---------- */

const PRINT_CSS = `
@media print {
  @page { margin: 12mm; }
  body * { visibility: hidden !important; }
  #attendance-print, #attendance-print * { visibility: visible !important; }
  #attendance-print tr { break-inside: avoid; }
  #attendance-print thead { display: table-header-group; }
  #attendance-print * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  #attendance-print {
    position: absolute !important;
    left: 0;
    top: 0;
    width: 100%;
    border: 0 !important;
    border-radius: 0 !important;
    box-shadow: none !important;
  }
}
`;

/* =====================================================================
   Small building blocks
   ===================================================================== */

function PrintHeader({ title, subtitle, period }) {
  return (
    <div className="hidden px-1 pb-3 print:block">
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="text-sm text-[#475467]">
        {subtitle ? `${subtitle} | ` : ""}
        {period} (Nairobi time) | Printed {fullDate(todayKey())}
      </p>
    </div>
  );
}

function Banner({ msg }) {
  if (!msg) return null;
  return (
    <p
      role={msg.ok ? "status" : "alert"}
      className={`mb-4 rounded-lg border-l-4 px-3.5 py-2.5 text-sm ${
        msg.ok
          ? "border-[#008060] bg-[#E8F5EF] text-[#00664E]"
          : "border-[#D92D20] bg-[#FEF3F2] text-[#8A1C14]"
      }`}
    >
      {msg.text}
    </p>
  );
}

// Banner for an error string that may be empty
const ErrorBanner = ({ error, flush = false }) =>
  error ? (
    <div className={flush ? "p-5 pb-0" : ""}>
      <Banner msg={{ ok: false, text: error }} />
    </div>
  ) : null;

function Chip({ text, cls, dot = true }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}
    >
      {dot && <i className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />}
      {text}
    </span>
  );
}

function Avatar({ name, size = 32 }) {
  return (
    <span
      style={{ width: size, height: size, fontSize: size * 0.38 }}
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-[#E3F3EC] font-semibold text-[#00664E]"
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

const PersonCell = ({ name }) => (
  <span className="flex items-center gap-3">
    <Avatar name={name} />
    <span className="font-medium">{name}</span>
  </span>
);

function Loading({ text = "Loading..." }) {
  return (
    <p className="px-4 py-12 text-center text-sm text-[#667085]" role="status">
      <span className="animate-pulse motion-reduce:animate-none">{text}</span>
    </p>
  );
}

function Empty({ icon: Icon = CalendarDays, title, hint }) {
  return (
    <div className="flex flex-col items-center px-4 py-12 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#EEF7F3] text-[#667085]">
        <Icon size={20} />
      </span>
      <p className="mt-3 text-sm font-medium">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-sm text-[#667085]">{hint}</p>}
    </div>
  );
}

// A titled block: blue heading strip with a short description, actions on the right
function Panel({ title, description, actions, children, className = "", id, flush = false }) {
  return (
    <section id={id} className={`mb-6 overflow-hidden ${SURFACE} ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[#E3E8E5] border-t-4 border-t-[#008060] px-5 py-4 print:hidden">
          <div className="min-w-0">
            {title && <h3 className="text-base font-semibold text-[#00664E]">{title}</h3>}
            {description && <p className="mt-1 max-w-2xl text-sm leading-relaxed text-[#667085]">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={flush ? "" : "p-5"}>{children}</div>
    </section>
  );
}

function Field({ label, children, className = "" }) {
  return (
    <label className={`block text-xs font-medium text-[#008060] ${className}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function Toggle({ checked, onChange, label, hint }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-6 py-3.5">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="mt-0.5 block text-xs leading-relaxed text-[#667085]">{hint}</span>}
      </span>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input
          type="checkbox"
          role="switch"
          className="peer sr-only"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="h-6 w-11 rounded-full bg-[#C9D1CD] transition-colors peer-checked:bg-[#008060] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[#008060] motion-reduce:transition-none" />
        <span className="pointer-events-none absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5 motion-reduce:transition-none" />
      </span>
    </label>
  );
}

function SearchBox({ value, onChange }) {
  return (
    <div className="relative">
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#98A2B3]" />
      <input
        type="search"
        className={`${INPUT} w-56 pl-9`}
        placeholder="Search by name"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Search by name"
      />
    </div>
  );
}

// Download CSV and Print buttons shared by every list
function ExportButtons({ onCsv, onPrint = () => window.print(), disabled, preparing = false }) {
  return (
    <>
      <button className={BTN} onClick={onCsv} disabled={disabled}>
        <Download size={16} /> Download CSV
      </button>
      <button className={BTN} onClick={onPrint} disabled={disabled || preparing}>
        <Printer size={16} /> {preparing ? "Preparing..." : "Print"}
      </button>
    </>
  );
}

/* ---------- range and period pickers ---------- */

const RANGE_OPTIONS = [
  ["week", "This week"],
  ["month", "This month"],
  ["lastmonth", "Last month"],
  ["30d", "Last 30 days"],
  ["year", "This year"],
  ["lastyear", "Last year"],
];
const PERIOD_OPTIONS = [
  ["month", "This month"],
  ["lastmonth", "Last month"],
  ["year", "This year"],
  ["lastyear", "Last year"],
];

// One picker for both. Values are "week", "month", ... or "m:2026-10" / "y:2026".
// With future set, next year and later months can be chosen too (leave).
function PeriodSelect({ value, onChange, options = RANGE_OPTIONS, future = false, label = "Date range" }) {
  const thisYear = Number(todayKey().slice(0, 4));
  const kind = value.startsWith("m:") ? "pickmonth" : value.startsWith("y:") ? "pickyear" : value;
  const onKind = (k) => {
    if (k === "pickmonth") onChange(`m:${todayKey().slice(0, 7)}`);
    else if (k === "pickyear") onChange(`y:${thisYear}`);
    else onChange(k);
  };
  const years = Array.from({ length: 6 }, (_, i) => (future ? thisYear + 1 : thisYear) - i);
  return (
    <>
      <select className={INPUT} value={kind} onChange={(e) => onKind(e.target.value)} aria-label={label}>
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
        <option value="pickmonth">Choose a month</option>
        <option value="pickyear">Choose a year</option>
      </select>
      {kind === "pickmonth" && (
        <input
          type="month"
          className={INPUT}
          value={value.slice(2)}
          max={future ? undefined : todayKey().slice(0, 7)}
          onChange={(e) => e.target.value && onChange(`m:${e.target.value}`)}
          aria-label="Month"
        />
      )}
      {kind === "pickyear" && (
        <select className={INPUT} value={value.slice(2)} onChange={(e) => onChange(`y:${e.target.value}`)} aria-label="Year">
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      )}
    </>
  );
}

// Tells the person when today is a holiday, a weekend, a leave day, a trip or a remote day
function DayNote({ day }) {
  if (!day) return null;
  const tag = STATE_TAG[day.state];
  const note = day.note ? `: ${day.note}` : "";
  const text = {
    holiday: `Today is a public holiday${note}.`,
    weekend: "Today is a weekend.",
    leave: "You are on approved leave today.",
    away: `You are away on duty today${note}.`,
    remote: "You are working remotely today.",
  }[day.state];
  if (!text) return null;
  return (
    <p role="status" className={`mb-5 rounded-lg px-4 py-2.5 text-sm font-medium ${tag.cls}`}>
      {text}
    </p>
  );
}

// The clock-out cell: a time, "In progress" for today, or a warning for a past day with no clock-out
function ClockOutCell({ out, hasIn, isToday }) {
  if (out) return timeOf(out);
  if (!hasIn) return "-";
  return isToday ? <span className="text-[#00664E]">In progress</span> : <span className="text-[#B54708]">No clock-out</span>;
}

// One row per day, newest first. Weekends, holidays, leave and absences all show up.
function HistoryTable({ days }) {
  const today = todayKey();
  const rows = [...days].reverse();
  if (!rows.length)
    return (
      <Empty
        title="No days to show"
        hint="Nothing matches here. Clear the card filter or pick a longer range to see more of your history."
      />
    );
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-sm">
        <thead className={THEAD}>
          <tr>
            <th className={TH}>Date</th>
            <th className={TH}>Status</th>
            <th className={TH}>Clock in</th>
            <th className={TH}>Clock out</th>
            <th className={TH}>Hours</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => {
            const tag = STATE_TAG[d.state] || STATE_TAG.absent;
            const r = d.record;
            return (
              <tr key={d.date} className={`${ROW} ${r ? "" : "text-[#667085]"}`}>
                <td className={`${TD} whitespace-nowrap font-medium`}>{dayLabel(d.date)}</td>
                <td className={TD}>
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    <Chip text={(d.state === "holiday" || d.state === "away") && d.note ? d.note : tag.text} cls={tag.cls} />
                    {r?.late && <Chip text="Late" cls={LATE_CLS} />}
                  </span>
                </td>
                <td className={`${TD} tabular-nums`}>{r?.in ? timeOf(r.in) : "-"}</td>
                <td className={`${TD} tabular-nums`}>
                  <ClockOutCell out={r?.out} hasIn={!!r?.in} isToday={d.date === today} />
                </td>
                <td className={`${TD} font-medium tabular-nums`}>{hoursText(r?.hours)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- CSV download ---------- */

function downloadCsv(head, lines, prefix) {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const body = [head, ...lines].map((row) => row.map(esc).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${prefix}-${todayKey()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportDays(days, prefix) {
  downloadCsv(
    ["Date", "Status", "Note", "Clock in (EAT)", "Clock out (EAT)", "Hours", "Late"],
    days.map((d) => [
      d.date,
      STATE_TAG[d.state]?.text || d.state,
      d.note || "",
      d.record?.in ? timeOf(d.record.in) : "",
      d.record?.out ? timeOf(d.record.out) : "",
      d.record?.hours ?? "",
      d.record?.late ? "Yes" : "",
    ]),
    prefix
  );
}

const sourceLabel = (source) =>
  source === "scanner" ? "Office scanner" : source === "admin" ? "Corrected by admin" : source ? "Phone or laptop" : "-";

function exportDay(date, records, others = []) {
  downloadCsv(
    ["Date", "Name", "User ID", "Status", "Note", "Clock in (EAT)", "Clock out (EAT)", "Hours", "Late", "Source"],
    [
      ...records.map((r) => [
        date,
        r.userName,
        r.userId,
        STATE_TAG.present.text,
        "",
        r.in ? timeOf(r.in) : "",
        r.out ? timeOf(r.out) : "",
        r.hours ?? "",
        r.late ? "Yes" : "",
        sourceLabel(r.source),
      ]),
      ...others.map((p) => [date, p.userName, p.userId, STATE_TAG[p.state]?.text || p.state, p.note || "", "", "", "", "", ""]),
    ],
    `team-attendance-${date}`
  );
}

/* =====================================================================
   My phone: fingerprint, face or PIN
   ===================================================================== */

function PasskeyCard({ today, onChange }) {
  const [items, setItems] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const supported = passkeysSupported();

  const load = useCallback(
    () =>
      getPasskeys()
        .then((r) => setItems(r.passkeys || []))
        .catch(() => setItems([])),
    []
  );
  useEffect(() => {
    load();
  }, [load]);

  // Have the registration challenge ready before the person taps the button
  usePrepare(prepareRegistration, supported);

  // Nothing to show when passkeys are neither required nor already set up and this device can't do them
  if (!supported && !(items && items.length) && !today.requirePasskey) return null;

  async function onRegister() {
    setBusy(true);
    setMsg(null);
    try {
      await registerThisDevice();
      setMsg({ ok: true, text: "This device is registered. You will confirm with your fingerprint, face or PIN when you clock in." });
      await Promise.all([load(), onChange()]);
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  async function onRemove(p) {
    if (!window.confirm(`Remove ${p.label}? You will need to register a device again to clock in.`)) return;
    try {
      await deletePasskey(p.id);
      await Promise.all([load(), onChange()]);
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    }
  }

  return (
    <Panel
      title="My phone"
      description={
        <>
          {today.requirePasskey
            ? "To clock in you confirm with your fingerprint, face or screen PIN on a device you have registered."
            : "Register your phone so clocking in is confirmed with your fingerprint, face or screen PIN."}{" "}
          Your fingerprint never leaves your phone. If the clock page says your phone isn&apos;t registered, remove it
          here and register it again.
        </>
      }
      actions={
        supported && (
          <button className={items?.length ? BTN : BTN_PRIMARY} onClick={onRegister} disabled={busy}>
            <Fingerprint size={16} />
            {busy ? "Waiting for your phone..." : items?.length ? "Register this device too" : "Register this device"}
          </button>
        )
      }
    >
      <Banner msg={msg} />
      {items && items.length > 0 ? (
        <ul className="divide-y divide-dotted divide-[#008060]/40 text-sm">
          {items.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 py-2.5 first:pt-0 last:pb-0">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#E3F3EC] text-[#00664E]">
                <Fingerprint size={18} />
              </span>
              <span className="flex-1 font-medium">{p.label}</span>
              <span className="text-xs text-[#667085]">Added {fullDate(dayKey(p.createdAt))}</span>
              <button className={BTN_SM} onClick={() => onRemove(p)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-[#667085]">No devices registered yet.</p>
      )}
      {!supported && (
        <p className="mt-3 rounded-lg bg-[#FFF4E5] px-3.5 py-2.5 text-sm text-[#8A4B00]">
          This browser can&apos;t use fingerprint or PIN here. Open the portal in Chrome or Safari over https.
        </p>
      )}
    </Panel>
  );
}

/* =====================================================================
   QR poster (administrator): print it and stick it up at the office
   ===================================================================== */

// To use your own logo: save it in the portal's public folder (for example public/logo.png) and set this to "/logo.png".
// Leave it empty to use the "E" mark from the login page.
const LOGO_SRC = "/logo.png";

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const loadImage = (src) =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });

// A QR code with the logo in the middle. "H" error correction lets the scanner ignore the covered centre.
async function makeQrImage(url) {
  const canvas = document.createElement("canvas");
  await QRCode.toCanvas(canvas, url, {
    width: 900,
    margin: 0,
    errorCorrectionLevel: "H",
    color: { dark: "#0B2B24", light: "#FFFFFF" },
  });
  const ctx = canvas.getContext("2d");
  const size = canvas.width;
  const box = Math.round(size * 0.19);
  const x = Math.round((size - box) / 2);
  const pad = 16;

  ctx.fillStyle = "#FFFFFF";
  roundedRect(ctx, x - pad, x - pad, box + pad * 2, box + pad * 2, 30);
  ctx.fill();

  const logo = LOGO_SRC ? await loadImage(LOGO_SRC) : null;
  if (logo) {
    const scale = Math.min(box / logo.width, box / logo.height);
    const w = logo.width * scale;
    const h = logo.height * scale;
    ctx.drawImage(logo, x + (box - w) / 2, x + (box - h) / 2, w, h);
  } else {
    ctx.fillStyle = "#008060";
    roundedRect(ctx, x, x, box, box, 24);
    ctx.fill();
    ctx.fillStyle = "#FFFFFF";
    ctx.font = `600 ${Math.round(box * 0.7)}px ${BRAND_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("E", size / 2, size / 2 + box * 0.04);
  }
  return canvas.toDataURL("image/png");
}

// The poster is drawn on an A4 sheet (794 x 1123 px = 210 x 297 mm). On screen it is shown smaller; printing uses the full size.
const POSTER_CSS = `
.poster-frame { position: relative; width: 556px; height: 786px; margin: 0 auto; overflow: hidden; border-radius: 14px; box-shadow: 0 8px 30px rgba(11,43,36,.15); background: #fff; }
.poster-sheet { width: 794px; height: 1123px; transform: scale(0.7); transform-origin: top left; display: flex; flex-direction: column; background: #fff; color: #0B2B24; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
@media print {
  @page { size: A4 portrait; margin: 0; }
  #attendance-print { width: 210mm !important; height: 297mm !important; overflow: hidden !important; border-radius: 0 !important; box-shadow: none !important; }
  #attendance-print .poster-sheet { transform: none !important; }
  #attendance-print * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`;

function PosterLogo({ size = 76 }) {
  return (
    <div
      style={{ width: size, height: size, borderRadius: size * 0.26 }}
      className="flex items-center justify-center overflow-hidden bg-white shadow-md"
    >
      {LOGO_SRC ? (
        <img src={LOGO_SRC} alt="EACHRights" style={{ width: "80%", height: "80%", objectFit: "contain" }} />
      ) : (
        <span style={{ fontFamily: BRAND_FONT, fontSize: size * 0.62, fontWeight: 600, color: "#008060", lineHeight: 1 }}>E</span>
      )}
    </div>
  );
}

function PosterStep({ icon: Icon, title, caption }) {
  return (
    <div style={{ flex: 1, textAlign: "center" }}>
      <div
        style={{ width: 70, height: 70, borderRadius: 35, background: "#E3F3EC", color: "#00664E", margin: "0 auto" }}
        className="flex items-center justify-center"
      >
        <Icon size={32} />
      </div>
      <p style={{ marginTop: 12, fontSize: 18, fontWeight: 700 }}>{title}</p>
      <p style={{ marginTop: 3, fontSize: 14, color: "#667085" }}>{caption}</p>
    </div>
  );
}

function QrScreen() {
  const [token, setToken] = useState(null);
  const [img, setImg] = useState("");
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let on = true;
    getQr()
      .then((r) => on && setToken(r.token))
      .catch((e) => on && setMsg({ ok: false, text: e.message }));
    return () => {
      on = false;
    };
  }, []);

  useEffect(() => {
    if (!token) return undefined;
    let on = true;
    const url = `${window.location.origin}/clock?clock=${encodeURIComponent(token)}`;
    makeQrImage(url)
      .then((data) => on && setImg(data))
      .catch(() => on && setMsg({ ok: false, text: "Could not draw the QR code." }));
    return () => {
      on = false;
    };
  }, [token]);

  async function onRotate() {
    if (!window.confirm("Make a new QR code? The one already printed will stop working, so you will need to print and put up the new one.")) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await rotateQr();
      setToken(r.token);
      setMsg({ ok: true, text: "New QR code made. Print it and replace the old one." });
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <style>{POSTER_CSS}</style>

      <Panel
        className="print:hidden"
        title="QR poster"
        description="Print this A4 poster and put it up at the office. Staff scan it with their phone camera, which opens a clock page, then tap the button and confirm with their fingerprint, face or PIN. No password is needed. It only works while they are on the office network, so scanning it from home or on mobile data won't let anyone clock in. If a photo of the poster is ever shared around, make a new code."
        actions={
          <>
            <button className={BTN} onClick={onRotate} disabled={busy || !token}>
              Make a new code
            </button>
            <button className={BTN_PRIMARY} onClick={() => window.print()} disabled={!img}>
              <Printer size={16} /> Print poster
            </button>
          </>
        }
      >
        <Banner msg={msg} />
        <p className="rounded-lg bg-[#F6F8F7] px-3.5 py-2.5 text-sm text-[#475467]">
          In the print window, choose A4, margins None, and turn on background graphics so the colours print.
        </p>
      </Panel>

      <div className="overflow-x-auto pb-4">
        <div id="attendance-print" className="poster-frame">
          <div className="poster-sheet">
            {/* Header */}
            <div
              style={{
                position: "relative",
                overflow: "hidden",
                height: 250,
                padding: "46px 64px 0",
                color: "#fff",
                background: "linear-gradient(135deg, #008060 0%, #00664E 100%)",
                borderRadius: "0 0 56px 56px",
              }}
            >
              <div style={{ position: "absolute", right: -90, top: -130, width: 380, height: 380, borderRadius: 190, background: "rgba(255,255,255,0.08)" }} />
              <div style={{ position: "absolute", right: 120, bottom: -150, width: 260, height: 260, borderRadius: 130, background: "rgba(255,255,255,0.06)" }} />
              <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 20 }}>
                <PosterLogo />
                <div>
                  <p style={{ fontFamily: BRAND_FONT, fontSize: 44, fontWeight: 600, lineHeight: 1.05 }}>EACHRights</p>
                  <p style={{ marginTop: 6, fontSize: 14, letterSpacing: 4, textTransform: "uppercase", opacity: 0.85 }}>Staff attendance</p>
                </div>
              </div>
              <p style={{ position: "relative", marginTop: 34, fontSize: 18, opacity: 0.92 }}>
                Advancing Rights. Strengthening Systems. Transforming Lives.
              </p>
            </div>

            {/* Headline */}
            <div style={{ marginTop: 38, textAlign: "center" }}>
              <p style={{ fontFamily: BRAND_FONT, fontSize: 60, fontWeight: 600, lineHeight: 1.05 }}>Clock in &amp; out</p>
              <p style={{ marginTop: 8, fontSize: 22, color: "#475467" }}>Scan with your phone camera</p>
            </div>

            {/* QR */}
            <div
              style={{
                position: "relative",
                width: 400,
                margin: "34px auto 0",
                padding: 26,
                background: "#fff",
                border: "4px solid #008060",
                borderRadius: 36,
                boxShadow: "0 18px 40px rgba(0,128,96,0.18)",
              }}
            >
              <span
                style={{
                  position: "absolute",
                  top: -19,
                  left: "50%",
                  transform: "translateX(-50%)",
                  padding: "6px 24px",
                  borderRadius: 999,
                  background: "#008060",
                  color: "#fff",
                  fontSize: 15,
                  fontWeight: 700,
                  letterSpacing: 3,
                }}
              >
                SCAN ME
              </span>
              {img ? (
                <img src={img} alt="QR code for clocking in" style={{ display: "block", width: 340, height: 340 }} />
              ) : (
                <div style={{ width: 340, height: 340 }} className="flex items-center justify-center text-sm text-[#667085]">
                  {msg ? "" : "Loading..."}
                </div>
              )}
            </div>

            {/* Steps */}
            <div style={{ display: "flex", gap: 16, padding: "38px 56px 0" }}>
              <PosterStep icon={Wifi} title="Connect" caption="To the office Wi-Fi" />
              <PosterStep icon={ScanLine} title="Scan" caption="This code with your camera" />
              <PosterStep icon={Fingerprint} title="Confirm" caption="Fingerprint, face or PIN" />
            </div>

            {/* Footer */}
            <div style={{ marginTop: "auto", padding: "22px 64px 26px", textAlign: "center", background: "#EEF7F3" }}>
              <p style={{ fontSize: 15, fontWeight: 600, color: "#00664E" }}>Works on the office network only</p>
              <p style={{ marginTop: 4, fontSize: 13, color: "#475467" }}>
                First time? Sign in to the staff portal once and register your phone under Attendance, My phone.
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/* =====================================================================
   My attendance
   ===================================================================== */

function MyAttendance() {
  const [today, setToday] = useState(null);
  const [data, setData] = useState(null);
  const [range, setRange] = useState("week");
  const [cardKey, setCardKey] = useState(null); // a clicked summary card filters the history
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [scan] = useState(readScan);
  const now = useNow();

  const loadToday = useCallback(
    () => getToday().then(setToday).catch((e) => setMsg({ ok: false, text: e.message })),
    []
  );
  const loadRecords = useCallback(() => {
    const { from, to } = rangeDays(range);
    return getRecords({ from, to })
      .then(setData)
      .catch((e) => setMsg({ ok: false, text: e.message }));
  }, [range]);
  const reload = useCallback(() => Promise.all([loadToday(), loadRecords()]), [loadToday, loadRecords]);

  useEffect(() => {
    loadToday();
  }, [loadToday]);
  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  // Refresh now and then so a scanner punch shows up without reloading,
  // and re-check the office network as soon as the connection changes or the tab regains focus
  useEffect(() => {
    const t = setInterval(reload, REFRESH_MS);
    window.addEventListener("online", reload);
    window.addEventListener("focus", reload);
    return () => {
      clearInterval(t);
      window.removeEventListener("online", reload);
      window.removeEventListener("focus", reload);
    };
  }, [reload]);

  const usesPasskey = !!(today?.requirePasskey || today?.hasPasskey);
  // Have the clock-in challenge ready before the person taps the button
  usePrepare(prepareAssertion, usesPasskey);

  const rec = today?.record;
  const clockedIn = !!rec?.in && !rec?.out;
  const finished = !!rec?.in && !!rec?.out;
  const action = rec?.in ? "out" : "in";
  const scanOk = !!scan && now - scan.at < QR_KEEP_MS;
  const needPhone = !!today?.requirePasskey && !today?.hasPasskey;
  const needQr = !!today?.requireQr && !scanOk;
  const todayDay = data?.days.find((d) => d.date === todayKey());
  const workedToday = rec?.in ? (rec.out ? rec.hours : (now - new Date(rec.in)) / 36e5) : 0;
  const shownDays = useMemo(() => filterDays(data?.days || [], cardKey), [data, cardKey]);
  const { from: rangeFrom, to: rangeTo } = rangeDays(range);

  // How much of the working day is done (only when the working hours are set)
  const expected = today?.config ? (toMinutes(today.config.workEnd) - toMinutes(today.config.workStart)) / 60 : NaN;
  const pct = expected > 0 ? Math.min(100, Math.round((workedToday / expected) * 100)) : null;

  async function onClock() {
    setBusy(true);
    setMsg(null);
    try {
      const extra = {};
      if (usesPasskey) extra.assertion = await getAssertion();
      if (scanOk) extra.qrToken = scan.t;
      const r = await clock(action, onPhone ? "phone" : "laptop", extra);
      setMsg({
        ok: true,
        text: action === "in" ? `Clocked in at ${timeOf(r.in)}.` : `Clocked out at ${timeOf(r.out)}.`,
      });
      await reload();
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
      // Each prepared challenge is used once. Get the next one now so a quick clock out is still instant.
      if (usesPasskey) prepareAssertion();
    }
  }

  const name = data?.days.find((d) => d.record)?.record.userName;

  return (
    <>
      <Banner msg={msg} />
      <DayNote day={todayDay} />

      <div className="mb-6 grid gap-4 lg:grid-cols-[1.7fr_1fr]">
        {/* CLOCK CARD */}
        <section
          aria-label="Clock in and out"
          className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#0B2B24] via-[#0A4A3A] to-[#00664E] p-6 text-white shadow-[0_8px_24px_rgba(11,43,36,0.18)] sm:p-8"
        >
          <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-white/[0.05]" />
          <div className="pointer-events-none absolute -bottom-24 right-24 h-52 w-52 rounded-full bg-white/[0.04]" />
          {!today ? (
            <p className="relative text-sm text-white/70">Loading...</p>
          ) : (
            <div className="relative flex flex-wrap items-center justify-between gap-6">
              <div className="min-w-0">
                <p className="text-sm font-medium text-white/70">
                  {now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: TZ })}
                </p>
                <p
                  style={{ fontFamily: BRAND_FONT }}
                  className="mt-1 text-5xl font-semibold tabular-nums leading-none sm:text-6xl"
                >
                  {now.toLocaleTimeString("en-GB", { timeZone: TZ })}
                </p>
                <p className="mt-4 flex flex-wrap items-center gap-2 text-sm">
                  {clockedIn ? (
                    <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 font-medium">
                      <i className="h-2 w-2 animate-pulse rounded-full bg-[#5EE0B0] motion-reduce:animate-none" />
                      Clocked in since {timeOf(rec.in)} ({hoursText(workedToday)})
                    </span>
                  ) : finished ? (
                    <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 font-medium">
                      <i className="h-2 w-2 rounded-full bg-[#5EE0B0]" />
                      Clocked out at {timeOf(rec.out)} after {hoursText(rec.hours)}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-white/80">
                      <i className="h-2 w-2 rounded-full bg-white/50" />
                      Not clocked in
                    </span>
                  )}
                  {rec?.late && <Chip text="Late" cls={LATE_CLS} />}
                </p>
                <p className="mt-3 max-w-sm text-xs leading-relaxed text-white/60">
                  You can also press your finger on the office scanner when it is working. Both count toward your attendance.
                </p>
              </div>

              <button
                onClick={onClock}
                disabled={busy || !today.canClock || needPhone || needQr}
                className={`flex h-32 w-32 shrink-0 flex-col items-center justify-center gap-1.5 rounded-full shadow-[0_6px_20px_rgba(0,0,0,0.25)] ring-4 ring-white/20 transition hover:scale-[1.03] hover:ring-white/30 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:scale-100 motion-reduce:transition-none motion-reduce:hover:scale-100 ${
                  action === "out" ? "bg-[#FFE4C4] text-[#93390A]" : "bg-white text-[#00664E]"
                } focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white`}
              >
                <Fingerprint size={36} />
                <span className="text-center text-sm font-semibold leading-tight">
                  {busy ? "Please wait..." : !rec?.in ? "Clock in" : finished ? "Clock out again" : "Clock out"}
                </span>
              </button>

              {(needQr && today.canClock) || (!today.canClock && today.reason) ? (
                <div className="w-full space-y-2">
                  {needQr && today.canClock && (
                    <p role="status" className="rounded-lg bg-white/10 px-3.5 py-2.5 text-sm text-white">
                      Scan the QR code at the office with your phone camera (while on the office Wi-Fi), then tap Clock in.
                    </p>
                  )}
                  {!today.canClock && today.reason && (
                    <p role="status" className="rounded-lg bg-white/10 px-3.5 py-2.5 text-sm text-white">
                      {today.reason}
                    </p>
                  )}
                </div>
              ) : null}
            </div>
          )}
        </section>

        {/* TODAY */}
        <section className={`${CARD} border-t-4 border-t-[#008060]`} aria-label="Today">
          <h3 className="text-sm font-semibold text-[#008060]">Hours today</h3>
          <p className="mt-1 text-3xl font-semibold tabular-nums">{hoursText(workedToday)}</p>
          {pct !== null && (
            <div className="mt-3">
              <div
                className="h-2 overflow-hidden rounded-full bg-[#EEF1F0]"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct}
                aria-label="Share of the working day completed"
              >
                <div className="h-full rounded-full bg-[#008060] transition-[width] motion-reduce:transition-none" style={{ width: `${pct}%` }} />
              </div>
              <p className="mt-1.5 text-xs text-[#667085]">{pct}% of the working day</p>
            </div>
          )}
          <ul className="mt-4 space-y-2.5 border-t border-dotted border-[#008060]/50 pt-4 text-sm">
            {!rec?.in && !rec?.out && <li className="text-[#667085]">No clock in yet.</li>}
            {rec?.in && (
              <li className="flex items-center gap-2.5">
                <i className="h-2.5 w-2.5 rounded-full bg-[#0F9F77]" />
                <span className="flex-1 text-[#475467]">Clocked in</span>
                <span className="font-medium tabular-nums">{timeOf(rec.in)}</span>
              </li>
            )}
            {rec?.out && (
              <li className="flex items-center gap-2.5">
                <i className="h-2.5 w-2.5 rounded-full bg-[#B54708]" />
                <span className="flex-1 text-[#475467]">Clocked out</span>
                <span className="font-medium tabular-nums">{timeOf(rec.out)}</span>
              </li>
            )}
            {today?.config && (
              <li className="flex items-center gap-2.5 text-[#667085]">
                <Clock size={14} />
                <span className="flex-1">Working hours</span>
                <span className="tabular-nums">
                  {today.config.workStart} to {today.config.workEnd}
                </span>
              </li>
            )}
          </ul>
        </section>
      </div>

      {today && <PasskeyCard today={today} onChange={loadToday} />}

      <SummaryCards summary={data?.summary} active={cardKey} onSelect={setCardKey} />

      {/* HISTORY */}
      <section id="attendance-print" className={`mb-6 overflow-hidden ${SURFACE}`}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E3E8E5] border-t-4 border-t-[#008060] px-5 py-4 print:hidden">
          <div>
            <h3 className="text-base font-semibold text-[#00664E]">My history</h3>
            <p className="mt-0.5 text-sm text-[#667085]">
              {cardKey ? (
                <>
                  Showing only: <strong>{METRICS[cardKey].label}</strong>.{" "}
                  <button className="font-medium text-[#00664E] underline" onClick={() => setCardKey(null)}>
                    Show every day
                  </button>
                </>
              ) : (
                "Every day in the period, newest first."
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <PeriodSelect value={range} onChange={setRange} />
            <ExportButtons onCsv={() => exportDays(shownDays, "my-attendance")} disabled={!shownDays.length} />
          </div>
        </div>
        <PrintHeader title="My attendance" subtitle={name} period={dateRange(rangeFrom, rangeTo)} />
        {data ? <HistoryTable days={shownDays} /> : <Loading />}
      </section>
    </>
  );
}

/* =====================================================================
   Team (administrator)
   ===================================================================== */

// Add or correct one person's record for one day
function CorrectForm({ date, initial, onDone, onCancel }) {
  const known = !!initial?.userId;
  const [f, setF] = useState({
    userId: initial?.userId || "",
    userName: initial?.userName || "",
    in: initial?.in ? timeOf(initial.in) : "",
    out: initial?.out ? timeOf(initial.out) : "",
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));

  async function onSubmit(e) {
    e.preventDefault();
    if (!f.userId.trim()) {
      setMsg({ ok: false, text: "Enter the person's user ID." });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await correctRecord(f.userId.trim(), date, {
        in: f.in,
        out: f.out,
        ...(f.userName.trim() ? { userName: f.userName.trim() } : {}),
      });
      onDone();
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      className="print:hidden"
      title={known ? `Correct ${initial.userName || initial.userId}` : "Add a record"}
      description={`For ${fullDate(date)}. Times are Nairobi time. Leave a time empty to clear it.`}
    >
      <Banner msg={msg} />
      <form className="flex flex-wrap items-end gap-3" onSubmit={onSubmit}>
        {!known && (
          <>
            <Field label="User ID">
              <input className={`${INPUT} mt-1.5 block w-64`} value={f.userId} onChange={set("userId")} />
            </Field>
            <Field label="Name">
              <input className={`${INPUT} mt-1.5 block w-48`} value={f.userName} onChange={set("userName")} />
            </Field>
          </>
        )}
        <Field label="Clock in">
          <input type="time" className={`${INPUT} mt-1.5 block`} value={f.in} onChange={set("in")} />
        </Field>
        <Field label="Clock out">
          <input type="time" className={`${INPUT} mt-1.5 block`} value={f.out} onChange={set("out")} />
        </Field>
        <button className={BTN_PRIMARY} disabled={busy}>
          {busy ? "Saving..." : "Save record"}
        </button>
        <button type="button" className={BTN} onClick={onCancel}>
          Cancel
        </button>
      </form>
    </Panel>
  );
}

// One person's days over a range
function PersonHistory({ person, onClose }) {
  const [range, setRange] = useState("month");
  const [cardKey, setCardKey] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let on = true;
    const { from, to } = rangeDays(range);
    setData(null);
    getRecords({ from, to, userId: person.userId })
      .then((r) => {
        if (!on) return;
        setError("");
        setData(r);
      })
      .catch((e) => on && setError(e.message));
    return () => {
      on = false;
    };
  }, [range, person.userId]);

  return (
    <Panel
      className="print:hidden"
      flush
      title={person.userName || person.userId}
      description="Attendance history"
      actions={
        <>
          <PeriodSelect value={range} onChange={setRange} />
          <button className={BTN} onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <ErrorBanner error={error} flush />
      {data && (
        <>
          <div className="px-5 pt-5">
            <SummaryCards summary={data.summary} active={cardKey} onSelect={setCardKey} />
          </div>
          <HistoryTable days={filterDays(data.days, cardKey)} />
        </>
      )}
      {!data && !error && <Loading />}
    </Panel>
  );
}

// The phones someone has registered. Remove them when a phone is lost or the person leaves.
function PersonPhones({ person, onClose }) {
  const [items, setItems] = useState(null);
  const [msg, setMsg] = useState(null);

  const load = useCallback(
    () =>
      getPasskeys(person.userId)
        .then((r) => setItems(r.passkeys || []))
        .catch((e) => setMsg({ ok: false, text: e.message })),
    [person.userId]
  );
  useEffect(() => {
    load();
  }, [load]);

  async function onRemove(p) {
    if (!window.confirm(`Remove ${p.label} for ${person.userName || person.userId}? They will not be able to clock in with it.`)) return;
    try {
      await deletePasskey(p.id, person.userId);
      await load();
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    }
  }

  return (
    <Panel
      className="print:hidden"
      title={`Phones registered by ${person.userName || person.userId}`}
      description="Remove a phone when it is lost or the person leaves."
      actions={
        <button className={BTN} onClick={onClose}>
          Close
        </button>
      }
    >
      <Banner msg={msg} />
      {!items ? (
        <p className="text-sm text-[#667085]">Loading...</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-[#667085]">No phones registered.</p>
      ) : (
        <ul className="divide-y divide-dotted divide-[#008060]/40 text-sm">
          {items.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 py-2.5 first:pt-0 last:pb-0">
              <span className="flex-1 font-medium">{p.label}</span>
              <span className="text-xs text-[#667085]">
                Added {fullDate(dayKey(p.createdAt))}
                {p.lastUsedAt ? `, last used ${fullDate(dayKey(p.lastUsedAt))}` : ""}
              </span>
              <button className={BTN_SM} onClick={() => onRemove(p)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function TeamAttendance() {
  const [date, setDate] = useState(todayKey());
  const [q, setQ] = useState("");
  const [stat, setStat] = useState(null); // clicked tile: "present" | "late" | "stillIn"
  const [records, setRecords] = useState([]);
  const [off, setOff] = useState([]); // on approved leave, a trip or remote work that day, with no clock record
  const [absent, setAbsent] = useState([]); // usual staff with no clock record and nothing approved that day
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null); // a record to correct, or {} to add a new one
  const [history, setHistory] = useState(null);
  const [phones, setPhones] = useState(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let on = true;
    setLoading(true);
    getDay(date)
      .then((r) => {
        if (!on) return;
        setError("");
        setRecords(r.records || []);
        setOff(r.off || []);
        setAbsent(r.absent || []);
      })
      .catch((e) => on && setError(e.message))
      .finally(() => on && setLoading(false));
    return () => {
      on = false;
    };
  }, [date, tick]);

  const needle = q.trim().toLowerCase();

  const filtered = useMemo(() => {
    let list = records.filter((r) => matches(needle, r.userName, r.userId));
    if (stat === "late") list = list.filter((r) => r.late);
    if (stat === "stillIn") list = list.filter((r) => r.in && !r.out);
    return list;
  }, [records, needle, stat]);

  const stillIn = records.filter((r) => r.in && !r.out).length;
  const late = records.filter((r) => r.late).length;
  const isToday = date === todayKey();
  const toggleStat = (k) => setStat((s) => (s === k ? null : k));
  const stillInLabel = isToday ? "In the office now" : "No clock-out";
  const statLabel = { present: "Present", late: "Late", stillIn: stillInLabel };

  // Everyone who is not in the clock table: leave, away on duty, remote, absent (filtered by the search box too).
  // Hidden while a tile filter is on, because those people have no clock record.
  const others = useMemo(
    () => (stat ? [] : [...off, ...absent].filter((p) => matches(needle, p.userName, p.userId))),
    [off, absent, needle, stat]
  );
  const count = (state) => others.filter((p) => p.state === state).length;
  const hasAnything = filtered.length > 0 || others.length > 0;

  return (
    <>
      <ErrorBanner error={error} />

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile label="Present" value={records.length} dot="bg-[#0F9F77]" active={stat === "present"} onClick={() => toggleStat("present")} />
        <StatTile label="Late" value={late} cls="text-[#8A4B00]" dot="bg-[#F79009]" active={stat === "late"} onClick={() => toggleStat("late")} />
        <StatTile label={stillInLabel} value={stillIn} cls="text-[#00664E]" dot="bg-[#4F7CD8]" active={stat === "stillIn"} onClick={() => toggleStat("stillIn")} />
      </div>

      <div className={TOOLBAR}>
        <div className="inline-flex items-center gap-1">
          <button className={BTN} onClick={() => setDate(addDays(date, -1))} aria-label="Previous day">
            Previous
          </button>
          <input
            type="date"
            className={INPUT}
            value={date}
            max={todayKey()}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            aria-label="Date"
          />
          <button className={BTN} onClick={() => setDate(addDays(date, 1))} disabled={date >= todayKey()} aria-label="Next day">
            Next
          </button>
        </div>
        <SearchBox value={q} onChange={setQ} />
        {stat && (
          <span className="inline-flex items-center gap-2 text-sm text-[#475467]">
            Showing: <strong>{statLabel[stat]}</strong>
            <button className={BTN_SM} onClick={() => setStat(null)}>
              Clear
            </button>
          </span>
        )}
        <span className="flex-1" />
        <button className={BTN} onClick={() => setEditing({})}>
          <Plus size={16} /> Add record
        </button>
        <ExportButtons onCsv={() => exportDay(date, filtered, others)} disabled={!hasAnything} />
      </div>

      {editing && (
        <CorrectForm
          key={editing.userId || "new"}
          date={date}
          initial={editing}
          onCancel={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            setTick((t) => t + 1);
          }}
        />
      )}
      {history && <PersonHistory person={history} onClose={() => setHistory(null)} />}
      {phones && <PersonPhones person={phones} onClose={() => setPhones(null)} />}

      <div id="attendance-print" className={`mb-6 overflow-hidden ${SURFACE}`}>
        <PrintHeader title="Team attendance" subtitle={needle ? `Filter: ${q.trim()}` : "All staff"} period={fullDate(date)} />
        {!loading && hasAnything && (
          <div className={SUMMARY_BAR}>
            <span className="font-semibold text-[#0B2B24]">{fullDate(date)}</span>
            <span>Present {filtered.length}</span>
            <span>Late {late}</span>
            <span>On leave {count("leave")}</span>
            <span>Away on duty {count("away")}</span>
            <span>Remote {count("remote")}</span>
            <span>Absent {count("absent")}</span>
          </div>
        )}
        {loading ? (
          <Loading />
        ) : !hasAnything ? (
          <Empty
            icon={Users}
            title={stat ? `Nobody matches "${statLabel[stat]}" on ${fullDate(date)}` : `No attendance recorded on ${fullDate(date)}`}
            hint={stat ? "Click the tile again to show everyone." : "Pick another date, or add a record if someone forgot to clock in."}
          />
        ) : (
          <>
            {filtered.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] border-collapse text-sm">
                  <thead className={THEAD}>
                    <tr>
                      <th className={TH}>Name</th>
                      <th className={TH}>Clock in</th>
                      <th className={TH}>Clock out</th>
                      <th className={TH}>Hours</th>
                      <th className={TH}>Source</th>
                      <th className={`${TH} print:hidden`} />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r) => (
                      <tr key={r.userId} className={ROW}>
                        <td className={TD}>
                          <span className="flex items-center gap-3">
                            <Avatar name={r.userName || r.userId} />
                            <span className="inline-flex flex-wrap items-center gap-2">
                              <span className="font-medium">{r.userName || r.userId}</span>
                              {r.late && <Chip text="Late" cls={LATE_CLS} />}
                            </span>
                          </span>
                        </td>
                        <td className={`${TD} tabular-nums`}>{r.in ? timeOf(r.in) : "-"}</td>
                        <td className={`${TD} tabular-nums`}>
                          <ClockOutCell out={r.out} hasIn={!!r.in} isToday={isToday} />
                        </td>
                        <td className={`${TD} font-medium tabular-nums`}>{hoursText(r.hours)}</td>
                        <td className={`${TD} text-[#667085]`}>
                          {sourceLabel(r.source)}
                          {r.verified ? " (passkey)" : ""}
                        </td>
                        <td className={`${TD} whitespace-nowrap text-right print:hidden`}>
                          <span className="inline-flex gap-1.5">
                            <button className={BTN_SM} onClick={() => setEditing(r)}>
                              Correct
                            </button>
                            <button className={BTN_SM} onClick={() => setHistory(r)}>
                              History
                            </button>
                            <button className={BTN_SM} onClick={() => setPhones(r)}>
                              Phones
                            </button>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {others.length > 0 && (
              <div className={`overflow-x-auto print:break-inside-avoid ${filtered.length > 0 ? "border-t border-[#E3E8E5]" : ""}`}>
                <h3 className="bg-[#F9FAFA] px-5 py-3 text-sm font-semibold text-[#00664E]">Not clocked in on {fullDate(date)}</h3>
                <table className="w-full min-w-[640px] border-collapse text-sm">
                  <thead className={THEAD}>
                    <tr>
                      <th className={TH}>Name</th>
                      <th className={TH}>Status</th>
                      <th className={TH}>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {others.map((p) => (
                      <tr key={`${p.userId}|${p.state}`} className={ROW}>
                        <td className={TD}>
                          <PersonCell name={p.userName || p.userId} />
                        </td>
                        <td className={TD}>
                          <Chip text={STATE_TAG[p.state]?.text || p.state} cls={STATE_TAG[p.state]?.cls || STATE_TAG.away.cls} />
                        </td>
                        <td className={`${TD} capitalize text-[#667085]`}>{p.note || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {absent.length > 0 && (
                  <p className="border-t border-dotted border-[#008060]/50 px-5 py-3 text-xs text-[#667085]">
                    Absent means someone who clocked in during the last 30 days and has no clock record, leave, trip or
                    remote day on this date.
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

/* =====================================================================
   Report (administrator): the printed staff attendance sheet, Monday to Friday
   ID | Name | Mon..Fri | Total A / P / L, one week at a time. Built from getDay(), one call per day.
   Only people with attendance in the week are listed. Remote and away-on-duty days count as Present, leave counts as L.
   ===================================================================== */

const SHEET_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const GREEN = "#008060";
const GREEN_DARK = "#00664E";
const SHEET_CODE = { leave: "L", away: "P", remote: "P", absent: "A" };
const SHEET_CODE_STYLE = {
  P: { color: GREEN_DARK, fontWeight: 600 },
  A: { color: "#B42318", fontWeight: 700 },
  L: { color: "#B54708", fontWeight: 700 },
};
const SHEET_TOTALS = ["A", "P", "L"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const YEAR_MIN = 2026;
const YEAR_MAX = 2060;
const weekStartOf = (k) => addDays(k, -((weekday(k) + 6) % 7)); // Monday

const SHEET_CSS = `
.ws-table { width: 100%; border-collapse: collapse; font-size: 14px; font-variant-numeric: tabular-nums; }
.ws-table th, .ws-table td { padding: 9px 8px; text-align: center; }
.ws-table thead th { background: ${GREEN}; color: #fff; font-weight: 600; letter-spacing: .02em; border-left: 1px solid rgba(255,255,255,.28); }
.ws-table thead th:first-child { border-left: 0; }
.ws-table thead th.ws-sep { border-left: 2px solid #fff; }
.ws-table tbody td { border-bottom: 1px dotted ${GREEN}; border-left: 1px dotted rgba(0,128,96,.55); }
.ws-table tbody tr:nth-child(even) td { background: #F7FAF9; }
.ws-table tbody td:first-child, .ws-table tbody td.ws-name { border-left: 0; }
.ws-table tbody td.ws-id { color: #667085; width: 44px; }
.ws-table tbody td.ws-name { text-align: left; font-weight: 500; padding-left: 12px; }
.ws-table tbody td.ws-sep { border-left: 2px solid ${GREEN}; }
.ws-table tbody td.ws-none { color: #C0C8C4; }
.ws-table tfoot td { background: #EEF7F3; border-top: 2px solid ${GREEN}; font-weight: 700; color: #0B2B24; }
.ws-table tfoot td.ws-sep { border-left: 2px solid ${GREEN}; }
.ws-table tfoot td.ws-name { text-align: left; padding-left: 12px; }
.ws-month { font-size: 12px; }
.ws-month th, .ws-month td { padding: 7px 3px; }
.ws-month tbody td.ws-name, .ws-month tfoot td.ws-name { white-space: nowrap; min-width: 150px; }
@media print {
  @page { size: A4 portrait; margin: 8mm; }
  #attendance-print .ws-table { font-size: 12px; }
  #attendance-print .ws-month { font-size: 10px; }
  #attendance-print .ws-table th, #attendance-print .ws-table td { padding: 5px 5px; }
}
`;

function AttendanceReport() {
  const [mode, setMode] = useState("week"); // "week" or "month"
  const [anchor, setAnchor] = useState(todayKey());
  const [month, setMonth] = useState(todayKey().slice(0, 7));
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  const isMonth = mode === "month";
  const start = weekStartOf(anchor);
  // Week: Monday to Friday. Month: every weekday of the month.
  const dates = useMemo(() => {
    if (!isMonth) return SHEET_DAYS.map((_, i) => addDays(start, i));
    const out = [];
    for (let k = `${month}-01`; k <= monthEnd(month); k = addDays(k, 1)) {
      const w = weekday(k);
      if (w >= 1 && w <= 5) out.push(k);
    }
    return out;
  }, [isMonth, start, month]);
  const dayName = (d) => SHEET_DAYS[weekday(d) - 1];
  const lastDate = dates[dates.length - 1];
  const periodText = isMonth
    ? noon(`${month}-01`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })
    : `${fullDate(start)} to ${fullDate(lastDate)}`;
  const shiftMonth = (n) => {
    const [y, m] = month.split("-").map(Number);
    setMonth(new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7));
  };

  useEffect(() => {
    let on = true;
    const today = todayKey();
    setData(null);
    setError("");
    Promise.all(dates.map((d) => (d <= today ? getDay(d) : Promise.resolve(null))))
      .then((days) => {
        if (!on) return;
        const people = new Map();
        const touch = (p) => {
          if (!people.has(p.userId)) people.set(p.userId, { userId: p.userId, name: p.userName || p.userId, cells: {} });
          return people.get(p.userId);
        };
        days.forEach((r, i) => {
          if (!r) return;
          const d = dates[i];
          (r.absent || []).forEach((p) => (touch(p).cells[d] = "A"));
          (r.off || []).forEach((p) => (touch(p).cells[d] = SHEET_CODE[p.state] || "P"));
          (r.records || []).forEach((p) => (touch(p).cells[d] = "P")); // a clock record always wins
        });
        const list = [...people.values()].sort((a, b) => a.name.localeCompare(b.name));
        list.forEach((p) => {
          p.t = { A: 0, P: 0, L: 0 };
          Object.values(p.cells).forEach((c) => (p.t[c] += 1));
        });
        setData(list);
      })
      .catch((e) => on && setError(e.message));
    return () => {
      on = false;
    };
  }, [dates]);

  const rows = data || [];
  const grand = rows.reduce(
    (g, p) => ({ A: g.A + p.t.A, P: g.P + p.t.P, L: g.L + p.t.L }),
    { A: 0, P: 0, L: 0 }
  );
  const perDay = dates.map((d) => rows.filter((p) => p.cells[d] === "P").length);

  function onCsv() {
    downloadCsv(
      ["ID", "Name", ...dates.map((d) => `${dayName(d)} ${d}`), "Absent", "Present", "Leave"],
      rows.map((p, i) => [i + 1, p.name, ...dates.map((d) => p.cells[d] || ""), p.t.A, p.t.P, p.t.L]),
      isMonth ? `attendance-report-${month}` : `attendance-report-${start}`
    );
  }

  const headBlock = { background: GREEN, color: "#fff" };

  return (
    <>
      <style>{SHEET_CSS}</style>
      {isMonth && <style>{"@media print { @page { size: A4 landscape; margin: 8mm; } }"}</style>}

      <div className={TOOLBAR}>
        <select className={INPUT} value={mode} onChange={(e) => setMode(e.target.value)} aria-label="Report period">
          <option value="week">Weekly report</option>
          <option value="month">Monthly report</option>
        </select>
        {isMonth ? (
          <>
            <button className={BTN} onClick={() => shiftMonth(-1)} disabled={month <= `${YEAR_MIN}-01`}>
              Previous
            </button>
            <select
              className={INPUT}
              value={month.slice(5)}
              onChange={(e) => setMonth(`${month.slice(0, 4)}-${e.target.value}`)}
              aria-label="Month"
            >
              {MONTH_NAMES.map((name, i) => (
                <option key={name} value={String(i + 1).padStart(2, "0")}>
                  {name}
                </option>
              ))}
            </select>
            <select
              className={INPUT}
              value={month.slice(0, 4)}
              onChange={(e) => setMonth(`${e.target.value}-${month.slice(5)}`)}
              aria-label="Year"
            >
              {Array.from({ length: YEAR_MAX - YEAR_MIN + 1 }, (_, i) => YEAR_MIN + i).map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <button className={BTN} onClick={() => shiftMonth(1)} disabled={month >= `${YEAR_MAX}-12`}>
              Next
            </button>
          </>
        ) : (
          <>
            <button className={BTN} onClick={() => setAnchor(addDays(start, -7))}>
              Previous week
            </button>
            <input
              type="date"
              className={INPUT}
              value={anchor}
              max={todayKey()}
              onChange={(e) => e.target.value && setAnchor(e.target.value)}
              aria-label="Pick any date in the week"
            />
            <button className={BTN} onClick={() => setAnchor(addDays(start, 7))} disabled={addDays(start, 7) > todayKey()}>
              Next week
            </button>
          </>
        )}
        <span className="flex-1" />
        <ExportButtons onCsv={onCsv} disabled={!rows.length} />
      </div>

      <ErrorBanner error={error} />

      <div id="attendance-print" className={`mb-6 overflow-x-auto ${SURFACE}`}>
        <div style={{ minWidth: isMonth ? 1000 : 620 }}>
          {/* Title bar */}
          <div style={{ ...headBlock, textAlign: "center", padding: "18px 0 16px" }}>
            <p style={{ fontFamily: BRAND_FONT, fontSize: 32, fontWeight: 600, lineHeight: 1.1 }}>Staff Attendance Sheet</p>
            <p style={{ marginTop: 4, fontSize: 11, letterSpacing: 3, textTransform: "uppercase", opacity: 0.85 }}>{isMonth ? "Monthly report, working days" : "Weekly report, Monday to Friday"}</p>
          </div>

          {/* Company and week */}
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 20, padding: "20px 28px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              {LOGO_SRC && <img src={LOGO_SRC} alt={COMPANY} style={{ height: 60, width: "auto", objectFit: "contain" }} />}
              <div>
                <p style={{ color: GREEN_DARK, fontSize: 24, fontFamily: BRAND_FONT, fontWeight: 600, lineHeight: 1.1 }}>{COMPANY}</p>
                <p style={{ marginTop: 3, fontSize: 12, color: "#667085" }}>Times and dates in Nairobi time</p>
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <p style={{ fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: GREEN, fontWeight: 700 }}>{isMonth ? "Month of" : "Week of"}</p>
              <p style={{ marginTop: 2, fontSize: 16, fontWeight: 600, color: "#0B2B24" }}>
                {periodText}
              </p>
              <div style={{ marginTop: 8, display: "flex", justifyContent: "flex-end", gap: 14, fontSize: 12, color: "#475467" }}>
                {[
                  ["A", "Absent"],
                  ["P", "Present"],
                  ["L", "Leave"],
                ].map(([c, t]) => (
                  <span key={c} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <span style={{ ...headBlock, width: 20, height: 20, borderRadius: 4, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 600 }}>
                      {c}
                    </span>
                    {t}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {!data && !error ? (
            <p style={{ padding: "48px 0", textAlign: "center", color: "#667085", fontSize: 14 }}>Loading...</p>
          ) : rows.length === 0 ? (
            <Empty icon={Users} title={`No attendance this ${isMonth ? "month" : "week"}`} hint={`Pick another ${isMonth ? "month" : "week"} to see who was in.`} />
          ) : (
            <table className={`ws-table ${isMonth ? "ws-month" : ""}`}>
              <thead>
                <tr>
                  <th rowSpan={2} style={{ width: 48 }}>ID</th>
                  <th rowSpan={2} style={{ textAlign: "left", paddingLeft: 12 }}>Name</th>
                  {dates.map((d, i) => (
                    <th key={d} rowSpan={2} className={i === 0 ? "ws-sep" : ""} style={isMonth ? undefined : { width: 64 }}>
                      {isMonth ? d.slice(8) : dayName(d)}
                      <div style={{ fontSize: 10, fontWeight: 400, opacity: 0.85 }}>
                        {isMonth ? dayName(d).slice(0, 2) : `${d.slice(8)}/${d.slice(5, 7)}`}
                      </div>
                    </th>
                  ))}
                  <th colSpan={3} className="ws-sep" style={{ borderBottom: "1px solid rgba(255,255,255,.45)" }}>
                    Total
                  </th>
                </tr>
                <tr>
                  {SHEET_TOTALS.map((t, i) => (
                    <th key={t} className={i === 0 ? "ws-sep" : ""} style={{ width: 44 }}>
                      {t}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((p, i) => (
                  <tr key={p.userId}>
                    <td className="ws-id">{i + 1}</td>
                    <td className="ws-name">{p.name}</td>
                    {dates.map((d, j) => {
                      const c = p.cells[d];
                      const holiday = holidayName(d);
                      return (
                        <td
                          key={d}
                          className={`${j === 0 ? "ws-sep" : ""} ${c ? "" : "ws-none"}`}
                          style={c ? SHEET_CODE_STYLE[c] : undefined}
                          title={!c && holiday ? holiday : undefined}
                        >
                          {c || (holiday ? "H" : "–")}
                        </td>
                      );
                    })}
                    {SHEET_TOTALS.map((t, k) => (
                      <td key={t} className={k === 0 ? "ws-sep" : ""} style={{ fontWeight: p.t[t] ? 600 : 400, color: p.t[t] ? undefined : "#C0C8C4" }}>
                        {p.t[t]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td />
                  <td className="ws-name">Total present ({plural(rows.length, "person")})</td>
                  {perDay.map((n, j) => (
                    <td key={j} className={j === 0 ? "ws-sep" : ""}>
                      {dates[j] <= todayKey() ? n : "–"}
                    </td>
                  ))}
                  {SHEET_TOTALS.map((t, k) => (
                    <td key={t} className={k === 0 ? "ws-sep" : ""}>
                      {grand[t]}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          )}

          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8, padding: "12px 20px", fontSize: 11, color: "#667085", borderTop: "1px solid #E3E8E5" }}>
            <span>A: working day with no clock record, leave, trip or remote day. P: includes remote and away on duty. L: approved leave. H: public holiday. A dash means no record yet.</span>
            <span>Printed {fullDate(todayKey())}</span>
          </div>
        </div>
      </div>
    </>
  );
}

/* =====================================================================
   Settings (administrator): clocking rules, working hours, public holidays
   ===================================================================== */

function ClockingSettings() {
  const [form, setForm] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const toForm = (c) => ({
    phoneClocking: !!c.phoneClocking,
    requirePasskey: !!c.requirePasskey,
    requireQr: !!c.requireQr,
    ips: (c.allowedIps || []).join("\n"),
    workStart: c.workStart,
    workEnd: c.workEnd,
    graceMinutes: String(c.graceMinutes),
  });

  useEffect(() => {
    let on = true;
    getConfig()
      .then((c) => on && setForm(toForm(c)))
      .catch((e) => on && setMsg({ ok: false, text: e.message }));
    return () => {
      on = false;
    };
  }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const flag = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  async function onSave(e) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const saved = await saveConfig({
        phoneClocking: form.phoneClocking,
        requirePasskey: form.requirePasskey,
        requireQr: form.requireQr,
        allowedIps: form.ips.split(/[\s,]+/).filter(Boolean),
        workStart: form.workStart,
        workEnd: form.workEnd,
        graceMinutes: Number(form.graceMinutes),
      });
      setForm(toForm(saved));
      setMsg({ ok: true, text: "Settings saved." });
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title="Clocking settings"
      description="Staff can clock in from a phone or laptop only when this is switched on and they are connected to the office network. Otherwise they use the office scanner."
    >
      <Banner msg={msg} />
      {!form ? (
        !msg && <p className="text-sm text-[#667085]">Loading...</p>
      ) : (
        <form onSubmit={onSave}>
          <div className="divide-y divide-dotted divide-[#008060]/40 border-y border-dotted border-[#008060]/50">
            <Toggle
              checked={form.phoneClocking}
              onChange={flag("phoneClocking")}
              label="Allow clocking in from phones and laptops"
              hint="When off, staff can only clock in at the office scanner."
            />
            <Toggle
              checked={form.requirePasskey}
              onChange={flag("requirePasskey")}
              label="Require fingerprint, face or PIN on a registered phone"
              hint="Stops one person clocking in for another."
            />
            <Toggle
              checked={form.requireQr}
              onChange={flag("requireQr")}
              label="Require scanning the printed QR code"
              hint="Staff must scan the poster at the office before the Clock in button works."
            />
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <Field label="Office network addresses (one per line)">
              <textarea
                className={`${INPUT} mt-1.5 block h-auto w-full py-2 font-mono`}
                rows={4}
                value={form.ips}
                onChange={set("ips")}
                placeholder={"41.80.10.25\n41.80.10.0/24"}
              />
              <span className="mt-1.5 block font-normal leading-relaxed text-[#667085]">
                Use the office&apos;s public IP address (open a &quot;what is my IP&quot; page while on the office
                Wi-Fi), or a range such as 41.80.10.0/24. If the office also has an IPv6 address, add it too.
              </span>
            </Field>
            <div className="flex flex-wrap content-start gap-4">
              <Field label="Work starts">
                <input type="time" className={`${INPUT} mt-1.5 block`} value={form.workStart} onChange={set("workStart")} />
              </Field>
              <Field label="Work ends">
                <input type="time" className={`${INPUT} mt-1.5 block`} value={form.workEnd} onChange={set("workEnd")} />
              </Field>
              <Field label="Grace period (minutes)">
                <input
                  type="number"
                  min="0"
                  max="120"
                  className={`${INPUT} mt-1.5 block w-32`}
                  value={form.graceMinutes}
                  onChange={set("graceMinutes")}
                />
              </Field>
            </div>
          </div>

          <div className="mt-6 flex justify-end border-t border-dotted border-[#008060]/50 pt-4">
            <button className={BTN_PRIMARY} disabled={busy}>
              {busy ? "Saving..." : "Save settings"}
            </button>
          </div>
        </form>
      )}
    </Panel>
  );
}

function HolidaySettings() {
  const thisYear = Number(todayKey().slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const [items, setItems] = useState(null);
  const [form, setForm] = useState({ date: "", name: "" });
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      listHolidays(year)
        .then(setItems)
        .catch((e) => setMsg({ ok: false, text: e.message })),
    [year]
  );
  useEffect(() => {
    setItems(null);
    load();
  }, [load]);

  async function onAdd(e) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await addHoliday({ date: form.date, name: form.name.trim() });
      setForm({ date: "", name: "" });
      await load();
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function onRemove(h) {
    if (!window.confirm(`Remove ${h.name} (${fullDate(h.date)})?`)) return;
    try {
      await deleteHoliday(h.date);
      await load();
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    }
  }

  return (
    <Panel
      title="Public holidays"
      description="Holidays are not counted as absences in attendance records."
      actions={
        <select className={INPUT} value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year">
          {[thisYear - 1, thisYear, thisYear + 1].map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      }
    >
      <Banner msg={msg} />
      <form className="flex flex-wrap items-end gap-3 rounded-lg bg-[#F6F8F7] p-4" onSubmit={onAdd}>
        <Field label="Date">
          <input
            type="date"
            className={`${INPUT} mt-1.5 block`}
            value={form.date}
            onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
            required
          />
        </Field>
        <Field label="Name">
          <input
            className={`${INPUT} mt-1.5 block w-64`}
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            maxLength={120}
            required
          />
        </Field>
        <button className={BTN_PRIMARY} disabled={busy}>
          <Plus size={16} /> Add holiday
        </button>
      </form>

      {!items ? (
        <p className="mt-4 text-sm text-[#667085]">Loading...</p>
      ) : items.length === 0 ? (
        <p className="mt-4 text-sm text-[#667085]">No holidays added for {year}.</p>
      ) : (
        <ul className="mt-3 divide-y divide-dotted divide-[#008060]/40">
          {items.map((h) => (
            <li key={h.date} className="flex items-center gap-3 py-2.5 text-sm">
              <span className="w-32 shrink-0 tabular-nums text-[#667085]">{fullDate(h.date)}</span>
              <span className="flex-1 font-medium">{h.name}</span>
              <button
                className={`rounded-full p-2 text-[#667085] transition hover:bg-[#FEF3F2] hover:text-[#B42318] motion-reduce:transition-none ${FOCUS}`}
                aria-label={`Remove ${h.name}`}
                onClick={() => onRemove(h)}
              >
                <Trash2 size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function SettingsPanel() {
  return (
    <>
      <ClockingSettings />
      <HolidaySettings />
      <ResetProject />
    </>
  );
}

/* =====================================================================
   Scanner import (administrator): manual fallback
   ===================================================================== */

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

function ImportFile() {
  const [rows, setRows] = useState([]);
  const [hasHeader, setHasHeader] = useState(true);
  const [idCol, setIdCol] = useState(0);
  const [nameCol, setNameCol] = useState(-1); // -1 = no name column
  const [timeCol, setTimeCol] = useState(1);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const table = parseTable(await file.text());
    setRows(table);
    setMsg(null);
    setNameCol(-1);
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
    .map((r) => {
      const userName = nameCol >= 0 ? (r[nameCol] || "").trim() : "";
      return {
        userId: (r[idCol] || "").trim(),
        ...(userName ? { userName } : {}),
        timestamp: parseWhen(r[timeCol] || ""),
      };
    })
    .filter((p) => p.userId && p.timestamp);
  const skipped = body.length - punches.length;

  async function onImport() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await importPunches(punches);
      setMsg({ ok: true, text: `Done. ${r.records} daily records were saved or updated.` });
      setRows([]);
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  const options = (extra) => (
    <>
      {extra}
      {labels.map((l, i) => (
        <option key={i} value={i}>
          {l}
        </option>
      ))}
    </>
  );

  return (
    <Panel
      title="Import from a scanner file"
      description="Punches normally arrive from the scanner by themselves. Use this only as a backup, for example to load a USB export after the scanner was offline for days. Times are read as Nairobi time. For each person and day, the earliest punch becomes the clock in and the latest becomes the clock out. Re-uploading a file is safe. The ID column must hold each person's portal user ID, otherwise their punches won't appear in their own attendance."
    >
      <Banner msg={msg} />
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-[#B8C2BD] bg-[#FAFBFA] p-4">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#E3F3EC] text-[#00664E]">
          <Upload size={18} />
        </span>
        <input
          type="file"
          accept=".csv,.txt,.dat,.tsv"
          onChange={onFile}
          className={`text-sm text-[#475467] file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-[#008060] file:px-3.5 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-[#00664E] ${FOCUS}`}
          aria-label="Scanner export file"
        />
        <span className="text-xs text-[#667085]">CSV, TSV, TXT or DAT</span>
      </div>

      {rows.length > 0 && (
        <div className="mt-5">
          <div className="flex flex-wrap items-end gap-4 text-sm">
            <label className="flex h-9 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={hasHeader}
                onChange={(e) => setHasHeader(e.target.checked)}
                className="h-4 w-4 accent-[#008060]"
              />
              First row is headings
            </label>
            <Field label="User ID">
              <select className={`${INPUT} mt-1.5 block`} value={idCol} onChange={(e) => setIdCol(Number(e.target.value))}>
                {options()}
              </select>
            </Field>
            <Field label="Name">
              <select className={`${INPUT} mt-1.5 block`} value={nameCol} onChange={(e) => setNameCol(Number(e.target.value))}>
                {options(<option value={-1}>None</option>)}
              </select>
            </Field>
            <Field label="Date and time">
              <select className={`${INPUT} mt-1.5 block`} value={timeCol} onChange={(e) => setTimeCol(Number(e.target.value))}>
                {options()}
              </select>
            </Field>
          </div>

          <div className="mt-4 overflow-x-auto rounded-lg border border-[#E3E8E5]">
            <table className="w-full text-sm">
              <thead className={THEAD}>
                <tr>
                  <th className={TH}>User ID</th>
                  <th className={TH}>Date and time</th>
                  <th className={TH}>Check</th>
                </tr>
              </thead>
              <tbody>
                {body.slice(0, 5).map((r, i) => {
                  const ok = !!parseWhen(r[timeCol] || "");
                  return (
                    <tr key={i} className={ROW}>
                      <td className="px-4 py-2 tabular-nums">{r[idCol]}</td>
                      <td className="px-4 py-2 tabular-nums">{r[timeCol]}</td>
                      <td className="px-4 py-2">
                        <Chip
                          text={ok ? "OK" : "Can't read this time"}
                          cls={ok ? "bg-[#E3F3EC] text-[#00664E]" : "bg-[#FDECEA] text-[#8A1C14]"}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-dotted border-[#008060]/50 pt-4">
            <p className="text-sm text-[#475467]">
              <span className="font-semibold text-[#0B2B24]">{punches.length}</span> punches ready
              {skipped > 0 ? `, ${skipped} rows can't be read and will be skipped` : ""}.
            </p>
            <button className={BTN_PRIMARY} onClick={onImport} disabled={busy || !punches.length}>
              {busy ? "Importing..." : `Import ${punches.length} punches`}
            </button>
          </div>
        </div>
      )}
    </Panel>
  );
}

/* =====================================================================
   Leave: requests, approvals, who is away
   ===================================================================== */

const LEAVE_TYPES = ["Annual", "Sick", "Maternity", "Paternity", "Compassionate", "Study", "Unpaid", "Other"];

const LEAVE_STATUS_TAG = {
  pending: { text: "Waiting for approval", cls: "bg-[#FFF4E5] text-[#8A4B00]" },
  approved: { text: "Approved", cls: "bg-[#E3F3EC] text-[#00664E]" },
  rejected: { text: "Not approved", cls: "bg-[#FDECEA] text-[#8A1C14]" },
  cancelled: { text: "Cancelled", cls: "bg-[#F1F3F2] text-[#667085]" },
};

function LeaveRequestForm({ onSent }) {
  const [form, setForm] = useState({ type: "Annual", from: "", to: "", reason: "" });
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  // Picking a start date also moves the end date if it would be before it
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
    <Panel
      title="Request leave"
      description="An administrator or the CEO will approve or decline it. Weekends and public holidays are not counted."
    >
      <Banner msg={msg} />
      <form className="flex flex-wrap items-end gap-3" onSubmit={onSubmit}>
        <Field label="Type">
          <select className={`${INPUT} mt-1.5 block`} value={form.type} onChange={set("type")}>
            {LEAVE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
        <Field label="From">
          <input type="date" className={`${INPUT} mt-1.5 block`} value={form.from} onChange={set("from")} required />
        </Field>
        <Field label="To">
          <input type="date" className={`${INPUT} mt-1.5 block`} value={form.to} onChange={set("to")} required />
        </Field>
        <Field label="Reason (optional)" className="min-w-[200px] flex-1">
          <input className={`${INPUT} mt-1.5 block w-full`} value={form.reason} onChange={set("reason")} maxLength={300} />
        </Field>
        <button className={BTN_PRIMARY} disabled={busy || backwards || !form.from || !form.to}>
          {busy ? "Sending..." : "Send request"}
        </button>
      </form>
      {backwards && <p className="mt-3 text-sm text-[#8A1C14]">The end date is before the start date.</p>}
      {!backwards && form.from && form.to && (
        <p className="mt-3 inline-flex items-center gap-2 rounded-lg bg-[#F6F8F7] px-3 py-2 text-sm text-[#475467]">
          <CalendarDays size={15} />
          {dateRange(form.from, form.to)}:{" "}
          <span className="font-semibold text-[#0B2B24]">{plural(days, "working day")}</span>
        </p>
      )}
    </Panel>
  );
}

function MyLeaveRequests({ tick, onChange }) {
  const [items, setItems] = useState(null);
  const [msg, setMsg] = useState(null);
  const today = todayKey();

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
    <Panel title="My leave requests" flush>
      {msg && (
        <div className="p-5 pb-0">
          <Banner msg={msg} />
        </div>
      )}
      {!items ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty title="No leave requests yet" hint="When you ask for leave, it shows up here with its decision." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead className={THEAD}>
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
                const tag = LEAVE_STATUS_TAG[r.status] || LEAVE_STATUS_TAG.pending;
                return (
                  <tr key={r.id} className={ROW}>
                    <td className={`${TD} font-medium`}>{r.type}</td>
                    <td className={`${TD} whitespace-nowrap`}>{dateRange(r.from, r.to)}</td>
                    <td className={`${TD} tabular-nums`}>{r.days ?? workingDays(r.from, r.to)}</td>
                    <td className={TD}>
                      <Chip {...tag} />
                      {r.decidedBy && r.status !== "pending" && (
                        <span className="mt-1 block text-xs text-[#667085]">by {r.decidedBy}</span>
                      )}
                    </td>
                    <td className={`${TD} text-[#667085]`}>{r.decisionNote || "-"}</td>
                    <td className={`${TD} text-right`}>
                      {canCancel(r) && (
                        <button className={BTN_SM} onClick={() => onCancel(r)}>
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
    </Panel>
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
      setMsg({ ok: true, text: `${r.name}'s leave ${decision === "approved" ? "approved" : "not approved"}.` });
      onChange();
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusyId(null);
    }
  }

  const rows = [...(items || [])].sort((a, b) => a.from.localeCompare(b.from));

  return (
    <Panel
      flush
      title={
        <span className="inline-flex items-center gap-2">
          Waiting for your approval
          {rows.length > 0 && <Chip text={String(rows.length)} cls="bg-[#FFF4E5] text-[#8A4B00]" dot={false} />}
        </span>
      }
    >
      {msg && (
        <div className="p-5 pb-0">
          <Banner msg={msg} />
        </div>
      )}
      {!items ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty title="Nothing to approve" hint="New leave requests will appear here." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead className={THEAD}>
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
                <tr key={r.id} className={ROW}>
                  <td className={TD}>
                    <PersonCell name={r.name} />
                  </td>
                  <td className={TD}>{r.type}</td>
                  <td className={`${TD} whitespace-nowrap`}>{dateRange(r.from, r.to)}</td>
                  <td className={`${TD} tabular-nums`}>{r.days ?? workingDays(r.from, r.to)}</td>
                  <td className={`${TD} text-[#667085]`}>{r.reason || "-"}</td>
                  <td className={`${TD} whitespace-nowrap text-right`}>
                    <span className="inline-flex gap-1.5">
                      <button className={BTN_SM_PRIMARY} disabled={busyId === r.id} onClick={() => decide(r, "approved")}>
                        Approve
                      </button>
                      <button className={BTN_SM} disabled={busyId === r.id} onClick={() => decide(r, "rejected")}>
                        Decline
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

// Everyone: approved leave, so people can see who is away
function WhoIsOnLeave({ tick }) {
  const [view, setView] = useState("upcoming");
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const today = todayKey();

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
    <Panel
      flush
      title={
        <span className="inline-flex items-center gap-2">
          Who is on leave
          {view === "upcoming" && onNow > 0 && <Chip text={`${onNow} away now`} cls="bg-[#FFF4E5] text-[#8A4B00]" />}
        </span>
      }
      actions={
        <select className={INPUT} value={view} onChange={(e) => setView(e.target.value)} aria-label="Show leave">
          <option value="upcoming">Now and the next 90 days</option>
          <option value="past">Past 90 days</option>
        </select>
      }
    >
      <ErrorBanner error={error} flush />
      {!items && !error ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty title={view === "past" ? "Nobody was on leave in the past 90 days" : "Nobody is on leave in this period"} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-sm">
            <thead className={THEAD}>
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
                <tr key={`${l.userId}|${l.from}|${i}`} className={ROW}>
                  <td className={TD}>
                    <PersonCell name={l.name} />
                  </td>
                  {showType && <td className={TD}>{l.type || "-"}</td>}
                  <td className={`${TD} whitespace-nowrap`}>{dateRange(l.from, l.to)}</td>
                  <td className={`${TD} tabular-nums`}>{workingDays(l.from, l.to)}</td>
                  <td className={`${TD} text-right`}>
                    <Chip {...stateOf(l)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

// Approved leave for a month or a year, for printing. Everyone can see who was away; the administrator also sees the type.
function LeaveReport({ tick }) {
  const [period, setPeriod] = useState("month");
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const { from, to } = periodDays(period);

  useEffect(() => {
    let on = true;
    setItems(null);
    setError("");
    listLeave({ scope: "all", from, to })
      .then((r) => on && setItems(r))
      .catch((e) => on && setError(e.message));
    return () => {
      on = false;
    };
  }, [from, to, tick]);

  // Working days that fall inside the chosen period (leave can start before it or end after it)
  const rows = useMemo(
    () =>
      (items || [])
        .map((l) => ({ ...l, inPeriod: workingDays(l.from < from ? from : l.from, l.to > to ? to : l.to) }))
        .filter((l) => l.inPeriod > 0)
        .sort((a, b) => a.from.localeCompare(b.from) || a.name.localeCompare(b.name)),
    [items, from, to]
  );
  const perPerson = useMemo(() => {
    const m = new Map();
    for (const r of rows) {
      const p = m.get(r.userId) || { userId: r.userId, name: r.name, days: 0, spells: 0 };
      p.days += r.inPeriod;
      p.spells += 1;
      m.set(r.userId, p);
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);
  const totalDays = rows.reduce((s, r) => s + r.inPeriod, 0);
  const showType = rows.some((l) => l.type);
  const periodText = dateRange(from, to);

  function onCsv() {
    downloadCsv(
      ["Name", "Type", "From", "To", "Working days in period"],
      rows.map((r) => [r.name, r.type || "", r.from, r.to, r.inPeriod]),
      `leave-report-${from}-to-${to}`
    );
  }

  return (
    <section id="attendance-print" className={`mb-6 overflow-hidden ${SURFACE}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E3E8E5] border-t-4 border-t-[#008060] px-5 py-4 print:hidden">
        <div>
          <h3 className="text-base font-semibold text-[#00664E]">Leave report</h3>
          <p className="mt-0.5 text-sm text-[#667085]">Approved leave in a month or a year. Weekends and public holidays are not counted.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PeriodSelect value={period} onChange={setPeriod} options={PERIOD_OPTIONS} label="Period" future />
          <ExportButtons onCsv={onCsv} disabled={!rows.length} />
        </div>
      </div>
      <PrintHeader title="Leave report" subtitle="Approved leave" period={periodText} />
      <ErrorBanner error={error} flush />
      {!items && !error ? (
        <Loading />
      ) : items && rows.length === 0 ? (
        <Empty title="No leave in this period" hint="Pick another month or year." />
      ) : items ? (
        <>
          <div className={SUMMARY_BAR}>
            <span className="font-semibold text-[#0B2B24]">{periodText}</span>
            <span>{plural(perPerson.length, "person")}</span>
            <span>{plural(totalDays, "leave day")}</span>
          </div>

          <h4 className="px-5 pb-2 pt-4 text-sm font-semibold text-[#00664E]">Days per person</h4>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] border-collapse text-sm">
              <thead className={THEAD}>
                <tr>
                  <th className={TH}>Name</th>
                  <th className={NUM_HEAD}>Periods of leave</th>
                  <th className={NUM_HEAD}>Working days</th>
                </tr>
              </thead>
              <tbody>
                {perPerson.map((p) => (
                  <tr key={p.userId} className={ROW}>
                    <td className={`${TD} font-medium`}>{p.name}</td>
                    <td className={NUM}>{p.spells}</td>
                    <td className={`${NUM} font-medium`}>{p.days}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h4 className="px-5 pb-2 pt-5 text-sm font-semibold text-[#00664E]">All leave in the period</h4>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-sm">
              <thead className={THEAD}>
                <tr>
                  <th className={TH}>Name</th>
                  {showType && <th className={TH}>Type</th>}
                  <th className={TH}>Dates</th>
                  <th className={NUM_HEAD}>Days in period</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l, i) => (
                  <tr key={`${l.userId}|${l.from}|${i}`} className={ROW}>
                    <td className={`${TD} font-medium`}>{l.name}</td>
                    {showType && <td className={TD}>{l.type || "-"}</td>}
                    <td className={`${TD} whitespace-nowrap`}>{dateRange(l.from, l.to)}</td>
                    <td className={NUM}>{l.inPeriod}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </section>
  );
}

// Administrators and the CEO: cancel leave that is under way or still to come. A reason is required and is kept with the request.
function ActiveLeaveAdmin({ tick, onChange }) {
  const [items, setItems] = useState(null);
  const [msg, setMsg] = useState(null);
  const [target, setTarget] = useState(null); // the request being cancelled
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const today = todayKey();

  useEffect(() => {
    let on = true;
    listLeaveRequests({ scope: "all", status: "approved" })
      .then((r) => on && setItems(r))
      .catch((e) => on && setMsg({ ok: false, text: e.message }));
    return () => {
      on = false;
    };
  }, [tick]);

  const rows = (items || []).filter((r) => r.to >= today).sort((a, b) => a.from.localeCompare(b.from) || a.name.localeCompare(b.name));
  const stateOf = (r) =>
    r.from <= today
      ? { text: "On leave now", cls: "bg-[#FFF4E5] text-[#8A4B00]" }
      : { text: "Upcoming", cls: "bg-[#EEF4FF] text-[#2E5AAC]" };

  function begin(r) {
    setTarget(r);
    setReason("");
    setMsg(null);
  }

  async function onConfirm() {
    if (!reason.trim()) {
      setMsg({ ok: false, text: "Give a reason for cancelling this leave." });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await cancelLeave(target.id, { reason: reason.trim() });
      setMsg({ ok: true, text: `${target.name}'s leave was cancelled.` });
      setTarget(null);
      setReason("");
      onChange();
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      flush
      title="Cancel active leave"
      description="Stop approved leave that is under way or still to come. A reason is required, and the person will see it next to the cancelled request."
    >
      {msg && (
        <div className="p-5 pb-0">
          <Banner msg={msg} />
        </div>
      )}
      {!items ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty title="No active leave" hint="Approved leave that is current or upcoming will appear here." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead className={THEAD}>
              <tr>
                <th className={TH}>Name</th>
                <th className={TH}>Type</th>
                <th className={TH}>Dates</th>
                <th className={TH}>Status</th>
                <th className={TH} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={`${ROW} ${target?.id === r.id ? "bg-[#FAFBFA]" : ""}`}>
                  <td className={TD}>
                    <PersonCell name={r.name} />
                  </td>
                  <td className={TD}>{r.type}</td>
                  <td className={`${TD} whitespace-nowrap`}>{dateRange(r.from, r.to)}</td>
                  <td className={TD}>
                    <Chip {...stateOf(r)} />
                  </td>
                  <td className={`${TD} whitespace-nowrap text-right`}>
                    <button className={BTN_SM} onClick={() => begin(r)} disabled={busy}>
                      Cancel leave
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {target && (
        <form
          className="border-t border-[#E3E8E5] bg-[#F9FAFA] p-5"
          onSubmit={(e) => {
            e.preventDefault();
            onConfirm();
          }}
        >
          <p className="text-sm font-medium">
            Cancel {target.name}&apos;s {target.type.toLowerCase()} leave, {dateRange(target.from, target.to)}
          </p>
          <Field label="Reason (required)" className="mt-3">
            <textarea
              className={`${INPUT} mt-1.5 block h-auto w-full py-2`}
              rows={3}
              maxLength={300}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="For example: needed back at work for the audit"
              autoFocus
            />
          </Field>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button className={BTN_PRIMARY} disabled={busy || !reason.trim()}>
              {busy ? "Cancelling..." : "Confirm cancellation"}
            </button>
            <button type="button" className={BTN} onClick={() => setTarget(null)} disabled={busy}>
              Keep leave
            </button>
          </div>
        </form>
      )}
    </Panel>
  );
}

// Leave first, then remote work (RemotePanel brings its own heading and sections)
function LeavePanel({ canApprove }) {
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return (
    <>
      {canApprove && <LeaveApprovals tick={tick} onChange={refresh} />}
      {canApprove && <ActiveLeaveAdmin tick={tick} onChange={refresh} />}
      <LeaveRequestForm onSent={refresh} />
      <MyLeaveRequests tick={tick} onChange={refresh} />
      <WhoIsOnLeave tick={tick} />
      <LeaveReport tick={tick} />
      <RemotePanel canApprove={canApprove} />
    </>
  );
}

/* =====================================================================
   Page
   ===================================================================== */

export default function Attendance() {
  const [tab, setTab] = useState("mine");
  const [access, setAccess] = useState({ isAdmin: false });

  useEffect(() => {
    let mounted = true;
    getAccess()
      .then((r) => mounted && setAccess(r))
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const isAdmin = !!access.isAdmin;
  // Administrators and the CEO approve leave. If getAccess() returns canApproveLeave, that wins.
  const canApprove = access.canApproveLeave ?? isAdmin;

  // Every tab: [key, label, icon, adminOnly, screen]
  const tabs = [
    ["mine", "My attendance", Clock, false, <MyAttendance key="mine" />],
    ["leave", "Leave", CalendarDays, false, <LeavePanel key="leave" canApprove={canApprove} />],
    ["team", "Team", Users, true, <TeamAttendance key="team" />],
    ["reports", "Reports", FileText, true, <AttendanceReport key="reports" />],
    ["settings", "Settings", Settings, true, <SettingsPanel key="settings" />],
    ["qr", "QR poster", QrCode, true, <QrScreen key="qr" />],
    ["scanner", "Scanner import", Upload, true, <ImportFile key="scanner" />],
  ].filter((t) => isAdmin || !t[3]);

  // A tab the person can no longer see (for example after access changes) falls back to the first one
  const current = tabs.find((t) => t[0] === tab) || tabs[0];

  return (
    <div className="min-h-full bg-[#F6F8F7] text-[#0B2B24]">
      <style>{PRINT_CSS}</style>

      {/* Title bar, like the printed staff sheet */}
      <header className="bg-[#008060] px-4 py-5 text-center text-white print:hidden lg:px-8">
        <h2 style={{ fontFamily: BRAND_FONT }} className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Staff Attendance
        </h2>
        <p className="mt-1 text-sm text-white/85">
          {COMPANY}. Clock in from the office network or at the office scanner. Times are in Nairobi time.
        </p>
      </header>

      <div className="p-4 lg:p-8">
        <div className="mx-auto max-w-[1200px]">
          <div className="mb-6 flex overflow-x-auto border-b border-[#D5DBD8]" role="tablist">
            {tabs.map(([key, label, Icon]) => (
              <button
                key={key}
                role="tab"
                aria-selected={current[0] === key}
                onClick={() => setTab(key)}
                className={`-mb-px inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-sm transition-colors motion-reduce:transition-none ${FOCUS} ${
                  current[0] === key
                    ? "border-[#008060] font-semibold text-[#00664E]"
                    : "border-transparent font-medium text-[#667085] hover:border-[#B8C2BD] hover:text-[#0B2B24]"
                }`}
              >
                <Icon size={16} />
                {label}
              </button>
            ))}
          </div>

          {current[4]}
        </div>
      </div>
    </div>
  );
}
