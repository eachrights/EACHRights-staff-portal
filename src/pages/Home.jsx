import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  ClipboardList,
  FileBarChart,
  FolderOpen,
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
    hover: "hover:border-[#5B3FD0]/50",
    link: "text-[#5B3FD0]",
    ring: "focus-visible:outline-[#5B3FD0]",
  },
  green: {
    icon: "bg-[#E3F3EC] text-[#00664E]",
    hover: "hover:border-[#008060]/50",
    link: "text-[#00664E]",
    ring: "focus-visible:outline-[#008060]",
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

function StartCard({ to, icon: Icon, title, text, meta, accent }) {
  const a = ACCENT[accent];
  return (
    <Link
      to={to}
      className={`group flex h-full flex-col rounded-2xl border border-[#E6ECE9] bg-white p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition hover:shadow-md motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${a.hover} ${a.ring}`}
    >
      <span className={`flex h-12 w-12 items-center justify-center rounded-xl ${a.icon}`}>
        <Icon size={24} aria-hidden="true" />
      </span>

      <h2 className="mt-5 text-lg font-semibold tracking-tight text-[#0B2B24]">{title}</h2>
      <p className="mt-1.5 text-sm leading-6 text-[#667085]">{text}</p>

      <div className="mt-6 flex items-center justify-between gap-3 border-t border-[#EEF2F0] pt-4">
        <span className="text-xs text-[#98A2B3]">{meta}</span>
        <span className={`inline-flex items-center gap-1.5 text-sm font-semibold ${a.link}`}>
          Open
          <ArrowRight size={16} className="transition group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" />
        </span>
      </div>
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
    { to: "/me-dashboard/forms", label: "Enter data", icon: ClipboardList },
    { to: "/me-dashboard/data", label: "Data table", icon: Table2 },
    { to: "/me-dashboard/reports", label: "Reports", icon: FileBarChart },
    ...(access.isAdmin ? [{ to: "/admin/upload", label: "Upload files", icon: UploadCloud }] : []),
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-1 py-4 sm:py-8">
      <header>
        <p className="text-sm font-medium text-[#667085]">{today}</p>
        <h1
          className="mt-1 text-3xl font-semibold tracking-tight text-[#0B2B24] sm:text-4xl"
          style={DISPLAY}
        >
          {greeting()}
          {name ? `, ${name}` : ""}
        </h1>
        <p className="mt-2 text-base text-[#475467]">Where would you like to start?</p>
      </header>

      <section aria-label="Start here" className="grid gap-5 md:grid-cols-2">
        <StartCard
          to="/me-dashboard"
          icon={Target}
          accent="purple"
          title="M&E Dashboard"
          text="Track progress against targets, enter and approve results, and report on your frameworks."
          meta={meMeta}
        />
        <StartCard
          to={access.isAdmin ? "/admin" : "/dashboard"}
          icon={FolderOpen}
          accent="green"
          title={access.isAdmin ? "All files" : "My department files"}
          text="Open programme, department and finance documents. Upload, search and download securely."
          meta="Encrypted, authorised staff only"
        />
      </section>

      <section aria-label="Quick links">
        <h2 className="mb-3 text-sm font-semibold text-[#344054]">Jump straight to</h2>
        <ul className="flex flex-wrap gap-2.5">
          {quickLinks.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <Link
                to={to}
                className="inline-flex items-center gap-2 rounded-xl border border-[#E6ECE9] bg-white px-3.5 py-2.5 text-sm font-medium text-[#344054] transition hover:bg-[#F3F6F5] motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5B3FD0]"
              >
                <Icon size={16} className="text-[#98A2B3]" aria-hidden="true" />
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export default Home;
