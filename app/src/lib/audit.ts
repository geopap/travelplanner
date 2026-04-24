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
  | 'delete';

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
      // audit_log table may not exist in Sprint 1 (baseline migration includes
      // profiles..itinerary_items, not audit_log). Swallow silently if so.
      if (error.code !== '42P01') {
        // eslint-disable-next-line no-console
        console.warn(JSON.stringify({ level: 'audit_warn', error: error.message }));
      }
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
