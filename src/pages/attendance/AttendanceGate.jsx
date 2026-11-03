import { useEffect, useState } from "react";
import { Fingerprint } from "lucide-react";
import { WEEKEND_DAYS, holidayName } from "../../holidays";
import { listAway } from "../travel/travelApi";
import { fingerprintSupported, getStatus, punch, listLeave, setWorkingFromHome } from "./attendanceApi";

/*
 * Blocks the whole portal after sign-in until the person either clocks in or says they are
 * working from home today. "Working from home" is saved on the server, so it is recorded and an
 * administrator can see it (GET /me/attendance/wfh).
 *
 * It is shown only when ALL of these are true:
 *   - phone/laptop clocking is switched on and this person has an approved phone
 *   - they are on the office network (off the office network = working remotely, no screen)
 *   - they have not clocked in yet today and have not chosen working from home
 *   - today is a working day (not a weekend, public holiday, leave or official travel)
 *
 * Mount it ONCE inside the signed-in layout, so it runs after every sign-in:
 *
 *   <AttendanceGate />
 *
 * Safety valve: if clocking in fails (lost phone, Bluetooth problems), a "Continue for now" button
 * appears so nobody is locked out of the portal. It only lasts for that browser session and is not
 * recorded as attendance. To remove it, set ALLOW_SKIP_AFTER_FAILURE to false.
 */

const ALLOW_SKIP_AFTER_FAILURE = true;

// Prints why the screen did or did not appear in the browser console (F12). Set to false when done.
const DEBUG = true;
const why = (msg, extra) => DEBUG && console.log("[AttendanceGate]", msg, extra ?? "");

const TZ = "Africa/Nairobi";
const SKIP_KEY = "attendance_gate_skip";

const dayKey = (d = new Date()) => d.toLocaleDateString("en-CA", { timeZone: TZ });
const weekday = (key) => new Date(`${key}T12:00:00Z`).getUTCDay(); // 0 = Sunday
const timeOf = (iso) =>
  new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: TZ });

const skippedThisSession = () => {
  try {
    return sessionStorage.getItem(SKIP_KEY) === dayKey();
  } catch {
    return false;
  }
};

function friendly(e) {
  if (e.code === "NOT_IN_OFFICE") return "You can only clock in or out from the office Wi-Fi.";
  if (e.name === "NotAllowedError")
    return "The fingerprint check was cancelled or timed out. Please try again. If you are using your phone with a computer, keep Bluetooth on for both.";
  if (e.name === "SecurityError") return "Fingerprint sign-in is not available on this web address.";
  return e.message || "Something went wrong.";
}

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#008060]";

export default function AttendanceGate() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [failed, setFailed] = useState(false);
  const [done, setDone] = useState("");

  useEffect(() => {
    let on = true;

    async function check() {
      const today = dayKey();

      why("started");
      if (skippedThisSession()) return why("not shown: skipped for this session");
      if (WEEKEND_DAYS.includes(weekday(today)) || holidayName(today)) return why("not shown: weekend or public holiday", today);
      if (!fingerprintSupported()) return why("not shown: browser has no WebAuthn (needs HTTPS or localhost)");

      let status;
      try {
        status = await getStatus();
      } catch (e) {
        why("not shown: could not load attendance status", e?.message);
        return; // never lock people out of the portal because of an attendance problem
      }

      why("status", status);
      if (!status?.webPunchEnabled) return why("not shown: phone/laptop clocking is switched off on the server");
      if (!status.enrolled) return why("not shown: no approved phone for this person");
      if (status.onOfficeNetwork === false) return why("not shown: not on the office network"); // not at the office
      if (status.workingFromHome) return why("not shown: already chose working from home today");
      if ((status.today || []).some((r) => r.type === "in" || r.type === "out")) return why("not shown: already clocked in today");

      // Skip people on approved leave or official travel today.
      const [leave, trips] = await Promise.all([
        listLeave({ scope: "me", from: today, to: today }).catch(() => []),
        listAway({ scope: "me", from: today, to: today }).catch(() => []),
      ]);
      if ([...leave, ...trips].some((l) => l.from <= today && today <= l.to)) return why("not shown: on leave or official travel today");

      why("SHOWING the clock-in screen");
      if (on) setOpen(true);
    }

    check();
    return () => {
      on = false;
    };
  }, []);

  async function clockIn() {
    setBusy(true);
    setError("");
    try {
      const rec = await punch("in");
      setDone(`Clocked in at ${timeOf(rec.at)}. Have a good day!`);
      setTimeout(() => setOpen(false), 2000);
    } catch (e) {
      setError(friendly(e));
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  async function workingFromHome() {
    setBusy(true);
    setError("");
    try {
      await setWorkingFromHome();
      setOpen(false);
    } catch (e) {
      setError(friendly(e));
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  function continueForNow() {
    try {
      sessionStorage.setItem(SKIP_KEY, dayKey());
    } catch {
      /* ignore */
    }
    setOpen(false);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#F6F7F8] p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="attendance-gate-title"
        className="w-full max-w-md rounded-2xl border border-[#E6ECE9] bg-white p-6 text-[#0B2B24] shadow-xl"
      >
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#E3F3EC] text-[#008060]">
            <Fingerprint size={24} />
          </span>
          <h2 id="attendance-gate-title" className="text-xl font-semibold">
            Clock in to continue
          </h2>
        </div>

        {done ? (
          <p role="status" className="mt-4 rounded-lg bg-[#E3F3EC] px-3 py-2 text-sm text-[#00664E]">
            {done}
          </p>
        ) : (
          <>
            <p className="mt-3 text-sm text-[#475467]">
              You&apos;re on the office network and haven&apos;t clocked in today. Clock in to open the portal. If you
              are working from home, choose that instead.
            </p>
            <p className="mt-2 text-xs text-[#667085]">
              On a computer, scan the QR code with your phone, then touch your fingerprint sensor when it asks.
            </p>

            {error && (
              <p role="alert" className="mt-3 rounded-lg bg-[#FDECEA] px-3 py-2 text-sm text-[#8A1C14]">
                {error}
              </p>
            )}

            <div className="mt-5 flex flex-col gap-2">
              <button
                onClick={clockIn}
                disabled={busy}
                className={`inline-flex items-center justify-center gap-2 rounded-lg border border-[#008060] bg-[#008060] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#00664E] disabled:opacity-60 motion-reduce:transition-none ${FOCUS}`}
              >
                <Fingerprint size={16} /> {busy ? "Waiting for your phone..." : "Clock in now"}
              </button>
              <button
                onClick={workingFromHome}
                disabled={busy}
                className={`rounded-lg border border-[#C9CED6] bg-white px-4 py-2.5 text-sm text-[#0B2B24] transition hover:bg-[#F6F7F8] disabled:opacity-60 motion-reduce:transition-none ${FOCUS}`}
              >
                I&apos;m working from home today
              </button>
              {ALLOW_SKIP_AFTER_FAILURE && failed && (
                <button
                  onClick={continueForNow}
                  disabled={busy}
                  className={`text-sm text-[#667085] underline hover:text-[#0B2B24] ${FOCUS}`}
                >
                  Can&apos;t clock in? Continue for now and tell IT
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
