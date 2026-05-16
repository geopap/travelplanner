/**
 * B-031 / B-038 — DRY drift guard for the canonical "paired" OR predicate.
 *
 * The OR predicate
 *   (b.source_card_id == ii.source_card_id) OR (b.place_id == ii.place_id)
 * is the SINGLE source of truth, encoded in
 * `app/src/lib/bookmarks/pairing.ts` via `isPaired` (pure) and
 * `buildPairingOrClause` (PostgREST `.or()`). Inlining this OR anywhere else
 * — a route handler, a server component, another lib helper — is a DRY
 * violation flagged HIGH by R4 code-review, because the two implementations
 * silently drift and the two endpoints (B-031, B-038) then diverge.
 *
 * This test scans every `.ts` / `.tsx` file under `app/src/` (excluding
 * `pairing.ts` itself and the `__tests__` tree) for lines that combine
 * `source_card_id` AND `place_id` in PostgREST OR-syntax (`.or(`) or the
 * narrower per-line OR pattern. If anyone reintroduces the inline pattern,
 * this file fails — and the failure message names the offending file.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildPairingOrClause,
  isPaired,
} from '@/lib/bookmarks/pairing';

const REPO_ROOT = path.resolve(__dirname, '../../../');
const SRC_DIR = path.join(REPO_ROOT, 'src');
const PAIRING_FILE = path.join(SRC_DIR, 'lib', 'bookmarks', 'pairing.ts');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      // Skip the test tree itself — those files describe the predicate
      // by design (factories, oracles, this scanner).
      if (entry === '__tests__') continue;
      if (entry === 'node_modules') continue;
      walk(full, out);
    } else if (s.isFile()) {
      if (full === PAIRING_FILE) continue;
      if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full);
    }
  }
  return out;
}

describe('pairing.ts is the SINGLE source of the paired OR predicate', () => {
  const files = walk(SRC_DIR);

  it('no production file inlines a PostgREST `.or(...)` mixing source_card_id AND place_id', () => {
    const offenders: Array<{ file: string; line: number; text: string }> = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // A PostgREST OR call that names both fields on the same line is the
        // exact anti-pattern we are guarding against (e.g.
        // `.or('source_card_id.in.(...),place_id.in.(...)')`).
        if (
          line.includes('.or(') &&
          line.includes('source_card_id') &&
          line.includes('place_id')
        ) {
          offenders.push({ file, line: i + 1, text: line.trim() });
        }
      }
    }
    expect(
      offenders,
      `Found ${offenders.length} inline OR predicate(s) outside pairing.ts:\n` +
        offenders
          .map((o) => `  ${path.relative(REPO_ROOT, o.file)}:${o.line}\n    ${o.text}`)
          .join('\n') +
        '\n\nUse buildPairingOrClause() from @/lib/bookmarks/pairing instead.',
    ).toHaveLength(0);
  });

  it('no production JS-OR (`||` / `OR`) line combines bookmark.source_card_id with bookmark.place_id', () => {
    // Catches a TS/JS in-memory recompute of `isPaired` (e.g.
    // `b.source_card_id === x || b.place_id === y`). The pairing.ts file is
    // already excluded above; any other hit means a parallel implementation.
    const offenders: Array<{ file: string; line: number; text: string }> = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const hasCard = /\bsource_card_id\b/.test(line);
        const hasPlace = /\bplace_id\b/.test(line);
        const hasOr = line.includes('||');
        if (hasCard && hasPlace && hasOr) {
          offenders.push({ file, line: i + 1, text: line.trim() });
        }
      }
    }
    expect(
      offenders,
      `Found ${offenders.length} inline JS-OR predicate(s) mixing source_card_id and place_id outside pairing.ts:\n` +
        offenders
          .map((o) => `  ${path.relative(REPO_ROOT, o.file)}:${o.line}\n    ${o.text}`)
          .join('\n') +
        '\n\nImport isPaired() from @/lib/bookmarks/pairing instead.',
    ).toHaveLength(0);
  });

  it('exports the canonical surface', () => {
    // Belt-and-braces: this test fails if someone deletes or renames the
    // exports the drift guard relies on.
    expect(typeof isPaired).toBe('function');
    expect(typeof buildPairingOrClause).toBe('function');
  });
});
