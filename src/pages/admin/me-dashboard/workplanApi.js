// API helpers for the M&E workplan and calendar.
// Uses the same sign-in session and API address as the attendance pages.

// VITE_API_URL comes first because this was the address the workplan used before.
// If it is not set, the attendance API address is used.
const BASE = (
  import.meta.env.VITE_API_URL ||
  import.meta.env.VITE_API_BASE_URL ||
  "https://8w80mrmztc.execute-api.eu-north-1.amazonaws.com"
).replace(/\/+$/, "");

// The login page saves the Cognito session as JSON under "eachrights_auth":
// in localStorage when "Remember me" is ticked, otherwise in sessionStorage.
// It looks like { idToken, accessToken, refreshToken, email }.
const AUTH_KEY = "eachrights_auth";

// Which token the API expects. A Cognito JWT authorizer normally wants the
// ID token. If you still get 401 with a fresh sign-in, change this to "accessToken".
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
  // Older sign-in format, kept so existing sessions still work
  try {
    return localStorage.getItem("token");
  } catch {
    return null;
  }
};

async function call(path, options = {}) {
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

  // A web page instead of JSON means the request never reached the API
  const type = res.headers.get("content-type") || "";
  if (!type.includes("json")) {
    throw new Error(
      "The API returned a web page instead of data. Check VITE_API_BASE_URL in .env, then restart npm run dev."
    );
  }

  const data = await res.json();

  if (!res.ok) {
    const err = new Error(data.message || data.error || `Request failed (${res.status})`);
    if (data.code) err.code = data.code;
    err.status = res.status;
    throw err;
  }

  return data;
}

// POST creates or updates (the backend upserts by id)
export const listActivities = () => call("/me/workplan");
export const saveActivity = (a) =>
  call("/me/workplan", { method: "POST", body: JSON.stringify(a) });
export const deleteActivity = (id) =>
  call(`/me/workplan/${encodeURIComponent(id)}`, { method: "DELETE" });

export const listEvents = () => call("/me/events");
export const saveEvent = (e) =>
  call("/me/events", { method: "POST", body: JSON.stringify(e) });
export const deleteEvent = (id) =>
  call(`/me/events/${encodeURIComponent(id)}`, { method: "DELETE" });

// Audit trail. With entity + id: that item's history. Without id: the full
// trail (administrators only). Returns { items, cursor } for paging.
export const listAudit = ({ entity, id, cursor, limit } = {}) => {
  const p = new URLSearchParams();
  if (entity) p.set("entity", entity);
  if (id) p.set("id", id);
  if (cursor) p.set("cursor", cursor);
  if (limit) p.set("limit", String(limit));
  return call(`/me/audit?${p.toString()}`);
};