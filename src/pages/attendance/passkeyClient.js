// Browser side of passkey clocking (talks to the phone's fingerprint / face / PIN prompt).
import { getRegisterOptions, registerPasskey, getClockChallenge } from "./attendanceApi";

const toBuf = (s) => {
  const b64 = String(s).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0)).buffer;
};
const toB64u = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

// Passkeys only work on https:// pages (and localhost) in a browser that supports them
export const passkeysSupported = () =>
  typeof window !== "undefined" && window.isSecureContext && !!window.PublicKeyCredential && !!navigator.credentials;

const friendly = (e) => {
  if (e?.name === "NotAllowedError" || e?.name === "AbortError") {
    return new Error("The fingerprint, face or PIN check was cancelled or timed out. Please try again.");
  }
  if (e?.name === "InvalidStateError") return new Error("This device is already registered.");
  return e;
};

const deviceLabel = () => {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return "iPhone or iPad";
  if (/Android/i.test(ua)) return "Android phone";
  if (/Windows/i.test(ua)) return "Windows computer";
  if (/Mac/i.test(ua)) return "Mac";
  return "This device";
};

// Registers the phone or laptop the person is using now
export async function registerThisDevice() {
  const opts = await getRegisterOptions();
  let cred;
  try {
    cred = await navigator.credentials.create({
      publicKey: {
        ...opts,
        challenge: toBuf(opts.challenge),
        user: { ...opts.user, id: toBuf(opts.user.id) },
        excludeCredentials: (opts.excludeCredentials || []).map((c) => ({ ...c, id: toBuf(c.id) })),
      },
    });
  } catch (e) {
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
}

// Asks the phone to unlock and returns the signed answer to send with the clock request
export async function getAssertion() {
  const opts = await getClockChallenge();
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