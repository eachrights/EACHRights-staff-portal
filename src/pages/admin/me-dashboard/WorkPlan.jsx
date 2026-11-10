import { Fragment, useEffect, useMemo, useState } from "react";
import {
  Plus,
  Search,
  Download,
  Pencil,
  Copy,
  Trash2,
  X,
  ChevronUp,
  ChevronDown,
  AlertTriangle,
} from "lucide-react";
import { listActivities, saveActivity, deleteActivity } from "./workplanApi";
import { AuditTimeline } from "./AuditTrail";

/* ---------- constants ---------- */

const STATUSES = ["Not started", "In progress", "Done", "Delayed"];
const PRIORITIES = ["Low", "Medium", "High"];
const PRIO_RANK = { Low: 0, Medium: 1, High: 2 };
const PRIO_COLOR = { Low: "#98A2B3", Medium: "#E8870A", High: "#E5484D" };

// The three sections AmplifyChange asks for in the workplan template
const CATEGORIES = ["Project activities", "Monitoring and evaluation", "Organisational strengthening"];

const GROUPINGS = [
  ["none", "No grouping"],
  ["project", "Group by project"],
  ["category", "Group by category"],
];

const STATUS = {
  "Not started": { chip: "bg-[#F2F4F7] text-[#475467]", bar: "#98A2B3" },
  "In progress": { chip: "bg-[#E3ECFC] text-[#2552B8]", bar: "#3B6FE0" },
  Done: { chip: "bg-[#DCF3E8] text-[#0B7A57]", bar: "#0F9F77" },
  Delayed: { chip: "bg-[#FDE8D8] text-[#B54708]", bar: "#E8870A" },
};

const EMPTY = {
  title: "",
  category: CATEGORIES[0],
  ref: "",
  project: "",
  owner: "",
  organisation: "",
  priority: "Medium",
  start: "",
  end: "",
  status: "Not started",
  progress: 0,
  risk: "",
  mitigation: "",
  notes: "",
};

const DAY = 86400000;
const AVATAR = ["#5B3FD0", "#3B6FE0", "#0F9F77", "#E8870A", "#E5559A", "#11A3B0"];

/* ---------- shared Tailwind classes (same look as the calendar) ---------- */

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#5B3FD0]";
const BTN = `inline-flex items-center gap-2 rounded-lg border border-[#C9CED6] bg-white px-4 py-2 text-sm text-[#0B2B24] transition hover:bg-[#F6F7F8] motion-reduce:transition-none ${FOCUS}`;
const BTN_PRIMARY = `inline-flex items-center gap-2 rounded-lg border border-[#5B3FD0] bg-[#5B3FD0] px-4 py-2 text-sm text-white transition hover:bg-[#4A31B5] disabled:opacity-60 motion-reduce:transition-none ${FOCUS}`;
const BTN_DANGER = `inline-flex items-center rounded-lg px-4 py-2 text-sm text-[#B42318] transition hover:bg-[#FDECEA] motion-reduce:transition-none ${FOCUS}`;
const ICON_BTN = `inline-flex h-8 w-8 items-center justify-center rounded-full text-[#667085] transition hover:bg-[#F1F3F2] hover:text-[#0B2B24] motion-reduce:transition-none ${FOCUS}`;
const INPUT = `rounded-lg border border-[#C9CED6] bg-white px-2.5 py-2 text-sm text-[#0B2B24] ${FOCUS}`;
const ERROR = "rounded-lg bg-[#FDECEA] px-3 py-2 text-sm text-[#8A1C14]";
const TH = "px-3 py-2.5 text-left text-xs font-medium text-[#667085]";

/* ---------- helpers ---------- */

const toDate = (s) => new Date(`${s}T00:00:00`);
const todayStr = () => new Date().toLocaleDateString("en-CA"); // yyyy-mm-dd, local
const shortDate = (s) =>
  toDate(s).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const isOverdue = (a) => a.status !== "Done" && a.end < todayStr();
const daysLeft = (a) => Math.round((+toDate(a.end) - +toDate(todayStr())) / DAY);
const initials = (name) =>
  name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const avatarColor = (name) =>
  AVATAR[[...name].reduce((s, c) => s + c.charCodeAt(0), 0) % AVATAR.length];

// References sort the way people read them: 1.2 before 1.10, and rows without a reference last
const byRef = (a, b) => {
  if (!a.ref !== !b.ref) return a.ref ? -1 : 1;
  return (
    (a.ref || "").localeCompare(b.ref || "", undefined, { numeric: true }) ||
    a.start.localeCompare(b.start)
  );
};

// Template order: section by section, each section by reference
const gridOrder = (rows) =>
  [...rows].sort(
    (a, b) => CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category) || byRef(a, b)
  );

const SORTERS = {
  ref: byRef,
  title: (a, b) => a.title.localeCompare(b.title),
  owner: (a, b) => (a.owner || "").localeCompare(b.owner || ""),
  priority: (a, b) =>
    PRIO_RANK[a.priority || "Medium"] - PRIO_RANK[b.priority || "Medium"],
  start: (a, b) => a.start.localeCompare(b.start),
  progress: (a, b) => a.progress - b.progress,
  status: (a, b) => STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status),
};

// Keeps status and progress consistent when either one is edited
function applyRules(f, key, value) {
  const next = { ...f, [key]: value };
  if (key === "progress") {
    const p = Math.min(100, Math.max(0, Number(value) || 0));
    next.progress = p;
    if (p === 100) next.status = "Done";
    else if (p > 0 && f.status === "Not started") next.status = "In progress";
    else if (p < 100 && f.status === "Done") next.status = "In progress";
  }
  if (key === "status" && value === "Done") next.progress = 100;
  return next;
}

/* ---------- reporting periods (grid columns) ---------- */

// Calendar periods of `size` months (6 = half-years, 3 = quarters) that cover every activity.
// `to` is exclusive.
function buildPeriods(items, size) {
  if (!items.length) return [];
  const min = new Date(Math.min(...items.map((r) => +toDate(r.start))));
  const max = new Date(Math.max(...items.map((r) => +toDate(r.end))));
  const out = [];
  let y = min.getFullYear();
  let m = Math.floor(min.getMonth() / size) * size;
  while (new Date(y, m, 1) <= max) {
    out.push({
      key: `${y}-${m}`,
      year: y,
      label: size === 3 ? `Q${m / 3 + 1}` : `H${m / 6 + 1}`,
      from: new Date(y, m, 1),
      to: new Date(y, m + size, 1),
    });
    m += size;
    if (m >= 12) {
      m = 0;
      y += 1;
    }
  }
  return out;
}

const inPeriod = (r, p) => toDate(r.start) < p.to && toDate(r.end) >= p.from;
const periodName = (p) => `${p.year} ${p.label}`;

/* ---------- CSV ---------- */

function exportCsv(rows, periods = []) {
  const head = [
    "Category", "Ref", "Activity", "Project", "Owner", "Organisation", "Priority", "Status",
    "Progress (%)", "Start", "End", ...periods.map(periodName), "Risk", "Mitigation", "Notes",
  ];
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const ordered = periods.length ? gridOrder(rows) : rows;
  const lines = ordered.map((r) =>
    [
      r.category, r.ref, r.title, r.project, r.owner, r.organisation, r.priority || "Medium",
      r.status, r.progress, r.start, r.end,
      ...periods.map((p) => (inPeriod(r, p) ? "x" : "")),
      r.risk, r.mitigation, r.notes,
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
  a.download = `workplan-${todayStr()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ---------- small pieces ---------- */

function StatCard({ label, value, hint, accent, onClick, active, children }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={`rounded-2xl border bg-white p-4 text-left ${
        active ? "border-[#E5484D] ring-1 ring-[#E5484D]" : "border-[#E6ECE9]"
      } ${onClick ? `transition hover:bg-[#FAFBFA] ${FOCUS}` : ""}`}
    >
      <p className="text-xs font-medium text-[#667085]">{label}</p>
      <p className="mt-1 text-2xl font-semibold" style={{ color: accent || "#0B2B24" }}>
        {value}
      </p>
      {children}
      {hint && <p className="mt-1 text-xs text-[#667085]">{hint}</p>}
    </Tag>
  );
}

function ProgressBar({ value, color }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-[#EEF1F0]">
      <div
        className="h-full rounded-full"
        style={{ width: `${value}%`, backgroundColor: color }}
      />
    </div>
  );
}

function Owner({ name }) {
  if (!name) return <span className="text-xs text-[#98A2B3]">Unassigned</span>;
  return (
    <span className="flex items-center gap-2">
      <span
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
        style={{ backgroundColor: avatarColor(name) }}
      >
        {initials(name)}
      </span>
      <span className="truncate">{name}</span>
    </span>
  );
}

function Priority({ value = "Medium" }) {
  return (
    <span className="flex items-center gap-1.5 text-xs">
      <i className="h-2 w-2 rounded-full" style={{ backgroundColor: PRIO_COLOR[value] }} />
      {value}
    </span>
  );
}

function Due({ a }) {
  if (a.status === "Done") return <span className="text-xs text-[#0B7A57]">Completed</span>;
  const n = daysLeft(a);
  if (n < 0) return <span className="text-xs font-medium text-[#D92D20]">{-n}d overdue</span>;
  if (n === 0) return <span className="text-xs font-medium text-[#B54708]">Due today</span>;
  return <span className="text-xs text-[#667085]">{n}d left</span>;
}

// One line under an activity title when it has a recorded risk
function RiskLine({ a }) {
  if (!a.risk) return null;
  return (
    <p
      className="mt-0.5 flex items-center gap-1 truncate text-xs text-[#B54708]"
      title={`Risk: ${a.risk}${a.mitigation ? `\nMitigation: ${a.mitigation}` : ""}`}
    >
      <AlertTriangle size={12} className="shrink-0" />
      <span className="truncate">{a.risk}</span>
    </p>
  );
}

function StatusSelect({ value, onChange }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Status"
      className={`cursor-pointer rounded-full border-0 px-2.5 py-1 text-xs font-medium ${STATUS[value].chip} ${FOCUS}`}
    >
      {STATUSES.map((s) => (
        <option key={s}>{s}</option>
      ))}
    </select>
  );
}

function Empty({ onAdd, filtered }) {
  return (
    <div className="rounded-2xl border border-dashed border-[#C9CED6] bg-white px-6 py-14 text-center">
      <p className="text-sm font-medium">
        {filtered ? "No activities match these filters" : "No activities yet"}
      </p>
      <p className="mt-1 text-sm text-[#667085]">
        {filtered ? "Clear a filter or search for something else." : "Add the first activity to start planning."}
      </p>
      {!filtered && (
        <button className={`${BTN_PRIMARY} mt-4`} onClick={onAdd}>
          <Plus size={16} /> New activity
        </button>
      )}
    </div>
  );
}

/* ---------- views ---------- */

function ListView({ rows, groupBy, sort, onSort, onEdit, onDuplicate, onDelete, onStatus }) {
  const groups = useMemo(() => {
    if (groupBy === "none") return [{ name: null, rows }];
    const m = new Map();
    rows.forEach((r) => {
      const k = groupBy === "category" ? r.category : r.project || "No project";
      m.set(k, [...(m.get(k) || []), r]);
    });
    const list = [...m].map(([name, rs]) => ({ name, rows: rs }));
    if (groupBy === "category") list.sort((a, b) => CATEGORIES.indexOf(a.name) - CATEGORIES.indexOf(b.name));
    return list;
  }, [rows, groupBy]);

  const head = (key, label) => (
    <th className={TH} aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button className={`inline-flex items-center gap-1 ${FOCUS}`} onClick={() => onSort(key)}>
        {label}
        {sort.key === key && (sort.dir === 1 ? <ChevronUp size={13} /> : <ChevronDown size={13} />)}
      </button>
    </th>
  );

  return (
    <div className="overflow-x-auto rounded-2xl border border-[#E6ECE9] bg-white">
      <table className="w-full min-w-[960px] border-collapse text-sm">
        <thead className="border-b border-[#E6ECE9] bg-[#FAFBFA]">
          <tr>
            {head("ref", "Ref")}
            {head("title", "Activity")}
            {head("owner", "Owner")}
            {head("priority", "Priority")}
            {head("start", "Dates")}
            {head("progress", "Progress")}
            {head("status", "Status")}
            <th className={TH} />
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <Fragment key={g.name ?? "all"}>
              {g.name && (
                <tr className="bg-[#F6F8F7]">
                  <td colSpan={8} className="px-3 py-2 text-xs font-semibold text-[#475467]">
                    {g.name}
                    <span className="ml-2 font-normal text-[#667085]">
                      {g.rows.length} {g.rows.length === 1 ? "activity" : "activities"}, average{" "}
                      {Math.round(g.rows.reduce((s, r) => s + Number(r.progress || 0), 0) / g.rows.length)}% complete
                    </span>
                  </td>
                </tr>
              )}
              {g.rows.map((r) => {
                const sub = [groupBy !== "category" ? r.category : "", groupBy !== "project" ? r.project : ""]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <tr key={r.id} className="border-b border-[#EEF1F0] last:border-0 hover:bg-[#FAFBFA]">
                    <td className="whitespace-nowrap px-3 py-3 text-xs text-[#667085]">{r.ref || "-"}</td>
                    <td className="max-w-[300px] px-3 py-3">
                      <button className={`block max-w-full truncate text-left font-medium hover:text-[#5B3FD0] ${FOCUS}`} onClick={() => onEdit(r)}>
                        {r.title}
                      </button>
                      {sub && <p className="truncate text-xs text-[#667085]">{sub}</p>}
                      <RiskLine a={r} />
                    </td>
                    <td className="px-3 py-3">
                      <Owner name={r.owner} />
                      {r.organisation && <p className="mt-0.5 truncate pl-8 text-xs text-[#667085]">{r.organisation}</p>}
                    </td>
                    <td className="px-3 py-3"><Priority value={r.priority} /></td>
                    <td className="whitespace-nowrap px-3 py-3">
                      <p>{shortDate(r.start)} to {shortDate(r.end)}</p>
                      <Due a={r} />
                    </td>
                    <td className="w-40 px-3 py-3">
                      <p className="mb-1 text-xs text-[#667085]">{r.progress}%</p>
                      <ProgressBar value={r.progress} color={STATUS[r.status].bar} />
                    </td>
                    <td className="px-3 py-3">
                      <StatusSelect value={r.status} onChange={(s) => onStatus(r, s)} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right">
                      <button className={ICON_BTN} aria-label={`Edit ${r.title}`} onClick={() => onEdit(r)}><Pencil size={15} /></button>
                      <button className={ICON_BTN} aria-label={`Duplicate ${r.title}`} onClick={() => onDuplicate(r)}><Copy size={15} /></button>
                      <button className={ICON_BTN} aria-label={`Delete ${r.title}`} onClick={() => onDelete(r)}><Trash2 size={15} /></button>
                    </td>
                  </tr>
                );
              })}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* The AmplifyChange template as a table: sections, reference, owner, organisation,
   an x for every period the activity runs in, then risk and mitigation. */
function GridView({ rows, periods, size, onSize, onOpen, onAdd }) {
  const sections = useMemo(
    () => CATEGORIES.map((name) => ({ name, rows: rows.filter((r) => r.category === name).sort(byRef) })),
    [rows]
  );
  const cols = 6 + periods.length;
  const cell = "px-3 py-2.5 align-top";

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg bg-[#EEF1F0] p-1" role="group" aria-label="Period length">
          {[[6, "6 months"], [3, "Quarters"]].map(([n, label]) => (
            <button
              key={n}
              onClick={() => onSize(n)}
              aria-pressed={size === n}
              className={`rounded-md px-3 py-1 text-sm transition motion-reduce:transition-none ${FOCUS} ${
                size === n ? "bg-white font-medium text-[#5B3FD0] shadow-sm" : "text-[#667085] hover:text-[#0B2B24]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-xs text-[#667085]">
          An x marks each period an activity runs in, worked out from its start and end dates.
        </p>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-[#E6ECE9] bg-white">
        <table className="border-collapse text-sm" style={{ minWidth: 1100 + periods.length * 64 }}>
          <thead className="border-b border-[#E6ECE9] bg-[#FAFBFA]">
            <tr>
              <th className={`${TH} sticky left-0 z-10 w-16 min-w-[64px] bg-[#FAFBFA]`}>Ref</th>
              <th className={`${TH} sticky left-[64px] z-10 w-60 min-w-[240px] border-r border-[#E6ECE9] bg-[#FAFBFA]`}>Activity</th>
              <th className={`${TH} min-w-[140px]`}>Owner</th>
              <th className={`${TH} min-w-[140px]`}>Organisation</th>
              {periods.map((p) => (
                <th key={p.key} className="w-16 min-w-[64px] px-1 py-2 text-center text-xs font-medium text-[#667085]">
                  <span className="block text-[10px] font-normal">{p.year}</span>
                  {p.label}
                </th>
              ))}
              <th className={`${TH} min-w-[220px]`}>Risk</th>
              <th className={`${TH} min-w-[220px]`}>Mitigation</th>
            </tr>
          </thead>
          <tbody>
            {sections.map((s) => (
              <Fragment key={s.name}>
                <tr className="border-y border-[#E6ECE9] bg-[#F6F8F7]">
                  <td colSpan={cols} className="px-3 py-2">
                    <div className="sticky left-3 inline-flex items-center gap-3">
                      <span className="text-xs font-semibold text-[#475467]">{s.name}</span>
                      <span className="text-xs text-[#667085]">{s.rows.length}</span>
                      <button
                        className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs text-[#5B3FD0] hover:bg-[#EDE9FB] ${FOCUS}`}
                        onClick={() => onAdd(s.name)}
                        aria-label={`Add activity to ${s.name}`}
                      >
                        <Plus size={12} /> Add
                      </button>
                    </div>
                  </td>
                </tr>
                {s.rows.length === 0 && (
                  <tr>
                    <td colSpan={cols} className="px-3 py-3 text-xs text-[#98A2B3]">No activities in this section.</td>
                  </tr>
                )}
                {s.rows.map((r) => (
                  <tr key={r.id} className="border-b border-[#EEF1F0] last:border-0">
                    <td className={`${cell} sticky left-0 z-10 w-16 min-w-[64px] whitespace-nowrap bg-white text-xs text-[#667085]`}>{r.ref || "-"}</td>
                    <td className={`${cell} sticky left-[64px] z-10 w-60 min-w-[240px] border-r border-[#E6ECE9] bg-white`}>
                      <button className={`text-left font-medium hover:text-[#5B3FD0] ${FOCUS}`} onClick={() => onOpen(r)}>
                        {r.title}
                      </button>
                    </td>
                    <td className={cell}>{r.owner || <span className="text-xs text-[#98A2B3]">Unassigned</span>}</td>
                    <td className={`${cell} text-[#475467]`}>{r.organisation || <span className="text-xs text-[#98A2B3]">-</span>}</td>
                    {periods.map((p) => (
                      <td key={p.key} className="px-1 py-2.5 text-center align-middle">
                        {inPeriod(r, p) && (
                          <span
                            className="inline-flex h-6 w-6 items-center justify-center rounded text-xs font-semibold text-white"
                            style={{ backgroundColor: STATUS[r.status].bar }}
                          >
                            <span aria-hidden="true">x</span>
                            <span className="sr-only">Runs in {periodName(p)}</span>
                          </span>
                        )}
                      </td>
                    ))}
                    <td className={`${cell} text-xs text-[#475467]`}>{r.risk || <span className="text-[#98A2B3]">-</span>}</td>
                    <td className={`${cell} text-xs text-[#475467]`}>{r.mitigation || <span className="text-[#98A2B3]">-</span>}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GanttView({ rows, onOpen }) {
  const chart = useMemo(() => {
    const min = new Date(Math.min(...rows.map((r) => +toDate(r.start))));
    const max = new Date(Math.max(...rows.map((r) => +toDate(r.end))));
    const from = new Date(min.getFullYear(), min.getMonth(), 1);
    const to = new Date(max.getFullYear(), max.getMonth() + 1, 1);
    const span = +to - +from;
    const months = [];
    for (let d = new Date(from); d < to; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
      const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      months.push({
        key: +d,
        label: d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" }),
        left: ((+d - +from) / span) * 100,
        width: ((+next - +d) / span) * 100,
      });
    }
    const t = +toDate(todayStr());
    const today = t >= +from && t < +to ? ((t - +from) / span) * 100 : null;
    return { from, span, months, today };
  }, [rows]);

  const Lines = () => (
    <>
      {chart.months.map((m) => (
        <span key={m.key} className="absolute inset-y-0 border-l border-[#EEF1F0]" style={{ left: `${m.left}%` }} />
      ))}
      {chart.today !== null && (
        <span className="absolute inset-y-0 w-px bg-[#E5484D]" style={{ left: `${chart.today}%` }} />
      )}
    </>
  );

  return (
    <div className="overflow-x-auto rounded-2xl border border-[#E6ECE9] bg-white">
      <div style={{ minWidth: 240 + chart.months.length * 96 }}>
        <div className="flex border-b border-[#E6ECE9] bg-[#FAFBFA]">
          <div className="sticky left-0 z-10 w-60 shrink-0 border-r border-[#E6ECE9] bg-[#FAFBFA] px-3 py-2.5 text-xs font-medium text-[#667085]">
            Activity
          </div>
          <div className="relative h-9 flex-1">
            {chart.months.map((m) => (
              <span
                key={m.key}
                className="absolute inset-y-0 flex items-center border-l border-[#E6ECE9] pl-2 text-xs text-[#667085]"
                style={{ left: `${m.left}%`, width: `${m.width}%` }}
              >
                {m.label}
              </span>
            ))}
            {chart.today !== null && (
              <span className="absolute inset-y-0 w-px bg-[#E5484D]" style={{ left: `${chart.today}%` }} />
            )}
          </div>
        </div>

        {rows.map((r) => {
          const left = ((+toDate(r.start) - +chart.from) / chart.span) * 100;
          const width = Math.max(((+toDate(r.end) + DAY - +toDate(r.start)) / chart.span) * 100, 0.6);
          const color = STATUS[r.status].bar;
          const name = r.ref ? `${r.ref} ${r.title}` : r.title;
          return (
            <div key={r.id} className="flex border-b border-[#EEF1F0] last:border-0">
              <button
                onClick={() => onOpen(r)}
                className={`sticky left-0 z-10 w-60 shrink-0 border-r border-[#E6ECE9] bg-white px-3 py-2 text-left ${FOCUS}`}
              >
                <p className="truncate text-sm font-medium">{name}</p>
                <p className="truncate text-xs text-[#667085]">{r.owner || "Unassigned"}</p>
              </button>
              <div className="relative h-12 flex-1">
                <Lines />
                <button
                  onClick={() => onOpen(r)}
                  title={`${name}: ${shortDate(r.start)} to ${shortDate(r.end)}, ${r.progress}%`}
                  className={`absolute top-3 h-6 overflow-hidden rounded-md ${isOverdue(r) ? "ring-2 ring-[#E5484D]" : ""} ${FOCUS}`}
                  style={{ left: `${left}%`, width: `${width}%`, backgroundColor: `${color}40` }}
                >
                  <span className="block h-full" style={{ width: `${r.progress}%`, backgroundColor: color }} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BoardView({ rows, onOpen, onStatus }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {STATUSES.map((s) => {
        const col = rows.filter((r) => r.status === s);
        return (
          <div key={s} className="rounded-2xl bg-[#F6F8F7] p-3">
            <div className="mb-3 flex items-center justify-between px-1">
              <span className="flex items-center gap-2 text-sm font-medium">
                <i className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: STATUS[s].bar }} />
                {s}
              </span>
              <span className="text-xs text-[#667085]">{col.length}</span>
            </div>
            <div className="space-y-2">
              {col.map((r) => (
                <div key={r.id} className="rounded-xl border border-[#E6ECE9] bg-white p-3">
                  <button className={`text-left text-sm font-medium hover:text-[#5B3FD0] ${FOCUS}`} onClick={() => onOpen(r)}>
                    {r.ref && <span className="mr-1.5 text-xs font-normal text-[#667085]">{r.ref}</span>}
                    {r.title}
                  </button>
                  <p className="mt-0.5 text-xs text-[#667085]">
                    {[r.category, r.project].filter(Boolean).join(" · ")}
                  </p>
                  <div className="mt-2 flex items-center justify-between text-xs">
                    <Owner name={r.owner} />
                    <Priority value={r.priority} />
                  </div>
                  {r.organisation && <p className="mt-1 truncate text-xs text-[#667085]">{r.organisation}</p>}
                  <div className="mt-2 flex items-center justify-between text-xs text-[#667085]">
                    <span>{shortDate(r.start)} to {shortDate(r.end)}</span>
                    <Due a={r} />
                  </div>
                  <RiskLine a={r} />
                  <div className="mt-2"><ProgressBar value={r.progress} color={STATUS[r.status].bar} /></div>
                  <div className="mt-2.5">
                    <StatusSelect value={r.status} onChange={(next) => onStatus(r, next)} />
                  </div>
                </div>
              ))}
              {col.length === 0 && <p className="px-1 py-3 text-xs text-[#98A2B3]">Nothing here</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- side drawer form ---------- */

function Drawer({ form, setForm, projects, owners, organisations, onSave, onDelete, onClose, saving, error }) {
  const set = (k) => (e) => setForm(applyRules(form, k, e.target.value));
  const label = "mb-1 block text-xs font-medium text-[#667085]";
  const [tab, setTab] = useState("details");

  return (
    <div className="fixed inset-0 z-[60] flex justify-end bg-slate-900/30" onMouseDown={onClose}>
      <form
        role="dialog"
        aria-modal="true"
        aria-label={form.id ? "Edit activity" : "New activity"}
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={onSave}
        className="flex h-full w-full max-w-md flex-col bg-white shadow-[0_0_40px_rgba(16,24,40,0.25)]"
      >
        <div className="flex items-center justify-between border-b border-[#E6ECE9] px-5 py-4">
          <h3 className="text-lg font-medium">{form.id ? "Edit activity" : "New activity"}</h3>
          <button type="button" className={ICON_BTN} onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        {form.id && (
          <div className="flex gap-1 border-b border-[#E6ECE9] px-5" role="tablist">
            {["details", "history"].map((t) => (
              <button
                type="button"
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`-mb-px border-b-2 px-3 py-2 text-sm capitalize ${FOCUS} ${
                  tab === t
                    ? "border-[#5B3FD0] font-medium text-[#5B3FD0]"
                    : "border-transparent text-[#667085] hover:text-[#0B2B24]"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        )}

        <div className={`flex-1 space-y-4 overflow-y-auto px-5 py-5 ${tab === "history" ? "hidden" : ""}`}>
          {form.updatedBy && (
            <p className="text-xs text-[#667085]">
              Last updated by {form.updatedBy.name || form.updatedBy.email} on{" "}
              {new Date(form.updatedAt).toLocaleString("en-GB")}
            </p>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className={label} htmlFor="wp-category">Section</label>
              <select id="wp-category" className={`${INPUT} w-full`} value={form.category} onChange={set("category")}>
                {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className={label} htmlFor="wp-ref">Reference</label>
              <input id="wp-ref" className={`${INPUT} w-full`} value={form.ref} onChange={set("ref")} placeholder="1.1" maxLength={20} />
            </div>
          </div>

          <div>
            <label className={label} htmlFor="wp-title">Activity</label>
            <input id="wp-title" autoFocus className={`${INPUT} w-full`} value={form.title} onChange={set("title")} placeholder="What needs to be done?" />
          </div>

          <div>
            <label className={label} htmlFor="wp-project">Project</label>
            <input id="wp-project" list="wp-projects" className={`${INPUT} w-full`} value={form.project} onChange={set("project")} />
            <datalist id="wp-projects">{projects.map((p) => <option key={p} value={p} />)}</datalist>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label} htmlFor="wp-owner">Owner (name or position)</label>
              <input id="wp-owner" list="wp-owners" className={`${INPUT} w-full`} value={form.owner} onChange={set("owner")} />
              <datalist id="wp-owners">{owners.map((o) => <option key={o} value={o} />)}</datalist>
            </div>
            <div>
              <label className={label} htmlFor="wp-org">Organisation</label>
              <input id="wp-org" list="wp-orgs" className={`${INPUT} w-full`} value={form.organisation} onChange={set("organisation")} />
              <datalist id="wp-orgs">{organisations.map((o) => <option key={o} value={o} />)}</datalist>
            </div>
          </div>
          <p className="-mt-2 text-xs text-[#667085]">Separate several people or organisations with commas.</p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label} htmlFor="wp-start">Start date</label>
              <input id="wp-start" type="date" className={`${INPUT} w-full`} value={form.start} onChange={set("start")} />
            </div>
            <div>
              <label className={label} htmlFor="wp-end">End date</label>
              <input id="wp-end" type="date" className={`${INPUT} w-full`} value={form.end} onChange={set("end")} />
            </div>
          </div>

          <div>
            <span className={label}>Priority</span>
            <div className="flex gap-2" role="radiogroup" aria-label="Priority">
              {PRIORITIES.map((p) => {
                const on = (form.priority || "Medium") === p;
                return (
                  <button
                    type="button"
                    key={p}
                    role="radio"
                    aria-checked={on}
                    onClick={() => setForm({ ...form, priority: p })}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm ${FOCUS} ${
                      on ? "border-[#5B3FD0] bg-[#EDE9FB] text-[#5B3FD0]" : "border-[#C9CED6] bg-white"
                    }`}
                  >
                    <i className="h-2 w-2 rounded-full" style={{ backgroundColor: PRIO_COLOR[p] }} />
                    {p}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className={label} htmlFor="wp-status">Status</label>
            <select id="wp-status" className={`${INPUT} w-full`} value={form.status} onChange={set("status")}>
              {STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>

          <div>
            <label className={label} htmlFor="wp-progress">Progress</label>
            <div className="flex items-center gap-3">
              <input id="wp-progress" type="range" min="0" max="100" step="5" value={form.progress} onChange={set("progress")} className="flex-1 accent-[#5B3FD0]" />
              <input type="number" min="0" max="100" value={form.progress} onChange={set("progress")} aria-label="Progress percent" className={`${INPUT} w-20`} />
            </div>
          </div>

          <div>
            <label className={label} htmlFor="wp-risk">Risk</label>
            <textarea id="wp-risk" rows={2} maxLength={500} className={`${INPUT} w-full resize-y`} value={form.risk || ""} onChange={set("risk")} placeholder="What could stop this activity going ahead?" />
          </div>

          <div>
            <label className={label} htmlFor="wp-mitigation">Mitigation</label>
            <textarea id="wp-mitigation" rows={2} maxLength={500} className={`${INPUT} w-full resize-y`} value={form.mitigation || ""} onChange={set("mitigation")} placeholder="What you will do to reduce the risk" />
          </div>

          <div>
            <label className={label} htmlFor="wp-notes">Notes</label>
            <textarea id="wp-notes" rows={4} className={`${INPUT} w-full resize-y`} value={form.notes || ""} onChange={set("notes")} placeholder="Deliverables, links" />
          </div>

          {error && <p className={ERROR}>{error}</p>}
        </div>

        {tab === "history" && form.id && (
          <div className="flex-1 overflow-y-auto px-5 py-5">
            <AuditTimeline entity="workplan" id={form.id} />
          </div>
        )}

        <div className="flex items-center gap-2 border-t border-[#E6ECE9] px-5 py-3">
          {form.id && <button type="button" className={BTN_DANGER} onClick={onDelete}>Delete</button>}
          <span className="flex-1" />
          <button type="button" className={BTN} onClick={onClose}>Cancel</button>
          <button className={BTN_PRIMARY} disabled={saving}>{saving ? "Saving..." : "Save"}</button>
        </div>
      </form>
    </div>
  );
}

/* ---------- page ---------- */

export default function WorkPlan() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState(null);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const [view, setView] = useState("list");
  const [groupBy, setGroupBy] = useState("none");
  const [gridSize, setGridSize] = useState(6); // months per period column
  const [sort, setSort] = useState({ key: "start", dir: 1 });
  const [q, setQ] = useState("");
  const [project, setProject] = useState("All");
  const [owner, setOwner] = useState("All");
  const [status, setStatus] = useState("All");
  const [category, setCategory] = useState("All");
  const [overdueOnly, setOverdueOnly] = useState(false);

  const load = () =>
    listActivities()
      .then((data) => {
        setError("");
        setItems(data || []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!form) return undefined;
    const onKey = (e) => e.key === "Escape" && setForm(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [form]);

  const projects = useMemo(() => [...new Set(items.map((i) => i.project).filter(Boolean))].sort(), [items]);
  const owners = useMemo(() => [...new Set(items.map((i) => i.owner).filter(Boolean))].sort(), [items]);
  const organisations = useMemo(() => [...new Set(items.map((i) => i.organisation).filter(Boolean))].sort(), [items]);

  // Columns come from every activity, so they do not jump around when a filter is on
  const periods = useMemo(() => buildPeriods(items, gridSize), [items, gridSize]);

  const stats = useMemo(() => {
    const total = items.length;
    return {
      total,
      active: items.filter((i) => i.status === "In progress").length,
      done: items.filter((i) => i.status === "Done").length,
      overdue: items.filter(isOverdue).length,
      avg: total ? Math.round(items.reduce((s, i) => s + (Number(i.progress) || 0), 0) / total) : 0,
    };
  }, [items]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items
      .filter(
        (i) =>
          (project === "All" || i.project === project) &&
          (owner === "All" || i.owner === owner) &&
          (status === "All" || i.status === status) &&
          (category === "All" || i.category === category) &&
          (!overdueOnly || isOverdue(i)) &&
          (!needle ||
            [i.title, i.ref, i.category, i.project, i.owner, i.organisation, i.risk, i.mitigation, i.notes].some((v) =>
              (v || "").toLowerCase().includes(needle)
            ))
      )
      .sort((a, b) => SORTERS[sort.key](a, b) * sort.dir);
  }, [items, q, project, owner, status, category, overdueOnly, sort]);

  const filtered = q || project !== "All" || owner !== "All" || status !== "All" || category !== "All" || overdueOnly;
  const clearFilters = () => {
    setQ("");
    setProject("All");
    setOwner("All");
    setStatus("All");
    setCategory("All");
    setOverdueOnly(false);
  };

  const onSort = (key) =>
    setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: 1 }));

  const openNew = (cat) => {
    setFormError("");
    setForm({ ...EMPTY, category: CATEGORIES.includes(cat) ? cat : CATEGORIES[0] });
  };
  const openEdit = (r) => {
    setFormError("");
    setForm({ ...EMPTY, ...r });
  };
  const duplicate = (r) => {
    setFormError("");
    const { id, ...rest } = r;
    setForm({ ...EMPTY, ...rest, ref: "", title: `${r.title} (copy)`, status: "Not started", progress: 0 });
  };

  async function onSave(e) {
    e.preventDefault();
    if (!form.title.trim() || !form.start || !form.end) {
      setFormError("Add a title, start date and end date.");
      return;
    }
    if (form.end < form.start) {
      setFormError("The end date must be on or after the start date.");
      return;
    }
    setSaving(true);
    try {
      await saveActivity({
        ...form,
        title: form.title.trim(),
        ref: (form.ref || "").trim(),
        progress: Number(form.progress),
      });
      setForm(null);
      await load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(r) {
    if (!window.confirm(`Delete "${r.title}"?`)) return;
    try {
      await deleteActivity(r.id);
      setForm(null);
      await load();
    } catch (err) {
      setError(err.message);
      setFormError(err.message);
    }
  }

  async function quickStatus(r, nextStatus) {
    const next = applyRules(r, "status", nextStatus);
    setItems((prev) => prev.map((x) => (x.id === r.id ? next : x)));
    try {
      await saveActivity(next);
    } catch (err) {
      setError(err.message);
      load();
    }
  }

  const tab = (key, label) => (
    <button
      key={key}
      onClick={() => setView(key)}
      aria-pressed={view === key}
      className={`rounded-md px-3.5 py-1.5 text-sm transition motion-reduce:transition-none ${FOCUS} ${
        view === key ? "bg-white font-medium text-[#5B3FD0] shadow-sm" : "text-[#667085] hover:text-[#0B2B24]"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="p-4 text-[#0B2B24] lg:p-6">
      {/* HEADER */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-2xl font-semibold">Workplan</h2>
          <p className="text-sm text-[#667085]">Plan, assign and track activities across projects.</p>
        </div>
        <span className="flex-1" />
        <button
          className={BTN}
          onClick={() => exportCsv(rows, view === "grid" ? periods : [])}
          disabled={!rows.length}
        >
          <Download size={16} /> Export CSV
        </button>
        <button className={BTN_PRIMARY} onClick={() => openNew()}>
          <Plus size={16} /> New activity
        </button>
      </div>

      {error && <p className={`${ERROR} mb-4`}>{error}</p>}

      {/* SUMMARY */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Activities" value={stats.total} />
        <StatCard label="In progress" value={stats.active} accent="#2552B8" />
        <StatCard label="Completed" value={stats.done} accent="#0B7A57" />
        <StatCard
          label="Overdue"
          value={stats.overdue}
          accent={stats.overdue ? "#D92D20" : undefined}
          hint={stats.overdue ? (overdueOnly ? "Showing overdue only" : "Select to filter") : "Nothing late"}
          onClick={stats.overdue ? () => setOverdueOnly((v) => !v) : undefined}
          active={overdueOnly}
        />
        <StatCard label="Overall progress" value={`${stats.avg}%`}>
          <div className="mt-2"><ProgressBar value={stats.avg} color="#5B3FD0" /></div>
        </StatCard>
      </div>

      {/* TOOLBAR */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#98A2B3]" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search activities"
            aria-label="Search activities"
            className={`${INPUT} w-56 pl-8`}
          />
        </div>
        <select className={INPUT} value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filter by section">
          <option value="All">All sections</option>
          {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select className={INPUT} value={project} onChange={(e) => setProject(e.target.value)} aria-label="Filter by project">
          <option value="All">All projects</option>
          {projects.map((p) => <option key={p}>{p}</option>)}
        </select>
        <select className={INPUT} value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Filter by owner">
          <option value="All">All owners</option>
          {owners.map((o) => <option key={o}>{o}</option>)}
        </select>
        <select className={INPUT} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
          <option value="All">All statuses</option>
          {STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
        {filtered && (
          <button className={`text-sm text-[#5B3FD0] hover:underline ${FOCUS}`} onClick={clearFilters}>
            Clear filters
          </button>
        )}
        <span className="flex-1" />
        {view === "list" && (
          <select className={INPUT} value={groupBy} onChange={(e) => setGroupBy(e.target.value)} aria-label="Group activities">
            {GROUPINGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        )}
        <div className="flex rounded-lg bg-[#EEF1F0] p-1" role="group" aria-label="View">
          {tab("list", "List")}
          {tab("grid", "Grid")}
          {tab("timeline", "Timeline")}
          {tab("board", "Board")}
        </div>
      </div>

      {/* CONTENT */}
      {loading ? (
        <p className="py-10 text-center text-sm text-[#667085]">Loading workplan...</p>
      ) : rows.length === 0 ? (
        <Empty onAdd={() => openNew()} filtered={filtered} />
      ) : view === "list" ? (
        <ListView
          rows={rows}
          groupBy={groupBy}
          sort={sort}
          onSort={onSort}
          onEdit={openEdit}
          onDuplicate={duplicate}
          onDelete={remove}
          onStatus={quickStatus}
        />
      ) : view === "grid" ? (
        <GridView
          rows={rows}
          periods={periods}
          size={gridSize}
          onSize={setGridSize}
          onOpen={openEdit}
          onAdd={openNew}
        />
      ) : view === "timeline" ? (
        <GanttView rows={[...rows].sort((a, b) => a.start.localeCompare(b.start))} onOpen={openEdit} />
      ) : (
        <BoardView rows={rows} onOpen={openEdit} onStatus={quickStatus} />
      )}

      {form && (
        <Drawer
          form={form}
          setForm={setForm}
          projects={projects}
          owners={owners}
          organisations={organisations}
          onSave={onSave}
          onDelete={() => remove(form)}
          onClose={() => setForm(null)}
          saving={saving}
          error={formError}
        />
      )}
    </div>
  );
}
