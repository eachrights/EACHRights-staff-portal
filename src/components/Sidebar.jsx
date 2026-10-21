import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Folder,
  ChevronDown,
  Users,
  Upload,
  Settings,
  Target,
  X,
  Lock,
  ShieldCheck,
  LayoutDashboard,
  FolderKanban,
  Gauge,
  Library,
  ClipboardList,
  FileStack,
  Table2,
  Database,
  Sparkles,
  FileBarChart,
  TrendingUp,
  BookOpen,
  Home,
} from "lucide-react";

import {
  canSeeDepartment,
  DEPARTMENT_AREAS,
  getAccess,
  PROGRAM_AREAS,
} from "../access";

/*
 * File-tree navigation. Every href must match a <Route> in App.jsx.
 * Thematic areas open on the Programs page through ?area=<slug>.
 * People only see the departments (Cognito groups "dept-<slug>") they belong to.
 */
/* Shown to the administrator only */
const ADMIN_LINKS = [
  { name: "Staff users", href: "/admin/users", icon: Users },
  { name: "File upload", href: "/admin/upload", icon: Upload },
  { name: "Portal settings", href: "/admin/settings", icon: Settings },
];

/*
 * M&E features, grouped like the TolaData menu. Each href needs a <Route>
 * in App.jsx (see the /me-dashboard group).
 */
const ME_GROUPS = [
  {
    label: "Workspace",
    items: [
      { name: "Dashboards", href: "/me-dashboard", icon: LayoutDashboard },
      { name: "Frameworks", href: "/me-dashboard/frameworks", icon: FolderKanban },
      { name: "Indicators", href: "/me-dashboard/indicators", icon: Gauge },
      { name: "Indicator library", href: "/me-dashboard/library", icon: Library },
      { name: "Forms", href: "/me-dashboard/forms", icon: ClipboardList },
      { name: "Form library", href: "/me-dashboard/form-library", icon: FileStack },
      { name: "Data table", href: "/me-dashboard/data", icon: Table2 },
      { name: "Data tables", href: "/me-dashboard/data-tables", icon: Database },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { name: "AI insights", href: "/me-dashboard/insights", icon: Sparkles, badge: "New" },
      { name: "Smart reports", href: "/me-dashboard/reports", icon: FileBarChart },
      { name: "Predictions", href: "/me-dashboard/predictions", icon: TrendingUp },
      { name: "Guides", href: "/me-dashboard/guides", icon: BookOpen },
    ],
  },
];

/*
 * Folder colours, matching the dashboard. These are the deeper tints so they
 * stay readable on the light sidebar.
 */
const AREA_COLORS = {
  finance: "#0F9F77",
  "education-justice": "#E8870A",
  "gender-justice": "#E5484D",
  "health-justice": "#E5559A",
  "environment-climate-change": "#6FA31F",
  "economic-justice": "#3B6FE0",
  communication: "#8E4FD6",
  it: "#11A3B0",
  "executive-director": "#6B7A93",
  "business-human-rights": "#E5601F",
};

const DEFAULT_FOLDER_COLOR = "#E8870A";

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#008060]";

function FolderIcon({ size = 18, color = DEFAULT_FOLDER_COLOR }) {
  return (
    <Folder
      size={size}
      className="shrink-0"
      style={{ color, fill: `${color}40` }}
    />
  );
}

/* tone="purple" is used by the M&E section to match the M&E dashboard */
function TreeLink({ to, active, onClick, children, small = false, tone = "green" }) {
  const activeCls =
    tone === "purple"
      ? "bg-[#EDE9FB] text-[#5B3FD0]"
      : "bg-[#E3F3EC] text-[#00664E]";

  return (
    <Link
      to={to}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`flex min-w-0 flex-1 items-center gap-3 rounded-xl px-3 ${
        small ? "py-2 text-[13px]" : "py-2.5 text-sm"
      } font-medium transition motion-reduce:transition-none ${FOCUS} ${
        active
          ? activeCls
          : "text-[#475467] hover:bg-[#F3F6F5] hover:text-[#0B2B24]"
      }`}
    >
      {children}
    </Link>
  );
}

function Sidebar({ mobileOpen, onClose }) {
  const { pathname, search } = useLocation();
  const activeArea = new URLSearchParams(search).get("area");

  const [programsOpen, setProgramsOpen] = useState(true);
  const [meOpen, setMeOpen] = useState(true);
  const [access, setAccess] = useState({ isAdmin: false, departments: new Set() });

  // Work out which departments this person belongs to
  useEffect(() => {
    let isMounted = true;

    getAccess()
      .then((result) => {
        if (isMounted) setAccess(result);
      })
      .catch(() => {
        // Leave everything hidden if the session can't be read
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const { isAdmin } = access;
  const canSee = (slug) => canSeeDepartment(access, slug);
  const visibleAreas = PROGRAM_AREAS.filter((area) => canSee(area.slug));
  const visibleDepartments = DEPARTMENT_AREAS.filter((area) => canSee(area.slug));

  useEffect(() => {
    if (!mobileOpen) return undefined;

    const handleKey = (event) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", handleKey);

    return () => window.removeEventListener("keydown", handleKey);
  }, [mobileOpen, onClose]);

  const onHome = pathname === "/home" || pathname === "/home/";
  const onAdminHome = pathname === "/admin" || pathname === "/admin/";
  const onPrograms = pathname.startsWith("/admin/programs");
  const onMe = pathname.startsWith("/me-dashboard");

  /*
   * Exact match, or a real sub-path of the link. A plain startsWith would light
   * up "Data table" on /me-dashboard/data-tables, and "Forms" on
   * /me-dashboard/form-library. Dashboards only matches itself.
   */
  const meActive = (href) =>
    pathname === href ||
    pathname === `${href}/` ||
    (href !== "/me-dashboard" && pathname.startsWith(`${href}/`));

  return (
    <>
      {/* MOBILE OVERLAY */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-sm transition-opacity lg:hidden ${
          mobileOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      <aside
        aria-label="Main navigation"
        className={`fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 flex-col border-r border-[#E6ECE9] bg-white transition-transform duration-200 motion-reduce:transition-none lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* BRAND */}
        <div className="flex h-16 shrink-0 items-center justify-between px-5">
          <Link
            to="/home"
            onClick={onClose}
            className={`flex items-center gap-3 rounded-xl ${FOCUS}`}
          >
            <span
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#008060] text-lg font-semibold text-white"
              style={{ fontFamily: '"Fraunces", Georgia, serif' }}
            >
              E
            </span>

            <span className="leading-tight">
              <span
                className="block text-[15px] font-semibold text-[#0B2B24]"
                style={{ fontFamily: '"Fraunces", Georgia, serif' }}
              >
                EACHRights
              </span>
              <span className="block text-xs text-[#667085]">Staff portal</span>
            </span>
          </Link>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className={`rounded-lg p-2 text-[#667085] transition hover:bg-[#F3F6F5] hover:text-[#0B2B24] lg:hidden ${FOCUS}`}
          >
            <X size={20} />
          </button>
        </div>

        {/* NAVIGATION */}
        <nav className="flex-1 overflow-y-auto px-3 pb-4 pt-2">
          <p className="mb-2 px-3 text-xs font-medium text-[#98A2B3]">Main menu</p>

          <ul className="space-y-0.5">
            {/* Home (the page shown after sign-in) */}
            <li className="flex items-center">
              <TreeLink to="/home" active={onHome} onClick={onClose}>
                <Home size={18} className={onHome ? "text-[#00664E]" : "text-[#98A2B3]"} />
                <span className="flex-1">Home</span>
              </TreeLink>
            </li>

            {/* M&E (monitoring and evaluation) */}
            <li>
              <button
                type="button"
                onClick={() => setMeOpen((open) => !open)}
                aria-expanded={meOpen}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition hover:bg-[#F3F6F5] motion-reduce:transition-none ${FOCUS} ${
                  onMe ? "text-[#5B3FD0]" : "text-[#475467] hover:text-[#0B2B24]"
                }`}
              >
                <Target size={18} className={onMe ? "text-[#5B3FD0]" : "text-[#98A2B3]"} />
                <span className="flex-1 text-left">M&amp;E</span>
                <ChevronDown
                  size={15}
                  className={`text-[#98A2B3] transition-transform motion-reduce:transition-none ${
                    meOpen ? "" : "-rotate-90"
                  }`}
                />
              </button>

              {meOpen && (
                <div className="ml-4 mt-0.5 space-y-2 border-l border-[#E6ECE9] pl-2">
                  {ME_GROUPS.map((group) => (
                    <div key={group.label}>
                      <p className="px-3 pb-1 pt-1 text-xs font-medium text-[#98A2B3]">
                        {group.label}
                      </p>

                      <ul className="space-y-0.5">
                        {group.items.map((item) => {
                          const Icon = item.icon;
                          const active = meActive(item.href);

                          return (
                            <li key={item.href} className="flex">
                              <TreeLink
                                small
                                tone="purple"
                                to={item.href}
                                active={active}
                                onClick={onClose}
                              >
                                <Icon
                                  size={16}
                                  className={active ? "text-[#5B3FD0]" : "text-[#98A2B3]"}
                                />
                                <span className="flex-1 truncate">{item.name}</span>
                                {item.badge && (
                                  <span className="rounded-full bg-[#EDE9FB] px-1.5 py-0.5 text-[10px] font-semibold text-[#5B3FD0]">
                                    {item.badge}
                                  </span>
                                )}
                              </TreeLink>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </li>

            {/* All files (administrator) / My department (staff) */}
            <li className="flex items-center">
              <TreeLink
                to={isAdmin ? "/admin" : "/dashboard"}
                active={isAdmin ? onAdminHome : pathname === "/dashboard"}
                onClick={onClose}
              >
                <FolderIcon />
                <span className="flex-1">{isAdmin ? "All files" : "My departments"}</span>
              </TreeLink>
            </li>

            {/* Programs + thematic areas */}
            <li>
              <div className="ml-4 border-l border-[#E6ECE9] pl-2">
                {visibleAreas.length > 0 && (
                  <div className="flex items-center">
                    <TreeLink
                      to="/admin/programs"
                      active={onPrograms && !activeArea}
                      onClick={onClose}
                    >
                      <FolderIcon />
                      <span className="flex-1">Programs</span>
                    </TreeLink>

                    <button
                      type="button"
                      onClick={() => setProgramsOpen((open) => !open)}
                      aria-expanded={programsOpen}
                      aria-label={programsOpen ? "Collapse programs" : "Expand programs"}
                      className={`ml-1 rounded-lg p-1.5 text-[#98A2B3] hover:bg-[#F3F6F5] hover:text-[#0B2B24] ${FOCUS}`}
                    >
                      <ChevronDown
                        size={15}
                        className={`transition-transform motion-reduce:transition-none ${
                          programsOpen ? "" : "-rotate-90"
                        }`}
                      />
                    </button>
                  </div>
                )}

                {programsOpen && visibleAreas.length > 0 && (
                  <ul className="ml-4 mt-0.5 space-y-0.5 border-l border-[#E6ECE9] pl-2">
                    {visibleAreas.map((area) => (
                      <li key={area.slug} className="flex">
                        <TreeLink
                          small
                          to={`/admin/programs?area=${area.slug}`}
                          active={onPrograms && activeArea === area.slug}
                          onClick={onClose}
                        >
                          <FolderIcon size={16} color={AREA_COLORS[area.slug]} />
                          <span className="truncate">{area.name}</span>
                        </TreeLink>
                      </li>
                    ))}
                  </ul>
                )}

                {visibleDepartments.length > 0 && (
                  <div className="mt-2">
                    <p className="px-3 pb-1 text-xs font-medium text-[#98A2B3]">
                      Departments
                    </p>

                    <ul className="ml-4 space-y-0.5 border-l border-[#E6ECE9] pl-2">
                      {visibleDepartments.map((area) => (
                        <li key={area.slug} className="flex">
                          <TreeLink
                            small
                            to={`/admin/programs?area=${area.slug}`}
                            active={onPrograms && activeArea === area.slug}
                            onClick={onClose}
                          >
                            <FolderIcon size={16} color={AREA_COLORS[area.slug]} />
                            <span className="flex-1 truncate">{area.name}</span>
                            {area.restricted && (
                              <Lock size={12} className="text-[#D98A00]" aria-label="Restricted" />
                            )}
                          </TreeLink>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {canSee("finance") && (
                  <div className="mt-0.5 flex">
                    <TreeLink
                      to="/admin/finance"
                      active={pathname.startsWith("/admin/finance")}
                      onClick={onClose}
                    >
                      <FolderIcon color={AREA_COLORS.finance} />
                      <span className="flex-1">Finance</span>
                      <Lock size={13} className="text-[#D98A00]" aria-label="Restricted" />
                    </TreeLink>
                  </div>
                )}
              </div>
            </li>
          </ul>

          {/* ADMINISTRATION (administrator only) */}
          {isAdmin && (
            <div className="mt-6 border-t border-[#E6ECE9] pt-4">
              <p className="mb-2 px-3 text-xs font-medium text-[#98A2B3]">
                Administration
              </p>

              <ul className="space-y-0.5">
                {ADMIN_LINKS.map((item) => {
                  const Icon = item.icon;
                  const active = pathname.startsWith(item.href);

                  return (
                    <li key={item.name} className="flex">
                      <TreeLink to={item.href} active={active} onClick={onClose}>
                        <Icon
                          size={18}
                          className={active ? "text-[#008060]" : "text-[#98A2B3]"}
                        />
                        <span className="flex-1">{item.name}</span>
                      </TreeLink>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </nav>

        {/* PRIVATE STORAGE CARD */}
        <div className="shrink-0 p-4">
          <div className="rounded-2xl bg-[#EEF7F3] p-4 ring-1 ring-[#D5EBE2]">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#008060] text-white">
              <ShieldCheck size={18} />
            </span>

            <p className="mt-3 text-sm font-semibold text-[#0B2B24]">Private storage</p>

            <p className="mt-1 text-xs leading-5 text-[#475467]">
              Files are encrypted and visible only to authorised staff.
            </p>
          </div>
        </div>
      </aside>
    </>
  );
}

export default Sidebar;
