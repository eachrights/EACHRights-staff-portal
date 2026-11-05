import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, CalendarDays, Check, FolderOpen, RefreshCw, Search, Wallet } from "lucide-react";
import { api } from "../../../meApi";
import FundRequests from "./FundRequests";

/* Same tokens as FundRequests / PortfolioView */
const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5B3FD0]";
const FIELD = `rounded-lg border border-[#D0D5DD] bg-white px-3 py-2 text-sm text-[#101828] outline-none transition placeholder:text-[#98A2B3] focus:border-[#5B3FD0] focus:ring-4 focus:ring-[#5B3FD0]/15 motion-reduce:transition-none ${FOCUS}`;
const BTN_SM = `inline-flex items-center gap-2 rounded-lg border border-[#D0D5DD] bg-white px-3.5 py-2 text-sm font-semibold text-[#344054] shadow-sm transition hover:bg-[#F9FAFB] motion-reduce:transition-none ${FOCUS}`;

/*
  Staff entry point for financial requisitions.
  Lists the projects (frameworks) the signed-in person can raise a request
  against, then shows the FundRequests panel for the chosen one.
  What they may do inside the panel is decided by the server
  (canRaise, canEdit, canSubmit, canDecide, ...).

  GET /me/frameworks returns { frameworks: [...] } (the same shape useMEData
  reads in Shared.jsx). A bare array or { items: [...] } is also accepted.
*/
const LIST_PATH = "/me/frameworks";
const SEARCH_FROM = 6; // show the search box when there are more projects than this

/* ---------- helpers ---------- */

const monthYear = (s) => {
  const d = s ? new Date(`${s}T12:00:00Z`) : null;
  return d && !Number.isNaN(+d)
    ? d.toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" })
    : "";
};
const periodOf = (f) => [monthYear(f.startDate), monthYear(f.endDate)].filter(Boolean).join(" to ");
const budgetOf = (f) =>
  f.budget === undefined || f.budget === null || f.budget === ""
    ? ""
    : `${f.currency ? `${f.currency} ` : ""}${Number(f.budget).toLocaleString()}`;
const areaLabel = (slug) =>
  String(slug || "")
    .split("-")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");

/* ---------- small pieces ---------- */

function IconTile({ children, tone = "brand" }) {
  const cls = tone === "brand" ? "bg-[#EDE9FB] text-[#5B3FD0]" : "bg-[#F2F4F7] text-[#667085]";
  return (
    <span aria-hidden="true" className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${cls}`}>
      {children}
    </span>
  );
}

function Meta({ icon: Icon, children }) {
  if (!children) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-[#667085]">
      {Icon && <Icon size={13} aria-hidden="true" />}
      {children}
    </span>
  );
}

function ProjectCard({ project, selected, onSelect }) {
  const budget = budgetOf(project);
  const period = periodOf(project);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`group relative flex h-full flex-col rounded-2xl border bg-white p-4 text-left shadow-sm transition motion-reduce:transition-none ${FOCUS} ${
        selected
          ? "border-[#5B3FD0] ring-4 ring-[#5B3FD0]/10"
          : "border-[#E4E7EC] hover:border-[#B9A9F0] hover:shadow-md"
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full border transition motion-reduce:transition-none ${
          selected ? "border-[#5B3FD0] bg-[#5B3FD0] text-white" : "border-[#D0D5DD] bg-white text-transparent"
        }`}
      >
        <Check size={12} strokeWidth={3} />
      </span>
      <IconTile tone={selected ? "brand" : "muted"}>
        <FolderOpen size={20} />
      </IconTile>
      <p className="mt-3 line-clamp-2 pr-6 text-sm font-semibold text-[#101828]">{project.name}</p>
      <p className="mt-0.5 text-xs text-[#667085]">{project.donor || "No donor recorded"}</p>
      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-3">
        <Meta icon={CalendarDays}>{period}</Meta>
        {budget && <Meta icon={Wallet}>{budget}</Meta>}
      </div>
    </button>
  );
}

function SkeletonCards() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="animate-pulse rounded-2xl border border-[#E4E7EC] bg-white p-4 motion-reduce:animate-none">
          <div className="h-10 w-10 rounded-xl bg-[#F2F4F7]" />
          <div className="mt-4 h-3.5 w-2/3 rounded bg-[#F2F4F7]" />
          <div className="mt-2 h-3 w-1/3 rounded bg-[#F2F4F7]" />
          <div className="mt-5 h-3 w-1/2 rounded bg-[#F2F4F7]" />
        </div>
      ))}
    </div>
  );
}

function ErrorPanel({ message, onRetry }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl border border-[#FDA29B] bg-[#FEF3F2] p-4">
      <AlertCircle size={20} className="shrink-0 text-[#B42318]" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-[#B42318]">Could not load your projects</p>
        <p className="text-sm text-[#B42318]/90">{message}</p>
      </div>
      <button type="button" className={BTN_SM} onClick={onRetry}>
        <RefreshCw size={15} aria-hidden="true" /> Try again
      </button>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-[#D0D5DD] bg-white px-6 py-14 text-center">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#F2F4F7] text-[#667085]">
        <FolderOpen size={22} aria-hidden="true" />
      </span>
      <p className="mt-4 text-sm font-semibold text-[#101828]">No projects yet</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-[#667085]">
        You can raise a requisition once you have been given access to a project. Ask the administrator to add you to
        your programme.
      </p>
    </div>
  );
}

/* A single project: no choice to make, so show it as a summary bar */
function ProjectSummary({ project }) {
  const budget = budgetOf(project);
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-[#E4E7EC] bg-white p-4 shadow-sm">
      <IconTile>
        <FolderOpen size={20} />
      </IconTile>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-[#101828]">{project.name}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          <Meta>{project.donor}</Meta>
          <Meta>{areaLabel(project.area)}</Meta>
          <Meta icon={CalendarDays}>{periodOf(project)}</Meta>
        </div>
      </div>
      {budget && (
        <div className="text-right">
          <p className="text-xs font-medium text-[#667085]">Project budget</p>
          <p className="text-base font-semibold tabular-nums text-[#101828]">{budget}</p>
        </div>
      )}
    </div>
  );
}

/* ---------- page ---------- */

function MyRequisitions() {
  const [frameworks, setFrameworks] = useState(null);
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const load = useCallback(() => {
    let cancelled = false;
    setError("");
    setFrameworks(null);
    api(LIST_PATH)
      .then((result) => {
        if (cancelled) return;
        const items = Array.isArray(result) ? result : result?.frameworks || result?.items || [];
        setFrameworks(items);
        if (items.length === 1) setSelectedId(String(items[0].id));
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => load(), [load]);

  const selected = frameworks?.find((f) => String(f.id) === selectedId) || null;

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!frameworks) return [];
    return needle
      ? frameworks.filter((f) => `${f.name} ${f.donor || ""} ${f.area || ""}`.toLowerCase().includes(needle))
      : frameworks;
  }, [frameworks, search]);

  const many = (frameworks?.length || 0) > 1;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Header */}
      <header className="flex flex-wrap items-start gap-4">
        <IconTile>
          <Wallet size={20} />
        </IconTile>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#5B3FD0]">Finance</p>
          <h1 className="text-2xl font-semibold text-[#101828]">Financial requisitions</h1>
          <p className="mt-1 max-w-2xl text-sm text-[#667085]">
            Raise a request for project funds and follow it from draft to approval and payment.
          </p>
        </div>
      </header>

      {/* Project choice */}
      <section aria-labelledby="req-project-heading" className="space-y-3">
        {error ? (
          <ErrorPanel message={error} onRetry={load} />
        ) : !frameworks ? (
          <>
            <h2 id="req-project-heading" className="text-sm font-semibold text-[#101828]">
              Projects
            </h2>
            <SkeletonCards />
            <p className="sr-only" role="status">
              Loading projects.
            </p>
          </>
        ) : frameworks.length === 0 ? (
          <EmptyState />
        ) : many ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 id="req-project-heading" className="text-sm font-semibold text-[#101828]">
                  Choose a project
                </h2>
                <p className="text-xs text-[#667085]">
                  {frameworks.length} projects you can raise a requisition against
                </p>
              </div>
              {frameworks.length > SEARCH_FROM && (
                <div className="relative">
                  <Search
                    size={15}
                    aria-hidden="true"
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#98A2B3]"
                  />
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search projects"
                    aria-label="Search projects"
                    className={`${FIELD} w-64 pl-9`}
                  />
                </div>
              )}
            </div>

            {shown.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-[#D0D5DD] bg-white px-4 py-8 text-center text-sm text-[#667085]">
                No projects match &ldquo;{search.trim()}&rdquo;.
              </p>
            ) : (
              <div
                role="radiogroup"
                aria-labelledby="req-project-heading"
                className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
              >
                {shown.map((f) => (
                  <ProjectCard
                    key={f.id}
                    project={f}
                    selected={String(f.id) === selectedId}
                    onSelect={() => setSelectedId(String(f.id))}
                  />
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <h2 id="req-project-heading" className="sr-only">
              Project
            </h2>
            <ProjectSummary project={frameworks[0]} />
          </>
        )}
      </section>

      {/* Requisitions for the chosen project */}
      {selected ? (
        <section aria-label={`Requisitions for ${selected.name}`}>
          <FundRequests key={selected.id} framework={selected} />
        </section>
      ) : (
        many && (
          <div className="rounded-2xl border border-dashed border-[#D0D5DD] bg-white px-6 py-10 text-center">
            <p className="text-sm font-semibold text-[#101828]">Select a project to continue</p>
            <p className="mt-1 text-sm text-[#667085]">
              Its budget, your requests and their status will appear here.
            </p>
          </div>
        )
      )}
    </div>
  );
}

export default MyRequisitions;
