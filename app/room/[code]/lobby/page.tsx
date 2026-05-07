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
  status: string;
  streamingServices: string[];
  members: RoomMember[];
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
  const [copied, setCopied] = useState(false);

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
        const res = await fetch(`/api/rooms/${code}/poll`);
        if (!res.ok) return;
        const data: PollResponse = await res.json();
        setMemberCount(data.memberCount);
        handleRedirect(data.status);
      } catch {
        // silently ignore poll errors
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [code, handleRedirect]);

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

  const isHost = room.members.some((m) => m.isHost);
  // Since the GET /api/rooms/[code] route does not return isCurrentUserHost or
  // currentMemberId, we cannot highlight the current user in the list.
  // Pass "" as currentMemberId — known limitation until the API is extended.
  const currentMemberId = "";

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
        </div>

        {/* Status text */}
        <p className="text-center text-gray-400">
          {isHost ? "Ready when you are." : "Waiting for host to start…"}
        </p>

        {/* Member list */}
        <section className="space-y-2">
          <p className="text-xs uppercase tracking-widest text-gray-500 font-semibold">
            Members{memberCount !== null ? ` · ${memberCount}` : ""}
          </p>
          <MemberList members={room.members} currentMemberId={currentMemberId} />
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
      </div>
    </main>
  );
}
