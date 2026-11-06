// Import this FIRST in src/main.jsx:   import "./pages/attendance/captureClockToken";
//
// The printed QR code opens the portal with ?clock=<token>. A phone that is not signed in is sent to the login
// page, which would lose that part of the address. This saves the token the moment the page opens, so the
// Attendance page can still use it after sign-in.
const KEY = "eachrights_clock_qr";

try {
  const t = new URL(window.location.href).searchParams.get("clock");
  if (t) localStorage.setItem(KEY, JSON.stringify({ t, at: Date.now() }));
} catch {
  /* storage can be blocked in private mode; the QR still works if the person is already signed in */
}