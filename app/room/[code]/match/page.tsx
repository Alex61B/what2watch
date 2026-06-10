"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import MatchCelebration from "@/components/MatchCelebration";
import MatchResult from "@/components/MatchResult";

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
  runtime?: number | null;
  genreIds?: number[];
  watchUrl?: string;
  streamingService?: string;
  watchProviders?: { providers: WatchProvider[]; link: string | null };
}

interface Member {
  id: string;
  displayName: string;
  isHost?: boolean;
}

interface PollResponse {
  status: string;
  members?: Member[];
  matchedMovie: MatchedMovie | null;
}

// How long the "It's a match." interstitial holds before the result reveals.
const INTERSTITIAL_MS = 1800;

type Phase = "loading" | "intro" | "result";

export default function MatchPage() {
  const params = useParams();
  const code = params.code as string;

  const [phase, setPhase] = useState<Phase>("loading");
  const [movie, setMovie] = useState<MatchedMovie | null>(null);
  const [members, setMembers] = useState<Member[]>([]);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/rooms/${code}/poll`, { cache: "no-store" });
        if (res.ok) {
          const data: PollResponse = await res.json();
          setMovie(data.matchedMovie ?? null);
          setMembers(data.members ?? []);
        }
      } catch {
        // fall through — we still show the interstitial then a fallback
      } finally {
        setPhase("intro");
      }
    }
    load();
  }, [code]);

  // Hold on the interstitial, then reveal the result.
  useEffect(() => {
    if (phase !== "intro") return;
    const id = setTimeout(() => setPhase("result"), INTERSTITIAL_MS);
    return () => clearTimeout(id);
  }, [phase]);

  if (phase !== "result") {
    return <MatchCelebration />;
  }

  if (movie) {
    return <MatchResult code={code} movie={movie} members={members} />;
  }

  // Fallback if the matched movie couldn't be loaded.
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-canvas px-6 text-center text-ink">
      <h1 className="font-serif text-4xl font-bold">
        Tonight&apos;s <span className="italic text-accent">pick.</span>
      </h1>
      <p className="mt-3 text-muted">You found a match! Check your streaming service.</p>
      <Link
        href="/"
        className="mt-6 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink underline-offset-4 hover:underline"
      >
        ↻ Pik again
      </Link>
    </main>
  );
}
