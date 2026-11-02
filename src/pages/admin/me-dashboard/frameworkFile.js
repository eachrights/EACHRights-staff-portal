/* Builds the framework file (format "eachrights-framework", version 1) from what the Frameworks page
   already has loaded, so it can be imported back on the Import page (or into another portal).
   It holds everything shown on the Frameworks page: the details, periods and levels, the results with
   their logframe fields, and the indicators with baselines and targets. Reported values, evidence,
   people, strategic links and the status log are not part of the file. */

export const FRAMEWORK_FORMAT = "eachrights-framework";
const DEFAULT_LEVELS = ["Impact", "Outcome", "Output", "Activity"];

export function buildFrameworkFile(fw, results, indicators) {
  return {
    format: FRAMEWORK_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    framework: {
      name: fw.name || "",
      donor: fw.donor || "",
      area: fw.area || "",
      theme: fw.theme || "",
      focusArea: fw.focusArea || "",
      partner: fw.partner || "",
      region: fw.region || "",
      startDate: fw.startDate || "",
      endDate: fw.endDate || "",
      budget: fw.budget ?? "",
      currency: fw.currency || "",
      description: fw.description || "",
      countries: fw.countries || [],
      team: fw.team || [],
      periods: fw.periods || [],
      levels: fw.levels?.length ? fw.levels : DEFAULT_LEVELS,
    },
    /* A result's ref is its id, and its parent and indicators point to it by that ref */
    results: results.map((r) => ({
      ref: r.id,
      title: r.title,
      level: r.level,
      parentRef: r.parentId || "",
      meansOfVerification: r.meansOfVerification || "",
      assumptions: r.assumptions || "",
      risks: r.risks || "",
    })),
    indicators: indicators.map((i) => ({
      resultRef: i.resultId,
      name: i.name,
      unit: i.unit || "",
      format: i.format || "Numeric",
      frequency: i.frequency || "",
      kpi: Boolean(i.kpi),
      ...(i.baseline !== undefined && i.baseline !== null && i.baseline !== "" ? { baseline: i.baseline } : {}),
      targets: i.targets || {},
      mov: i.mov || "",
      assumptions: i.assumptions || "",
    })),
  };
}

export function downloadJson(fileName, data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export const fileSlug = (name) =>
  String(name || "framework").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "framework";
