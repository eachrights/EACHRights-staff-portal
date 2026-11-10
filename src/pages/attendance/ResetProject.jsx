// Admin-only "Reset project data" panel. Drop <ResetProject /> into any Settings page.
// The list of things that can be wiped comes from the server (GET /me/admin/reset/scopes),
// so adding a module later only means adding it to the Lambda's TARGETS map.
import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { call } from "./attendanceApi"; // adjust the path if you place this file elsewhere

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#D92D20]";

export default function ResetProject() {
  const [scopes, setScopes] = useState(null); // [{ key, label, hint, module, count? }]
  const [other, setOther] = useState([]); // partition prefixes no scope covers
  const [picked, setPicked] = useState([]);
  const [word, setWord] = useState("");
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let on = true;
    call("/me/admin/reset/scopes")
      .then((r) => {
        if (!on) return;
        setScopes(r.scopes || []);
        setOther(r.unclassified || []);
      })
      .catch((e) => on && setMsg({ ok: false, text: e.message }));
    return () => {
      on = false;
    };
  }, []);

  const all = !!scopes?.length && picked.length === scopes.length;
  const needed = all ? "DELETE EVERYTHING" : "RESET";
  const ready = picked.length > 0 && word.trim() === needed;

  const toggle = (k) => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));
  const toggleAll = () => setPicked(all ? [] : scopes.map((s) => s.key));

  // Group by module for display
  const groups = (scopes || []).reduce((m, s) => {
    (m[s.module || "Other"] ||= []).push(s);
    return m;
  }, {});

  async function onReset() {
    if (!ready) return;
    if (!window.confirm("This permanently deletes the selected data for everyone and cannot be undone. Continue?")) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await call("/me/admin/reset", {
        method: "POST",
        body: JSON.stringify({ scopes: picked, confirm: needed }),
      });
      const parts = Object.entries(r?.deleted || {}).map(([k, n]) => `${scopes.find((s) => s.key === k)?.label || k}: ${n}`);
      setMsg({ ok: true, text: `Done. Deleted ${parts.join(", ") || "nothing"}. Figures now start from zero.` });
      setPicked([]);
      setWord("");
      call("/me/admin/reset/scopes").then((x) => {
        setScopes(x.scopes || []);
        setOther(x.unclassified || []);
      }).catch(() => {});
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-6 rounded-xl border border-[#F4C7C3] bg-white shadow-[0_1px_2px_rgba(11,43,36,0.04)]">
      <header className="border-b border-[#F9DAD7] px-5 py-4">
        <h3 className="text-base font-semibold text-[#8A1C14]">Reset project data</h3>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-[#667085]">
          Permanently delete saved data so counts, reports and trackers start from zero. People&apos;s sign-in accounts and
          the portal settings are kept. This cannot be undone, so download any reports you need first.
        </p>
      </header>

      <div className="p-5">
        {msg && (
          <p
            role={msg.ok ? "status" : "alert"}
            className={`mb-4 rounded-lg border-l-4 px-3.5 py-2.5 text-sm ${
              msg.ok ? "border-[#008060] bg-[#E8F5EF] text-[#00553F]" : "border-[#D92D20] bg-[#FEF3F2] text-[#8A1C14]"
            }`}
          >
            {msg.text}
          </p>
        )}

        {!scopes ? (
          !msg && <p className="text-sm text-[#667085]">Loading...</p>
        ) : (
          <>
            <label className="mb-2 flex cursor-pointer items-center gap-3 rounded-lg bg-[#FEF3F2] px-3.5 py-2.5">
              <input type="checkbox" className="h-4 w-4 accent-[#D92D20]" checked={all} onChange={toggleAll} />
              <span className="text-sm font-semibold text-[#8A1C14]">Select everything (whole project)</span>
            </label>

            {Object.entries(groups).map(([module, items]) => (
              <div key={module} className="mt-4">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-[#667085]">{module}</h4>
                <div className="mt-1 divide-y divide-[#EEF1F0] border-y border-[#EEF1F0]">
                  {items.map((s) => (
                    <label key={s.key} className="flex cursor-pointer items-start gap-3 py-3">
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 accent-[#D92D20]"
                        checked={picked.includes(s.key)}
                        onChange={() => toggle(s.key)}
                      />
                      <span className="flex-1">
                        <span className="block text-sm font-medium">{s.label}</span>
                        {s.hint && <span className="mt-0.5 block text-xs text-[#667085]">{s.hint}</span>}
                      </span>
                      {typeof s.count === "number" && (
                        <span className="text-xs tabular-nums text-[#667085]">{s.count} items</span>
                      )}
                    </label>
                  ))}
                </div>
              </div>
            ))}

            {other.length > 0 && (
              <p className="mt-4 rounded-lg bg-[#FFF4E5] px-3.5 py-2.5 text-xs leading-relaxed text-[#8A4B00]">
                Not covered by this reset (it stays): {other.map((o) => `${o.prefix} (${o.count})`).join(", ")}.
              </p>
            )}

            <div className="mt-5 flex flex-wrap items-end gap-3">
              <label className="block text-xs font-medium text-[#475467]">
                <span>
                  Type <strong>{needed}</strong> to confirm
                </span>
                <input
                  className={`mt-1.5 block h-9 w-56 rounded-lg border border-[#D5DBD8] bg-white px-3 text-sm ${FOCUS}`}
                  value={word}
                  onChange={(e) => setWord(e.target.value)}
                  autoComplete="off"
                />
              </label>
              <button
                onClick={onReset}
                disabled={!ready || busy}
                className={`inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-[#D92D20] bg-[#D92D20] px-3.5 text-sm font-medium text-white transition hover:bg-[#B42318] disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`}
              >
                <Trash2 size={16} /> {busy ? "Deleting..." : all ? "Delete everything" : "Delete selected data"}
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
