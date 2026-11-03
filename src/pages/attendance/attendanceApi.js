/*
 * Staff attendance, as a plug-in for the existing M&E Lambda.
 * Uses the same DynamoDB table, login and API route.
 *
 * Staff clock in and out using WebAuthn on their phone or laptop.
 * The fingerprint or face data stays on the device.
 * A PC can be used too: the browser shows a QR code and the phone does the fingerprint check.
 *
 * Device registration requires administrator approval.
 * Each staff member can have only one approved device.
 *
 * Office network: set ATTENDANCE_OFFICE_IPS to the office's PUBLIC IP address(es),
 * comma separated (for example 197.232.143.11). Clocking in or out is refused from
 * any other address. If the variable is missing or empty, EVERYONE is refused.
 *
 * URLs (all under /me/attendance)
 *   GET    status                                   my clock state, today's punches and my phone
 *   GET    records?scope=me|all&from=&to=&cursor=   records (scope=all is administrator / CEO only)
 *   POST   register/options, POST register         register my phone (it then waits for approval)
 *   POST   punch/options,    POST punch             clock in or out
 *   DELETE credentials/{id}                         staff cannot remove their own phone (always refused)
 *   GET    device-requests                          phones waiting for approval (administrator)
 *   POST   device-requests/{requestId}/decision     approve or decline a phone (administrator)
 *   GET    devices                                  approved phones (administrator)
 *   DELETE admin-credentials/{userId}/{credId}      revoke a phone (administrator)
 *   GET/POST/DELETE staff-links, POST import        office scanner (administrator)
 *
 * The same routes also answer to these names, so either spelling works:
 *   GET approved-devices, GET admin-credentials, GET devices/requests,
 *   POST devices/requests/{requestId}/decision, DELETE devices/{userId}/{credId}
 *
 * Phones registered before approvals existed (no approval fields) count as approved. They are added to
 * the approved list the first time their owner opens Attendance, and for an administrator when they
 * open the Phones tab.
 */

import {
  createHash,
  createPublicKey,
  randomBytes,
  randomUUID,
  timingSafeEqual,
  verify as cryptoVerify,
} from "node:crypto";

const TZ = "Africa/Nairobi";
const DAY_MS = 86400000;
const MAX_DEVICES = 1;
const CHALLENGE_MS = 5 * 60 * 1000;
const MAX_IMPORT = 1000;
const MAX_RANGE_DAYS = 93;

const sha256 = (data) => createHash("sha256").update(data).digest();
const b64u = (buf) => Buffer.from(buf).toString("base64url");
const fromB64u = (s) => Buffer.from(String(s || ""), "base64url");

const nairobiDay = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });
const nairobiMonth = (iso) => nairobiDay(iso).slice(0, 7);
const todayNairobi = () => nairobiDay(new Date().toISOString());

function monthsBetween(fromIso, toIso) {
  const [y1, m1] = nairobiMonth(fromIso).split("-").map(Number);
  const [y2, m2] = nairobiMonth(toIso).split("-").map(Number);
  const out = [];

  for (let n = y1 * 12 + (m1 - 1); n <= y2 * 12 + (m2 - 1); n += 1) {
    out.push(`${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, "0")}`);
  }

  return out;
}

/* A request id that is the same every time for the same phone, so an earlier phone gets one only once */
const requestIdFor = (userId, credId) => b64u(sha256(`${userId}|${credId}`)).slice(0, 22);

export function createAttendanceRoutes({ store, HttpError, json, parseBody, text }) {
  /* ---------- who is asking ---------- */

  function personOf(event, user) {
    const c = event.requestContext?.authorizer?.jwt?.claims || {};
    const full = [c.given_name, c.family_name].filter(Boolean).join(" ");

    return {
      name: String(c.name || full || user.name || "Staff member"),
      email: String(c.email || ""),
    };
  }

  const keyOf = (me, user) => (me.email ? me.email.toLowerCase() : String(user.id));

  const webEnabled = () => String(process.env.ATTENDANCE_WEB_PUNCH || "").toLowerCase() !== "off";

  /* ---------- office network ---------- */

  // The office's public IP address(es), from ATTENDANCE_OFFICE_IPS (comma separated).
  const officeIps = () =>
    String(process.env.ATTENDANCE_OFFICE_IPS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

  function onOfficeNetwork(event) {
    const allowed = officeIps();

    // Nothing configured means nobody is treated as being in the office.
    if (allowed.length === 0) return false;

    // API Gateway sets this itself. Do not use X-Forwarded-For, because a caller can fake it.
    const ip = event.requestContext?.http?.sourceIp || event.requestContext?.identity?.sourceIp || "";

    return allowed.includes(ip);
  }

  function requireOffice(event) {
    if (!onOfficeNetwork(event)) {
      const err = new HttpError(403, "You can only clock in or out from the office Wi-Fi.");
      err.code = "NOT_IN_OFFICE";
      throw err;
    }
  }

  function requireAdmin(user) {
    if (!user.isAdmin) {
      throw new HttpError(403, "Only administrators and the CEO can do this.");
    }
  }

  /* ---------- WebAuthn settings ---------- */

  function relyingParty(event) {
    const headers = event.headers || {};
    const origin = headers.origin || headers.Origin || "";

    const configured = String(process.env.WEBAUTHN_ORIGINS || "")
      .split(",")
      .map((s) => s.trim().replace(/\/$/, ""))
      .filter(Boolean);

    const origins = configured.length ? configured : origin ? [origin] : [];

    if (origins.length === 0) {
      throw new HttpError(500, "Fingerprint sign-in is not set up on the server (WEBAUTHN_ORIGINS).");
    }

    if (configured.length && !configured.includes(origin)) {
      throw new HttpError(403, "Fingerprint sign-in is not allowed from this web address.");
    }

    let rpId = String(process.env.WEBAUTHN_RP_ID || "").trim();

    if (!rpId) {
      try {
        rpId = new URL(origins.includes(origin) ? origin : origins[0]).hostname;
      } catch {
        throw new HttpError(500, "Fingerprint sign-in is not set up on the server (WEBAUTHN_RP_ID).");
      }
    }

    return { origins, rpId };
  }

  /* ---------- one-time challenges ---------- */

  async function saveChallenge(user, purpose) {
    const challenge = b64u(randomBytes(32));
    const expiresAt = Date.now() + CHALLENGE_MS;

    await store.put({
      pk: `ATTCHAL#${user.id}`,
      sk: purpose,
      challenge,
      expiresAt,
      ttl: Math.floor(expiresAt / 1000) + 3600,
    });

    return challenge;
  }

  async function takeChallenge(user, purpose) {
    const item = await store.get(`ATTCHAL#${user.id}`, purpose);

    if (!item || !item.challenge || Number(item.expiresAt) < Date.now()) {
      throw new HttpError(400, "That fingerprint check expired. Please try again.");
    }

    await store.put({ ...item, challenge: "", used: true });
    return item.challenge;
  }

  /* ---------- WebAuthn validation ---------- */

  function checkClientData(credential, { type, challenge, rpId, origins }) {
    const bad = (msg) => new HttpError(400, msg);
    let clientData;

    try {
      clientData = JSON.parse(fromB64u(credential.clientDataJSON).toString("utf8"));
    } catch {
      throw bad("The fingerprint check could not be read. Please try again.");
    }

    if (clientData.type !== type) {
      throw bad("The fingerprint check was for something else.");
    }

    if (clientData.challenge !== challenge) {
      throw bad("The fingerprint check does not match. Please try again.");
    }

    if (!origins.includes(clientData.origin) || clientData.crossOrigin === true) {
      throw bad("The fingerprint check came from a web address that is not allowed.");
    }

    const authData = fromB64u(credential.authenticatorData);

    if (authData.length < 37) {
      throw bad("The fingerprint check could not be read. Please try again.");
    }

    if (!timingSafeEqual(authData.subarray(0, 32), sha256(rpId))) {
      throw bad("The fingerprint check is tied to a different site.");
    }

    const flags = authData[32];

    if (!(flags & 0x01) || !(flags & 0x04)) {
      throw bad("The fingerprint was not checked on the device. Please try again.");
    }

    return {
      authData,
      counter: authData.readUInt32BE(33),
      clientHash: sha256(fromB64u(credential.clientDataJSON)),
    };
  }

  /* ---------- stored credentials ---------- */

  const credPk = (user) => `ATTCRED#${user.id}`;

  // Existing credentials without an approval field remain valid.
  const isApprovedCredential = (c) => Boolean(c && !c.removed && c.approved !== false && !c.pending);

  const isPendingCredential = (c) =>
    Boolean(c && !c.removed && (c.pending === true || c.approved === false) && !c.rejected);

  async function allCredentials(user) {
    return (await store.query(credPk(user))).filter((c) => !c.removed);
  }

  async function myCredentials(user) {
    return (await allCredentials(user)).filter(isApprovedCredential);
  }

  async function enrollmentCredentials(user) {
    return (await allCredentials(user)).filter((c) => isApprovedCredential(c) || isPendingCredential(c));
  }

  /*
   * A phone registered before approvals existed has no request record, so it would be missing from the
   * administrator's list of approved phones. This adds one (already approved) the first time its owner
   * shows up, and marks the phone so it is only done once.
   */
  async function recordEarlierPhones(user, me) {
    const missing = (await myCredentials(user)).filter((c) => !c.requestId);
    if (missing.length === 0) return;

    for (const c of missing) {
      const requestId = requestIdFor(user.id, c.credId);

      await store.put({
        pk: "ATTDEVREQ",
        sk: `REQ#${requestId}`,
        requestId,
        userId: user.id,
        credId: c.credId,
        staffName: me.name,
        staffEmail: me.email,
        label: c.label || "My phone",
        status: "approved",
        createdAt: c.createdAt,
        decidedAt: c.createdAt,
        decidedBy: "Registered before approvals",
        decisionNote: "",
      });

      await store.put({ ...c, requestId, staffName: me.name, staffEmail: me.email });
    }
  }

  async function loadLinks() {
    const items = (await store.query("STAFFLINK")).filter((l) => !l.deleted);

    return new Map(items.map((l) => [l.scannerId, l]));
  }

  /* ---------- attendance records ---------- */

  function resolve(rec, links) {
    if (rec.method !== "scanner") return rec;

    const link = links.get(rec.scannerId);

    return {
      ...rec,
      type: "punch",
      userId: link ? (link.email ? link.email.toLowerCase() : `link:${rec.scannerId}`) : `scan:${rec.scannerId}`,
      name: link?.name || `Scanner ID ${rec.scannerId}`,
      email: link?.email || "",
    };
  }

  const toRecord = (r) => ({
    id: r.id,
    userId: r.userId,
    name: r.name,
    email: r.email || "",
    at: r.at,
    type: r.type,
    method: r.method,
    scannerId: r.scannerId || null,
    device: r.device || "",
  });

  async function fetchRecords(fromIso, toIso, links) {
    const months = monthsBetween(fromIso, toIso);
    const lists = await Promise.all(months.map((m) => store.query(`ATT#${m}`)));

    return lists
      .flat()
      .filter((r) => r.at >= fromIso && r.at <= toIso)
      .map((r) => resolve(r, links))
      .sort((a, b) => a.at.localeCompare(b.at));
  }

  const todayRange = () => ({
    from: new Date(`${todayNairobi()}T00:00:00+03:00`).toISOString(),
    to: new Date(`${todayNairobi()}T23:59:59.999+03:00`).toISOString(),
  });

  async function myWebPunchesToday(me, user, links) {
    const { from, to } = todayRange();
    const key = keyOf(me, user);

    return (await fetchRecords(from, to, links)).filter(
      (r) => r.userId === key && (r.type === "in" || r.type === "out")
    );
  }

  function checkSequence(type, punches) {
    const last = punches[punches.length - 1];

    if (type === "in" && last?.type === "in") {
      throw new HttpError(409, "You are already clocked in.");
    }

    if (type === "out" && last?.type !== "in") {
      throw new HttpError(409, "You are not clocked in.");
    }
  }

  function wantedType(b) {
    if (b.type !== "in" && b.type !== "out") {
      throw new HttpError(400, "Type must be in or out.");
    }

    return b.type;
  }

  /* ---------- status and records ---------- */

  async function status(event, user) {
    const me = personOf(event, user);
    const key = keyOf(me, user);
    const links = await loadLinks();

    await recordEarlierPhones(user, me);

    const creds = await myCredentials(user);
    const pending = (await allCredentials(user)).filter(isPendingCredential);

    const { from, to } = todayRange();

    const today = (await fetchRecords(from, to, links)).filter((r) => r.userId === key);

    const web = today.filter((r) => r.type === "in" || r.type === "out");

    const last = web[web.length - 1];

    const linked =
      Boolean(me.email) &&
      [...links.values()].some((l) => l.email && l.email.toLowerCase() === me.email.toLowerCase());

    return json(200, {
      webPunchEnabled: webEnabled(),
      onOfficeNetwork: onOfficeNetwork(event),
      linked,
      enrolled: creds.length > 0,
      maxDevices: MAX_DEVICES,

      devices: creds.map((c) => ({
        id: c.credId,
        label: c.label,
        createdAt: c.createdAt,
        lastUsedAt: c.lastUsedAt || null,
      })),

      pendingDevice: pending[0]
        ? {
            id: pending[0].credId,
            label: pending[0].label,
            createdAt: pending[0].createdAt,
            requestId: pending[0].requestId || null,
          }
        : null,

      today: today.map((r) => ({
        id: r.id,
        at: r.at,
        type: r.type,
        method: r.method,
      })),

      last: last ? { type: last.type, at: last.at } : null,
    });
  }

  async function records(event, user) {
    const q = event.queryStringParameters || {};
    const scope = q.scope === "all" ? "all" : "me";

    if (scope === "all") requireAdmin(user);

    const now = Date.now();
    const to = q.to ? Date.parse(q.to) : now;
    const from = q.from ? Date.parse(q.from) : to - 31 * DAY_MS;

    if (Number.isNaN(from) || Number.isNaN(to) || to < from) {
      throw new HttpError(400, "The dates are not valid.");
    }

    if (to - from > MAX_RANGE_DAYS * DAY_MS) {
      throw new HttpError(400, "Choose a period of three months or less.");
    }

    const me = personOf(event, user);
    const key = keyOf(me, user);
    const links = await loadLinks();

    const all = await fetchRecords(new Date(from).toISOString(), new Date(to).toISOString(), links);

    const items = all.filter((r) => scope === "all" || r.userId === key).map(toRecord);

    const limitRaw = Number(q.limit || 500);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, Math.floor(limitRaw))) : 500;

    let offset = 0;

    if (q.cursor) {
      try {
        const decoded = Buffer.from(String(q.cursor), "base64url").toString("utf8");

        offset = Number(decoded);

        if (!Number.isSafeInteger(offset) || offset < 0) {
          throw new Error("bad cursor");
        }
      } catch {
        throw new HttpError(400, "The attendance page cursor is invalid.");
      }
    }

    const page = items.slice(offset, offset + limit);
    const nextOffset = offset + page.length;

    const cursor =
      nextOffset < items.length ? Buffer.from(String(nextOffset), "utf8").toString("base64url") : null;

    return json(200, { items: page, cursor });
  }

  /* ---------- staff device registration ---------- */

  async function registerOptions(event, user) {
    if (!webEnabled()) {
      throw new HttpError(403, "Clocking from a phone or laptop is switched off.");
    }

    const { rpId } = relyingParty(event);
    const me = personOf(event, user);
    const creds = await enrollmentCredentials(user);

    if (creds.length >= MAX_DEVICES) {
      const pending = creds.some(isPendingCredential);

      throw new HttpError(
        409,
        pending
          ? "Your phone registration is waiting for administrator approval."
          : "You already have an approved phone. Contact IT or an administrator to replace it."
      );
    }

    const challenge = await saveChallenge(user, "REG");

    return json(200, {
      challenge,
      rp: { name: "EACHRights Portal", id: rpId },
      user: {
        id: b64u(sha256(String(user.id))),
        name: me.email || me.name,
        displayName: me.name,
      },
      excludeCredentials: creds.map((c) => c.credId),
    });
  }

  async function register(event, user) {
    if (!webEnabled()) {
      throw new HttpError(403, "Clocking from a phone or laptop is switched off.");
    }

    const { rpId, origins } = relyingParty(event);
    const c = parseBody(event).credential || {};
    const challenge = await takeChallenge(user, "REG");

    const { authData, counter } = checkClientData(c, {
      type: "webauthn.create",
      challenge,
      rpId,
      origins,
    });

    if (!(authData[32] & 0x40) || authData.length < 55) {
      throw new HttpError(400, "The device did not return a new fingerprint credential.");
    }

    const idLength = authData.readUInt16BE(53);
    const credId = b64u(authData.subarray(55, 55 + idLength));

    if (!credId || credId !== c.id) {
      throw new HttpError(400, "The fingerprint credential does not match. Please try again.");
    }

    let key;

    try {
      key = createPublicKey({
        key: fromB64u(c.publicKey),
        format: "der",
        type: "spki",
      });
    } catch {
      throw new HttpError(400, "The device's key could not be read.");
    }

    const alg = Number(c.publicKeyAlg);

    const supported =
      (alg === -7 && key.asymmetricKeyType === "ec" && key.asymmetricKeyDetails?.namedCurve === "prime256v1") ||
      (alg === -257 && key.asymmetricKeyType === "rsa");

    if (!supported) {
      throw new HttpError(400, "This device uses a kind of key that is not supported.");
    }

    const existing = await enrollmentCredentials(user);

    if (existing.length >= MAX_DEVICES) {
      throw new HttpError(
        409,
        "You already have an approved or pending phone registration. Contact IT to replace it."
      );
    }

    if (existing.some((x) => x.credId === credId)) {
      throw new HttpError(409, "This device is already set up.");
    }

    const requestId = randomUUID();
    const createdAt = new Date().toISOString();
    const label = text(c.label, "Device name", 60) || "This device";
    const me = personOf(event, user);

    await store.put({
      pk: credPk(user),
      sk: `CRED#${credId}`,
      credId,
      publicKey: c.publicKey,
      alg,
      counter,
      rpId,
      label,
      createdAt,
      lastUsedAt: null,
      approved: false,
      pending: true,
      requestId,
      staffName: me.name,
      staffEmail: me.email,
    });

    await store.put({
      pk: "ATTDEVREQ",
      sk: `REQ#${requestId}`,
      requestId,
      userId: user.id,
      credId,
      staffName: me.name,
      staffEmail: me.email,
      label,
      status: "pending",
      createdAt,
    });

    return json(201, {
      ok: true,
      pendingApproval: true,
      requestId,
    });
  }

  async function removeDevice() {
    throw new HttpError(
      403,
      "Staff cannot remove or replace an approved phone. Contact IT or an administrator."
    );
  }

  /* ---------- administrator device approvals ---------- */

  const toDeviceRow = (r) => ({
    requestId: r.requestId,
    userId: r.userId,
    credentialId: r.credId,
    staffName: r.staffName || "Staff member",
    staffEmail: r.staffEmail || "",
    label: r.label || "This device",
    status: r.status,
    createdAt: r.createdAt,
    decidedAt: r.decidedAt || null,
    decidedBy: r.decidedBy || "",
  });

  async function listDeviceRequests(user) {
    requireAdmin(user);

    const items = await store.query("ATTDEVREQ");

    const requests = items
      .filter((r) => r.requestId && r.status === "pending")
      .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")))
      .map(toDeviceRow);

    return json(200, { items: requests });
  }

  /* Phones that are approved and still in use. Includes the administrator's own earlier phone. */
  async function listApprovedDevices(event, user) {
    requireAdmin(user);

    await recordEarlierPhones(user, personOf(event, user));

    const items = (await store.query("ATTDEVREQ"))
      .filter((r) => r.requestId && r.status === "approved")
      .sort((a, b) => String(a.staffName || "").localeCompare(String(b.staffName || "")))
      .map(toDeviceRow);

    return json(200, { items });
  }

  async function decideDeviceRequest(requestId, event, user) {
    requireAdmin(user);

    const id = decodeURIComponent(requestId);
    const body = parseBody(event);
    const decision = String(body.decision || "").toLowerCase();

    if (decision !== "approved" && decision !== "rejected") {
      throw new HttpError(400, "Decision must be approved or rejected.");
    }

    const request = await store.get("ATTDEVREQ", `REQ#${id}`);

    if (!request) {
      throw new HttpError(404, "Phone registration request not found.");
    }

    if (request.status !== "pending") {
      throw new HttpError(409, "This phone request has already been decided.");
    }

    const credential = await store.get(`ATTCRED#${request.userId}`, `CRED#${request.credId}`);

    if (!credential || credential.removed || !isPendingCredential(credential)) {
      throw new HttpError(409, "The pending phone credential no longer exists. Refresh the request list.");
    }

    const now = new Date().toISOString();
    const note = text(body.note, "Decision note", 500) || "";

    if (decision === "approved") {
      const current = await store.query(`ATTCRED#${request.userId}`);

      const anotherApproved = current.some((c) => c.credId !== request.credId && isApprovedCredential(c));

      if (anotherApproved) {
        throw new HttpError(
          409,
          "This staff member already has an approved phone. Revoke the old phone before approving a replacement."
        );
      }

      await store.put({
        ...credential,
        approved: true,
        pending: false,
        approvedAt: now,
        approvedBy: user.id,
        approvalNote: note,
      });
    } else {
      await store.put({
        ...credential,
        approved: false,
        pending: false,
        rejected: true,
        rejectedAt: now,
        rejectedBy: user.id,
        rejectionNote: note,
      });
    }

    await store.put({
      ...request,
      status: decision,
      decidedAt: now,
      decidedBy: personOf(event, user).name,
      decisionNote: note,
    });

    return json(200, {
      ok: true,
      requestId: id,
      status: decision,
    });
  }

  async function adminRevokeDevice(userId, credentialId, user) {
    requireAdmin(user);

    const staffId = decodeURIComponent(userId);
    const credId = decodeURIComponent(credentialId);

    const credential = await store.get(`ATTCRED#${staffId}`, `CRED#${credId}`);

    if (!credential || credential.removed) {
      throw new HttpError(404, "Phone credential not found or already revoked.");
    }

    const now = new Date().toISOString();

    await store.put({
      ...credential,
      removed: true,
      removedAt: now,
      removedBy: user.id,
      approved: false,
      pending: false,
    });

    const requests = await store.query("ATTDEVREQ");

    const linked = requests.find((r) => r.userId === staffId && r.credId === credId);

    if (linked) {
      await store.put({
        ...linked,
        status: "revoked",
        revokedAt: now,
        revokedBy: user.id,
      });
    }

    return json(200, {
      ok: true,
      revoked: true,
    });
  }

  /* ---------- clocking in and out ---------- */

  async function punchOptions(event, user) {
    if (!webEnabled()) {
      throw new HttpError(403, "Clocking from a phone or laptop is switched off.");
    }

    relyingParty(event);
    requireOffice(event);

    const type = wantedType(parseBody(event));
    const me = personOf(event, user);
    const creds = await myCredentials(user);

    if (creds.length === 0) {
      throw new HttpError(409, "Set up your fingerprint on this device first.");
    }

    checkSequence(type, await myWebPunchesToday(me, user, await loadLinks()));

    const challenge = await saveChallenge(user, "PUNCH");

    return json(200, {
      challenge,
      rpId: creds[0].rpId,
      allowCredentials: creds.map((c) => c.credId),
    });
  }

  async function punch(event, user) {
    if (!webEnabled()) {
      throw new HttpError(403, "Clocking from a phone or laptop is switched off.");
    }

    const { origins } = relyingParty(event);
    requireOffice(event);

    const b = parseBody(event);
    const type = wantedType(b);
    const c = b.credential || {};

    const cred = await store.get(credPk(user), `CRED#${c.id}`);

    if (!isApprovedCredential(cred)) {
      throw new HttpError(403, "This phone is not approved for attendance. Contact IT or an administrator.");
    }

    const challenge = await takeChallenge(user, "PUNCH");

    const { authData, counter, clientHash } = checkClientData(c, {
      type: "webauthn.get",
      challenge,
      rpId: cred.rpId,
      origins,
    });

    // Verify the signature using the registered public key.
    let valid = false;

    try {
      const key = createPublicKey({
        key: fromB64u(cred.publicKey),
        format: "der",
        type: "spki",
      });

      valid = cryptoVerify("sha256", Buffer.concat([authData, clientHash]), key, fromB64u(c.signature));
    } catch {
      valid = false;
    }

    if (!valid) {
      throw new HttpError(401, "The fingerprint could not be verified. Please try again.");
    }

    // Check the authenticator counter where supported.
    if ((counter > 0 || Number(cred.counter) > 0) && counter <= Number(cred.counter || 0)) {
      throw new HttpError(401, "This device failed a safety check. Contact IT or an administrator.");
    }

    const me = personOf(event, user);

    checkSequence(type, await myWebPunchesToday(me, user, await loadLinks()));

    const at = new Date().toISOString();
    const id = randomUUID();

    const rec = {
      pk: `ATT#${nairobiMonth(at)}`,
      sk: `ATT#${at}#${id}`,
      id,
      userId: keyOf(me, user),
      name: me.name,
      email: me.email,
      at,
      type,
      method: "web",
      device: cred.label,
    };

    await store.put(rec);
    await store.put({
      ...cred,
      counter,
      lastUsedAt: at,
    });

    return json(201, toRecord(rec));
  }

  /* ---------- scanner links and file import ---------- */

  const SCANNER_ID = /^[A-Za-z0-9_-]{1,20}$/;

  async function listLinks(user) {
    requireAdmin(user);

    const links = [...(await loadLinks()).values()];

    return json(200, {
      items: links.map((l) => ({
        scannerId: l.scannerId,
        name: l.name,
        email: l.email || "",
      })),
    });
  }

  async function saveLink(event, user) {
    requireAdmin(user);

    const b = parseBody(event);
    const scannerId = String(b.scannerId ?? "").trim();

    if (!SCANNER_ID.test(scannerId)) {
      throw new HttpError(400, "Enter the scanner ID, using letters, numbers, - or _.");
    }

    const name = text(b.name, "Name", 120, { required: true });

    const email = String(b.email ?? "").trim().toLowerCase();

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new HttpError(400, "Enter a valid portal email.");
    }

    await store.put({
      pk: "STAFFLINK",
      sk: `LINK#${scannerId}`,
      scannerId,
      name,
      email,
      updatedAt: new Date().toISOString(),
    });

    return json(200, {
      scannerId,
      name,
      email,
    });
  }

  async function deleteLink(scannerId, user) {
    requireAdmin(user);

    const id = decodeURIComponent(scannerId);

    const link = await store.get("STAFFLINK", `LINK#${id}`);

    if (!link || link.deleted) {
      throw new HttpError(404, "Link not found.");
    }

    await store.put({
      ...link,
      deleted: true,
      deletedAt: new Date().toISOString(),
    });

    return json(200, { ok: true });
  }

  async function importPunches(event, user) {
    requireAdmin(user);

    const list = parseBody(event).punches;

    if (!Array.isArray(list) || list.length === 0) {
      throw new HttpError(400, "There are no punches to import.");
    }

    if (list.length > MAX_IMPORT) {
      throw new HttpError(400, `Send at most ${MAX_IMPORT} punches at a time.`);
    }

    const now = Date.now();

    let accepted = 0;
    let duplicates = 0;
    let rejected = 0;

    const seen = new Set();
    const todo = [];

    for (const p of list) {
      const scannerId = String(p?.scannerId ?? "").trim();

      const t = Date.parse(p?.at);

      if (!SCANNER_ID.test(scannerId) || Number.isNaN(t) || t > now + DAY_MS || t < now - 2 * 365 * DAY_MS) {
        rejected += 1;
        continue;
      }

      const at = new Date(t).toISOString();
      const sk = `ATT#${at}#S${scannerId}`;

      if (seen.has(sk)) {
        duplicates += 1;
        continue;
      }

      seen.add(sk);
      todo.push({
        pk: `ATT#${nairobiMonth(at)}`,
        sk,
        scannerId,
        at,
      });
    }

    for (let i = 0; i < todo.length; i += 25) {
      await Promise.all(
        todo.slice(i, i + 25).map(async (p) => {
          if (await store.get(p.pk, p.sk)) {
            duplicates += 1;
            return;
          }

          await store.put({
            ...p,
            id: randomUUID(),
            type: "punch",
            method: "scanner",
            importedBy: user.id,
            createdAt: new Date().toISOString(),
          });

          accepted += 1;
        })
      );
    }

    return json(200, {
      accepted,
      duplicates,
      rejectedCount: rejected,
    });
  }

  /* ---------- route dispatcher ---------- */

  return async function attendanceRoutes(method, seg, event, user) {
    const [, , sub, id, extra, action] = seg;

    if (sub === "status" && !id && method === "GET") {
      return status(event, user);
    }

    if (sub === "records" && !id && method === "GET") {
      return records(event, user);
    }

    if (sub === "register" && method === "POST") {
      if (!id) return register(event, user);
      if (id === "options") {
        return registerOptions(event, user);
      }
    }

    if (sub === "punch" && method === "POST") {
      if (!id) return punch(event, user);
      if (id === "options") {
        return punchOptions(event, user);
      }
    }

    // Staff cannot revoke their own registered phone.
    if (sub === "credentials" && id && method === "DELETE") {
      return removeDevice();
    }

    // Administrator device approval queue.
    if (sub === "device-requests") {
      if (!id && method === "GET") {
        return listDeviceRequests(user);
      }

      if (id && extra === "decision" && method === "POST") {
        return decideDeviceRequest(id, event, user);
      }
    }

    // Administrator list of approved phones. Several names are accepted for the same list.
    if (
      (sub === "devices" || sub === "approved-devices" || sub === "admin-credentials") &&
      !id &&
      method === "GET"
    ) {
      return listApprovedDevices(event, user);
    }

    // Administrator device revocation.
    if (sub === "admin-credentials" && id && extra && method === "DELETE") {
      return adminRevokeDevice(id, extra, user);
    }

    // The same requests, decisions and revocations under /devices/...
    if (sub === "devices" && id === "requests") {
      if (!extra && method === "GET") {
        return listDeviceRequests(user);
      }

      if (extra && action === "decision" && method === "POST") {
        return decideDeviceRequest(extra, event, user);
      }
    }

    if (sub === "devices" && id && id !== "requests" && extra && !action && method === "DELETE") {
      return adminRevokeDevice(id, extra, user);
    }

    if (sub === "staff-links") {
      if (!id && method === "GET") {
        return listLinks(user);
      }

      if (!id && method === "POST") {
        return saveLink(event, user);
      }

      if (id && method === "DELETE") {
        return deleteLink(id, user);
      }
    }

    if (sub === "import" && !id && method === "POST") {
      return importPunches(event, user);
    }

    throw new HttpError(404, "Not found.");
  };
}