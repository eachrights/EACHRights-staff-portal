
import { getCognitoSession } from "../../components/api.js";
// API and fingerprint (WebAuthn) helpers for staff attendance.
// The browser never sees the fingerprint. The device checks it locally
// and returns a signed proof that the API verifies.

const BASE = (
  import.meta.env.VITE_API_BASE_URL ||
  "https://8w80mrmztc.execute-api.eu-north-1.amazonaws.com"
).replace(/\/+$/, "");

// Use the same Cognito session as the rest of the portal.
async function getToken() {
  const session = await getCognitoSession();
  return session.getIdToken().getJwtToken();
}

async function call(path, options = {}) {
  const token = await getToken();

  const { method = "GET", body, headers = {} } = options;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...headers,
    },
    body,
  });

  if (res.status === 204) return null;

  const type = res.headers.get("content-type") || "";

  if (!type.includes("application/json")) {
    const responseText = await res.text();

    console.error("Attendance API returned non-JSON:", {
      url: `${BASE}${path}`,
      status: res.status,
      contentType: type,
      response: responseText.slice(0, 500),
    });

    throw new Error(
      "The attendance API returned a web page instead of JSON. Check the API URL and Lambda attendance route configuration."
    );
  }

  const data = await res.json();

  if (res.status === 401) {
    throw new Error("Your session has expired. Please sign in again.");
  }

  if (!res.ok) {
    const err = new Error(
      data.message || data.error || `Request failed (${res.status})`
    );

    if (data.code) err.code = data.code;

    throw err;
  }

  return data;
}

/* ---------- Base64URL helpers ---------- */

const enc = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const dec = (s) => {
  const padded =
    s.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (s.length % 4)) % 4);

  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0)).buffer;
};

/* ---------- Capability checks ---------- */

// WebAuthn requires HTTPS or localhost and a supported browser.
export const fingerprintSupported = () =>
  typeof window !== "undefined" &&
  window.isSecureContext &&
  !!window.PublicKeyCredential;

export const platformAvailable = async () => {
  try {
    if (!fingerprintSupported()) return false;

    return await window.PublicKeyCredential
      .isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
};

/* ---------- Attendance API ---------- */

export const getStatus = () =>
  call("/me/attendance/status");

export const removeDevice = (id) =>
  call(`/me/attendance/credentials/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });

const listRecords = ({
  scope = "me",
  from,
  to,
  cursor,
  limit,
} = {}) => {
  const p = new URLSearchParams({ scope });

  if (from) p.set("from", from);
  if (to) p.set("to", to);
  if (cursor) p.set("cursor", cursor);
  if (limit) p.set("limit", String(limit));

  return call(`/me/attendance/records?${p.toString()}`);
};

// Follows pagination cursors, up to 10 pages.
export async function listAllRecords(params = {}) {
  let items = [];
  let cursor = null;

  for (let page = 0; page < 10; page += 1) {
    const res = await listRecords({
      ...params,
      cursor,
      limit: 500,
    });

    items = items.concat(res?.items || []);
    cursor = res?.cursor || null;

    if (!cursor) break;
  }

  return items;
}

/* ---------- Leave ---------- */

const query = (params = {}) => {
  const p = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      p.set(key, String(value));
    }
  });

  return p.toString();
};

// Approved leave for the calendar and staff leave list.
export async function listLeave({
  scope = "all",
  from,
  to,
} = {}) {
  const res = await call(
    `/me/leave/away?${query({ scope, from, to })}`
  );

  return res?.items || [];
}

// Leave requests and their statuses.
export async function listLeaveRequests({
  scope = "me",
  status,
} = {}) {
  const res = await call(
    `/me/leave/requests?${query({ scope, status })}`
  );

  return res?.items || [];
}

// Request leave: { type, from, to, reason }
export const requestLeave = (request) =>
  call("/me/leave/requests", {
    method: "POST",
    body: JSON.stringify(request),
  });

// Cancel one of your own leave requests.
export const cancelLeave = (id) =>
  call(`/me/leave/requests/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });

// Administrators and CEO: decision is "approved" or "rejected".
export const decideLeave = (id, { decision, note } = {}) =>
  call(
    `/me/leave/requests/${encodeURIComponent(id)}/decision`,
    {
      method: "POST",
      body: JSON.stringify({ decision, note }),
    }
  );

/* ---------- Scanner setup (administrator) ---------- */

// Returns { items: [{ scannerId, name, email }] }
export const listStaffLinks = () =>
  call("/me/attendance/staff-links");

// link = { scannerId, name, email }
export const saveStaffLink = (link) =>
  call("/me/attendance/staff-links", {
    method: "POST",
    body: JSON.stringify(link),
  });

export const deleteStaffLink = (scannerId) =>
  call(
    `/me/attendance/staff-links/${encodeURIComponent(scannerId)}`,
    {
      method: "DELETE",
    }
  );

// Import scanner punches in chunks.
export async function importPunches(punches) {
  const CHUNK = 500;

  const total = {
    accepted: 0,
    duplicates: 0,
    rejectedCount: 0,
  };

  for (let i = 0; i < punches.length; i += CHUNK) {
    const res = await call("/me/attendance/import", {
      method: "POST",
      body: JSON.stringify({
        punches: punches.slice(i, i + CHUNK),
      }),
    });

    total.accepted += res?.accepted || 0;
    total.duplicates += res?.duplicates || 0;
    total.rejectedCount += res?.rejectedCount || 0;
  }

  return total;
}

/* ---------- Fingerprint registration ---------- */

// Register this device using its platform authenticator.
export async function registerDevice(label) {
  const opts = await call("/me/attendance/register/options", {
    method: "POST",
    body: JSON.stringify({}),
  });

  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: dec(opts.challenge),
      rp: opts.rp,
      user: {
        id: dec(opts.user.id),
        name: opts.user.name,
        displayName: opts.user.displayName,
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
        residentKey: "discouraged",
      },
      excludeCredentials: (opts.excludeCredentials || []).map((id) => ({
        type: "public-key",
        id: dec(id),
      })),
      attestation: "none",
      timeout: 60000,
    },
  });

  if (!cred) {
    throw new Error("Fingerprint registration was cancelled.");
  }

  const r = cred.response;

  if (!r.getPublicKey || !r.getAuthenticatorData) {
    throw new Error(
      "This browser is too old for fingerprint setup. Update Chrome, Edge, Safari or Firefox."
    );
  }

  return call("/me/attendance/register", {
    method: "POST",
    body: JSON.stringify({
      credential: {
        id: cred.id,
        clientDataJSON: enc(r.clientDataJSON),
        authenticatorData: enc(r.getAuthenticatorData()),
        publicKey: enc(r.getPublicKey()),
        publicKeyAlg: r.getPublicKeyAlgorithm(),
        label,
      },
    }),
  });
}

/* ---------- Clock in / clock out ---------- */

// type is "in" or "out".
export async function punch(type) {
  const opts = await call("/me/attendance/punch/options", {
    method: "POST",
    body: JSON.stringify({ type }),
  });

  const cred = await navigator.credentials.get({
    publicKey: {
      challenge: dec(opts.challenge),
      rpId: opts.rpId,
      allowCredentials: (opts.allowCredentials || []).map((id) => ({
        type: "public-key",
        id: dec(id),
      })),
      userVerification: "required",
      timeout: 60000,
    },
  });

  if (!cred) {
    throw new Error("Fingerprint verification was cancelled.");
  }

  const r = cred.response;

  return call("/me/attendance/punch", {
    method: "POST",
    body: JSON.stringify({
      type,
      credential: {
        id: cred.id,
        clientDataJSON: enc(r.clientDataJSON),
        authenticatorData: enc(r.authenticatorData),
        signature: enc(r.signature),
      },
    }),
  });
}
