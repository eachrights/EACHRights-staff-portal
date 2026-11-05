// API helpers for travel and field requests
// src/pages/travel/travelApi.js
//
// Matches requestRoutes.mjs:
//   GET  /me/travel                 my requests (?status=), administrator can add ?scope=all
//   POST /me/travel                 create { tripType, destination, purpose, startDate, endDate, estimatedCost, currency }
//   POST /me/travel/{id}/cancel     cancel
//   POST /me/travel/{id}/approve    administrator { note? }
//   POST /me/travel/{id}/reject     administrator { note } (required)
//   GET  /me/travel/away?when=      approved trips (active | current | upcoming | past | all)

import { getCognitoSession } from "../../components/api.js";

const API_BASE = (
  import.meta.env.VITE_API_BASE_URL ||
  "https://8w80mrmztc.execute-api.eu-north-1.amazonaws.com"
).replace(/\/+$/, "");

// Login.jsx saves the Cognito session as JSON under "eachrights_auth"
// (localStorage when "Remember me" is ticked, otherwise sessionStorage).
const AUTH_KEY = "eachrights_auth";

// Which token the API expects. A Cognito JWT authorizer normally wants the ID token.
const TOKEN_FIELD = "idToken";

// Read the token saved by the login page.
function getStoredToken() {
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
}

// Stored token first, then the live Cognito session as a fallback.
async function getToken() {
  const stored = getStoredToken();
  if (stored) return stored;

  try {
    const session = await getCognitoSession();

    const token =
      session?.getIdToken?.()?.getJwtToken?.() ||
      session?.idToken?.toString?.() ||
      session?.idToken ||
      session?.accessToken?.toString?.() ||
      session?.accessToken;

    if (token) return token;
  } catch {
    /* fall through to the error below */
  }

  const err = new Error("You are not signed in. Please sign in again.");
  err.code = "UNAUTHORIZED";
  throw err;
}

// Shared API request helper.
async function call(path, options = {}) {
  const token = await getToken();

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });

  if (res.status === 204) return null;

  if (res.status === 401) {
    const err = new Error(
      "Your session has expired or the server rejected your sign-in. Please sign in again."
    );
    err.code = "UNAUTHORIZED";
    err.status = 401;
    throw err;
  }

  const contentType = res.headers.get("content-type") || "";
  const responseText = await res.text();

  if (!contentType.includes("json")) {
    throw new Error(
      `The API returned HTML or another non-JSON response (${res.status}). Check the API Gateway URL and travel routes.`
    );
  }

  let data;
  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch {
    throw new Error("The API returned invalid JSON.");
  }

  if (!res.ok) {
    const err = new Error(data.message || data.error || `Request failed (${res.status})`);
    err.code = data.code;
    err.status = res.status;
    throw err;
  }

  return data;
}

/* ---------- field-name and value translation ---------- */

const AWAY_WHEN = ["active", "current", "upcoming", "past", "all"];

// The API knows two trip types. The page labels them "Field visit" and "Official travel".
const toApiTripType = (label) => (/field/i.test(String(label ?? "")) ? "field" : "travel");
const toUiTripType = (tripType) => (tripType === "field" ? "Field visit" : "Official travel");

// Give API records the field names the Travel page uses.
const toUiTrip = (r) => ({
  ...r,
  from: r.startDate,
  to: r.endDate,
  name: r.userName,
  type: r.tripType ? toUiTripType(r.tripType) : r.type,
  estCost: r.estimatedCost,
  decidedBy: r.reviewedBy,
  decisionNote: r.reviewNote,
});

/* ---------- calls ---------- */

// List trip requests.
// scope "me" = own requests, scope "all" = everyone's (administrators only).
export async function listTrips({ scope = "me", status } = {}) {
  const params = new URLSearchParams();
  if (scope === "all") params.set("scope", "all");
  if (status) params.set("status", status);
  const qs = params.toString();

  const res = await call(`/me/travel${qs ? `?${qs}` : ""}`);
  return (res?.requests || []).map(toUiTrip);
}

// List approved trips, optionally limited to dates { from, to } (YYYY-MM-DD).
export async function listAway({ from, to } = {}) {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Nairobi" });
  let when = "active";
  if (to && to < today) when = "past";
  if (!AWAY_WHEN.includes(when)) when = "active";

  const res = await call(`/me/travel/away?when=${when}`);
  return (res?.people || [])
    .filter((p) => (!from || p.endDate >= from) && (!to || p.startDate <= to))
    .map(toUiTrip);
}

// Submit a travel or field-trip request.
export const requestTrip = ({ type, destination, purpose, from, to, estCost }) =>
  call("/me/travel", {
    method: "POST",
    body: JSON.stringify({
      tripType: toApiTripType(type),
      destination,
      purpose,
      startDate: from,
      endDate: to,
      estimatedCost: estCost === null || estCost === undefined ? "" : estCost,
    }),
  });

// Cancel own trip request (pending, or approved and not yet started).
export const cancelTrip = (id) =>
  call(`/me/travel/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
    body: JSON.stringify({}),
  });

// Approve or reject a trip request. decision: "approve" | "approved" | "reject" | "rejected".
// The API requires a note when rejecting.
export const decideTrip = (id, { decision, note = "" } = {}) => {
  const action = String(decision).startsWith("approve")
    ? "approve"
    : String(decision).startsWith("reject")
    ? "reject"
    : "";
  if (!action) return Promise.reject(new Error("Choose approve or reject."));
  return call(`/me/travel/${encodeURIComponent(id)}/${action}`, {
    method: "POST",
    body: JSON.stringify({ note: note || (action === "reject" ? "Not approved." : "") }),
  });
};