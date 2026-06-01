"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import MatchCelebration from "@/components/MatchCelebration";

interface WatchProvider {
  name: string;
  logoUrl: string;
}

interface MatchedMovie {
  title: string;
  posterUrl: string;
  year: number;
  rating: number;
  overview: string;
  watchUrl?: string;
  streamingService?: string;
  watchProviders?: { providers: WatchProvider[]; link: string | null };
}

interface PollResponse {
  status: string;
  name: string | null;
  memberCount: number;
  matchedMovie: MatchedMovie | null;
}

export default function MatchPage() {
  const params = useParams();
  const code = params.code as string;

  const [matchedMovie, setMatchedMovie] = useState<MatchedMovie | null | undefined>(undefined);
  const [roomName, setRoomName] = useState<string | null>(null);

  useEffect(() => {
    async function fetchMatch() {
      try {
        const res = await fetch(`/api/rooms/${code}/poll`);
        if (!res.ok) {
          setMatchedMovie(null);
          return;
        }
        const data: PollResponse = await res.json();
        setMatchedMovie(data.matchedMovie ?? null);
        setRoomName(data.name ?? null);
      } catch {
        setMatchedMovie(null);
      }
    }
    fetchMatch();
  }, [code]);

  if (matchedMovie === undefined) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-950 text-white px-4">
        <p className="text-gray-400">Loading your match…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-gray-950 text-white px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        {roomName && (
          <p className="text-center text-sm text-gray-400">from {roomName}</p>
        )}
        {matchedMovie ? (
          <MatchCelebration movie={matchedMovie} />
        ) : (
          <div className="rounded-2xl bg-white p-8 shadow-lg text-center text-gray-800">
            <h1 className="text-3xl font-extrabold text-green-500 mb-3">It&apos;s a Match!</h1>
            <p className="text-gray-600">You found a match! Check your streaming service.</p>
          </div>
        )}

        <div className="text-center">
          <Link
            href="/"
            className="text-sm text-gray-400 hover:text-gray-200 transition-colors underline underline-offset-2"
          >
            Back to home
          </Link>
        </div>
      </div>
    </main>
  );
}
