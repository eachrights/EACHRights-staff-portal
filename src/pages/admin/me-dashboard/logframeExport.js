/*
 * Logframe exports (PDF and Word). Libraries load on demand so they stay out of the main bundle.
 * Install once:  npm install jspdf jspdf-autotable docx
 */

const TERM = { Impact: "Goal", Outcome: "Outcome", Output: "Output", Activity: "Activity" };
const term = (name) => TERM[name] || name;

const isSet = (v) => v !== undefined && v !== null && v !== "" && Number.isFinite(Number(v));
const fmtNum = (n) => (isSet(n) ? Number(n).toLocaleString("en-GB") : "-");
const fmtDay = (s) => {
  const t = s ? new Date(s).getTime() : NaN;
  return Number.isNaN(t) ? "" : new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};

const fileBase = (framework) => `${(framework?.name || "logframe").replace(/[^\w-]+/g, "-")}-logframe`;

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function indicatorLine(indicator, periods) {
  const targets = indicator.targets && typeof indicator.targets === "object" ? indicator.targets : {};
  const set = periods.filter((p) => isSet(targets[p]));
  const additive = indicator.unit !== "%";
  const target =
    set.length === 0
      ? "targets not set"
      : additive
        ? `target total ${fmtNum(set.reduce((sum, p) => sum + Number(targets[p]), 0))}`
        : `${set.length} of ${periods.length} targets set`;
  return {
    name: `${indicator.name}${indicator.unit ? ` (${indicator.unit})` : ""}`,
    detail: `Baseline ${fmtNum(indicator.baseline)}; ${target}`,
  };
}

/* One plain object per logframe row, shared by both exports. */
export function buildRows({ ordered, levels, byResult, periods }) {
  const fromIndicators = (r, field) =>
    (byResult.get(r.id) || []).map((i) => String(i[field] || "").trim()).filter(Boolean).join("\n");
  return ordered.map((r) => ({
    depth: r.depth || 0,
    level: term(levels[r.level] ?? `Level ${r.level + 1}`),
    title: r.title,
    indicators: (byResult.get(r.id) || []).map((i) => indicatorLine(i, periods)),
    means: r.meansOfVerification || fromIndicators(r, "mov"),
    assumptions: r.assumptions || fromIndicators(r, "assumptions"),
    risks: r.risks || "",
  }));
}

function metaLine(framework) {
  const dates =
    framework.startDate || framework.endDate
      ? `${fmtDay(framework.startDate) || "Not set"} to ${fmtDay(framework.endDate) || "Not set"}`
      : "";
  return [
    framework.donor ? `Donor: ${framework.donor}` : "",
    dates ? `Dates: ${dates}` : "",
    framework.countries?.length ? `Countries: ${framework.countries.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("   |   ");
}

const HEAD = ["Narrative summary", "Indicators", "Means of verification", "Assumptions and risks"];

/* ---------- PDF ---------- */

export async function exportLogframePdf({ framework, rows }) {
  const [{ jsPDF }, autoTableModule] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const autoTable = autoTableModule.default || autoTableModule.autoTable;

  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const margin = 40;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(`${framework.name}: Logical framework`, margin, 42);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(102, 112, 133);
  const meta = metaLine(framework);
  if (meta) doc.text(meta, margin, 60);
  doc.setTextColor(0, 0, 0);

  const body = rows.map((row) => [
    `${row.level}\n${row.title}`,
    row.indicators.length
      ? row.indicators.map((i) => `${i.name}\n${i.detail}`).join("\n\n")
      : row.level === "Activity"
        ? "Not required"
        : "No indicators linked",
    row.means || "Not set",
    [row.assumptions && `Assumptions: ${row.assumptions}`, row.risks && `Risks: ${row.risks}`].filter(Boolean).join("\n\n") || "Not set",
  ]);

  autoTable(doc, {
    startY: meta ? 74 : 60,
    head: [HEAD],
    body,
    margin: { left: margin, right: margin, bottom: 40 },
    styles: { font: "helvetica", fontSize: 8, cellPadding: 5, valign: "top", overflow: "linebreak", lineColor: [229, 231, 235], lineWidth: 0.5 },
    headStyles: { fillColor: [91, 63, 208], textColor: 255, fontStyle: "bold" },
    columnStyles: { 0: { cellWidth: 200 }, 1: { cellWidth: 200 }, 2: { cellWidth: 150 } },
    /* Indent each row's narrative by its depth in the results hierarchy */
    didParseCell: (hook) => {
      if (hook.section === "body" && hook.column.index === 0) {
        hook.cell.styles.cellPadding = { top: 5, right: 5, bottom: 5, left: 5 + rows[hook.row.index].depth * 10 };
        hook.cell.styles.fontStyle = "normal";
      }
    },
    didDrawPage: () => {
      const page = doc.internal.getNumberOfPages();
      doc.setFontSize(8);
      doc.setTextColor(152, 162, 179);
      doc.text(`Page ${page}`, doc.internal.pageSize.getWidth() - margin, doc.internal.pageSize.getHeight() - 20, { align: "right" });
      doc.setTextColor(0, 0, 0);
    },
  });

  doc.save(`${fileBase(framework)}.pdf`);
}

/* ---------- Word ---------- */

export async function exportLogframeDocx({ framework, rows }) {
  const {
    AlignmentType, BorderStyle, Document, HeadingLevel, Packer, PageOrientation, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType,
  } = await import("docx");

  /* A4 landscape, 0.5 inch margins: 15,398 twips of usable width */
  const WIDTHS = [4400, 4200, 3000, 3798];
  const border = { style: BorderStyle.SINGLE, size: 4, color: "D0D5DD" };
  const borders = { top: border, bottom: border, left: border, right: border };

  const text = (value, opts = {}) => new TextRun({ text: value, size: 18, font: "Arial", ...opts });
  const para = (children, opts = {}) => new Paragraph({ spacing: { after: 80 }, ...opts, children });

  const cell = (children, width, extra = {}) =>
    new TableCell({
      borders,
      width: { size: width, type: WidthType.DXA },
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      children,
      ...extra,
    });

  const headerRow = new TableRow({
    tableHeader: true,
    children: HEAD.map((label, i) =>
      cell([para([text(label, { bold: true, color: "FFFFFF" })])], WIDTHS[i], {
        shading: { type: ShadingType.CLEAR, fill: "5B3FD0", color: "auto" },
      })
    ),
  });

  const muted = (value) => para([text(value, { color: "98A2B3", italics: true })]);

  const bodyRows = rows.map(
    (row) =>
      new TableRow({
        cantSplit: true,
        children: [
          cell(
            [
              para([text(row.level, { bold: true, color: "667085", size: 16 })], { indent: { left: row.depth * 200 }, spacing: { after: 20 } }),
              para([text(row.title)], { indent: { left: row.depth * 200 } }),
            ],
            WIDTHS[0]
          ),
          cell(
            row.indicators.length
              ? row.indicators.flatMap((i) => [
                  para([text(i.name, { bold: true })], { spacing: { after: 20 } }),
                  para([text(i.detail, { color: "667085", size: 16 })]),
                ])
              : [muted(row.level === "Activity" ? "Not required" : "No indicators linked")],
            WIDTHS[1]
          ),
          cell([row.means ? para([text(row.means)]) : muted("Not set")], WIDTHS[2]),
          cell(
            row.assumptions || row.risks
              ? [
                  ...(row.assumptions
                    ? [para([text("Assumptions: ", { bold: true }), text(row.assumptions)])]
                    : []),
                  ...(row.risks ? [para([text("Risks: ", { bold: true }), text(row.risks)])] : []),
                ]
              : [muted("Not set")],
            WIDTHS[3]
          ),
        ],
      })
  );

  const meta = metaLine(framework);

  const doc = new Document({
    styles: { default: { document: { run: { font: "Arial", size: 18 } } } },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838, orientation: PageOrientation.LANDSCAPE },
            margin: { top: 720, right: 720, bottom: 720, left: 720 },
          },
        },
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            spacing: { after: 80 },
            children: [new TextRun({ text: `${framework.name}: Logical framework`, bold: true, size: 32, font: "Arial" })],
          }),
          ...(meta ? [new Paragraph({ spacing: { after: 200 }, alignment: AlignmentType.LEFT, children: [text(meta, { color: "667085" })] })] : []),
          new Table({
            width: { size: WIDTHS.reduce((a, b) => a + b, 0), type: WidthType.DXA },
            columnWidths: WIDTHS,
            rows: [headerRow, ...bodyRows],
          }),
        ],
      },
    ],
  });

  download(await Packer.toBlob(doc), `${fileBase(framework)}.docx`);
}
