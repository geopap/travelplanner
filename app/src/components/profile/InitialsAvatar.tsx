"use client";

// B-017 — Avatar primitive used everywhere a user is shown.
//
// Renders an <img> when `avatarUrl` is provided and non-empty. Otherwise
// falls back to a deterministic colored circle with 1–2 initials derived
// from `name` (or the first letter of `email` if no name). The background
// color is hashed from the same source string so the same user always
// gets the same color across the app.

import { useMemo, useState } from "react";

interface InitialsAvatarProps {
  /** User's full name. Used for initials and color hashing. */
  name: string | null;
  /** Email — fallback when name is empty. */
  email?: string;
  /** Public URL of the uploaded avatar, if any. */
  avatarUrl?: string | null;
  /** Pixel diameter of the avatar. Default 40. */
  size?: number;
  /** Optional className for outer wrapper. */
  className?: string;
}

// Curated palette of accessible foreground/background pairs. WCAG AA on
// light backgrounds; selection is deterministic per user.
const PALETTE: ReadonlyArray<{ bg: string; fg: string }> = [
  { bg: "#fee2e2", fg: "#991b1b" },
  { bg: "#ffedd5", fg: "#9a3412" },
  { bg: "#fef3c7", fg: "#854d0e" },
  { bg: "#dcfce7", fg: "#166534" },
  { bg: "#cffafe", fg: "#155e75" },
  { bg: "#dbeafe", fg: "#1e40af" },
  { bg: "#ede9fe", fg: "#5b21b6" },
  { bg: "#fce7f3", fg: "#9d174d" },
  { bg: "#e2e8f0", fg: "#1f2937" },
  { bg: "#d1fae5", fg: "#065f46" },
];

function hashString(input: string): number {
  // Simple 32-bit FNV-1a — deterministic, no crypto needed.
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function pickColor(seed: string): { bg: string; fg: string } {
  const idx = hashString(seed) % PALETTE.length;
  return PALETTE[idx] ?? PALETTE[0]!;
}

function deriveInitials(name: string | null, email?: string): string {
  const trimmed = (name ?? "").trim();
  if (trimmed.length > 0) {
    const parts = trimmed.split(/\s+/).filter(Boolean);
    if (parts.length === 1) {
      return (parts[0] ?? "").slice(0, 2).toUpperCase();
    }
    const first = parts[0]?.[0] ?? "";
    const last = parts[parts.length - 1]?.[0] ?? "";
    return (first + last).toUpperCase();
  }
  const e = (email ?? "").trim();
  if (e.length > 0) return e[0]!.toUpperCase();
  return "?";
}

export function InitialsAvatar({
  name,
  email,
  avatarUrl,
  size = 40,
  className,
}: InitialsAvatarProps) {
  const [imgFailed, setImgFailed] = useState(false);

  const seed = useMemo(() => {
    const s = (name ?? "").trim() || (email ?? "").trim() || "?";
    return s.toLowerCase();
  }, [name, email]);

  const { bg, fg } = useMemo(() => pickColor(seed), [seed]);
  const initials = useMemo(() => deriveInitials(name, email), [name, email]);

  const dimension = `${size}px`;
  const fontSize = Math.max(11, Math.round(size * 0.42));

  const altText = (name?.trim() || email?.trim() || "User") + " avatar";

  if (avatarUrl && avatarUrl.length > 0 && !imgFailed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt={altText}
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        onError={() => setImgFailed(true)}
        className={
          "inline-block rounded-full object-cover bg-zinc-200 dark:bg-zinc-800 " +
          (className ?? "")
        }
        style={{ width: dimension, height: dimension }}
      />
    );
  }

  return (
    <span
      role="img"
      aria-label={altText}
      className={
        "inline-flex items-center justify-center rounded-full font-medium select-none " +
        (className ?? "")
      }
      style={{
        width: dimension,
        height: dimension,
        backgroundColor: bg,
        color: fg,
        fontSize: `${fontSize}px`,
        lineHeight: 1,
      }}
    >
      {initials}
    </span>
  );
}
