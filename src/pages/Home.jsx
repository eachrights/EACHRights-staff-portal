import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  ClipboardList,
  FileBarChart,
  FolderOpen,
  ShieldCheck,
  Table2,
  Target,
  UploadCloud,
} from "lucide-react";
import { getAccess } from "../access";
import { api } from "../meApi";

/*
 * Landing page shown right after sign-in.
 * Two places to start: the M&E dashboard or the files. Staff open their own
 * department files (/dashboard); the administrator opens all files (/admin).
 */
const DISPLAY = { fontFamily: '"Fraunces", Georgia, serif' };

const ACCENT = {
  purple: {
    icon: "bg-[#EDE9FB] text-[#5B3FD0]",
    preview: "bg-[#F5F2FD]",
    hover: "hover:border-[#5B3FD0]/50",
    link: "text-[#5B3FD0]",
    ring: "focus-visible:outline-[#5B3FD0]",
    pill: "bg-[#EDE9FB] text-[#5B3FD0]",
  },
  green: {
    icon: "bg-[#E3F3EC] text-[#00664E]",
    preview: "bg-[#EEF7F3]",
    hover: "hover:border-[#008060]/50",
    link: "text-[#00664E]",
    ring: "focus-visible:outline-[#008060]",
    pill: "bg-[#E3F3EC] text-[#00664E]",
  },
};

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function displayName(access) {
  if (access.isAdmin) return "Administrator";
  const local = (access.email || "").split("@")[0];
  if (!local) return "";
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

/* Small decorative preview: bars and a trend line, for the M&E card */
function ChartPreview() {
  const bars = [38, 56, 44, 72, 62, 88];
  return (
    <svg viewBox="0 0 240 90" className="h-full w-full" aria-hidden="true">
      {[20, 45, 70].map((y) => (
        <line key={y} x1="8" x2="232" y1={y} y2={y} stroke="#E4DDF8" strokeWidth="1" />
      ))}
      {bars.map((h, i) => (
        <rect key={i} x={16 + i * 37} y={84 - h * 0.85} width="22" height={h * 0.85} rx="4" fill="#5B3FD0" opacity={0.35 + i * 0.13} />
      ))}
      <polyline
        points="27,58 64,46 101,52 138,30 175,36 212,14"
        fill="none"
        stroke="#1F7A5C"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="212" cy="14" r="4" fill="#fff" stroke="#1F7A5C" strokeWidth="2.5" />
    </svg>
  );
}

/* Small decorative preview: file rows, for the files card */
function FilesPreview() {
  const rows = [
    { w: 120, c: "#008060" },
    { w: 150, c: "#7FBFA9" },
    { w: 96, c: "#7FBFA9" },
  ];
  return (
    <svg viewBox="0 0 240 90" className="h-full w-full" aria-hidden="true">
      {rows.map((r, i) => (
        <g key={i} transform={`translate(16 ${8 + i * 27})`}>
          <rect width="208" height="22" rx="6" fill="#fff" stroke="#D5EBE2" />
          <rect x="8" y="5" width="12" height="12" rx="3" fill={r.c} />
          <rect x="28" y="8" width={r.w} height="6" rx="3" fill="#CFE6DC" />
          <rect x="176" y="8" width="24" height="6" rx="3" fill="#E3F3EC" />
        </g>
      ))}
    </svg>
  );
}

function StartCard({ to, icon: Icon, title, text, meta, accent, preview }) {
  const a = ACCENT[accent];
  return (
    <Link
      to={to}
      className={`group flex h-full flex-col overflow-hidden rounded-2xl border border-[#E6ECE9] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition hover:-translate-y-0.5 hover:shadow-lg motion-reduce:transition-none motion-reduce:hover:translate-y-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${a.hover} ${a.ring}`}
    >
      <div className={`h-28 px-4 pt-3 ${a.preview}`}>{preview}</div>

      <div className="flex flex-1 flex-col p-6">
        <div className="flex items-center gap-3">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${a.icon}`}>
            <Icon size={20} aria-hidden="true" />
          </span>
          <h2 className="text-lg font-semibold tracking-tight text-[#0B2B24]">{title}</h2>
        </div>

        <p className="mt-3 text-sm leading-6 text-[#667085]">{text}</p>

        <div className="mt-auto flex items-center justify-between gap-3 pt-6">
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${a.pill}`}>{meta}</span>
          <span className={`inline-flex items-center gap-1.5 text-sm font-semibold ${a.link}`}>
            Open
            <ArrowRight size={16} className="transition group-hover:translate-x-1 motion-reduce:transition-none" aria-hidden="true" />
          </span>
        </div>
      </div>
    </Link>
  );
}

function QuickTile({ to, icon: Icon, label, text }) {
  return (
    <Link
      to={to}
      className="group flex items-start gap-3 rounded-xl border border-[#E6ECE9] bg-white p-4 transition hover:border-[#008060]/40 hover:bg-[#F8FBFA] motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#008060]"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#F3F6F5] text-[#475467] transition group-hover:bg-[#E3F3EC] group-hover:text-[#00664E] motion-reduce:transition-none">
        <Icon size={18} aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-[#0B2B24]">{label}</span>
        <span className="mt-0.5 block text-xs leading-5 text-[#667085]">{text}</span>
      </span>
    </Link>
  );
}

function Home() {
  const [access, setAccess] = useState({ isAdmin: false, email: "" });
  const [frameworkCount, setFrameworkCount] = useState(null);

  useEffect(() => {
    let mounted = true;

    getAccess()
      .then((result) => mounted && setAccess(result))
      .catch(() => {});

    // A quiet count for the M&E card. If it fails, the card simply shows no figure.
    api("/me/frameworks")
      .then((result) => mounted && setFrameworkCount(result.frameworks.length))
      .catch(() => {});

    return () => {
      mounted = false;
    };
  }, []);

  const name = displayName(access);
  const today = new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const meMeta =
    frameworkCount === null
      ? "Results, indicators and reports"
      : frameworkCount === 0
      ? "No frameworks yet"
      : `${frameworkCount} ${frameworkCount === 1 ? "framework" : "frameworks"} available`;

  const quickLinks = [
    { to: "/me-dashboard/forms", label: "Enter data", text: "Report values for your indicators", icon: ClipboardList },
    { to: "/me-dashboard/data", label: "Data table", text: "Browse and check submitted data", icon: Table2 },
    { to: "/me-dashboard/reports", label: "Reports", text: "Generate and download reports", icon: FileBarChart },
    ...(access.isAdmin
      ? [{ to: "/admin/upload", label: "Upload files", text: "Add documents to the cloud storage", icon: UploadCloud }]
      : []),
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-1 py-4 sm:py-8">
      {/* Welcome banner */}
      <header className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#0B2B24] via-[#0F4A3A] to-[#00664E] px-6 py-8 text-white sm:px-10 sm:py-10">
        <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-white/5" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-24 right-24 h-56 w-56 rounded-full bg-white/5" />

        <p className="relative inline-block rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white/85">{today}</p>
        <h1 className="relative mt-4 text-3xl font-semibold tracking-tight sm:text-4xl" style={DISPLAY}>
          {greeting()}
          {name ? `, ${name}` : ""}
        </h1>
        <p className="relative mt-2 max-w-xl text-base leading-7 text-white/80">
          Welcome to the EACHRights Staff Portal. Track results in the M&amp;E dashboard or work with your files, all in one place.
        </p>
      </header>

      <section aria-label="Start here">
        <h2 className="mb-3 text-sm font-semibold text-[#344054]">Where would you like to start?</h2>
        <div className="grid gap-5 md:grid-cols-2">
          <StartCard
            to="/me-dashboard"
            icon={Target}
            accent="purple"
            title="M&E Dashboard"
            text="Track progress against targets, enter and approve results, and report on your frameworks."
            meta={meMeta}
            preview={<ChartPreview />}
          />
          <StartCard
            to={access.isAdmin ? "/admin" : "/dashboard"}
            icon={FolderOpen}
            accent="green"
            title={access.isAdmin ? "All files" : "My department files"}
            text="Open programme, department and finance documents. Upload, search and download securely."
            meta="Encrypted, authorised staff only"
            preview={<FilesPreview />}
          />
        </div>
      </section>

      <section aria-label="Quick links">
        <h2 className="mb-3 text-sm font-semibold text-[#344054]">Jump straight to</h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {quickLinks.map((link) => (
            <li key={link.to}>
              <QuickTile {...link} />
            </li>
          ))}
        </ul>
      </section>

      <p className="flex items-center justify-center gap-2 pt-2 text-xs text-[#98A2B3]">
        <ShieldCheck size={14} aria-hidden="true" />
        Your activity may be monitored for security. Sign out when you are done.
      </p>
    </div>
  );
}

export default Home;
