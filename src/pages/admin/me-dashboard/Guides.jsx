import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CARD, FONT, PROGRESS } from "./Shared";

/* Each guide has a title, paragraphs (body), an optional bullet list (points), an optional
   colour key (colours or statuses) and an optional link. Guides are in the order people use the pages. */
const GUIDES = [
  {
    title: "Who can do what",
    body: [
      "The administrator and the CEO group can do everything, including approving values, sharing projects, linking strategic indicators and deleting a framework.",
      "Staff work in the programmes they belong to. There they can create frameworks, add and edit results and indicators, report values, correct approved values and set the project status.",
    ],
  },
  {
    title: "How a results framework fits together",
    body: [
      "A framework describes the change a project wants to bring about, in levels. Each level sits under the one above it: impact, then outcome, then output, then activity.",
      "Add the impact first. Then use the green button on a result to add the next level down under it, so every outcome links to an impact, every output to an outcome and every activity to an output.",
      "Indicators measure a result. An indicator says what you will measure, the baseline you start from, and a target for each quarter.",
    ],
    link: ["/me-dashboard/frameworks", "Open Frameworks"],
  },
  {
    title: "The logical framework",
    body: [
      "On the Frameworks page, the Logical framework tab turns your results into a logframe table, from the top level down. For each row you can write the means of verification, the assumptions and the risks.",
      "Indicators linked to a row appear beside it. An indicator measures one result, so linking it to a row moves it from its current row.",
      "Download the logframe as a PDF, a Word file or a CSV. Activities do not need an indicator, because they are tracked by milestones.",
    ],
    link: ["/me-dashboard/frameworks", "Open Frameworks"],
  },
  {
    title: "Adding indicators",
    body: [
      "Add an indicator on the Indicators page, or copy one from the Indicator library and set its baseline and targets as you add it. Use Duplicate to start from a similar indicator.",
      "Choose its format: a count (such as people trained), a percentage, or qualitative only. Set how often it is collected and tick KPI for key indicators.",
      "Targets are set per quarter. Leave a quarter empty if nothing is expected then, and it will not count towards progress.",
    ],
    link: ["/me-dashboard/indicators", "Open Indicators"],
  },
  {
    title: "Entering data",
    body: [
      "Use the Forms page to report every indicator for a quarter in one place. Each row shows the actual over the target as you type.",
      "Enter the actual value and an optional comment, add the gender and other breakdowns and any evidence, then submit.",
      "Gender comes first. When you fill in a breakdown, the actual value fills in from its total. Every breakdown you fill in must add up to the actual value.",
    ],
    link: ["/me-dashboard/forms", "Open Forms"],
  },
  {
    title: "Evidence",
    body: [
      "Attach evidence to each value: upload a file (PDF, JPG, PNG, CSV, Word or Excel, up to 10 MB) or add a link that starts with https. A value can have up to 10 pieces of evidence.",
      "Evidence is saved when you submit the value. Files stay private and open through a short-lived link.",
      "The administrator cannot approve a value that has no evidence.",
    ],
    link: ["/me-dashboard/forms", "Open Forms"],
  },
  {
    title: "Approval",
    body: [
      "Submitted values wait for the administrator, who can open the evidence before deciding. Approving a value locks it and counts it towards progress. Rejecting it sends it back so it can be corrected and submitted again.",
      "Progress, insights, predictions and reports use approved values only.",
    ],
    link: ["/me-dashboard/data", "Open Data table"],
  },
  {
    title: "Correcting an approved value",
    body: [
      "An approved value is locked, but it can be corrected. On the Forms page choose Correct this value, change what is wrong, and write a note for the administrator explaining why. The note is required.",
      "The value then goes back to awaiting approval and leaves the approved results until the administrator decides. If the correction is approved, it replaces the old value, and the old one is kept in the value's history. If it is rejected, the earlier approved value is restored.",
    ],
    link: ["/me-dashboard/forms", "Open Forms"],
  },
  {
    title: "Reading progress colours",
    body: [
      "On the dashboard, progress is the approved actual divided by the target for the period.",
    ],
    colours: true,
    link: ["/me-dashboard", "Open Dashboards"],
  },
  {
    title: "Indicator statuses",
    body: [
      "On the Indicators page, counts add up the approved quarters and are measured against the total of all quarterly targets. Percentages use the latest approved value against the final target.",
      "The status is about pace. It compares the result so far with the targets for the quarters already reported.",
    ],
    statuses: true,
    link: ["/me-dashboard/indicators", "Open Indicators"],
  },
  {
    title: "Predictions and the project outlook",
    body: [
      "A prediction shows where an indicator is heading by its last quarter. It takes the approved results so far and adds each remaining quarterly target at the pace reached so far, which is the average share of target achieved. Percentage indicators are projected against their final target.",
      "The project outlook averages each indicator's projected percentage of target. Each indicator counts up to 100%, so over-achieving on one does not hide a shortfall on another.",
    ],
    points: [
      "It needs at least one approved quarter. With one or two quarters it is an early estimate.",
      "Values awaiting approval, including corrections, are not counted until they are approved.",
      "It assumes higher is better, so it can mislead for an indicator you want to go down, such as a dropout rate.",
      "It is a guide, not a promise.",
    ],
  },
  {
    title: "Insights and the AI assistant",
    body: [
      "The figures, tables, early warnings and cards are calculated by fixed rules from your approved data. They are the source of truth.",
      "Written answers and report drafts come from an AI assistant that is given only those figures. It can still make mistakes, so check what it writes against the tables.",
      "Indicator names, targets and values are sent to the AI service in your organisation's AWS account. Comments and evidence are not sent. Each person has a daily limit on AI questions.",
    ],
  },
  {
    title: "Portfolio (administrator)",
    body: [
      "The Portfolio view brings shared projects together. Share a project, then link its indicators to a strategic indicator. Values are added together across shared projects, so this suits counts such as people reached, not percentages.",
      "Disaggregation types, such as gender or age group, define how results can be broken down. Project outlook ranks every project by where it is heading, with the least likely to meet its targets first.",
    ],
    link: ["/me-dashboard", "Open Dashboards"],
  },
  {
    title: "Reports and exports",
    body: [
      "Smart reports has three report types: a visual report, a table-based report and a programme report. Choose the sections and results to include on the left and check the finished page on the right.",
      "In the visual report you can draft the summary and next steps from the figures or with the AI assistant, add your own analysis and images, and attach an evidence index. Set the title, colour and logo, then print or save as a PDF. Comments and images are kept on the page only, so print before leaving it.",
      "The Results CSV and Logframe CSV buttons download spreadsheets for a donor or for your own analysis.",
    ],
    link: ["/me-dashboard/reports", "Open Smart reports"],
  },
];

const THRESHOLDS = { on: "90% of target or more", risk: "50% to 89%", off: "Below 50%", none: "No approved value yet" };

const STATUS_KEY = [
  ["#067647", "Achieved", "The full target has been met"],
  ["#17B26A", "On track", "90% or more of the target for the quarters reported"],
  ["#CA9A04", "Minor delays", "50% to 89%"],
  ["#D92D20", "Off track", "Below 50%"],
  ["#98A2B3", "No data yet", "A target is set but no value has been approved"],
  ["#D0D5DD", "No target", "No quarterly target has been set"],
];

const matches = (g, q) =>
  [g.title, ...g.body, ...(g.points || [])].some((text) => text.toLowerCase().includes(q));

function MEGuides() {
  const [query, setQuery] = useState("");

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? GUIDES.filter((g) => matches(g, q)) : GUIDES;
  }, [query]);

  return (
    <div className="space-y-5" style={FONT}>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[#101828]">Guides</h1>
          <p className="mt-1 text-sm text-[#667085]">How the M&amp;E pages work, in the order you will use them.</p>
        </div>
        <input
          type="search"
          aria-label="Search the guides"
          placeholder="Search the guides"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded-lg border border-[#D0D5DD] bg-white px-3 py-2 text-sm text-[#101828] outline-none transition placeholder:text-[#98A2B3] focus:border-[#5B3FD0] focus:ring-4 focus:ring-[#5B3FD0]/15 sm:w-64"
        />
      </header>

      {shown.length === 0 && (
        <div className={`${CARD} px-6 py-12 text-center text-sm text-[#98A2B3]`}>No guide matches “{query}”.</div>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        {shown.map((g) => (
          <details key={g.title} open={Boolean(query.trim())} className={`${CARD} group p-5`}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-[#101828] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5B3FD0]">
              {g.title}
              <span aria-hidden="true" className="text-[#98A2B3] transition group-open:rotate-45">+</span>
            </summary>
            <div className="mt-3 space-y-2 text-sm leading-6 text-[#475467]">
              {g.body.map((p) => (
                <p key={p}>{p}</p>
              ))}

              {g.points && (
                <ul className="list-disc space-y-1 pl-5">
                  {g.points.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              )}

              {g.colours && (
                <ul className="space-y-1.5 pt-1">
                  {Object.entries(PROGRESS).map(([k, v]) => (
                    <li key={k} className="flex items-center gap-2">
                      <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[3px]" style={{ backgroundColor: v.color }} />
                      <span className="font-medium text-[#101828]">{v.label}</span>
                      <span className="text-[#667085]">{THRESHOLDS[k]}</span>
                    </li>
                  ))}
                </ul>
              )}

              {g.statuses && (
                <ul className="space-y-1.5 pt-1">
                  {STATUS_KEY.map(([color, label, hint]) => (
                    <li key={label} className="flex items-center gap-2">
                      <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
                      <span className="font-medium text-[#101828]">{label}</span>
                      <span className="text-[#667085]">{hint}</span>
                    </li>
                  ))}
                </ul>
              )}

              {g.link && (
                <Link to={g.link[0]} className="inline-block pt-1 text-sm font-semibold text-[#5B3FD0] hover:underline">
                  {g.link[1]}
                </Link>
              )}
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

export default MEGuides;
