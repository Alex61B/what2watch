"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

export default function DonePage() {
  const params = useParams();
  const router = useRouter();
  const code = params.code as string;

  const [roomName, setRoomName] = useState<string | null>(null);

  useEffect(() => {
    async function fetchName() {
      try {
        const res = await fetch(`/api/rooms/${code}`);
        if (!res.ok) return;
        const data = await res.json();
        setRoomName(data.name ?? null);
      } catch {
        // best-effort; name is decorative on this screen
      }
    }
    fetchName();
  }, [code]);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-gray-950 text-white px-4">
      <div className="w-full max-w-sm text-center space-y-6">
        <div className="space-y-3">
          {roomName && (
            <p className="text-sm text-gray-400">{roomName}</p>
          )}
          <h1 className="text-3xl font-extrabold text-gray-100">No match this time</h1>
          <p className="text-gray-400">
            You both ran out of movies to vote on. Try again with different filters!
          </p>
        </div>

        <button
          onClick={() => router.push(`/room/${code}/setup`)}
          className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 px-6 py-3 text-base font-semibold transition-colors"
        >
          Try Again
        </button>

        <Link
          href="/"
          className="block text-sm text-gray-400 hover:text-gray-200 transition-colors underline underline-offset-2"
        >
          Back to home
        </Link>
      </div>
    </main>
  );
}
