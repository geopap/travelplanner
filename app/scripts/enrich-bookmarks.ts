// One-shot enrichment script for bookmarks created by the Trello importer.
//
// Usage:
//   npx tsx app/scripts/enrich-bookmarks.ts --trip <uuid> [--dry-run] [--limit N]
//
// For each bookmark in the trip with `place_id IS NULL`:
//   1. Take the first segment of `notes` (the original Trello card name) as
//      the search query.
//   2. Call Google Places textSearch via lib/google/places::searchPlaces.
//   3. Take the top result; upsert into `places` (matching the cache layout
//      used by /api/places/search); read back the `places.id` UUID.
//   4. Set `bookmarks.place_id` to that UUID.
//
// Requires `SUPABASE_SERVICE_ROLE_KEY` and `GOOGLE_PLACES_API_KEY` in
// `app/.env.local`. The service role bypasses RLS; the script writes
// scoped only to the resolved trip id.
//
// Per-call delay (250 ms) keeps Google API usage gentle. Cost ~ $0.017
// per textSearch — 100 bookmarks ≈ $1.70.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { mapGoogleTypesToCategory } from '../src/lib/google/categories';
import type { BookmarkCategory, PlaceSearchResult } from '../src/lib/types/domain';

// Inline call to Google Places v1 textSearch — `lib/google/places.ts` is
// marked `server-only` (Next.js runtime guard) and can't be imported by a
// plain tsx script. We replicate just the textSearch path here.
const GOOGLE_TEXT_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';
const FIELD_MASK = 'places.id,places.displayName,places.formattedAddress,places.location,places.types';
const REQUEST_TIMEOUT_MS = 5000;

interface GooglePlaceRaw {
  id?: unknown;
  displayName?: unknown;
  formattedAddress?: unknown;
  location?: unknown;
  types?: unknown;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}
function asStr(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}
function asNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function asStrArr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const t of v) if (typeof t === 'string') out.push(t);
  return out;
}

function parseRawPlace(raw: unknown): PlaceSearchResult | null {
  if (!isObj(raw)) return null;
  const r = raw as GooglePlaceRaw;
  const id = asStr(r.id);
  if (!id) return null;
  let name: string | null = null;
  if (isObj(r.displayName)) name = asStr((r.displayName as Record<string, unknown>).text);
  if (!name) return null;
  let lat: number | null = null;
  let lng: number | null = null;
  if (isObj(r.location)) {
    const loc = r.location as Record<string, unknown>;
    lat = asNum(loc.latitude);
    lng = asNum(loc.longitude);
  }
  return {
    google_place_id: id,
    name,
    formatted_address: asStr(r.formattedAddress),
    lat,
    lng,
    category: mapGoogleTypesToCategory(asStrArr(r.types)),
  };
}

async function searchPlaces(query: string, apiKey: string): Promise<PlaceSearchResult[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(GOOGLE_TEXT_SEARCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': FIELD_MASK,
      },
      body: JSON.stringify({ textQuery: query, maxResultCount: 5, languageCode: 'en' }),
      signal: controller.signal,
      cache: 'no-store',
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`places_http_${res.status}`);
  const raw: unknown = await res.json();
  const arr = isObj(raw) && Array.isArray((raw as { places?: unknown }).places)
    ? ((raw as { places: unknown[] }).places)
    : [];
  const out: PlaceSearchResult[] = [];
  for (const item of arr) {
    const p = parseRawPlace(item);
    if (p) out.push(p);
  }
  return out;
}

interface CliArgs {
  tripId: string;
  dryRun: boolean;
  limit: number | null;
}

interface BookmarkRow {
  id: string;
  notes: string | null;
  category: BookmarkCategory;
  source_card_id: string | null;
}

interface EnrichSummary {
  total: number;
  enriched: number;
  noResults: number;
  errors: number;
  skipped: number;
}

const DELAY_MS = 250;
const SEARCH_QUERY_MAX = 200;

function logInfo(msg: string, ctx: Record<string, unknown> = {}): void {
  console.log(`[info] ${msg}`, JSON.stringify(ctx));
}
function logWarn(msg: string, ctx: Record<string, unknown> = {}): void {
  console.warn(`[warn] ${msg}`, JSON.stringify(ctx));
}
function logError(msg: string, ctx: Record<string, unknown> = {}): void {
  console.error(`[error] ${msg}`, JSON.stringify(ctx));
}
function logPlan(msg: string, ctx: Record<string, unknown> = {}): void {
  console.log(`[plan] ${msg}`, JSON.stringify(ctx));
}

function parseArgs(argv: string[]): CliArgs {
  let tripId: string | null = null;
  let dryRun = false;
  let limit: number | null = null;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') dryRun = true;
    else if (a === '--trip') {
      tripId = argv[i + 1] ?? '';
      i++;
    } else if (a.startsWith('--trip=')) {
      tripId = a.slice('--trip='.length);
    } else if (a === '--limit') {
      const v = argv[i + 1] ?? '';
      limit = Number.parseInt(v, 10);
      i++;
    } else if (a.startsWith('--limit=')) {
      limit = Number.parseInt(a.slice('--limit='.length), 10);
    }
  }

  if (!tripId || !/^[0-9a-f-]{36}$/i.test(tripId)) {
    throw new Error('--trip <uuid> required');
  }
  if (limit !== null && (!Number.isFinite(limit) || limit <= 0)) {
    throw new Error('--limit must be a positive integer');
  }

  return { tripId, dryRun, limit };
}

function loadEnv(): Record<string, string> {
  const here = dirname(fileURLToPath(import.meta.url));
  const envPath = resolve(here, '..', '.env.local');
  const text = readFileSync(envPath, 'utf8');
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

function looksLikeAnonKey(key: string): boolean {
  const parts = key.split('.');
  if (parts.length !== 3) return false;
  try {
    const payload = Buffer.from(parts[1], 'base64').toString('utf8');
    const obj = JSON.parse(payload) as { role?: unknown };
    return obj.role === 'anon';
  } catch {
    return false;
  }
}

function extractQuery(notes: string | null): string | null {
  if (!notes) return null;
  // Trello import stored notes as `${name} — ${desc}` or just `${name}`.
  // Em-dash is the separator; if present, take the leading segment.
  const head = notes.split(' — ')[0]?.trim() ?? '';
  if (!head) return null;
  return head.slice(0, SEARCH_QUERY_MAX);
}

async function upsertPlace(
  client: SupabaseClient,
  pick: PlaceSearchResult,
): Promise<string> {
  const row = {
    google_place_id: pick.google_place_id,
    name: pick.name,
    formatted_address: pick.formatted_address,
    lat: pick.lat,
    lng: pick.lng,
    category: pick.category,
    cached_at: new Date().toISOString(),
  };
  const { data, error } = await client
    .from('places')
    .upsert(row, { onConflict: 'google_place_id' })
    .select('id')
    .single();
  if (error) throw new Error(`places upsert: ${error.message}`);
  if (!data || typeof data.id !== 'string') {
    throw new Error('places upsert: no id returned');
  }
  return data.id;
}

async function enrichOne(
  client: SupabaseClient,
  apiKey: string,
  bookmark: BookmarkRow,
  dryRun: boolean,
): Promise<'enriched' | 'no_results' | 'error' | 'skipped'> {
  const query = extractQuery(bookmark.notes);
  if (!query) return 'skipped';

  let results: PlaceSearchResult[];
  try {
    results = await searchPlaces(query, apiKey);
  } catch (err) {
    logError('places_search_failed', {
      bookmarkId: bookmark.id,
      query,
      reason: err instanceof Error ? err.message : 'unknown',
    });
    return 'error';
  }
  if (results.length === 0) {
    logWarn('no_places_results', { bookmarkId: bookmark.id, query });
    return 'no_results';
  }
  const top = results[0];

  if (dryRun) {
    logPlan('would link bookmark to place', {
      bookmarkId: bookmark.id,
      query,
      googlePlaceId: top.google_place_id,
      pickedName: top.name,
    });
    return 'enriched';
  }

  const placeId = await upsertPlace(client, top);
  const { error } = await client
    .from('bookmarks')
    .update({ place_id: placeId })
    .eq('id', bookmark.id);
  if (error) {
    logError('bookmark_update_failed', {
      bookmarkId: bookmark.id,
      reason: error.message,
    });
    return 'error';
  }
  logInfo('linked', {
    bookmarkId: bookmark.id,
    query,
    pickedName: top.name,
  });
  return 'enriched';
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const env = loadEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const placesKey = env.GOOGLE_PLACES_API_KEY;
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL missing in .env.local');
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing in .env.local');
  if (!placesKey) throw new Error('GOOGLE_PLACES_API_KEY missing in .env.local');
  if (looksLikeAnonKey(serviceKey)) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY appears to be the anon key — refusing to proceed (RLS would block updates)');
  }


  logInfo('starting bookmark enrichment', {
    tripId: args.tripId,
    dryRun: args.dryRun,
    limit: args.limit,
  });

  const client = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let q = client
    .from('bookmarks')
    .select('id, notes, category, source_card_id')
    .eq('trip_id', args.tripId)
    .is('place_id', null)
    .order('created_at', { ascending: true });
  if (args.limit !== null) q = q.limit(args.limit);

  const { data, error } = await q.returns<BookmarkRow[]>();
  if (error) throw new Error(`fetch bookmarks: ${error.message}`);
  const bookmarks = data ?? [];

  const summary: EnrichSummary = {
    total: bookmarks.length,
    enriched: 0,
    noResults: 0,
    errors: 0,
    skipped: 0,
  };
  logInfo('bookmarks to process', { count: summary.total });

  for (const b of bookmarks) {
    const result = await enrichOne(client, placesKey, b, args.dryRun);
    if (result === 'enriched') summary.enriched++;
    else if (result === 'no_results') summary.noResults++;
    else if (result === 'error') summary.errors++;
    else summary.skipped++;
    if (DELAY_MS > 0) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, DELAY_MS));
    }
  }

  logInfo('summary', { ...summary, dryRun: args.dryRun });
}

const isDirect = process.argv[1]
  ? fileURLToPath(import.meta.url) === resolve(process.argv[1])
  : false;
if (isDirect) {
  main().catch((err) => {
    logError('fatal', { reason: err instanceof Error ? err.message : 'unknown' });
    process.exit(1);
  });
}

export { parseArgs, extractQuery, looksLikeAnonKey };
