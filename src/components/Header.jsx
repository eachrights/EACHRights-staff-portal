import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Menu, Search, Plus, Settings, LogOut, ChevronDown } from "lucide-react";
import { signOut, getSignedInEmail } from "../utils/signOut";

/*
 * Top bar: search, "New file", sign out and the account menu.
 * Searching sends the user to /admin?q=term, where the file list filters.
 *
 * Sign out works on every page by itself: pages do not need to pass
 * onLogout or email. If a page does pass them, those are used instead.
 */
function Header({ email = "", onMenuClick, onLogout }) {
  const navigate = useNavigate();
  const location = useLocation();

  const searchRef = useRef(null);
  const menuRef = useRef(null);

  const [query, setQuery] = useState(
    () => new URLSearchParams(location.search).get("q") || ""
  );
  const [menuOpen, setMenuOpen] = useState(false);

  const handleLogout = onLogout || signOut;
  const displayEmail = email || getSignedInEmail();

  // Keep the box in sync when the URL changes (for example "clear search")
  useEffect(() => {
    if (location.pathname === "/admin") {
      setQuery(new URLSearchParams(location.search).get("q") || "");
    }
  }, [location.pathname, location.search]);

  // Ctrl/Cmd + K focuses the search box
  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Close the account menu on outside click or Escape
  useEffect(() => {
    if (!menuOpen) return undefined;

    const onPointerDown = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
    };

    const onKeyDown = (event) => {
      if (event.key === "Escape") setMenuOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const handleSearch = (event) => {
    event.preventDefault();

    const term = query.trim();
    navigate(term ? `/admin?q=${encodeURIComponent(term)}` : "/admin");
  };

  const initial = (displayEmail || "A").trim().charAt(0).toUpperCase();

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-[#DDE2DB] bg-white px-4 sm:px-6">
      <button
        type="button"
        onClick={onMenuClick}
        aria-label="Open menu"
        className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#C8963E] lg:hidden"
      >
        <Menu size={20} />
      </button>

      <form onSubmit={handleSearch} role="search" className="min-w-0 flex-1 sm:max-w-xl">
        <label htmlFor="portal-search" className="sr-only">
          Search files
        </label>

        <div className="relative">
          <Search
            size={17}
            aria-hidden="true"
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
          />

          <input
            id="portal-search"
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type or press Ctrl K to search files"
            className="w-full rounded-lg border border-[#DDE2DB] bg-[#F5F6F2] py-2.5 pl-10 pr-4 text-sm outline-none transition placeholder:text-slate-400 focus:border-[#2F6B4F] focus:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#C8963E]"
          />
        </div>
      </form>

      <div className="ml-auto flex items-center gap-2 sm:gap-3">
        <Link
          to="/admin/upload"
          className="inline-flex items-center gap-2 rounded-lg bg-[#0F3D2E] px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-[#0B2F23] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C8963E] sm:px-4"
        >
          <Plus size={17} />
          <span className="hidden sm:inline">New file</span>
          <span className="sr-only sm:hidden">New file</span>
        </Link>

        <Link
          to="/admin/settings"
          aria-label="Portal settings"
          title="Portal settings"
          className="hidden rounded-lg p-2.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#C8963E] sm:block"
        >
          <Settings size={19} />
        </Link>

        {/* Always-visible sign out, on every page */}
        <button
          type="button"
          onClick={handleLogout}
          aria-label="Sign out"
          title="Sign out"
          className="hidden rounded-lg p-2.5 text-slate-500 transition hover:bg-red-50 hover:text-red-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#C8963E] sm:block"
        >
          <LogOut size={19} />
        </button>

        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="flex items-center gap-2 rounded-lg p-1.5 transition hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#C8963E]"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0F3D2E] text-sm font-semibold text-white">
              {initial}
            </span>

            <span className="hidden max-w-[160px] truncate text-sm font-medium text-[#16211C] md:block">
              {displayEmail || "Administrator"}
            </span>

            <ChevronDown size={15} className="hidden text-slate-400 md:block" />
          </button>

          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full mt-2 w-60 overflow-hidden rounded-xl border border-[#DDE2DB] bg-white py-1 shadow-xl"
            >
              <div className="border-b border-[#E8ECE6] px-4 py-3">
                <p className="text-xs text-slate-400">Signed in as</p>
                <p className="mt-0.5 truncate text-sm font-medium">
                  {displayEmail || "Administrator"}
                </p>
              </div>

              <Link
                to="/admin/settings"
                role="menuitem"
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-[#F5F6F2]"
              >
                <Settings size={16} />
                Portal settings
              </Link>

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  handleLogout();
                }}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50"
              >
                <LogOut size={16} />
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

export default Header;
