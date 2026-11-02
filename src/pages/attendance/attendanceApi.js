// API and fingerprint (WebAuthn) helpers for EACHRights staff attendance.
// The fingerprint is verified locally by the device. The API verifies the
// signed WebAuthn proof; the browser never receives fingerprint data.
//
// Direct prompt: staff open the portal on their own phone, and the phone shows
// its fingerprint prompt straight away. There is no QR code step.

const BASE = (
  import.meta.env.VITE_API_BASE_URL ||
  "https://8w80mrmztc.execute-api.eu-north-1.amazonaws.com"
).replace(/\/+$/, "");

// The login page (Login.jsx) saves the Cognito session as JSON under
// "eachrights_auth": in localStorage when "Remember me" is ticked, otherwise
// in sessionStorage. It looks like { idToken, accessToken, refreshToken, email }.
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
  return null;
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

/* ---------- Base64URL helpers ---------- */

const enc = (buffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const dec = (value) => {
  const padded =
    value.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (value.length % 4)) % 4);

  return Uint8Array.from(atob(padded), (char) =>
    char.charCodeAt(0)
  ).buffer;
};

/* ---------- WebAuthn capability checks ---------- */

// WebAuthn requires HTTPS or localhost and a supported browser.
export const fingerprintSupported = () =>
  typeof window !== "undefined" &&
  window.isSecureContext &&
  !!window.PublicKeyCredential;

// Whether THIS device has its own fingerprint/face/PIN authenticator.
// Registering and clocking in now need this, so staff must use their phone.
export const platformAvailable = async () => {
  try {
    if (!fingerprintSupported()) return false;

    return await window.PublicKeyCredential
      .isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
};

/* ---------- WebAuthn error help ---------- */

// If the browser blocks the fingerprint prompt with a SecurityError, say which
// web address the page is on and which RP ID the server sent. They must match
// (the page host must equal the RP ID or be a sub-domain of it).
async function withRpHint(rpId, run) {
  try {
    return await run();
  } catch (err) {
    if (err?.name === "SecurityError") {
      const host = window.location.hostname;
      const match = host === rpId || host.endsWith(`.${rpId}`);
      throw new Error(
        match
          ? `Fingerprint sign-in was blocked on "${host}". Open the portal directly in Chrome or Safari (not inside WhatsApp, email or another app) over https.`
          : `Fingerprint sign-in was blocked. This page is "${host}" but the server's RP ID is "${rpId}". They must match. Ask the administrator to fix WEBAUTHN_RP_ID, then register your phone again.`
      );
    }
    throw err;
  }
}

/* ---------- Attendance status ---------- */

export const getStatus = () =>
  call("/me/attendance/status");

/* ---------- Administrator phone approvals ---------- */

const itemsOf = (result) => (Array.isArray(result) ? result : result?.items || []);

// Phones waiting for approval (the backend returns only pending requests here).
export async function listDeviceRequests() {
  return itemsOf(await call("/me/attendance/device-requests"));
}

// Approved phones that are still in use (administrator).
// Each item has requestId, userId, credentialId, staffName, staffEmail, label,
// createdAt and decidedAt. If the request fails it throws, and the Phones tab
// then shows its "isn't available yet" message.
export async function listApprovedDevices() {
  return itemsOf(await call("/me/attendance/devices"));
}

// decision must be "approved" or "rejected".
export const decideDeviceRequest = (
  requestId,
  { decision, note } = {}
) =>
  call(
    `/me/attendance/device-requests/${encodeURIComponent(requestId)}/decision`,
    {
      method: "POST",
      body: JSON.stringify({ decision, note }),
    }
  );

// Administrator-only action.
// Revokes a staff member's approved WebAuthn credential.
export const revokeDevice = (userId, credentialId) =>
  call(
    `/me/attendance/admin-credentials/${encodeURIComponent(userId)}/${encodeURIComponent(credentialId)}`,
    {
      method: "DELETE",
    }
  );

// Kept so any older code importing the previous name still works.
export const adminRevokeDevice = revokeDevice;

/* ---------- Attendance records ---------- */

const listRecords = ({
  scope = "me",
  from,
  to,
  cursor,
  limit,
} = {}) => {
  const params = new URLSearchParams({ scope });

  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (cursor) params.set("cursor", cursor);
  if (limit) params.set("limit", String(limit));

  return call(`/me/attendance/records?${params.toString()}`);
};

// Retrieves up to 10 pages of 500 records each.
export async function listAllRecords(params = {}) {
  let items = [];
  let cursor = null;

  for (let page = 0; page < 10; page += 1) {
    const result = await listRecords({
      ...params,
      cursor,
      limit: 500,
    });

    items = items.concat(result?.items || []);
    cursor = result?.cursor || null;

    if (!cursor) break;
  }

  return items;
}

/* ---------- Leave ---------- */

const query = (params = {}) => {
  const search = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, String(value));
    }
  });

  return search.toString();
};

// Approved leave.
// scope "all" returns everyone; scope "me" returns the signed-in user.
export async function listLeave({
  scope = "all",
  from,
  to,
} = {}) {
  const result = await call(
    `/me/leave/away?${query({ scope, from, to })}`
  );

  return result?.items || [];
}

// Leave requests and their status.
export async function listLeaveRequests({
  scope = "me",
  status,
} = {}) {
  const result = await call(
    `/me/leave/requests?${query({ scope, status })}`
  );

  return result?.items || [];
}

// Submit a leave request: { type, from, to, reason }
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

// Administrator/CEO leave decision.
export const decideLeave = (
  id,
  { decision, note } = {}
) =>
  call(
    `/me/leave/requests/${encodeURIComponent(id)}/decision`,
    {
      method: "POST",
      body: JSON.stringify({ decision, note }),
    }
  );

/* ---------- Scanner setup (administrator) ---------- */

// Returns { items: [{ scannerId, name, email }] }.
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

// punches = [{ scannerId, at }]
// at must be an ISO timestamp.
export async function importPunches(punches = []) {
  const CHUNK_SIZE = 500;

  const total = {
    accepted: 0,
    duplicates: 0,
    rejectedCount: 0,
  };

  for (let index = 0; index < punches.length; index += CHUNK_SIZE) {
    const result = await call("/me/attendance/import", {
      method: "POST",
      body: JSON.stringify({
        punches: punches.slice(index, index + CHUNK_SIZE),
      }),
    });

    total.accepted += result?.accepted || 0;
    total.duplicates += result?.duplicates || 0;
    total.rejectedCount += result?.rejectedCount || 0;
  }

  return total;
}

/* ---------- WebAuthn device registration ---------- */

// Registers the device you are on (the phone's own fingerprint/face/PIN).
// The fingerprint prompt appears directly; there is no QR code.
// New registrations must remain pending until an administrator approves.
export async function registerDevice(label) {
  if (!fingerprintSupported()) {
    throw new Error(
      "Secure WebAuthn is not available. Use HTTPS and an updated browser."
    );
  }

  if (!(await platformAvailable())) {
    throw new Error(
      "This device has no fingerprint, face or screen-lock sign-in. Open this page on your phone and try again."
    );
  }

  const options = await call(
    "/me/attendance/register/options",
    {
      method: "POST",
      body: JSON.stringify({}),
    }
  );

  const credential = await withRpHint(options.rp?.id, () => navigator.credentials.create({
    publicKey: {
      challenge: dec(options.challenge),
      rp: options.rp,
      user: {
        id: dec(options.user.id),
        name: options.user.name,
        displayName: options.user.displayName,
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },   // ES256
        { type: "public-key", alg: -257 }, // RS256
      ],
      authenticatorSelection: {
        // "platform" = this device's own authenticator, so the fingerprint
        // prompt shows straight away instead of a QR code.
        authenticatorAttachment: "platform",
        userVerification: "required",
        residentKey: "discouraged",
      },
      excludeCredentials: (options.excludeCredentials || []).map(
        (id) => ({
          type: "public-key",
          id: dec(id),
        })
      ),
      attestation: "none",
      timeout: 120000,
    },
  }));

  if (!credential) {
    throw new Error("Device registration was cancelled.");
  }

  const response = credential.response;

  if (
    !response.getPublicKey ||
    !response.getAuthenticatorData
  ) {
    throw new Error(
      "This browser does not support the required WebAuthn features. Update Chrome, Edge, Safari or Firefox."
    );
  }

  return call("/me/attendance/register", {
    method: "POST",
    body: JSON.stringify({
      credential: {
        id: credential.id,
        clientDataJSON: enc(response.clientDataJSON),
        authenticatorData: enc(response.getAuthenticatorData()),
        publicKey: enc(response.getPublicKey()),
        publicKeyAlg: response.getPublicKeyAlgorithm(),
        label,
      },
    }),
  });
}

/* ---------- Clock in / clock out ---------- */

// type must be "in" or "out".
// The server verifies the WebAuthn signature and records server time.
export async function punch(type) {
  if (!fingerprintSupported()) {
    throw new Error(
      "Secure WebAuthn is not available. Use HTTPS and an updated browser."
    );
  }

  if (type !== "in" && type !== "out") {
    throw new Error("Invalid attendance action.");
  }

  const options = await call(
    "/me/attendance/punch/options",
    {
      method: "POST",
      body: JSON.stringify({ type }),
    }
  );

  if (!options.allowCredentials?.length) {
    throw new Error(
      "No approved phone is registered for this account. Register your phone and wait for administrator approval."
    );
  }

  const credential = await withRpHint(options.rpId, () => navigator.credentials.get({
    publicKey: {
      challenge: dec(options.challenge),
      rpId: options.rpId,
      allowCredentials: options.allowCredentials.map((id) => ({
        type: "public-key",
        id: dec(id),
        // "internal" = this device's own fingerprint. No QR code.
        transports: ["internal"],
      })),
      userVerification: "required",
      timeout: 120000,
    },
  }));

  if (!credential) {
    throw new Error("Attendance verification was cancelled.");
  }

  const response = credential.response;

  return call("/me/attendance/punch", {
    method: "POST",
    body: JSON.stringify({
      type,
      credential: {
        id: credential.id,
        clientDataJSON: enc(response.clientDataJSON),
        authenticatorData: enc(response.authenticatorData),
        signature: enc(response.signature),
      },
    }),
  });
}