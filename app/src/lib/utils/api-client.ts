// Thin wrapper around fetch() for calling our own /api routes from the client.
// Normalizes error envelopes per SOLUTION_DESIGN §4.

import type { ApiError } from "@/lib/types/domain";

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type JsonInit = Omit<RequestInit, "body" | "headers"> & {
  body?: unknown;
  headers?: Record<string, string>;
};

export async function apiFetch<T>(path: string, init: JsonInit = {}): Promise<T> {
  const { body, headers: extraHeaders, ...rest } = init;
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(extraHeaders ?? {}),
  };
  let payload: BodyInit | undefined;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  const response = await fetch(path, {
    ...rest,
    headers,
    body: payload,
    credentials: "same-origin",
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  const data = text ? safeJson(text) : null;

  if (!response.ok) {
    const envelope = data as ApiError | null;
    const code = envelope?.error?.code ?? "request_failed";
    const message =
      envelope?.error?.message ??
      `Request failed with status ${response.status}`;
    throw new ApiClientError(
      response.status,
      code,
      message,
      envelope?.error?.details,
    );
  }

  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
