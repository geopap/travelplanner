// Client-side validation helpers. Server enforces the authoritative Zod schemas.

export interface PasswordStrength {
  ok: boolean;
  reasons: string[];
}

export function validatePassword(password: string): PasswordStrength {
  const reasons: string[] = [];
  if (password.length < 12) reasons.push("At least 12 characters");
  if (!/[a-z]/.test(password)) reasons.push("One lowercase letter");
  if (!/[A-Z]/.test(password)) reasons.push("One uppercase letter");
  if (!/\d/.test(password)) reasons.push("One digit");
  return { ok: reasons.length === 0, reasons };
}

export function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

export function isSafeRedirectPath(value: string | null | undefined): value is string {
  if (!value) return false;
  // Only allow same-origin absolute paths. Reject protocol-relative and scheme URLs.
  return value.startsWith("/") && !value.startsWith("//");
}

export function validateTripDates(
  startDate: string,
  endDate: string,
): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return "Start date is required";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return "End date is required";
  const start = Date.parse(startDate + "T00:00:00Z");
  const end = Date.parse(endDate + "T00:00:00Z");
  if (Number.isNaN(start) || Number.isNaN(end)) return "Invalid dates";
  if (end < start) return "End date must be on or after the start date";
  const days = Math.round((end - start) / (24 * 60 * 60 * 1000)) + 1;
  if (days > 365) return "Trip length is capped at 365 days";
  return null;
}
