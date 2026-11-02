import { useState } from "react";
import { api } from "../../../meApi";
import { BTN, CARD, Page, PageHead } from "./Shared";

/* Import a framework, or all the details of one project, from a JSON file.
   The file is checked here, then sent to POST /me/frameworks/import. If a framework with the
   same name already exists, it is updated instead of duplicated: new periods, levels, results and
   indicators are added, matching ones are changed, and nothing is removed. Reported values are
   never touched. The server checks everything again before saving anything.

   File format (version 1): the framework's details and periods, its results and its indicators
   with targets. Reported values are not part of an import. Results and indicators point to each
   other by a "ref" you choose (any short text), so the file does not need real ids. */

const FORMAT = "eachrights-framework";

const TEMPLATE = {
  format: FORMAT,
  version: 1,
  framework: {
    name: "Example project",
    donor: "",
    area: "",
    theme: "",
    focusArea: "",
    partner: "",
    region: "",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    budget: "",
    currency: "",
    description: "",
    countries: [],
    team: [],
    periods: ["Q1 2026", "Q2 2026", "Q3 2026", "Q4 2026"],
    levels: ["Impact", "Outcome", "Output", "Activity"],
  },
  results: [
    { ref: "r1", title: "Example outcome", level: 1, parentRef: "", meansOfVerification: "", assumptions: "", risks: "" },
  ],
  indicators: [
    {
      resultRef: "r1",
      name: "Number of people trained",
      unit: "people",
      format: "Numeric",
      frequency: "Quarterly",
      kpi: false,
      baseline: 0,
      targets: { "Q1 2026": 20, "Q2 2026": 20 },
      mov: "",
      assumptions: "",
    },
  ],
};

/* Checks the shape only. The server must check everything again (access, periods, levels, parents). */
function check(data) {
  if (!data || typeof data !== "object") return "This is not a framework file.";
  if (data.format !== FORMAT) return `Expected a file with format "${FORMAT}".`;
  if (data.version !== 1) return "This file version is not supported.";
  if (!data.framework?.name) return "The framework needs a name.";
  if (!data.framework?.area) return "The framework needs an area (the programme it belongs to).";
  if (!Array.isArray(data.framework.periods) || data.framework.periods.length === 0) return "The framework needs at least one period.";
  if (!Array.isArray(data.results)) return "The file needs a list of results.";
  if (!Array.isArray(data.indicators)) return "The file needs a list of indicators.";
  const refs = new Set(data.results.map((r) => r.ref));
  if (refs.size !== data.results.length) return "Result refs must be unique.";
  const bad = data.indicators.find((i) => !refs.has(i.resultRef));
  if (bad) return `Indicator "${bad.name}" points to a result that is not in the file.`;
  return "";
}

function ImportFramework() {
  const [parsed, setParsed] = useState(null);
  const [fileName, setFileName] = useState("");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(TEMPLATE, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "framework-template.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const readFile = async (file) => {
    setParsed(null);
    setProblem("");
    setDone(null);
    setFileName(file?.name || "");
    if (!file) return;
    if (file.size > 1024 * 1024) return setProblem("The file must be 1 MB or smaller.");
    try {
      const data = JSON.parse(await file.text());
      const err = check(data);
      if (err) setProblem(err);
      else setParsed(data);
    } catch {
      setProblem("The file is not valid JSON.");
    }
  };

  const importNow = async () => {
    setBusy(true);
    setProblem("");
    try {
      const out = await api("/me/frameworks/import", { method: "POST", body: parsed });
      setDone(out);
      setParsed(null);
    } catch (err) {
      setProblem(err.message || "The import failed. Nothing was saved.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page>
      <PageHead title="Import a framework" subtitle="Bring in a framework, or all the details of a project, from a file." />

      <div className={`${CARD} space-y-4 p-5`}>
        <p className="rounded-lg border border-[#F3D18A] bg-[#FFFAEB] px-4 py-3 text-sm text-[#7A5C00]" role="status">
          If a framework with the same name already exists, it is updated: new items are added and matching ones are changed. Nothing is deleted, and reported values are never touched.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={BTN} onClick={downloadTemplate}>
            Download template
          </button>
          <label className="inline-flex cursor-pointer items-center rounded-lg border border-[#D0D5DD] bg-white px-3.5 py-2 text-sm font-semibold text-[#344054] hover:bg-[#F4F5F7] focus-within:ring-2 focus-within:ring-[#00664E]">
            Choose a file
            <input
              type="file"
              accept=".json,application/json"
              className="sr-only"
              aria-label="Choose a framework file to import"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                readFile(file);
              }}
            />
          </label>
          {fileName && <span className="text-sm text-[#667085]">{fileName}</span>}
        </div>

        {problem && (
          <p className="rounded-lg border border-[#FDA29B] bg-[#FEF3F2] px-4 py-3 text-sm text-[#B42318]" role="alert">
            {problem}
          </p>
        )}

        {parsed && (
          <div className="rounded-lg bg-[#F9FAFB] p-4 text-sm text-[#344054]">
            <p className="font-semibold text-[#101828]">{parsed.framework.name}</p>
            <p className="mt-1">
              {parsed.framework.periods.length} periods, {parsed.results.length} results, {parsed.indicators.length} indicators.
            </p>
            <button type="button" className={`${BTN} mt-3`} disabled={busy} onClick={importNow}>
              {busy ? "Importing" : "Import"}
            </button>
          </div>
        )}

        {done && (
          <p className="rounded-lg border border-[#ABEFC6] bg-[#ECFDF3] px-4 py-3 text-sm text-[#067647]" role="status">
            {done.updated ? "Updated" : "Created"} {done.framework.name}. Results: {done.results.created} added, {done.results.updated} updated.
            Indicators: {done.indicators.created} added, {done.indicators.updated} updated.
          </p>
        )}

        <p className="text-xs text-[#98A2B3]">
          The file holds everything on the Frameworks page: the details, periods and levels, the results with their means of verification, assumptions and risks, and the indicators with baselines, targets, format, frequency and KPI flag. A file made with Export on the Frameworks page can be imported back here, or into another portal. Reported values, evidence, people and the status log are not included.
        </p>
      </div>
    </Page>
  );
}

export default ImportFramework;
