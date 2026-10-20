import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  Outlet,
} from "react-router-dom";

// Authentication
import Login from "./pages/admin/Login";

// Staff
import Dashboard from "./pages/Dashboard";

// Admin pages
import AdminDashboard from "./pages/admin/AdminDashboard";
import StaffUsers from "./pages/admin/StaffUsers";
import SharedFiles from "./pages/admin/SharedFiles";
import Programs from "./pages/admin/Programs";
import Finance from "./pages/admin/Finance";
import AdminUpload from "./pages/admin/AdminUpload";
import Settings from "./pages/admin/Settings";

// Monitoring and evaluation
import MEDashboard from "./pages/admin/MEDashboard";
import MEFrameworks from "./pages/admin/me-dashboard/Frameworks";
import MEIndicators from "./pages/admin/me-dashboard/Indicators";
import MELibrary from "./pages/admin/me-dashboard/Library";
import MEForms from "./pages/admin/me-dashboard/Forms";
import MEData from "./pages/admin/me-dashboard/Data";
import MEInsights from "./pages/admin/me-dashboard/Insights";
import MEReports from "./pages/admin/me-dashboard/Reports";
import MEPredictions from "./pages/admin/me-dashboard/Predictions";
import MEGuides from "./pages/admin/me-dashboard/Guides";

// Route protection
import ProtectedRoute from "./components/ProtectedRoute";

// Page layout (sidebar and header)
import PageShell from "./components/PageShell";

// Signs users out after a period of inactivity
import IdleTimeout from "./components/IdleTimeout";

function App() {
  return (
    <BrowserRouter>
      {/* Mounted once so it covers every page. Does nothing while signed out. */}
      <IdleTimeout />

      <Routes>
        {/* =====================================================
            LOGIN
        ====================================================== */}
        <Route path="/" element={<Login />} />

        {/* =====================================================
            STAFF DASHBOARD
            Requires authenticated user
        ====================================================== */}
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />

        {/* =====================================================
            M&E (staff and administrator)
            Any signed-in user can open these. What they can see and
            report on is limited by the results Lambda, using their
            department groups. The shell is shared, so the sidebar
            stays mounted while moving between M&E pages.
            Sidebar links must match these paths exactly.
        ====================================================== */}
        <Route
          path="/me-dashboard"
          element={
            <ProtectedRoute>
              <PageShell>{() => <Outlet />}</PageShell>
            </ProtectedRoute>
          }
        >
          <Route index element={<MEDashboard />} />
          <Route path="frameworks" element={<MEFrameworks />} />
          <Route path="indicators" element={<MEIndicators />} />
          <Route path="library" element={<MELibrary />} />
          <Route path="forms" element={<MEForms />} />
          <Route path="data" element={<MEData />} />
          <Route path="insights" element={<MEInsights />} />
          <Route path="reports" element={<MEReports />} />
          <Route path="predictions" element={<MEPredictions />} />
          <Route path="guides" element={<MEGuides />} />

          {/* Unknown M&E URLs go back to the M&E dashboard */}
          <Route path="*" element={<Navigate to="/me-dashboard" replace />} />
        </Route>

        {/* =====================================================
            FILE PAGES (staff and administrator)
            Any signed-in user can open these. The Administration
            routes further down stay administrator-only.
            Sidebar links must match these paths exactly.
            Programs also accepts ?area=<slug> to open a
            thematic area directly.
        ====================================================== */}
        <Route
          path="/admin"
          element={
            <ProtectedRoute>
              <Outlet />
            </ProtectedRoute>
          }
        >
          {/* All files (also handles ?q= file search) */}
          <Route index element={<AdminDashboard />} />

          {/* Communication (formerly Shared Files) */}
          <Route path="communication" element={<SharedFiles />} />

          {/* Old URLs kept so existing bookmarks still work */}
          <Route
            path="shared-files"
            element={<Navigate to="/admin/communication" replace />}
          />
          <Route
            path="shared"
            element={<Navigate to="/admin/communication" replace />}
          />

          {/* Programs */}
          <Route path="programs" element={<Programs />} />

          {/* Finance */}
          <Route path="finance" element={<Finance />} />

          {/* =====================================================
              ADMINISTRATION
              Administrator access only (the sidebar section
              under "Administration").
          ====================================================== */}
          <Route
            element={
              <ProtectedRoute requireAdmin>
                <Outlet />
              </ProtectedRoute>
            }
          >
            {/* Staff Users */}
            <Route path="users" element={<StaffUsers />} />

            {/* File Upload (uploads straight to S3 via pre-signed URLs) */}
            <Route path="upload" element={<AdminUpload />} />

            {/* Settings */}
            <Route path="settings" element={<Settings />} />
          </Route>

          {/* Unknown admin URLs go back to the admin dashboard
              instead of being sent to the login page */}
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Route>

        {/* =====================================================
            UNKNOWN URLS
            Send users back to login
        ====================================================== */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
