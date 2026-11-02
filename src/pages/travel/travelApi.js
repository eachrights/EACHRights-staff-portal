
// API helpers for travel and field requests
// src/pages/travel/travelApi.js

import { getCognitoSession } from "../../components/api.js";

const API_BASE = (
  import.meta.env.VITE_API_BASE_URL ||
  "https://8w80mrmztc.execute-api.eu-north-1.amazonaws.com"
).replace(/\/+$/, "");

if (!API_BASE) {
  throw new Error("VITE_API_BASE_URL is missing from .env");
}

// Get the Cognito ID token from the signed-in session.
async function getToken() {
  const session = await getCognitoSession();

  const token =
    session?.getIdToken?.()?.getJwtToken?.() ||
    session?.idToken?.toString?.() ||
    session?.idToken ||
    session?.accessToken?.toString?.() ||
    session?.accessToken;

  if (!token) {
    throw new Error("Your session has expired. Please sign in again.");
  }

  return token;
}

// Shared API request helper.
async function call(path, options = {}) {
  const token = await getToken();

  const url = `${API_BASE}${path}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });

  if (res.status === 204) return null;

  const contentType = res.headers.get("content-type") || "";
  const responseText = await res.text();

  let data;

  if (contentType.includes("json")) {
    try {
      data = responseText ? JSON.parse(responseText) : {};
    } catch {
      throw new Error("The API returned invalid JSON.");
    }
  } else {
    throw new Error(
      `The API returned HTML or another non-JSON response (${res.status}). Check the API Gateway URL and travel routes.`
    );
  }

  if (!res.ok) {
    const err = new Error(
      data.message || data.error || `Request failed (${res.status})`
    );
    err.code = data.code;
    err.status = res.status;
    throw err;
  }

  return data;
}

// List trip requests.
// scope "me" = own requests.
// scope "all" = all requests (authorised approvers only).
export async function listTrips({ scope = "me", status } = {}) {
  const params = new URLSearchParams({ scope });

  if (status) params.set("status", status);

  const res = await call(`/me/travel/trips?${params.toString()}`);

  return res?.items || [];
}

// List approved trips.
// scope "me" or "all".
export async function listAway({ scope = "all", from, to } = {}) {
  const params = new URLSearchParams({ scope });

  if (from) params.set("from", from);
  if (to) params.set("to", to);

  const res = await call(`/me/travel/away?${params.toString()}`);

  return res?.items || [];
}

// Submit a travel or field-trip request.
export const requestTrip = ({
  type,
  destination,
  purpose,
  from,
  to,
  estCost,
}) =>
  call("/me/travel/trips", {
    method: "POST",
    body: JSON.stringify({
      type,
      destination,
      purpose,
      from,
      to,
      estCost,
    }),
  });

// Cancel own trip request.
export const cancelTrip = (id) =>
  call(`/me/travel/trips/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });

// Approve or reject a trip request.
export const decideTrip = (id, { decision, note = "" }) =>
  call(`/me/travel/trips/${encodeURIComponent(id)}/decision`, {
    method: "POST",
    body: JSON.stringify({ decision, note }),
  });
