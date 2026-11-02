import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Calendar, dateFnsLocalizer } from "react-big-calendar";
import withDragAndDropModule from "react-big-calendar/lib/addons/dragAndDrop";
import {
  format,
  parse,
  startOfWeek,
  endOfWeek,
  getDay,
  startOfMonth,
  endOfMonth,
  addDays,
  addWeeks,
  addMonths,
  addHours,
  isSameDay,
  isSameMonth,
  isToday,
} from "date-fns";
import { enGB } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
// Structural styles that ship with the library (layout of the grid itself)
import "react-big-calendar/lib/css/react-big-calendar.css";
import "react-big-calendar/lib/addons/dragAndDrop/styles.css";
import {
  listActivities,
  listEvents,
  saveEvent,
  deleteEvent,
} from "./workplanApi";
import { listLeave } from "../../attendance/attendanceApi";
import { listAway } from "../../travel/travelApi";
import { holidayName } from "../../../holidays";
import { AuditTimeline } from "./AuditTrail";

// Vite wraps this CommonJS addon, so unwrap it if needed
const withDragAndDrop = withDragAndDropModule.default || withDragAndDropModule;

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: (d) => startOfWeek(d, { weekStartsOn: 1 }),
  getDay,
  locales: { "en-GB": enGB },
});

const DnDCalendar = withDragAndDrop(Calendar);

const COLORS = {
  Workplan: "#5B3FD0",
  Meeting: "#3B6FE0",
  Training: "#0F9F77",
  Deadline: "#E5484D",
  "Field visit": "#E8870A",
  Leave: "#6B7A93",
  Holiday: "#2E5AAC",
};
// Leave and public holidays are not created by hand: they come from approved leave requests and the holiday list
const TYPES = ["Meeting", "Training", "Deadline", "Field visit"];
const LEGEND = { Workplan: "Workplan activities", Leave: "Staff leave", Holiday: "Public holidays" };
const VIEWS = [
  { key: "day", label: "Day" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "agenda", label: "Agenda" },
];
const D = "yyyy-MM-dd";
const DT = "yyyy-MM-dd'T'HH:mm";

/* ---------- shared Tailwind classes ---------- */

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#5B3FD0]";

const BTN = `inline-flex items-center rounded-lg border border-[#C9CED6] bg-white px-4 py-2 text-sm text-[#0B2B24] transition hover:bg-[#F6F7F8] motion-reduce:transition-none ${FOCUS}`;
const BTN_PRIMARY = `inline-flex items-center rounded-lg border border-[#5B3FD0] bg-[#5B3FD0] px-4 py-2 text-sm text-white transition hover:bg-[#4A31B5] motion-reduce:transition-none ${FOCUS}`;
const BTN_DANGER = `inline-flex items-center rounded-lg px-4 py-2 text-sm text-[#B42318] transition hover:bg-[#FDECEA] motion-reduce:transition-none ${FOCUS}`;
const ICON_BTN = `inline-flex h-8 w-8 items-center justify-center rounded-full text-[#667085] transition hover:bg-[#F1F3F2] hover:text-[#0B2B24] motion-reduce:transition-none ${FOCUS}`;
const CREATE_BTN = `inline-flex items-center gap-2.5 rounded-full bg-white py-3 pl-4 pr-6 text-sm font-medium text-[#0B2B24] shadow-[0_1px_3px_rgba(16,24,40,0.22),0_4px_12px_rgba(16,24,40,0.08)] transition hover:bg-[#F6F4FD] motion-reduce:transition-none ${FOCUS}`;
const INPUT = `rounded-lg border border-[#C9CED6] bg-white px-2.5 py-2 text-sm text-[#0B2B24] ${FOCUS}`;
const ERROR = "rounded-lg bg-[#FDECEA] px-3 py-2 text-sm text-[#8A1C14]";

/*
 * Styles for the calendar grid itself. react-big-calendar draws its own
 * elements (.rbc-*), so these use Tailwind's arbitrary variants on the wrapper.
 * Lines are one light grey, and the all-day strip and header are kept compact.
 */
const CAL_STYLES = [
  // frame
  "[&_.rbc-calendar]:h-full",
  "[&_.rbc-time-view]:overflow-hidden [&_.rbc-time-view]:rounded-2xl [&_.rbc-time-view]:border-[#E6ECE9] [&_.rbc-time-view]:bg-white",
  "[&_.rbc-month-view]:overflow-hidden [&_.rbc-month-view]:rounded-2xl [&_.rbc-month-view]:border-[#E6ECE9] [&_.rbc-month-view]:bg-white",
  "[&_.rbc-agenda-view]:overflow-hidden [&_.rbc-agenda-view]:rounded-2xl [&_.rbc-agenda-view]:border-[#E6ECE9] [&_.rbc-agenda-view]:bg-white [&_.rbc-agenda-view]:text-sm",
  // header row (weekday names)
  "[&_.rbc-header]:border-[#E6ECE9] [&_.rbc-header]:!overflow-visible [&_.rbc-header]:py-1 [&_.rbc-header]:text-xs [&_.rbc-header]:font-medium [&_.rbc-header]:text-[#667085]",
  "[&_.rbc-time-header-content]:border-[#E6ECE9]",
  // all-day strip: only as tall as its content
  "[&_.rbc-allday-cell]:!h-auto [&_.rbc-allday-cell]:!min-h-[28px]",
  "[&_.rbc-time-header-gutter]:border-[#E6ECE9]",
  // hour grid: one light line per hour, none per half hour
  "[&_.rbc-time-content]:border-[#E6ECE9] [&_.rbc-time-content]:[scrollbar-width:thin]",
  "[&_.rbc-timeslot-group]:min-h-[48px] [&_.rbc-timeslot-group]:border-[#E6ECE9]",
  "[&_.rbc-day-slot_.rbc-time-slot]:!border-t-0",
  "[&_.rbc-time-gutter_.rbc-timeslot-group]:border-b-transparent",
  "[&_.rbc-day-bg]:border-[#E6ECE9] [&_.rbc-month-row]:border-[#E6ECE9]",
  "[&_.rbc-label]:px-2 [&_.rbc-label]:text-[11px] [&_.rbc-label]:text-[#667085]",
  // today and off-range days
  "[&_.rbc-today]:!bg-transparent",
  "[&_.rbc-off-range-bg]:bg-[#FAFBFA]",
  "[&_.rbc-off-range_a]:text-[#AAB2BD]",
  // month view day numbers
  "[&_.rbc-date-cell]:px-1.5 [&_.rbc-date-cell]:pt-1 [&_.rbc-date-cell]:text-center [&_.rbc-date-cell]:text-xs",
  "[&_.rbc-date-cell>a]:inline-flex [&_.rbc-date-cell>a]:h-6 [&_.rbc-date-cell>a]:w-6 [&_.rbc-date-cell>a]:items-center [&_.rbc-date-cell>a]:justify-center [&_.rbc-date-cell>a]:rounded-full",
  "[&_.rbc-date-cell.rbc-now>a]:bg-[#5B3FD0] [&_.rbc-date-cell.rbc-now>a]:font-semibold [&_.rbc-date-cell.rbc-now>a]:text-white",
  // events
  "[&_.rbc-event]:rounded-md [&_.rbc-event]:border-0 [&_.rbc-event]:px-1.5 [&_.rbc-event]:py-0.5 [&_.rbc-event]:text-xs [&_.rbc-event]:font-medium [&_.rbc-event]:ring-1 [&_.rbc-event]:ring-white",
  "[&_.rbc-event.rbc-selected]:brightness-90",
  "[&_.rbc-event-label]:text-[11px] [&_.rbc-event-label]:font-normal",
  "[&_.rbc-current-time-indicator]:h-0.5 [&_.rbc-current-time-indicator]:bg-[#E5484D]",
  "[&_.rbc-show-more]:text-xs [&_.rbc-show-more]:font-medium [&_.rbc-show-more]:text-[#5B3FD0]",
].join(" ");

/* ---------- helpers ---------- */

// "2026-11-02" -> that day; "2026-11-02T09:00" -> that time (local)
const parseLocal = (s, endOfDay = false) =>
  s.length === 10
    ? new Date(`${s}T${endOfDay ? "23:59:59" : "00:00:00"}`)
    : new Date(s);

const blankForm = (start, end, allDay) => ({
  title: "",
  type: "Meeting",
  allDay,
  startDate: format(start, D),
  startTime: format(start, "HH:mm"),
  endDate: format(end, D),
  endTime: format(end, "HH:mm"),
  description: "",
});

const toForm = (e) => {
  const allDay = e.allDay ?? e.start.length === 10;
  return {
    id: e.id,
    title: e.title || "",
    type: e.type || "Meeting",
    allDay,
    startDate: e.start.slice(0, 10),
    startTime: allDay ? "09:00" : e.start.slice(11, 16),
    endDate: (e.end || e.start).slice(0, 10),
    endTime: allDay ? "10:00" : (e.end || e.start).slice(11, 16),
    description: e.description || "",
  };
};

function rangeTitle(date, view) {
  if (view === "day") return format(date, "EEEE, d MMMM yyyy");
  if (view === "week") {
    const s = startOfWeek(date, { weekStartsOn: 1 });
    const e = endOfWeek(date, { weekStartsOn: 1 });
    if (isSameMonth(s, e)) return format(s, "MMMM yyyy");
    return s.getFullYear() === e.getFullYear()
      ? `${format(s, "MMM")} – ${format(e, "MMM yyyy")}`
      : `${format(s, "MMM yyyy")} – ${format(e, "MMM yyyy")}`;
  }
  return format(date, "MMMM yyyy");
}

const shift = (date, view, dir) =>
  view === "day"
    ? addDays(date, dir)
    : view === "week"
    ? addWeeks(date, dir)
    : addMonths(date, dir);

const longDate = (key) => format(parseLocal(key), "EEE d MMM yyyy");

// Leave and holidays are loaded for the month on screen plus one month either side
const windowFor = (monthKey) => {
  const base = new Date(`${monthKey}-01T12:00:00`);
  return { from: startOfMonth(addMonths(base, -1)), to: endOfMonth(addMonths(base, 1)) };
};

/* ---------- small pieces ---------- */

function MiniMonth({ date, onPick }) {
  const [cursor, setCursor] = useState(startOfMonth(date));
  useEffect(() => setCursor(startOfMonth(date)), [date]);

  const first = startOfWeek(cursor, { weekStartsOn: 1 });
  const days = Array.from({ length: 42 }, (_, i) => addDays(first, i));

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-sm">
        <strong className="font-medium">{format(cursor, "MMMM yyyy")}</strong>
        <span className="flex">
          <button className={ICON_BTN} aria-label="Previous month" onClick={() => setCursor(addMonths(cursor, -1))}>
            <ChevronLeft size={16} />
          </button>
          <button className={ICON_BTN} aria-label="Next month" onClick={() => setCursor(addMonths(cursor, 1))}>
            <ChevronRight size={16} />
          </button>
        </span>
      </div>

      <div className="grid grid-cols-7 gap-0.5 text-center">
        {["M", "T", "W", "T", "F", "S", "S"].map((l, i) => (
          <span key={i} className="py-1 text-[11px] text-[#667085]">
            {l}
          </span>
        ))}
        {days.map((d) => {
          const today = isToday(d);
          const selected = isSameDay(d, date);
          const state = today
            ? "bg-[#5B3FD0] font-semibold text-white"
            : selected
            ? "bg-[#EDE9FB] font-semibold text-[#5B3FD0]"
            : isSameMonth(d, cursor)
            ? "text-[#0B2B24] hover:bg-[#F1F3F2]"
            : "text-[#AAB2BD] hover:bg-[#F1F3F2]";

          return (
            <button
              key={+d}
              onClick={() => onPick(d)}
              className={`aspect-square rounded-full text-xs ${state} ${FOCUS}`}
            >
              {format(d, "d")}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Week and day column headers: small weekday over a date, today circled.
// Kept compact so the library's fixed header height never clips it.
const DayHeader = ({ date }) => {
  const today = isToday(date);
  return (
    <div className="flex flex-col items-center leading-none">
      <span className={`pb-0.5 text-[11px] ${today ? "text-[#5B3FD0]" : "text-[#667085]"}`}>
        {format(date, "EEE")}
      </span>
      <span
        className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-lg ${
          today ? "bg-[#5B3FD0] text-white" : "text-[#0B2B24]"
        }`}
      >
        {format(date, "d")}
      </span>
    </div>
  );
};

function Modal({ label, onClose, onSubmit, children }) {
  const Wrapper = onSubmit ? "form" : "div";
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/30 p-4"
      onMouseDown={onClose}
    >
      <Wrapper
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={onSubmit}
        className="relative flex w-full max-w-[480px] flex-col gap-3.5 rounded-2xl bg-white px-6 pb-5 pt-10 shadow-[0_12px_40px_rgba(16,24,40,0.25)]"
      >
        <button type="button" className={`${ICON_BTN} absolute right-2.5 top-2.5`} onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        {children}
      </Wrapper>
    </div>
  );
}

function EventModal({ form, setForm, onSave, onDelete, onClose, error }) {
  const [showHistory, setShowHistory] = useState(false);
  const set = (k) => (e) =>
    setForm({ ...form, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  // An older event saved as "Leave" keeps its type, so it still shows as selected
  const types = TYPES.includes(form.type) ? TYPES : [...TYPES, form.type];

  return (
    <Modal label={form.id ? "Edit event" : "New event"} onClose={onClose} onSubmit={onSave}>
      <input
        autoFocus
        placeholder="Add title"
        value={form.title}
        onChange={set("title")}
        className="border-0 border-b-2 border-[#E6ECE9] bg-transparent py-1.5 text-2xl text-[#0B2B24] focus:border-[#5B3FD0] focus:outline-none"
      />

      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Event type">
        {types.map((t) => {
          const on = form.type === t;
          const color = COLORS[t] || COLORS.Meeting;
          return (
            <button
              type="button"
              key={t}
              role="radio"
              aria-checked={on}
              onClick={() => setForm({ ...form, type: t })}
              className={`rounded-full border px-3 py-1 text-xs ${FOCUS}`}
              style={{
                borderColor: color,
                color: on ? "#fff" : color,
                backgroundColor: on ? color : "#fff",
              }}
            >
              {t}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <input type="date" className={INPUT} value={form.startDate} onChange={set("startDate")} aria-label="Start date" />
        {!form.allDay && (
          <input type="time" className={INPUT} value={form.startTime} onChange={set("startTime")} aria-label="Start time" />
        )}
        <span>to</span>
        {!form.allDay && (
          <input type="time" className={INPUT} value={form.endTime} onChange={set("endTime")} aria-label="End time" />
        )}
        <input type="date" className={INPUT} value={form.endDate} onChange={set("endDate")} aria-label="End date" />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.allDay} onChange={set("allDay")} className="h-4 w-4 accent-[#5B3FD0]" />
        All day
      </label>

      <textarea
        rows={3}
        placeholder="Add description"
        value={form.description}
        onChange={set("description")}
        className={`${INPUT} w-full resize-y`}
      />

      {showHistory && form.id && (
        <div className="max-h-64 overflow-y-auto rounded-lg border border-[#E6ECE9] p-3">
          <AuditTimeline entity="events" id={form.id} />
        </div>
      )}

      {error && <p className={ERROR}>{error}</p>}

      <div className="mt-1 flex items-center gap-2">
        {form.id && (
          <button type="button" className={BTN_DANGER} onClick={onDelete}>
            Delete
          </button>
        )}
        {form.id && (
          <button type="button" className={BTN} onClick={() => setShowHistory((v) => !v)}>
            {showHistory ? "Hide history" : "History"}
          </button>
        )}
        <span className="flex-1" />
        <button type="button" className={BTN} onClick={onClose}>
          Cancel
        </button>
        <button className={BTN_PRIMARY}>Save</button>
      </div>
    </Modal>
  );
}

function ActivityModal({ activity, onClose }) {
  return (
    <Modal label="Workplan activity" onClose={onClose}>
      <h3 className="flex items-center gap-2.5 text-xl font-medium">
        <i
          className="h-3.5 w-3.5 shrink-0 rounded"
          style={{ backgroundColor: COLORS.Workplan }}
        />
        {activity.title}
      </h3>
      <div className="space-y-1 text-sm text-[#667085]">
        <p>
          {activity.start} to {activity.end}
        </p>
        {activity.project && <p>Project: {activity.project}</p>}
        {activity.owner && <p>Owner: {activity.owner}</p>}
        <p>
          {activity.status}, {activity.progress}% complete
        </p>
      </div>
      <div className="flex justify-end">
        <Link className={BTN_PRIMARY} to="/me-dashboard/workplan" onClick={onClose}>
          Open in workplan
        </Link>
      </div>
    </Modal>
  );
}

// Read-only details for approved leave and public holidays
function InfoModal({ info, onClose }) {
  return (
    <Modal label={info.title} onClose={onClose}>
      <h3 className="flex items-center gap-2.5 text-xl font-medium">
        <i className="h-3.5 w-3.5 shrink-0 rounded" style={{ backgroundColor: COLORS[info.type] }} />
        {info.title}
      </h3>
      <div className="space-y-1 text-sm text-[#667085]">
        <p>{info.when}</p>
        {info.note && <p>{info.note}</p>}
      </div>
      <div className="flex justify-end">
        <button className={BTN} onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}

/* ---------- page ---------- */

export default function MECalendar() {
  const [activities, setActivities] = useState([]);
  const [events, setEvents] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [trips, setTrips] = useState([]);
  const [date, setDate] = useState(new Date());
  const [view, setView] = useState("week");
  const [hidden, setHidden] = useState(new Set());
  const [form, setForm] = useState(null); // event modal
  const [detail, setDetail] = useState(null); // activity modal
  const [info, setInfo] = useState(null); // leave / holiday modal
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");

  // Start the day grid at 7:30 (kept stable so it only scrolls once)
  const scrollTo = useMemo(() => {
    const d = new Date();
    d.setHours(7, 30, 0, 0);
    return d;
  }, []);

  const load = () =>
    Promise.all([listActivities(), listEvents()])
      .then(([a, e]) => {
        setError("");
        setActivities(a || []);
        setEvents(e || []);
      })
      .catch((err) => setError(err.message));

  useEffect(() => {
    load();
  }, []);

  // Approved leave for the month on screen (and a month either side). If it can't load, the calendar still works.
  const monthKey = format(date, "yyyy-MM");
  useEffect(() => {
    let on = true;
    const { from, to } = windowFor(monthKey);
    listLeave({ scope: "all", from: format(from, D), to: format(to, D) })
      .then((l) => on && setLeaves(l || []))
      .catch(() => on && setLeaves([]));
    // Approved trips and field visits, shown in the Field visit colour
    listAway({ scope: "all", from: format(from, D), to: format(to, D) })
      .then((t) => on && setTrips(t || []))
      .catch(() => on && setTrips([]));
    return () => {
      on = false;
    };
  }, [monthKey]);

  // Public holidays in the same window
  const holidays = useMemo(() => {
    const { from, to } = windowFor(monthKey);
    const out = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const key = format(d, D);
      const name = holidayName(key);
      if (name) out.push({ key, name });
    }
    return out;
  }, [monthKey]);

  useEffect(() => {
    if (!form && !detail && !info) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") {
        setForm(null);
        setDetail(null);
        setInfo(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [form, detail, info]);

  const items = useMemo(
    () => [
      ...activities
        .filter(() => !hidden.has("Workplan"))
        .map((a) => ({
          id: `a-${a.id}`,
          kind: "activity",
          type: "Workplan",
          title: a.title,
          allDay: true,
          start: parseLocal(a.start),
          end: parseLocal(a.end, true),
          raw: a,
        })),
      ...events
        .filter((e) => !hidden.has(e.type))
        .map((e) => {
          const allDay = e.allDay ?? e.start.length === 10;
          return {
            id: e.id,
            kind: "event",
            type: e.type,
            title: e.title,
            allDay,
            start: parseLocal(e.start),
            end: parseLocal(e.end || e.start, allDay),
            raw: e,
          };
        }),
      ...leaves
        .filter(() => !hidden.has("Leave"))
        .map((l, i) => ({
          id: `l-${l.userId}-${l.from}-${i}`,
          kind: "leave",
          type: "Leave",
          title: `${l.name}: ${l.type ? `${l.type} leave` : "On leave"}`,
          allDay: true,
          start: parseLocal(l.from),
          end: parseLocal(l.to, true),
          raw: l,
        })),
      ...trips
        .filter(() => !hidden.has("Field visit"))
        .map((t, i) => ({
          id: `t-${t.userId}-${t.from}-${i}`,
          kind: "travel",
          type: "Field visit",
          title: `${t.name}: ${t.destination || t.type || "Trip"}`,
          allDay: true,
          start: parseLocal(t.from),
          end: parseLocal(t.to, true),
          raw: t,
        })),
      ...holidays
        .filter(() => !hidden.has("Holiday"))
        .map((h) => ({
          id: `h-${h.key}`,
          kind: "holiday",
          type: "Holiday",
          title: h.name,
          allDay: true,
          start: parseLocal(h.key),
          end: parseLocal(h.key, true),
          raw: h,
        })),
    ],
    [activities, events, leaves, trips, holidays, hidden]
  );

  const toggle = (key) => {
    const next = new Set(hidden);
    next.has(key) ? next.delete(key) : next.add(key);
    setHidden(next);
  };

  const openNew = (start, end, allDay) => {
    setFormError("");
    setForm(blankForm(start, end, allDay));
  };

  const onSelectSlot = ({ start, end }) => {
    const midnight = (d) => d.getHours() === 0 && d.getMinutes() === 0;
    const allDay =
      view === "month" || (midnight(start) && midnight(end) && end - start >= 86400000);
    if (allDay) {
      openNew(start, new Date(Math.max(+end - 1, +start)), true);
    } else {
      openNew(start, end - start <= 30 * 60000 ? addHours(start, 1) : end, false);
    }
  };

  const onCreate = () => {
    const start = new Date(date);
    start.setHours(Math.min(new Date().getHours() + 1, 22), 0, 0, 0);
    openNew(start, addHours(start, 1), false);
  };

  const onSelectEvent = (item) => {
    if (item.kind === "activity") return setDetail(item.raw);
    if (item.kind === "leave") {
      const l = item.raw;
      return setInfo({
        type: "Leave",
        title: l.name,
        when: l.from === l.to ? longDate(l.from) : `${longDate(l.from)} to ${longDate(l.to)}`,
        note: l.type ? `${l.type} leave (approved)` : "On approved leave",
      });
    }
    if (item.kind === "travel") {
      const t = item.raw;
      return setInfo({
        type: "Field visit",
        title: t.name,
        when: t.from === t.to ? longDate(t.from) : `${longDate(t.from)} to ${longDate(t.to)}`,
        note: `${t.type || "Travel"}: ${t.destination}`,
      });
    }
    if (item.kind === "holiday") {
      return setInfo({ type: "Holiday", title: item.raw.name, when: longDate(item.raw.key), note: "Public holiday" });
    }
    setFormError("");
    return setForm(toForm(item.raw));
  };

  async function onSave(e) {
    e.preventDefault();
    const startStr = form.allDay ? form.startDate : `${form.startDate}T${form.startTime}`;
    const endStr = form.allDay ? form.endDate : `${form.endDate}T${form.endTime}`;
    if (!form.startDate || !form.endDate || endStr < startStr) {
      setFormError("The end must be after the start.");
      return;
    }
    const payload = {
      ...(form.id ? { id: form.id } : {}),
      title: form.title.trim() || "(No title)",
      type: form.type,
      allDay: form.allDay,
      start: startStr,
      end: endStr,
      description: form.description,
    };
    try {
      await saveEvent(payload);
      setForm(null);
      await load();
    } catch (err) {
      setFormError(err.message);
    }
  }

  async function onDelete() {
    if (!window.confirm("Delete this event?")) return;
    try {
      await deleteEvent(form.id);
      setForm(null);
      await load();
    } catch (err) {
      setFormError(err.message);
    }
  }

  // Drag to move or resize (custom events only; workplan, leave and holidays are fixed)
  async function moveEvent({ event, start, end, isAllDay }) {
    if (event.kind !== "event") return;
    const allDay = isAllDay ?? event.allDay;
    const payload = {
      ...event.raw,
      allDay,
      start: allDay ? format(start, D) : format(start, DT),
      end: allDay
        ? format(new Date(Math.max(+end - 1, +start)), D)
        : format(end, DT),
    };
    setEvents((prev) => prev.map((x) => (x.id === payload.id ? payload : x)));
    try {
      await saveEvent(payload);
    } catch (err) {
      setError(err.message);
      load();
    }
  }

  const formats = {
    weekdayFormat: (d, c, l) => l.format(d, "EEE", c),
    timeGutterFormat: (d, c, l) => l.format(d, "h a", c),
    eventTimeRangeFormat: ({ start, end }, c, l) =>
      `${l.format(start, "h:mm a", c)} – ${l.format(end, "h:mm a", c)}`,
  };

  return (
    <div className="flex h-[calc(100vh-6rem)] min-h-[560px] p-3 text-[#0B2B24] lg:px-5 lg:pb-5 lg:pt-4">
      {/* LEFT PANEL */}
      <aside className="hidden w-60 shrink-0 flex-col gap-6 overflow-y-auto pr-5 lg:flex">
        <button className={`${CREATE_BTN} self-start`} onClick={onCreate}>
          <Plus size={20} /> Create
        </button>

        <MiniMonth date={date} onPick={setDate} />

        <div>
          <p className="mb-2 text-xs font-semibold text-[#667085]">Calendars</p>
          {Object.keys(COLORS).map((key) => (
            <label key={key} className="flex cursor-pointer items-center gap-2.5 py-1 text-sm">
              <input
                type="checkbox"
                checked={!hidden.has(key)}
                onChange={() => toggle(key)}
                className="h-4 w-4"
                style={{ accentColor: COLORS[key] }}
              />
              {LEGEND[key] || key}
            </label>
          ))}
        </div>
      </aside>

      {/* MAIN */}
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button className={`${CREATE_BTN} !py-2 !pl-3 !pr-4 lg:hidden`} onClick={onCreate}>
            <Plus size={18} /> Create
          </button>
          <button className={BTN} onClick={() => setDate(new Date())}>
            Today
          </button>
          <button className={ICON_BTN} aria-label="Previous" onClick={() => setDate(shift(date, view, -1))}>
            <ChevronLeft size={20} />
          </button>
          <button className={ICON_BTN} aria-label="Next" onClick={() => setDate(shift(date, view, 1))}>
            <ChevronRight size={20} />
          </button>
          <h2 className="ml-1 text-lg font-normal lg:text-[22px]">{rangeTitle(date, view)}</h2>
          <span className="flex-1" />
          <select
            className={INPUT}
            value={view}
            onChange={(e) => setView(e.target.value)}
            aria-label="Calendar view"
          >
            {VIEWS.map((v) => (
              <option key={v.key} value={v.key}>
                {v.label}
              </option>
            ))}
          </select>
        </div>

        {error && <p className={`${ERROR} mb-2`}>{error}</p>}

        <div className={`min-h-0 flex-1 ${CAL_STYLES}`}>
          <DnDCalendar
            localizer={localizer}
            culture="en-GB"
            events={items}
            date={date}
            view={view}
            onNavigate={setDate}
            onView={setView}
            views={["month", "week", "day", "agenda"]}
            toolbar={false}
            selectable
            popup
            step={30}
            timeslots={2}
            scrollToTime={scrollTo}
            formats={formats}
            onSelectSlot={onSelectSlot}
            onSelectEvent={onSelectEvent}
            onEventDrop={moveEvent}
            onEventResize={moveEvent}
            resizable
            draggableAccessor={(e) => e.kind === "event"}
            resizableAccessor={(e) => e.kind === "event"}
            components={{ week: { header: DayHeader }, day: { header: DayHeader } }}
            eventPropGetter={(e) => ({
              style: { backgroundColor: COLORS[e.type] || COLORS.Meeting },
            })}
          />
        </div>
      </section>

      {form && (
        <EventModal
          form={form}
          setForm={setForm}
          onSave={onSave}
          onDelete={onDelete}
          onClose={() => setForm(null)}
          error={formError}
        />
      )}
      {detail && <ActivityModal activity={detail} onClose={() => setDetail(null)} />}
      {info && <InfoModal info={info} onClose={() => setInfo(null)} />}
    </div>
  );
}
