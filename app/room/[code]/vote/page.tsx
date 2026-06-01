"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import VotingCard from "@/components/VotingCard";
import DrainedScreen from "@/components/DrainedScreen";

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

interface PollResponse {
  status: string;
  memberCount: number;
  matchedMovie: unknown;
  rejectedMovieIds?: string[];
  watchedFilter?: boolean;
  currentPosition: number;
  queueVersion: number;
  currentMovie: Movie | null;
  isHost: boolean;
}

const POLL_INTERVAL_MS = 1500;
const VOTE_LOCK_TIMEOUT_MS = 5000;

export default function VotePage() {
  const router = useRouter();
  const params = useParams();
  const code = params.code as string;

  const [state, setState] = useState<PollResponse | null | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [swipeDir, setSwipeDir] = useState<"left" | "right" | null>(null);
  const [markingWatched, setMarkingWatched] = useState(false);

  const stoppedRef = useRef(false);
  const lastVersionRef = useRef<number | null>(null);
  const submittingRef = useRef(false);

  useEffect(() => {
    submittingRef.current = submitting;
  }, [submitting]);

  const pollOnce = useCallback(async () => {
    if (stoppedRef.current) return;
    try {
      const headers: HeadersInit = {};
      if (lastVersionRef.current !== null) {
        headers["If-None-Match"] = `"${lastVersionRef.current}"`;
      }
      const res = await fetch(`/api/rooms/${code}/poll`, { headers });
      if (res.status === 304) return;
      // TEMP DEBUG: a swallowed non-2xx here strands the 2nd user on the waiting screen.
      if (!res.ok) {
        console.warn("[client vote poll] non-ok", { code, status: res.status });
        return;
      }
      const data: PollResponse = await res.json();
      console.log("[client vote poll]", {
        code,
        httpStatus: res.status,
        roomStatus: data.status,
        currentMovieId: data.currentMovie?.tmdbId ?? null,
        currentMovieTitle: data.currentMovie?.title ?? null,
        currentPosition: data.currentPosition,
        queueVersion: data.queueVersion,
      });
      lastVersionRef.current = data.queueVersion;
      setState(data);
      if (data.status === "MATCHED") {
        stoppedRef.current = true;
        router.replace(`/room/${code}/match`);
        return;
      }
      if (data.status === "DONE") {
        stoppedRef.current = true;
        router.replace(`/room/${code}/done`);
      }
    } catch (err) {
      console.warn("[client vote poll] threw", { code, err });
    }
  }, [code, router]);

  // Initial fetch + polling loop. The initial call is scheduled via setTimeout so
  // both invocations are driven by timer callbacks (external system), satisfying
  // react-hooks/set-state-in-effect.
  useEffect(() => {
    const initialId = setTimeout(() => {
      void pollOnce();
    }, 0);
    const intervalId = setInterval(() => {
      void pollOnce();
    }, POLL_INTERVAL_MS);
    return () => {
      clearTimeout(initialId);
      clearInterval(intervalId);
    };
  }, [pollOnce]);

  const animateAndAdvance = useCallback(
    async (direction: "left" | "right", action: () => Promise<void>) => {
      setSwipeDir(direction);
      await Promise.all([
        action(),
        new Promise<void>(resolve => setTimeout(resolve, 300)),
      ]);
      setSwipeDir(null);
    },
    []
  );

  const handleVote = useCallback(
    async (vote: boolean) => {
      if (submittingRef.current || !state?.currentMovie) return;
      const tmdbMovieId = state.currentMovie.tmdbId;

      setSubmitting(true);
      const lockTimeout = setTimeout(() => setSubmitting(false), VOTE_LOCK_TIMEOUT_MS);

      try {
        await animateAndAdvance(vote ? "right" : "left", async () => {
          const res = await fetch(`/api/rooms/${code}/votes`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tmdbMovieId, vote }),
          });
          if (res.ok) {
            const data = await res.json().catch(() => ({}));
            if (data.matched) {
              stoppedRef.current = true;
              router.replace(`/room/${code}/match`);
              return;
            }
          }
          await pollOnce();
        });
      } finally {
        clearTimeout(lockTimeout);
        setSubmitting(false);
      }
    },
    [state, code, router, animateAndAdvance, pollOnce]
  );

  const handleMarkWatched = useCallback(async () => {
    if (markingWatched || !state?.currentMovie) return;
    const tmdbMovieId = state.currentMovie.tmdbId;

    setMarkingWatched(true);
    try {
      await animateAndAdvance("left", async () => {
        await fetch(`/api/rooms/${code}/watched`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tmdbMovieId }),
        });
        await pollOnce();
      });
    } finally {
      setMarkingWatched(false);
    }
  }, [markingWatched, state, code, animateAndAdvance, pollOnce]);

  if (state === undefined) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-950 text-white px-4">
        <p className="text-gray-400">Loading movies…</p>
      </main>
    );
  }

  if (state?.status === "DRAINED") {
    return <DrainedScreen isHost={state.isHost} code={code} />;
  }

  if (!state?.currentMovie) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-950 text-white px-4">
        <p className="text-gray-400">Waiting for the host to start…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white px-4 py-8">
      <div className="w-full max-w-sm mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold text-gray-200">What2Watch</h1>
          <span className="text-sm text-gray-400">
            Position {state.currentPosition + 1}
          </span>
        </div>
        {state.watchedFilter && (
          <p className="text-xs text-indigo-400">Watched filter active</p>
        )}

        <div
          className={submitting || markingWatched ? "pointer-events-none" : ""}
          style={{
            transform:
              swipeDir === "left"
                ? "translateX(-120%) rotate(-10deg)"
                : swipeDir === "right"
                ? "translateX(120%) rotate(10deg)"
                : "none",
            opacity: swipeDir ? 0 : 1,
            transition: "transform 0.3s ease, opacity 0.3s ease",
          }}
        >
          <VotingCard
            key={state.queueVersion}
            movie={state.currentMovie}
            onVote={handleVote}
            disabled={submitting}
          />
        </div>

        <button
          type="button"
          onClick={handleMarkWatched}
          disabled={markingWatched || submitting}
          className="w-full rounded-xl border border-gray-700 bg-transparent hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2.5 text-sm font-medium text-gray-400 hover:text-gray-200 transition-colors"
        >
          {markingWatched ? "Marking…" : "Already seen it"}
        </button>

        {submitting && (
          <p className="text-center text-sm text-gray-400">Submitting…</p>
        )}
      </div>
    </main>
  );
}
