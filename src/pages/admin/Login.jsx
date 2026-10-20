import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  AuthenticationDetails,
  CognitoUser,
} from "amazon-cognito-identity-js";
import {
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  ShieldCheck,
  ArrowRight,
  Loader2,
  CheckCircle2,
  Clock,
} from "lucide-react";
import { userPool } from "../../cognito";

const INPUT_CLASS =
  "w-full rounded-xl border border-[#D0D9D5] bg-white py-3 pl-10 text-sm text-[#0B2B24] outline-none transition placeholder:text-[#98A2B3] focus:border-[#008060] focus:ring-4 focus:ring-[#008060]/15 disabled:bg-[#F3F6F5]";

const PRIMARY_BUTTON_CLASS =
  "flex w-full items-center justify-center gap-2 rounded-xl bg-[#008060] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#006B52] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#008060] disabled:opacity-70";

const ICON_BUTTON_CLASS =
  "absolute right-2.5 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-[#98A2B3] transition hover:text-[#008060] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#008060]";

const BRAND_FONT = { fontFamily: '"Fraunces", Georgia, serif' };

function Login() {
  const location = useLocation();

  /*
   * The idle sign-out component redirects here with
   * state: { reason: "idle" }. It is read once, before the effect below
   * resets the history state.
   */
  const [signedOutForIdle] = useState(
    () => location.state?.reason === "idle"
  );

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // IMPORTANT: Do not remember credentials by default
  const [rememberMe, setRememberMe] = useState(false);

  const [loading, setLoading] = useState(false);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [requiresNewPassword, setRequiresNewPassword] =
    useState(false);

  const [cognitoUser, setCognitoUser] = useState(null);

  /*
   * Always start the login page completely fresh.
   *
   * This clears any old temporary login data that may have
   * remained in the browser session.
   */
  useEffect(() => {
    setEmail("");
    setPassword("");
    setNewPassword("");
    setConfirmPassword("");

    setShowPassword(false);
    setShowNewPassword(false);
    setShowConfirmPassword(false);

    setError("");
    setSuccess("");

    setLoading(false);
    setRequiresNewPassword(false);
    setCognitoUser(null);

    // Remove old stored login credentials from previous versions.
    sessionStorage.removeItem("eachrights_login_email");
    sessionStorage.removeItem("eachrights_login_password");

    // Also remove any accidentally saved credential fields.
    localStorage.removeItem("eachrights_login_email");
    localStorage.removeItem("eachrights_login_password");

    // Prevent browser from restoring old form data when possible.
    if (window.history && window.history.replaceState) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  /*
   * Save authenticated Cognito session.
   *
   * IMPORTANT:
   * We do NOT save the email/password form values.
   * Only Cognito tokens are stored.
   */
  const saveSession = (result) => {
    const idToken = result.getIdToken().getJwtToken();
    const accessToken = result.getAccessToken().getJwtToken();

    let refreshToken = "";

    if (result.getRefreshToken()) {
      refreshToken = result.getRefreshToken().getToken();
    }

    const session = {
      idToken,
      accessToken,
      refreshToken,
      email: email.trim(),
    };

    /*
     * Clear old authentication storage first.
     * This prevents duplicate/stale sessions.
     */
    localStorage.removeItem("eachrights_auth");
    sessionStorage.removeItem("eachrights_auth");

    /*
     * Only store the authenticated session.
     *
     * The actual password is NEVER stored.
     */
    if (rememberMe) {
      localStorage.setItem("eachrights_auth", JSON.stringify(session));
    } else {
      sessionStorage.setItem("eachrights_auth", JSON.stringify(session));
    }

    // Clear the React form values before leaving the page.
    setEmail("");
    setPassword("");
    setNewPassword("");
    setConfirmPassword("");

    window.location.replace("/dashboard");
  };

  const handleLogin = (event) => {
    event.preventDefault();

    setError("");
    setSuccess("");

    if (!email.trim()) {
      setError("Please enter your email address.");
      return;
    }

    if (!password) {
      setError("Please enter your password.");
      return;
    }

    setLoading(true);

    const cleanEmail = email.trim();

    const authenticationDetails = new AuthenticationDetails({
      Username: cleanEmail,
      Password: password,
    });

    const user = new CognitoUser({
      Username: cleanEmail,
      Pool: userPool,
    });

    user.authenticateUser(authenticationDetails, {
      onSuccess: (result) => {
        saveSession(result);
      },

      onFailure: (err) => {
        console.error("Cognito login error:", err);

        setLoading(false);

        if (
          err.code === "NotAuthorizedException" ||
          err.code === "UserNotFoundException"
        ) {
          setError("Incorrect email or password.");
        } else if (err.code === "UserNotConfirmedException") {
          setError(
            "Your account has not been confirmed. Please contact the administrator."
          );
        } else if (err.code === "PasswordResetRequiredException") {
          setError(
            "A password reset is required. Please contact the administrator."
          );
        } else {
          setError(err.message || "Unable to sign in. Please try again.");
        }
      },

      newPasswordRequired: () => {
        setLoading(false);
        setCognitoUser(user);
        setRequiresNewPassword(true);
        setError("");
      },
    });
  };

  const handleNewPassword = (event) => {
    event.preventDefault();

    setError("");
    setSuccess("");

    if (!newPassword) {
      setError("Please enter a new password.");
      return;
    }

    if (newPassword.length < 8) {
      setError("Your password must contain at least 8 characters.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }

    setLoading(true);

    cognitoUser.completeNewPasswordChallenge(
      newPassword,
      {},
      {
        onSuccess: (result) => {
          const idToken = result.getIdToken().getJwtToken();
          const accessToken = result.getAccessToken().getJwtToken();

          let refreshToken = "";

          if (result.getRefreshToken()) {
            refreshToken = result.getRefreshToken().getToken();
          }

          const session = {
            idToken,
            accessToken,
            refreshToken,
            email: email.trim(),
          };

          /*
           * Clear old sessions before creating the new one.
           */
          localStorage.removeItem("eachrights_auth");
          sessionStorage.removeItem("eachrights_auth");

          if (rememberMe) {
            localStorage.setItem("eachrights_auth", JSON.stringify(session));
          } else {
            sessionStorage.setItem("eachrights_auth", JSON.stringify(session));
          }

          /*
           * Clear all password fields before redirect.
           */
          setEmail("");
          setPassword("");
          setNewPassword("");
          setConfirmPassword("");

          window.location.replace("/dashboard");
        },

        onFailure: (err) => {
          console.error("Password change error:", err);

          setLoading(false);

          setError(
            err.message ||
              "Unable to change your password. Please try again."
          );
        },
      }
    );
  };

  return (
    <main className="min-h-screen w-full bg-white">
      <section className="flex min-h-screen w-full flex-col lg:flex-row">
        {/* LEFT PANEL */}
        <div className="relative flex w-full flex-shrink-0 flex-col justify-between overflow-hidden border-b border-[#E1EDE7] bg-[#EEF7F3] px-7 py-6 sm:px-10 lg:min-h-screen lg:w-1/2 lg:border-b-0 lg:border-r lg:px-12 lg:py-10 xl:px-16">
          <div>
            {/* Logo */}
            <div className="flex items-center gap-3">
              <div
                className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#008060] text-2xl font-semibold text-white"
                style={BRAND_FONT}
              >
                E
              </div>

              <span
                className="text-xl font-semibold text-[#0B2B24]"
                style={BRAND_FONT}
              >
                EACHRights
              </span>
            </div>

            {/* Brand */}
            <div className="mt-8 lg:mt-[12vh]">
              <h1
                className="text-4xl font-semibold tracking-tight text-[#0B2B24] sm:text-5xl xl:text-6xl"
                style={BRAND_FONT}
              >
                Staff portal
              </h1>

              <p className="mt-5 max-w-lg text-base leading-7 text-[#344054] xl:text-lg xl:leading-8">
                Advancing Rights. Strengthening Systems.
                Transforming Lives.
              </p>

              <p className="mt-3 max-w-md text-sm leading-6 text-[#667085]">
                Secure access to EACHRights internal resources,
                documents and staff services.
              </p>
            </div>

          </div>

          {/* Security */}
          <div className="hidden items-center gap-3 border-t border-[#D5EBE2] pt-4 text-xs text-[#475467] lg:flex">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#008060] text-white">
              <ShieldCheck size={16} />
            </div>

            <span>Secure staff access</span>
          </div>
        </div>

        {/* RIGHT PANEL */}
        <div className="flex w-full flex-1 items-center justify-center bg-white px-6 py-8 sm:px-10 lg:min-h-screen lg:w-1/2 lg:px-12 xl:px-16">
          <div className="w-full max-w-md">
            {!requiresNewPassword ? (
              <>
                {/* LOGIN HEADING */}
                <div className="mb-6">
                  <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-[#E3F3EC] text-[#00664E]">
                    <LockKeyhole size={20} />
                  </div>

                  <h2
                    className="text-2xl font-semibold tracking-tight text-[#0B2B24] xl:text-3xl"
                    style={BRAND_FONT}
                  >
                    Welcome back
                  </h2>

                  <p className="mt-1 text-sm text-[#667085]">
                    Sign in to access the EACHRights Staff Portal.
                  </p>
                </div>

                {/* IDLE SIGN-OUT NOTICE */}
                {signedOutForIdle && (
                  <div
                    role="status"
                    className="mb-4 flex items-start gap-2.5 rounded-xl border border-[#FFD08A] bg-[#FFF4E0] px-3 py-2.5 text-xs leading-5 text-[#7A4A00]"
                  >
                    <Clock size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                    <p>
                      You were signed out because there was no activity.
                      Please sign in again to continue.
                    </p>
                  </div>
                )}

                {/* LOGIN FORM */}
                <form
                  onSubmit={handleLogin}
                  autoComplete="off"
                  className="space-y-4"
                >
                  {/* Email */}
                  <div>
                    <label
                      htmlFor="email"
                      className="mb-1.5 block text-xs font-semibold text-[#344054]"
                    >
                      Email address
                    </label>

                    <div className="relative">
                      <Mail
                        size={17}
                        className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#98A2B3]"
                      />

                      <input
                        id="email"
                        name="login-email"
                        type="email"
                        placeholder="name@eachrights.or.ke"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="none"
                        spellCheck="false"
                        disabled={loading}
                        className={`${INPUT_CLASS} pr-3`}
                      />
                    </div>
                  </div>

                  {/* Password */}
                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <label
                        htmlFor="password"
                        className="text-xs font-semibold text-[#344054]"
                      >
                        Password
                      </label>

                      <button
                        type="button"
                        onClick={() =>
                          setError(
                            "Please contact the EACHRights administrator to reset your password."
                          )
                        }
                        className="rounded text-xs font-semibold text-[#008060] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#008060]"
                      >
                        Forgot password?
                      </button>
                    </div>

                    <div className="relative">
                      <LockKeyhole
                        size={17}
                        className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#98A2B3]"
                      />

                      <input
                        id="password"
                        name="login-password"
                        type={showPassword ? "text" : "password"}
                        placeholder="Enter your password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        autoComplete="new-password"
                        disabled={loading}
                        className={`${INPUT_CLASS} pr-11`}
                      />

                      <button
                        type="button"
                        onClick={() => setShowPassword((current) => !current)}
                        aria-label={showPassword ? "Hide password" : "Show password"}
                        className={ICON_BUTTON_CLASS}
                      >
                        {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                      </button>
                    </div>
                  </div>

                  {/* Error */}
                  {error && (
                    <div
                      role="alert"
                      className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
                    >
                      {error}
                    </div>
                  )}

                  {/* Remember */}
                  <label className="flex items-center gap-2 text-xs text-[#475467]">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(event) => setRememberMe(event.target.checked)}
                      className="h-3.5 w-3.5 accent-[#008060]"
                    />

                    Remember me
                  </label>

                  {/* Button */}
                  <button
                    type="submit"
                    disabled={loading}
                    className={PRIMARY_BUTTON_CLASS}
                  >
                    {loading ? (
                      <>
                        <Loader2 size={17} className="animate-spin motion-reduce:animate-none" />
                        Signing in...
                      </>
                    ) : (
                      <>
                        Sign in
                        <ArrowRight size={17} />
                      </>
                    )}
                  </button>
                </form>
              </>
            ) : (
              <>
                {/* NEW PASSWORD */}
                <div className="mb-6">
                  <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-[#E3F3EC] text-[#00664E]">
                    <LockKeyhole size={20} />
                  </div>

                  <h2
                    className="text-2xl font-semibold tracking-tight text-[#0B2B24] xl:text-3xl"
                    style={BRAND_FONT}
                  >
                    Set your password
                  </h2>

                  <p className="mt-2 text-sm leading-6 text-[#667085]">
                    This is your first sign-in. Please create a
                    new password to continue.
                  </p>
                </div>

                <form
                  onSubmit={handleNewPassword}
                  autoComplete="off"
                  className="space-y-4"
                >
                  {/* New password */}
                  <div>
                    <label
                      htmlFor="new-password"
                      className="mb-1.5 block text-xs font-semibold text-[#344054]"
                    >
                      New password
                    </label>

                    <div className="relative">
                      <LockKeyhole
                        size={17}
                        className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#98A2B3]"
                      />

                      <input
                        id="new-password"
                        type={showNewPassword ? "text" : "password"}
                        placeholder="Create a new password"
                        value={newPassword}
                        onChange={(event) => setNewPassword(event.target.value)}
                        autoComplete="new-password"
                        disabled={loading}
                        className={`${INPUT_CLASS} pr-11`}
                      />

                      <button
                        type="button"
                        onClick={() => setShowNewPassword((current) => !current)}
                        aria-label={showNewPassword ? "Hide password" : "Show password"}
                        className={ICON_BUTTON_CLASS}
                      >
                        {showNewPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                      </button>
                    </div>

                    <p className="mt-1.5 text-[11px] text-[#667085]">
                      Minimum 8 characters.
                    </p>
                  </div>

                  {/* Confirm */}
                  <div>
                    <label
                      htmlFor="confirm-password"
                      className="mb-1.5 block text-xs font-semibold text-[#344054]"
                    >
                      Confirm new password
                    </label>

                    <div className="relative">
                      <LockKeyhole
                        size={17}
                        className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#98A2B3]"
                      />

                      <input
                        id="confirm-password"
                        type={showConfirmPassword ? "text" : "password"}
                        placeholder="Confirm your password"
                        value={confirmPassword}
                        onChange={(event) => setConfirmPassword(event.target.value)}
                        autoComplete="new-password"
                        disabled={loading}
                        className={`${INPUT_CLASS} pr-11`}
                      />

                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword((current) => !current)}
                        aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                        className={ICON_BUTTON_CLASS}
                      >
                        {showConfirmPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                      </button>
                    </div>
                  </div>

                  {/* Error */}
                  {error && (
                    <div
                      role="alert"
                      className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700"
                    >
                      {error}
                    </div>
                  )}

                  {/* Success */}
                  {success && (
                    <div
                      role="status"
                      className="flex items-center gap-2 rounded-xl border border-[#B7E3CF] bg-[#E3F4EC] px-3 py-2 text-xs text-[#00664E]"
                    >
                      <CheckCircle2 size={16} />
                      {success}
                    </div>
                  )}

                  {/* Button */}
                  <button
                    type="submit"
                    disabled={loading}
                    className={PRIMARY_BUTTON_CLASS}
                  >
                    {loading ? (
                      <>
                        <Loader2 size={17} className="animate-spin motion-reduce:animate-none" />
                        Updating password...
                      </>
                    ) : (
                      <>
                        Set password
                        <ArrowRight size={17} />
                      </>
                    )}
                  </button>
                </form>
              </>
            )}

            {/* Security notice */}
            <div className="mt-6 flex gap-3 rounded-xl bg-[#F3F7F5] p-3.5">
              <div className="flex-shrink-0 text-[#008060]">
                <ShieldCheck size={17} />
              </div>

              <div>
                <p className="text-xs font-semibold text-[#0B2B24]">
                  Secure access
                </p>

                <p className="mt-0.5 text-[11px] leading-4 text-[#667085]">
                  This portal is restricted to authorized
                  EACHRights staff. Your account activity may
                  be monitored for security purposes.
                </p>
              </div>
            </div>

            {/* Footer */}
            <div className="mt-6 flex items-center justify-between border-t border-[#E6ECE9] pt-3 text-[11px] text-[#667085]">
              <span>© {new Date().getFullYear()} EACHRights</span>

              <span>Staff Portal</span>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

export default Login;
