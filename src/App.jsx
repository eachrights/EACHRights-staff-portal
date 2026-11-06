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

// Landing page after sign-in (M&E dashboard or files)
import Home from "./pages/Home";

// Admin pages
import AdminDashboard from "./pages/admin/AdminDashboard";
import StaffUsers from "./pages/admin/StaffUsers";
import SharedFiles from "./pages/admin/SharedFiles";
import Programs from "./pages/admin/Programs";
import AdminUpload from "./pages/admin/AdminUpload";
import Settings from "./pages/admin/Settings";

// Monitoring and evaluation
import MEDashboard from "./pages/admin/MEDashboard";
// Projects: the list (current to previous) and the dashboard of the project you open
import MEProjects from "./pages/admin/me-dashboard/ProjectsPage";
import MEFrameworks from "./pages/admin/me-dashboard/Frameworks";
import ImportFramework from "./pages/admin/me-dashboard/ImportFramework";
import MEIndicators from "./pages/admin/me-dashboard/Indicators";
import MELibrary from "./pages/admin/me-dashboard/Library";
import MEForms from "./pages/admin/me-dashboard/Forms";
import FormLibrary from "./pages/admin/me-dashboard/FormLibrary";
import MEData from "./pages/admin/me-dashboard/Data";
import DataTables from "./pages/admin/me-dashboard/DataTables";
import MEInsights from "./pages/admin/me-dashboard/Insights";
import MEReports from "./pages/admin/me-dashboard/Reports";
import MEPredictions from "./pages/admin/me-dashboard/Predictions";
import MEGuides from "./pages/admin/me-dashboard/Guides";
// Workplan and calendar
import MEWorkPlan from "./pages/admin/me-dashboard/WorkPlan";
import MECalendar from "./pages/admin/me-dashboard/MECalendar";
import AuditLog from "./pages/admin/me-dashboard/AuditTrail";
// Attendance (fingerprint clock in and out, and leave)
import Attendance from "./pages/attendance/Attendance";
// Travel and field requests
import Travel from "./pages/travel/Travel";
// Financial requisitions (fund requests raised against a project)
// Adjust this path if MyRequisitions.jsx is saved in a different folder.
import MyRequisitions from "./pages/admin/me-dashboard/MyRequisitions";
// Finance: transactions, approvals, budget (Finance.jsx and financeApi.js both live in src/pages/services)
import Finance from "./pages/services/Finance";
// Approvals and the portfolio roll-up (administrator only)
import PortfolioView from "./pages/admin/me-dashboard/PortfolioView";

// Route protection
import ProtectedRoute from "./components/ProtectedRoute";

// Page layout (sidebar and header)
import PageShell from "./components/PageShell";

// Signs users out after a period of inactivity
import IdleTimeout from "./components/IdleTimeout";

//attendance clockpage
import ClockPage from "./pages/attendance/ClockPage";

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
            SHARED SHELL (sidebar and header)
            Home, Attendance, Travel, Requisitions, Finance and M&E sit under
            ONE layout route, so the sidebar stays mounted while moving
            between them. Pages inside it must NOT render their own
            Header or Sidebar.
            Add new staff pages inside this route.
        ====================================================== */}
        <Route
          element={
            <ProtectedRoute>
              <PageShell>{() => <Outlet />}</PageShell>
            </ProtectedRoute>
          }
        >
          {/* HOME (first page after sign-in): start in the M&E dashboard or in the files */}
          <Route path="/home" element={<Home />} />

          {/* ATTENDANCE: fingerprint clock in and out, and leave. Administrators also get a Team tab. */}
          <Route path="/attendance" element={<Attendance />} />

          {/* TRAVEL AND FIELD REQUESTS: staff request trips; administrators and the CEO approve them. */}
          <Route path="/travel" element={<Travel />} />

          {/* FINANCIAL REQUISITIONS: staff raise fund requests against a project.
              The API decides who can raise, approve and mark requests as paid. */}
          <Route path="/requisitions" element={<MyRequisitions />} />

          {/* FINANCE: income and expense transactions linked to projects, with
              receipts, approval and budgets. The finance Lambda decides who can
              submit (finance_staff) and approve (finance_approver). */}
          <Route path="/finance" element={<Finance />} />

          {/* =====================================================
              M&E (staff and administrator)
              Any signed-in user can open these. What they can see and
              report on is limited by the results Lambda, using their
              department groups. Sidebar links must match these paths exactly.
          ====================================================== */}
          <Route path="/me-dashboard" element={<Outlet />}>
            <Route index element={<MEDashboard />} />

            {/* Projects: the list, and a project's dashboard (opened with ?project=<id>) */}
            <Route path="projects" element={<MEProjects />} />

            <Route path="frameworks" element={<MEFrameworks />} />

            {/* Import a framework (or all the details of a project) from a file.
                The API decides who can import where, so this page is open to any signed-in user. */}
            <Route path="import-framework" element={<ImportFramework />} />

            {/* Indicators */}
            <Route path="indicators" element={<MEIndicators />} />

            <Route path="library" element={<MELibrary />} />

            {/* Forms: fill in a reporting period, and the library to build,
                copy, template and share forms */}
            <Route path="forms" element={<MEForms />} />
            <Route path="form-library" element={<FormLibrary />} />

            {/* Data: indicator data, and tables for importing and linking data */}
            <Route path="data" element={<MEData />} />
            <Route path="data-tables" element={<DataTables />} />

            {/* Workplan and calendar: activities with owners and dates, and a
                calendar that shows them alongside meetings, trainings and deadlines */}
            <Route path="workplan" element={<MEWorkPlan />} />
            <Route path="calendar" element={<MECalendar />} />

            {/* Audit trail (administrator only, the API enforces it too) */}
            <Route
              path="audit"
              element={
                <ProtectedRoute requireAdmin>
                  <AuditLog />
                </ProtectedRoute>
              }
            />

            {/* Approvals and portfolio (administrator only, the API enforces it too) */}
            <Route
              path="portfolio"
              element={
                <ProtectedRoute requireAdmin>
                  <PortfolioView />
                </ProtectedRoute>
              }
            />

            <Route path="insights" element={<MEInsights />} />
            <Route path="reports" element={<MEReports />} />
            <Route path="predictions" element={<MEPredictions />} />
            <Route path="guides" element={<MEGuides />} />

            {/* Unknown M&E URLs go back to the M&E dashboard */}
            <Route path="*" element={<Navigate to="/me-dashboard" replace />} />
          </Route>
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
        /*clockpage*/
        <Route path="/clock" element={<ClockPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
