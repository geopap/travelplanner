import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

// Mock node:dns BEFORE importing the module under test so the safeFetch
// helper resolves through our stub.
const lookupMock = vi.fn();
vi.mock('node:dns', () => ({
  promises: { lookup: (...args: unknown[]) => lookupMock(...args) },
}));

// Import after mocks are registered.
import { safeFetch, SsrfBlockedError, SourceFetchError } from '@/lib/extract/sources';

const originalFetch = global.fetch;

function makeResponse(init: { status?: number; headers?: Record<string, string>; body?: string } = {}): Response {
  return new Response(init.body ?? '', {
    status: init.status ?? 200,
    headers: init.headers,
  });
}

describe('safeFetch SSRF guard', () => {
  beforeEach(() => {
    lookupMock.mockReset();
    global.fetch = vi.fn();
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('rejects non-http(s) schemes', async () => {
    await expect(safeFetch('file:///etc/passwd')).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(safeFetch('gopher://example.com/')).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(safeFetch('ftp://example.com/')).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(safeFetch('data:text/plain,hi')).rejects.toBeInstanceOf(SsrfBlockedError);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects malformed URLs', async () => {
    await expect(safeFetch('not a url')).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it('rejects literal IPv4 loopback', async () => {
    await expect(safeFetch('http://127.0.0.1/x')).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(safeFetch('http://127.1.2.3/x')).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it('rejects literal IPv4 RFC1918 private ranges', async () => {
    await expect(safeFetch('http://10.0.0.1/')).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(safeFetch('http://172.16.0.1/')).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(safeFetch('http://172.31.255.254/')).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(safeFetch('http://192.168.1.1/')).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it('rejects literal IPv4 link-local incl. AWS/GCP metadata', async () => {
    await expect(safeFetch('http://169.254.169.254/latest/meta-data/')).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(safeFetch('http://169.254.0.1/')).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it('rejects literal IPv4 unspecified 0.0.0.0', async () => {
    await expect(safeFetch('http://0.0.0.0/')).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it('rejects literal IPv6 loopback and unspecified', async () => {
    await expect(safeFetch('http://[::1]/')).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(safeFetch('http://[::]/')).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it('rejects literal IPv6 ULA fc00::/7 and link-local fe80::/10', async () => {
    await expect(safeFetch('http://[fc00::1]/')).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(safeFetch('http://[fd00:ec2::254]/')).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(safeFetch('http://[fe80::1]/')).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it('rejects hostnames whose DNS resolves to a blocked IP (rebinding defence)', async () => {
    lookupMock.mockResolvedValueOnce([
      { address: '127.0.0.1', family: 4 },
    ]);
    await expect(safeFetch('http://evil.example/')).rejects.toBeInstanceOf(SsrfBlockedError);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects hostnames where ANY resolved address is blocked', async () => {
    lookupMock.mockResolvedValueOnce([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ]);
    await expect(safeFetch('http://evil.example/')).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it('allows a public hostname and returns the response', async () => {
    lookupMock.mockResolvedValueOnce([
      { address: '93.184.216.34', family: 4 },
    ]);
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeResponse({ status: 200, body: 'ok' }),
    );
    const res = await safeFetch('http://example.com/');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  it('returns 4xx/5xx of the final hop as-is (no redirect)', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]);
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeResponse({ status: 503 }),
    );
    const res = await safeFetch('http://example.com/');
    expect(res.status).toBe(503);
  });

  it('walks redirects manually and re-validates each Location', async () => {
    // Hop 1: public → 302 to internal
    lookupMock.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]);
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeResponse({ status: 302, headers: { location: 'http://127.0.0.1/admin' } }),
    );
    await expect(safeFetch('http://example.com/')).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it('follows a public→public redirect up to MAX_REDIRECTS', async () => {
    lookupMock
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
      .mockResolvedValueOnce([{ address: '93.184.216.35', family: 4 }]);
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        makeResponse({ status: 301, headers: { location: 'http://example.org/' } }),
      )
      .mockResolvedValueOnce(makeResponse({ status: 200, body: 'final' }));
    const res = await safeFetch('http://example.com/');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('final');
  });

  it('aborts on too many redirects', async () => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeResponse({ status: 302, headers: { location: 'http://example.com/loop' } }),
    );
    await expect(safeFetch('http://example.com/')).rejects.toBeInstanceOf(SourceFetchError);
  });

  it('rejects when DNS lookup fails', async () => {
    lookupMock.mockRejectedValueOnce(new Error('ENOTFOUND'));
    await expect(safeFetch('http://nope.invalid/')).rejects.toBeInstanceOf(SsrfBlockedError);
  });
});
