import { useEffect } from "react";
import { Link, NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  FolderOpen,
  Folder,
  Landmark,
  Upload,
  Settings,
  X,
  Lock,
} from "lucide-react";

/*
 * Navigation uses React Router links, so moving between pages is a
 * client-side navigation (no full page reload). Each href must match
 * a <Route path="..."> in your router.
 */
const NAV_GROUPS = [
  {
    label: "Overview",
    items: [{ name: "Dashboard", href: "/admin", icon: LayoutDashboard }],
  },
  {
    label: "Manage",
    items: [
      { name: "Staff users", href: "/admin/users", icon: Users },
      { name: "Shared files", href: "/admin/shared", icon: FolderOpen },
      { name: "Programs", href: "/admin/programs", icon: Folder },
      {
        name: "Finance",
        href: "/admin/finance",
        icon: Landmark,
        restricted: true,
      },
      { name: "File upload", href: "/admin/upload", icon: Upload },
    ],
  },
  {
    label: "System",
    items: [
      { name: "Portal settings", href: "/admin/settings", icon: Settings },
    ],
  },
];

function Sidebar({ mobileOpen, onClose }) {
  useEffect(() => {
    if (!mobileOpen) return undefined;

    const handleKey = (event) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", handleKey);

    return () => window.removeEventListener("keydown", handleKey);
  }, [mobileOpen, onClose]);

  return (
    <>
      {/* MOBILE OVERLAY */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-[#0F3D2E]/50 backdrop-blur-sm transition-opacity lg:hidden ${
          mobileOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      <aside
        aria-label="Main navigation"
        className={`fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 flex-col border-r border-[#DDE2DB] bg-white transition-transform duration-200 motion-reduce:transition-none lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* BRAND */}
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-[#DDE2DB] px-5">
          <Link
            to="/admin"
            onClick={onClose}
            className="flex items-center gap-3 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C8963E]"
          >
            <span
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#0F3D2E] text-lg font-semibold text-white"
              style={{ fontFamily: '"Fraunces", Georgia, serif' }}
            >
              E
            </span>

            <span className="leading-tight">
              <span
                className="block text-[15px] font-semibold text-[#16211C]"
                style={{ fontFamily: '"Fraunces", Georgia, serif' }}
              >
                EACHRights
              </span>

              <span className="block text-xs text-slate-500">Staff portal</span>
            </span>
          </Link>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#C8963E] lg:hidden"
          >
            <X size={20} />
          </button>
        </div>

        {/* NAVIGATION */}
        <nav className="flex-1 overflow-y-auto px-3 py-5">
          {NAV_GROUPS.map((group, groupIndex) => (
            <div key={group.label} className={groupIndex > 0 ? "mt-6" : ""}>
              <p className="mb-2 px-3 text-xs font-medium text-slate-400">
                {group.label}
              </p>

              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;

                  return (
                    <li key={item.name}>
                      <NavLink
                        to={item.href}
                        end={item.href === "/admin"}
                        onClick={onClose}
                        className={({ isActive }) =>
                          `relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#C8963E] motion-reduce:transition-none ${
                            isActive
                              ? "bg-[#E8F0EB] text-[#0F3D2E]"
                              : "text-slate-600 hover:bg-[#F5F6F2] hover:text-[#16211C]"
                          }`
                        }
                      >
                        {({ isActive }) => (
                          <>
                            {isActive && (
                              <span
                                aria-hidden="true"
                                className="absolute -left-3 top-2 h-6 w-1 rounded-r bg-[#C8963E]"
                              />
                            )}

                            <Icon
                              size={18}
                              className={
                                isActive ? "text-[#0F3D2E]" : "text-slate-400"
                              }
                            />

                            <span className="flex-1">{item.name}</span>

                            {item.restricted && (
                              <Lock
                                size={13}
                                className="text-[#B9852F]"
                                aria-label="Restricted"
                              />
                            )}
                          </>
                        )}
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* FOOTER */}
        <div className="shrink-0 border-t border-[#DDE2DB] px-5 py-4">
          <p className="text-xs leading-5 text-slate-400">
            Files are stored in private cloud storage and visible only to
            authorised staff.
          </p>
        </div>
      </aside>
    </>
  );
}

export default Sidebar;
