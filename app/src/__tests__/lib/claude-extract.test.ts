/**
 * B-021 — Unit tests for `@/lib/extract/claude` (LLM wrapper).
 *
 * Mocks the Anthropic SDK entirely so no network call is ever made.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const createMock = vi.fn();
vi.mock('@anthropic-ai/sdk', () => {
  class Anthropic {
    public messages: { create: (args: unknown) => unknown };
    constructor(_opts: { apiKey: string }) {
      this.messages = { create: (args: unknown) => createMock(args) };
    }
  }
  return { default: Anthropic };
});

import { extractFromText, LlmExtractionError } from '@/lib/extract/claude';

const validToolBlock = {
  type: 'tool_use',
  name: 'record_extraction',
  input: {
    places: [
      { name: 'Cafe X', category: 'cafe', why: 'Featured in the video' },
    ],
    tips: ['Bring cash'],
  },
};

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  createMock.mockReset();
});

describe('extractFromText', () => {
  it('returns empty payload for whitespace-only input without calling LLM', async () => {
    const out = await extractFromText('   ');
    expect(out).toEqual({ places: [], tips: [] });
    expect(createMock).not.toHaveBeenCalled();
  });

  it('forces tool_use with record_extraction tool', async () => {
    createMock.mockResolvedValue({ content: [validToolBlock] });
    await extractFromText('some text', { contextLabel: 'https://x.com/y' });
    expect(createMock).toHaveBeenCalledTimes(1);
    const args = createMock.mock.calls[0][0] as {
      tool_choice: { type: string; name: string };
      tools: Array<{ name: string; input_schema: { properties: unknown } }>;
      messages: Array<{ role: string; content: string }>;
      model: string;
    };
    expect(args.tool_choice).toEqual({ type: 'tool', name: 'record_extraction' });
    expect(args.tools).toHaveLength(1);
    expect(args.tools[0].name).toBe('record_extraction');
    // schema shape sanity
    const props = args.tools[0].input_schema.properties as {
      places: unknown;
      tips: unknown;
    };
    expect(props.places).toBeDefined();
    expect(props.tips).toBeDefined();
    // contextLabel is prepended to the user content
    expect(args.messages[0].content).toContain('https://x.com/y');
    // pinned snapshot model id
    expect(args.model).toMatch(/^claude-haiku-4-5-/);
  });

  it('parses tool_use input and returns ExtractedPayload', async () => {
    createMock.mockResolvedValue({ content: [validToolBlock] });
    const out = await extractFromText('hi');
    expect(out.places).toHaveLength(1);
    expect(out.places[0]).toMatchObject({
      name: 'Cafe X',
      category: 'cafe',
    });
    expect(out.tips).toEqual(['Bring cash']);
  });

  it('throws LlmExtractionError when no tool_use block present', async () => {
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: 'no tool call' }],
    });
    await expect(extractFromText('hi')).rejects.toBeInstanceOf(
      LlmExtractionError,
    );
  });

  it('throws LlmExtractionError when tool_use input fails schema', async () => {
    createMock.mockResolvedValue({
      content: [
        {
          type: 'tool_use',
          name: 'record_extraction',
          input: { places: [{ bogus: true }], tips: [] },
        },
      ],
    });
    await expect(extractFromText('hi')).rejects.toBeInstanceOf(
      LlmExtractionError,
    );
  });

  it('throws LlmExtractionError when ANTHROPIC_API_KEY is missing', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    // The lazy client cache may already hold a client from earlier tests in
    // this run; reset the module to force re-evaluation.
    vi.resetModules();
    const mod = await import('@/lib/extract/claude');
    await expect(mod.extractFromText('hi')).rejects.toBeInstanceOf(
      mod.LlmExtractionError,
    );
  });

  it('wraps SDK transport error as LlmExtractionError', async () => {
    createMock.mockRejectedValue(new Error('network down'));
    await expect(extractFromText('hi')).rejects.toBeInstanceOf(
      LlmExtractionError,
    );
  });
});
