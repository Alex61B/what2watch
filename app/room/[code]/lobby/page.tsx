"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import MemberList from "@/components/MemberList";

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
      if (status === "VOTING") {
        router.replace(`/room/${code}/vote`);
      } else if (status === "MATCHED") {
        router.replace(`/room/${code}/match`);
      } else if (status === "DONE") {
        router.replace(`/room/${code}/done`);
      }
    },
    [code, router]
  );

  // Initial room fetch
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
        handleRedirect(data.status);
        setRoom(data);
        setMemberCount(data.members.length);
        setJoined(data.currentMemberId !== null);
      } catch {
        setLoadError("Failed to load room.");
      }
    }
    loadRoom();
  }, [code, handleRedirect]);

  // Polling every 3 seconds
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/rooms/${code}/poll`, { cache: "no-store" });
        // TEMP DEBUG: a swallowed non-2xx here is why the 2nd user can be stuck.
        if (!res.ok) {
          console.warn("[client lobby poll] non-ok", { code, status: res.status });
          return;
        }
        const data: PollResponse = await res.json();
        console.log("[client lobby poll]", {
          code,
          httpStatus: res.status,
          roomStatus: data.status,
          memberCount: data.memberCount,
        });
        setMemberCount(data.memberCount);
        handleRedirect(data.status);
      } catch (err) {
        console.warn("[client lobby poll] threw", { code, err });
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [code, handleRedirect]);

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
      // Re-fetch room with the new session cookie now set
      const roomRes = await fetch(`/api/rooms/${code}`);
      if (roomRes.ok) {
        const data: RoomState = await roomRes.json();
        // TEMP DEBUG: currentMemberId !== null confirms the per-room cookie took.
        console.log("[client lobby join] after join", {
          code,
          currentMemberId: data.currentMemberId,
          roomStatus: data.status,
        });
        setRoom(data);
        setMemberCount(data.members.length);
      }
      setJoined(true);
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
      // fallback: browser didn't allow clipboard access
    }
  }

  if (loadError) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-950 text-white px-4">
        <p className="text-red-400">{loadError}</p>
      </main>
    );
  }

  if (!room) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-950 text-white px-4">
        <p className="text-gray-400">Loading room…</p>
      </main>
    );
  }

  const isHost = room.isCurrentUserHost;
  const currentMemberId = room.currentMemberId ?? "";
  const count = memberCount ?? room.members.length;
  const hasEnoughMembers = count >= 2;
  const hasServices = room.streamingServices.length > 0;

  return (
    <main className="min-h-screen bg-gray-950 text-white px-4 py-12">
      <div className="w-full max-w-lg mx-auto space-y-8">
        {/* Header */}
        <div className="space-y-1 text-center">
          <p className="text-xs uppercase tracking-widest text-gray-500 font-semibold">
            Room code
          </p>
          <h1 className="text-5xl font-bold font-mono tracking-widest text-indigo-400">
            {code}
          </h1>
          {room.name && (
            <p className="text-lg font-medium text-gray-200">{room.name}</p>
          )}
        </div>

        {!joined ? (
          /* Join form — visitor has no session for this room yet */
          <section className="bg-gray-900 rounded-2xl p-6 space-y-4">
            <h2 className="text-lg font-semibold">Join this room</h2>
            <p className="text-gray-400 text-sm">
              Enter your name to join the lobby.
            </p>
            <form onSubmit={handleJoin} className="space-y-3">
              <input
                type="text"
                placeholder="Your display name"
                value={joinName}
                onChange={(e) => setJoinName(e.target.value)}
                disabled={joinLoading}
                className="w-full rounded-lg bg-gray-800 border border-gray-700 px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
              />
              {joinError && (
                <p className="text-red-400 text-sm">{joinError}</p>
              )}
              <button
                type="submit"
                disabled={joinLoading || !joinName.trim()}
                className="w-full rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2.5 font-semibold transition-colors"
              >
                {joinLoading ? "Joining…" : "Join Room"}
              </button>
            </form>
          </section>
        ) : (
          <>
            {/* Status / CTA */}
            {isHost ? (
              hasEnoughMembers ? (
                hasServices ? (
                  <div className="space-y-2 text-center">
                    {startError && (
                      <p className="text-red-400 text-sm">{startError}</p>
                    )}
                    <button
                      type="button"
                      onClick={handleStart}
                      disabled={starting}
                      className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed px-6 py-3.5 text-lg font-semibold transition-colors"
                    >
                      {starting ? "Starting…" : "Start Voting"}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2 text-center">
                    <p className="text-gray-400 text-sm">
                      Select streaming services before you start.
                    </p>
                    <a
                      href={`/room/${code}/setup`}
                      className="inline-block rounded-xl bg-indigo-600 hover:bg-indigo-500 px-6 py-3.5 text-lg font-semibold transition-colors"
                    >
                      Set up &amp; start →
                    </a>
                  </div>
                )
              ) : (
                <p className="text-center text-gray-400">
                  Waiting for someone to join…
                </p>
              )
            ) : (
              <p className="text-center text-gray-400">
                {hasEnoughMembers
                  ? "Waiting for the host to start…"
                  : "Waiting for one more person to join…"}
              </p>
            )}

            {/* Member list */}
            <section className="space-y-2">
              <p className="text-xs uppercase tracking-widest text-gray-500 font-semibold">
                Members{memberCount !== null ? ` · ${memberCount}` : ""}
              </p>
              <MemberList
                members={room.members}
                currentMemberId={currentMemberId}
              />
            </section>

            {/* Share link */}
            <section className="bg-gray-900 rounded-2xl p-6 space-y-3">
              <h2 className="text-lg font-semibold">Invite others</h2>
              <p className="text-gray-400 text-sm">
                Share this link so others can join.
              </p>
              <div className="flex items-center gap-3">
                <span className="flex-1 truncate rounded-lg bg-gray-800 border border-gray-700 px-4 py-2.5 text-sm text-gray-300 font-mono">
                  {shareUrl}
                </span>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="shrink-0 rounded-lg bg-gray-700 hover:bg-gray-600 px-4 py-2.5 text-sm font-medium transition-colors"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
            </section>

            {/* Host-only: Go to Setup link */}
            {isHost && (
              <p className="text-center text-sm text-gray-500">
                Want to change settings?{" "}
                <a
                  href={`/room/${code}/setup`}
                  className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2 transition-colors"
                >
                  Go to Setup
                </a>
              </p>
            )}
          </>
        )}
      </div>
    </main>
  );
}
