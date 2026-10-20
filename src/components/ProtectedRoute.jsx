import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { userPool } from "../cognito";

function ProtectedRoute({ children, requireAdmin = false }) {
  const location = useLocation();

  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const checkSession = () => {
      const currentUser = userPool.getCurrentUser();

      // No Cognito user
      if (!currentUser) {
        if (isMounted) {
          setAuthenticated(false);
          setIsAdmin(false);
          setLoading(false);
        }
        return;
      }

      currentUser.getSession((error, session) => {
        if (!isMounted) return;

        // Invalid or expired session
        if (error || !session || !session.isValid()) {
          setAuthenticated(false);
          setIsAdmin(false);
          setLoading(false);
          return;
        }

        try {
          const idToken = session.getIdToken();
          const payload = idToken.decodePayload();

          const email = String(
            payload?.email || ""
          )
            .trim()
            .toLowerCase();

          // Cognito User Pool groups
          const groups = Array.isArray(
            payload?.["cognito:groups"]
          )
            ? payload["cognito:groups"]
            : [];

          const isCognitoAdmin = groups.some(
            (group) =>
              String(group).toLowerCase() ===
              "administrators"
          );

          /*
           * Keep the existing administrator account working
           * even before the Cognito administrators group is added.
           */
          const isLegacyAdmin =
            email === "admin@eachrights.or.ke";

          const administrator =
            isCognitoAdmin || isLegacyAdmin;

          setAuthenticated(true);
          setIsAdmin(administrator);
          setLoading(false);
        } catch (err) {
          console.error(
            "Unable to read Cognito session:",
            err
          );

          setAuthenticated(false);
          setIsAdmin(false);
          setLoading(false);
        }
      });
    };

    checkSession();

    return () => {
      isMounted = false;
    };
  }, []);

  // Prevent redirecting while Cognito is checking the session
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex flex-col items-center">
          <div className="w-8 h-8 border-4 border-slate-300 border-t-green-700 rounded-full animate-spin" />

          <p className="mt-4 text-sm text-slate-500">
            Checking your session...
          </p>
        </div>
      </div>
    );
  }

  // User is not authenticated
  if (!authenticated) {
    return (
      <Navigate
        to="/"
        replace
        state={{ from: location }}
      />
    );
  }

  // Administrator-only page
  if (requireAdmin && !isAdmin) {
    return (
      <Navigate
        to="/dashboard"
        replace
      />
    );
  }

  // Authorized
  return children;
}

export default ProtectedRoute;