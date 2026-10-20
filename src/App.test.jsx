import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import App from "./App";

// Replace real pages with lightweight stubs so these tests only cover routing.
vi.mock("./pages/admin/Login", () => ({
  default: () => <div data-testid="login-page">Login</div>,
}));
vi.mock("./pages/Dashboard", () => ({
  default: () => <div data-testid="dashboard-page">Dashboard</div>,
}));
vi.mock("./pages/admin/AdminDashboard", () => ({
  default: () => <div data-testid="admin-page">Admin Dashboard</div>,
}));

// Auth behavior is tested separately; here the guard just renders its child.
const ADMIN_SUBPAGES = [
  { path: "/admin/users", file: "StaffUsers" },
  { path: "/admin/shared-files", file: "SharedFiles" },
  { path: "/admin/programs", file: "Programs" },
  { path: "/admin/finance", file: "Finance" },
  { path: "/admin/upload", file: "FileUpload" },
  { path: "/admin/settings", file: "Settings" },
];

vi.mock("./pages/admin/StaffUsers", () => ({
  default: () => <div data-testid="admin-subpage">StaffUsers</div>,
}));
vi.mock("./pages/admin/SharedFiles", () => ({
  default: () => <div data-testid="admin-subpage">SharedFiles</div>,
}));
vi.mock("./pages/admin/Programs", () => ({
  default: () => <div data-testid="admin-subpage">Programs</div>,
}));
vi.mock("./pages/admin/Finance", () => ({
  default: () => <div data-testid="admin-subpage">Finance</div>,
}));
vi.mock("./pages/admin/FileUpload", () => ({
  default: () => <div data-testid="admin-subpage">FileUpload</div>,
}));
vi.mock("./pages/admin/Settings", () => ({
  default: () => <div data-testid="admin-subpage">Settings</div>,
}));

vi.mock("./components/ProtectedRoute", () => ({
  default: ({ children }) => children,
}));

// App owns its BrowserRouter, so we set the URL before rendering.
const renderAt = (path) => {
  window.history.pushState({}, "", path);
  return render(<App />);
};

describe("App routing", () => {
  beforeEach(() => {
    window.history.pushState({}, "", "/");
  });

  afterEach(() => {
    cleanup();
  });

  describe("happy path", () => {
    it("renders Login at /", () => {
      renderAt("/");
      expect(screen.getByTestId("login-page")).toBeInTheDocument();
    });

    it("renders the staff Dashboard at /dashboard", () => {
      renderAt("/dashboard");
      expect(screen.getByTestId("dashboard-page")).toBeInTheDocument();
      expect(screen.queryByTestId("login-page")).not.toBeInTheDocument();
    });

    it("renders AdminDashboard at /admin", () => {
      renderAt("/admin");
      expect(screen.getByTestId("admin-page")).toBeInTheDocument();
      expect(screen.queryByTestId("dashboard-page")).not.toBeInTheDocument();
    });

    it("renders only one page at a time", () => {
      renderAt("/dashboard");
      expect(screen.getAllByTestId(/-page$/)).toHaveLength(1);
    });
  });

  describe("admin sub-pages", () => {
    it.each(ADMIN_SUBPAGES)("renders $file at $path", ({ path, file }) => {
      renderAt(path);
      expect(screen.getByTestId("admin-subpage")).toHaveTextContent(file);
      // the dashboard index must not render alongside a sub-page
      expect(screen.queryByTestId("admin-page")).not.toBeInTheDocument();
    });

    it("still renders the AdminDashboard index at /admin/", () => {
      renderAt("/admin/");
      expect(screen.getByTestId("admin-page")).toBeInTheDocument();
    });
  });

  describe("unknown URLs", () => {
    it("redirects an unknown path to Login", () => {
      renderAt("/does-not-exist");
      expect(screen.getByTestId("login-page")).toBeInTheDocument();
      expect(window.location.pathname).toBe("/");
    });

    it("redirects deeply nested unknown paths", () => {
      renderAt("/a/b/c/d");
      expect(screen.getByTestId("login-page")).toBeInTheDocument();
      expect(window.location.pathname).toBe("/");
    });

    it("redirects undeclared child paths of /admin", () => {
      renderAt("/admin/not-a-real-section");
      expect(screen.getByTestId("login-page")).toBeInTheDocument();
      expect(screen.queryByTestId("admin-page")).not.toBeInTheDocument();
      expect(window.location.pathname).toBe("/");
    });

    it("redirects child paths of /dashboard, since none are declared", () => {
      renderAt("/dashboard/files");
      expect(screen.getByTestId("login-page")).toBeInTheDocument();
      expect(window.location.pathname).toBe("/");
    });

    it("redirects when a query string accompanies an unknown path", () => {
      renderAt("/nope?redirect=/admin");
      expect(screen.getByTestId("login-page")).toBeInTheDocument();
      expect(window.location.pathname).toBe("/");
    });

    it("uses replace, so the bad URL is not added as an extra history entry", () => {
      const before = window.history.length;
      renderAt("/does-not-exist"); // pushState adds 1, redirect should replace it
      expect(window.history.length).toBe(before + 1);
      expect(window.location.pathname).toBe("/");
    });
  });

  describe("URL matching edge cases", () => {
    it("matches /dashboard with a trailing slash", () => {
      renderAt("/dashboard/");
      expect(screen.getByTestId("dashboard-page")).toBeInTheDocument();
    });

    it("matches routes case-insensitively (React Router v6 default)", () => {
      renderAt("/ADMIN");
      expect(screen.getByTestId("admin-page")).toBeInTheDocument();
    });

    it("ignores query strings and hashes on valid routes", () => {
      renderAt("/dashboard?tab=files#recent");
      expect(screen.getByTestId("dashboard-page")).toBeInTheDocument();
    });
  });
});
