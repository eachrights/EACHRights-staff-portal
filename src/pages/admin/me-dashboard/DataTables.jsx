import { useEffect, useState } from "react";
import { api } from "../../../meApi";
import { BTN, CARD, ErrorBar, FIELD, Page, PageHead, useMEData } from "./Shared";
import { parseCsv } from "./csv";

function DataTables() {
  const { data, busy, error, run } = useMEData();
  const [tables, setTables] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [importError, setImportError] = useState("");

  const refresh = async () => setTables((await api("/me/tables")).tables);

  useEffect(() => {
    run(refresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Always read the open table from the latest list, so links shown are never stale
  const open = tables.find((t) => t.id === openId) ?? null;

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImportError("");
    const [columns, ...rows] = parseCsv(await file.text());
    if (!columns || rows.length === 0) {
      setImportError("That file has no data rows.");
      return;
    }
    run(async () => {
      const created = await api("/me/tables/import", {
        method: "POST",
        body: { name: file.name.replace(/\.csv$/i, ""), columns, rows },
      });
      await refresh();
      if (created?.id) setOpenId(created.id);
    });
  };

  const link = (table, column, indicatorId) =>
    run(async () => {
      const links = { ...table.links, [column]: indicatorId || undefined };
      await api(`/me/tables/${table.id}/links`, { method: "PUT", body: { links } });
      await refresh();
    });

  const indicators = data?.indicators ?? [];

  return (
    <Page>
      <PageHead title="Data tables" subtitle="Import data, review it, and link columns to indicators.">
        <label className={`${BTN} cursor-pointer`}>
          Import CSV
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={onFile} />
        </label>
      </PageHead>

      <ErrorBar error={error || importError} />

      {tables.length === 0 && (
        <div className={`${CARD} p-10 text-center text-sm text-[#667085]`}>
          No tables yet. Import a CSV file to get started.
        </div>
      )}

      <ul className="grid gap-3 md:grid-cols-3">
        {tables.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => setOpenId(t.id)}
              aria-pressed={t.id === openId}
              className={`${CARD} w-full p-4 text-left`}
            >
              <p className="text-sm font-semibold text-[#101828]">{t.name}</p>
              <p className="text-xs text-[#667085]">{t.rows.length} rows · {t.source}</p>
            </button>
          </li>
        ))}
      </ul>

      {open && (
        <section className={`${CARD} overflow-x-auto p-5`} aria-label={open.name}>
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                {open.columns.map((c) => (
                  <th key={c} className="pb-2 pr-4 align-top">
                    <div>{c}</div>
                    <select
                      className={FIELD}
                      aria-label={`Link ${c} to indicator`}
                      disabled={busy}
                      value={open.links?.[c] ?? ""}
                      onChange={(e) => link(open, c, e.target.value)}
                    >
                      <option value="">Not linked</option>
                      {indicators.map((i) => (
                        <option key={i.id} value={i.id}>{i.name}</option>
                      ))}
                    </select>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {open.rows.map((r, i) => (
                <tr key={i} className="border-t border-[#F2F4F7]">
                  {r.map((v, j) => (
                    <td key={j} className="py-1.5 pr-4">{v}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </Page>
  );
}

export default DataTables;
