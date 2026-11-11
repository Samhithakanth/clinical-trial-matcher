// Role-based access policy for pages and API routes.
// Imported by middleware (Edge runtime) and by client components, so it
// must stay free of Node.js and database imports.

export const ROLES = ["ADMIN", "CLINICIAN", "RESEARCHER", "COMPLIANCE"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Administrator",
  CLINICIAN: "Attending Clinician",
  RESEARCHER: "Clinical Researcher",
  COMPLIANCE: "Compliance Officer",
};

const ALL: Role[] = [...ROLES];

type Rule = { prefix: string; roles: Role[]; methods?: string[] };

// First matching rule wins, so more specific prefixes come first.
// Anything not listed requires a signed-in user of any role.
const RULES: Rule[] = [
  // Patient-identifiable data: clinicians only (researchers are denied the
  // patients table at database level too).
  { prefix: "/patients", roles: ["ADMIN", "CLINICIAN"] },
  { prefix: "/api/patients", roles: ["ADMIN", "CLINICIAN"] },
  { prefix: "/api/search/notes", roles: ["ADMIN", "CLINICIAN"] },
  { prefix: "/api/embeddings", roles: ["ADMIN", "CLINICIAN"] },
  { prefix: "/api/matches/semantic-score", roles: ["ADMIN", "CLINICIAN"] },

  // Audit trail: compliance review.
  { prefix: "/audit", roles: ["ADMIN", "COMPLIANCE"] },
  { prefix: "/api/audit", roles: ["ADMIN", "COMPLIANCE"] },

  // Account management and login activity.
  { prefix: "/api/admin", roles: ["ADMIN"] },
  { prefix: "/security", roles: ["ADMIN", "COMPLIANCE"] },
  { prefix: "/api/security", roles: ["ADMIN", "COMPLIANCE"] },

  // Trials, matches and dashboard: every role (matches hide patient age
  // from researchers, see src/app/api/matches/route.ts).
  { prefix: "/clinical-trials", roles: ALL },
  { prefix: "/api/clinical-trials", roles: ALL },
  { prefix: "/matches", roles: ALL },
  { prefix: "/api/matches", roles: ALL },
  { prefix: "/api/dashboard", roles: ALL },
];

/** Paths reachable without signing in. */
export const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/auth/logout"];

function matches(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(prefix + "/");
}

export function isPublicPath(path: string): boolean {
  return PUBLIC_PATHS.some((p) => matches(path, p));
}

export function canAccess(path: string, role: Role): boolean {
  const rule = RULES.find((r) => matches(path, r.prefix));
  return rule ? rule.roles.includes(role) : true;
}

export const NAV_LINKS: Array<{ href: string; label: string }> = [
  { href: "/", label: "Dashboard" },
  { href: "/patients", label: "Patients" },
  { href: "/clinical-trials", label: "Clinical Trials" },
  { href: "/matches", label: "Match Results" },
  { href: "/audit", label: "Audit Logs" },
  { href: "/security", label: "Access & Security" },
];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}
