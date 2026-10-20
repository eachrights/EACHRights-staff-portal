import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { LogOut } from "lucide-react";

import { userPool } from "../cognito";

/*
 * Signs the user out after a period of inactivity.
 *
 * Mount it ONCE, inside <BrowserRouter>, e.g. in App.jsx:
 *
 *   <BrowserRouter>
 *     <IdleTimeout />
 *     <Routes>...</Routes>
 *   </BrowserRouter>
 *
 * It only does anything while someone is signed in.
 */

const IDLE_MS = 15 * 60 * 1000; // inactivity before the warning appears
const WARNING_MS = 60 * 1000; // how long the warning shows before sign-out

const ACTIVITY_KEY = "eachrights_last_activity";
const LOGOUT_KEY = "eachrights_idle_logout";

const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"];

function formatCountdown(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");

  return `${minutes}:${seconds}`;
}

function IdleTimeout() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const [secondsLeft, setSecondsLeft] = useState(null);

  const warningRef = useRef(false);
  const lastWriteRef = useRef(0);
  const buttonRef = useRef(null);

  const markActive = useCallback(() => {
    const now = Date.now();

    lastWriteRef.current = now;
    localStorage.setItem(ACTIVITY_KEY, String(now));
  }, []);

  const hideWarning = useCallback(() => {
    warningRef.current = false;
    setSecondsLeft(null);
  }, []);

  const signOut = useCallback(() => {
    const currentUser = userPool.getCurrentUser();

    if (currentUser) currentUser.signOut();

    localStorage.removeItem("eachrights_auth");
    sessionStorage.removeItem("eachrights_auth");
    localStorage.removeItem(ACTIVITY_KEY);

    // Tell the other open tabs to leave too
    localStorage.setItem(LOGOUT_KEY, String(Date.now()));

    hideWarning();
    navigate("/", { replace: true, state: { reason: "idle" } });
  }, [navigate, hideWarning]);

  // Moving to a new page counts as activity (this also starts the timer after login)
  useEffect(() => {
    if (userPool.getCurrentUser()) markActive();
  }, [pathname, markActive]);

  useEffect(() => {
    const onActivity = () => {
      if (warningRef.current) return; // once warned, only the button keeps the session
      if (!userPool.getCurrentUser()) return;

      if (Date.now() - lastWriteRef.current > 1000) markActive();
    };

    const tick = () => {
      if (!userPool.getCurrentUser()) {
        if (warningRef.current) hideWarning();
        return;
      }

      const last = Number(localStorage.getItem(ACTIVITY_KEY));

      if (!last) {
        markActive();
        return;
      }

      const idle = Date.now() - last;

      if (idle >= IDLE_MS + WARNING_MS) {
        signOut();
      } else if (idle >= IDLE_MS) {
        warningRef.current = true;
        setSecondsLeft(Math.ceil((IDLE_MS + WARNING_MS - idle) / 1000));
      } else if (warningRef.current) {
        // Activity in another tab dismissed the warning
        hideWarning();
      }
    };

    const onStorage = (event) => {
      if (event.key === LOGOUT_KEY && event.newValue) {
        hideWarning();
        navigate("/", { replace: true, state: { reason: "idle" } });
      }
    };

    ACTIVITY_EVENTS.forEach((name) =>
      window.addEventListener(name, onActivity, { passive: true })
    );
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", tick);

    // Compares timestamps, so it stays correct even if the browser throttles
    // timers in background tabs or the laptop sleeps.
    const interval = window.setInterval(tick, 1000);

    return () => {
      ACTIVITY_EVENTS.forEach((name) => window.removeEventListener(name, onActivity));
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", tick);
      window.clearInterval(interval);
    };
  }, [markActive, hideWarning, signOut, navigate]);

  const showing = secondsLeft !== null;

  useEffect(() => {
    if (showing) buttonRef.current?.focus();
  }, [showing]);

  const staySignedIn = () => {
    hideWarning();
    markActive();

    // Refreshes the Cognito tokens if they are close to expiring
    const currentUser = userPool.getCurrentUser();
    if (currentUser) currentUser.getSession(() => {});
  };

  if (!showing) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#063F31]/60 px-4 backdrop-blur-sm">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="idle-title"
        aria-describedby="idle-description"
        className="w-full max-w-sm rounded-2xl border border-[#CFE3D8] bg-white p-6 text-center shadow-2xl"
      >
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#FF9F1C] text-[#3A1D00]">
          <LogOut size={22} aria-hidden="true" />
        </span>

        <h2 id="idle-title" className="mt-4 text-lg font-semibold text-[#0A6B52]">
          Are you still there?
        </h2>

        <p id="idle-description" className="mt-2 text-sm leading-6 text-slate-600">
          You will be signed out in{" "}
          <span className="font-semibold tabular-nums text-[#0C1F19]">
            {formatCountdown(secondsLeft)}
          </span>{" "}
          because there has been no activity.
        </p>

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={signOut}
            className="flex-1 rounded-lg border border-[#CFE3D8] bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-[#EDF5F0] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FF9F1C]"
          >
            Sign out now
          </button>

          <button
            ref={buttonRef}
            type="button"
            onClick={staySignedIn}
            className="flex-1 rounded-lg bg-gradient-to-br from-[#0A6B52] to-[#008060] px-4 py-2.5 text-sm font-semibold text-white transition hover:from-[#07523F] hover:to-[#0A6B52] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FF9F1C]"
          >
            Stay signed in
          </button>
        </div>
      </div>
    </div>
  );
}

export default IdleTimeout;
