import 'server-only';

import * as cheerio from 'cheerio';
import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';
import { YoutubeTranscript } from 'youtube-transcript';

import type { ImportSourceTypeT } from '@/lib/validations/import';

const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
const USER_AGENT =
  'Mozilla/5.0 (compatible; TravelPlannerBot/1.0; +https://travelplanner.app/bot)';

export class UnsupportedSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedSourceError';
  }
}

export class SourceFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceFetchError';
  }
}

/**
 * Thrown when `safeFetch` refuses to dispatch a request because the target
 * host/IP is in a blocked range (loopback, link-local, private/RFC1918,
 * cloud-metadata, unspecified). Extends `UnsupportedSourceError` so the
 * extract route maps it to a 422 `unsupported_source` without leaking the
 * resolved IP back to the client.
 */
export class SsrfBlockedError extends UnsupportedSourceError {
  constructor(message = 'Target host is not permitted') {
    super(message);
    this.name = 'SsrfBlockedError';
  }
}

// ---------------------------------------------------------------------------
// SSRF guard
// ---------------------------------------------------------------------------

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let acc = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n < 0 || n > 255) return null;
    acc = (acc << 8) + n;
  }
  return acc >>> 0;
}

function isBlockedIPv4(ip: string): boolean {
  const int = ipv4ToInt(ip);
  if (int === null) return true; // malformed → block
  // 0.0.0.0/8 unspecified
  if ((int >>> 24) === 0) return true;
  // 10.0.0.0/8
  if ((int >>> 24) === 10) return true;
  // 127.0.0.0/8 loopback
  if ((int >>> 24) === 127) return true;
  // 169.254.0.0/16 link-local (covers 169.254.169.254 metadata)
  if ((int >>> 16) === ((169 << 8) | 254)) return true;
  // 172.16.0.0/12
  if ((int >>> 24) === 172) {
    const second = (int >>> 16) & 0xff;
    if (second >= 16 && second <= 31) return true;
  }
  // 192.168.0.0/16
  if ((int >>> 16) === ((192 << 8) | 168)) return true;
  // 100.64.0.0/10 CGNAT
  if ((int >>> 24) === 100) {
    const second = (int >>> 16) & 0xff;
    if (second >= 64 && second <= 127) return true;
  }
  // 224.0.0.0/4 multicast
  if ((int >>> 28) === 0xe) return true;
  // 240.0.0.0/4 reserved (incl. 255.255.255.255 broadcast)
  if ((int >>> 28) === 0xf) return true;
  return false;
}

function normalizeIPv6(ip: string): string {
  return ip.toLowerCase().split('%')[0] ?? ip.toLowerCase();
}

function isBlockedIPv6(ipRaw: string): boolean {
  const ip = normalizeIPv6(ipRaw);
  // Unspecified ::
  if (ip === '::' || ip === '::0' || ip === '0:0:0:0:0:0:0:0') return true;
  // Loopback ::1
  if (ip === '::1' || ip === '0:0:0:0:0:0:0:1') return true;
  // IPv4-mapped ::ffff:x.x.x.x
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIPv4(mapped[1]!);
  // Link-local fe80::/10
  if (ip.startsWith('fe8') || ip.startsWith('fe9') || ip.startsWith('fea') || ip.startsWith('feb')) {
    return true;
  }
  // Unique-local fc00::/7 (fc.. or fd..)
  if (ip.startsWith('fc') || ip.startsWith('fd')) return true;
  // Multicast ff00::/8
  if (ip.startsWith('ff')) return true;
  return false;
}

function isBlockedAddress(addr: string, family: number): boolean {
  if (family === 4) return isBlockedIPv4(addr);
  if (family === 6) return isBlockedIPv6(addr);
  return true;
}

async function assertHostIsPublic(hostRaw: string): Promise<void> {
  // URL.hostname returns bracketed form for IPv6 literals (e.g. "[::1]").
  // Strip brackets before passing to isIP / DNS.
  const host =
    hostRaw.startsWith('[') && hostRaw.endsWith(']')
      ? hostRaw.slice(1, -1)
      : hostRaw;
  // Literal IP — check directly, no DNS.
  const literalFamily = isIP(host);
  if (literalFamily !== 0) {
    if (isBlockedAddress(host, literalFamily)) {
      throw new SsrfBlockedError();
    }
    return;
  }
  // Hostname — resolve and check every returned address (DNS rebinding guard).
  let addrs: Array<{ address: string; family: number }>;
  try {
    addrs = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new SsrfBlockedError();
  }
  if (addrs.length === 0) throw new SsrfBlockedError();
  for (const a of addrs) {
    if (isBlockedAddress(a.address, a.family)) {
      throw new SsrfBlockedError();
    }
  }
}

function assertSchemeAllowed(u: URL): void {
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new SsrfBlockedError();
  }
}

/**
 * SSRF-hardened fetch.
 *  - Rejects non-http(s) schemes.
 *  - DNS-resolves the host and rejects if ANY resolved address is in a
 *    loopback / link-local / private / cloud-metadata range.
 *  - Walks redirects manually (max 3 hops), re-validating each Location.
 *  - 10s wall-clock timeout via AbortController.
 *
 * Throws `SsrfBlockedError` when blocked (mapped to 422 `unsupported_source`
 * by the extract route — the resolved IP is never returned to the client).
 */
export async function safeFetch(
  targetUrl: string,
  init?: { headers?: Record<string, string> },
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    let current: URL;
    try {
      current = new URL(targetUrl);
    } catch {
      throw new SsrfBlockedError();
    }
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      assertSchemeAllowed(current);
      await assertHostIsPublic(current.hostname);
      const res = await fetch(current.toString(), {
        headers: init?.headers,
        signal: controller.signal,
        redirect: 'manual',
      });
      // Redirect? Validate the Location and continue.
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc) return res; // no location → return as-is
        let next: URL;
        try {
          next = new URL(loc, current);
        } catch {
          throw new SsrfBlockedError();
        }
        current = next;
        continue;
      }
      // Final response (including 4xx/5xx) — return as-is.
      return res;
    }
    throw new SourceFetchError('Too many redirects');
  } finally {
    clearTimeout(timer);
  }
}

/** Result of classifying + fetching a source. `raw_text` is the LLM input. */
export interface FetchedSource {
  source_type: ImportSourceTypeT;
  raw_text: string;
  /** True if YouTube captions were unavailable and we used a meta fallback. */
  captions_unavailable?: boolean;
}

function classifyUrl(url: URL): ImportSourceTypeT {
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'youtube.com' || host === 'youtu.be' || host === 'm.youtube.com') {
    return 'youtube';
  }
  if (host === 'twitter.com' || host === 'x.com' || host === 'mobile.twitter.com') {
    return 'twitter';
  }
  // v1: Instagram & TikTok are deliberately not scraped — user must paste text.
  if (
    host === 'instagram.com' ||
    host === 'tiktok.com' ||
    host.endsWith('.instagram.com') ||
    host.endsWith('.tiktok.com')
  ) {
    throw new UnsupportedSourceError(
      'Instagram/TikTok URLs are not supported — paste the caption text instead',
    );
  }
  return 'web';
}

function extractYouTubeId(url: URL): string | null {
  if (url.hostname.endsWith('youtu.be')) {
    const id = url.pathname.replace(/^\//, '');
    return id.length > 0 ? id : null;
  }
  // youtube.com/watch?v=...
  const v = url.searchParams.get('v');
  if (v) return v;
  // youtube.com/shorts/<id>
  const shortsMatch = url.pathname.match(/^\/shorts\/([^/]+)/);
  if (shortsMatch) return shortsMatch[1];
  return null;
}

async function httpFetch(targetUrl: string): Promise<string> {
  try {
    const res = await safeFetch(targetUrl, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/json' },
    });
    if (!res.ok) {
      throw new SourceFetchError(`Upstream returned ${res.status}`);
    }
    return await res.text();
  } catch (err) {
    if (err instanceof SourceFetchError) throw err;
    if (err instanceof UnsupportedSourceError) throw err; // includes SsrfBlockedError
    if (err instanceof Error && err.name === 'AbortError') {
      throw new SourceFetchError('Source fetch timed out');
    }
    throw new SourceFetchError('Source fetch failed');
  }
}

function scrapeMeta(html: string): string {
  const $ = cheerio.load(html);
  const title =
    $('meta[property="og:title"]').attr('content') ??
    $('meta[name="twitter:title"]').attr('content') ??
    $('title').first().text();
  const description =
    $('meta[property="og:description"]').attr('content') ??
    $('meta[name="twitter:description"]').attr('content') ??
    $('meta[name="description"]').attr('content') ??
    '';
  const parts = [title, description]
    .map((s) => (s ?? '').trim())
    .filter((s) => s.length > 0);
  return parts.join('\n\n');
}

async function fetchYouTube(url: URL): Promise<FetchedSource> {
  const videoId = extractYouTubeId(url);
  if (!videoId) {
    throw new SourceFetchError('YouTube URL missing video id');
  }
  // Try transcript first.
  try {
    const segments = await YoutubeTranscript.fetchTranscript(videoId);
    const text = segments.map((s) => s.text).join(' ').trim();
    if (text.length > 0) {
      return { source_type: 'youtube', raw_text: text.slice(0, 12_000) };
    }
  } catch {
    // fall through to meta fallback
  }
  // Captions disabled — fall back to watch-page meta scrape.
  const html = await httpFetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`);
  const meta = scrapeMeta(html);
  if (meta.length === 0) {
    throw new SourceFetchError('No transcript or description available for this video');
  }
  return {
    source_type: 'youtube',
    raw_text: meta.slice(0, 12_000),
    captions_unavailable: true,
  };
}

async function fetchTwitter(url: URL): Promise<FetchedSource> {
  const oembedUrl =
    'https://publish.twitter.com/oembed?omit_script=true&url=' +
    encodeURIComponent(url.toString());
  const raw = await httpFetch(oembedUrl);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new SourceFetchError('Twitter oEmbed returned non-JSON response');
  }
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    !('html' in parsed) ||
    typeof (parsed as { html: unknown }).html !== 'string'
  ) {
    throw new SourceFetchError('Twitter oEmbed payload missing html field');
  }
  const $ = cheerio.load((parsed as { html: string }).html);
  const text = $.root().text().replace(/\s+/g, ' ').trim();
  if (text.length === 0) {
    throw new SourceFetchError('Twitter oEmbed contained no text');
  }
  return { source_type: 'twitter', raw_text: text.slice(0, 12_000) };
}

async function fetchWeb(url: URL): Promise<FetchedSource> {
  const html = await httpFetch(url.toString());
  const meta = scrapeMeta(html);
  if (meta.length === 0) {
    throw new SourceFetchError('Page has no readable title/description metadata');
  }
  return { source_type: 'web', raw_text: meta.slice(0, 12_000) };
}

/**
 * Classify + fetch a source.
 *  - Raw text passthrough: source_type='text', raw_text trimmed.
 *  - URL: dispatched by host to YouTube / Twitter / generic web.
 *  - Instagram / TikTok URLs throw UnsupportedSourceError.
 */
export async function fetchSource(input: {
  source_url?: string;
  raw_text?: string;
}): Promise<FetchedSource> {
  if (input.raw_text !== undefined) {
    return { source_type: 'text', raw_text: input.raw_text.slice(0, 12_000) };
  }
  if (input.source_url === undefined) {
    throw new SourceFetchError('No source provided');
  }
  let url: URL;
  try {
    url = new URL(input.source_url);
  } catch {
    throw new UnsupportedSourceError('source_url is not a valid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UnsupportedSourceError('Only http(s) URLs are supported');
  }
  const sourceType = classifyUrl(url);
  switch (sourceType) {
    case 'youtube':
      return fetchYouTube(url);
    case 'twitter':
      return fetchTwitter(url);
    case 'web':
      return fetchWeb(url);
    case 'text':
      // unreachable — only set by the raw_text branch above.
      throw new SourceFetchError('Unexpected text source from URL classifier');
  }
}
