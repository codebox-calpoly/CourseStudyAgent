/** Check a single email address against the exact Cal Poly domain. */
export function isCalPolyEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  const separator = normalized.lastIndexOf("@");

  return (
    separator > 0 &&
    normalized.indexOf("@") === separator &&
    !/\s/.test(normalized) &&
    normalized.slice(separator + 1) === "calpoly.edu"
  );
}
