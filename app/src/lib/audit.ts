import 'server-only';
import { createSupabaseServiceClient } from './supabase/service';

export type AuditAction =
  | 'signup'
  | 'signin'
  | 'signin_failed'
  | 'signout'
  | 'password_reset_request'
  | 'password_reset_complete'
  | 'create'
  | 'update'
  | 'delete'
  | 'invitation_created'
  | 'invitation_accepted'
  | 'invitation_revoked'
  | 'places_searched'
  | 'places_search_cache_hit'
  | 'places_rate_limited'
  | 'place_details_fetched'
  | 'place_photo_proxied'
  | 'signup_completed'
  | 'signup_rejected'
  | 'signup_compensation_failed'
  | 'signup_orphan_unflagged'
  | 'bookmark_created'
  | 'bookmark_updated'
  | 'bookmark_deleted';

export interface AuditParams {
  actorId: string | null;
  action: AuditAction;
  entity: string;
  entityId?: string | null;
  tripId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Structured console log + best-effort insert into audit_log.
 *
 * - PII (emails, tokens, payment amounts) MUST NOT be placed in metadata.
 * - Writes use the service-role client to bypass RLS.
 * - Failures are swallowed and logged — audit writes must never break a
 *   successful mutation.
 */
export async function logAudit(params: AuditParams): Promise<void> {
  const line = {
    ts: new Date().toISOString(),
    level: 'audit',
    actor_id: params.actorId,
    action: params.action,
    entity: params.entity,
    entity_id: params.entityId ?? null,
    trip_id: params.tripId ?? null,
    metadata: params.metadata ?? {},
  };

  // Structured console log first — always captured even if DB write fails.
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(line));

  try {
    const svc = createSupabaseServiceClient();
    const { error } = await svc.from('audit_log').insert({
      actor_id: params.actorId,
      action: params.action,
      entity: params.entity,
      entity_id: params.entityId ?? null,
      trip_id: params.tripId ?? null,
      metadata: params.metadata ?? {},
    });
    if (error) {
      // eslint-disable-next-line no-console
      console.warn(JSON.stringify({ level: 'audit_warn', error: error.message }));
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      JSON.stringify({
        level: 'audit_warn',
        error: err instanceof Error ? err.message : 'unknown',
      }),
    );
  }
}
