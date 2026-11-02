/*
 * Staff attendance, as a plug-in for the existing M&E Lambda (same pattern as the leave and travel routes).
 * Same table, same login, same API route (ANY /me/{proxy+}). Nothing new to create in AWS.
 *
 * Staff clock in and out from their own phone or laptop. The device checks the fingerprint (or face unlock)
 * itself using WebAuthn and sends back a signed proof, which this file verifies. The fingerprint never
 * leaves the device. An office scanner can be added later: its punches come in through /import.
 *
 * URLs (all under /me, so the existing route already catches them)
 *   GET    /me/attendance/status                     my clock state, today's punches and my devices
 *   GET    /me/attendance/records?scope=me|all&from=&to=   records (scope=all is administrator / CEO only)
 *   POST   /me/attendance/register/options           step 1 of setting up a device
 *   POST   /me/attendance/register                   step 2 of setting up a device
 *   DELETE /me/attendance/credentials/{id}           remove one of my devices
 *   POST   /me/attendance/punch/options              step 1 of clocking in or out
 *   POST   /me/attendance/punch                      step 2 of clocking in or out
 *   GET    /me/attendance/staff-links                scanner ID to person links (administrator)
 *   POST   /me/attendance/staff-links                add or change a link (administrator)
 *   DELETE /me/attendance/staff-links/{scannerId}    remove a link (administrator)
 *   POST   /me/attendance/import                     load punches from a scanner file (administrator)
 *
 * Data (same table, partitions chosen so lists stay small)
 *   pk "ATT#2026-11"        sk "ATT#<time>#<id>"   one partition per month of punches (Nairobi month)
 *   pk "ATTCRED#<userId>"   sk "CRED#<credentialId>"   a person's registered devices
 *   pk "ATTCHAL#<userId>"   sk "REG" or "PUNCH"     the one-time challenge for the check in progress
 *   pk "STAFFLINK"          sk "LINK#<scannerId>"
 *
 * Nothing is ever deleted from the table here: removed devices and links are marked as removed.
 * Needs only store.get, store.put and store.query.
 *
 * Settings (Lambda environment variables)
 *   WEBAUTHN_ORIGINS     the web addresses the portal runs on, separated by commas, for example
 *                        https://portal.eachrights.org. If it is not set, the address the browser
 *                        sends is trusted, which is fine for testing but should be set for real use.
 *   WEBAUTHN_RP_ID       the domain the fingerprints are tied to, for example portal.eachrights.org.
 *                        If it is not set, it is taken from the address above.
 *   ATTENDANCE_WEB_PUNCH set to "off" to switch phone and laptop clocking off. It is on by default.
 *   ATTENDANCE_OFFICE_IPS optional. The office's public IP addresses, separated by commas. When it is set,
 *                        people can only clock in or out while connected to the office network.
 */

import { createHash, createPublicKey, randomBytes, randomUUID, timingSafeEqual, verify as cryptoVerify } from "node:crypto";

const TZ = "Africa/Nairobi";
const DAY_MS = 86400000;
const MAX_DEVICES = 3;
const CHALLENGE_MS = 5 * 60 * 1000;
const MAX_IMPORT = 1000;
const MAX_RANGE_DAYS = 93;
const RP_NAME = "EACHRights Portal";

const sha256 = (data) => createHash("sha256").update(data).digest();
const b64u = (buf) => Buffer.from(buf).toString("base64url");
const fromB64u = (s) => Buffer.from(String(s || ""), "base64url");

const nairobiDay = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });
const nairobiMonth = (iso) => nairobiDay(iso).slice(0, 7);
const todayNairobi = () => nairobiDay(new Date().toISOString());

/* Every month (as 2026-11) that the range touches, so each month's partition is read once */
function monthsBetween(fromIso, toIso) {
  const [y1, m1] = nairobiMonth(fromIso).split("-").map(Number);
  const [y2, m2] = nairobiMonth(toIso).split("-").map(Number);
  const out = [];
  for (let n = y1 * 12 + (m1 - 1); n <= y2 * 12 + (m2 - 1); n += 1) {
    out.push(`${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, "0")}`);
  }
  return out;
}

export function createAttendanceRoutes({ store, HttpError, json, parseBody, text }) {
  /* ---------- who is asking ---------- */

  function personOf(event, user) {
    const c = event.requestContext?.authorizer?.jwt?.claims || {};
    const full = [c.given_name, c.family_name].filter(Boolean).join(" ");
    return { name: String(c.name || full || user.name || "Staff member"), email: String(c.email || "") };
  }

  /* The same key is used for a person's phone punches and their linked scanner punches */
  const keyOf = (me, user) => (me.email ? me.email.toLowerCase() : String(user.id));

  const webEnabled = () => String(process.env.ATTENDANCE_WEB_PUNCH || "").toLowerCase() !== "off";

  /* Optional: only allow clocking from the office network, by the office's public IP address */
  function onOfficeNetwork(event) {
    const allowed = String(process.env.ATTENDANCE_OFFICE_IPS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (allowed.length === 0) return true;
    const ip = event.requestContext?.http?.sourceIp || event.requestContext?.identity?.sourceIp || "";
    return allowed.includes(ip);
  }

  function requireOffice(event) {
    if (!onOfficeNetwork(event)) {
      throw new HttpError(403, "You can only clock in or out from the office Wi-Fi.");
    }
  }

  function requireAdmin(user) {
    if (!user.isAdmin) throw new HttpError(403, "Only administrators and the CEO can do this.");
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
    if (origins.length === 0) throw new HttpError(500, "Fingerprint sign-in is not set up on the server (WEBAUTHN_ORIGINS).");
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

  /* One-time challenge for the check in progress. It is used up as soon as it is read. */
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

  /* Checks everything the device reports that does not depend on the key: what it was asked to do,
     the one-time challenge, the web address, the domain, and that the fingerprint was really checked. */
  function checkClientData(credential, { type, challenge, rpId, origins }) {
    const bad = (msg) => new HttpError(400, msg);
    let clientData;
    try {
      clientData = JSON.parse(fromB64u(credential.clientDataJSON).toString("utf8"));
    } catch {
      throw bad("The fingerprint check could not be read. Please try again.");
    }
    if (clientData.type !== type) throw bad("The fingerprint check was for something else.");
    if (clientData.challenge !== challenge) throw bad("The fingerprint check does not match. Please try again.");
    if (!origins.includes(clientData.origin) || clientData.crossOrigin === true) {
      throw bad("The fingerprint check came from a web address that is not allowed.");
    }

    const authData = fromB64u(credential.authenticatorData);
    if (authData.length < 37) throw bad("The fingerprint check could not be read. Please try again.");
    if (!timingSafeEqual(authData.subarray(0, 32), sha256(rpId))) throw bad("The fingerprint check is tied to a different site.");
    const flags = authData[32];
    if (!(flags & 0x01) || !(flags & 0x04)) throw bad("The fingerprint was not checked on the device. Please try again.");

    return {
      authData,
      counter: authData.readUInt32BE(33),
      clientHash: sha256(fromB64u(credential.clientDataJSON)),
    };
  }

  /* ---------- stored data ---------- */

  const credPk = (user) => `ATTCRED#${user.id}`;

  async function myCredentials(user) {
    return (await store.query(credPk(user))).filter((c) => !c.removed);
  }

  async function loadLinks() {
    const items = (await store.query("STAFFLINK")).filter((l) => !l.deleted);
    return new Map(items.map((l) => [l.scannerId, l]));
  }

  /* Scanner punches carry only the scanner ID. The person comes from the link, looked up when the
     records are read, so linking an ID later also fixes the older punches. */
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

  /* My clock-in and clock-out presses today, oldest first */
  async function myWebPunchesToday(me, user, links) {
    const { from, to } = todayRange();
    const key = keyOf(me, user);
    return (await fetchRecords(from, to, links)).filter((r) => r.userId === key && (r.type === "in" || r.type === "out"));
  }

  function checkSequence(type, punches) {
    const last = punches[punches.length - 1];
    if (type === "in" && last?.type === "in") throw new HttpError(409, "You are already clocked in.");
    if (type === "out" && last?.type !== "in") throw new HttpError(409, "You are not clocked in.");
  }

  function wantedType(b) {
    if (b.type !== "in" && b.type !== "out") throw new HttpError(400, "Type must be in or out.");
    return b.type;
  }

  /* ---------- status and records ---------- */

  async function status(event, user) {
    const me = personOf(event, user);
    const key = keyOf(me, user);
    const links = await loadLinks();
    const creds = await myCredentials(user);
    const { from, to } = todayRange();
    const today = (await fetchRecords(from, to, links)).filter((r) => r.userId === key);
    const web = today.filter((r) => r.type === "in" || r.type === "out");
    const last = web[web.length - 1];
    const linked = Boolean(me.email) && [...links.values()].some((l) => l.email && l.email.toLowerCase() === me.email.toLowerCase());

    return json(200, {
      webPunchEnabled: webEnabled(),
      onOfficeNetwork: onOfficeNetwork(event),
      linked,
      enrolled: creds.length > 0,
      maxDevices: MAX_DEVICES,
      devices: creds.map((c) => ({ id: c.credId, label: c.label, createdAt: c.createdAt, lastUsedAt: c.lastUsedAt || null })),
      today: today.map((r) => ({ id: r.id, at: r.at, type: r.type, method: r.method })),
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
    if (Number.isNaN(from) || Number.isNaN(to) || to < from) throw new HttpError(400, "The dates are not valid.");
    if (to - from > MAX_RANGE_DAYS * DAY_MS) throw new HttpError(400, "Choose a period of three months or less.");

    const me = personOf(event, user);
    const key = keyOf(me, user);
    const links = await loadLinks();
    const all = await fetchRecords(new Date(from).toISOString(), new Date(to).toISOString(), links);
    const items = all.filter((r) => scope === "all" || r.userId === key).map(toRecord);
    return json(200, { items });
  }

  /* ---------- setting up a device ---------- */

  async function registerOptions(event, user) {
    if (!webEnabled()) throw new HttpError(403, "Clocking from a phone or laptop is switched off.");
    const { rpId } = relyingParty(event);
    const me = personOf(event, user);
    const creds = await myCredentials(user);
    if (creds.length >= MAX_DEVICES) {
      throw new HttpError(409, `You can have up to ${MAX_DEVICES} devices. Remove one first.`);
    }
    const challenge = await saveChallenge(user, "REG");
    return json(200, {
      challenge,
      rp: { name: RP_NAME, id: rpId },
      user: { id: b64u(sha256(String(user.id))), name: me.email || me.name, displayName: me.name },
      excludeCredentials: creds.map((c) => c.credId),
    });
  }

  async function register(event, user) {
    if (!webEnabled()) throw new HttpError(403, "Clocking from a phone or laptop is switched off.");
    const { rpId, origins } = relyingParty(event);
    const c = parseBody(event).credential || {};
    const challenge = await takeChallenge(user, "REG");
    const { authData, counter } = checkClientData(c, { type: "webauthn.create", challenge, rpId, origins });

    // The device's authenticator data must carry the new credential, and it must be the one reported
    if (!(authData[32] & 0x40) || authData.length < 55) throw new HttpError(400, "The device did not return a new fingerprint credential.");
    const idLength = authData.readUInt16BE(53);
    const credId = b64u(authData.subarray(55, 55 + idLength));
    if (!credId || credId !== c.id) throw new HttpError(400, "The fingerprint credential does not match. Please try again.");

    let key;
    try {
      key = createPublicKey({ key: fromB64u(c.publicKey), format: "der", type: "spki" });
    } catch {
      throw new HttpError(400, "The device's key could not be read.");
    }
    const alg = Number(c.publicKeyAlg);
    const supported =
      (alg === -7 && key.asymmetricKeyType === "ec" && key.asymmetricKeyDetails?.namedCurve === "prime256v1") ||
      (alg === -257 && key.asymmetricKeyType === "rsa");
    if (!supported) throw new HttpError(400, "This device uses a kind of key that is not supported.");

    const creds = await myCredentials(user);
    if (creds.length >= MAX_DEVICES) throw new HttpError(409, `You can have up to ${MAX_DEVICES} devices. Remove one first.`);
    if (creds.some((x) => x.credId === credId)) throw new HttpError(409, "This device is already set up.");

    await store.put({
      pk: credPk(user),
      sk: `CRED#${credId}`,
      credId,
      publicKey: c.publicKey,
      alg,
      counter,
      rpId,
      label: text(c.label, "Device name", 60) || "This device",
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
    });
    return json(201, { ok: true });
  }

  async function removeDevice(id, user) {
    const credId = (() => {
      try {
        return decodeURIComponent(id);
      } catch {
        return id;
      }
    })();
    const cred = await store.get(credPk(user), `CRED#${credId}`);
    if (!cred || cred.removed) throw new HttpError(404, "Device not found.");
    await store.put({ ...cred, removed: true, removedAt: new Date().toISOString() });
    return json(200, { ok: true });
  }

  /* ---------- clocking in and out ---------- */

  async function punchOptions(event, user) {
    if (!webEnabled()) throw new HttpError(403, "Clocking from a phone or laptop is switched off.");
    relyingParty(event);
    requireOffice(event);
    const type = wantedType(parseBody(event));
    const me = personOf(event, user);
    const creds = await myCredentials(user);
    if (creds.length === 0) throw new HttpError(409, "Set up your fingerprint on this device first.");
    checkSequence(type, await myWebPunchesToday(me, user, await loadLinks()));

    const challenge = await saveChallenge(user, "PUNCH");
    return json(200, { challenge, rpId: creds[0].rpId, allowCredentials: creds.map((c) => c.credId) });
  }

  async function punch(event, user) {
    if (!webEnabled()) throw new HttpError(403, "Clocking from a phone or laptop is switched off.");
    const { origins } = relyingParty(event);
    requireOffice(event);
    const b = parseBody(event);
    const type = wantedType(b);
    const c = b.credential || {};

    const cred = await store.get(credPk(user), `CRED#${c.id}`);
    if (!cred || cred.removed) throw new HttpError(403, "This device is not set up. Set up your fingerprint first.");

    const challenge = await takeChallenge(user, "PUNCH");
    const { authData, counter, clientHash } = checkClientData(c, { type: "webauthn.get", challenge, rpId: cred.rpId, origins });

    // The signature proves the device holding the registered key approved this exact check
    let valid = false;
    try {
      const key = createPublicKey({ key: fromB64u(cred.publicKey), format: "der", type: "spki" });
      valid = cryptoVerify("sha256", Buffer.concat([authData, clientHash]), key, fromB64u(c.signature));
    } catch {
      valid = false;
    }
    if (!valid) throw new HttpError(401, "The fingerprint could not be verified. Please try again.");

    // A counter that does not move forward means the key may have been copied
    if ((counter > 0 || Number(cred.counter) > 0) && counter <= Number(cred.counter || 0)) {
      throw new HttpError(401, "This device failed a safety check. Remove it and set it up again.");
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
    await store.put({ ...cred, counter, lastUsedAt: at });
    return json(201, toRecord(rec));
  }

  /* ---------- scanner links and file import (administrator) ---------- */

  const SCANNER_ID = /^[A-Za-z0-9_-]{1,20}$/;

  async function listLinks(user) {
    requireAdmin(user);
    const links = [...(await loadLinks()).values()];
    return json(200, { items: links.map((l) => ({ scannerId: l.scannerId, name: l.name, email: l.email || "" })) });
  }

  async function saveLink(event, user) {
    requireAdmin(user);
    const b = parseBody(event);
    const scannerId = String(b.scannerId ?? "").trim();
    if (!SCANNER_ID.test(scannerId)) throw new HttpError(400, "Enter the scanner ID, using letters, numbers, - or _.");
    const name = text(b.name, "Name", 120, { required: true });
    const email = String(b.email ?? "").trim().toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Enter a valid portal email.");

    await store.put({ pk: "STAFFLINK", sk: `LINK#${scannerId}`, scannerId, name, email, updatedAt: new Date().toISOString() });
    return json(200, { scannerId, name, email });
  }

  async function deleteLink(scannerId, user) {
    requireAdmin(user);
    const id = decodeURIComponent(scannerId);
    const link = await store.get("STAFFLINK", `LINK#${id}`);
    if (!link || link.deleted) throw new HttpError(404, "Link not found.");
    await store.put({ ...link, deleted: true, deletedAt: new Date().toISOString() });
    return json(200, { ok: true });
  }

  async function importPunches(event, user) {
    requireAdmin(user);
    const list = parseBody(event).punches;
    if (!Array.isArray(list) || list.length === 0) throw new HttpError(400, "There are no punches to import.");
    if (list.length > MAX_IMPORT) throw new HttpError(400, `Send at most ${MAX_IMPORT} punches at a time.`);

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
      todo.push({ pk: `ATT#${nairobiMonth(at)}`, sk, scannerId, at });
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
    return json(200, { accepted, duplicates, rejectedCount: rejected });
  }

  /* Called from route() for /me/attendance/... ; seg is ["me", "attendance", sub, id, ...] */
  return async function attendanceRoutes(method, seg, event, user) {
    const [, , sub, id] = seg;

    if (sub === "status" && !id && method === "GET") return status(event, user);
    if (sub === "records" && !id && method === "GET") return records(event, user);

    if (sub === "register" && method === "POST") {
      if (!id) return register(event, user);
      if (id === "options") return registerOptions(event, user);
    }
    if (sub === "punch" && method === "POST") {
      if (!id) return punch(event, user);
      if (id === "options") return punchOptions(event, user);
    }
    if (sub === "credentials" && id && method === "DELETE") return removeDevice(id, user);

    if (sub === "staff-links") {
      if (!id && method === "GET") return listLinks(user);
      if (!id && method === "POST") return saveLink(event, user);
      if (id && method === "DELETE") return deleteLink(id, user);
    }
    if (sub === "import" && !id && method === "POST") return importPunches(event, user);

    throw new HttpError(404, "Not found.");
  };
}