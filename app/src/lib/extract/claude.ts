import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';

import {
  ExtractedPayload,
  type ExtractedPayloadT,
} from '@/lib/validations/import';

/**
 * Claude Haiku 4.5 — locked model id per SOLUTION_DESIGN.md §B-021.4.
 * Snapshot-pinned id, NOT the shorthand alias, so the behaviour is
 * reproducible across model rotations.
 */
const MODEL_ID = 'claude-haiku-4-5-20251001';

/** Locked tool-use schema. Mirrors §B-021.4 in SOLUTION_DESIGN.md. */
const RECORD_EXTRACTION_TOOL: Tool = {
  name: 'record_extraction',
  description:
    'Record the places and tips extracted from a travel social-media post. ' +
    'Only return what is explicitly mentioned in the source — never invent ' +
    'venues, addresses, or details that are not in the input.',
  input_schema: {
    type: 'object',
    required: ['places', 'tips'],
    properties: {
      places: {
        type: 'array',
        items: {
          type: 'object',
          required: ['name', 'category', 'why'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 200 },
            category: {
              type: 'string',
              enum: [
                'restaurant',
                'cafe',
                'bar',
                'attraction',
                'shop',
                'viewpoint',
                'other',
              ],
            },
            why: { type: 'string', minLength: 1, maxLength: 500 },
          },
        },
      },
      tips: {
        type: 'array',
        items: { type: 'string', minLength: 1, maxLength: 500 },
      },
    },
  },
};

const SYSTEM_PROMPT =
  'You extract concrete places and practical travel tips from social-media ' +
  'posts (YouTube transcripts/descriptions, X/Twitter, blog posts, pasted ' +
  'captions). Always call the record_extraction tool. Only include venues, ' +
  'attractions, restaurants, viewpoints, or shops that are explicitly named ' +
  'in the source. Do not infer or guess. Tips are short, actionable bullet ' +
  'points; do not echo the entire source. Return empty arrays if nothing of ' +
  'value is present.';

export class LlmExtractionError extends Error {
  public readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'LlmExtractionError';
    this.cause = cause;
  }
}

let cachedClient: Anthropic | null = null;

function getClient(): Anthropic {
  if (cachedClient) return cachedClient;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new LlmExtractionError(
      'ANTHROPIC_API_KEY is not configured on the server',
    );
  }
  cachedClient = new Anthropic({ apiKey: key });
  return cachedClient;
}

interface ExtractFromTextOptions {
  /** Optional context label appended to the user message (e.g. source URL). */
  contextLabel?: string;
}

/**
 * Call Claude Haiku with forced tool-use and return the parsed payload.
 * Throws `LlmExtractionError` on any failure (network, no tool block,
 * schema mismatch). Callers should treat that as a 502.
 */
export async function extractFromText(
  text: string,
  options: ExtractFromTextOptions = {},
): Promise<ExtractedPayloadT> {
  if (text.trim().length === 0) {
    return { places: [], tips: [] };
  }

  const client = getClient();
  const userContent =
    (options.contextLabel ? `Source: ${options.contextLabel}\n\n` : '') +
    text.slice(0, 12_000);

  let response;
  try {
    response = await client.messages.create({
      model: MODEL_ID,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: [RECORD_EXTRACTION_TOOL],
      tool_choice: { type: 'tool', name: 'record_extraction' },
      messages: [{ role: 'user', content: userContent }],
    });
  } catch (err) {
    throw new LlmExtractionError('LLM request failed', err);
  }

  const toolBlock = response.content.find((b) => b.type === 'tool_use');
  if (!toolBlock || toolBlock.type !== 'tool_use') {
    throw new LlmExtractionError('LLM response missing tool_use block');
  }

  const parsed = ExtractedPayload.safeParse(toolBlock.input);
  if (!parsed.success) {
    throw new LlmExtractionError(
      'LLM tool_use payload failed schema validation',
      parsed.error,
    );
  }
  return parsed.data;
}

/**
 * Wrapper with a single retry. The /extract route uses this so a transient
 * network blip surfaces as 502 only after two attempts. Retries are NOT
 * applied to schema-validation failures (the second call would produce the
 * same shape) — those bubble up immediately.
 */
export async function extractWithRetry(
  text: string,
  options: ExtractFromTextOptions = {},
): Promise<ExtractedPayloadT> {
  try {
    return await extractFromText(text, options);
  } catch (err) {
    if (err instanceof LlmExtractionError) {
      // Only retry transport-level failures. Schema-validation failures
      // identify themselves by having a ZodError cause; skip retry for those.
      const causeName =
        err.cause instanceof Error ? err.cause.name : undefined;
      if (causeName === 'ZodError' || err.message.includes('schema')) {
        throw err;
      }
    }
    return await extractFromText(text, options);
  }
}
