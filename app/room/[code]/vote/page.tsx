"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import VotingCard from "@/components/VotingCard";
import DrainedScreen from "@/components/DrainedScreen";
import RoomCodeBar from "@/components/RoomCodeBar";
import HostFilterEditor from "@/components/HostFilterEditor";
import JoinRequestModal from "@/components/JoinRequestModal";
import { startDwell, pauseDwell, resumeDwell, finalizeDwell, type DwellState } from "@/lib/dwell";
import { track } from "@/lib/analytics";

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
  // The member's own current card, fetched from /queue. Each member advances
  // independently — the card only changes on this member's own action, so another
  // person's "nope" never moves the card you're looking at. undefined = loading,
  // null = the member has voted on everything (their deck is exhausted).
  const [card, setCard] = useState<Movie | null | undefined>(undefined);
  const [remaining, setRemaining] = useState(0);

  const stoppedRef = useRef(false);
  const lastVersionRef = useRef<number | null>(null);
  const submittingRef = useRef(false);
  const dwellRef = useRef<DwellState | null>(null);

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

  // Fetch THIS member's current card. Called on mount and after the member's own
  // vote/seen action only — never on a background poll — so others' votes can't
  // shuffle the card under them.
  const fetchCard = useCallback(async () => {
    try {
      const res = await fetch(`/api/rooms/${code}/queue`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (data === null) {
        setCard(null);
        setRemaining(0);
        return;
      }
      setCard(data.movie ?? null);
      setRemaining(typeof data.remaining === "number" ? data.remaining : 0);
    } catch {
      // best-effort; the effect below retries while the deck is empty
    }
  }, [code]);

  // Load the card once the member is an admitted voter, and keep retrying while
  // the deck reads empty (recovers from a transient fetch miss and picks up a
  // host requeue). A populated card is left untouched here — it only changes on
  // this member's own action.
  useEffect(() => {
    if (!state || state.pendingApproval || state.notAdmitted) return;
    if (state.status !== "VOTING") return;
    if (card !== undefined && card !== null) return;
    // Defer (like the poll loop) so the fetch's setState isn't called
    // synchronously inside the effect body.
    const id = setTimeout(() => void fetchCard(), 0);
    return () => clearTimeout(id);
  }, [state, card, fetchCard]);

  // Visibility-aware dwell timer for the current card → feeds card_decided. Restarts
  // when the displayed movie changes; pauses while the tab is hidden so a backgrounded
  // tab never inflates the dwell the recommender will train on.
  const cardId = card?.tmdbId;
  useEffect(() => {
    if (!cardId) {
      dwellRef.current = null;
      return;
    }
    dwellRef.current = startDwell(Date.now(), document.visibilityState === "visible");
    const onVis = () => {
      if (!dwellRef.current) return;
      dwellRef.current =
        document.visibilityState === "hidden"
          ? pauseDwell(dwellRef.current, Date.now())
          : resumeDwell(dwellRef.current, Date.now());
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [cardId]);

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
      if (submittingRef.current || !card) return;
      const tmdbMovieId = card.tmdbId;
      const wasSeen = seenMovieId === tmdbMovieId;

      // Emit the dwell/decision signal for this card before it advances.
      if (dwellRef.current) {
        const { dwellMs, dwellCapped } = finalizeDwell(dwellRef.current, Date.now());
        track(
          "card_decided",
          { movieId: tmdbMovieId, vote, dwellMs, ...(dwellCapped ? { dwellCapped: true } : {}) },
          { roomId: code },
        );
        dwellRef.current = null;
      }

      setSubmitting(true);
      const lockTimeout = setTimeout(() => setSubmitting(false), VOTE_LOCK_TIMEOUT_MS);

      try {
        const submit = (async () => {
          // Skip-reruns OFF: record the seen-it flag alongside the vote.
          if (wasSeen && !state?.watchedFilter) void recordSeen(tmdbMovieId);
          const res = await fetch(`/api/rooms/${code}/votes`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tmdbMovieId, vote }),
          });
          if (res.ok) {
            const data = await res.json().catch(() => ({}));
            if (data.matched) {
              track("room_matched", { movieId: tmdbMovieId }, { roomId: code });
              stoppedRef.current = true;
              router.replace(`/room/${code}/match`);
              return;
            }
          }
          // Advance only THIS member to their next card.
          await fetchCard();
        })();
        await Promise.all([submit, sleep(EXIT_ANIM_MS)]);
      } finally {
        clearTimeout(lockTimeout);
        setSubmitting(false);
        setSeenMovieId(null);
        if (!stoppedRef.current) setCardKey((k) => k + 1);
      }
    },
    [card, seenMovieId, state?.watchedFilter, code, router, fetchCard, recordSeen]
  );

  // Skip-reruns ON: marking seen records it (removed from every deck via /queue's
  // room-wide watched exclusion) and advances this member to their next card.
  const handleRemoveSeen = useCallback(async () => {
    if (markingWatched || !card) return;
    const tmdbMovieId = card.tmdbId;
    setMarkingWatched(true);
    try {
      await fetch(`/api/rooms/${code}/watched`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tmdbMovieId }),
      });
      await fetchCard();
    } finally {
      setMarkingWatched(false);
      setSeenMovieId(null);
      if (!stoppedRef.current) setCardKey((k) => k + 1);
    }
  }, [markingWatched, card, code, fetchCard]);

  const handleToggleSeen = useCallback(() => {
    if (!card) return;
    if (state?.watchedFilter) {
      void handleRemoveSeen();
    } else {
      setSeenMovieId((prev) => (prev === card.tmdbId ? null : card.tmdbId));
    }
  }, [card, state?.watchedFilter, handleRemoveSeen]);

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

  if (!state) {
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

  // Host-only overlays, shared by the voting and "caught up" screens so the host
  // can always approve joiners and broaden the filters.
  const hostOverlays = state.isHost ? (
    <>
      <HostFilterEditor
        code={code}
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        onApplied={handleFiltersApplied}
      />
      <JoinRequestModal
        pendingMembers={state.pendingMembers ?? []}
        onApprove={handleApproval}
        approvingId={approvingId}
      />
    </>
  ) : null;

  if (card === undefined) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas px-4 text-muted">
        <p>Loading movies…</p>
      </main>
    );
  }

  if (card === null) {
    return (
      <main className="flex h-[100dvh] flex-col items-center justify-center bg-canvas px-4 text-ink">
        <div className="w-full max-w-sm space-y-4 text-center">
          <h1 className="font-serif text-3xl font-bold">You&apos;re all caught up</h1>
          <p className="text-muted">
            You&apos;ve voted on every movie. Hang tight while the others finish
            {state.isHost ? " — or broaden the filters to add more." : "…"}
          </p>
          {state.isHost && (
            <button
              type="button"
              onClick={() => setEditorOpen(true)}
              className="inline-block rounded-none bg-ink px-6 py-3 text-sm font-semibold uppercase tracking-wide text-canvas transition-opacity hover:opacity-90"
            >
              Broaden the filters
            </button>
          )}
        </div>
        {hostOverlays}
      </main>
    );
  }

  const members = state.members ?? [];
  const watching = members.length || state.memberCount;
  const seen = seenMovieId === card.tmdbId;

  return (
    <main className="flex h-[100dvh] flex-col bg-canvas text-ink">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col overflow-hidden px-5 py-3 sm:px-6">
        <RoomCodeBar
          code={code}
          onEditFilters={state.isHost ? () => setEditorOpen(true) : undefined}
        />

        {/* Progress / roster row */}
        <div className="mt-3 flex shrink-0 items-center justify-between gap-3">
          <div className="min-w-0">
            <p className={EYEBROW}>{remaining} left to pik</p>
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
          <ul className="mt-2 max-h-32 shrink-0 space-y-1 overflow-y-auto border border-line bg-surface px-4 py-3">
            {members.map((m) => (
              <li key={m.id} className="text-sm text-muted">
                {m.displayName}
                {m.isHost && " · Host"}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 min-h-0 flex-1">
          <VotingCard
            key={cardKey}
            movie={card}
            onVote={handleVote}
            disabled={submitting || markingWatched}
            seen={seen}
            onToggleSeen={handleToggleSeen}
            skipReruns={Boolean(state.watchedFilter)}
          />
        </div>
      </div>

      {hostOverlays}
    </main>
  );
}
