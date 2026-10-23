import { userPool } from "../cognito";

// Where the login page lives in your router. Change if yours is different.
export const LOGIN_PATH = "/login";

const AUTH_KEY = "eachrights_auth";

/*
 * Fully signs the user out, from any page:
 *  1. clears the Cognito SDK's own tokens
 *  2. clears the portal session saved by Login.jsx (local + session storage)
 *  3. does a hard redirect so no page keeps old data in memory
 */
export function signOut() {
  try {
    userPool.getCurrentUser()?.signOut();
  } catch (err) {
    console.error("Cognito sign-out error:", err);
  }

  try {
    localStorage.removeItem(AUTH_KEY);
    sessionStorage.removeItem(AUTH_KEY);
  } catch (err) {
    console.error("Storage clear error:", err);
  }

  window.location.replace(LOGIN_PATH);
}

/* Email of the signed-in user, read from the session saved at login. */
export function getSignedInEmail() {
  try {
    const raw =
      sessionStorage.getItem(AUTH_KEY) || localStorage.getItem(AUTH_KEY);
    return raw ? JSON.parse(raw).email || "" : "";
  } catch {
    return "";
  }
}
