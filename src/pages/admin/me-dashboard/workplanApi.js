// API helpers for the M&E workplan and calendar.
// Adjust getToken() to however the portal already stores the signed-in user's token.
// VITE_API_URL must be the base address of the API (no trailing slash), set in .env
const BASE = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");

const getToken = () => localStorage.getItem("token");

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

  // A web page instead of JSON means the request never reached the API
  const type = res.headers.get("content-type") || "";
  if (!type.includes("json")) {
    throw new Error(
      "The API returned a web page instead of data. Check VITE_API_URL in .env, then restart npm run dev."
    );
  }

  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
}

// POST creates or updates (the backend upserts by id)
export const listActivities = () => call("/me/workplan");
export const saveActivity = (a) =>
  call("/me/workplan", { method: "POST", body: JSON.stringify(a) });
export const deleteActivity = (id) =>
  call(`/me/workplan/${id}`, { method: "DELETE" });

export const listEvents = () => call("/me/events");
export const saveEvent = (e) =>
  call("/me/events", { method: "POST", body: JSON.stringify(e) });
export const deleteEvent = (id) =>
  call(`/me/events/${id}`, { method: "DELETE" });

// Audit trail. With entity + id: that item's history. Without id: the full
// trail (administrators only). Returns { items, cursor } for paging.
export const listAudit = ({ entity, id, cursor, limit } = {}) => {
  const p = new URLSearchParams();
  if (entity) p.set("entity", entity);
  if (id) p.set("id", id);
  if (cursor) p.set("cursor", cursor);
  if (limit) p.set("limit", String(limit));
  return call(`/me/audit?${p}`);
};
