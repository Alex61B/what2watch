"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import VotingCard from "@/components/VotingCard";
import DrainedScreen from "@/components/DrainedScreen";
import RoomCodeBar from "@/components/RoomCodeBar";
import HostFilterEditor from "@/components/HostFilterEditor";

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

interface PendingMember {
  id: string;
  displayName: string;
}

interface PollResponse {
  status: string;
  name: string | null;
  memberCount: number;
  members: RoomMember[];
  pendingMembers: PendingMember[];
  pendingApproval: boolean;
  notAdmitted: boolean;
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
const EXIT_ANIM_MS = 300;
const EYEBROW = "text-[11px] font-semibold uppercase tracking-[0.18em] text-faint";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export default function VotePage() {
  const router = useRouter();
  const params = useParams();
  const code = params.code as string;

  const [state, setState] = useState<PollResponse | null | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [markingWatched, setMarkingWatched] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  // Tracks which movie the user has locally flagged "seen" (so the flag resets
  // automatically when the card changes).
  const [seenMovieId, setSeenMovieId] = useState<string | null>(null);
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
      const res = await fetch(`/api/rooms/${code}/poll`, { headers, cache: "no-store" });
      if (res.status === 304) return;
      if (!res.ok) return;
      const data: PollResponse = await res.json();
      lastVersionRef.current =
        data.pendingApproval || data.notAdmitted ? null : data.queueVersion;
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
    } catch {
      // best-effort; next tick retries
    }
  }, [code, router]);

  useEffect(() => {
    const initialId = setTimeout(() => void pollOnce(), 0);
    const intervalId = setInterval(() => void pollOnce(), POLL_INTERVAL_MS);
    return () => {
      clearTimeout(initialId);
      clearInterval(intervalId);
    };
  }, [pollOnce]);

  // Record the seen-it flag (without removing the movie) — used when "Skip the
  // Reruns" is OFF and the user has checked the box before voting.
  const recordSeen = useCallback(
    async (tmdbMovieId: string) => {
      try {
        await fetch(`/api/rooms/${code}/watched`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tmdbMovieId }),
        });
      } catch {
        // non-fatal — recording the seen flag is best-effort
      }
    },
    [code]
  );

  const handleVote = useCallback(
    async (vote: boolean) => {
      if (submittingRef.current || !state?.currentMovie) return;
      const tmdbMovieId = state.currentMovie.tmdbId;
      const wasSeen = seenMovieId === tmdbMovieId;

      setSubmitting(true);
      const lockTimeout = setTimeout(() => setSubmitting(false), VOTE_LOCK_TIMEOUT_MS);

      try {
        const submit = (async () => {
          // Skip-reruns OFF: record the seen-it flag alongside the vote.
          if (wasSeen && !state.watchedFilter) void recordSeen(tmdbMovieId);
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
        await Promise.all([submit, sleep(EXIT_ANIM_MS)]);
      } finally {
        clearTimeout(lockTimeout);
        setSubmitting(false);
        setSeenMovieId(null);
        if (!stoppedRef.current) setCardKey((k) => k + 1);
      }
    },
    [state, seenMovieId, code, router, pollOnce, recordSeen]
  );

  // Skip-reruns ON: marking seen removes the movie for the whole room (the
  // server advances the shared queue).
  const handleRemoveSeen = useCallback(async () => {
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
      setSeenMovieId(null);
      if (!stoppedRef.current) setCardKey((k) => k + 1);
    }
  }, [markingWatched, state, code, pollOnce]);

  const handleToggleSeen = useCallback(() => {
    const movie = state?.currentMovie;
    if (!movie) return;
    if (state?.watchedFilter) {
      void handleRemoveSeen();
    } else {
      setSeenMovieId((prev) => (prev === movie.tmdbId ? null : movie.tmdbId));
    }
  }, [state, handleRemoveSeen]);

  const handleApproval = useCallback(
    async (memberId: string, action: "accept" | "reject") => {
      if (approvingId) return;
      setApprovingId(memberId);
      try {
        await fetch(`/api/rooms/${code}/approvals`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ memberId, action }),
        });
        await pollOnce();
      } finally {
        setApprovingId(null);
      }
    },
    [approvingId, code, pollOnce]
  );

  const handleFiltersApplied = useCallback(() => {
    lastVersionRef.current = null; // force a fresh, non-304 poll
    void pollOnce();
  }, [pollOnce]);

  if (state === undefined) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas px-4 text-muted">
        <p>Loading movies…</p>
      </main>
    );
  }

  if (state?.notAdmitted) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-canvas px-4 text-ink">
        <div className="w-full max-w-sm space-y-4 text-center">
          <h1 className="font-serif text-3xl font-bold">Not admitted</h1>
          <p className="text-muted">The host didn&apos;t admit you to this room.</p>
          <Link
            href="/"
            className="inline-block rounded-none bg-ink px-6 py-3 text-sm font-semibold uppercase tracking-wide text-canvas"
          >
            Back to home
          </Link>
        </div>
      </main>
    );
  }

  if (state?.pendingApproval) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-canvas px-4 text-ink">
        <div className="w-full max-w-sm space-y-3 text-center">
          <h1 className="font-serif text-3xl font-bold">Waiting for the host…</h1>
          <p className="text-muted">You&apos;ll join the voting as soon as the host approves you.</p>
        </div>
      </main>
    );
  }

  if (state?.status === "DRAINED") {
    return <DrainedScreen isHost={state.isHost} code={code} />;
  }

  if (!state?.currentMovie) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas px-4 text-muted">
        <p>Waiting for the host to start…</p>
      </main>
    );
  }

  const members = state.members ?? [];
  const watching = members.length || state.memberCount;
  const seen = seenMovieId === state.currentMovie.tmdbId;

  return (
    <main className="min-h-screen bg-canvas text-ink">
      <div className="mx-auto w-full max-w-md px-5 py-6 sm:px-6">
        <RoomCodeBar
          code={code}
          onEditFilters={state.isHost ? () => setEditorOpen(true) : undefined}
        />

        {/* Progress / roster row */}
        <div className="mt-6 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className={EYEBROW}>Movie {state.currentPosition + 1}</p>
            <div className="mt-1 h-[3px] w-16 bg-accent" />
          </div>
          <button
            type="button"
            onClick={() => setRosterOpen((o) => !o)}
            aria-expanded={rosterOpen}
            className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted hover:text-ink"
          >
            {watching} watching {rosterOpen ? "▲" : "▼"}
          </button>
        </div>

        {rosterOpen && members.length > 0 && (
          <ul className="mt-2 space-y-1 border border-line bg-surface px-4 py-3">
            {members.map((m) => (
              <li key={m.id} className="text-sm text-muted">
                {m.displayName}
                {m.isHost && " · Host"}
              </li>
            ))}
          </ul>
        )}

        {/* Host-only: pending join requests */}
        {state.isHost && (state.pendingMembers?.length ?? 0) > 0 && (
          <div className="mt-3 space-y-2 border border-accent bg-accent/5 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">
              Join request{state.pendingMembers.length > 1 ? "s" : ""}
            </p>
            <ul className="space-y-2">
              {state.pendingMembers.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm text-ink">{p.displayName}</span>
                  <span className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => handleApproval(p.id, "accept")}
                      disabled={approvingId !== null}
                      className="rounded-none bg-ink px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-canvas disabled:opacity-40"
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      onClick={() => handleApproval(p.id, "reject")}
                      disabled={approvingId !== null}
                      className="rounded-none border border-ink px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink disabled:opacity-40"
                    >
                      Reject
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-5">
          <VotingCard
            key={cardKey}
            movie={state.currentMovie}
            onVote={handleVote}
            disabled={submitting || markingWatched}
            seen={seen}
            onToggleSeen={handleToggleSeen}
            skipReruns={Boolean(state.watchedFilter)}
          />
        </div>
      </div>

      {state.isHost && (
        <HostFilterEditor
          code={code}
          open={editorOpen}
          onClose={() => setEditorOpen(false)}
          onApplied={handleFiltersApplied}
        />
      )}
    </main>
  );
}
