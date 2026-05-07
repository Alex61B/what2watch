"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import VotingCard from "@/components/VotingCard";

interface Movie {
  tmdbId: string;
  title: string;
  overview: string;
  posterUrl: string;
  year: number;
  rating: number;
  runtime: number | null;
  genreIds: number[];
  watchUrl: string;
  streamingService: string;
}

interface QueueResponse {
  movie: Movie;
  remaining: number;
}

interface VoteResponse {
  matched: boolean;
  movie?: { title: string; [key: string]: unknown };
}

interface PollResponse {
  status: string;
}

export default function VotePage() {
  const router = useRouter();
  const params = useParams();
  const code = params.code as string;

  const [current, setCurrent] = useState<QueueResponse | null | undefined>(
    undefined
  ); // undefined = loading, null = exhausted
  const [submitting, setSubmitting] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stoppedRef = useRef(false);

  const stopPolling = useCallback(() => {
    if (pollingRef.current !== null) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    stoppedRef.current = true;
  }, []);

  const fetchQueue = useCallback(async () => {
    try {
      const res = await fetch(`/api/rooms/${code}/queue`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setFetchError(data.error ?? "Failed to load queue.");
        return;
      }
      const data: QueueResponse | null = await res.json();
      setCurrent(data); // null means exhausted
    } catch {
      setFetchError("Failed to load queue.");
    }
  }, [code]);

  // Initial fetch
  useEffect(() => {
    fetchQueue();
  }, [fetchQueue]);

  // Polling every 3 seconds
  useEffect(() => {
    pollingRef.current = setInterval(async () => {
      if (stoppedRef.current) return;
      try {
        const res = await fetch(`/api/rooms/${code}/poll`);
        if (!res.ok) return;
        const data: PollResponse = await res.json();
        if (data.status === "MATCHED") {
          stopPolling();
          router.replace(`/room/${code}/match`);
        } else if (data.status === "DONE") {
          stopPolling();
          router.replace(`/room/${code}/done`);
        }
      } catch {
        // silently ignore poll errors
      }
    }, 3000);

    return () => {
      if (pollingRef.current !== null) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [code, router, stopPolling]);

  const handleVote = useCallback(
    async (vote: boolean) => {
      if (submitting || current === undefined || current === null) return;
      const tmdbMovieId = current.movie.tmdbId;

      setSubmitting(true);
      try {
        const res = await fetch(`/api/rooms/${code}/votes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tmdbMovieId, vote }),
        });

        if (res.ok) {
          const data: VoteResponse = await res.json();
          if (data.matched) {
            stopPolling();
            router.replace(`/room/${code}/match`);
            return;
          }
        }

        // Fetch next movie regardless of vote response errors
        await fetchQueue();
      } catch {
        // On network error, still try to advance
        await fetchQueue();
      } finally {
        setSubmitting(false);
      }
    },
    [submitting, current, code, router, stopPolling, fetchQueue]
  );

  // Error state
  if (fetchError) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-950 text-white px-4">
        <p className="text-red-400">{fetchError}</p>
      </main>
    );
  }

  // Loading state (initial fetch in progress)
  if (current === undefined) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-950 text-white px-4">
        <p className="text-gray-400">Loading movies…</p>
      </main>
    );
  }

  // Queue exhausted
  if (current === null) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-950 text-white px-4">
        <div className="w-full max-w-sm text-center space-y-6">
          <h1 className="text-2xl font-bold">No more movies</h1>
          <p className="text-gray-400">
            You&apos;ve voted on everything. Waiting for others to finish…
          </p>
          <a
            href={`/room/${code}/lobby`}
            className="inline-block rounded-xl bg-indigo-600 hover:bg-indigo-500 px-6 py-3 text-sm font-semibold transition-colors"
          >
            Back to Lobby
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white px-4 py-8">
      <div className="w-full max-w-sm mx-auto space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold text-gray-200">What2Watch</h1>
          <span className="text-sm text-gray-400">
            {current.remaining} movie{current.remaining !== 1 ? "s" : ""} left
          </span>
        </div>

        {/* Voting card — buttons are inside the component; disable while submitting */}
        <div className={submitting ? "pointer-events-none opacity-60" : ""}>
          <VotingCard movie={current.movie} onVote={handleVote} />
        </div>

        {/* Submission indicator */}
        {submitting && (
          <p className="text-center text-sm text-gray-400">Submitting…</p>
        )}
      </div>
    </main>
  );
}
