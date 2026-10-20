import { useState } from "react";
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Plus,
  Search,
  Download,
  Eye,
  X,
  CalendarDays,
  FileText,
} from "lucide-react";

import Header from "../../components/Header";
import Sidebar from "../../components/Sidebar";

function Finance() {
  const [searchTerm, setSearchTerm] = useState("");
  const [showModal, setShowModal] = useState(false);

  const [transactions, setTransactions] = useState([
    {
      id: 1,
      date: "08 Oct 2026",
      description: "Programme Funding",
      category: "Income",
      reference: "INC-2026-001",
      amount: 850000,
      type: "income",
      status: "Completed",
    },
    {
      id: 2,
      date: "07 Oct 2026",
      description: "Office Rent",
      category: "Operations",
      reference: "EXP-2026-014",
      amount: 85000,
      type: "expense",
      status: "Completed",
    },
    {
      id: 3,
      date: "05 Oct 2026",
      description: "Staff Training",
      category: "Capacity Building",
      reference: "EXP-2026-013",
      amount: 45000,
      type: "expense",
      status: "Completed",
    },
    {
      id: 4,
      date: "03 Oct 2026",
      description: "Grant Disbursement",
      category: "Income",
      reference: "INC-2026-002",
      amount: 500000,
      type: "income",
      status: "Completed",
    },
    {
      id: 5,
      date: "01 Oct 2026",
      description: "Internet & Communication",
      category: "Operations",
      reference: "EXP-2026-012",
      amount: 18500,
      type: "expense",
      status: "Completed",
    },
  ]);

  const [formData, setFormData] = useState({
    description: "",
    category: "Operations",
    amount: "",
    type: "expense",
    date: "",
    reference: "",
  });

  const totalIncome = transactions
    .filter((item) => item.type === "income")
    .reduce((sum, item) => sum + item.amount, 0);

  const totalExpenses = transactions
    .filter((item) => item.type === "expense")
    .reduce((sum, item) => sum + item.amount, 0);

  const balance = totalIncome - totalExpenses;

  const filteredTransactions = transactions.filter((transaction) =>
    `${transaction.description} ${transaction.category} ${transaction.reference}`
      .toLowerCase()
      .includes(searchTerm.toLowerCase())
  );

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat("en-KE", {
      style: "currency",
      currency: "KES",
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;

    setFormData((previous) => ({
      ...previous,
      [name]: value,
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    if (
      !formData.description ||
      !formData.amount ||
      !formData.date ||
      !formData.reference
    ) {
      alert("Please complete all required fields.");
      return;
    }

    const newTransaction = {
      id: Date.now(),
      date: new Date(formData.date).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }),
      description: formData.description,
      category: formData.category,
      reference: formData.reference,
      amount: Number(formData.amount),
      type: formData.type,
      status: "Completed",
    };

    setTransactions((previous) => [newTransaction, ...previous]);

    setFormData({
      description: "",
      category: "Operations",
      amount: "",
      type: "expense",
      date: "",
      reference: "",
    });

    setShowModal(false);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />

      <div className="flex">
        <Sidebar />

        <main className="flex-1 p-6 lg:p-8">
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
                Finance
              </h1>

              <p className="mt-1 text-gray-600">
                Manage financial records, income, expenses and transactions.
              </p>
            </div>

            <button
              onClick={() => setShowModal(true)}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-green-700 px-5 py-3 font-medium text-white transition hover:bg-green-800"
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
                  <p className="text-sm font-medium text-gray-500">
                    Total Income
                  </p>

                  <h2 className="mt-2 text-2xl font-bold text-gray-900">
                    {formatCurrency(totalIncome)}
                  </h2>
                </div>

                <div className="rounded-lg bg-green-100 p-3 text-green-700">
                  <TrendingUp size={24} />
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-500">
                    Total Expenses
                  </p>

                  <h2 className="mt-2 text-2xl font-bold text-gray-900">
                    {formatCurrency(totalExpenses)}
                  </h2>
                </div>

                <div className="rounded-lg bg-red-100 p-3 text-red-600">
                  <TrendingDown size={24} />
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-500">
                    Available Balance
                  </p>

                  <h2 className="mt-2 text-2xl font-bold text-gray-900">
                    {formatCurrency(balance)}
                  </h2>
                </div>

                <div className="rounded-lg bg-blue-100 p-3 text-blue-700">
                  <Wallet size={24} />
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-500">
                    Transactions
                  </p>

                  <h2 className="mt-2 text-2xl font-bold text-gray-900">
                    {transactions.length}
                  </h2>
                </div>

                <div className="rounded-lg bg-purple-100 p-3 text-purple-700">
                  <FileText size={24} />
                </div>
              </div>
            </div>
          </div>

          {/* Budget Overview */}
          <div className="mb-8 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  Budget Overview
                </h2>

                <p className="text-sm text-gray-500">
                  Current financial year budget utilisation
                </p>
              </div>

              <span className="text-sm font-medium text-gray-600">
                68% utilised
              </span>
            </div>

            <div className="h-3 overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full rounded-full bg-green-700"
                style={{ width: "68%" }}
              />
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-500">
                  Annual Budget
                </p>
                <p className="mt-1 font-semibold text-gray-900">
                  KES 5,000,000
                </p>
              </div>

              <div>
                <p className="text-xs uppercase tracking-wide text-gray-500">
                  Spent
                </p>
                <p className="mt-1 font-semibold text-gray-900">
                  KES 3,400,000
                </p>
              </div>

              <div>
                <p className="text-xs uppercase tracking-wide text-gray-500">
                  Remaining
                </p>
                <p className="mt-1 font-semibold text-green-700">
                  KES 1,600,000
                </p>
              </div>
            </div>
          </div>

          {/* Transactions */}
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 p-6">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">
                    Recent Transactions
                  </h2>

                  <p className="text-sm text-gray-500">
                    View and manage financial transactions.
                  </p>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <div className="relative">
                    <Search
                      size={18}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                    />

                    <input
                      type="text"
                      placeholder="Search transactions..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 py-2.5 pl-10 pr-4 text-sm outline-none focus:border-green-600 focus:ring-2 focus:ring-green-100 sm:w-64"
                    />
                  </div>

                  <button className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
                    <Download size={17} />
                    Export
                  </button>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[850px]">
                <thead className="bg-gray-50">
                  <tr className="text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                    <th className="px-6 py-4">Date</th>
                    <th className="px-6 py-4">Description</th>
                    <th className="px-6 py-4">Category</th>
                    <th className="px-6 py-4">Reference</th>
                    <th className="px-6 py-4">Amount</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4">Action</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-gray-100">
                  {filteredTransactions.length > 0 ? (
                    filteredTransactions.map((transaction) => (
                      <tr
                        key={transaction.id}
                        className="transition hover:bg-gray-50"
                      >
                        <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-600">
                          {transaction.date}
                        </td>

                        <td className="px-6 py-4">
                          <div className="font-medium text-gray-900">
                            {transaction.description}
                          </div>
                        </td>

                        <td className="px-6 py-4 text-sm text-gray-600">
                          {transaction.category}
                        </td>

                        <td className="px-6 py-4 text-sm text-gray-500">
                          {transaction.reference}
                        </td>

                        <td
                          className={`whitespace-nowrap px-6 py-4 text-sm font-semibold ${
                            transaction.type === "income"
                              ? "text-green-700"
                              : "text-red-600"
                          }`}
                        >
                          {transaction.type === "income" ? "+" : "-"}
                          {formatCurrency(transaction.amount)}
                        </td>

                        <td className="px-6 py-4">
                          <span className="inline-flex rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700">
                            {transaction.status}
                          </span>
                        </td>

                        <td className="px-6 py-4">
                          <button
                            className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                            title="View transaction"
                          >
                            <Eye size={18} />
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td
                        colSpan="7"
                        className="px-6 py-10 text-center text-sm text-gray-500"
                      >
                        No transactions found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </main>
      </div>

      {/* Add Transaction Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-200 p-6">
              <div>
                <h2 className="text-xl font-bold text-gray-900">
                  Add Transaction
                </h2>

                <p className="mt-1 text-sm text-gray-500">
                  Record a new financial transaction.
                </p>
              </div>

              <button
                onClick={() => setShowModal(false)}
                className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5 p-6">
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">
                  Description
                </label>

                <input
                  type="text"
                  name="description"
                  value={formData.description}
                  onChange={handleInputChange}
                  placeholder="e.g. Office supplies"
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none focus:border-green-600 focus:ring-2 focus:ring-green-100"
                  required
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-medium text-gray-700">
                    Transaction Type
                  </label>

                  <select
                    name="type"
                    value={formData.type}
                    onChange={handleInputChange}
                    className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none focus:border-green-600 focus:ring-2 focus:ring-green-100"
                  >
                    <option value="expense">Expense</option>
                    <option value="income">Income</option>
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-gray-700">
                    Category
                  </label>

                  <select
                    name="category"
                    value={formData.category}
                    onChange={handleInputChange}
                    className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none focus:border-green-600 focus:ring-2 focus:ring-green-100"
                  >
                    <option value="Operations">Operations</option>
                    <option value="Programme">Programme</option>
                    <option value="Capacity Building">
                      Capacity Building
                    </option>
                    <option value="Office">Office</option>
                    <option value="Travel">Travel</option>
                    <option value="Income">Income</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-medium text-gray-700">
                    Amount (KES)
                  </label>

                  <div className="relative">
                    <DollarSign
                      size={17}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                    />

                    <input
                      type="number"
                      name="amount"
                      value={formData.amount}
                      onChange={handleInputChange}
                      placeholder="0"
                      min="0"
                      className="w-full rounded-lg border border-gray-300 py-3 pl-10 pr-4 text-sm outline-none focus:border-green-600 focus:ring-2 focus:ring-green-100"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-gray-700">
                    Date
                  </label>

                  <div className="relative">
                    <CalendarDays
                      size={17}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                    />

                    <input
                      type="date"
                      name="date"
                      value={formData.date}
                      onChange={handleInputChange}
                      className="w-full rounded-lg border border-gray-300 py-3 pl-10 pr-4 text-sm outline-none focus:border-green-600 focus:ring-2 focus:ring-green-100"
                      required
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">
                  Reference Number
                </label>

                <input
                  type="text"
                  name="reference"
                  value={formData.reference}
                  onChange={handleInputChange}
                  placeholder="e.g. EXP-2026-015"
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none focus:border-green-600 focus:ring-2 focus:ring-green-100"
                  required
                />
              </div>

              <div className="flex justify-end gap-3 border-t border-gray-200 pt-5">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="rounded-lg bg-green-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-green-800"
                >
                  Save Transaction
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Finance;
