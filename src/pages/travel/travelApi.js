// API helpers for travel and field requests
// src/pages/travel/travelApi.js
//
// Matches requestRoutes.mjs:
//   GET  /me/travel                       my requests (?status=)
//                                         ?scope=all      administrator / CEO: everyone's
//                                         ?scope=finance  finance approvers: requests waiting for Finance
//   POST /me/travel                       create { tripType, destination, purpose, startDate, endDate, estimatedCost, currency }
//   POST /me/travel/{id}/cancel           cancel
//   POST /me/travel/{id}/finance-approve  Finance approver { note? }   (only while stage is "finance")
//   POST /me/travel/{id}/finance-reject   Finance approver { note }    (required)
//   POST /me/travel/{id}/approve          administrator / CEO { note? } (final approval)
//   POST /me/travel/{id}/reject           administrator / CEO { note }  (required)
//   GET  /me/travel/away?when=            approved trips (active | current | upcoming | past | all)
//
// Approval flow
//   A request with an estimated cost above zero is created with status "pending" and stage "finance".
//   Finance approves it, which moves it to stage "ceo". Only then can the CEO / administrator approve it.
//   A request with no cost starts at stage "ceo" (no Finance step).
//   If Finance rejects, the request is closed as "rejected" and never reaches the CEO.

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

// A trip needs Finance when it has an estimated cost above zero.
export const tripNeedsFinance = (r) => Number(r?.estimatedCost ?? r?.estCost) > 0;

// Where a pending request is in the approval chain: "finance", "ceo", or "" once it is decided.
// Uses the stage the API sends. For older records without one, it is worked out from the cost.
export const tripStage = (r) => {
  if (!r || r.status !== "pending") return "";
  if (r.stage === "finance" || r.stage === "ceo") return r.stage;
  return tripNeedsFinance(r) && !r.financeReviewedBy ? "finance" : "ceo";
};

// Give API records the field names the Travel page uses.
const toUiTrip = (r) => {
  const ui = {
    ...r,
    from: r.startDate,
    to: r.endDate,
    name: r.userName,
    type: r.tripType ? toUiTripType(r.tripType) : r.type,
    estCost: r.estimatedCost,
    decidedBy: r.reviewedBy,
    decisionNote: r.reviewNote,
    financeBy: r.financeReviewedBy,
    financeNote: r.financeReviewNote,
    financeAt: r.financeReviewedAt,
  };
  ui.needsFinance = tripNeedsFinance(r);
  ui.stage = tripStage(r);
  return ui;
};

/* ---------- calls ---------- */

// List trip requests.
// scope "me" = own requests, "all" = everyone's (administrator / CEO),
// "finance" = requests waiting for Finance approval (finance approvers).
export async function listTrips({ scope = "me", status } = {}) {
  const params = new URLSearchParams();
  if (scope === "all" || scope === "finance") params.set("scope", scope);
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
// A request with a cost goes to Finance first, then the CEO.
export const requestTrip = ({ type, destination, purpose, from, to, estCost, currency }) =>
  call("/me/travel", {
    method: "POST",
    body: JSON.stringify({
      tripType: toApiTripType(type),
      destination,
      purpose,
      startDate: from,
      endDate: to,
      estimatedCost: estCost === null || estCost === undefined ? "" : estCost,
      ...(currency ? { currency } : {}),
    }),
  });

// Cancel own trip request (pending, or approved and not yet started).
export const cancelTrip = (id) =>
  call(`/me/travel/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
    body: JSON.stringify({}),
  });

// Turn "approve" | "approved" | "reject" | "rejected" into "approve" | "reject" | "".
const actionOf = (decision) =>
  String(decision).startsWith("approve") ? "approve" : String(decision).startsWith("reject") ? "reject" : "";

// Finance step. Only for requests at stage "finance". Approving passes the request to the CEO;
// rejecting closes it. The API requires a note when rejecting.
export const financeDecideTrip = (id, { decision, note = "" } = {}) => {
  const action = actionOf(decision);
  if (!action) return Promise.reject(new Error("Choose approve or reject."));
  return call(`/me/travel/${encodeURIComponent(id)}/finance-${action}`, {
    method: "POST",
    body: JSON.stringify({ note: note || (action === "reject" ? "Not approved." : "") }),
  });
};

// Final step (CEO / administrator). The API refuses it while the request still waits for Finance.
// decision: "approve" | "approved" | "reject" | "rejected". The API requires a note when rejecting.
export const decideTrip = (id, { decision, note = "" } = {}) => {
  const action = actionOf(decision);
  if (!action) return Promise.reject(new Error("Choose approve or reject."));
  return call(`/me/travel/${encodeURIComponent(id)}/${action}`, {
    method: "POST",
    body: JSON.stringify({ note: note || (action === "reject" ? "Not approved." : "") }),
  });
};