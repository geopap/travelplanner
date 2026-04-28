/**
 * import-trello.ts — One-shot Japan 2026 Trello → Supabase importer.
 *
 * Usage:
 *   npx tsx app/scripts/import-trello.ts --user-email me@example.com [--dry-run]
 *
 * Or via npm script:
 *   npm run import:trello -- --user-email me@example.com [--dry-run]
 *
 * Requires (read from `app/.env.local`):
 *   - NEXT_PUBLIC_SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY  (server-side only — bypasses RLS)
 *
 * Behavior:
 *   - Trip currency is hard-coded to CHF per R1 handoff. No FX conversion.
 *   - Idempotent on (trip_id, source_card_id). Safe to re-run.
 *   - Dry-run logs the planned plan and writes nothing.
 *
 * See SOLUTION_DESIGN.md §B-016 for the locked spec.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Constants — locked at R2.
// ---------------------------------------------------------------------------

const TRIP_NAME = 'Japan 2026';
const TRIP_START = '2026-11-13';
const TRIP_END = '2026-12-08';
const TRIP_CURRENCY = 'CHF';

const DATA_PATH_REL = 'data/japan-2026.json';
const ENV_PATH_REL = '../.env.local';

// ---------------------------------------------------------------------------
// Trello types — narrow shapes for what we read.
// ---------------------------------------------------------------------------

interface TrelloLabel {
  id: string;
  name: string;
}

interface TrelloCard {
  id: string;
  name: string;
  desc: string | null;
  idList: string;
  labels: TrelloLabel[];
  closed: boolean;
}

interface TrelloList {
  id: string;
  name: string;
  closed: boolean;
}

interface TrelloExport {
  lists: TrelloList[];
  cards: TrelloCard[];
}

// ---------------------------------------------------------------------------
// Domain types.
// ---------------------------------------------------------------------------

type LabelKind =
  | 'transportation'
  | 'hotels'
  | 'restaurants'
  | 'museums'
  | 'attractions'
  | 'shopping'
  | 'unlabeled';

type TransportMode = 'flight' | 'train' | 'bus' | 'car' | 'ferry' | 'other';

type BookmarkCategory = 'restaurant' | 'sight' | 'museum' | 'shopping';

interface CliArgs {
  userEmail: string;
  dryRun: boolean;
}

export interface Summary {
  trips: number;
  days: number;
  items: number;
  transportation: number;
  accommodations: number;
  bookmarks: number;
  skipped: number;
  errors: number;
  unpairedHotels: string[];
  unlabeledCardIds: string[];
}

// ---------------------------------------------------------------------------
// CLI parsing.
// ---------------------------------------------------------------------------

export function parseArgs(argv: readonly string[]): CliArgs {
  let userEmail: string | null = null;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--user-email') {
      const v = argv[i + 1];
      if (!v) throw new Error('--user-email requires a value');
      userEmail = v;
      i++;
    } else if (a?.startsWith('--user-email=')) {
      userEmail = a.slice('--user-email='.length);
    } else if (a === '--dry-run') {
      dryRun = true;
    }
  }
  if (!userEmail) {
    throw new Error('Missing required --user-email <email>');
  }
  return { userEmail, dryRun };
}

// ---------------------------------------------------------------------------
// Env loading — minimal `.env.local` parser (no `dotenv` dep needed).
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

// Cheap heuristic: anon keys are JWTs starting with `eyJ` and the role claim
// is `anon`; service-role keys are also JWTs but with role `service_role`.
// We can't decode the JWT without a dep, so we use length + a payload check.
export function looksLikeAnonKey(key: string): boolean {
  // Both keys are ~ 200+ chars; we decode the middle (payload) base64.
  const parts = key.split('.');
  if (parts.length !== 3) return false;
  try {
    const payload = parts[1];
    if (!payload) return false;
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const json = Buffer.from(padded, 'base64').toString('utf8');
    const obj = JSON.parse(json) as { role?: unknown };
    return obj.role === 'anon';
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Date helpers.
// ---------------------------------------------------------------------------

const DATED_LIST_RE = /^(\d{2})\.(\d{2})\.(\d{4})$/;

export function parseDatedList(name: string): string | null {
  const m = DATED_LIST_RE.exec(name.trim());
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  // Only accept dates inside the trip range (2026-11-13..2026-12-08).
  // Other dated lists (e.g. 2024 archive) are skipped.
  const iso = `${yyyy}-${mm}-${dd}`;
  if (iso < TRIP_START || iso > TRIP_END) return null;
  return iso;
}

function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function eachDateISO(startISO: string, endISO: string): string[] {
  const out: string[] = [];
  let cur = startISO;
  while (cur <= endISO) {
    out.push(cur);
    cur = addDaysISO(cur, 1);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Label classification.
// ---------------------------------------------------------------------------

export function classify(card: TrelloCard): LabelKind {
  if (card.labels.length === 0) return 'unlabeled';
  const first = card.labels[0]?.name?.toLowerCase().trim() ?? '';
  switch (first) {
    case 'transportation': return 'transportation';
    case 'hotels': return 'hotels';
    case 'restaurants': return 'restaurants';
    case 'museums': return 'museums';
    case 'attractions': return 'attractions';
    case 'shopping': return 'shopping';
    default: return 'unlabeled';
  }
}

const TRANSPORT_KEYWORDS: ReadonlyArray<readonly [RegExp, TransportMode]> = [
  [/\b(flight|fly|airline|airport)\b/i, 'flight'],
  [/\b(train|shinkansen|jr |rail)\b/i, 'train'],
  [/\bbus\b/i, 'bus'],
  [/\bferry\b/i, 'ferry'],
  [/\b(car|drive|rental)\b/i, 'car'],
];

export function inferTransportMode(name: string): TransportMode {
  for (const [re, mode] of TRANSPORT_KEYWORDS) {
    if (re.test(name)) return mode;
  }
  return 'other';
}

const HOTEL_PREFIX_RE = /^(checkin|check-in|checkout|check-out)\s*-\s*/i;

export function hotelKind(cardName: string): { kind: 'checkin' | 'checkout' | 'unknown'; canonical: string } {
  const trimmed = cardName.trim();
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('checkin') || lower.startsWith('check-in')) {
    return { kind: 'checkin', canonical: trimmed.replace(HOTEL_PREFIX_RE, '').replace(/\s+/g, ' ').trim() };
  }
  if (lower.startsWith('checkout') || lower.startsWith('check-out')) {
    return { kind: 'checkout', canonical: trimmed.replace(HOTEL_PREFIX_RE, '').replace(/\s+/g, ' ').trim() };
  }
  return { kind: 'unknown', canonical: trimmed };
}

function truncate(s: string | null, max: number): string | null {
  if (s === null) return null;
  const t = s.trim();
  if (t.length === 0) return null;
  return t.length > max ? t.slice(0, max) : t;
}

// ---------------------------------------------------------------------------
// Logger — minimal structured stderr.
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
function logPlan(msg: string, ctx?: Record<string, unknown>): void {
  process.stdout.write(`[plan] ${msg}${ctx ? ' ' + JSON.stringify(ctx) : ''}\n`);
}

// ---------------------------------------------------------------------------
// User resolution via auth.admin.listUsers (paginated).
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
// Trip + days bootstrap.
// ---------------------------------------------------------------------------

interface TripBootstrap {
  tripId: string;
  daysByDate: Map<string, string>;
}

async function bootstrapTrip(
  client: SupabaseClient,
  ownerId: string,
  dryRun: boolean,
): Promise<TripBootstrap> {
  if (dryRun) {
    logPlan('would upsert trip', { name: TRIP_NAME, start: TRIP_START, end: TRIP_END, currency: TRIP_CURRENCY });
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const days = new Map<string, string>();
    for (const d of eachDateISO(TRIP_START, TRIP_END)) {
      days.set(d, fakeId);
      logPlan('would upsert trip_day', { date: d });
    }
    return { tripId: fakeId, daysByDate: days };
  }

  // 1. Find existing trip by (owner_id, name).
  const { data: existing, error: selErr } = await client
    .from('trips')
    .select('id, start_date, end_date, base_currency')
    .eq('owner_id', ownerId)
    .eq('name', TRIP_NAME)
    .maybeSingle();
  if (selErr) throw new Error(`select trips: ${selErr.message}`);

  let tripId: string;
  if (existing) {
    tripId = existing.id as string;
    logInfo('trip exists, reusing', { tripId });
  } else {
    const { data: inserted, error: insErr } = await client
      .from('trips')
      .insert({
        owner_id: ownerId,
        name: TRIP_NAME,
        start_date: TRIP_START,
        end_date: TRIP_END,
        base_currency: TRIP_CURRENCY,
      })
      .select('id')
      .single();
    if (insErr || !inserted) throw new Error(`insert trips: ${insErr?.message ?? 'no row'}`);
    tripId = inserted.id as string;
    logInfo('trip created', { tripId });
  }

  // 2. Ensure trip_members row for owner. The 0001 trigger seeds this on
  //    insert; for the reuse path we re-assert defensively (no-op if present).
  const { error: tmErr } = await client
    .from('trip_members')
    .upsert(
      {
        trip_id: tripId,
        user_id: ownerId,
        role: 'owner',
        status: 'accepted',
        invited_by: ownerId,
        accepted_at: new Date().toISOString(),
      },
      { onConflict: 'trip_id,user_id', ignoreDuplicates: true },
    );
  if (tmErr) throw new Error(`upsert trip_members: ${tmErr.message}`);

  // 3. Insert trip_days for each calendar date (idempotent on (trip_id, date)).
  const dates = eachDateISO(TRIP_START, TRIP_END);
  const dayRows = dates.map((date, idx) => ({
    trip_id: tripId,
    date,
    day_number: idx + 1,
  }));
  const { error: dErr } = await client
    .from('trip_days')
    .upsert(dayRows, { onConflict: 'trip_id,date', ignoreDuplicates: true });
  if (dErr) throw new Error(`upsert trip_days: ${dErr.message}`);

  // 4. Read back the trip_days map.
  const { data: dayRowsBack, error: drErr } = await client
    .from('trip_days')
    .select('id, date')
    .eq('trip_id', tripId);
  if (drErr) throw new Error(`select trip_days: ${drErr.message}`);
  const daysByDate = new Map<string, string>();
  for (const row of dayRowsBack ?? []) {
    const id = row.id as unknown;
    const date = row.date as unknown;
    if (typeof id === 'string' && typeof date === 'string') {
      daysByDate.set(date, id);
    }
  }
  logInfo('trip_days hydrated', { count: daysByDate.size });
  return { tripId, daysByDate };
}

// ---------------------------------------------------------------------------
// Card processing.
// ---------------------------------------------------------------------------

interface ProcessCtx {
  client: SupabaseClient;
  tripId: string;
  ownerId: string;
  daysByDate: Map<string, string>;
  dryRun: boolean;
  summary: Summary;
}

async function processItineraryNote(
  ctx: ProcessCtx,
  card: TrelloCard,
  dayId: string,
): Promise<void> {
  const row = {
    trip_id: ctx.tripId,
    day_id: dayId,
    type: 'note' as const,
    title: card.name.slice(0, 200),
    notes: truncate(card.desc, 4000),
    created_by: ctx.ownerId,
    source_card_id: card.id,
  };
  if (ctx.dryRun) {
    logPlan('would upsert itinerary_items (note)', { cardId: card.id });
    ctx.summary.items++;
    return;
  }
  const { error } = await ctx.client
    .from('itinerary_items')
    .upsert(row, { onConflict: 'trip_id,source_card_id' });
  if (error) throw new Error(error.message);
  ctx.summary.items++;
}

async function processTransportation(
  ctx: ProcessCtx,
  card: TrelloCard,
  dayId: string,
): Promise<void> {
  const itemRow = {
    trip_id: ctx.tripId,
    day_id: dayId,
    type: 'transport' as const,
    title: card.name.slice(0, 200),
    notes: truncate(card.desc, 4000),
    created_by: ctx.ownerId,
    source_card_id: card.id,
  };
  if (ctx.dryRun) {
    logPlan('would upsert itinerary_items (transport)', { cardId: card.id });
    logPlan('would upsert transportation', { cardId: card.id, mode: inferTransportMode(card.name) });
    ctx.summary.items++;
    ctx.summary.transportation++;
    return;
  }
  const { data: itemBack, error: itemErr } = await ctx.client
    .from('itinerary_items')
    .upsert(itemRow, { onConflict: 'trip_id,source_card_id' })
    .select('id')
    .single();
  if (itemErr || !itemBack) throw new Error(`itinerary_items: ${itemErr?.message ?? 'no row'}`);
  ctx.summary.items++;

  const itemId = itemBack.id as string;
  const mode = inferTransportMode(card.name);

  // transportation has unique(itinerary_item_id) — that's the natural key for
  // re-running. We upsert keyed on `itinerary_item_id`.
  const transportRow = {
    itinerary_item_id: itemId,
    trip_id: ctx.tripId,
    mode,
    notes: truncate(card.desc, 2000),
    created_by: ctx.ownerId,
  };
  const { error: trErr } = await ctx.client
    .from('transportation')
    .upsert(transportRow, { onConflict: 'itinerary_item_id' });
  if (trErr) throw new Error(`transportation: ${trErr.message}`);
  ctx.summary.transportation++;
}

async function processBookmark(
  ctx: ProcessCtx,
  card: TrelloCard,
  category: BookmarkCategory,
): Promise<void> {
  // Bookmark notes hold the card name + optional desc (truncated to 500).
  const noteText = card.desc && card.desc.trim().length
    ? `${card.name} — ${card.desc.trim()}`
    : card.name;
  const row = {
    trip_id: ctx.tripId,
    place_id: null,
    category,
    notes: truncate(noteText, 500),
    added_by: ctx.ownerId,
    source_card_id: card.id,
  };
  if (ctx.dryRun) {
    logPlan('would upsert bookmark', { cardId: card.id, category });
    ctx.summary.bookmarks++;
    return;
  }
  const { error } = await ctx.client
    .from('bookmarks')
    .upsert(row, { onConflict: 'trip_id,source_card_id' });
  if (error) throw new Error(error.message);
  ctx.summary.bookmarks++;
}

interface HotelPair {
  canonical: string;
  checkInDate: string;
  checkOutDate: string;
  sourceCardId: string;
  desc: string | null;
}

export function pairHotels(
  hotelCards: ReadonlyArray<{ card: TrelloCard; date: string }>,
  summary: Summary,
): HotelPair[] {
  // Group by canonical name preserving the kind.
  type Group = {
    checkins: Array<{ card: TrelloCard; date: string }>;
    checkouts: Array<{ card: TrelloCard; date: string }>;
  };
  const groups = new Map<string, Group>();
  for (const entry of hotelCards) {
    const { kind, canonical } = hotelKind(entry.card.name);
    if (kind === 'unknown') {
      logWarn('hotel card without checkin/checkout prefix — skipped', {
        cardId: entry.card.id,
        name: entry.card.name,
      });
      summary.skipped++;
      continue;
    }
    const key = canonical.toLowerCase();
    let g = groups.get(key);
    if (!g) {
      g = { checkins: [], checkouts: [] };
      groups.set(key, g);
    }
    if (kind === 'checkin') g.checkins.push(entry);
    else g.checkouts.push(entry);
  }

  const pairs: HotelPair[] = [];
  for (const [, g] of groups) {
    g.checkins.sort((a, b) => a.date.localeCompare(b.date));
    g.checkouts.sort((a, b) => a.date.localeCompare(b.date));
    const usedCheckouts = new Set<number>();

    for (const ci of g.checkins) {
      // Find earliest unused checkout >= ci.date.
      let matchedIdx = -1;
      for (let j = 0; j < g.checkouts.length; j++) {
        if (usedCheckouts.has(j)) continue;
        const co = g.checkouts[j];
        if (co && co.date >= ci.date) {
          matchedIdx = j;
          break;
        }
      }
      const canonicalName = hotelKind(ci.card.name).canonical;
      if (matchedIdx >= 0) {
        usedCheckouts.add(matchedIdx);
        const co = g.checkouts[matchedIdx];
        if (!co) continue;
        pairs.push({
          canonical: canonicalName,
          checkInDate: ci.date,
          checkOutDate: co.date,
          sourceCardId: ci.card.id,
          desc: ci.card.desc,
        });
      } else {
        // Unpaired Checkin → +1 day default.
        const fallback = addDaysISO(ci.date, 1);
        const clampedOut = fallback > TRIP_END ? TRIP_END : fallback;
        logWarn('unpaired_checkin', { name: canonicalName, checkIn: ci.date, fallbackOut: clampedOut });
        summary.unpairedHotels.push(`checkin:${canonicalName}`);
        pairs.push({
          canonical: canonicalName,
          checkInDate: ci.date,
          checkOutDate: clampedOut,
          sourceCardId: ci.card.id,
          desc: ci.card.desc,
        });
      }
    }

    for (let j = 0; j < g.checkouts.length; j++) {
      if (usedCheckouts.has(j)) continue;
      const co = g.checkouts[j];
      if (!co) continue;
      const canonicalName = hotelKind(co.card.name).canonical;
      logError('unpaired_checkout — skipped', { name: canonicalName, cardId: co.card.id, date: co.date });
      summary.unpairedHotels.push(`checkout:${canonicalName}`);
      summary.errors++;
    }
  }
  return pairs;
}

async function processHotelPair(ctx: ProcessCtx, pair: HotelPair): Promise<void> {
  const row = {
    trip_id: ctx.tripId,
    hotel_name: pair.canonical.slice(0, 200),
    check_in_date: pair.checkInDate,
    check_out_date: pair.checkOutDate,
    notes: truncate(pair.desc, 4000),
    created_by: ctx.ownerId,
    source_card_id: pair.sourceCardId,
  };
  if (ctx.dryRun) {
    logPlan('would upsert accommodation', {
      hotel: pair.canonical,
      checkIn: pair.checkInDate,
      checkOut: pair.checkOutDate,
      sourceCardId: pair.sourceCardId,
    });
    ctx.summary.accommodations++;
    return;
  }
  const { error } = await ctx.client
    .from('accommodations')
    .upsert(row, { onConflict: 'trip_id,source_card_id' });
  if (error) throw new Error(error.message);
  ctx.summary.accommodations++;
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const dataPath = resolve(__dirname, DATA_PATH_REL);
  const envPath = resolve(__dirname, ENV_PATH_REL);

  const env = { ...loadEnv(envPath), ...process.env };
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL not set (looked in app/.env.local and process.env)');
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY not set (looked in app/.env.local and process.env)');
  if (looksLikeAnonKey(serviceKey)) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY appears to be the anon key — refusing to proceed (RLS would block writes)');
  }

  logInfo('starting Trello import', {
    dryRun: args.dryRun,
    dataPath,
  });

  const raw = readFileSync(dataPath, 'utf8');
  const exportData = JSON.parse(raw) as TrelloExport;

  const client = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const ownerId = await findUserIdByEmail(client, args.userEmail);
  logInfo('user resolved', { ownerId });

  // Build list_id → ISO date map.
  const listDateById = new Map<string, string>();
  for (const list of exportData.lists) {
    if (list.closed) continue;
    const iso = parseDatedList(list.name);
    if (iso) listDateById.set(list.id, iso);
  }
  logInfo('dated lists discovered', { count: listDateById.size });

  const { tripId, daysByDate } = await bootstrapTrip(client, ownerId, args.dryRun);

  const summary: Summary = {
    trips: 1,
    days: daysByDate.size,
    items: 0,
    transportation: 0,
    accommodations: 0,
    bookmarks: 0,
    skipped: 0,
    errors: 0,
    unpairedHotels: [],
    unlabeledCardIds: [],
  };

  const ctx: ProcessCtx = {
    client,
    tripId,
    ownerId,
    daysByDate,
    dryRun: args.dryRun,
    summary,
  };

  // Pre-collect hotel cards for pairing across the whole trip.
  const hotelEntries: Array<{ card: TrelloCard; date: string }> = [];

  for (const card of exportData.cards) {
    if (card.closed) {
      summary.skipped++;
      continue;
    }
    const date = listDateById.get(card.idList);
    if (!date) {
      // Card belongs to a non-dated or out-of-range list — skip silently.
      summary.skipped++;
      continue;
    }
    const dayId = daysByDate.get(date);
    if (!dayId) {
      logError('day_not_found', { cardId: card.id, date });
      summary.errors++;
      continue;
    }
    const kind = classify(card);
    if (card.labels.length > 1) {
      logWarn('multi_label_card — using first label', { cardId: card.id, labels: card.labels.map((l) => l.name) });
    }

    try {
      if (kind === 'hotels') {
        hotelEntries.push({ card, date });
        continue;
      }
      if (kind === 'transportation') {
        await processTransportation(ctx, card, dayId);
        continue;
      }
      if (kind === 'restaurants') { await processBookmark(ctx, card, 'restaurant'); continue; }
      if (kind === 'museums')     { await processBookmark(ctx, card, 'museum');     continue; }
      if (kind === 'attractions') { await processBookmark(ctx, card, 'sight');      continue; }
      if (kind === 'shopping')    { await processBookmark(ctx, card, 'shopping');   continue; }
      // Unlabeled → itinerary note.
      summary.unlabeledCardIds.push(card.id);
      await processItineraryNote(ctx, card, dayId);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      logError('card_skipped', { cardId: card.id, name: card.name, reason });
      summary.errors++;
    }
  }

  // Process hotels last so cross-list pairing has all candidates.
  const pairs = pairHotels(hotelEntries, summary);
  for (const pair of pairs) {
    try {
      await processHotelPair(ctx, pair);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      logError('hotel_pair_skipped', {
        hotel: pair.canonical,
        sourceCardId: pair.sourceCardId,
        reason,
      });
      summary.errors++;
    }
  }

  logInfo('summary', {
    trips: summary.trips,
    days: summary.days,
    items: summary.items,
    transportation: summary.transportation,
    accommodations: summary.accommodations,
    bookmarks: summary.bookmarks,
    skipped: summary.skipped,
    errors: summary.errors,
    unpairedHotels: summary.unpairedHotels.length,
    unlabeledCards: summary.unlabeledCardIds.length,
    dryRun: args.dryRun,
  });
}

// Entry-point guard: only run main() when this file is invoked directly (e.g.
// via `tsx app/scripts/import-trello.ts`). Skip when imported by unit tests.
const __invokedDirectly = (() => {
  try {
    const argvPath = process.argv[1];
    if (!argvPath) return false;
    const here = fileURLToPath(import.meta.url);
    return resolve(argvPath) === resolve(here);
  } catch {
    return false;
  }
})();

if (__invokedDirectly) {
  main().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[fatal] ${msg}\n`);
    process.exit(1);
  });
}
