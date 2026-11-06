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

/* ---------- Session handling (expiry check + refresh) ---------- */

const decodeJwt = (token) => {
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, "=")));
  } catch {
    return null;
  }
};

// Seconds left before the token expires (negative = already expired)
const secondsLeft = (token) => {
  const exp = decodeJwt(token)?.exp;
  return exp ? exp - Date.now() / 1000 : -1;
};

// Every stored session, with the store it lives in so a refresh can save back to the same place
const readSessions = () => {
  const found = [];
  for (const store of [localStorage, sessionStorage]) {
    try {
      const raw = store.getItem(AUTH_KEY);
      if (!raw) continue;
      const session = JSON.parse(raw);
      if (session && typeof session === "object") found.push({ store, session });
    } catch {
      /* ignore a corrupted entry */
    }
  }
  return found;
};

// The session whose token lasts longest, so a stale copy never hides a fresh one
const bestSession = () => {
  const all = readSessions();
  all.sort((a, b) => secondsLeft(b.session[TOKEN_FIELD]) - secondsLeft(a.session[TOKEN_FIELD]));
  return all[0] || null;
};

let refreshing = null;

// Exchange the refresh token for new ID/access tokens straight from Cognito.
// The region and app client id are read from the ID token itself (iss and aud).
function refreshSession() {
  if (refreshing) return refreshing; // several calls at once share one refresh
  refreshing = (async () => {
    const current = bestSession();
    const refreshToken = current?.session?.refreshToken;
    const claims = decodeJwt(current?.session?.idToken || current?.session?.accessToken || "");
    const region = claims?.iss?.match(/cognito-idp\.([^.]+)\.amazonaws\.com/)?.[1];
    const clientId = claims?.aud || claims?.client_id;
    if (!refreshToken || !region || !clientId) return null;

    const res = await fetch(`https://cognito-idp.${region}.amazonaws.com/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth",
      },
      body: JSON.stringify({
        AuthFlow: "REFRESH_TOKEN_AUTH",
        ClientId: clientId,
        AuthParameters: { REFRESH_TOKEN: refreshToken },
      }),
    });
    if (!res.ok) return null; // refresh token expired or revoked: the user must sign in again

    const out = (await res.json())?.AuthenticationResult;
    if (!out?.IdToken) return null;

    const next = {
      ...current.session,
      idToken: out.IdToken,
      accessToken: out.AccessToken || current.session.accessToken,
      // Cognito does not return a new refresh token here, so keep the old one
      refreshToken: out.RefreshToken || refreshToken,
    };
    try {
      current.store.setItem(AUTH_KEY, JSON.stringify(next));
    } catch {
      /* storage full or blocked: the new token is still returned for this call */
    }
    return next[TOKEN_FIELD] || next.accessToken;
  })()
    .catch(() => null)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

// A usable token: the stored one if it still has more than 60 s left, otherwise a refreshed one
async function getToken() {
  const best = bestSession();
  const token = best?.session?.[TOKEN_FIELD] || best?.session?.accessToken;
  if (token && secondsLeft(token) > 60) return token;
  if (best) {
    const fresh = await refreshSession();
    if (fresh) return fresh;
    return token || null; // let the server decide; it will answer 401 if it is dead
  }
  // Older sign-in format, kept so existing sessions still work
  try {
    return localStorage.getItem("token");
  } catch {
    return null;
  }
}

async function send(url, options, token) {
  return fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
}

async function call(path, options = {}) {
  let token = await getToken();

  const url = `${BASE}${path}`;
  let res;
  try {
    res = await send(url, options, token);

    // One retry: the token may have expired in flight or been rejected for age
    if (res.status === 401) {
      const fresh = await refreshSession();
      if (fresh && fresh !== token) {
        token = fresh;
        res = await send(url, options, token);
      }
    }
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