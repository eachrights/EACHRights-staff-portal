import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Users,
  UserPlus,
  Search,
  ShieldCheck,
  UserCheck,
  UserX,
  Mail,
  X,
  CheckCircle2,
  Clock,
  Edit,
  Trash2,
  RefreshCw,
  Loader2,
  AlertCircle,
  AlertTriangle,
} from "lucide-react";

import Header from "../../components/Header";
import Sidebar from "../../components/Sidebar";
import { userPool } from "../../cognito";
import { DEPARTMENTS } from "../../access";

/*
 * Design tokens (shared with the administrator dashboard)
 * forest  #0F3D2E  primary surface and actions
 * moss    #2F6B4F  secondary green for icons
 * ochre   #C8963E  focus accent
 * paper   #F5F6F2  page background
 * line    #DDE2DB  hairlines and borders
 * ink     #16211C  body text
 */

const FONT_CSS = `
@import url("https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&display=swap");
.eachr-display { font-family: "Fraunces", Georgia, "Times New Roman", serif; font-feature-settings: "lnum" 1; }
.eachr-focus:focus-visible { outline: 2px solid #C8963E; outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) {
  .eachr-motion { transition: none !important; animation: none !important; }
}
`;

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api";

const ROLE_OPTIONS = ["Administrator", "Staff", "Finance"];

/*
 * Departments control which files a person can open. Each one is a Cognito
 * group named "dept-<slug>" (for example "dept-education-justice"). A person
 * can be in several. "ceo" gives read-only access to every department.
 * Administrators can always see everything.
 */
const ACCESS_OPTIONS = [
  // The Executive Director is the CEO, so they share one entry below
  ...DEPARTMENTS.filter(({ slug }) => slug !== "executive-director").map(
    ({ slug, name }) => ({ slug, name })
  ),
  { slug: "ceo", name: "Executive Director / CEO (read-only, everything)" },
];

const departmentName = (slug) =>
  ACCESS_OPTIONS.find((option) => option.slug === slug)?.name || slug;

/** The department slugs a user belongs to, from whatever the API returns. */
function getUserDepartments(user) {
  if (Array.isArray(user.departments)) {
    return user.departments.map((slug) => String(slug).toLowerCase());
  }

  if (Array.isArray(user.groups)) {
    const slugs = user.groups
      .map((group) => String(group).toLowerCase())
      .filter((group) => group.startsWith("dept-"))
      .map((group) => group.slice(5));

    // The existing "finance" group counts as the finance department
    if (user.groups.some((g) => String(g).toLowerCase() === "finance")) {
      slugs.push("finance");
    }

    return [...new Set(slugs)];
  }

  return [];
}

const STATUS_OPTIONS = ["Active", "Pending", "Inactive"];

const EMPTY_FORM = {
  name: "",
  email: "",
  departments: [],
  role: "Staff",
  temporaryPassword: "",
};

const MIN_PASSWORD_LENGTH = 8;

/** Generates a random temporary password that satisfies typical Cognito policies. */
function generateTemporaryPassword(length = 14) {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%^&*";
  const all = upper + lower + digits + symbols;

  const pick = (chars) => {
    const buffer = new Uint32Array(1);
    crypto.getRandomValues(buffer);
    return chars[buffer[0] % chars.length];
  };

  // Guarantee one of each class, then fill the rest and shuffle
  const chars = [pick(upper), pick(lower), pick(digits), pick(symbols)];

  while (chars.length < length) chars.push(pick(all));

  for (let i = chars.length - 1; i > 0; i -= 1) {
    const buffer = new Uint32Array(1);
    crypto.getRandomValues(buffer);
    const j = buffer[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join("");
}

// ---------------------------------------------------------
// Cognito session helpers
// ---------------------------------------------------------

class SessionError extends Error {
  constructor(message = "Your session has expired. Please sign in again.") {
    super(message);
    this.name = "SessionError";
  }
}

/** Resolves with the current Cognito session, refreshing it if needed. */
function getCognitoSession() {
  return new Promise((resolve, reject) => {
    const currentUser = userPool.getCurrentUser();

    if (!currentUser) {
      reject(new SessionError());
      return;
    }

    currentUser.getSession((error, session) => {
      if (error || !session || !session.isValid()) {
        reject(new SessionError());
        return;
      }

      resolve(session);
    });
  });
}

const userKey = (user) => user.username || user.email;

/** Derives the status shown in the UI from the backend fields. */
function getDisplayStatus(user) {
  if (user.status === "Inactive") return "Inactive";
  if (user.userStatus === "FORCE_CHANGE_PASSWORD") return "Pending";
  return "Active";
}

function formatAdded(value) {
  if (!value) return "Not available";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return String(value);

  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// ---------------------------------------------------------
// Page
// ---------------------------------------------------------

function StaffUsers() {
  const navigate = useNavigate();

  const [staff, setStaff] = useState([]);
  const [currentEmail, setCurrentEmail] = useState("");

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");

  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const [confirmAction, setConfirmAction] = useState(null); // { type, user }

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyKey, setBusyKey] = useState(null);

  const [error, setError] = useState("");
  const [modalError, setModalError] = useState("");
  const [success, setSuccess] = useState("");

  // ---------------------------------------------------------
  // API helper (Cognito ID token, refreshed automatically)
  // ---------------------------------------------------------

  const apiRequest = useCallback(
    async (path, options = {}) => {
      let token;

      try {
        const session = await getCognitoSession();
        token = session.getIdToken().getJwtToken();
      } catch (err) {
        navigate("/", { replace: true });
        throw err;
      }

      const response = await fetch(`${API_BASE_URL}${path}`, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          ...(options.headers || {}),
        },
      });

      let data = {};

      try {
        data = await response.json();
      } catch {
        data = {};
      }

      if (response.status === 401) {
        navigate("/", { replace: true });
        throw new SessionError();
      }

      if (response.status === 403) {
        throw new Error("You do not have permission to perform this action.");
      }

      if (!response.ok) {
        throw new Error(
          data?.message ||
            data?.error ||
            `Request failed with status ${response.status}`
        );
      }

      return data;
    },
    [navigate]
  );

  // ---------------------------------------------------------
  // Current administrator (for Header and self-protection)
  // ---------------------------------------------------------

  useEffect(() => {
    let isMounted = true;

    getCognitoSession()
      .then((session) => {
        if (!isMounted) return;

        const payload = session.getIdToken().decodePayload();
        setCurrentEmail(String(payload?.email || "").trim().toLowerCase());
      })
      .catch(() => {
        if (isMounted) navigate("/", { replace: true });
      });

    return () => {
      isMounted = false;
    };
  }, [navigate]);

  const handleLogout = () => {
    const currentUser = userPool.getCurrentUser();

    if (currentUser) currentUser.signOut();

    localStorage.removeItem("eachrights_auth");
    sessionStorage.removeItem("eachrights_auth");

    navigate("/", { replace: true });
  };

  // ---------------------------------------------------------
  // Load staff
  // ---------------------------------------------------------

  const loadStaff = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const data = await apiRequest("/admin/users");
      const users = Array.isArray(data) ? data : data.users || [];

      setStaff(
        users.map((user) => ({ ...user, displayStatus: getDisplayStatus(user) }))
      );
    } catch (err) {
      if (err instanceof SessionError) return;

      console.error("Failed to load staff users:", err);
      setError(err.message || "Unable to load staff users.");
    } finally {
      setLoading(false);
    }
  }, [apiRequest]);

  useEffect(() => {
    loadStaff();
  }, [loadStaff]);

  // Success messages dismiss themselves
  useEffect(() => {
    if (!success) return undefined;

    const timer = setTimeout(() => setSuccess(""), 6000);
    return () => clearTimeout(timer);
  }, [success]);

  // Escape closes whichever dialog is open
  useEffect(() => {
    if (!showModal && !confirmAction) return undefined;

    const onKeyDown = (event) => {
      if (event.key !== "Escape" || saving || busyKey) return;

      if (confirmAction) setConfirmAction(null);
      else closeModal();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showModal, confirmAction, saving, busyKey]);

  // ---------------------------------------------------------
  // Derived data
  // ---------------------------------------------------------

  const filteredStaff = useMemo(() => {
    const query = search.trim().toLowerCase();

    return staff.filter((user) => {
      const matchesSearch =
        !query ||
        user.name?.toLowerCase().includes(query) ||
        user.email?.toLowerCase().includes(query) ||
        user.department?.toLowerCase().includes(query) ||
        getUserDepartments(user).some((slug) =>
          departmentName(slug).toLowerCase().includes(query)
        );

      const matchesRole = roleFilter === "All" || user.role === roleFilter;

      const matchesStatus =
        statusFilter === "All" || user.displayStatus === statusFilter;

      return matchesSearch && matchesRole && matchesStatus;
    });
  }, [staff, search, roleFilter, statusFilter]);

  const counts = useMemo(
    () => ({
      total: staff.length,
      active: staff.filter((u) => u.displayStatus === "Active").length,
      pending: staff.filter((u) => u.displayStatus === "Pending").length,
      inactive: staff.filter((u) => u.displayStatus === "Inactive").length,
      administrators: staff.filter((u) => u.role === "Administrator").length,
    }),
    [staff]
  );

  const filtersActive =
    search.trim() !== "" || roleFilter !== "All" || statusFilter !== "All";

  const clearFilters = () => {
    setSearch("");
    setRoleFilter("All");
    setStatusFilter("All");
  };

  const isSelf = (user) =>
    !!currentEmail && user.email?.trim().toLowerCase() === currentEmail;

  // ---------------------------------------------------------
  // Form and modal
  // ---------------------------------------------------------

  const handleInputChange = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  };

  const toggleDepartment = (slug) =>
    setForm((current) => ({
      ...current,
      departments: current.departments.includes(slug)
        ? current.departments.filter((item) => item !== slug)
        : [...current.departments, slug],
    }));

  const openAddModal = () => {
    setEditingUser(null);
    setForm(EMPTY_FORM);
    setModalError("");
    setSuccess("");
    setShowModal(true);
  };

  const openEditModal = (user) => {
    setEditingUser(user);
    setForm({
      name: user.name || "",
      email: user.email || "",
      departments: getUserDepartments(user),
      role: user.role || "Staff",
      temporaryPassword: "",
    });
    setModalError("");
    setSuccess("");
    setShowModal(true);
  };

  function closeModal() {
    if (saving) return;

    setShowModal(false);
    setEditingUser(null);
    setForm(EMPTY_FORM);
    setModalError("");
  }

  // ---------------------------------------------------------
  // Create / update
  // ---------------------------------------------------------

  const handleSubmit = async (event) => {
    event.preventDefault();

    setModalError("");
    setSuccess("");

    const name = form.name.trim();
    const email = form.email.trim().toLowerCase();

    if (!name) {
      setModalError("Please enter the staff member's full name.");
      return;
    }

    if (!editingUser && !email) {
      setModalError("Please enter the staff member's email address.");
      return;
    }

    if (!editingUser && form.temporaryPassword.length < MIN_PASSWORD_LENGTH) {
      setModalError(
        `Please set a temporary password of at least ${MIN_PASSWORD_LENGTH} characters, or use Generate.`
      );
      return;
    }

    // "departments" is the list of department slugs (drives access).
    // "department" is a readable label kept for the existing profile field.
    const departmentFields = {
      departments: form.departments,
      department: form.departments.map(departmentName).join(", "),
    };

    setSaving(true);

    try {
      if (editingUser) {
        await apiRequest(
          `/admin/users/${encodeURIComponent(userKey(editingUser))}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              name,
              ...departmentFields,
              role: form.role,
            }),
          }
        );

        setSuccess("Staff account updated successfully.");
      } else {
        await apiRequest("/admin/users", {
          method: "POST",
          body: JSON.stringify({
            name,
            email,
            ...departmentFields,
            role: form.role,
            temporaryPassword: form.temporaryPassword,
          }),
        });

        setSuccess(
          `Staff account created for ${email}. Share the temporary password with them directly. They will be asked to choose a new password the first time they sign in.`
        );
      }

      setShowModal(false);
      setEditingUser(null);
      setForm(EMPTY_FORM);

      await loadStaff();
    } catch (err) {
      if (err instanceof SessionError) return;

      console.error("Failed to save staff user:", err);
      setModalError(
        err.message ||
          (editingUser
            ? "Unable to update the staff account."
            : "Unable to create the staff account.")
      );
    } finally {
      setSaving(false);
    }
  };

  // ---------------------------------------------------------
  // Activate / deactivate / delete (via confirmation dialog)
  // ---------------------------------------------------------

  const runConfirmedAction = async () => {
    if (!confirmAction) return;

    const { type, user } = confirmAction;

    setBusyKey(userKey(user));
    setError("");
    setSuccess("");

    try {
      if (type === "delete") {
        await apiRequest(`/admin/users/${encodeURIComponent(userKey(user))}`, {
          method: "DELETE",
        });

        setSuccess("Staff account removed successfully.");
      } else {
        const enable = type === "activate";

        await apiRequest(
          `/admin/users/${encodeURIComponent(userKey(user))}/status`,
          {
            method: "PATCH",
            body: JSON.stringify({ enabled: enable }),
          }
        );

        setSuccess(
          `Account ${enable ? "activated" : "deactivated"} successfully.`
        );
      }

      setConfirmAction(null);
      await loadStaff();
    } catch (err) {
      if (err instanceof SessionError) return;

      console.error(`Failed to ${type} user:`, err);
      setConfirmAction(null);
      setError(err.message || "Unable to complete this action.");
    } finally {
      setBusyKey(null);
    }
  };

  // ---------------------------------------------------------
  // Render
  // ---------------------------------------------------------

  const summary = [
    { label: "Total users", value: counts.total, icon: Users },
    { label: "Active", value: counts.active, icon: UserCheck },
    {
      label: "Inactive",
      value: counts.inactive,
      note: counts.pending ? `${counts.pending} pending first sign-in` : null,
      icon: UserX,
    },
    { label: "Administrators", value: counts.administrators, icon: ShieldCheck },
  ];

  return (
    <div className="min-h-screen bg-[#F5F6F2] text-[#16211C]">
      <style>{FONT_CSS}</style>

      <div className="flex min-h-screen">
        <Sidebar
          mobileOpen={mobileSidebarOpen}
          onClose={() => setMobileSidebarOpen(false)}
        />

        <div className="min-w-0 flex-1">
          <Header
            email={currentEmail}
            onMenuClick={() => setMobileSidebarOpen(true)}
            onLogout={handleLogout}
          />

          <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            {/* PAGE HEADER */}
            <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-sm text-slate-500">
                  Administration <span aria-hidden="true">/</span> Staff users
                </p>

                <h1 className="eachr-display mt-2 text-3xl font-semibold tracking-tight">
                  Staff users
                </h1>

                <p className="mt-1.5 max-w-xl text-sm leading-6 text-slate-500">
                  Create accounts, assign roles and departments, and control who
                  can sign in to the staff portal.
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={loadStaff}
                  disabled={loading}
                  className="eachr-focus eachr-motion inline-flex items-center gap-2 rounded-lg border border-[#DDE2DB] bg-white px-4 py-2.5 text-sm font-semibold text-[#16211C] transition hover:bg-[#F5F6F2] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <RefreshCw
                    size={16}
                    className={loading ? "animate-spin" : ""}
                  />
                  Refresh
                </button>

                <button
                  type="button"
                  onClick={openAddModal}
                  className="eachr-focus eachr-motion inline-flex items-center gap-2 rounded-lg bg-[#0F3D2E] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#0B2F23]"
                >
                  <UserPlus size={17} />
                  Add staff user
                </button>
              </div>
            </div>

            {/* NOTICES */}
            {error && (
              <div
                role="alert"
                className="mb-5 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
              >
                <AlertCircle size={19} className="mt-0.5 shrink-0" />

                <div className="min-w-0 flex-1">
                  <p className="font-semibold">Something went wrong</p>
                  <p className="mt-1">{error}</p>
                </div>

                <button
                  type="button"
                  onClick={() => setError("")}
                  aria-label="Dismiss message"
                  className="eachr-focus rounded p-1 hover:bg-red-100"
                >
                  <X size={16} />
                </button>
              </div>
            )}

            {success && (
              <div
                role="status"
                className="mb-5 flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"
              >
                <CheckCircle2 size={19} className="mt-0.5 shrink-0" />

                <p className="min-w-0 flex-1">{success}</p>

                <button
                  type="button"
                  onClick={() => setSuccess("")}
                  aria-label="Dismiss message"
                  className="eachr-focus rounded p-1 hover:bg-emerald-100"
                >
                  <X size={16} />
                </button>
              </div>
            )}

            {/* SUMMARY STRIP */}
            <section
              aria-label="Staff summary"
              className="mb-6 grid overflow-hidden rounded-2xl border border-[#DDE2DB] bg-white sm:grid-cols-2 xl:grid-cols-4"
            >
              {summary.map((item, index) => {
                const Icon = item.icon;

                return (
                  <div
                    key={item.label}
                    className={`p-5 sm:p-6 ${
                      index > 0
                        ? "border-t border-[#DDE2DB] sm:[&:nth-child(2)]:border-t-0 xl:border-t-0"
                        : ""
                    } ${
                      index % 2 === 1 ? "sm:border-l sm:border-[#DDE2DB]" : ""
                    } ${index > 0 ? "xl:border-l xl:border-[#DDE2DB]" : ""}`}
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-slate-500">
                        {item.label}
                      </p>
                      <Icon size={18} className="text-[#2F6B4F]" />
                    </div>

                    <p className="eachr-display mt-3 text-3xl font-semibold tracking-tight">
                      {loading ? "–" : item.value}
                    </p>

                    {item.note && !loading && (
                      <p className="mt-1 text-xs text-slate-500">{item.note}</p>
                    )}
                  </div>
                );
              })}
            </section>

            {/* TABLE CARD */}
            <section className="overflow-hidden rounded-2xl border border-[#DDE2DB] bg-white">
              {/* Filters */}
              <div className="grid gap-3 border-b border-[#DDE2DB] p-4 sm:p-5 lg:grid-cols-[1fr_180px_180px]">
                <div className="relative">
                  <Search
                    size={17}
                    aria-hidden="true"
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
                  />

                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search by name, email or department"
                    aria-label="Search staff"
                    className="eachr-focus w-full rounded-lg border border-[#DDE2DB] bg-[#F5F6F2] py-2.5 pl-10 pr-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-[#2F6B4F] focus:bg-white"
                  />
                </div>

                <select
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value)}
                  aria-label="Filter by role"
                  className="eachr-focus rounded-lg border border-[#DDE2DB] bg-[#F5F6F2] px-3 py-2.5 text-sm outline-none focus:border-[#2F6B4F]"
                >
                  <option value="All">All roles</option>
                  {ROLE_OPTIONS.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>

                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  aria-label="Filter by status"
                  className="eachr-focus rounded-lg border border-[#DDE2DB] bg-[#F5F6F2] px-3 py-2.5 text-sm outline-none focus:border-[#2F6B4F]"
                >
                  <option value="All">All statuses</option>
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </div>

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[880px]">
                  <thead>
                    <tr className="border-b border-[#DDE2DB] bg-[#F5F6F2]">
                      {[
                        ["Staff member", "text-left"],
                        ["Departments", "text-left"],
                        ["Role", "text-left"],
                        ["Status", "text-left"],
                        ["Added", "text-left"],
                        ["Actions", "text-right"],
                      ].map(([label, align]) => (
                        <th
                          key={label}
                          scope="col"
                          className={`px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-slate-500 ${align}`}
                        >
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-[#E8ECE6]">
                    {loading ? (
                      <tr>
                        <td colSpan={6} className="px-6 py-16 text-center">
                          <Loader2
                            size={28}
                            className="eachr-motion mx-auto mb-3 animate-spin text-[#2F6B4F]"
                          />
                          <p className="text-sm font-medium">
                            Loading staff users...
                          </p>
                          <p className="mt-1 text-xs text-slate-400">
                            Retrieving accounts from AWS Cognito
                          </p>
                        </td>
                      </tr>
                    ) : filteredStaff.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-6 py-16 text-center">
                          <div className="mx-auto flex max-w-md flex-col items-center">
                            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#E8F0EB] text-[#0F3D2E]">
                              <Users size={22} />
                            </div>

                            <h3 className="mt-4 text-sm font-semibold">
                              {staff.length === 0
                                ? "No staff users yet"
                                : "No matching staff users"}
                            </h3>

                            <p className="mt-1 text-sm leading-6 text-slate-500">
                              {staff.length === 0
                                ? "Create the first staff account to give a team member access to the portal."
                                : "Try changing your search or filters."}
                            </p>

                            {staff.length === 0 ? (
                              <button
                                type="button"
                                onClick={openAddModal}
                                className="eachr-focus eachr-motion mt-5 inline-flex items-center gap-2 rounded-lg bg-[#0F3D2E] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#0B2F23]"
                              >
                                <UserPlus size={16} />
                                Create first staff user
                              </button>
                            ) : (
                              filtersActive && (
                                <button
                                  type="button"
                                  onClick={clearFilters}
                                  className="eachr-focus mt-4 text-sm font-semibold text-[#2F6B4F] hover:underline"
                                >
                                  Clear filters
                                </button>
                              )
                            )}
                          </div>
                        </td>
                      </tr>
                    ) : (
                      filteredStaff.map((user) => {
                        const key = userKey(user);
                        const self = isSelf(user);
                        const rowBusy = busyKey === key;
                        const isInactive = user.displayStatus === "Inactive";
                        const userDepartments = getUserDepartments(user);

                        return (
                          <tr
                            key={key}
                            className={`transition hover:bg-[#F5F6F2]/70 ${
                              rowBusy ? "opacity-60" : ""
                            }`}
                          >
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-3">
                                <div
                                  aria-hidden="true"
                                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#E8F0EB] text-sm font-semibold text-[#0F3D2E]"
                                >
                                  {getInitials(user.name || user.email)}
                                </div>

                                <div className="min-w-0">
                                  <p className="truncate text-sm font-semibold">
                                    {user.name || "Unnamed user"}
                                    {self && (
                                      <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
                                        You
                                      </span>
                                    )}
                                  </p>

                                  <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
                                    <Mail size={12} aria-hidden="true" />
                                    <span className="truncate">{user.email}</span>
                                  </p>
                                </div>
                              </div>
                            </td>

                            <td className="px-6 py-4 text-sm text-slate-700">
                              {user.role === "Administrator" ? (
                                <span className="text-slate-500">All departments</span>
                              ) : userDepartments.length > 0 ? (
                                <div className="flex max-w-xs flex-wrap gap-1.5">
                                  {userDepartments.map((slug) => (
                                    <span
                                      key={slug}
                                      className="rounded-md bg-[#EEF2EC] px-2 py-0.5 text-xs font-medium text-slate-700"
                                    >
                                      {slug === "ceo" ? "Executive Director" : departmentName(slug)}
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-slate-400">
                                  {user.department || "None assigned"}
                                </span>
                              )}
                            </td>

                            <td className="px-6 py-4">
                              <RoleBadge role={user.role || "Staff"} />
                            </td>

                            <td className="px-6 py-4">
                              <StatusBadge status={user.displayStatus} />
                            </td>

                            <td className="px-6 py-4 text-sm text-slate-500">
                              {formatAdded(user.createdAt)}
                            </td>

                            <td className="px-6 py-4">
                              <div className="flex items-center justify-end gap-1">
                                <IconButton
                                  label={`Edit ${user.name || user.email}`}
                                  onClick={() => openEditModal(user)}
                                  disabled={rowBusy}
                                >
                                  <Edit size={16} />
                                </IconButton>

                                {!self && (
                                  <IconButton
                                    label={`${
                                      isInactive ? "Activate" : "Deactivate"
                                    } ${user.name || user.email}`}
                                    onClick={() =>
                                      setConfirmAction({
                                        type: isInactive
                                          ? "activate"
                                          : "deactivate",
                                        user,
                                      })
                                    }
                                    disabled={rowBusy}
                                  >
                                    {isInactive ? (
                                      <UserCheck size={16} />
                                    ) : (
                                      <UserX size={16} />
                                    )}
                                  </IconButton>
                                )}

                                {!self && (
                                  <IconButton
                                    label={`Remove ${user.name || user.email}`}
                                    onClick={() =>
                                      setConfirmAction({ type: "delete", user })
                                    }
                                    disabled={rowBusy}
                                    danger
                                  >
                                    <Trash2 size={16} />
                                  </IconButton>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {!loading && filteredStaff.length > 0 && (
                <div className="border-t border-[#E8ECE6] px-6 py-4">
                  <p className="text-xs text-slate-500">
                    Showing{" "}
                    <span className="font-semibold text-[#16211C]">
                      {filteredStaff.length}
                    </span>{" "}
                    of{" "}
                    <span className="font-semibold text-[#16211C]">
                      {staff.length}
                    </span>{" "}
                    staff users
                  </p>
                </div>
              )}
            </section>
          </main>
        </div>
      </div>

      {/* ADD / EDIT MODAL */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/50 p-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="staff-modal-title"
            className="my-auto w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl"
          >
            <div className="flex items-start justify-between border-b border-[#DDE2DB] px-6 py-5">
              <div>
                <h2
                  id="staff-modal-title"
                  className="eachr-display text-xl font-semibold"
                >
                  {editingUser ? "Edit staff user" : "Add staff user"}
                </h2>

                <p className="mt-1 text-sm text-slate-500">
                  {editingUser
                    ? "Update this staff member's account details."
                    : "Create a new staff account in AWS Cognito."}
                </p>
              </div>

              <button
                type="button"
                onClick={closeModal}
                disabled={saving}
                aria-label="Close"
                className="eachr-focus rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
              >
                <X size={19} />
              </button>
            </div>

            <form onSubmit={handleSubmit} noValidate>
              <div className="space-y-5 px-6 py-6">
                <Field id="staff-name" label="Full name">
                  <input
                    id="staff-name"
                    type="text"
                    name="name"
                    value={form.name}
                    onChange={handleInputChange}
                    placeholder="Enter the staff member's full name"
                    disabled={saving}
                    autoFocus
                    required
                    className={INPUT_CLASS}
                  />
                </Field>

                <Field
                  id="staff-email"
                  label="Email address"
                  hint={
                    editingUser
                      ? "The sign-in email cannot be changed here."
                      : null
                  }
                >
                  <input
                    id="staff-email"
                    type="email"
                    name="email"
                    value={form.email}
                    onChange={handleInputChange}
                    placeholder="staff@eachrights.or.ke"
                    disabled={saving || !!editingUser}
                    autoComplete="off"
                    required
                    className={INPUT_CLASS}
                  />
                </Field>

                <Field id="staff-role" label="Account role">
                  <select
                    id="staff-role"
                    name="role"
                    value={form.role}
                    onChange={handleInputChange}
                    disabled={saving}
                    className={INPUT_CLASS}
                  >
                    {ROLE_OPTIONS.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                </Field>

                <fieldset disabled={saving}>
                  <legend className="mb-1 block text-sm font-semibold">
                    Departments
                  </legend>

                  <p className="mb-2.5 text-xs text-slate-400">
                    Choose every department this person can open. They can only
                    see files in the departments ticked here. Administrators
                    always see everything.
                  </p>

                  <div className="grid gap-2 sm:grid-cols-2">
                    {ACCESS_OPTIONS.map((option) => {
                      const checked = form.departments.includes(option.slug);

                      return (
                        <label
                          key={option.slug}
                          className={`eachr-motion flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm transition ${
                            checked
                              ? "border-[#2F6B4F] bg-[#F3F7F4]"
                              : "border-[#DDE2DB] hover:bg-[#F5F6F2]"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleDepartment(option.slug)}
                            className="mt-0.5 h-4 w-4 shrink-0 accent-[#0F3D2E]"
                          />
                          <span className="min-w-0 leading-5">{option.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>

                {!editingUser && (
                  <Field
                    id="staff-temp-password"
                    label="Temporary password"
                    hint="Share this with the staff member securely. They must choose a new password at first sign-in. Email delivery is not used."
                  >
                    <div className="flex gap-2">
                      <input
                        id="staff-temp-password"
                        type="text"
                        name="temporaryPassword"
                        value={form.temporaryPassword}
                        onChange={handleInputChange}
                        placeholder="At least 8 characters"
                        disabled={saving}
                        autoComplete="off"
                        spellCheck={false}
                        required
                        className={`${INPUT_CLASS} font-mono`}
                      />

                      <button
                        type="button"
                        onClick={() =>
                          setForm((current) => ({
                            ...current,
                            temporaryPassword: generateTemporaryPassword(),
                          }))
                        }
                        disabled={saving}
                        className="eachr-focus eachr-motion inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[#DDE2DB] bg-white px-3.5 py-2.5 text-sm font-semibold transition hover:bg-[#F5F6F2] disabled:opacity-50"
                      >
                        <RefreshCw size={15} />
                        Generate
                      </button>
                    </div>
                  </Field>
                )}

                {modalError && (
                  <div
                    role="alert"
                    className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"
                  >
                    <AlertCircle size={17} className="mt-0.5 shrink-0" />
                    <p>{modalError}</p>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-[#DDE2DB] bg-[#F5F6F2] px-6 py-4">
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={saving}
                  className="eachr-focus eachr-motion rounded-lg border border-[#DDE2DB] bg-white px-4 py-2.5 text-sm font-semibold transition hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={saving}
                  className="eachr-focus eachr-motion inline-flex items-center gap-2 rounded-lg bg-[#0F3D2E] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#0B2F23] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      {editingUser ? "Saving..." : "Creating..."}
                    </>
                  ) : editingUser ? (
                    <>
                      <CheckCircle2 size={16} />
                      Save changes
                    </>
                  ) : (
                    <>
                      <UserPlus size={16} />
                      Create staff user
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CONFIRMATION DIALOG */}
      {confirmAction && (
        <ConfirmDialog
          action={confirmAction}
          busy={!!busyKey}
          onCancel={() => setConfirmAction(null)}
          onConfirm={runConfirmedAction}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------
// Helper components
// ---------------------------------------------------------

const INPUT_CLASS =
  "eachr-focus w-full rounded-lg border border-[#DDE2DB] bg-white px-3.5 py-2.5 text-sm outline-none transition placeholder:text-slate-400 focus:border-[#2F6B4F] disabled:bg-slate-50 disabled:text-slate-500";

function Field({ id, label, hint, children }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold">
        {label}
      </label>

      {children}

      {hint && <p className="mt-1.5 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

function IconButton({ label, onClick, disabled, danger = false, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`eachr-focus eachr-motion rounded-lg p-2 transition disabled:cursor-not-allowed disabled:opacity-40 ${
        danger
          ? "text-slate-500 hover:bg-red-50 hover:text-red-600"
          : "text-slate-500 hover:bg-[#E8F0EB] hover:text-[#0F3D2E]"
      }`}
    >
      {children}
    </button>
  );
}

function ConfirmDialog({ action, busy, onCancel, onConfirm }) {
  const { type, user } = action;
  const name = user.name || user.email;

  const copy = {
    delete: {
      title: "Remove staff user?",
      body: `${name} will be permanently deleted from AWS Cognito and will no longer be able to sign in. This cannot be undone.`,
      confirm: "Remove user",
      danger: true,
    },
    deactivate: {
      title: "Deactivate account?",
      body: `${name} will be signed out and unable to sign in until the account is activated again.`,
      confirm: "Deactivate",
      danger: true,
    },
    activate: {
      title: "Activate account?",
      body: `${name} will be able to sign in to the staff portal again.`,
      confirm: "Activate",
      danger: false,
    },
  }[type];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-body"
        className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        <div className="flex items-start gap-4 px-6 py-6">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
              copy.danger
                ? "bg-red-50 text-red-600"
                : "bg-[#E8F0EB] text-[#0F3D2E]"
            }`}
          >
            <AlertTriangle size={19} />
          </div>

          <div>
            <h2 id="confirm-title" className="text-base font-semibold">
              {copy.title}
            </h2>

            <p id="confirm-body" className="mt-1.5 text-sm leading-6 text-slate-600">
              {copy.body}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-[#DDE2DB] bg-[#F5F6F2] px-6 py-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            autoFocus
            className="eachr-focus eachr-motion rounded-lg border border-[#DDE2DB] bg-white px-4 py-2.5 text-sm font-semibold transition hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`eachr-focus eachr-motion inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-60 ${
              copy.danger
                ? "bg-red-600 hover:bg-red-700"
                : "bg-[#0F3D2E] hover:bg-[#0B2F23]"
            }`}
          >
            {busy && <Loader2 size={16} className="animate-spin" />}
            {copy.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}

function RoleBadge({ role }) {
  const styles = {
    Administrator: "border-[#E3D3F0] bg-[#F5EEFA] text-[#5B2A86]",
    Finance: "border-[#F0DDB0] bg-[#F7EBD3] text-[#7A5718]",
    Staff: "border-[#DDE2DB] bg-slate-50 text-slate-700",
  };

  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${
        styles[role] || styles.Staff
      }`}
    >
      {role}
    </span>
  );
}

function StatusBadge({ status }) {
  if (status === "Inactive") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-red-100 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700">
        <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
        Inactive
      </span>
    );
  }

  if (status === "Pending") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-100 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
        <Clock size={12} />
        Pending
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
      Active
    </span>
  );
}

function getInitials(name = "") {
  const parts = name.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) return "U";

  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default StaffUsers;
