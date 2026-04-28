import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

export type ApiErrorCode =
  | 'bad_request'
  | 'validation_error'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limit_exceeded'
  | 'gone'
  | 'token_expired'
  | 'token_revoked'
  | 'server_error'
  | 'date_shrink_blocked'
  | 'email_taken_or_invalid'
  | 'invalid_credentials'
  | 'name_mismatch'
  | 'invalid_query'
  | 'places_unavailable'
  | 'place_not_found'
  | 'invalid_place_id'
  | 'invite_required'
  | 'invite_invalid'
  | 'invite_expired'
  | 'invite_used'
  | 'invite_revoked'
  | 'invite_email_mismatch'
  | 'bookmark_exists'
  | 'place_not_cached'
  | 'transport_payload_required'
  | 'transport_cost_on_item_forbidden'
  | 'accommodation_dates_outside_trip'
  | 'accommodation_dates_invalid'
  | 'accommodation_cost_currency_required'
  | 'cannot_demote_sole_owner'
  | 'owner_self_delete_forbidden'
  | 'not_a_member'
  | 'member_not_found';

export type ApiErrorDetails = Record<string, unknown>;

export function errorResponse(
  code: ApiErrorCode,
  message: string,
  status: number,
  details?: ApiErrorDetails,
  extraHeaders?: HeadersInit,
): NextResponse {
  return NextResponse.json(
    { error: { code, message, details: details ?? {} } },
    { status, headers: extraHeaders },
  );
}

export function unauthorized(): NextResponse {
  return errorResponse('unauthorized', 'Unauthorized', 401);
}

export function forbidden(): NextResponse {
  return errorResponse('forbidden', 'Forbidden', 403);
}

export function notFound(): NextResponse {
  return errorResponse('not_found', 'Not found', 404);
}

export function validationError(err: ZodError): NextResponse {
  const flat = err.flatten();
  return errorResponse('validation_error', 'Invalid request', 400, {
    fieldErrors: flat.fieldErrors,
    formErrors: flat.formErrors,
  });
}

export function badRequest(message: string, details?: ApiErrorDetails): NextResponse {
  return errorResponse('bad_request', message, 400, details);
}

export function conflict(message: string, details?: ApiErrorDetails): NextResponse {
  return errorResponse('conflict', message, 409, details);
}

export function rateLimited(retryAfterMs: number): NextResponse {
  const retrySec = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return errorResponse(
    'rate_limit_exceeded',
    'Too many requests',
    429,
    { retry_after_seconds: retrySec },
    { 'Retry-After': String(retrySec) },
  );
}

export function serverError(): NextResponse {
  return errorResponse('server_error', 'Internal server error', 500);
}
