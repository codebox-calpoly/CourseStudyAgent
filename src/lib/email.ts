/** Require a nonempty local part without whitespace or @, and the exact domain. */
export function isCalPolyEmail(email: string): boolean {
  return /^[^\s@]+@calpoly\.edu$/i.test(email.trim());
}
