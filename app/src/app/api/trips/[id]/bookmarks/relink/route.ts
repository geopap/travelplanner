import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { UuidSchema } from '@/lib/validations/common';
import { RelinkBodySchema } from '@/lib/validations/places';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { checkTripAccess } from '@/lib/trip-access';
import { checkRateLimit } from '@/lib/rate-limit';
import { resolveOrFetchPlace } from '@/lib/places/resolve';
import { logAudit } from '@/lib/audit';
import {
  badRequest,
  errorResponse,
  forbidden,
  notFound,
  rateLimited,
  serverError,
  unauthorized,
  validationError,
} from '@/lib/api/response';

type RouteCtx = { params: Promise<{ id: string }> };

const RELINK_WINDOW_MS = 60 * 1000; // 60s
const RELINK_MAX = 10;

const RpcResultSchema = z.object({
  bookmarks: z.number().int().min(0),
  itinerary_items: z.number().int().min(0),
});

/**
 * POST /api/trips/[id]/bookmarks/relink  —  B-026.
 *
 * Atomically swap `place_id` on every bookmark + itinerary_item in this trip
 * whose `place_id = from_place_id` to the resolved id of `to_google_place_id`.
 * Sets `place_id_locked = true` so the Trello importer leaves the row alone
 * on subsequent runs. Audit rows are written inside the same RPC transaction.
 */
export async function POST(
  request: NextRequest,
  ctx: RouteCtx,
): Promise<NextResponse> {
  try {
    const { id: tripId } = await ctx.params;
    if (!UuidSchema.safeParse(tripId).success) return notFound();

    const supabase = await createSupabaseServerClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return unauthorized();
    const userId = auth.user.id;

    // Membership + role gate. Non-member → 404 (no enumeration); viewer → 403.
    const access = await checkTripAccess(supabase, tripId, userId, 'editor');
    if (!access.ok) {
      return access.reason === 'forbidden' ? forbidden() : notFound();
    }

    // Per-user rate limit — mirrors places:details:user:<uid> shape.
    const rl = checkRateLimit(
      `bookmarks:relink:user:${userId}`,
      RELINK_WINDOW_MS,
      RELINK_MAX,
    );
    if (!rl.ok) return rateLimited(rl.retryAfterMs);

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return badRequest('Invalid JSON body');
    }
    const parsed = RelinkBodySchema.safeParse(raw);
    if (!parsed.success) return validationError(parsed.error);
    const { from_place_id: fromPlaceId, to_google_place_id: toGooglePlaceId } =
      parsed.data;

    // Resolve/cache target Google place → internal places.id.
    const resolved = await resolveOrFetchPlace(supabase, toGooglePlaceId);
    if (!resolved.ok) {
      if (resolved.reason === 'not_found') {
        return errorResponse('place_not_found', 'Place not found', 404);
      }
      return errorResponse(
        'places_unavailable',
        'Places service unavailable',
        502,
      );
    }
    const toPlaceId = resolved.placeId;

    // Atomic relink — RPC updates both tables + inserts audit rows in one TX.
    // Note: do NOT pass an actor — the RPC derives actor_id from auth.uid()
    // server-side and enforces editor membership in-function.
    const { data: rpcRaw, error: rpcErr } = await supabase.rpc('relink_place', {
      p_trip_id: tripId,
      p_from_place_id: fromPlaceId,
      p_to_place_id: toPlaceId,
    });
    if (rpcErr) {
      // eslint-disable-next-line no-console
      console.error(
        JSON.stringify({
          level: 'relink_rpc_error',
          trip_id: tripId,
          error: rpcErr.message,
        }),
      );
      return serverError();
    }

    const rpcParsed = RpcResultSchema.safeParse(rpcRaw);
    if (!rpcParsed.success) {
      return serverError();
    }
    const { bookmarks, itinerary_items } = rpcParsed.data;

    // 0 rows matched → the from_place_id is not present in this trip.
    // Return 404 (not 200 updated: 0) so the client can surface a clear error.
    if (bookmarks === 0 && itinerary_items === 0) {
      return errorResponse(
        'not_found',
        'No bookmarks or itinerary items in this trip reference that place',
        404,
        { code_detail: 'from_place_not_in_trip' },
      );
    }

    // Summary audit line (per-row durable audit rows are written by the RPC).
    await logAudit({
      actorId: userId,
      action: 'bookmarks_relinked_summary',
      entity: 'bookmarks',
      entityId: null,
      tripId,
      metadata: {
        from_place_id: fromPlaceId,
        to_place_id: toPlaceId,
        to_google_place_id: toGooglePlaceId,
        updated_bookmarks: bookmarks,
        updated_itinerary_items: itinerary_items,
      },
    });

    return NextResponse.json({
      updated: { bookmarks, itinerary_items },
      new_place_id: toPlaceId,
    });
  } catch {
    return serverError();
  }
}
