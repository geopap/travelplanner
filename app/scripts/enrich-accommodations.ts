/**
 * enrich-accommodations.ts — One-shot accommodation → place_id enrichment.
 *
 * B-023 — Scans every accommodation row with `place_id IS NULL` and a
 * non-empty `hotel_name` and tries to resolve it to an internal `places.id`
 * via the existing Google Places cache + proxy. The match must clear a
 * conservative three-rule confidence check (see `passesConfidence`); on miss
 * or ambiguity the row is logged and skipped — never auto-picked.
 *
 * Usage:
 *   npx tsx app/scripts/enrich-accommodations.ts --user me@example.com [--trip <tripId>] [--dry-run]
 *
 * Idempotency:
 *   The selection filter (`place_id IS NULL`) means re-running the script
 *   skips already-enriched rows. Safe to re-run after editing `hotel_name`
 *   typos.
 *
 * Requires (read from `app/.env.local`):
 *   - NEXT_PUBLIC_SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY     (server-side only — bypasses RLS)
 *   - ENRICH_BASE_URL (optional)    Defaults to http://localhost:<PORT|3000>;
 *                                   used to call /api/places/search on cache misses.
 *   - ENRICH_SESSION_COOKIE (optional) Cookie header for /api/places/search;
 *                                   without it, only cache-hit enrichments succeed.
 *
 * See SOLUTION_DESIGN.md §B-023 for the locked spec.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { looksLikeAnonKey } from './import-trello';
import { resolveGooglePlaceId } from '../src/lib/supabase/place-resolver';

const ENV_PATH_REL = '../.env.local';
const POLITE_DELAY_MS = 250;

// ---------------------------------------------------------------------------
// CLI parsing.
// ---------------------------------------------------------------------------

interface CliArgs {
  userEmail: string;
  dryRun: boolean;
  tripId: string | null;
}

export function parseArgs(argv: readonly string[]): CliArgs {
  let userEmail: string | null = null;
  let dryRun = false;
  let tripId: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--user') {
      const v = argv[i + 1];
      if (!v) throw new Error('--user requires a value');
      userEmail = v;
      i++;
    } else if (a?.startsWith('--user=')) {
      userEmail = a.slice('--user='.length);
    } else if (a === '--trip') {
      const v = argv[i + 1];
      if (!v) throw new Error('--trip requires a value');
      tripId = v;
      i++;
    } else if (a?.startsWith('--trip=')) {
      tripId = a.slice('--trip='.length);
    } else if (a === '--dry-run') {
      dryRun = true;
    } else if (a && !a.startsWith('--')) {
      // ignore positional
    } else if (a) {
      throw new Error(`Unknown flag: ${a}`);
    }
  }
  if (!userEmail) throw new Error('Missing required --user <email>');
  return { userEmail, dryRun, tripId };
}

// ---------------------------------------------------------------------------
// Env loading — mirrors import-trello.ts.
// ---------------------------------------------------------------------------

function loadEnv(envPath: string): Record<string, string> {
  let raw = '';
  try {
    raw = readFileSync(envPath, 'utf8');
  } catch {
    return {};
  }
  const out: Record<string, string> = {};
  for (const lineRaw of raw.split(/\r?\n/)) {
    const line = lineRaw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Confidence helper — pure, unit-tested.
// ---------------------------------------------------------------------------

export interface ConfidenceCandidate {
  google_place_id: string;
  name: string;
  business_status?: string | null;
}

export type ConfidenceOutcome =
  | { ok: true; pick: ConfidenceCandidate }
  | { ok: false; reason: 'no_results' | 'name_no_match' | 'not_operational' | 'ambiguous_top2' };

/**
 * Substring match between query hotel name and candidate name, case-insensitive
 * and whitespace-normalized. Matches either direction so that a query like
 * "Park Hyatt" matches "Park Hyatt Tokyo" (candidate is longer) and a query
 * like "Park Hyatt Tokyo Shinjuku" also matches "Park Hyatt Tokyo" (candidate
 * is shorter — user typed something more specific than the canonical name).
 */
function nameMatches(query: string, candidate: string): boolean {
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ');
  const c = candidate.trim().toLowerCase().replace(/\s+/g, ' ');
  if (q.length === 0 || c.length === 0) return false;
  return c.includes(q) || q.includes(c);
}

/**
 * Apply the 3-of-3 confidence rule:
 *  (a) Top-1 candidate name substring-matches the query (either direction).
 *  (b) Top-1 has `business_status === 'OPERATIONAL'` (missing == fail).
 *  (c) If a top-2 candidate exists, it must NOT also pass (a) — otherwise
 *      we reject as ambiguous to avoid silently picking the wrong "Hilton".
 *
 * Returns the picked candidate on success or a structured skip reason.
 */
export function passesConfidence(
  hotelName: string,
  candidates: readonly ConfidenceCandidate[],
): ConfidenceOutcome {
  if (candidates.length === 0) return { ok: false, reason: 'no_results' };
  const top1 = candidates[0];
  if (!top1) return { ok: false, reason: 'no_results' };
  if (!nameMatches(hotelName, top1.name)) {
    return { ok: false, reason: 'name_no_match' };
  }
  if ((top1.business_status ?? '').toUpperCase() !== 'OPERATIONAL') {
    return { ok: false, reason: 'not_operational' };
  }
  if (candidates.length >= 2) {
    const top2 = candidates[1];
    if (top2 && nameMatches(hotelName, top2.name)) {
      return { ok: false, reason: 'ambiguous_top2' };
    }
  }
  return { ok: true, pick: top1 };
}

// ---------------------------------------------------------------------------
// Domain types from the DB / API.
// ---------------------------------------------------------------------------

interface AccommodationRow {
  id: string;
  trip_id: string;
  hotel_name: string;
  place_id: string | null;
}

interface TripRow {
  id: string;
  title: string | null;
}

interface PlacesCacheRow {
  id: string;
  google_place_id: string;
  name: string;
  business_status: string | null;
}

interface PlacesSearchApiResult {
  google_place_id: string;
  name: string;
  business_status?: string | null;
}

interface ScriptSummary {
  scanned: number;
  enriched: number;
  skipped: number;
  errors: number;
  cacheHits: number;
  proxyHits: number;
  byReason: Record<string, number>;
}

// ---------------------------------------------------------------------------
// User lookup — duplicated from import-trello.ts for script isolation.
// ---------------------------------------------------------------------------

async function findUserIdByEmail(client: SupabaseClient, email: string): Promise<string> {
  const target = email.trim().toLowerCase();
  const perPage = 1000;
  for (let page = 1; page <= 100; page++) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`auth.admin.listUsers failed: ${error.message}`);
    const users = data.users ?? [];
    for (const u of users) {
      if ((u.email ?? '').toLowerCase() === target) return u.id;
    }
    if (users.length < perPage) break;
  }
  throw new Error(`User not found for email: ${email}`);
}

// ---------------------------------------------------------------------------
// Logger — minimal structured stdout.
// ---------------------------------------------------------------------------

function logInfo(msg: string, ctx?: Record<string, unknown>): void {
  process.stdout.write(`[info] ${msg}${ctx ? ' ' + JSON.stringify(ctx) : ''}\n`);
}
function logWarn(msg: string, ctx?: Record<string, unknown>): void {
  process.stderr.write(`[warn] ${msg}${ctx ? ' ' + JSON.stringify(ctx) : ''}\n`);
}
function logError(msg: string, ctx?: Record<string, unknown>): void {
  process.stderr.write(`[error] ${msg}${ctx ? ' ' + JSON.stringify(ctx) : ''}\n`);
}

function emitOutcome(dryRun: boolean, line: string): void {
  const prefix = dryRun ? '[dry-run] ' : '';
  process.stdout.write(`${prefix}${line}\n`);
}

// ---------------------------------------------------------------------------
// Cache + proxy lookups.
// ---------------------------------------------------------------------------

function escapeIlike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

async function lookupCacheCandidates(
  client: SupabaseClient,
  hotelName: string,
): Promise<PlacesCacheRow[]> {
  const { data, error } = await client
    .from('places')
    .select('id, google_place_id, name, business_status')
    .ilike('name', `%${escapeIlike(hotelName)}%`)
    .limit(5);
  if (error) throw new Error(`places cache lookup failed: ${error.message}`);
  return (data ?? []) as PlacesCacheRow[];
}

async function lookupProxyCandidates(
  baseUrl: string,
  cookie: string | null,
  hotelName: string,
): Promise<PlacesSearchApiResult[] | null> {
  if (!cookie) return null; // no session — proxy path unavailable
  const url = `${baseUrl}/api/places/search?q=${encodeURIComponent(hotelName)}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { cookie, accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`/api/places/search returned ${res.status}`);
  }
  const body = (await res.json()) as { results?: PlacesSearchApiResult[] };
  return Array.isArray(body.results) ? body.results : [];
}

// Thin wrapper over the shared resolver: the script wants the bare uuid (or
// null) and treats lookup_error as a thrown error so the per-row catch can
// log it. Cache misses return null (skip, log).
async function resolveGooglePlaceIdToInternal(
  client: SupabaseClient,
  googlePlaceId: string,
): Promise<string | null> {
  const result = await resolveGooglePlaceId(client, googlePlaceId);
  if (result.ok) return result.placeId;
  if (result.reason === 'lookup_error') {
    throw new Error('places resolution failed');
  }
  return null;
}

// ---------------------------------------------------------------------------
// Per-row enrichment.
// ---------------------------------------------------------------------------

interface EnrichDeps {
  client: SupabaseClient;
  baseUrl: string;
  sessionCookie: string | null;
  dryRun: boolean;
  summary: ScriptSummary;
}

async function enrichOne(
  deps: EnrichDeps,
  row: AccommodationRow,
  trip: TripRow,
): Promise<void> {
  const { client, baseUrl, sessionCookie, dryRun, summary } = deps;
  summary.scanned++;

  // 1. Cache-first.
  let candidates: ConfidenceCandidate[] = [];
  try {
    const cacheRows = await lookupCacheCandidates(client, row.hotel_name);
    candidates = cacheRows.map((r) => ({
      google_place_id: r.google_place_id,
      name: r.name,
      business_status: r.business_status,
    }));
  } catch (e) {
    summary.errors++;
    logError('cache_lookup_failed', {
      accommodationId: row.id,
      reason: e instanceof Error ? e.message : String(e),
    });
    return;
  }

  let outcome = passesConfidence(row.hotel_name, candidates);
  let source: 'cache' | 'proxy' = 'cache';

  // 2. Cache miss / ambiguous → proxy fallback.
  if (!outcome.ok) {
    try {
      const proxy = await lookupProxyCandidates(baseUrl, sessionCookie, row.hotel_name);
      if (proxy !== null) {
        await sleep(POLITE_DELAY_MS);
        outcome = passesConfidence(row.hotel_name, proxy);
        source = 'proxy';
      }
    } catch (e) {
      summary.errors++;
      logError('proxy_lookup_failed', {
        accommodationId: row.id,
        reason: e instanceof Error ? e.message : String(e),
      });
      return;
    }
  }

  if (!outcome.ok) {
    summary.skipped++;
    summary.byReason[outcome.reason] = (summary.byReason[outcome.reason] ?? 0) + 1;
    emitOutcome(
      dryRun,
      `${row.hotel_name} → ${outcome.reason} (trip="${trip.title ?? trip.id}")`,
    );
    return;
  }

  if (source === 'cache') summary.cacheHits++;
  else summary.proxyHits++;

  // 3. Resolve google_place_id → internal places.id.
  let internalPlaceId: string | null = null;
  try {
    internalPlaceId = await resolveGooglePlaceIdToInternal(
      client,
      outcome.pick.google_place_id,
    );
  } catch (e) {
    summary.errors++;
    logError('place_resolve_failed', {
      accommodationId: row.id,
      reason: e instanceof Error ? e.message : String(e),
    });
    return;
  }

  if (!internalPlaceId) {
    // Proxy returned a result that isn't in `places` yet — the proxy normally
    // upserts, but a race / cache-miss path may leave us here. Skip rather
    // than silently re-fetch.
    summary.skipped++;
    summary.byReason['not_cached'] = (summary.byReason['not_cached'] ?? 0) + 1;
    emitOutcome(dryRun, `${row.hotel_name} → not-cached`);
    return;
  }

  if (dryRun) {
    emitOutcome(
      true,
      `${row.hotel_name} → resolved: ${internalPlaceId} (source=${source})`,
    );
    summary.enriched++;
    return;
  }

  // 4. Update — keep `place_id IS NULL` guard so concurrent re-runs don't clobber.
  const { error: updateErr } = await client
    .from('accommodations')
    .update({ place_id: internalPlaceId })
    .eq('id', row.id)
    .is('place_id', null);
  if (updateErr) {
    summary.errors++;
    logError('update_failed', {
      accommodationId: row.id,
      reason: updateErr.message,
    });
    return;
  }
  summary.enriched++;
  emitOutcome(
    false,
    `${row.hotel_name} → resolved: ${internalPlaceId} (source=${source})`,
  );
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const envPath = resolve(__dirname, ENV_PATH_REL);

  const env = { ...loadEnv(envPath), ...process.env };
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL not set (looked in app/.env.local and process.env)');
  }
  if (!serviceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY not set (looked in app/.env.local and process.env)');
  }
  if (looksLikeAnonKey(serviceKey)) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY appears to be the anon key — refusing to proceed (RLS would block writes)');
  }

  const port = env.PORT ?? '3000';
  const baseUrl = env.ENRICH_BASE_URL ?? `http://localhost:${port}`;
  const sessionCookie = env.ENRICH_SESSION_COOKIE ?? null;

  logInfo('starting accommodation enrichment', {
    dryRun: args.dryRun,
    tripFilter: args.tripId ?? null,
    baseUrl,
    hasSessionCookie: sessionCookie !== null,
  });

  const client = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const ownerId = await findUserIdByEmail(client, args.userEmail);
  logInfo('user resolved', { ownerId });

  // Scope to trips owned by this user (via trip_members, since `owner_id`
  // historical column may differ across versions).
  const { data: memberRows, error: memberErr } = await client
    .from('trip_members')
    .select('trip_id')
    .eq('user_id', ownerId);
  if (memberErr) throw new Error(`trip_members lookup failed: ${memberErr.message}`);
  let tripIds = (memberRows ?? []).map((r: { trip_id: string }) => r.trip_id);
  if (args.tripId) {
    if (!tripIds.includes(args.tripId)) {
      throw new Error(`User is not a member of trip ${args.tripId}`);
    }
    tripIds = [args.tripId];
  }

  if (tripIds.length === 0) {
    logInfo('no trips found for user — exiting', {});
    return;
  }

  // Pull trip metadata for the search hint.
  const { data: tripsData, error: tripsErr } = await client
    .from('trips')
    .select('id, title')
    .in('id', tripIds);
  if (tripsErr) throw new Error(`trips lookup failed: ${tripsErr.message}`);
  const tripById = new Map<string, TripRow>();
  for (const t of (tripsData ?? []) as TripRow[]) tripById.set(t.id, t);

  // Pull candidate accommodations.
  const { data: accomRows, error: accomErr } = await client
    .from('accommodations')
    .select('id, trip_id, hotel_name, place_id')
    .in('trip_id', tripIds)
    .is('place_id', null)
    .not('hotel_name', 'is', null);
  if (accomErr) throw new Error(`accommodations lookup failed: ${accomErr.message}`);

  const rows = ((accomRows ?? []) as AccommodationRow[]).filter(
    (r) => r.hotel_name && r.hotel_name.trim().length > 0,
  );
  logInfo('candidates to enrich', { count: rows.length });

  const summary: ScriptSummary = {
    scanned: 0,
    enriched: 0,
    skipped: 0,
    errors: 0,
    cacheHits: 0,
    proxyHits: 0,
    byReason: {},
  };

  const deps: EnrichDeps = {
    client,
    baseUrl,
    sessionCookie,
    dryRun: args.dryRun,
    summary,
  };

  for (const row of rows) {
    const trip = tripById.get(row.trip_id);
    if (!trip) {
      // Skip orphan rows defensively; should not happen given the FK.
      summary.skipped++;
      summary.byReason['orphan_trip'] = (summary.byReason['orphan_trip'] ?? 0) + 1;
      continue;
    }
    try {
      await enrichOne(deps, row, trip);
    } catch (e) {
      summary.errors++;
      logError('enrich_card_failed', {
        accommodationId: row.id,
        reason: e instanceof Error ? e.message : String(e),
      });
    }
    // Polite pace between rows regardless of cache vs proxy path. The proxy
    // path also sleeps inside enrichOne after the fetch — that's fine, the
    // total inter-call delay is bounded.
    await sleep(POLITE_DELAY_MS);
  }

  logInfo('done', {
    scanned: summary.scanned,
    enriched: summary.enriched,
    skipped: summary.skipped,
    errors: summary.errors,
    cacheHits: summary.cacheHits,
    proxyHits: summary.proxyHits,
    byReason: summary.byReason,
  });
}

// Only auto-run when invoked directly (allows tests to import helpers).
const isDirectInvoke = (() => {
  try {
    const file = fileURLToPath(import.meta.url);
    return process.argv[1] === file;
  } catch {
    return false;
  }
})();

if (isDirectInvoke) {
  main().catch((err) => {
    logWarn('fatal', { reason: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  });
}
