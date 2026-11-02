// API helpers for travel and field requests (src/pages/travel/travelApi.js).
const BASE = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");

// Same token as attendanceApi.js and workplanApi.js
const getToken = () => localStorage.getItem("token");

// Note: this is the same helper as in attendanceApi.js. When more modules exist, move it into one shared file.
async function call(path, options = {}) {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...options,
  });

  if (res.status === 204) return null;

  const type = res.headers.get("content-type") || "";
  if (!type.includes("json")) {
    throw new Error(
      "The API returned a web page instead of data. Check VITE_API_URL in .env, then restart npm run dev."
    );
  }
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.message || `Request failed (${res.status})`);
    err.code = data.code;
    err.status = res.status;
    throw err;
  }
  return data;
}

// Trip requests. scope "me" = my own. scope "all" = everyone's, for approvers only.
// status is optional, e.g. "pending". Dates are "YYYY-MM-DD" Nairobi days. Resolves to
// [{ id, userId, name, email, type, destination, purpose, from, to, estCost, status,
//    decisionNote, decidedBy, decidedAt }]
// where status is "pending" | "approved" | "rejected" | "cancelled".
export async function listTrips({ scope = "me", status } = {}) {
  const p = new URLSearchParams({ scope });
  if (status) p.set("status", status);
  const res = await call(`/me/travel/trips?${p}`);
  return res?.items || [];
}

// Approved trips only, safe for every signed-in staff member to see (no costs).
// scope "me" or "all". Resolves to [{ userId, name, email, type, destination, from, to }].
export async function listAway({ scope = "all", from, to } = {}) {
  const p = new URLSearchParams({ scope });
  if (from) p.set("from", from);
  if (to) p.set("to", to);
  const res = await call(`/me/travel/away?${p}`);
  return res?.items || [];
}

// Staff ask to travel. The server records it as "pending" for the signed-in user.
export const requestTrip = ({ type, destination, purpose, from, to, estCost }) =>
  call("/me/travel/trips", {
    method: "POST",
    body: JSON.stringify({ type, destination, purpose, from, to, estCost }),
  });

// Cancel my own request (pending, or approved and not started yet)
export const cancelTrip = (id) => call(`/me/travel/trips/${encodeURIComponent(id)}`, { method: "DELETE" });

// Approvers only. decision is "approved" or "rejected"; note is optional.
export const decideTrip = (id, { decision, note }) =>
  call(`/me/travel/trips/${encodeURIComponent(id)}/decision`, {
    method: "POST",
    body: JSON.stringify({ decision, note }),
  });