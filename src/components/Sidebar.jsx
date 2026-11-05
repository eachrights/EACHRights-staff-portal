import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  FolderOpen,
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
  ClipboardCheck,
  FileStack,
  Table2,
  Database,
  Sparkles,
  FileBarChart,
  TrendingUp,
  BookOpen,
  Home,
  ListChecks,
  CalendarDays,
  CalendarCheck,
  History,
  Plane,
  Layers,
  Building2,
  Wallet,
  Banknote,
} from "lucide-react";

import {
  canSeeDepartment,
  DEPARTMENT_AREAS,
  getAccess,
  PROGRAM_AREAS,
} from "../access";
import { LABELS } from "../labels";

/*
 * Navigation. Every href must match a <Route> in App.jsx.
 * Thematic areas open on the Programs page through ?area=<slug>.
 * People only see the departments (Cognito groups "dept-<slug>") they belong to.
 *
 * Layout, top to bottom:
 *   Home
 *   My workplace          Attendance and leave, Travel, Requisitions, Finance
 *   Programmes & results  M&E (collapsible)
 *   Files                 All files, Programmes, Departments
 *   Administration        (administrator only)
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
 * Items marked adminOnly are hidden from staff (the API also refuses them).
 */
const ME_GROUPS = [
  {
    label: "Workspace",
    items: [
      { name: LABELS.projects, href: "/me-dashboard/projects", icon: FolderOpen },
      { name: "Dashboards", href: "/me-dashboard", icon: LayoutDashboard },
      { name: "Frameworks", href: "/me-dashboard/frameworks", icon: FolderKanban },
      { name: "Indicators", href: "/me-dashboard/indicators", icon: Gauge },
      { name: "Indicator library", href: "/me-dashboard/library", icon: Library },
      { name: "Forms", href: "/me-dashboard/forms", icon: ClipboardList },
      { name: "Form library", href: "/me-dashboard/form-library", icon: FileStack },
      { name: "Data table", href: "/me-dashboard/data", icon: Table2 },
      { name: "Data tables", href: "/me-dashboard/data-tables", icon: Database },
      {
        name: "Approvals & portfolio",
        href: "/me-dashboard/portfolio",
        icon: ClipboardCheck,
        adminOnly: true,
      },
    ],
  },
  {
    label: "Planning",
    items: [
      { name: "Workplan", href: "/me-dashboard/workplan", icon: ListChecks },
      { name: "Calendar", href: "/me-dashboard/calendar", icon: CalendarDays },
      { name: "Audit trail", href: "/me-dashboard/audit", icon: History, adminOnly: true },
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

/* Dot colours for programme areas and departments, matching the dashboard */
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

const DEFAULT_DOT_COLOR = "#98A2B3";

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#008060]";

/* green is the portal colour, purple is used by the M&E section to match the M&E dashboard */
const TONES = {
  green: {
    active: "bg-[#E9F5F0] text-[#00664E] before:bg-[#008060]",
    icon: "text-[#008060]",
    text: "text-[#00664E]",
  },
  purple: {
    active: "bg-[#EEEAFB] text-[#5B3FD0] before:bg-[#5B3FD0]",
    icon: "text-[#5B3FD0]",
    text: "text-[#5B3FD0]",
  },
};

const ICON_STROKE = 1.75;

function SectionLabel({ children }) {
  return (
    <p className="px-3 pb-1.5 pt-5 text-[11px] font-semibold uppercase tracking-wider text-[#98A2B3]">
      {children}
    </p>
  );
}

function Dot({ color = DEFAULT_DOT_COLOR }) {
  return (
    <span
      aria-hidden="true"
      className="ml-1 mr-0.5 h-2 w-2 shrink-0 rounded-full"
      style={{ backgroundColor: color }}
    />
  );
}

/* One navigation link. A thin bar on the left marks the page you are on. */
function NavItem({ to, active, onClick, icon: Icon, children, tone = "green", small = false }) {
  const t = TONES[tone];

  return (
    <Link
      to={to}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`relative flex min-w-0 flex-1 items-center gap-3 rounded-lg px-3 font-medium transition-colors motion-reduce:transition-none ${
        small ? "py-1.5 text-[13px]" : "py-2 text-[13.5px]"
      } ${FOCUS} ${
        active
          ? `${t.active} before:absolute before:left-0 before:top-1/2 before:h-5 before:w-[3px] before:-translate-y-1/2 before:rounded-r-full`
          : "text-[#475467] hover:bg-[#F4F6F5] hover:text-[#0B2B24]"
      }`}
    >
      {Icon && (
        <Icon
          size={small ? 16 : 18}
          strokeWidth={ICON_STROKE}
          className={`shrink-0 ${active ? t.icon : "text-[#98A2B3]"}`}
        />
      )}
      {children}
    </Link>
  );
}

/* A row that opens and closes a group of links */
function GroupToggle({ icon: Icon, label, open, onToggle, active, controls, tone = "green" }) {
  const t = TONES[tone];

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={controls}
      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] font-medium transition-colors hover:bg-[#F4F6F5] motion-reduce:transition-none ${FOCUS} ${
        active ? t.text : "text-[#475467] hover:text-[#0B2B24]"
      }`}
    >
      <Icon
        size={18}
        strokeWidth={ICON_STROKE}
        className={`shrink-0 ${active ? t.icon : "text-[#98A2B3]"}`}
      />
      <span className="flex-1 text-left">{label}</span>
      <ChevronDown
        size={15}
        strokeWidth={ICON_STROKE}
        className={`text-[#98A2B3] transition-transform motion-reduce:transition-none ${open ? "" : "-rotate-90"}`}
      />
    </button>
  );
}

/* Remembers open/closed for this browser tab, so a menu does not snap shut when the sidebar is rebuilt */
function usePersisted(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const saved = sessionStorage.getItem(key);
      return saved === null ? initial : saved === "1";
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      sessionStorage.setItem(key, value ? "1" : "0");
    } catch {
      // Storage can be blocked; the menu then just forgets between visits
    }
  }, [key, value]);

  return [value, setValue];
}

function Sidebar({ mobileOpen, onClose }) {
  const { pathname, search } = useLocation();
  const activeArea = new URLSearchParams(search).get("area");

  const onHome = pathname === "/home" || pathname === "/home/";
  const onAdminHome = pathname === "/admin" || pathname === "/admin/";
  const onPrograms = pathname.startsWith("/admin/programs");
  const onMe = pathname.startsWith("/me-dashboard");
  const onAttendance = pathname.startsWith("/attendance");
  const onTravel = pathname.startsWith("/travel");
  const onRequisitions = pathname.startsWith("/requisitions");
  const onFinance = pathname.startsWith("/finance");

  // Groups start closed and open by themselves when you are inside them
  const [meOpen, setMeOpen] = usePersisted("nav-me-open", onMe);
  const [programsOpen, setProgramsOpen] = usePersisted("nav-programmes-open", onPrograms);
  const [deptsOpen, setDeptsOpen] = usePersisted("nav-departments-open", onPrograms);
  const [access, setAccess] = useState({ isAdmin: false, departments: new Set() });

  useEffect(() => {
    if (onMe) setMeOpen(true);
  }, [onMe]);
  useEffect(() => {
    if (onPrograms) {
      setProgramsOpen(true);
      setDeptsOpen(true);
    }
  }, [onPrograms]);

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

  /*
   * Exact match, or a real sub-path of the link. A plain startsWith would light
   * up "Data table" on /me-dashboard/data-tables, and "Forms" on
   * /me-dashboard/form-library. Dashboards only matches itself.
   */
  const meActive = (href) =>
    pathname === href ||
    pathname === `${href}/` ||
    (href !== "/me-dashboard" && pathname.startsWith(`${href}/`));

  const filesHome = isAdmin ? "/admin" : "/dashboard";
  const onFilesHome = isAdmin ? onAdminHome : pathname === "/dashboard";

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
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-[#EEF1F0] px-5">
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
            <X size={20} strokeWidth={ICON_STROKE} />
          </button>
        </div>

        {/* NAVIGATION */}
        <nav className="flex-1 overflow-y-auto px-3 pb-4 pt-3">
          {/* Home (the page shown after sign-in) */}
          <ul className="space-y-0.5">
            <li className="flex">
              <NavItem to="/home" active={onHome} onClick={onClose} icon={Home}>
                Home
              </NavItem>
            </li>
          </ul>

          {/* MY WORKPLACE */}
          <SectionLabel>My workplace</SectionLabel>
          <ul className="space-y-0.5">
            <li className="flex">
              <NavItem to="/attendance" active={onAttendance} onClick={onClose} icon={CalendarCheck}>
                Attendance &amp; leave
              </NavItem>
            </li>
            <li className="flex">
              <NavItem to="/travel" active={onTravel} onClick={onClose} icon={Plane}>
                Travel
              </NavItem>
            </li>
            <li className="flex">
              <NavItem to="/requisitions" active={onRequisitions} onClick={onClose} icon={Wallet}>
                Requisitions
              </NavItem>
            </li>
            <li className="flex">
              <NavItem to="/finance" active={onFinance} onClick={onClose} icon={Banknote}>
                Finance
              </NavItem>
            </li>
          </ul>

          {/* PROGRAMMES AND RESULTS */}
          <SectionLabel>Programmes &amp; results</SectionLabel>
          <ul className="space-y-0.5">
            <li>
              <GroupToggle
                icon={Target}
                label="M&E"
                tone="purple"
                open={meOpen}
                active={onMe}
                controls="me-menu"
                onToggle={() => setMeOpen((open) => !open)}
              />

              {meOpen && (
                <div id="me-menu" className="ml-[21px] mt-1 space-y-3 border-l border-[#E6ECE9] pb-1 pl-3">
                  {ME_GROUPS.map((group) => (
                    <div key={group.label}>
                      <p className="px-3 pb-1 text-[11px] font-medium text-[#98A2B3]">{group.label}</p>

                      <ul className="space-y-0.5">
                        {group.items
                          .filter((item) => !item.adminOnly || isAdmin)
                          .map((item) => (
                            <li key={item.href} className="flex">
                              <NavItem
                                small
                                tone="purple"
                                to={item.href}
                                icon={item.icon}
                                active={meActive(item.href)}
                                onClick={onClose}
                              >
                                <span className="flex-1 truncate">{item.name}</span>
                                {item.badge && (
                                  <span className="rounded-full bg-[#EEEAFB] px-1.5 py-0.5 text-[10px] font-semibold text-[#5B3FD0]">
                                    {item.badge}
                                  </span>
                                )}
                              </NavItem>
                            </li>
                          ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </li>
          </ul>

          {/* FILES */}
          <SectionLabel>Files</SectionLabel>
          <ul className="space-y-0.5">
            <li className="flex">
              <NavItem to={filesHome} active={onFilesHome} onClick={onClose} icon={FolderOpen}>
                {isAdmin ? "All files" : "My departments"}
              </NavItem>
            </li>

            {/* Programmes + thematic areas */}
            {visibleAreas.length > 0 && (
              <li>
                <div className="flex items-center gap-1">
                  <NavItem
                    to="/admin/programs"
                    active={onPrograms && !activeArea}
                    onClick={onClose}
                    icon={Layers}
                  >
                    {LABELS.programmes}
                  </NavItem>

                  <button
                    type="button"
                    onClick={() => setProgramsOpen((open) => !open)}
                    aria-expanded={programsOpen}
                    aria-controls="programmes-menu"
                    aria-label={programsOpen ? `Collapse ${LABELS.programmes}` : `Expand ${LABELS.programmes}`}
                    className={`rounded-lg p-1.5 text-[#98A2B3] transition-colors hover:bg-[#F4F6F5] hover:text-[#0B2B24] ${FOCUS}`}
                  >
                    <ChevronDown
                      size={15}
                      strokeWidth={ICON_STROKE}
                      className={`transition-transform motion-reduce:transition-none ${programsOpen ? "" : "-rotate-90"}`}
                    />
                  </button>
                </div>

                {programsOpen && (
                  <ul id="programmes-menu" className="ml-[21px] mt-0.5 space-y-0.5 border-l border-[#E6ECE9] pl-3">
                    {visibleAreas.map((area) => (
                      <li key={area.slug} className="flex">
                        <NavItem
                          small
                          to={`/admin/programs?area=${area.slug}`}
                          active={onPrograms && activeArea === area.slug}
                          onClick={onClose}
                        >
                          <Dot color={AREA_COLORS[area.slug]} />
                          <span className="truncate">{area.name}</span>
                        </NavItem>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )}

            {/* Departments */}
            {visibleDepartments.length > 0 && (
              <li>
                <GroupToggle
                  icon={Building2}
                  label="Departments"
                  open={deptsOpen}
                  active={onPrograms && visibleDepartments.some((area) => area.slug === activeArea)}
                  controls="departments-menu"
                  onToggle={() => setDeptsOpen((open) => !open)}
                />

                {deptsOpen && (
                  <ul id="departments-menu" className="ml-[21px] mt-0.5 space-y-0.5 border-l border-[#E6ECE9] pl-3">
                    {visibleDepartments.map((area) => (
                      <li key={area.slug} className="flex">
                        <NavItem
                          small
                          to={`/admin/programs?area=${area.slug}`}
                          active={onPrograms && activeArea === area.slug}
                          onClick={onClose}
                        >
                          <Dot color={AREA_COLORS[area.slug]} />
                          <span className="flex-1 truncate">{area.name}</span>
                          {area.restricted && (
                            <Lock size={12} strokeWidth={ICON_STROKE} className="text-[#D98A00]" aria-label="Restricted" />
                          )}
                        </NavItem>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )}
          </ul>

          {/* ADMINISTRATION (administrator only) */}
          {isAdmin && (
            <>
              <SectionLabel>Administration</SectionLabel>
              <ul className="space-y-0.5">
                {ADMIN_LINKS.map((item) => (
                  <li key={item.name} className="flex">
                    <NavItem
                      to={item.href}
                      icon={item.icon}
                      active={pathname.startsWith(item.href)}
                      onClick={onClose}
                    >
                      {item.name}
                    </NavItem>
                  </li>
                ))}
              </ul>
            </>
          )}
        </nav>

        {/* PRIVATE STORAGE NOTE */}
        <div className="shrink-0 border-t border-[#EEF1F0] p-3">
          <div className="flex items-center gap-3 rounded-xl bg-[#F4F8F6] px-3 py-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#008060] text-white">
              <ShieldCheck size={16} strokeWidth={ICON_STROKE} />
            </span>
            <p className="text-xs leading-4 text-[#475467]">
              <span className="block text-[13px] font-semibold text-[#0B2B24]">Private storage</span>
              Encrypted, authorised staff only
            </p>
          </div>
        </div>
      </aside>
    </>
  );
}

export default Sidebar;
