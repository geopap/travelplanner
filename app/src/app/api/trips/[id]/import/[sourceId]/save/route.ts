import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { UuidSchema } from '@/lib/validations/common';
import { SaveInput } from '@/lib/validations/import';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  badRequest,
  errorResponse,
  forbidden,
  notFound,
  serverError,
  unauthorized,
  validationError,
} from '@/lib/api/response';
import { checkTripAccess } from '@/lib/trip-access';
import { logAudit } from '@/lib/audit';

type RouteCtx = { params: Promise<{ id: string; sourceId: string }> };

interface PlaceCacheRow {
  id: string;
}

interface BookmarkInsertedRow {
  id: string;
}

interface ItineraryItemInsertedRow {
  id: string;
}

interface TripDayRow {
  id: string;
  date: string;
}

interface ImportSourceRow {
  id: string;
  trip_id: string;
  source_url: string | null;
  source_type: string;
  status: string;
}

export async function POST(
  request: NextRequest,
  ctx: RouteCtx,
): Promise<NextResponse> {
  try {
    const { id: tripId, sourceId } = await ctx.params;
    if (!UuidSchema.safeParse(tripId).success) return notFound();
    if (!UuidSchema.safeParse(sourceId).success) return notFound();

    const supabase = await createSupabaseServerClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return unauthorized();
    const userId = auth.user.id;

    const access = await checkTripAccess(supabase, tripId, userId, 'editor');
    if (!access.ok) {
      return access.reason === 'forbidden' ? forbidden() : notFound();
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest('Invalid JSON body');
    }
    const parsed = SaveInput.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);
    const input = parsed.data;

    // Verify the import_sources row exists, belongs to this trip, and is unsaved.
    // trip_id is taken from URL only — never from the body. AC #14.
    const { data: sourceRaw, error: sourceErr } = await supabase
      .from('import_sources')
      .select('id, trip_id, source_url, source_type, status')
      .eq('id', sourceId)
      .eq('trip_id', tripId)
      .maybeSingle<ImportSourceRow>();
    if (sourceErr) return serverError();
    if (!sourceRaw) {
      return errorResponse(
        'import_source_not_found',
        'Import source not found',
        404,
      );
    }
    // Tightened from `=== 'saved'` to `!== 'pending'`: the enum allows
    // `reviewed`/`discarded` (unused today), and any future state should be
    // explicitly opted in to the save path rather than silently accepted.
    // Reuses `import_already_saved` to keep the frontend mapping unchanged.
    if (sourceRaw.status !== 'pending') {
      return errorResponse(
        'import_already_saved',
        'This import is not in a save-eligible state',
        409,
      );
    }

    const toSave = input.confirmed_places.filter((p) => p.save === true);

    // Every saved place must carry a google_place_id from the autocomplete
    // (mirrors the bookmarks POST contract). Checked per-row rather than via
    // a Set-cardinality compare so that two cards legitimately sharing the
    // same google_place_id are not falsely rejected. (R4 fix.)
    for (const p of toSave) {
      if (typeof p.google_place_id !== 'string' || p.google_place_id.length === 0) {
        return errorResponse(
          'place_not_cached',
          'Every saved place must have a google_place_id from the autocomplete',
          400,
        );
      }
    }

    // Resolve google_place_id → places.id for each place we intend to save.
    // The Places cache is populated by B-009/B-010 when the autocomplete
    // surfaces a hit; we refuse to insert a bookmark for a place_id that
    // isn't cached (mirrors the bookmarks POST contract).
    const placeIdLookup = new Map<string, string>(); // gpid -> places.id
    if (toSave.length > 0) {
      const gpids = Array.from(
        new Set(
          toSave
            .map((p) => p.google_place_id)
            .filter((v): v is string => typeof v === 'string' && v.length > 0),
        ),
      );

      // NOTE: no `gpids.length !== toSave.length` pre-check — the per-gpid
      // cache-miss loop below correctly rejects any saved entry whose
      // google_place_id is missing or uncached, and `new Set(...)` legitimately
      // shrinks the array when two cards share the same place. (R4 fix.)

      if (gpids.length > 0) {
        const { data: rows, error: lookupErr } = await supabase
          .from('places')
          .select('id, google_place_id')
          .in('google_place_id', gpids);
        if (lookupErr) return serverError();
        const byGpid = new Map<string, string>();
        for (const r of (rows ?? []) as Array<
          PlaceCacheRow & { google_place_id: string }
        >) {
          byGpid.set(r.google_place_id, r.id);
        }
        for (const gpid of gpids) {
          const placeId = byGpid.get(gpid);
          if (!placeId) {
            return errorResponse(
              'place_not_cached',
              'Place is not cached; fetch place details first',
              404,
            );
          }
          placeIdLookup.set(gpid, placeId);
        }
      }
    }

    // Insert all bookmarks in one batch (single round-trip). If the batch
    // fails, none are committed — Supabase rejects the batch atomically.
    const bookmarkIds: string[] = [];
    if (toSave.length > 0) {
      const rows = toSave.map((p) => {
        // safety: filter above guarantees google_place_id present for saved entries
        const placeId = placeIdLookup.get(p.google_place_id ?? '');
        if (!placeId) {
          // Should never reach here — checked above. Keep as defensive guard.
          throw new Error('place_id_resolution_failed');
        }
        return {
          trip_id: tripId,
          place_id: placeId,
          category: p.category,
          notes: null as string | null,
          added_by: userId,
          import_source_id: sourceId,
        };
      });

      const { data: inserted, error: insertErr } = await supabase
        .from('bookmarks')
        .insert(rows)
        .select('id')
        .returns<BookmarkInsertedRow[]>();
      if (insertErr) {
        // 23505 = duplicate bookmark (place+category+trip) — surface as conflict.
        if (insertErr.code === '23505') {
          return errorResponse(
            'bookmark_exists',
            'A bookmark for this place and category already exists',
            409,
          );
        }
        return serverError();
      }
      for (const row of inserted ?? []) bookmarkIds.push(row.id);
    }

    // Optionally save tips as a single note on the trip's first day.
    let itineraryItemId: string | null = null;
    if (input.save_tips_as_note) {
      // Pull tips from the persisted extracted_json — never trust the client
      // for the note body.
      const { data: extractedRow, error: exErr } = await supabase
        .from('import_sources')
        .select('extracted_json, source_url, source_type')
        .eq('id', sourceId)
        .eq('trip_id', tripId)
        .maybeSingle<{
          extracted_json: { tips?: unknown };
          source_url: string | null;
          source_type: string;
        }>();
      if (exErr || !extractedRow) return serverError();

      const tipsRaw = extractedRow.extracted_json?.tips;
      const tips: string[] = Array.isArray(tipsRaw)
        ? tipsRaw.filter((t): t is string => typeof t === 'string' && t.length > 0)
        : [];

      if (tips.length > 0) {
        const { data: firstDay, error: dayErr } = await supabase
          .from('trip_days')
          .select('id, date')
          .eq('trip_id', tripId)
          .order('day_number', { ascending: true })
          .limit(1)
          .maybeSingle<TripDayRow>();
        if (dayErr) return serverError();
        if (firstDay) {
          const sourceLabel = extractedRow.source_url
            ? new URL(extractedRow.source_url).hostname
            : extractedRow.source_type;
          const noteBody = tips.map((t, i) => `${i + 1}. ${t}`).join('\n');
          const { data: noteRow, error: noteErr } = await supabase
            .from('itinerary_items')
            .insert({
              trip_id: tripId,
              day_id: firstDay.id,
              type: 'note',
              title: `Tips from ${sourceLabel}`,
              notes: noteBody,
              created_by: userId,
            })
            .select('id')
            .single<ItineraryItemInsertedRow>();
          if (noteErr || !noteRow) return serverError();
          itineraryItemId = noteRow.id;
        }
      }
    }

    // Known non-atomicity (R4 MEDIUM, accepted): the bookmark batch insert,
    // optional note insert, and this status flip are three separate writes.
    // A crash between them leaves the row at `pending` with bookmarks
    // committed — retry will 409 on duplicate bookmarks (acceptable surface
    // for a single-user app). Migrate to a Postgres RPC for atomicity if/when
    // invited members are activated.
    // Flip the import_sources row to 'saved' last so a partial failure leaves
    // it 'pending' (the user can retry).
    const { error: statusErr } = await supabase
      .from('import_sources')
      .update({ status: 'saved' })
      .eq('id', sourceId)
      .eq('trip_id', tripId);
    if (statusErr) return serverError();

    await logAudit({
      actorId: userId,
      action: 'import_saved',
      entity: 'import_sources',
      entityId: sourceId,
      tripId,
      metadata: {
        bookmark_count: bookmarkIds.length,
        tips_note_created: itineraryItemId !== null,
      },
    });

    return NextResponse.json(
      {
        bookmark_ids: bookmarkIds,
        itinerary_item_id: itineraryItemId,
      },
      { status: 201 },
    );
  } catch {
    return serverError();
  }
}
