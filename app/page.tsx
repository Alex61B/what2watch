"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { isValidRoomCode, generateRoomCode } from "@/lib/room-code";
import AuthStatus from "@/components/AuthStatus";
import BrandMark from "@/components/BrandMark";
import BrandFooter from "@/components/BrandFooter";
import { track } from "@/lib/analytics";

const EYEBROW = "text-[11px] font-semibold uppercase tracking-[0.18em] text-faint";
const FIELD =
  "w-full rounded-none border border-line bg-surface px-4 py-3 text-ink placeholder-faint focus:border-ink focus:outline-none";
const CHIP_BTN =
  "inline-flex items-center justify-center gap-1.5 rounded-none border border-ink px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink transition-colors hover:bg-ink hover:text-canvas";

export default function LandingPage() {
  const router = useRouter();
  const { data: session } = useSession();

  useEffect(() => {
    if (!session?.user?.id) return;
    // Best-effort: link the current room member session to the NextAuth user
    fetch("/api/auth/link-member", { method: "POST" }).catch(() => {});
  }, [session?.user?.id]);

  // One name for the night, shared by create + join.
  const [name, setName] = useState("");

  // Pre-fill the name from the signed-in user's profile (still editable). Only
  // sets when the field is untouched, so it never clobbers what the user typed.
  useEffect(() => {
    if (!session?.user?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/user/preferences");
        if (!res.ok) return;
        const data = await res.json();
        // Prefer the last name they joined a room under; the route already falls
        // back to their full account name.
        if (cancelled || typeof data.defaultName !== "string" || !data.defaultName) return;
        setName((prev) => (prev ? prev : data.defaultName));
      } catch {
        // best-effort prefill
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session?.user?.id]);

  // Pre-generated room code (chosen on the client in an effect to avoid a
  // hydration mismatch). The create call sends it so Copy Link / Share point at
  // the room that will actually be created.
  const [createCode, setCreateCode] = useState<string | null>(null);
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  // Join room state
  const [joinCode, setJoinCode] = useState("");
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setCreateCode(generateRoomCode()), 0);
    return () => clearTimeout(id);
  }, []);

  const joinUrl =
    createCode && typeof window !== "undefined"
      ? `${window.location.origin}/room/${createCode}/lobby`
      : "";

  async function copyCode() {
    if (!createCode) return;
    try {
      await navigator.clipboard.writeText(createCode);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  }

  async function copyLink() {
    if (!joinUrl) return;
    track("feature_used", { feature: "share_link" }, { roomId: createCode ?? undefined });
    try {
      await navigator.clipboard.writeText(joinUrl);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  }

  async function share() {
    if (!joinUrl) return;
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        track("feature_used", { feature: "share_link" }, { roomId: createCode ?? undefined });
        await navigator.share({ title: "Join my movie night on PikFlix", url: joinUrl });
        return;
      }
      await copyLink();
    } catch {
      /* user dismissed the sheet */
    }
  }

  async function handleCreateRoom(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setCreateError("Enter your name first.");
      return;
    }
    setCreateLoading(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: name.trim(), code: createCode }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to create room.");
      }
      const { code } = await res.json();
      track("room_created", undefined, { roomId: code });
      router.push(`/room/${code}/setup`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create room.");
      setCreateLoading(false);
    }
  }

  async function handleJoinRoom(e: React.FormEvent) {
    e.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (!isValidRoomCode(code)) {
      setJoinError("Invalid room code. It should look like BOLD-42.");
      return;
    }
    if (!name.trim()) {
      setJoinError("Enter your name first.");
      return;
    }
    setJoinLoading(true);
    setJoinError(null);
    try {
      const res = await fetch(`/api/rooms/${code}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: name.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to join room.");
      }
      track("room_joined", undefined, { roomId: code });
      router.push(`/room/${code}/lobby`);
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : "Failed to join room.");
      setJoinLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-canvas text-ink">
      <div className="mx-auto flex min-h-screen w-full max-w-xl flex-col px-5 py-6 sm:px-8">
        {/* Top bar */}
        <header className="flex items-center justify-between">
          <BrandMark size="sm" />
          <AuthStatus />
        </header>

        {/* Hero */}
        <div className="mt-16">
          <h1 className="font-serif text-6xl font-bold leading-none tracking-tight sm:text-7xl">
            Let&apos;s Pik<span className="text-accent">…</span>
          </h1>
          <p className="mt-3 text-sm text-muted">less time piking, more time flixing</p>
        </div>

        {/* Name */}
        <div className="mt-10 space-y-2">
          <label htmlFor="yourName" className={EYEBROW}>
            Your name
          </label>
          <input
            id="yourName"
            type="text"
            placeholder="Who's watching tonight?"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={FIELD}
          />
        </div>

        <div className="my-9 h-px bg-ink/80" />

        {/* Create a room */}
        <form onSubmit={handleCreateRoom} className="space-y-4">
          <div>
            <h2 className="font-serif text-2xl font-bold">Create a room</h2>
            <p className="mt-1 text-sm text-muted">
              A room code and invite link are ready to share with your group.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="flex-1 rounded-none border border-line bg-surface-soft px-4 py-3 font-mono text-base font-semibold tracking-[0.2em] text-ink">
              {createCode ?? "········"}
            </span>
            <button type="button" onClick={copyCode} className={CHIP_BTN}>
              {codeCopied ? "Copied" : "Copy code"}
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span className="flex-1 truncate rounded-none border border-line bg-surface px-4 py-3 text-sm text-muted">
              {createCode ? `…/room/${createCode}/lobby` : "…"}
            </span>
            <button
              type="button"
              onClick={copyLink}
              className="inline-flex items-center gap-1.5 rounded-none border border-accent bg-accent px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-accent-ink transition-opacity hover:opacity-90"
            >
              {linkCopied ? "Copied" : "Copy link"}
            </button>
            <button type="button" onClick={share} className={CHIP_BTN}>
              Share
            </button>
          </div>

          {createError && <p className="text-sm font-medium text-accent">{createError}</p>}

          <button
            type="submit"
            disabled={createLoading || !createCode}
            className="w-full rounded-none bg-ink px-6 py-4 text-sm font-semibold uppercase tracking-[0.14em] text-canvas transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:bg-faint/50"
          >
            {createLoading ? "Creating…" : "Create room →"}
          </button>
        </form>

        {/* OR */}
        <div className="my-9 flex items-center gap-4">
          <div className="h-px flex-1 bg-line" />
          <span className={EYEBROW}>or</span>
          <div className="h-px flex-1 bg-line" />
        </div>

        {/* Join a room */}
        <form onSubmit={handleJoinRoom} className="space-y-4">
          <div>
            <h2 className="font-serif text-2xl font-bold">Join a room</h2>
            <p className="mt-1 text-sm text-muted">
              Got a code from a friend? Enter it below to jump in.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="e.g. BOLD-42"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              className={`${FIELD} flex-1 uppercase tracking-[0.2em]`}
            />
            <button
              type="submit"
              disabled={joinLoading}
              className="rounded-none bg-accent px-6 py-3 text-sm font-semibold uppercase tracking-[0.12em] text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {joinLoading ? "Joining…" : "Join →"}
            </button>
          </div>
          {joinError && <p className="text-sm font-medium text-accent">{joinError}</p>}
        </form>

        <div className="my-9 h-px bg-line" />

        <div className="mt-auto pb-2">
          <BrandFooter />
        </div>
      </div>
    </main>
  );
}
