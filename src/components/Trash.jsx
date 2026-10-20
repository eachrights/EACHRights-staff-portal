import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, RefreshCw, RotateCcw, Trash2 } from "lucide-react";

import PageShell from "../../components/PageShell";
import { apiRequest } from "../../api";
import { departmentNameForKey } from "../../access";

/*
 * Recently deleted (administrators). Lists files whose latest version is a
 * delete marker and restores them. Needs S3 Bucket Versioning to be on.
 */

const formatBytes = (bytes) => {
  if (!bytes) return "0 B";

  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;

  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
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

function TrashPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [restoring, setRestoring] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const data = await apiRequest("/admin/trash");
      setItems(data.items || []);
    } catch (err) {
      setError(err.message || "Unable to load deleted files.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const restore = async (item) => {
    setRestoring(item.key);
    setError("");
    setMessage("");

    try {
      await apiRequest("/admin/trash/restore", {
        method: "POST",
        body: { key: item.key, versionId: item.versionId },
      });

      setMessage(`${item.key.split("/").pop()} was restored to ${departmentNameForKey(item.key)}.`);
      await load();
    } catch (err) {
      setError(err.message || "Unable to restore this file.");
    } finally {
      setRestoring(null);
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-slate-500">Administration</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-[#07523F]">Recently deleted</h1>
          <p className="mt-1.5 max-w-xl text-sm leading-6 text-slate-600">
            Deleted files can be restored to their original folder until they are removed for good.
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

      <section className="mt-6 overflow-hidden rounded-xl border border-[#D9E3DC] bg-white shadow-sm">
        {loading ? (
          <div className="px-5 py-16 text-center">
            <Loader2 size={26} className="mx-auto animate-spin text-[#0A6B52]" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center px-5 py-16 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#D9F0E5] text-[#0A6B52]">
              <Trash2 size={22} />
            </span>
            <h2 className="mt-4 text-sm font-semibold">Nothing has been deleted</h2>
            <p className="mt-1 max-w-sm text-sm leading-6 text-slate-500">
              Deleted files show up here. This needs Bucket Versioning to be turned on in S3.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead className="bg-[#E9F3EC]">
                <tr className="border-b border-[#D9E3DC] text-left text-xs font-semibold text-slate-600">
                  <th scope="col" className="px-5 py-3">File</th>
                  <th scope="col" className="px-5 py-3">Department</th>
                  <th scope="col" className="px-5 py-3">Size</th>
                  <th scope="col" className="px-5 py-3">Deleted</th>
                  <th scope="col" className="px-5 py-3"><span className="sr-only">Restore</span></th>
                </tr>
              </thead>

              <tbody className="divide-y divide-[#EEF1EC]">
                {items.map((item) => (
                  <tr key={`${item.key}-${item.versionId}`} className="hover:bg-[#F4FAF6]">
                    <td className="max-w-xs px-5 py-3 text-sm">
                      <p className="truncate font-medium" title={item.key}>
                        {item.key.split("/").pop()}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-slate-500" title={item.key}>
                        {item.key}
                      </p>
                    </td>
                    <td className="px-5 py-3 text-sm">{departmentNameForKey(item.key)}</td>
                    <td className="whitespace-nowrap px-5 py-3 text-sm tabular-nums text-slate-500">
                      {formatBytes(item.size)}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-sm tabular-nums text-slate-500">
                      {formatWhen(item.deletedAt)}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => restore(item)}
                        disabled={restoring === item.key}
                        className="inline-flex items-center gap-2 rounded-lg border border-[#D9E3DC] bg-white px-3 py-1.5 text-sm font-semibold text-[#0A6B52] hover:bg-[#E3F4EB] disabled:opacity-50"
                      >
                        {restoring === item.key ? (
                          <Loader2 size={15} className="animate-spin" />
                        ) : (
                          <RotateCcw size={15} />
                        )}
                        Restore
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

export default function Trash() {
  return <PageShell adminOnly>{() => <TrashPage />}</PageShell>;
}
