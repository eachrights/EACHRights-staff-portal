import { useCallback, useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { listAudit } from "./workplanApi";

/* ---------- labels and helpers ---------- */

const FIELD = {
  title: "Title",
  project: "Project",
  owner: "Owner",
  priority: "Priority",
  status: "Status",
  progress: "Progress",
  start: "Start",
  end: "End",
  notes: "Notes",
  type: "Type",
  allDay: "All day",
  description: "Description",
};
const ENTITY = {
  workplan: "Workplan activity",
  events: "Calendar event",
  leave: "Leave request",
  travel: "Travel request",
  "fund-request": "Fund request",
  attendance: "Attendance device",
};
const NOUN = {
  workplan: "activity",
  events: "event",
  leave: "leave request",
  travel: "travel request",
  "fund-request": "fund request",
};
const ACTION = {
  create: "Created",
  update: "Updated",
  edit: "Edited",
  delete: "Deleted",
  submit: "Submitted",
  withdraw: "Withdrew",
  approve: "Approved",
  reject: "Rejected",
  cancel: "Cancelled",
  markPaid: "Marked as paid",
};
const DOT = {
  create: "#0F9F77",
  update: "#3B6FE0",
  edit: "#3B6FE0",
  delete: "#E5484D",
  approve: "#0F9F77",
  reject: "#E5484D",
  cancel: "#98A2B3",
  withdraw: "#98A2B3",
  submit: "#E8870A",
  markPaid: "#5B3FD0",
};
const actionLabel = (a) => ACTION[a] || a || "Action";
const dot = (a) => DOT[a] || "#3B6FE0";

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#5B3FD0]";
const BTN = `inline-flex items-center gap-2 rounded-lg border border-[#C9CED6] bg-white px-4 py-2 text-sm text-[#0B2B24] transition hover:bg-[#F6F7F8] disabled:opacity-60 motion-reduce:transition-none ${FOCUS}`;
const INPUT = `rounded-lg border border-[#C9CED6] bg-white px-2.5 py-2 text-sm text-[#0B2B24] ${FOCUS}`;
const ERROR = "rounded-lg bg-[#FDECEA] px-3 py-2 text-sm text-[#8A1C14]";

const who = (e) => e.actor?.name || e.actor?.email || "Unknown user";

function show(field, v) {
  if (v === null || v === undefined || v === "") return "empty";
  if (field === "progress") return `${v}%`;
  if (field === "allDay") return v ? "yes" : "no";
  const s = String(v);
  return s.length > 60 ? `${s.slice(0, 60)}...` : s;
}

// One line per change: "Status: In progress to Done"
const changeLines = (e) =>
  (e.changes || []).map((c) => `${FIELD[c.field] || c.field}: ${show(c.field, c.from)} to ${show(c.field, c.to)}`);

// What to show under "Details": the field changes, otherwise the text the server recorded
const detailLines = (e) => {
  const lines = changeLines(e);
  if (lines.length) return lines;
  if (e.detail) return [e.detail];
  return [e.action === "delete" ? "Removed" : e.action === "create" ? "Created" : actionLabel(e.action)];
};

function timeAgo(iso) {
  const sec = Math.round((new Date(iso) - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const steps = [
    [60, "second"],
    [60, "minute"],
    [24, "hour"],
    [7, "day"],
    [4.35, "week"],
    [12, "month"],
    [Infinity, "year"],
  ];
  let n = sec;
  for (const [size, unit] of steps) {
    if (Math.abs(n) < size) return rtf.format(Math.round(n), unit);
    n /= size;
  }
  return "";
}

const stamp = (iso) => new Date(iso).toLocaleString("en-GB");

/* ---------- loading hook (newest first, with paging) ---------- */

function useAudit(entity, id) {
  const [rows, setRows] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchPage = useCallback(
    (from) => {
      setLoading(true);
      return listAudit({ entity, id, cursor: from, limit: 200 })
        .then((res) => {
          setError("");
          const items = res?.items || [];
          setRows((prev) => (from ? [...prev, ...items] : items));
          setCursor(res?.cursor || null);
        })
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
    },
    [entity, id]
  );

  useEffect(() => {
    setRows([]);
    setCursor(null);
    fetchPage(null);
  }, [fetchPage]);

  return { rows, cursor, loading, error, more: () => fetchPage(cursor) };
}

/* ---------- timeline for one item (used in the drawer and modal) ---------- */

function Entry({ e }) {
  const lines = changeLines(e);
  return (
    <li className="flex gap-3 pb-5 last:pb-0">
      <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: dot(e.action) }} />
      <div className="min-w-0 flex-1">
        <p className="text-sm">
          <strong className="font-medium">{who(e)}</strong> {actionLabel(e.action).toLowerCase()} this{" "}
          {NOUN[e.entity] || "item"}
        </p>
        <p className="text-xs text-[#667085]" title={stamp(e.at)}>
          {timeAgo(e.at)}, {stamp(e.at)}
        </p>
        {(lines.length > 0 || e.detail) && (
          <ul className="mt-1.5 space-y-1 rounded-lg bg-[#F6F8F7] p-2 text-xs text-[#475467]">
            {(lines.length ? lines : [e.detail]).map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

export function AuditTimeline({ entity, id }) {
  const { rows, cursor, loading, error, more } = useAudit(entity, id);

  if (error) return <p className={ERROR}>{error}</p>;
  if (loading && !rows.length) return <p className="text-sm text-[#667085]">Loading history...</p>;
  if (!rows.length) return <p className="text-sm text-[#667085]">No changes recorded yet.</p>;

  return (
    <>
      <ul>
        {rows.map((e) => (
          <Entry key={e.auditId} e={e} />
        ))}
      </ul>
      {cursor && (
        <button className={`${BTN} mt-3`} onClick={more} disabled={loading}>
          {loading ? "Loading..." : "Load more"}
        </button>
      )}
    </>
  );
}

/* ---------- full audit log page (administrator) ---------- */

function exportCsv(rows) {
  const head = ["When", "User", "Email", "Action", "Type", "Item", "Details"];
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = rows.map((e) =>
    [
      new Date(e.at).toISOString(),
      who(e),
      e.actor?.email,
      actionLabel(e.action),
      ENTITY[e.entity] || e.entity,
      e.title,
      detailLines(e).join("; "),
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
  a.download = `audit-trail-${new Date().toLocaleDateString("en-CA")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AuditLog() {
  const [entity, setEntity] = useState("all");
  const [action, setAction] = useState("all");
  const [user, setUser] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const { rows, cursor, loading, error, more } = useAudit(entity === "all" ? undefined : entity, undefined);

  const shown = useMemo(() => {
    const needle = user.trim().toLowerCase();
    return rows.filter((e) => {
      const day = new Date(e.at).toLocaleDateString("en-CA");
      return (
        (action === "all" || e.action === action) &&
        (!needle || who(e).toLowerCase().includes(needle) || (e.actor?.email || "").toLowerCase().includes(needle)) &&
        (!from || day >= from) &&
        (!to || day <= to)
      );
    });
  }, [rows, action, user, from, to]);

  return (
    <div className="p-4 text-[#0B2B24] lg:p-6">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-2xl font-semibold">Audit trail</h2>
          <p className="text-sm text-[#667085]">
            Every change to the workplan, calendar, leave, travel and fund requests: who made it and when. Records
            cannot be edited or deleted.
          </p>
        </div>
        <span className="flex-1" />
        <button className={BTN} onClick={() => exportCsv(shown)} disabled={!shown.length}>
          <Download size={16} /> Export CSV
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select className={INPUT} value={entity} onChange={(e) => setEntity(e.target.value)} aria-label="Filter by type">
          <option value="all">All types</option>
          <option value="workplan">Workplan activities</option>
          <option value="events">Calendar events</option>
          <option value="leave">Leave requests</option>
          <option value="travel">Travel requests</option>
          <option value="fund-request">Fund requests</option>
        </select>
        <select className={INPUT} value={action} onChange={(e) => setAction(e.target.value)} aria-label="Filter by action">
          <option value="all">All actions</option>
          <option value="create">Created</option>
          <option value="update">Updated</option>
          <option value="delete">Deleted</option>
          <option value="submit">Submitted</option>
          <option value="approve">Approved</option>
          <option value="reject">Rejected</option>
          <option value="cancel">Cancelled</option>
          <option value="markPaid">Marked as paid</option>
        </select>
        <input className={`${INPUT} w-52`} type="search" placeholder="Search by user" value={user} onChange={(e) => setUser(e.target.value)} aria-label="Search by user" />
        <label className="flex items-center gap-2 text-sm text-[#667085]">
          From
          <input type="date" className={INPUT} value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-sm text-[#667085]">
          To
          <input type="date" className={INPUT} value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>

      {error && <p className={`${ERROR} mb-4`}>{error}</p>}

      <div className="overflow-x-auto rounded-2xl border border-[#E6ECE9] bg-white">
        <table className="w-full min-w-[860px] border-collapse text-sm">
          <thead className="border-b border-[#E6ECE9] bg-[#FAFBFA]">
            <tr>
              {["When", "User", "Action", "Item", "Details"].map((h) => (
                <th key={h} className="px-3 py-2.5 text-left text-xs font-medium text-[#667085]">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((e) => {
              const lines = detailLines(e);
              return (
                <tr key={e.auditId} className="border-b border-[#EEF1F0] align-top last:border-0">
                  <td className="whitespace-nowrap px-3 py-3">
                    <p>{stamp(e.at)}</p>
                    <p className="text-xs text-[#667085]">{timeAgo(e.at)}</p>
                  </td>
                  <td className="px-3 py-3">
                    <p>{who(e)}</p>
                    {e.actor?.email && e.actor.email !== who(e) && (
                      <p className="text-xs text-[#667085]">{e.actor.email}</p>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <span className="flex items-center gap-1.5">
                      <i className="h-2 w-2 rounded-full" style={{ backgroundColor: dot(e.action) }} />
                      {actionLabel(e.action)}
                    </span>
                  </td>
                  <td className="max-w-[260px] px-3 py-3">
                    <p className="text-xs text-[#667085]">{ENTITY[e.entity] || e.entity}</p>
                  </td>
                  <td className="px-3 py-3 text-xs text-[#475467]">
                    <ul className="space-y-0.5">
                      {lines.map((l) => (
                        <li key={l}>{l}</li>
                      ))}
                    </ul>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {!loading && !shown.length && !error && (
          <p className="px-4 py-10 text-center text-sm text-[#667085]">No records match these filters.</p>
        )}
        {loading && <p className="px-4 py-6 text-center text-sm text-[#667085]">Loading...</p>}
      </div>

      {cursor && !loading && (
        <div className="mt-4 text-center">
          <button className={BTN} onClick={more}>
            Load older records
          </button>
        </div>
      )}
    </div>
  );
}
