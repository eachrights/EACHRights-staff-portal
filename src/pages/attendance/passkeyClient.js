// Browser side of passkey clocking (talks to the phone's fingerprint / face / PIN prompt).
//
// iPhone note: Safari only lets a page open the Face ID / Touch ID prompt shortly after a tap. If the page
// downloads its challenge AFTER the tap, a slow connection can make Safari refuse (NotAllowedError). So the
// challenges are fetched ahead of time (prepare...) and the tap goes straight to the prompt.
import {
  getRegisterOptions,
  registerPasskey,
  getClockChallenge,
  getPublicChallenge,
} from "./attendanceApi";

const toBuf = (s) => {
  const b64 = String(s).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0)).buffer;
};
const toB64u = (buf) => {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

// Passkeys only work on https:// pages (and localhost) in a browser that supports them
export const passkeysSupported = () =>
  typeof window !== "undefined" && window.isSecureContext && !!window.PublicKeyCredential && !!navigator.credentials;

const friendly = (e) => {
  const name = e?.name || "Error";
  if (name === "InvalidStateError") return new Error("This device is already registered.");
  if (name === "NotAllowedError" || name === "AbortError") {
    return new Error(
      "The fingerprint, face or PIN check was cancelled or did not start. On an iPhone, open the portal in Safari " +
        "(not inside WhatsApp or another app), check Settings > your name > iCloud > Passwords and Keychain is on, " +
        `and try again. (${name})`
    );
  }
  if (name === "SecurityError") {
    return new Error(
      `This page's address does not match the one passkeys were set up for. Open the portal at its usual address. (${e.message})`
    );
  }
  if (name === "NotSupportedError") {
    return new Error(`This phone or browser does not support this kind of passkey. (${e.message})`);
  }
  return new Error(`${e?.message || "Could not use the passkey."} (${name})`);
};

const deviceLabel = () => {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return "iPhone or iPad";
  if (/Android/i.test(ua)) return "Android phone";
  if (/Windows/i.test(ua)) return "Windows computer";
  if (/Mac/i.test(ua)) return "Mac";
  return "This device";
};

/* ---------- challenges fetched ahead of the tap ---------- */

const KEEP_MS = 90 * 1000; // use a prepared challenge for at most this long
const prepared = { register: null, clock: null, publicClock: null };
const isFresh = (slot) => slot && Date.now() - slot.at < KEEP_MS;

function prepare(slot, fetcher) {
  if (!passkeysSupported()) return;
  fetcher()
    .then((opts) => {
      prepared[slot] = { opts, at: Date.now() };
    })
    .catch(() => {
      /* the tap will fetch it again and show the real error */
    });
}

// Call these when the page opens and every minute or so while it stays open.
export const prepareRegistration = () => prepare("register", getRegisterOptions);
export const prepareAssertion = () => prepare("clock", getClockChallenge);
export const preparePublicAssertion = () => prepare("publicClock", getPublicChallenge);

// Takes the prepared challenge (each one is used once), or fetches a new one if none is ready
async function take(slot, fetcher) {
  const ready = prepared[slot];
  prepared[slot] = null;
  return isFresh(ready) ? ready.opts : fetcher();
}

/* ---------- register this device ---------- */

export async function registerThisDevice() {
  const opts = await take("register", getRegisterOptions);
  let cred;
  try {
    cred = await navigator.credentials.create({
      publicKey: {
        attestation: "none",
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        ...opts,
        challenge: toBuf(opts.challenge),
        user: { ...opts.user, id: toBuf(opts.user.id) },
        excludeCredentials: (opts.excludeCredentials || []).map((c) => ({ ...c, id: toBuf(c.id) })),
      },
    });
  } catch (e) {
    prepareRegistration(); // so the next try goes straight to the prompt
    throw friendly(e);
  }
  const r = cred.response;
  if (!r.getPublicKey || !r.getAuthenticatorData) {
    throw new Error("This browser is too old to register a passkey. Update it, or use Chrome, Safari or Edge.");
  }
  await registerPasskey({
    credentialId: cred.id,
    clientDataJSON: toB64u(r.clientDataJSON),
    authenticatorData: toB64u(r.getAuthenticatorData()),
    publicKey: toB64u(r.getPublicKey()),
    publicKeyAlgorithm: r.getPublicKeyAlgorithm?.(),
    label: deviceLabel(),
  });
  prepareRegistration(); // the old options still list the previous devices to exclude
}

/* ---------- clock in or out ---------- */

// Asks the phone to unlock and returns the signed answer to send with the clock request
export async function getAssertion() {
  const opts = await take("clock", getClockChallenge);
  let cred;
  try {
    cred = await navigator.credentials.get({
      publicKey: {
        challenge: toBuf(opts.challenge),
        rpId: opts.rpId,
        allowCredentials: (opts.allowCredentials || []).map((c) => ({ ...c, id: toBuf(c.id) })),
        userVerification: "required",
        timeout: opts.timeout,
      },
    });
  } catch (e) {
    prepareAssertion();
    throw friendly(e);
  }
  const r = cred.response;
  return {
    credentialId: cred.id,
    clientDataJSON: toB64u(r.clientDataJSON),
    authenticatorData: toB64u(r.authenticatorData),
    signature: toB64u(r.signature),
  };
}

// Clocking from the public /clock page: the phone picks the passkey itself, so nobody has to sign in.
export async function getPublicAssertion() {
  const opts = await take("publicClock", getPublicChallenge);
  let cred;
  try {
    cred = await navigator.credentials.get({
      publicKey: {
        challenge: toBuf(opts.challenge),
        rpId: opts.rpId,
        userVerification: "required",
        timeout: opts.timeout,
      },
    });
  } catch (e) {
    preparePublicAssertion();
    throw friendly(e);
  }
  const r = cred.response;
  return {
    credentialId: cred.id,
    clientDataJSON: toB64u(r.clientDataJSON),
    authenticatorData: toB64u(r.authenticatorData),
    signature: toB64u(r.signature),
    userHandle: r.userHandle ? toB64u(r.userHandle) : "",
  };
}