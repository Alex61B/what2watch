"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import MemberList from "@/components/MemberList";
import BrandMark from "@/components/BrandMark";

interface RoomMember {
  id: string;
  displayName: string;
  isHost: boolean;
}

interface RoomState {
  code: string;
  name: string | null;
  status: string;
  streamingServices: string[];
  members: RoomMember[];
  isCurrentUserHost: boolean;
  currentMemberId: string | null;
}

interface PollResponse {
  status: string;
  memberCount: number;
}

const EYEBROW = "text-[11px] font-semibold uppercase tracking-[0.18em] text-faint";
const PRIMARY =
  "w-full rounded-none bg-ink px-6 py-4 text-sm font-semibold uppercase tracking-[0.14em] text-canvas transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:bg-faint/50";

export default function LobbyPage() {
  const router = useRouter();
  const params = useParams();
  const code = params.code as string;

  const [room, setRoom] = useState<RoomState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [memberCount, setMemberCount] = useState<number | null>(null);
  const [joined, setJoined] = useState(false);
  const [joinName, setJoinName] = useState("");
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const shareUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/room/${code}/lobby`
      : `/room/${code}/lobby`;

  const handleRedirect = useCallback(
    (status: string) => {
      if (status === "VOTING") router.replace(`/room/${code}/vote`);
      else if (status === "MATCHED") router.replace(`/room/${code}/match`);
      else if (status === "DONE") router.replace(`/room/${code}/done`);
    },
    [code, router]
  );

  useEffect(() => {
    async function loadRoom() {
      try {
        const res = await fetch(`/api/rooms/${code}`);
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setLoadError(data.error ?? "Failed to load room.");
          return;
        }
        const data: RoomState = await res.json();
        setRoom(data);
        setMemberCount(data.members.length);
        setJoined(data.currentMemberId !== null);
        // Only redirect users who have actually joined (have a session/member).
        // A new user opening the share link for an in-progress room must see the
        // join form first — otherwise they're bounced to /vote with no session
        // and the poll 401s forever ("Loading movies…" never clears).
        if (data.currentMemberId !== null) handleRedirect(data.status);
      } catch {
        setLoadError("Failed to load room.");
      }
    }
    loadRoom();
  }, [code, handleRedirect]);

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/rooms/${code}/poll`, { cache: "no-store" });
        if (!res.ok) return;
        const data: PollResponse = await res.json();
        setMemberCount(data.memberCount);
        handleRedirect(data.status);
      } catch {
        // best-effort; next tick retries
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [code, handleRedirect]);

  // Pre-fill the join name from the signed-in user's profile (still editable). A
  // 401 just means the visitor is anonymous, so the field stays empty.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/user/preferences");
        if (!res.ok) return;
        const data = await res.json();
        // Prefer the last name they joined a room under; the route already falls
        // back to their full account name.
        if (cancelled || typeof data.defaultName !== "string" || !data.defaultName) return;
        setJoinName((prev) => (prev ? prev : data.defaultName));
      } catch {
        // best-effort prefill
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    if (!joinName.trim()) return;
    setJoinLoading(true);
    setJoinError(null);
    try {
      const res = await fetch(`/api/rooms/${code}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: joinName.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to join room.");
      }
      const roomRes = await fetch(`/api/rooms/${code}`);
      if (roomRes.ok) {
        const data: RoomState = await roomRes.json();
        setRoom(data);
        setMemberCount(data.members.length);
        setJoined(true);
        // A mid-session join (room already VOTING) routes to /vote, which shows
        // the "waiting for the host to approve you" screen; a lobby join is a
        // no-op here and stays in the lobby.
        handleRedirect(data.status);
      } else {
        setJoined(true);
      }
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : "Failed to join.");
      setJoinLoading(false);
    }
  }

  async function handleStart() {
    setStarting(true);
    setStartError(null);
    try {
      const res = await fetch(`/api/rooms/${code}/start`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to start.");
      }
      router.push(`/room/${code}/vote`);
    } catch (err) {
      setStartError(err instanceof Error ? err.message : "Failed to start.");
      setStarting(false);
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard blocked — non-fatal
    }
  }

  if (loadError) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas px-4 text-accent">
        <p>{loadError}</p>
      </main>
    );
  }

  if (!room) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas px-4 text-muted">
        <p>Loading room…</p>
      </main>
    );
  }

  const isHost = room.isCurrentUserHost;
  const currentMemberId = room.currentMemberId ?? "";
  const count = memberCount ?? room.members.length;
  const hasEnoughMembers = count >= 2;
  const hasServices = room.streamingServices.length > 0;

  return (
    <main className="min-h-screen bg-canvas text-ink">
      <div className="mx-auto w-full max-w-lg px-5 py-6 sm:px-8">
        <BrandMark size="sm" />

        {/* Header */}
        <div className="mt-12 text-center">
          <p className={EYEBROW}>Room code</p>
          <h1 className="mt-2 font-mono text-5xl font-bold tracking-[0.15em] text-ink">{code}</h1>
          {room.name && <p className="mt-2 font-serif text-xl text-ink">{room.name}</p>}
        </div>

        {!joined ? (
          <section className="mt-10 space-y-4 border border-line bg-surface p-6">
            <h2 className="font-serif text-xl font-bold">Join this room</h2>
            <p className="text-sm text-muted">Enter your name to join the lobby.</p>
            <form onSubmit={handleJoin} className="space-y-3">
              <input
                type="text"
                placeholder="Who's watching tonight?"
                value={joinName}
                onChange={(e) => setJoinName(e.target.value)}
                disabled={joinLoading}
                className="w-full rounded-none border border-line bg-surface px-4 py-3 text-ink placeholder-faint focus:border-ink focus:outline-none disabled:opacity-50"
              />
              {joinError && <p className="text-sm font-medium text-accent">{joinError}</p>}
              <button type="submit" disabled={joinLoading || !joinName.trim()} className={PRIMARY}>
                {joinLoading ? "Joining…" : "Join room →"}
              </button>
            </form>
          </section>
        ) : (
          <>
            <div className="mt-10">
              {isHost ? (
                hasEnoughMembers ? (
                  hasServices ? (
                    <div className="space-y-2 text-center">
                      {startError && <p className="text-sm font-medium text-accent">{startError}</p>}
                      <button type="button" onClick={handleStart} disabled={starting} className={PRIMARY}>
                        {starting ? "Starting…" : "Start voting ›"}
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2 text-center">
                      <p className="text-sm text-muted">Select streaming services before you start.</p>
                      <a href={`/room/${code}/setup`} className={`inline-block ${PRIMARY}`}>
                        Set up &amp; start →
                      </a>
                    </div>
                  )
                ) : (
                  <p className="text-center text-sm text-muted">Waiting for someone to join…</p>
                )
              ) : (
                <p className="text-center text-sm text-muted">
                  {hasEnoughMembers
                    ? "Waiting for the host to start…"
                    : "Waiting for one more person to join…"}
                </p>
              )}
            </div>

            <section className="mt-8 space-y-2">
              <p className={EYEBROW}>Members{memberCount !== null ? ` · ${memberCount}` : ""}</p>
              <MemberList members={room.members} currentMemberId={currentMemberId} />
            </section>

            <section className="mt-8 space-y-3 border border-line bg-surface p-6">
              <h2 className="font-serif text-lg font-bold">Invite others</h2>
              <p className="text-sm text-muted">Share this link so others can join.</p>
              <div className="flex items-center gap-2">
                <span className="flex-1 truncate border border-line bg-surface-soft px-4 py-3 text-sm text-muted">
                  {shareUrl}
                </span>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="shrink-0 rounded-none border border-ink px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink transition-colors hover:bg-ink hover:text-canvas"
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </section>

            {isHost && (
              <p className="mt-6 text-center text-[11px] uppercase tracking-[0.14em] text-faint">
                Want to change settings?{" "}
                <a href={`/room/${code}/setup`} className="text-accent underline-offset-4 hover:underline">
                  Go to setup
                </a>
              </p>
            )}
          </>
        )}
      </div>
    </main>
  );
}
