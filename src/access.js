import { userPool } from "./cognito";

/*
 * Departments and access
 *
 * A department is a Cognito group named "dept-<slug>", for example
 * "dept-education-justice". A person can be in several groups.
 * The administrator (group "administrator" or the admin email) sees everything.
 *
 * The server (Lambda) is what really enforces this. These helpers only decide
 * what the interface shows.
 */

export const ADMIN_EMAIL = "admin@eachrights.or.ke";
const ADMIN_GROUPS = ["administrator", "administrators"];

// Programmes live under programs/<slug>/ in storage
export const PROGRAM_AREAS = [
  { slug: "education-justice", name: "Education Justice" },
  { slug: "gender-justice", name: "Gender Justice" },
  { slug: "health-justice", name: "Health Justice" },
  { slug: "environment-climate-change", name: "Environment & Climate Change" },
  { slug: "economic-justice", name: "Economic Justice" },
];

// Departments live under departments/<slug>/ in storage.
// The Executive Director is the CEO: the group "dept-CEO" gives read-only
// access to every department, including this one.
export const DEPARTMENT_AREAS = [
  { slug: "communication", name: "Communication" },
  { slug: "it", name: "IT", restricted: true },
  { slug: "executive-director", name: "Executive Director", restricted: true },
];

export const DEPARTMENTS = [
  ...PROGRAM_AREAS.map((area) => ({
    ...area,
    href: `/admin/programs?area=${area.slug}`,
  })),
  ...DEPARTMENT_AREAS.map((area) => ({
    ...area,
    href: `/admin/programs?area=${area.slug}`,
  })),
  { slug: "finance", name: "Finance", href: "/admin/finance" },
];

export function accessFromPayload(payload) {
  const email = String(payload?.email || "").trim().toLowerCase();
  const raw = payload?.["cognito:groups"];
  const groups = (Array.isArray(raw) ? raw : []).map((g) => String(g).toLowerCase());

  const departments = new Set(
    groups.filter((g) => g.startsWith("dept-")).map((g) => g.slice(5))
  );

  // The existing "finance" group also counts as the finance department
  if (groups.includes("finance")) departments.add("finance");

  // The CEO group can read every department ("*" = all). Still read-only.
  if (groups.includes("dept-ceo")) departments.add("*");

  return {
    email,
    groups,
    departments,
    isAdmin: email === ADMIN_EMAIL || groups.some((g) => ADMIN_GROUPS.includes(g)),
  };
}

export const canSeeDepartment = (access, slug) =>
  access.isAdmin || access.departments.has("*") || access.departments.has(slug);

export function getAccess() {
  return new Promise((resolve, reject) => {
    const user = userPool.getCurrentUser();

    if (!user) {
      reject(new Error("No signed-in user."));
      return;
    }

    user.getSession((error, session) => {
      if (error || !session || !session.isValid()) {
        reject(new Error("Session expired."));
        return;
      }

      resolve(accessFromPayload(session.getIdToken().decodePayload()));
    });
  });
}
