import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  Plus,
  Search,
  Download,
  Eye,
  X,
  CalendarDays,
  Clock,
  Pencil,
  Trash2,
  Check,
  Paperclip,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
} from "lucide-react";

import { financeApi } from "./financeApi"; // same folder: src/pages/services/financeApi.js
import TravelFinanceQueue from "./TravelFinanceQueue";

/* =====================================================================
   Configuration
   ===================================================================== */

const PAGE_SIZE = 8;

// Expenses must have at least one receipt or invoice attached.
const RECEIPT_REQUIRED_FOR_EXPENSES = true;
const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
const ALLOWED_RECEIPT_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"];

const CATEGORIES = ["Operations", "Programme", "Capacity Building", "Office", "Travel", "Income", "Other"];
const STATUSES = ["Pending", "Approved", "Rejected"];

const STATUS_STYLES = {
  Pending: "bg-amber-100 text-amber-700",
  Approved: "bg-green-100 text-green-700",
  Rejected: "bg-red-100 text-red-700",
};

const INITIAL_FILTERS = {
  type: "all",
  category: "all",
  status: "all",
  donorId: "all",
  projectId: "all",
  from: "",
  to: "",
  q: "",
};

/* =====================================================================
   Formatting helpers
   ===================================================================== */

const today = () => new Date().toISOString().slice(0, 10);

const formatCurrency = (amount) =>
  new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(amount || 0);

const formatDate = (iso) => {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

const formatDateTime = (iso) => {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
};

const formatSize = (bytes) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const emptyForm = (projectId = "") => ({
  description: "",
  category: "Operations",
  amount: "",
  type: "expense",
  date: today(),
  reference: "", // left blank = the server generates the next EXP-/INC- number
  donorId: "",
  projectId: projectId ? String(projectId) : "",
  notes: "",
});

const inputClass =
  "w-full rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none focus:border-green-600 focus:ring-2 focus:ring-green-100";

/* =====================================================================
   Small components
   ===================================================================== */

function SortHeader({ label, sortKey, sort, onToggle }) {
  return (
    <button
      type="button"
      onClick={() => onToggle(sortKey)}
      className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-gray-800"
    >
      {label}
      <ArrowUpDown size={13} className={sort.key === sortKey ? "text-green-700" : "text-gray-400"} />
    </button>
  );
}

// A select over {id, name} options. When `onAdd` is given, "+ Add new…" reveals an inline input.
// `onAdd(name)` must return the created {id, name}.
function ListSelect({ label, hint, value, options, onChange, onAdd, placeholder, error }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [addError, setAddError] = useState("");

  const commit = async () => {
    const name = draft.trim();
    if (!name || busy) return;
    const existing = options.find((o) => o.name.toLowerCase() === name.toLowerCase());
    try {
      setBusy(true);
      const chosen = existing || (await onAdd(name));
      onChange(String(chosen.id));
      setDraft("");
      setAddError("");
      setAdding(false);
    } catch (e) {
      setAddError(e.message || "Could not add this.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <label className="mb-2 block text-sm font-medium text-gray-700">
        {label} {hint && <span className="font-normal text-gray-400">({hint})</span>}
      </label>

      {adding ? (
        <div className="flex gap-2">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              }
              if (e.key === "Escape") setAdding(false);
            }}
            placeholder="Enter a name"
            className={inputClass}
            autoFocus
          />
          <button
            type="button"
            onClick={commit}
            disabled={busy}
            className="rounded-lg bg-green-700 px-3 text-sm font-medium text-white hover:bg-green-800 disabled:opacity-60"
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => setAdding(false)}
            className="rounded-lg border border-gray-300 px-3 text-sm text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      ) : (
        <select
          value={value}
          onChange={(e) => (e.target.value === "__new__" ? setAdding(true) : onChange(e.target.value))}
          className={inputClass}
        >
          <option value="">{placeholder}</option>
          {options.map((o) => (
            <option key={o.id} value={String(o.id)}>{o.name}</option>
          ))}
          {onAdd && <option value="__new__">+ Add new…</option>}
        </select>
      )}
      {(addError || error) && <p className="mt-1 text-xs text-red-600">{addError || error}</p>}
    </div>
  );
}

/* =====================================================================
   Page
   Pass `projectId` to show only one project's finances, e.g. on a project's detail page:
     <Finance projectId={project.id} />
   ===================================================================== */

function Finance({ projectId: scopeProjectId = null }) {
  const year = new Date().getFullYear();

  // Server data
  const [me, setMe] = useState(null);
  const [accessError, setAccessError] = useState("");
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState({
    income: 0, expenses: 0, pendingCount: 0, pendingNet: 0, totalCount: 0,
    breakdown: { category: [], project: [], donor: [] },
  });
  const [budget, setBudget] = useState({ amount: 0, spent: 0 });
  const [donors, setDonors] = useState([]);
  const [projects, setProjects] = useState([]);
  const [reloadKey, setReloadKey] = useState(0);

  // Filters, sorting, paging
  const [searchInput, setSearchInput] = useState("");
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [sort, setSort] = useState({ key: "date", dir: "desc" });
  const [page, setPage] = useState(1);

  // Form
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState(() => emptyForm(scopeProjectId));
  const [keptReceipts, setKeptReceipts] = useState([]);
  const [newFiles, setNewFiles] = useState([]);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  // Dialogs
  const [viewing, setViewing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [budgetInput, setBudgetInput] = useState("");
  const [breakdownView, setBreakdownView] = useState("category");
  const [toast, setToast] = useState("");

  /* ---------- Permissions (the Lambda enforces the same rules) ---------- */
  const isApprover = !!me?.isApprover;
  const myId = me?.id;

  const canApprove = (t) => isApprover && t.status === "Pending" && t.submittedById !== myId;
  const canEdit = (t) => isApprover || (t.submittedById === myId && t.status !== "Approved");
  const canDelete = (t) => t.status !== "Approved" && (isApprover || t.submittedById === myId);

  /* ---------- Loading data ---------- */
  const refreshSummary = useCallback(() => {
    financeApi
      .getSummary(scopeProjectId)
      .then((res) =>
        setSummary((prev) => ({ ...prev, ...res, breakdown: { ...prev.breakdown, ...(res.breakdown || {}) } }))
      )
      .catch((e) => setToast(e.message));
    financeApi
      .getBudget(year, scopeProjectId)
      .then((res) => setBudget((prev) => ({ ...prev, ...res })))
      .catch(() => {});
  }, [scopeProjectId, year]);

  const refreshAll = () => {
    refreshSummary();
    setReloadKey((k) => k + 1);
  };

  useEffect(() => {
    financeApi
      .getMe()
      .then(setMe)
      .catch((e) => setAccessError(e.message || "You do not have access to Finance."));
    financeApi.listDonors().then(setDonors).catch(() => {});
    financeApi
      .listProjects()
      .then((res) => setProjects(Array.isArray(res) ? res : res.items || []))
      .catch(() => {});
    refreshSummary();
  }, [refreshSummary]);

  // Debounce the search box so we don't call the API on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((prev) => (prev.q === searchInput.trim() ? prev : { ...prev, q: searchInput.trim() }));
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Filters sent to the API (used by the table and by CSV export).
  const filterParams = useCallback(
    () => ({
      ...filters,
      projectId: scopeProjectId || filters.projectId,
      sort: sort.key,
      dir: sort.dir,
    }),
    [filters, sort, scopeProjectId]
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    financeApi
      .listTransactions({ ...filterParams(), page, pageSize: PAGE_SIZE })
      .then((res) => {
        if (!active) return;
        setItems(res.items || []);
        setTotal(res.total || 0);
      })
      .catch((e) => active && setToast(e.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [filterParams, page, reloadKey]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const balance = summary.income - summary.expenses;
  const utilisation = budget.amount > 0 ? (budget.spent / budget.amount) * 100 : 0;
  const remaining = budget.amount - budget.spent;

  const breakdownRows = summary.breakdown[breakdownView] || [];
  const breakdownTotal = breakdownRows.reduce((s, r) => s + r.amount, 0);

  const setFilter = (name, value) => {
    setFilters((prev) => ({ ...prev, [name]: value }));
    setPage(1);
  };

  const hasActiveFilters =
    searchInput ||
    filters.type !== "all" || filters.category !== "all" || filters.status !== "all" ||
    filters.donorId !== "all" || (!scopeProjectId && filters.projectId !== "all") ||
    filters.from || filters.to;

  const clearFilters = () => {
    setSearchInput("");
    setFilters(INITIAL_FILTERS);
    setPage(1);
  };

  const toggleSort = (key) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "description" ? "asc" : "desc" }
    );
    setPage(1);
  };

  /* ---------- Form handling ---------- */
  const openAdd = () => {
    setEditingId(null);
    setFormData(emptyForm(scopeProjectId));
    setKeptReceipts([]);
    setNewFiles([]);
    setErrors({});
    setShowForm(true);
  };

  const openEdit = (transaction) => {
    setEditingId(transaction.id);
    setFormData({
      description: transaction.description,
      category: transaction.category,
      amount: String(transaction.amount),
      type: transaction.type,
      date: transaction.date,
      reference: transaction.reference,
      donorId: transaction.donorId ? String(transaction.donorId) : "",
      projectId: transaction.projectId ? String(transaction.projectId) : "",
      notes: transaction.notes || "",
    });
    setKeptReceipts(transaction.receipts || []);
    setNewFiles([]);
    setErrors({});
    setViewing(null);
    setShowForm(true);
  };

  const closeForm = () => {
    if (saving) return;
    setShowForm(false);
    setEditingId(null);
    setErrors({});
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => {
      const next = { ...prev, [name]: value };
      if (name === "type") {
        if (value === "income") next.category = "Income";
        else if (prev.category === "Income") next.category = "Operations";
      }
      return next;
    });
    setErrors((prev) => ({ ...prev, [name]: undefined }));
  };

  const setField = (name, value) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => ({ ...prev, [name]: undefined }));
  };

  const handleFilesChosen = (e) => {
    const chosen = Array.from(e.target.files || []);
    e.target.value = "";
    if (chosen.length === 0) return;

    const problems = [];
    const accepted = [];
    chosen.forEach((file) => {
      if (!ALLOWED_RECEIPT_TYPES.includes(file.type)) problems.push(`${file.name}: use a PDF, PNG, JPG or WebP file.`);
      else if (file.size > MAX_RECEIPT_BYTES) problems.push(`${file.name}: files must be under 5 MB.`);
      else accepted.push(file);
    });

    setNewFiles((prev) => [...prev, ...accepted]);
    setErrors((prev) => ({ ...prev, receipts: problems.length ? problems.join(" ") : undefined }));
  };

  // Quick checks for instant feedback; the Lambda repeats them (and checks reference uniqueness).
  const validate = () => {
    const found = {};
    if (!formData.description.trim()) found.description = "Enter a description.";
    if (!formData.amount || Number(formData.amount) <= 0) found.amount = "Enter an amount greater than 0.";
    if (!formData.date) found.date = "Choose a date.";
    if (formData.type === "income" && !formData.donorId) found.donorId = "Choose the donor or funding source.";
    if (formData.type === "expense" && !formData.projectId) found.projectId = "Choose the project this cost belongs to.";
    if (
      RECEIPT_REQUIRED_FOR_EXPENSES &&
      formData.type === "expense" &&
      keptReceipts.length + newFiles.length === 0
    )
      found.receipts = "Attach at least one receipt or invoice.";

    setErrors(found);
    return Object.keys(found).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    setSaving(true);
    const uploaded = [];

    try {
      for (const file of newFiles) uploaded.push(await financeApi.uploadReceipt(file));

      const body = {
        ...formData,
        amount: Number(formData.amount),
        projectId: formData.projectId ? Number(formData.projectId) : null,
        donorId: formData.donorId ? Number(formData.donorId) : null,
        receiptIds: [...keptReceipts, ...uploaded].map((r) => r.id),
      };

      if (editingId) {
        await financeApi.updateTransaction(editingId, body);
        setToast("Changes saved and sent for approval.");
      } else {
        await financeApi.createTransaction(body);
        setToast("Transaction submitted for approval.");
      }

      setShowForm(false);
      setEditingId(null);
      refreshAll();
    } catch (err) {
      // Files that already uploaded stay attached, so a retry doesn't upload them twice.
      if (uploaded.length) {
        setKeptReceipts((prev) => [...prev, ...uploaded]);
        setNewFiles([]);
      }
      const fieldErrors = err.fieldErrors || {};
      setErrors(Object.keys(fieldErrors).length ? fieldErrors : { form: err.message || "Could not save." });
    } finally {
      setSaving(false);
    }
  };

  /* ---------- Approval workflow ---------- */
  const approve = async (t) => {
    if (!canApprove(t)) return;
    try {
      await financeApi.approve(t.id);
      setToast(`${t.reference} approved.`);
      setViewing(null);
      refreshAll();
    } catch (e) {
      setToast(e.message);
    }
  };

  const startReject = (t) => {
    setRejecting(t);
    setRejectReason("");
  };

  const confirmReject = async (e) => {
    e.preventDefault();
    const reason = rejectReason.trim();
    if (!reason) return;
    try {
      await financeApi.reject(rejecting.id, reason);
      setToast(`${rejecting.reference} rejected.`);
      setRejecting(null);
      refreshAll();
    } catch (err) {
      setToast(err.message);
    }
  };

  const confirmDelete = async () => {
    try {
      await financeApi.deleteTransaction(deleting.id);
      setToast("Transaction deleted.");
      setDeleting(null);
      refreshAll();
    } catch (e) {
      setToast(e.message);
      setDeleting(null);
    }
  };

  /* ---------- Receipts ---------- */
  const openReceipt = async (receipt) => {
    try {
      await financeApi.openReceipt(receipt.id);
    } catch {
      setToast("The file could not be opened.");
    }
  };

  /* ---------- Budget ---------- */
  const openBudget = () => {
    setBudgetInput(String(budget.amount || ""));
    setShowBudgetModal(true);
  };

  const saveBudget = async (e) => {
    e.preventDefault();
    const value = Number(budgetInput);
    if (!value || value <= 0) return;
    try {
      await financeApi.setBudget({ year, projectId: scopeProjectId, amount: value });
      setShowBudgetModal(false);
      setToast("Budget updated.");
      refreshSummary();
    } catch (err) {
      setToast(err.message);
    }
  };

  /* ---------- Export ---------- */
  const handleExport = async () => {
    try {
      const { items: rowsToExport } = await financeApi.listTransactions({ ...filterParams(), page: 1, pageSize: 1000 });
      if (rowsToExport.length === 0) {
        setToast("There are no transactions to export.");
        return;
      }

      const escape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
      const header = [
        "Date", "Description", "Category", "Reference", "Type", "Amount (KES)", "Status",
        "Donor", "Project", "Receipts", "Submitted by", "Approved by", "Approved at", "Rejection reason", "Notes",
      ];
      const rows = rowsToExport.map((t) => [
        t.date, t.description, t.category, t.reference, t.type, t.amount, t.status,
        t.donor, t.project, (t.receipts || []).length, t.submittedBy, t.approvedBy,
        t.approvedAt ? formatDateTime(t.approvedAt) : "", t.rejectionReason, t.notes || "",
      ]);

      const csv = [header, ...rows].map((row) => row.map(escape).join(",")).join("\n");
      const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `transactions-${today()}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setToast(`Exported ${rowsToExport.length} transactions.`);
    } catch (e) {
      setToast(e.message || "Export failed.");
    }
  };

  const addDonor = async (name) => {
    const donor = await financeApi.createDonor(name);
    setDonors((prev) => (prev.some((d) => d.id === donor.id) ? prev : [...prev, donor].sort((a, b) => a.name.localeCompare(b.name))));
    return donor;
  };

  const barColor = utilisation > 100 ? "bg-red-600" : utilisation > 85 ? "bg-amber-500" : "bg-green-700";
  const breakdownTitle = {
    category: "Spending by category",
    project: "Spending by project",
    donor: "Income by donor",
  }[breakdownView];

  const scopeProject = scopeProjectId ? projects.find((p) => String(p.id) === String(scopeProjectId)) : null;

  if (accessError) {
    return (
      <div className="p-8">
        <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{accessError}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex">
        <main className="min-w-0 flex-1 p-6 lg:p-8">
          {/* Page Header */}
          <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="mb-2 flex items-center gap-2 text-sm text-gray-500">
                <Wallet size={16} />
                <span>Administration</span>
                <span>/</span>
                <span>Finance</span>
              </div>
              <h1 className="text-3xl font-bold text-gray-900">
                Finance{scopeProject ? ` · ${scopeProject.name}` : ""}
              </h1>
              <p className="mt-1 text-gray-600">
                Manage financial records, income, expenses and transactions.
              </p>
            </div>

            <button
              onClick={openAdd}
              disabled={!me}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-green-700 px-5 py-3 font-medium text-white transition hover:bg-green-800 disabled:opacity-60"
            >
              <Plus size={19} />
              Add Transaction
            </button>
          </div>

          {/* Summary Cards */}
          <div className="mb-8 grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-500">Total Income</p>
                  <h2 className="mt-2 text-2xl font-bold text-gray-900">{formatCurrency(summary.income)}</h2>
                  <p className="mt-1 text-xs text-gray-400">Approved only</p>
                </div>
                <div className="rounded-lg bg-green-100 p-3 text-green-700">
                  <TrendingUp size={24} />
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-500">Total Expenses</p>
                  <h2 className="mt-2 text-2xl font-bold text-gray-900">{formatCurrency(summary.expenses)}</h2>
                  <p className="mt-1 text-xs text-gray-400">Approved only</p>
                </div>
                <div className="rounded-lg bg-red-100 p-3 text-red-600">
                  <TrendingDown size={24} />
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-500">Available Balance</p>
                  <h2 className={`mt-2 text-2xl font-bold ${balance < 0 ? "text-red-600" : "text-gray-900"}`}>
                    {formatCurrency(balance)}
                  </h2>
                  <p className="mt-1 text-xs text-gray-400">{summary.totalCount} transactions in total</p>
                </div>
                <div className="rounded-lg bg-blue-100 p-3 text-blue-700">
                  <Wallet size={24} />
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setFilter("status", "Pending")}
              className="rounded-xl border border-gray-200 bg-white p-5 text-left shadow-sm transition hover:border-amber-300"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-500">Awaiting Approval</p>
                  <h2 className="mt-2 text-2xl font-bold text-gray-900">{summary.pendingCount}</h2>
                  <p className="mt-1 text-xs text-gray-400">
                    {summary.pendingCount > 0
                      ? `Net ${summary.pendingNet < 0 ? "-" : ""}${formatCurrency(Math.abs(summary.pendingNet))} · select to review`
                      : "Nothing to review"}
                  </p>
                </div>
                <div className="rounded-lg bg-amber-100 p-3 text-amber-700">
                  <Clock size={24} />
                </div>
              </div>
            </button>
          </div>

          {/* Budget Overview */}
          <div className="mb-8 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-5 flex items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Budget Overview</h2>
                <p className="text-sm text-gray-500">Budget utilisation for {year}</p>
              </div>

              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-gray-600">{utilisation.toFixed(1)}% utilised</span>
                {isApprover && (
                  <button
                    onClick={openBudget}
                    className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    {budget.amount > 0 ? "Edit budget" : "Set budget"}
                  </button>
                )}
              </div>
            </div>

            <div className="h-3 overflow-hidden rounded-full bg-gray-100">
              <div
                className={`h-full rounded-full transition-all ${barColor}`}
                style={{ width: `${Math.min(utilisation, 100)}%` }}
              />
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-500">Annual Budget</p>
                <p className="mt-1 font-semibold text-gray-900">
                  {budget.amount > 0 ? formatCurrency(budget.amount) : "Not set"}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-500">Spent</p>
                <p className="mt-1 font-semibold text-gray-900">{formatCurrency(budget.spent)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-500">
                  {remaining < 0 ? "Over budget" : "Remaining"}
                </p>
                <p className={`mt-1 font-semibold ${remaining < 0 ? "text-red-600" : "text-green-700"}`}>
                  {formatCurrency(Math.abs(remaining))}
                </p>
              </div>
            </div>

            <div className="mt-6 border-t border-gray-100 pt-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-gray-700">{breakdownTitle}</p>
                <div className="inline-flex overflow-hidden rounded-lg border border-gray-300 text-xs">
                  {[
                    ["category", "Category"],
                    ["project", "Project"],
                    ["donor", "Donor"],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      onClick={() => setBreakdownView(value)}
                      className={`px-3 py-1.5 font-medium ${
                        breakdownView === value ? "bg-green-700 text-white" : "bg-white text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {breakdownRows.length === 0 ? (
                <p className="text-sm text-gray-500">No approved transactions to show yet.</p>
              ) : (
                <div className="space-y-3">
                  {breakdownRows.map(({ label, amount }) => {
                    const share = breakdownTotal > 0 ? (amount / breakdownTotal) * 100 : 0;
                    return (
                      <div key={label}>
                        <div className="mb-1 flex justify-between text-sm">
                          <span className="text-gray-700">{label}</span>
                          <span className="text-gray-500">
                            {formatCurrency(amount)} · {share.toFixed(0)}%
                          </span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                          <div className="h-full rounded-full bg-green-600" style={{ width: `${share}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          {isApprover && !scopeProjectId && <TravelFinanceQueue onToast={setToast} />}
          {/* Transactions */}
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 p-6">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Transactions</h2>
                  <p className="text-sm text-gray-500">
                    {total} {hasActiveFilters ? "matching" : "in total"}
                  </p>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <div className="relative">
                    <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Search transactions..."
                      value={searchInput}
                      onChange={(e) => setSearchInput(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 py-2.5 pl-10 pr-4 text-sm outline-none focus:border-green-600 focus:ring-2 focus:ring-green-100 sm:w-64"
                    />
                  </div>

                  <button
                    onClick={handleExport}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    <Download size={17} />
                    Export CSV
                  </button>
                </div>
              </div>

              {/* Filters */}
              <div className="mt-4 flex flex-wrap items-end gap-3">
                <div className="inline-flex overflow-hidden rounded-lg border border-gray-300 text-sm">
                  {[
                    ["all", "All"],
                    ["income", "Income"],
                    ["expense", "Expenses"],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      onClick={() => setFilter("type", value)}
                      className={`px-4 py-2 font-medium ${
                        filters.type === value ? "bg-green-700 text-white" : "bg-white text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <select
                  value={filters.status}
                  onChange={(e) => setFilter("status", e.target.value)}
                  aria-label="Filter by status"
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-green-600"
                >
                  <option value="all">All statuses</option>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>

                <select
                  value={filters.category}
                  onChange={(e) => setFilter("category", e.target.value)}
                  aria-label="Filter by category"
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-green-600"
                >
                  <option value="all">All categories</option>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>

                {!scopeProjectId && (
                  <select
                    value={filters.projectId}
                    onChange={(e) => setFilter("projectId", e.target.value)}
                    aria-label="Filter by project"
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-green-600"
                  >
                    <option value="all">All projects</option>
                    {projects.map((p) => (
                      <option key={p.id} value={String(p.id)}>{p.name}</option>
                    ))}
                  </select>
                )}

                <select
                  value={filters.donorId}
                  onChange={(e) => setFilter("donorId", e.target.value)}
                  aria-label="Filter by donor"
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-green-600"
                >
                  <option value="all">All donors</option>
                  {donors.map((d) => (
                    <option key={d.id} value={String(d.id)}>{d.name}</option>
                  ))}
                </select>

                <label className="flex items-center gap-2 text-sm text-gray-600">
                  From
                  <input
                    type="date"
                    value={filters.from}
                    max={filters.to || undefined}
                    onChange={(e) => setFilter("from", e.target.value)}
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-green-600"
                  />
                </label>

                <label className="flex items-center gap-2 text-sm text-gray-600">
                  To
                  <input
                    type="date"
                    value={filters.to}
                    min={filters.from || undefined}
                    onChange={(e) => setFilter("to", e.target.value)}
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-green-600"
                  />
                </label>

                {hasActiveFilters && (
                  <button onClick={clearFilters} className="px-2 py-2 text-sm font-medium text-green-700 hover:underline">
                    Clear filters
                  </button>
                )}
              </div>
            </div>

            <div className={`overflow-x-auto transition-opacity ${loading ? "opacity-60" : ""}`}>
              <table className="w-full min-w-[1000px]">
                <thead className="bg-gray-50">
                  <tr className="text-left text-xs font-semibold text-gray-500">
                    <th className="px-6 py-4"><SortHeader label="Date" sortKey="date" sort={sort} onToggle={toggleSort} /></th>
                    <th className="px-6 py-4"><SortHeader label="Description" sortKey="description" sort={sort} onToggle={toggleSort} /></th>
                    <th className="px-6 py-4 uppercase tracking-wider">Project / Donor</th>
                    <th className="px-6 py-4 uppercase tracking-wider">Reference</th>
                    <th className="px-6 py-4"><SortHeader label="Amount" sortKey="amount" sort={sort} onToggle={toggleSort} /></th>
                    <th className="px-6 py-4 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-4 uppercase tracking-wider">Action</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-gray-100">
                  {items.length > 0 ? (
                    items.map((t) => (
                      <tr key={t.id} className="transition hover:bg-gray-50">
                        <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-600">{formatDate(t.date)}</td>

                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2 font-medium text-gray-900">
                            {t.description}
                            {(t.receipts || []).length > 0 && (
                              <span
                                className="inline-flex items-center gap-0.5 text-xs font-normal text-gray-400"
                                title={`${t.receipts.length} attached file(s)`}
                              >
                                <Paperclip size={13} />
                                {t.receipts.length}
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-gray-500">{t.category}</div>
                        </td>

                        <td className="px-6 py-4 text-sm text-gray-600">
                          <div>{t.project || <span className="text-gray-400">No project</span>}</div>
                          {t.donor && <div className="text-xs text-gray-500">{t.donor}</div>}
                        </td>

                        <td className="px-6 py-4 text-sm text-gray-500">{t.reference}</td>

                        <td
                          className={`whitespace-nowrap px-6 py-4 text-sm font-semibold ${
                            t.status === "Rejected"
                              ? "text-gray-400 line-through"
                              : t.type === "income"
                              ? "text-green-700"
                              : "text-red-600"
                          }`}
                        >
                          {t.type === "income" ? "+" : "-"}
                          {formatCurrency(t.amount)}
                        </td>

                        <td className="px-6 py-4">
                          <span className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${STATUS_STYLES[t.status]}`}>
                            {t.status}
                          </span>
                        </td>

                        <td className="px-6 py-4">
                          <div className="flex gap-1">
                            {canApprove(t) && (
                              <>
                                <button
                                  onClick={() => approve(t)}
                                  className="rounded-lg p-2 text-green-700 hover:bg-green-50"
                                  title="Approve"
                                >
                                  <Check size={18} />
                                </button>
                                <button
                                  onClick={() => startReject(t)}
                                  className="rounded-lg p-2 text-red-600 hover:bg-red-50"
                                  title="Reject"
                                >
                                  <X size={18} />
                                </button>
                              </>
                            )}
                            <button
                              onClick={() => setViewing(t)}
                              className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                              title="View transaction"
                            >
                              <Eye size={18} />
                            </button>
                            {canEdit(t) && (
                              <button
                                onClick={() => openEdit(t)}
                                className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                                title="Edit transaction"
                              >
                                <Pencil size={18} />
                              </button>
                            )}
                            {canDelete(t) && (
                              <button
                                onClick={() => setDeleting(t)}
                                className="rounded-lg p-2 text-gray-500 hover:bg-red-50 hover:text-red-600"
                                title="Delete transaction"
                              >
                                <Trash2 size={18} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="7" className="px-6 py-10 text-center text-sm text-gray-500">
                        {loading
                          ? "Loading transactions…"
                          : hasActiveFilters
                          ? "No transactions match your filters."
                          : "No transactions yet. Select Add Transaction to record the first one."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {total > PAGE_SIZE && (
              <div className="flex items-center justify-between border-t border-gray-200 px-6 py-4 text-sm text-gray-600">
                <span>Page {currentPage} of {totalPages}</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage(currentPage - 1)}
                    disabled={currentPage === 1}
                    className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 font-medium hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <ChevronLeft size={16} /> Previous
                  </button>
                  <button
                    onClick={() => setPage(currentPage + 1)}
                    disabled={currentPage === totalPages}
                    className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 font-medium hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Next <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Add / Edit Transaction Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
          <div className="my-8 w-full max-w-lg rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-200 p-6">
              <div>
                <h2 className="text-xl font-bold text-gray-900">
                  {editingId ? "Edit Transaction" : "Add Transaction"}
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  {editingId
                    ? "Saving sends this transaction back for approval."
                    : "It will be sent for approval once saved."}
                </p>
              </div>
              <button onClick={closeForm} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100" aria-label="Close">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5 p-6" noValidate>
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">Description</label>
                <input
                  type="text"
                  name="description"
                  value={formData.description}
                  onChange={handleInputChange}
                  placeholder="e.g. Office supplies"
                  className={inputClass}
                />
                {errors.description && <p className="mt-1 text-xs text-red-600">{errors.description}</p>}
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-medium text-gray-700">Transaction Type</label>
                  <select name="type" value={formData.type} onChange={handleInputChange} className={inputClass}>
                    <option value="expense">Expense</option>
                    <option value="income">Income</option>
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-gray-700">Category</label>
                  <select name="category" value={formData.category} onChange={handleInputChange} className={inputClass}>
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  {errors.category && <p className="mt-1 text-xs text-red-600">{errors.category}</p>}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <ListSelect
                  label="Donor / funding source"
                  hint={formData.type === "income" ? "required" : "optional"}
                  value={formData.donorId}
                  options={donors}
                  onChange={(v) => setField("donorId", v)}
                  onAdd={addDonor}
                  placeholder={formData.type === "income" ? "Choose a donor" : "None"}
                  error={errors.donorId}
                />

                <ListSelect
                  label="Project"
                  hint={formData.type === "expense" ? "required" : "optional"}
                  value={formData.projectId}
                  options={projects}
                  onChange={(v) => setField("projectId", v)}
                  placeholder={formData.type === "expense" ? "Choose a project" : "None"}
                  error={errors.projectId}
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-medium text-gray-700">Amount (KES)</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-gray-400">KES</span>
                    <input
                      type="number"
                      name="amount"
                      value={formData.amount}
                      onChange={handleInputChange}
                      placeholder="0"
                      min="0"
                      step="any"
                      className="w-full rounded-lg border border-gray-300 py-3 pl-12 pr-4 text-sm outline-none focus:border-green-600 focus:ring-2 focus:ring-green-100"
                    />
                  </div>
                  {errors.amount && <p className="mt-1 text-xs text-red-600">{errors.amount}</p>}
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-gray-700">Date</label>
                  <div className="relative">
                    <CalendarDays size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="date"
                      name="date"
                      value={formData.date}
                      onChange={handleInputChange}
                      className="w-full rounded-lg border border-gray-300 py-3 pl-10 pr-4 text-sm outline-none focus:border-green-600 focus:ring-2 focus:ring-green-100"
                    />
                  </div>
                  {errors.date && <p className="mt-1 text-xs text-red-600">{errors.date}</p>}
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">
                  Reference Number{" "}
                  {!editingId && <span className="font-normal text-gray-400">(optional)</span>}
                </label>
                <input
                  type="text"
                  name="reference"
                  value={formData.reference}
                  onChange={handleInputChange}
                  placeholder={editingId ? "" : "Generated automatically if left blank"}
                  className={inputClass}
                />
                {errors.reference && <p className="mt-1 text-xs text-red-600">{errors.reference}</p>}
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">
                  Receipts and invoices{" "}
                  <span className="font-normal text-gray-400">
                    ({RECEIPT_REQUIRED_FOR_EXPENSES && formData.type === "expense" ? "required" : "optional"})
                  </span>
                </label>

                {(keptReceipts.length > 0 || newFiles.length > 0) && (
                  <ul className="mb-3 space-y-2">
                    {keptReceipts.map((r) => (
                      <li key={r.id} className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2 text-sm">
                        <button type="button" onClick={() => openReceipt(r)} className="truncate text-left text-green-700 hover:underline">
                          {r.name}
                        </button>
                        <span className="ml-3 flex shrink-0 items-center gap-2 text-xs text-gray-400">
                          {formatSize(r.size)}
                          <button
                            type="button"
                            onClick={() => setKeptReceipts((prev) => prev.filter((x) => x.id !== r.id))}
                            className="rounded p-1 hover:bg-gray-100 hover:text-gray-700"
                            aria-label={`Remove ${r.name}`}
                          >
                            <X size={14} />
                          </button>
                        </span>
                      </li>
                    ))}
                    {newFiles.map((f, i) => (
                      <li key={`${f.name}-${i}`} className="flex items-center justify-between rounded-lg border border-dashed border-gray-300 px-3 py-2 text-sm">
                        <span className="truncate text-gray-700">{f.name}</span>
                        <span className="ml-3 flex shrink-0 items-center gap-2 text-xs text-gray-400">
                          {formatSize(f.size)}
                          <button
                            type="button"
                            onClick={() => setNewFiles((prev) => prev.filter((_, idx) => idx !== i))}
                            className="rounded p-1 hover:bg-gray-100 hover:text-gray-700"
                            aria-label={`Remove ${f.name}`}
                          >
                            <X size={14} />
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
                  <Paperclip size={16} />
                  Attach files
                  <input
                    type="file"
                    multiple
                    accept=".pdf,.png,.jpg,.jpeg,.webp"
                    onChange={handleFilesChosen}
                    className="hidden"
                  />
                </label>
                <p className="mt-1 text-xs text-gray-400">PDF, PNG, JPG or WebP, up to 5 MB each.</p>
                {errors.receipts && <p className="mt-1 text-xs text-red-600">{errors.receipts}</p>}
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">
                  Notes <span className="font-normal text-gray-400">(optional)</span>
                </label>
                <textarea name="notes" value={formData.notes} onChange={handleInputChange} rows={2} className={inputClass} />
              </div>

              {errors.form && (
                <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{errors.form}</p>
              )}

              <div className="flex justify-end gap-3 border-t border-gray-200 pt-5">
                <button
                  type="button"
                  onClick={closeForm}
                  className="rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-green-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-green-800 disabled:opacity-60"
                >
                  {saving ? "Saving…" : editingId ? "Save and resubmit" : "Submit for approval"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* View Transaction Modal */}
      {viewing && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
          <div className="my-8 w-full max-w-md rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-200 p-6">
              <div>
                <h2 className="text-xl font-bold text-gray-900">{viewing.description}</h2>
                <p className="mt-1 text-sm text-gray-500">{viewing.reference}</p>
              </div>
              <button onClick={() => setViewing(null)} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100" aria-label="Close">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-5 p-6 text-sm">
              <div className="flex items-center justify-between">
                <p className={`text-3xl font-bold ${viewing.type === "income" ? "text-green-700" : "text-red-600"}`}>
                  {viewing.type === "income" ? "+" : "-"}
                  {formatCurrency(viewing.amount)}
                </p>
                <span className={`rounded-full px-3 py-1 text-xs font-medium ${STATUS_STYLES[viewing.status]}`}>
                  {viewing.status}
                </span>
              </div>

              {viewing.status === "Rejected" && viewing.rejectionReason && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">
                  <p className="font-medium">Reason for rejection</p>
                  <p className="mt-1">{viewing.rejectionReason}</p>
                </div>
              )}

              {viewing.status === "Pending" && viewing.submittedById === myId && isApprover && (
                <p className="rounded-lg bg-amber-50 p-3 text-amber-800">
                  You submitted this transaction, so another approver needs to review it.
                </p>
              )}

              <dl className="grid grid-cols-3 gap-y-3">
                <dt className="text-gray-500">Type</dt>
                <dd className="col-span-2 capitalize text-gray-900">{viewing.type}</dd>
                <dt className="text-gray-500">Category</dt>
                <dd className="col-span-2 text-gray-900">{viewing.category}</dd>
                <dt className="text-gray-500">Project</dt>
                <dd className="col-span-2 text-gray-900">{viewing.project || "—"}</dd>
                <dt className="text-gray-500">Donor</dt>
                <dd className="col-span-2 text-gray-900">{viewing.donor || "—"}</dd>
                <dt className="text-gray-500">Date</dt>
                <dd className="col-span-2 text-gray-900">{formatDate(viewing.date)}</dd>
                <dt className="text-gray-500">Submitted by</dt>
                <dd className="col-span-2 text-gray-900">{viewing.submittedBy}</dd>
                {viewing.approvedBy && (
                  <>
                    <dt className="text-gray-500">Approved by</dt>
                    <dd className="col-span-2 text-gray-900">
                      {viewing.approvedBy}
                      {viewing.approvedAt && ` · ${formatDateTime(viewing.approvedAt)}`}
                    </dd>
                  </>
                )}
                {viewing.notes && (
                  <>
                    <dt className="text-gray-500">Notes</dt>
                    <dd className="col-span-2 text-gray-900">{viewing.notes}</dd>
                  </>
                )}
              </dl>

              <div>
                <p className="mb-2 font-medium text-gray-700">Receipts and invoices</p>
                {(viewing.receipts || []).length === 0 ? (
                  <p className="text-gray-500">No files attached.</p>
                ) : (
                  <ul className="space-y-2">
                    {viewing.receipts.map((r) => (
                      <li key={r.id} className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2">
                        <button onClick={() => openReceipt(r)} className="flex min-w-0 items-center gap-2 text-left text-green-700 hover:underline">
                          <Paperclip size={14} className="shrink-0" />
                          <span className="truncate">{r.name}</span>
                        </button>
                        <span className="ml-3 shrink-0 text-xs text-gray-400">{formatSize(r.size)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {(viewing.history || []).length > 0 && (
                <div>
                  <p className="mb-2 font-medium text-gray-700">History</p>
                  <ol className="space-y-3 border-l border-gray-200 pl-4">
                    {[...viewing.history].reverse().map((h, i) => (
                      <li key={`${h.at}-${i}`}>
                        <p className="text-gray-900">{h.action}</p>
                        <p className="text-xs text-gray-500">
                          {h.by} · {formatDateTime(h.at)}
                        </p>
                        {h.note && <p className="mt-0.5 text-xs text-gray-600">“{h.note}”</p>}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>

            <div className="flex flex-wrap justify-end gap-3 border-t border-gray-200 p-6">
              {canDelete(viewing) && (
                <button
                  onClick={() => {
                    setDeleting(viewing);
                    setViewing(null);
                  }}
                  className="rounded-lg border border-red-200 px-4 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50"
                >
                  Delete
                </button>
              )}
              {canEdit(viewing) && (
                <button
                  onClick={() => openEdit(viewing)}
                  className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Edit
                </button>
              )}
              {canApprove(viewing) && (
                <>
                  <button
                    onClick={() => {
                      startReject(viewing);
                      setViewing(null);
                    }}
                    className="rounded-lg border border-red-200 px-4 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50"
                  >
                    Reject
                  </button>
                  <button
                    onClick={() => approve(viewing)}
                    className="rounded-lg bg-green-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-green-800"
                  >
                    Approve
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Reject Modal */}
      {rejecting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form onSubmit={confirmReject} className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="text-lg font-bold text-gray-900">Reject {rejecting.reference}?</h2>
            <p className="mt-1 text-sm text-gray-500">
              The person who submitted it will see your reason and can correct and resubmit.
            </p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
              placeholder="e.g. The receipt doesn't match the amount."
              className={`${inputClass} mt-4`}
              autoFocus
            />
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setRejecting(null)}
                className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!rejectReason.trim()}
                className="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                Reject transaction
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Delete Confirmation */}
      {deleting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="text-lg font-bold text-gray-900">Delete this transaction?</h2>
            <p className="mt-2 text-sm text-gray-600">
              {deleting.description} ({deleting.reference}) for {formatCurrency(deleting.amount)} and its attached
              files will be removed permanently.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setDeleting(null)}
                className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                className="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-700"
              >
                Delete transaction
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Budget Modal */}
      {showBudgetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form onSubmit={saveBudget} className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="text-lg font-bold text-gray-900">
              {scopeProject ? `${scopeProject.name} budget` : "Annual budget"}
            </h2>
            <p className="mt-1 text-sm text-gray-500">Set the budget for {year}.</p>
            <input
              type="number"
              min="1"
              value={budgetInput}
              onChange={(e) => setBudgetInput(e.target.value)}
              className={`${inputClass} mt-4`}
              autoFocus
            />
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowBudgetModal(false)}
                className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button type="submit" className="rounded-lg bg-green-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-green-800">
                Save budget
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div role="status" className="fixed bottom-6 right-6 z-[60] rounded-lg bg-gray-900 px-4 py-3 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

export default Finance;
