// API helpers for the M&E workplan, calendar and audit trail.
// Matches workplanRoutes.mjs:
//   /me/workplan   GET list, POST create, PUT /{id} update, DELETE /{id}
//   /me/events     GET { events, holidays, leave, activities }, POST create, PUT /{id} update, DELETE /{id}
//   /me/audit      GET ?month=YYYY-MM&entity&limit (administrator) -> { entries }

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

  const url = `${BASE}${path}`;
  let res;
  try {
    res = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
    });
  } catch (err) {
    // The browser gives no detail when a request is blocked, so say where it tried to go.
    const here = typeof window !== "undefined" ? window.location.origin : "";
    console.error("Workplan request failed", { url, from: here, err });
    throw new Error(
      `Could not reach the API at ${url} from ${here}. Either that address is wrong (check VITE_API_URL in .env and restart npm run dev) or the API does not allow this web address (CORS).`
    );
  }

  if (res.status === 204) return null;

  if (res.status === 401) {
    const err = new Error(
      token
        ? "Your session has expired or the server rejected your sign-in. Please sign in again."
        : "You are not signed in. Please sign in again."
    );
    err.code = "UNAUTHORIZED";
    err.status = 401;
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

// The API may return a bare list or an object that holds the list. Always give back an array.
const asList = (data, ...keys) => {
  if (Array.isArray(data)) return data;
  for (const k of [...keys, "items"]) if (Array.isArray(data?.[k])) return data[k];
  return Object.values(data || {}).find(Array.isArray) || [];
};

/* ---------- Workplan ---------- */

// The page says "Not started"; the API says "planned", and so on.
const STATUS_TO_API = { "Not started": "planned", "In progress": "in-progress", Done: "done", Delayed: "delayed" };
const STATUS_TO_UI = {
  planned: "Not started",
  "in-progress": "In progress",
  done: "Done",
  delayed: "Delayed",
  cancelled: "Not started",
};

// API activity -> the shape WorkPlan.jsx uses
const toUiActivity = (a) => ({
  id: a.id,
  title: a.title,
  project: a.project || "",
  owner: a.responsible || "",
  priority: a.priority || "Medium",
  start: a.startDate,
  end: a.endDate,
  status: STATUS_TO_UI[a.status] || "Not started",
  progress: Number(a.progress) || 0,
  notes: a.description || "",
  updatedAt: a.updatedAt,
});

// WorkPlan.jsx activity -> what the API reads
const toApiActivity = (a) => ({
  title: a.title,
  project: a.project || "",
  responsible: a.owner || "",
  priority: a.priority || "Medium",
  startDate: a.start,
  endDate: a.end,
  status: STATUS_TO_API[a.status] || "planned",
  progress: Number(a.progress) || 0,
  description: a.notes || "",
});

export const listActivities = () =>
  call("/me/workplan").then((d) => asList(d, "activities").map(toUiActivity));

// An activity with an id is updated (PUT); one without is created (POST).
export const saveActivity = (a) =>
  a.id
    ? call(`/me/workplan/${encodeURIComponent(a.id)}`, { method: "PUT", body: JSON.stringify(toApiActivity(a)) }).then(toUiActivity)
    : call("/me/workplan", { method: "POST", body: JSON.stringify(toApiActivity(a)) }).then(toUiActivity);

export const deleteActivity = (id) =>
  call(`/me/workplan/${encodeURIComponent(id)}`, { method: "DELETE" });

/* ---------- Calendar events ---------- */

export const listEvents = () => call("/me/events").then((d) => asList(d, "events"));

// An event with an id is updated (PUT); one without is created (POST).
export const saveEvent = (e) =>
  e?.id
    ? call(`/me/events/${encodeURIComponent(e.id)}`, { method: "PUT", body: JSON.stringify(e) })
    : call("/me/events", { method: "POST", body: JSON.stringify(e) });

export const deleteEvent = (id) =>
  call(`/me/events/${encodeURIComponent(id)}`, { method: "DELETE" });

/* ---------- Audit trail ---------- */

// The page says "events"; the audit records say "event".
const ENTITY_TO_API = { events: "event" };
const ENTITY_TO_UI = { event: "events" };

// API entry { id, at, actor, action: "request.approve", entity, entityId, detail }
// -> the shape AuditTrail.jsx uses.
const toUiAudit = (e) => ({
  auditId: e.id,
  at: e.at,
  actor: { name: e.actor || "", email: String(e.actor || "").includes("@") ? e.actor : "" },
  action: String(e.action || "").split(".").pop(), // "request.approve" -> "approve"
  entity: ENTITY_TO_UI[e.entity] || e.entity,
  entityId: e.entityId,
  title: e.detail || e.entityId || "",
  detail: e.detail || "",
  changes: [],
});

const MONTHS_BACK = 24;
const prevMonth = (m) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 2, 1)).toISOString().slice(0, 7);
};

// The API holds the trail one month at a time, newest month first (administrators only).
// cursor = the next month to read. With entity + id: only that item's entries.
// Returns { items, cursor }; cursor is null when there is nothing older to load.
export async function listAudit({ entity, id, cursor, limit } = {}) {
  let month = cursor || new Date().toISOString().slice(0, 7);
  let floor = new Date().toISOString().slice(0, 7);
  for (let i = 0; i < MONTHS_BACK; i += 1) floor = prevMonth(floor);

  const maxMonths = id ? 12 : 6; // how far to look in one go when a month is empty
  let items = [];

  try {
    for (let i = 0; i < maxMonths; i += 1) {
      const p = new URLSearchParams({ month });
      if (entity) p.set("entity", ENTITY_TO_API[entity] || entity);
      if (limit) p.set("limit", String(limit));
      const data = await call(`/me/audit?${p.toString()}`);
      items = (data?.entries || []).map(toUiAudit).filter((e) => !id || e.entityId === id);
      month = prevMonth(month);
      if (items.length || month < floor) break;
    }
  } catch (err) {
    // The history tab is open to everyone, but the audit trail is for administrators
    if (id && err.status === 403) return { items: [], cursor: null };
    throw err;
  }

  return { items, cursor: month >= floor ? month : null };
}