import { useEffect, useState } from "react";
import { Fingerprint, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { getPublicInfo, publicClock } from "./attendanceApi";
import { passkeysSupported, getPublicAssertion, preparePublicAssertion } from "./passkeyClient";

// Public page opened by the office QR code (route /clock). No sign-in: the phone's fingerprint, face or PIN
// identifies the person. It only works on the office network and on a phone that was registered earlier.

const TZ = "Africa/Nairobi";
const REFRESH_MS = 60000;
const timeOf = (iso) =>
  new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: TZ });

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#008060]";

function useNow() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export default function ClockPage() {
  const now = useNow();
  const [info, setInfo] = useState(null);
  const [infoError, setInfoError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  // The QR code carries ?clock=<token>
  const [token] = useState(() => {
    try {
      return new URL(window.location.href).searchParams.get("clock") || "";
    } catch {
      return "";
    }
  });

  const supported = passkeysSupported();
  const blocked = info && !info.canClock;
  const needQr = info?.requireQr && !token;
  const ready = supported && !!info && !blocked && !needQr;

  useEffect(() => {
    let on = true;
    getPublicInfo()
      .then((r) => on && setInfo(r))
      .catch((e) => on && setInfoError(e.message));
    return () => {
      on = false;
    };
  }, []);

  // Fetch the challenge before the tap (Safari only opens the Face ID / Touch ID prompt shortly after a tap),
  // then refresh it every minute while the page stays open
  useEffect(() => {
    if (!ready) return undefined;
    preparePublicAssertion();
    const t = setInterval(preparePublicAssertion, REFRESH_MS);
    return () => clearInterval(t);
  }, [ready]);

  async function onClock() {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const assertion = await getPublicAssertion();
      const r = await publicClock(assertion, token);
      setResult(r);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      // The prepared challenge is used up, even when the server then refused the clock
      preparePublicAssertion();
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#EEF7F3] px-4 py-8 text-[#0B2B24]">
      <div className="w-full max-w-sm rounded-3xl border border-[#E1EDE7] bg-white p-6 text-center shadow-sm">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-[#008060] text-2xl font-semibold text-white">
          E
        </div>
        <h1 className="mt-3 text-xl font-semibold">EACHRights attendance</h1>

        <p className="mt-4 text-4xl font-semibold tabular-nums">{now.toLocaleTimeString("en-GB", { timeZone: TZ })}</p>
        <p className="text-sm text-[#667085]">
          {now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: TZ })}
        </p>

        {result ? (
          <div role="status" className="mt-6 rounded-2xl bg-[#E3F3EC] p-4 text-[#00664E]">
            <CheckCircle2 className="mx-auto" size={36} />
            <p className="mt-2 text-lg font-semibold">{result.action === "in" ? "Clocked in" : "Clocked out"}</p>
            <p className="text-sm">{result.name}</p>
            <p className="mt-1 text-sm">
              {result.action === "in"
                ? `at ${timeOf(result.record.in)}`
                : `at ${timeOf(result.record.out)}${result.record.hours ? `, ${result.record.hours} hours today` : ""}`}
            </p>
            {result.record.late && result.action === "in" && (
              <p className="mt-1 text-sm text-[#8A4B00]">You are marked late today.</p>
            )}
          </div>
        ) : (
          <>
            {infoError && (
              <p role="alert" className="mt-6 rounded-xl bg-[#FDECEA] px-3 py-2 text-sm text-[#8A1C14]">
                {infoError}
              </p>
            )}

            {blocked && (
              <p role="alert" className="mt-6 flex items-start gap-2 rounded-xl bg-[#FFF4E5] px-3 py-2 text-left text-sm text-[#8A4B00]">
                <AlertTriangle size={18} className="mt-0.5 shrink-0" />
                <span>
                  {info.reason} Connect your phone to the office Wi-Fi (not mobile data) and reload this page.
                </span>
              </p>
            )}

            {!supported && (
              <p role="alert" className="mt-6 rounded-xl bg-[#FFF4E5] px-3 py-2 text-sm text-[#8A4B00]">
                This browser can't use fingerprint or PIN here. Open this page in Chrome or Safari.
              </p>
            )}

            {needQr && (
              <p role="alert" className="mt-6 rounded-xl bg-[#FFF4E5] px-3 py-2 text-sm text-[#8A4B00]">
                Please scan the QR code at the office with your phone camera.
              </p>
            )}

            <button
              onClick={onClock}
              disabled={busy || !ready}
              className={`mx-auto mt-6 flex h-32 w-32 flex-col items-center justify-center gap-1 rounded-full bg-[#008060] text-white transition hover:bg-[#00664E] disabled:opacity-50 motion-reduce:transition-none ${FOCUS}`}
            >
              {busy ? <Loader2 size={34} className="animate-spin motion-reduce:animate-none" /> : <Fingerprint size={38} />}
              <span className="text-sm font-medium">{busy ? "Please wait" : "Clock in / out"}</span>
            </button>
            <p className="mt-3 text-xs text-[#667085]">Your phone will ask for your fingerprint, face or PIN.</p>
            <p className="mt-1 text-xs text-[#667085]">
              Your first scan of the day is your clock in. Each later scan updates your clock out, so scan once more when you leave.
            </p>

            {error && (
              <p role="alert" className="mt-4 rounded-xl bg-[#FDECEA] px-3 py-2 text-sm text-[#8A1C14]">
                {error}
              </p>
            )}
          </>
        )}

        <p className="mt-6 text-xs text-[#667085]">
          First time? Sign in to the staff portal once, open Attendance, and register this phone under My phone.{" "}
          <a href="/" className="font-semibold text-[#008060] underline">
            Open the portal
          </a>
        </p>
      </div>
    </main>
  );
}
