/**
 * B-035 — Host detection for the import paste form.
 *
 * Instagram and TikTok don't expose post text to anonymous server-side
 * fetches, so we pre-empt the post-submit `unsupported_source` error by
 * detecting these hostnames in the URL field and showing a caption-mode
 * banner before the user submits.
 *
 * The host list is locked per B-035 AC #1:
 *   instagram.com, www.instagram.com,
 *   tiktok.com, www.tiktok.com, vm.tiktok.com.
 *
 * Matching is case-insensitive; invalid URLs return false (the URL field's
 * own validation surfaces those separately).
 */

const CAPTION_ONLY_HOSTS: ReadonlySet<string> = new Set([
  'instagram.com',
  'www.instagram.com',
  'tiktok.com',
  'www.tiktok.com',
  'vm.tiktok.com',
]);

/**
 * Returns true when `value` parses as a URL whose hostname is one of the
 * Instagram/TikTok hosts we know we can't fetch server-side. Defensive
 * against malformed input — never throws.
 */
export function isCaptionOnlyHost(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  try {
    const u = new URL(trimmed);
    return CAPTION_ONLY_HOSTS.has(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export const CAPTION_ONLY_HOSTS_FOR_TEST = CAPTION_ONLY_HOSTS;
