import { Link } from "react-router-dom";
import { CARD, FONT, PROGRESS } from "./Shared";

const GUIDES = [
  {
    title: "How a results framework fits together",
    body: [
      "A framework describes the change a project wants to bring about, in levels. Each level sits under the one above it, usually goal, then outcome, then output.",
      "Every result can have indicators. An indicator says what you will measure, the baseline you start from, and a target for each reporting period.",
    ],
    link: ["/me-dashboard/frameworks", "Open Frameworks"],
  },
  {
    title: "Adding indicators",
    body: [
      "Add an indicator on the Indicators page, or copy one from the Indicator library and set its baseline and targets as you add it.",
      "Targets are set per period. Leave a period empty if nothing is expected then, and it will not count towards progress.",
    ],
    link: ["/me-dashboard/library", "Open Indicator library"],
  },
  {
    title: "Entering data",
    body: [
      "Use the Forms page to report every indicator for a period in one place. Enter the actual value and an optional comment, then submit.",
      "Only the administrator and the department that owns the framework can enter values. Approved values are locked.",
    ],
    link: ["/me-dashboard/forms", "Open Forms"],
  },
  {
    title: "Approval",
    body: [
      "Submitted values wait for the administrator. Approving a value locks it and counts it towards progress. Rejecting it sends it back so it can be corrected and submitted again.",
      "Progress, insights, predictions and reports use approved values only.",
    ],
    link: ["/me-dashboard/data", "Open Data table"],
  },
  {
    title: "Reading progress colours",
    body: [
      "Progress is the approved actual divided by the target for the period.",
    ],
    colours: true,
    link: ["/me-dashboard", "Open Dashboards"],
  },
  {
    title: "Reports and exports",
    body: [
      "Smart reports builds a period report you can print or save as a PDF. Choose which sections to include.",
      "The Results table and Logframe buttons download CSV files for use in a spreadsheet or to send to a donor.",
    ],
    link: ["/me-dashboard/reports", "Open Smart reports"],
  },
];

const THRESHOLDS = { on: "90% of target or more", risk: "50% to 89%", off: "Below 50%", none: "No approved value yet" };

function MEGuides() {
  return (
    <div className="space-y-5" style={FONT}>
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-[#101828]">Guides</h1>
        <p className="mt-1 text-sm text-[#667085]">How the M&amp;E pages work, in the order you will use them.</p>
      </header>

      <div className="grid gap-3 lg:grid-cols-2">
        {GUIDES.map((g) => (
          <details key={g.title} className={`${CARD} group p-5`}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-[#101828] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5B3FD0]">
              {g.title}
              <span aria-hidden="true" className="text-[#98A2B3] transition group-open:rotate-45">+</span>
            </summary>
            <div className="mt-3 space-y-2 text-sm leading-6 text-[#475467]">
              {g.body.map((p) => (
                <p key={p}>{p}</p>
              ))}
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
              <Link to={g.link[0]} className="inline-block pt-1 text-sm font-semibold text-[#5B3FD0] hover:underline">
                {g.link[1]}
              </Link>
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

export default MEGuides;
