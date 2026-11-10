// API helpers for EACHRights staff attendance.
// Matches the attendance route file (IP-allowlist version):
//   /me/attendance/config, /holidays, /today, /clock, /records, /day, /report, /import, /device/...
// Leave uses the /me/leave/... routes from requestRoutes.mjs.
// `call` and `query` are exported so ../remote/remoteApi.js can reuse them.

const BASE = (
  import.meta.env.VITE_API_BASE_URL ||
  "https://8w80mrmztc.execute-api.eu-north-1.amazonaws.com"
).replace(/\/+$/, "");

// The login page saves the Cognito session as JSON under "eachrights_auth":
// { idToken, accessToken, refreshToken, email }.
const AUTH_KEY = "eachrights_auth";

// Which token the API expects. If you still get 401 after a fresh sign-in, change to "accessToken".
const TOKEN_FIELD = "idToken";

const getToken = () => {
  for (const store of [sessionStorage, localStorage]) {
    try {
      const raw = store.getItem(AUTH_KEY);
      if (!raw) continue;
      const session = JSON.parse(raw);
      const token = session?.[TOKEN_FIELD] || session?.accessToken;
      if (token) return token;
    } catch {
      /* ignore a corrupted entry and try the next store */
    }
  }
  return null;
};

export async function call(path, options = {}) {
  const token = getToken();

  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  if (res.status === 204) return null;

  if (res.status === 401) {
    const err = new Error(
      token
        ? "Your session has expired or the server rejected your sign-in. Please sign in again."
        : "You are not signed in. Please sign in again."
    );
    err.code = "UNAUTHORIZED";
    throw err;
  }

  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error(
      "The API returned a web page instead of data. Check VITE_API_BASE_URL in .env, then restart npm run dev."
    );
  }

  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.message || `Request failed (${res.status})`);
    if (data.code) err.code = data.code;
    throw err;
  }
  return data;
}

// Public calls (the /clock page): no sign-in, so no token is sent
async function publicCall(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Request failed (${res.status})`);
  return data;
}

export const query = (params = {}) => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  });
  return search.toString();
};

/* ---------- Clocking settings ---------- */

// { phoneClocking, allowedIps, requirePasskey, requireQr, workStart, workEnd, graceMinutes }
export const getConfig = () => call("/me/attendance/config");

// Administrator. Send any of the fields above.
export const saveConfig = (config) =>
  call("/me/attendance/config", { method: "PUT", body: JSON.stringify(config) });

/* ---------- Public holidays ---------- */

export async function listHolidays(year) {
  const result = await call(`/me/attendance/holidays?${query({ year })}`);
  return result?.holidays || [];
}

// Administrator: { date: "YYYY-MM-DD", name }
export const addHoliday = (holiday) =>
  call("/me/attendance/holidays", { method: "POST", body: JSON.stringify(holiday) });

export const deleteHoliday = (date) =>
  call(`/me/attendance/holidays/${encodeURIComponent(date)}`, { method: "DELETE" });

/* ---------- Clock in / clock out ---------- */

// { date, record, canClock, reason, requirePasskey, requireQr, hasPasskey, config: { workStart, workEnd } }
export const getToday = () => call("/me/attendance/today");

// action: "in" | "out", device: "phone" | "laptop".
// extra: { assertion } (the phone's fingerprint/face/PIN answer) and/or { qrToken } (from the printed QR code).
// Returns the updated record.
export const clock = (action, device, extra = {}) =>
  call("/me/attendance/clock", { method: "POST", body: JSON.stringify({ action, device, ...extra }) });

/* ---------- Passkeys (fingerprint, face or PIN on the phone) and the reception QR ---------- */

// { passkeys: [{ id, label, createdAt, lastUsedAt }] }. userId is administrator-only.
export const getPasskeys = (userId) => call(`/me/attendance/passkey?${query({ userId })}`);

export const getRegisterOptions = () =>
  call("/me/attendance/passkey/register-options", { method: "POST", body: JSON.stringify({}) });

export const registerPasskey = (body) =>
  call("/me/attendance/passkey/register", { method: "POST", body: JSON.stringify(body) });

export const getClockChallenge = () =>
  call("/me/attendance/passkey/challenge", { method: "POST", body: JSON.stringify({}) });

export const deletePasskey = (credentialId, userId) =>
  call(`/me/attendance/passkey/${encodeURIComponent(credentialId)}?${query({ userId })}`, { method: "DELETE" });

/* ---------- Public clocking (no sign-in): used by the /clock page the QR code opens ---------- */

// { canClock, reason, requireQr }
export const getPublicInfo = () => publicCall("/public/attendance/info");

export const getPublicChallenge = () =>
  publicCall("/public/attendance/challenge", { method: "POST", body: JSON.stringify({}) });

// Returns { action: "in" | "out", name, record }
export const publicClock = (assertion, qrToken) =>
  publicCall("/public/attendance/clock", { method: "POST", body: JSON.stringify({ assertion, qrToken }) });

// Administrator (QR poster): { token, version }
export const getQr = () => call("/me/attendance/qr");

// Administrator: makes a new QR code. The old printed one stops working. Returns { token, version }.
export const rotateQr = () => call("/me/attendance/qr/rotate", { method: "POST", body: JSON.stringify({}) });

/* ---------- Records ---------- */

// from and to are plain dates (YYYY-MM-DD). userId is administrator-only.
// Returns { userId, from, to, days: [{ date, state, note?, record }], summary }.
export const getRecords = ({ from, to, userId } = {}) =>
  call(`/me/attendance/records?${query({ from, to, userId })}`);

// Administrator: everybody's records for one day. Returns { date, records, off, absent }.
export const getDay = (date) => call(`/me/attendance/day?${query({ date })}`);

// Administrator: one line per person for a period of up to a year (the monthly and yearly report).
// Returns { from, to, workingDays, people: [{ userId, userName, present, late, absent, leave, away, remote, hours }], totals }.
export const getReport = ({ from, to } = {}) => call(`/me/attendance/report?${query({ from, to })}`);

// Administrator correction. body = { in: "HH:MM", out: "HH:MM", userName? }. An empty string clears that time.
export const correctRecord = (userId, date, body) =>
  call(`/me/attendance/records/${encodeURIComponent(userId)}/${encodeURIComponent(date)}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });

// Administrator: punches = [{ userId, userName?, timestamp }] with ISO timestamps.
// The earliest punch of each day becomes the clock in, the latest the clock out.
// Used for the manual "Scanner import" fallback (for example a USB export after an outage).
export async function importPunches(punches = []) {
  const CHUNK_SIZE = 1000; // the API accepts at most 1000 per request
  let records = 0;
  for (let i = 0; i < punches.length; i += CHUNK_SIZE) {
    const result = await call("/me/attendance/import", {
      method: "POST",
      body: JSON.stringify({ punches: punches.slice(i, i + CHUNK_SIZE) }),
    });
    records += result?.records || 0;
  }
  return { records };
}

/* ---------- Scanner device: ID mapping and status (administrator) ---------- */

// { map: { "<scanner number>": { userId, userName? } }, users?: [{ userId, userName }] }
export const getDeviceMap = () => call("/me/attendance/device/map");

// Replaces the whole map. Returns { map }.
export const saveDeviceMap = (map) =>
  call("/me/attendance/device/map", { method: "PUT", body: JSON.stringify({ map }) });

// { lastSeen, lastPunchAt, lastSyncPunches, skipped, serial }  (ISO timestamps)
export const getDeviceStatus = () => call("/me/attendance/device/status");

// Asks the office agent to sync on its next check.
export const requestDeviceSync = () =>
  call("/me/attendance/device/sync", { method: "POST", body: JSON.stringify({}) });

/* ---------- Leave (requestRoutes.mjs) ---------- */

const LEAVE_TYPES = ["annual", "sick", "maternity", "paternity", "compassionate", "study", "unpaid"];
const LEAVE_WHEN = ["active", "current", "upcoming", "past", "all"];

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// "Annual", "Sick leave", "annual_leave" -> "annual", "sick", ...
const normalizeLeaveType = (value) => {
  const v = String(value ?? "").trim().toLowerCase().replace(/[\s_-]*leave$/, "").trim();
  return LEAVE_TYPES.includes(v) ? v : String(value ?? "");
};

// Give API records the field names the Attendance page uses.
const toUiLeave = (r) => ({
  ...r,
  from: r.startDate,
  to: r.endDate,
  name: r.userName,
  type: r.type ? cap(r.type) : r.type,
  decidedBy: r.reviewedBy,
  decisionNote: r.reviewNote,
});

// Approved leave. Accepts "active" | "current" | "upcoming" | "past" | "all",
// or { from, to } (the page passes this) to limit the dates shown.
// With { from, to } every approved leave is fetched and then cut to those dates, so any past or future
// month or year works (the monthly and yearly leave report needs this).
export async function listLeave(arg) {
  const range = arg && typeof arg === "object" ? arg : {};
  let when = typeof arg === "string" && LEAVE_WHEN.includes(arg) ? arg : "active";
  if (range.from || range.to) when = "all";

  const result = await call(`/me/leave/on-leave?${query({ when })}`);
  return (result?.people || [])
    .filter((p) => (!range.from || p.endDate >= range.from) && (!range.to || p.startDate <= range.to))
    .map(toUiLeave);
}

// My requests (scope "me") or everyone's (scope "all", administrator only).
export async function listLeaveRequests({ scope = "me", status } = {}) {
  const result = await call(`/me/leave?${query({ scope: scope === "all" ? "all" : undefined, status })}`);
  return (result?.requests || []).map(toUiLeave);
}

// Submit a leave request. Accepts { type, from, to } or { type, startDate, endDate }, plus reason and handoverTo.
export const requestLeave = (request = {}) => {
  const { from, to, startDate, endDate, type, ...rest } = request;
  return call("/me/leave", {
    method: "POST",
    body: JSON.stringify({
      ...rest,
      type: normalizeLeaveType(type),
      startDate: startDate ?? from,
      endDate: endDate ?? to,
    }),
  });
};

// Cancel one of your own requests (pending, or approved and not yet started).
export const cancelLeave = (id) =>
  call(`/me/leave/${encodeURIComponent(id)}/cancel`, { method: "POST", body: JSON.stringify({}) });

// decision: "approve" | "approved" | "reject" | "rejected". The API needs a note when rejecting.
export const decideLeave = (id, { decision, note } = {}) => {
  const action = String(decision).startsWith("approve")
    ? "approve"
    : String(decision).startsWith("reject")
    ? "reject"
    : "";
  if (!action) return Promise.reject(new Error("Choose approve or reject."));
  return call(`/me/leave/${encodeURIComponent(id)}/${action}`, {
    method: "POST",
    body: JSON.stringify({ note: note || (action === "reject" ? "Not approved." : "") }),
  });
};

// My leave days used this year: { year, annual: { entitlement, used, pending, remaining }, used, pending }
export const getLeaveBalance = (year) => call(`/me/leave/balance?${query({ year })}`);