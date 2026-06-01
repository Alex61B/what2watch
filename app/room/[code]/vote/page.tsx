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

interface RoomMember {
  id: string;
  displayName: string;
  isHost: boolean;
}

interface PollResponse {
  status: string;
  name: string | null;
  memberCount: number;
  members: RoomMember[];
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
// Minimum time the fly-off animation is allowed to play before the next card mounts.
const EXIT_ANIM_MS = 300;

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export default function VotePage() {
  const router = useRouter();
  const params = useParams();
  const code = params.code as string;

  const [state, setState] = useState<PollResponse | null | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [markingWatched, setMarkingWatched] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(false);
  // Bumped after each resolved vote so the VotingCard remounts fresh and centered,
  // even when the room stays on the same movie (a YES with no match yet).
  const [cardKey, setCardKey] = useState(0);

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
      if (!res.ok) {
        console.warn("[client vote poll] non-ok", { code, status: res.status });
        return;
      }
      const data: PollResponse = await res.json();
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

  const handleVote = useCallback(
    async (vote: boolean) => {
      if (submittingRef.current || !state?.currentMovie) return;
      const tmdbMovieId = state.currentMovie.tmdbId;

      setSubmitting(true);
      const lockTimeout = setTimeout(() => setSubmitting(false), VOTE_LOCK_TIMEOUT_MS);

      try {
        const submit = (async () => {
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
        })();
        // Let the card's fly-off animation play before remounting the next card.
        await Promise.all([submit, sleep(EXIT_ANIM_MS)]);
      } finally {
        clearTimeout(lockTimeout);
        setSubmitting(false);
        if (!stoppedRef.current) setCardKey(k => k + 1);
      }
    },
    [state, code, router, pollOnce]
  );

  const handleMarkWatched = useCallback(async () => {
    if (markingWatched || !state?.currentMovie) return;
    const tmdbMovieId = state.currentMovie.tmdbId;

    setMarkingWatched(true);
    try {
      await fetch(`/api/rooms/${code}/watched`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tmdbMovieId }),
      });
      await pollOnce();
    } finally {
      setMarkingWatched(false);
      if (!stoppedRef.current) setCardKey(k => k + 1);
    }
  }, [markingWatched, state, code, pollOnce]);

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

  const members = state.members ?? [];
  const watching = members.length || state.memberCount;

  return (
    <main className="min-h-screen bg-gray-950 text-white px-4 py-8">
      <div className="w-full max-w-sm mx-auto space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-gray-200">What2Watch</h1>
            {state.name && (
              <p className="truncate text-sm text-gray-400">{state.name}</p>
            )}
          </div>
          <span className="shrink-0 text-sm text-gray-400">
            Position {state.currentPosition + 1}
          </span>
        </div>

        {/* Live participant roster — collapsible to stay out of the way. */}
        <div className="rounded-xl bg-gray-900">
          <button
            type="button"
            onClick={() => setRosterOpen(o => !o)}
            aria-expanded={rosterOpen}
            className="flex w-full items-center justify-between px-4 py-2.5 text-sm text-gray-300 hover:text-white transition-colors"
          >
            <span className="font-medium">{watching} watching</span>
            <span aria-hidden className="text-gray-500">{rosterOpen ? "▲" : "▼"}</span>
          </button>
          {rosterOpen && members.length > 0 && (
            <ul className="space-y-1 px-4 pb-3">
              {members.map(m => (
                <li key={m.id} className="text-sm text-gray-400">
                  {m.displayName}
                  {m.isHost && " (Host)"}
                </li>
              ))}
            </ul>
          )}
        </div>

        {state.watchedFilter && (
          <p className="text-xs text-indigo-400">Watched filter active</p>
        )}

        <VotingCard
          key={cardKey}
          movie={state.currentMovie}
          onVote={handleVote}
          disabled={submitting}
        />

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
