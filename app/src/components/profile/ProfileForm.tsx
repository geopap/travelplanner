"use client";

// B-017 — Profile management form.
//
// Fetches the current profile (GET /api/profile) and lets the user
// update full_name and avatar. Avatar bytes upload directly to the
// Supabase Storage `avatars` bucket from the browser; only the public
// URL is patched through /api/profile.
//
// Replace pattern (per SOLUTION_DESIGN §B-017):
//   1. Validate file (MIME + size) client-side.
//   2. Remove any existing avatars/{user_id}/avatar.{jpg,png,webp}.
//   3. Upload new file at avatars/{user_id}/avatar.<ext> with upsert.
//   4. getPublicUrl → PATCH /api/profile { avatar_url }.

import { useEffect, useRef, useState } from "react";
import { apiFetch, ApiClientError } from "@/lib/utils/api-client";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  FormField,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
  dangerButtonClass,
} from "@/components/ui/FormField";
import { SkeletonLine } from "@/components/Skeletons";
import { InitialsAvatar } from "./InitialsAvatar";
import type { Profile, ProfileUpdateResult } from "@/lib/types/profile";

interface ProfileFormProps {
  userId: string;
}

const AVATAR_BUCKET = "avatars";
const MAX_BYTES = 2 * 1024 * 1024;

const MIME_TO_EXT: Readonly<Record<string, "jpg" | "png" | "webp">> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const ALL_EXTS = ["jpg", "png", "webp"] as const;

type Toast =
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

type LoadState =
  | { status: "loading" }
  | { status: "ready"; profile: Profile }
  | { status: "error"; message: string };

function storagePath(userId: string, ext: "jpg" | "png" | "webp"): string {
  return `${userId}/avatar.${ext}`;
}

function allCandidatePaths(userId: string): string[] {
  return ALL_EXTS.map((e) => storagePath(userId, e));
}

export function ProfileForm({ userId }: ProfileFormProps) {
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [fullName, setFullName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [savingName, setSavingName] = useState(false);

  const [fileError, setFileError] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [deletingAvatar, setDeletingAvatar] = useState(false);

  const [toast, setToast] = useState<Toast | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initial fetch.
  useEffect(() => {
    let active = true;
    async function run() {
      try {
        const profile = await apiFetch<Profile>("/api/profile", {
          method: "GET",
        });
        if (!active) return;
        setLoad({ status: "ready", profile });
        setFullName(profile.full_name ?? "");
      } catch (err) {
        if (!active) return;
        const message =
          err instanceof ApiClientError
            ? err.message
            : "Could not load your profile. Please try again.";
        setLoad({ status: "error", message });
      }
    }
    run();
    return () => {
      active = false;
    };
  }, []);

  // Object URL lifecycle.
  useEffect(() => {
    if (!pendingFile) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(pendingFile);
    setPreviewUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [pendingFile]);

  // Auto-dismiss toasts after 4s.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  if (load.status === "loading") {
    return (
      <div className="grid gap-6">
        <div className="flex items-center gap-4">
          <SkeletonLine className="h-16 w-16 rounded-full" />
          <div className="flex-1 grid gap-2">
            <SkeletonLine className="h-4 w-48" />
            <SkeletonLine className="h-3 w-32" />
          </div>
        </div>
        <SkeletonLine className="h-10 w-full" />
        <SkeletonLine className="h-10 w-32" />
      </div>
    );
  }

  if (load.status === "error") {
    return (
      <div
        role="alert"
        className="rounded-2xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/50 p-5 text-sm text-red-700 dark:text-red-300"
      >
        {load.message}
      </div>
    );
  }

  const profile = load.profile;

  function refreshProfile(next: Partial<ProfileUpdateResult>): void {
    setLoad((prev) => {
      if (prev.status !== "ready") return prev;
      return {
        status: "ready",
        profile: {
          ...prev.profile,
          ...(next.full_name !== undefined
            ? { full_name: next.full_name }
            : {}),
          ...(next.avatar_url !== undefined
            ? { avatar_url: next.avatar_url }
            : {}),
          ...(next.updated_at ? { updated_at: next.updated_at } : {}),
        },
      };
    });
  }

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>): void {
    setFileError(null);
    const file = e.target.files?.[0] ?? null;
    if (!file) {
      setPendingFile(null);
      return;
    }
    const ext = MIME_TO_EXT[file.type];
    if (!ext) {
      setFileError("Unsupported format. Use JPG, PNG, or WebP.");
      setPendingFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    if (file.size > MAX_BYTES) {
      setFileError("Image is larger than 2MB.");
      setPendingFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setPendingFile(file);
  }

  async function onSaveName(): Promise<void> {
    setNameError(null);
    const trimmed = fullName.trim();
    if (trimmed.length === 0) {
      setNameError("Name cannot be empty.");
      return;
    }
    if (trimmed.length > 80) {
      setNameError("Name must be 80 characters or fewer.");
      return;
    }
    setSavingName(true);
    try {
      const result = await apiFetch<ProfileUpdateResult>("/api/profile", {
        method: "PATCH",
        body: { full_name: trimmed },
      });
      refreshProfile(result);
      setFullName(result.full_name ?? "");
      setToast({ kind: "success", message: "Name updated." });
    } catch (err) {
      const message =
        err instanceof ApiClientError
          ? err.message
          : "Could not update your name.";
      setNameError(message);
      setToast({ kind: "error", message });
    } finally {
      setSavingName(false);
    }
  }

  async function onUploadAvatar(): Promise<void> {
    if (!pendingFile) return;
    const ext = MIME_TO_EXT[pendingFile.type];
    if (!ext) {
      setFileError("Unsupported format. Use JPG, PNG, or WebP.");
      return;
    }
    setUploading(true);
    setFileError(null);
    try {
      const supabase = createSupabaseBrowserClient();
      const newPath = storagePath(userId, ext);
      const candidates = allCandidatePaths(userId);

      // Step 1: best-effort delete of any existing avatar (any extension).
      // Ignore errors — bucket may have nothing, RLS will reject other paths.
      const otherPaths = candidates.filter((p) => p !== newPath);
      if (otherPaths.length > 0) {
        await supabase.storage.from(AVATAR_BUCKET).remove(otherPaths);
      }

      // Step 2: upload (with upsert in case the same extension exists).
      const { error: uploadError } = await supabase.storage
        .from(AVATAR_BUCKET)
        .upload(newPath, pendingFile, {
          upsert: true,
          contentType: pendingFile.type,
          cacheControl: "3600",
        });
      if (uploadError) {
        throw new Error(uploadError.message || "Upload failed");
      }

      // Step 3: resolve public URL.
      const { data: pub } = supabase.storage
        .from(AVATAR_BUCKET)
        .getPublicUrl(newPath);
      const baseUrl = pub.publicUrl;
      if (!baseUrl || !baseUrl.startsWith("https://")) {
        throw new Error("Could not resolve avatar URL.");
      }

      // Step 4: PATCH the profile with the clean URL (no query string) so
      // `profiles.avatar_url` in the DB is canonical and cache-busting works
      // correctly for every session that loads it later.
      const result = await apiFetch<ProfileUpdateResult>("/api/profile", {
        method: "PATCH",
        body: { avatar_url: baseUrl },
      });

      // Apply the cache-buster only to local display state so the current
      // session's browser doesn't show stale bytes from the previous upload.
      const cacheBustedForDisplay = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}t=${Date.now()}`;
      refreshProfile({ ...result, avatar_url: cacheBustedForDisplay });
      setPendingFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setToast({ kind: "success", message: "Avatar updated." });
    } catch (err) {
      const message =
        err instanceof ApiClientError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Could not upload avatar.";
      setFileError(message);
      setToast({ kind: "error", message });
    } finally {
      setUploading(false);
    }
  }

  async function onDeleteAvatar(): Promise<void> {
    setDeletingAvatar(true);
    setFileError(null);
    try {
      const supabase = createSupabaseBrowserClient();
      // Best-effort delete of any extension.
      await supabase.storage
        .from(AVATAR_BUCKET)
        .remove(allCandidatePaths(userId));

      const result = await apiFetch<ProfileUpdateResult>("/api/profile", {
        method: "PATCH",
        body: { avatar_url: null },
      });
      refreshProfile(result);
      setPendingFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setToast({ kind: "success", message: "Avatar removed." });
    } catch (err) {
      const message =
        err instanceof ApiClientError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Could not remove avatar.";
      setFileError(message);
      setToast({ kind: "error", message });
    } finally {
      setDeletingAvatar(false);
    }
  }

  const displayedAvatarUrl = previewUrl ?? profile.avatar_url;
  const hasAvatar = Boolean(profile.avatar_url);
  const nameChanged = fullName.trim() !== (profile.full_name ?? "").trim();

  return (
    <div className="grid gap-8">
      {/* Avatar section */}
      <section
        aria-labelledby="avatar-heading"
        className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 sm:p-6"
      >
        <h2
          id="avatar-heading"
          className="text-base font-semibold text-zinc-900 dark:text-zinc-50"
        >
          Avatar
        </h2>
        <p className="mt-1 text-xs text-zinc-500">
          JPG, PNG, or WebP. Up to 2MB.
        </p>

        <div className="mt-5 flex flex-col sm:flex-row sm:items-start gap-5">
          <div>
            <InitialsAvatar
              name={profile.full_name}
              email={profile.email}
              avatarUrl={displayedAvatarUrl}
              size={96}
            />
          </div>
          <div className="flex-1 grid gap-3">
            <div>
              <label
                htmlFor="avatar-file"
                className="block text-sm font-medium text-zinc-800 dark:text-zinc-200 mb-1.5"
              >
                Choose image
              </label>
              <input
                ref={fileInputRef}
                id="avatar-file"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={onPickFile}
                className="block text-sm text-zinc-700 dark:text-zinc-300 file:mr-3 file:rounded-full file:border file:border-zinc-300 dark:file:border-zinc-700 file:bg-white dark:file:bg-zinc-950 file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-zinc-50 dark:hover:file:bg-zinc-800"
              />
              {fileError && (
                <p
                  role="alert"
                  className="mt-1.5 text-xs text-red-600 dark:text-red-400"
                >
                  {fileError}
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onUploadAvatar}
                disabled={!pendingFile || uploading || deletingAvatar}
                className={primaryButtonClass}
              >
                {uploading ? "Uploading…" : "Upload avatar"}
              </button>
              {pendingFile && (
                <button
                  type="button"
                  onClick={() => {
                    setPendingFile(null);
                    setFileError(null);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                  disabled={uploading}
                  className={secondaryButtonClass}
                >
                  Cancel
                </button>
              )}
              {hasAvatar && !pendingFile && (
                <button
                  type="button"
                  onClick={onDeleteAvatar}
                  disabled={deletingAvatar || uploading}
                  className={dangerButtonClass}
                >
                  {deletingAvatar ? "Removing…" : "Remove avatar"}
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Name section */}
      <section
        aria-labelledby="name-heading"
        className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 sm:p-6"
      >
        <h2
          id="name-heading"
          className="text-base font-semibold text-zinc-900 dark:text-zinc-50"
        >
          Display name
        </h2>
        <p className="mt-1 text-xs text-zinc-500">
          Visible to other members of trips you join.
        </p>
        <div className="mt-5 grid gap-4">
          <FormField
            id="full-name"
            label="Full name"
            hint="Up to 80 characters."
            error={nameError}
          >
            <input
              id="full-name"
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              maxLength={80}
              className={inputClass}
              autoComplete="name"
            />
          </FormField>
          <div>
            <button
              type="button"
              onClick={onSaveName}
              disabled={savingName || !nameChanged}
              className={primaryButtonClass}
            >
              {savingName ? "Saving…" : "Save name"}
            </button>
          </div>
        </div>
        <dl className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-zinc-500">
          <div>
            <dt className="font-medium text-zinc-700 dark:text-zinc-300">
              Email
            </dt>
            <dd className="truncate">{profile.email}</dd>
          </div>
        </dl>
      </section>

      {/* Toast (aria-live) */}
      <p
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {toast?.message ?? ""}
      </p>
      {toast && (
        <div
          aria-hidden="true"
          className={
            "fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full text-sm shadow-lg " +
            (toast.kind === "success"
              ? "bg-emerald-600 text-white"
              : "bg-red-600 text-white")
          }
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
