// Client for the finance routes (/finance/...) on the EACHRights API.
// Same API and same sign-in as attendanceApi.js. Set VITE_FINANCE_API_URL only if Finance ever moves to its own API.
const stripSlash = (url) => (url || "").replace(/\/+$/, "");

const BASE = stripSlash(
  import.meta.env.VITE_FINANCE_API_URL ||
    import.meta.env.VITE_API_BASE_URL ||
    "https://8w80mrmztc.execute-api.eu-north-1.amazonaws.com"
);

// The login page saves the Cognito session as JSON under "eachrights_auth":
// { idToken, accessToken, refreshToken, email }. The ID token is used because the
// API Gateway JWT authorizer checks the `aud` claim, which only the ID token carries.
const AUTH_KEY = "eachrights_auth";

const isExpired = (token) => {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.exp * 1000 < Date.now() + 10000;
  } catch {
    return true;
  }
};

const getToken = async () => {
  for (const store of [sessionStorage, localStorage]) {
    try {
      const token = JSON.parse(store.getItem(AUTH_KEY) || "null")?.idToken;
      if (token && !isExpired(token)) return token;
    } catch {
      /* ignore a corrupted entry and try the next store */
    }
  }
  throw new Error("Your session has expired. Please sign in again.");
};

async function request(method, path, { params, body } = {}) {
  const query = params
    ? "?" + new URLSearchParams(Object.entries(params).filter(([, v]) => v !== "" && v != null && v !== "all"))
    : "";
  const response = await fetch(`${BASE}/finance${path}${query}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await getToken()}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.message || `Request failed (${response.status})`);
    error.status = response.status;
    error.fieldErrors = data?.errors || {}; // feed straight into setErrors()
    throw error;
  }
  if (data === null) throw new Error("The Finance API returned an unexpected response. Check VITE_API_BASE_URL.");
  return data;
}

export const financeApi = {
  getMe: () => request("GET", "/me"),
  listTransactions: (params) => request("GET", "/transactions", { params }),
  createTransaction: (body) => request("POST", "/transactions", { body }),
  updateTransaction: (id, body) => request("PUT", `/transactions/${id}`, { body }),
  deleteTransaction: (id) => request("DELETE", `/transactions/${id}`),
  approve: (id) => request("POST", `/transactions/${id}/approve`, { body: {} }),
  reject: (id, reason) => request("POST", `/transactions/${id}/reject`, { body: { reason } }),

  getSummary: (projectId) => request("GET", "/summary", { params: { projectId } }),
  getBudget: (year, projectId) => request("GET", "/budget", { params: { year, projectId } }),
  setBudget: (body) => request("PUT", "/budget", { body }),

  listDonors: () => request("GET", "/donors"),
  createDonor: (name) => request("POST", "/donors", { body: { name } }),

  // Projects are the M&E frameworks. Returns [{ id, name }] for every project, so finance staff can pick any of them.
  listProjects: () => request("GET", "/projects"),

  // 1) ask for a presigned URL, 2) PUT the file straight to S3, 3) send the returned id as receiptIds on save.
  async uploadReceipt(file) {
    const { id, uploadUrl } = await request("POST", "/receipts/upload-url", {
      body: { name: file.name, type: file.type, size: file.size },
    });
    const put = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
    if (!put.ok) throw new Error("The file could not be uploaded.");
    return { id, name: file.name, type: file.type, size: file.size };
  },
  async openReceipt(id) {
    const { url } = await request("GET", `/receipts/${id}/download-url`);
    window.open(url, "_blank", "noopener");
  },
};