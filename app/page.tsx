"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { isValidRoomCode } from "@/lib/room-code";
import AuthStatus from "@/components/AuthStatus";

export default function LandingPage() {
  const router = useRouter();

  // Create room state
  const [createName, setCreateName] = useState("");
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Join room state
  const [joinCode, setJoinCode] = useState("");
  const [joinName, setJoinName] = useState("");
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  async function handleCreateRoom(e: React.FormEvent) {
    e.preventDefault();
    if (!createName.trim()) {
      setCreateError("Please enter your display name.");
      return;
    }
    setCreateLoading(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: createName.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to create room.");
      }
      const { code } = await res.json();
      router.push(`/room/${code}/setup`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create room.");
    } finally {
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
    if (!joinName.trim()) {
      setJoinError("Please enter your display name.");
      return;
    }
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
      router.push(`/room/${code}/lobby`);
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : "Failed to join room.");
    } finally {
      setJoinLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-gray-950 text-white px-4 py-12">
      {/* Auth status — top-right */}
      <div className="fixed top-4 right-4">
        <AuthStatus />
      </div>

      <div className="w-full max-w-md space-y-10">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-5xl font-bold tracking-tight">What2Watch</h1>
          <p className="text-gray-400 text-lg">Find a movie everyone wants to watch</p>
        </div>

        {/* Create Room */}
        <section className="bg-gray-900 rounded-2xl p-6 space-y-4">
          <h2 className="text-xl font-semibold">Create a Room</h2>
          <p className="text-gray-400 text-sm">Start a new room as the host and invite your friends.</p>
          <form onSubmit={handleCreateRoom} className="space-y-3">
            <input
              type="text"
              placeholder="Your display name"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              disabled={createLoading}
              className="w-full rounded-lg bg-gray-800 border border-gray-700 px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
            />
            {createError && (
              <p className="text-red-400 text-sm">{createError}</p>
            )}
            <button
              type="submit"
              disabled={createLoading}
              className="w-full rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2.5 font-semibold transition-colors"
            >
              {createLoading ? "Creating..." : "Create Room"}
            </button>
          </form>
        </section>

        <div className="flex items-center gap-4">
          <div className="flex-1 h-px bg-gray-800" />
          <span className="text-gray-600 text-sm">or</span>
          <div className="flex-1 h-px bg-gray-800" />
        </div>

        {/* Join Room */}
        <section className="bg-gray-900 rounded-2xl p-6 space-y-4">
          <h2 className="text-xl font-semibold">Join a Room</h2>
          <p className="text-gray-400 text-sm">Enter the room code shared by your host.</p>
          <form onSubmit={handleJoinRoom} className="space-y-3">
            <input
              type="text"
              placeholder="Room code (e.g. BOLD-42)"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              disabled={joinLoading}
              className="w-full rounded-lg bg-gray-800 border border-gray-700 px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 uppercase"
            />
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
              disabled={joinLoading}
              className="w-full rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2.5 font-semibold transition-colors"
            >
              {joinLoading ? "Joining..." : "Join Room"}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
