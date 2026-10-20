import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity as ActivityIcon, AlertCircle, Loader2, RefreshCw } from "lucide-react";

import PageShell from "../../components/PageShell";
import { apiRequest } from "../../api";

/*
 * Activity log (administrators). Shows who uploaded, viewed, downloaded,
 * renamed, moved, restored or deleted files. Data comes from
 * GET /admin/activity, which the files Lambda fills in.
 */

const ACTIONS = {
  upload: { label: "Uploaded", style: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  view: { label: "Viewed", style: "bg-sky-50 text-sky-800 border-sky-200" },
  download: { label: "Downloaded", style: "bg-sky-50 text-sky-800 border-sky-200" },
  rename: { label: "Renamed", style: "bg-amber-50 text-amber-800 border-amber-200" },
  "rename-folder": { label: "Renamed folder", style: "bg-amber-50 text-amber-800 border-amber-200" },
  move: { label: "Moved", style: "bg-amber-50 text-amber-800 border-amber-200" },
  "new-folder": { label: "New folder", style: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  restore: { label: "Restored", style: "bg-violet-50 text-violet-800 border-violet-200" },
  delete: { label: "Deleted", style: "bg-red-50 text-red-800 border-red-200" },
  "delete-folder": { label: "Deleted folder", style: "bg-red-50 text-red-800 border-red-200" },
};

const formatWhen = (value) => {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

function ActivityPage() {
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");

  const load = useCallback(async (nextCursor) => {
    if (nextCursor) setLoadingMore(true);
    else setLoading(true);
    setError("");

    try {
      const query = nextCursor ? `&cursor=${encodeURIComponent(nextCursor)}` : "";
      const data = await apiRequest(`/admin/activity?limit=100${query}`);

      setItems((prev) => (nextCursor ? [...prev, ...(data.items || [])] : data.items || []));
      setCursor(data.nextCursor || null);
      setNotice(data.notice || "");
    } catch (err) {
      setError(err.message || "Unable to load the activity log.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();

    return items.filter(
      (item) =>
        (filter === "all" || item.action === filter) &&
        (!query ||
          `${item.email} ${item.target} ${item.detail}`.toLowerCase().includes(query))
    );
  }, [items, filter, search]);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-slate-500">Administration</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-[#07523F]">Activity</h1>
          <p className="mt-1.5 max-w-xl text-sm leading-6 text-slate-600">
            Who uploaded, opened, renamed, moved or deleted files, newest first.
          </p>
        </div>

        <button
          type="button"
          onClick={() => load()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-[#D9E3DC] bg-white px-4 py-2.5 text-sm font-semibold hover:bg-[#F4FAF6] disabled:opacity-50"
        >
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-[1fr_220px]">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by person or file"
          aria-label="Search activity"
          className="rounded-lg border border-[#D9E3DC] bg-white px-3.5 py-2.5 text-sm outline-none focus:border-[#0A6B52]"
        />

        <select
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          aria-label="Filter by action"
          className="rounded-lg border border-[#D9E3DC] bg-white px-3 py-2.5 text-sm"
        >
          <option value="all">All actions</option>
          {Object.entries(ACTIONS).map(([value, { label }]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div role="alert" className="mt-5 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {notice && (
        <p className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {notice} Create the activity table and set ACTIVITY_TABLE on the files function.
        </p>
      )}

      <section className="mt-5 overflow-hidden rounded-xl border border-[#D9E3DC] bg-white shadow-sm">
        {loading ? (
          <div className="px-5 py-16 text-center">
            <Loader2 size={26} className="mx-auto animate-spin text-[#0A6B52]" />
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center px-5 py-16 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#D9F0E5] text-[#0A6B52]">
              <ActivityIcon size={22} />
            </span>
            <h2 className="mt-4 text-sm font-semibold">Nothing to show</h2>
            <p className="mt-1 text-sm text-slate-500">
              Activity appears here as people use the portal.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px]">
              <thead className="bg-[#E9F3EC]">
                <tr className="border-b border-[#D9E3DC] text-left text-xs font-semibold text-slate-600">
                  <th scope="col" className="px-5 py-3">When</th>
                  <th scope="col" className="px-5 py-3">Person</th>
                  <th scope="col" className="px-5 py-3">Action</th>
                  <th scope="col" className="px-5 py-3">File or folder</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-[#EEF1EC]">
                {visible.map((item, index) => {
                  const action = ACTIONS[item.action] || {
                    label: item.action,
                    style: "bg-slate-50 text-slate-700 border-slate-200",
                  };

                  return (
                    <tr key={`${item.ts}-${index}`} className="hover:bg-[#F4FAF6]">
                      <td className="whitespace-nowrap px-5 py-3 text-sm tabular-nums text-slate-500">
                        {formatWhen(item.ts)}
                      </td>
                      <td className="px-5 py-3 text-sm">{item.email}</td>
                      <td className="px-5 py-3">
                        <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold ${action.style}`}>
                          {action.label}
                        </span>
                      </td>
                      <td className="max-w-md px-5 py-3 text-sm">
                        <p className="break-all">{item.target}</p>
                        {item.detail && (
                          <p className="mt-0.5 break-all text-xs text-slate-500">→ {item.detail}</p>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {cursor && !loading && (
          <div className="border-t border-[#D9E3DC] bg-[#F4FAF6] px-5 py-3 text-center">
            <button
              type="button"
              onClick={() => load(cursor)}
              disabled={loadingMore}
              className="inline-flex items-center gap-2 text-sm font-semibold text-[#0A6B52] hover:underline disabled:opacity-50"
            >
              {loadingMore && <Loader2 size={15} className="animate-spin" />}
              Load older activity
            </button>
          </div>
        )}
      </section>
    </>
  );
}

export default function Activity() {
  return <PageShell adminOnly>{() => <ActivityPage />}</PageShell>;
}
