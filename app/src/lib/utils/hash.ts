import 'server-only';
import { createHash } from 'node:crypto';

/**
 * One-way SHA-256 hash of a normalized email for audit logs.
 *
 * Email is lowercased and trimmed before hashing so identical addresses
 * yield identical hashes regardless of casing/whitespace. The raw email is
 * never written to logs or audit metadata — only this hex digest is.
 */
export function hashEmail(email: string): string {
  return createHash('sha256')
    .update(email.trim().toLowerCase(), 'utf8')
    .digest('hex');
}
