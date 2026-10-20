import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import Header from "./Header";
import Sidebar from "./Sidebar";
import { userPool } from "../cognito";
import { getCognitoSession } from "./api";
import { accessFromPayload } from "../access";

/*
 * The page frame used by the newer pages: sidebar, header, sign-in check
 * and footer. Children is a function that receives { email, access }.
 *
 *   <PageShell adminOnly>{({ email, access }) => <MyPage />}</PageShell>
 *
 * adminOnly sends everyone who isn't an administrator to /dashboard.
 */
function PageShell({ adminOnly = false, children }) {
  const navigate = useNavigate();

  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [state, setState] = useState({ ready: false, email: "", access: null });

  useEffect(() => {
    let isMounted = true;

    getCognitoSession()
      .then((session) => {
        if (!isMounted) return;

        const payload = session.getIdToken().decodePayload();
        const access = accessFromPayload(payload);

        if (adminOnly && !access.isAdmin) {
          navigate("/dashboard", { replace: true });
          return;
        }

        setState({ ready: true, email: access.email, access });
      })
      .catch(() => {
        if (isMounted) navigate("/", { replace: true });
      });

    return () => {
      isMounted = false;
    };
  }, [adminOnly, navigate]);

  const handleLogout = () => {
    const currentUser = userPool.getCurrentUser();

    if (currentUser) currentUser.signOut();

    navigate("/", { replace: true });
  };

  if (!state.ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F1F5F2]">
        <div className="text-center">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-[#D9E3DC] border-t-[#0A6B52]" />
          <p className="mt-4 text-sm font-medium text-slate-600">Checking access...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F1F5F2] text-[#14201A]">
      <div className="flex min-h-screen">
        <Sidebar
          mobileOpen={mobileSidebarOpen}
          onClose={() => setMobileSidebarOpen(false)}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <Header
            email={state.email}
            onMenuClick={() => setMobileSidebarOpen(true)}
            onLogout={handleLogout}
          />

          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
            {children({ email: state.email, access: state.access })}
          </main>

          <footer className="border-t border-[#D9E3DC] bg-white px-5 py-5 text-center sm:px-8">
            <p className="text-xs text-slate-500">
              EACHRights Staff Portal • Secure Internal Platform
            </p>
          </footer>
        </div>
      </div>
    </div>
  );
}

export default PageShell;
