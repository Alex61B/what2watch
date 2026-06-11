"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import RoomCodeBar from "@/components/RoomCodeBar";
import FilterControls from "@/components/FilterControls";
import { ServiceId } from "@/lib/tmdb";
import { track } from "@/lib/analytics";

interface RoomFilters {
  genres?: number[];
  maxRuntime?: number;
  minRating?: number;
  maxRating?: number;
  depth?: number;
}

interface RoomMember {
  id: string;
  displayName: string;
  isHost: boolean;
}

interface RoomState {
  status: "LOBBY" | "VOTING" | "MATCHED" | "DONE";
  name: string | null;
  streamingServices: ServiceId[];
  filters: RoomFilters | null;
  watchedFilter: boolean;
  members: RoomMember[];
  isCurrentUserHost: boolean;
  currentMemberId: string | null;
}

interface SetupPollResponse {
  status: string;
  members?: RoomMember[];
  memberCount: number;
}

const EYEBROW = "text-[11px] font-semibold uppercase tracking-[0.18em] text-faint";

// A few playful suggestions for naming the night — one is picked at random on
// mount (in an effect, to avoid a hydration mismatch).
const NAME_PLACEHOLDERS = [
  "Friday Movie Night",
  "Date Night",
  "Roommate Roulette",
  "Bad Horror Decisions",
];

export default function SetupPage() {
  const router = useRouter();
  const params = useParams();
  const code = params.code as string;

  const [room, setRoom] = useState<RoomState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [roomName, setRoomName] = useState("");
  const [namePlaceholder, setNamePlaceholder] = useState(NAME_PLACEHOLDERS[0]);

  // Local copies of mutable fields
  const [services, setServices] = useState<ServiceId[]>([]);
  const [minRating, setMinRating] = useState(0);
  const [maxRating, setMaxRating] = useState(10);
  const [maxRuntime, setMaxRuntime] = useState<number | "">("");
  const [selectedGenres, setSelectedGenres] = useState<number[]>([]);
  const [depth, setDepth] = useState(3);
  const [watchedFilter, setWatchedFilter] = useState(false);

  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [patchingWatchedFilter, setPatchingWatchedFilter] = useState(false);

  // Pick a fun placeholder once on the client (deferred so it never runs during
  // render — avoids a hydration mismatch / set-state-in-effect).
  useEffect(() => {
    const id = setTimeout(
      () => setNamePlaceholder(NAME_PLACEHOLDERS[Math.floor(Math.random() * NAME_PLACEHOLDERS.length)]),
      0
    );
    return () => clearTimeout(id);
  }, []);

  // Fetch room on mount and redirect if needed
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

        if (data.status === "VOTING") return router.replace(`/room/${code}/vote`);
        if (data.status === "MATCHED") return router.replace(`/room/${code}/match`);
        if (data.status === "DONE") return router.replace(`/room/${code}/done`);
        if (!data.isCurrentUserHost) return router.replace(`/room/${code}/lobby`);

        setRoom(data);
        setMembers(data.members ?? []);
        setRoomName(data.name ?? "");
        setServices(data.streamingServices ?? []);
        setWatchedFilter(data.watchedFilter ?? false);
        if (data.filters) {
          setMinRating(data.filters.minRating ?? 0);
          setMaxRating(data.filters.maxRating ?? 10);
          setMaxRuntime(data.filters.maxRuntime ?? "");
          setSelectedGenres(data.filters.genres ?? []);
          setDepth(data.filters.depth ?? 3);
        }

        // Pre-fill from saved preferences when the room is fresh (no services yet)
        if ((data.streamingServices ?? []).length === 0) {
          try {
            const prefRes = await fetch("/api/user/preferences");
            if (prefRes.ok) {
              const prefs = await prefRes.json();
              if (prefs.savedServices?.length > 0) {
                setServices(prefs.savedServices);
                await fetch(`/api/rooms/${code}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ streamingServices: prefs.savedServices }),
                });
              }
              if (prefs.savedFilters) {
                const f = prefs.savedFilters as RoomFilters;
                setMinRating(f.minRating ?? 0);
                setMaxRating(f.maxRating ?? 10);
                setMaxRuntime(f.maxRuntime ?? "");
                setSelectedGenres(f.genres ?? []);
                setDepth(f.depth ?? 3);
                await fetch(`/api/rooms/${code}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ filters: f }),
                });
              }
            }
          } catch {
            // Non-fatal — pre-fill is best-effort
          }
        }
      } catch {
        setLoadError("Failed to load room.");
      }
    }
    loadRoom();
  }, [code, router]);

  // Live member roster — poll so the host sees people arrive before starting.
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/rooms/${code}/poll`, { cache: "no-store" });
        if (!res.ok) return;
        const data: SetupPollResponse = await res.json();
        if (Array.isArray(data.members)) setMembers(data.members);
        if (data.status === "VOTING") router.replace(`/room/${code}/vote`);
        else if (data.status === "MATCHED") router.replace(`/room/${code}/match`);
        else if (data.status === "DONE") router.replace(`/room/${code}/done`);
      } catch {
        // best-effort; next tick retries
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [code, router]);

  const patchName = useCallback(
    async (value: string) => {
      await fetch(`/api/rooms/${code}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: value.trim() }),
      });
    },
    [code]
  );

  const patchServices = useCallback(
    async (updated: ServiceId[]) => {
      setServices(updated);
      await fetch(`/api/rooms/${code}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ streamingServices: updated }),
      });
    },
    [code]
  );

  // Build the filters JSON from current state + overrides, then PATCH.
  const persistFilters = useCallback(
    async (overrides: Partial<RoomFilters>) => {
      const m = {
        minRating,
        maxRating,
        maxRuntime,
        genres: selectedGenres,
        depth,
        ...overrides,
      };
      const payload: RoomFilters = {
        minRating: m.minRating > 0 ? m.minRating : undefined,
        maxRating: m.maxRating < 10 ? m.maxRating : undefined,
        maxRuntime: m.maxRuntime === "" ? undefined : Number(m.maxRuntime),
        genres: m.genres.length ? m.genres : undefined,
        depth: m.depth,
      };
      await fetch(`/api/rooms/${code}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filters: payload }),
      });
    },
    [code, minRating, maxRating, maxRuntime, selectedGenres, depth]
  );

  const patchWatchedFilter = useCallback(
    async (enabled: boolean) => {
      if (patchingWatchedFilter) return;
      setPatchingWatchedFilter(true);
      setWatchedFilter(enabled);
      track("feature_used", { feature: "skip_reruns", enabled }, { roomId: code });
      try {
        await fetch(`/api/rooms/${code}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ watchedFilter: enabled }),
        });
      } catch {
        setWatchedFilter(!enabled);
      } finally {
        setPatchingWatchedFilter(false);
      }
    },
    [code, patchingWatchedFilter]
  );

  async function handleStart() {
    setStarting(true);
    setStartError(null);
    try {
      const res = await fetch(`/api/rooms/${code}/start`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to start room.");
      }
      track("room_started", undefined, { roomId: code });
      router.push(`/room/${code}/vote`);
    } catch (err) {
      setStartError(err instanceof Error ? err.message : "Failed to start.");
      setStarting(false);
    }
  }

  if (loadError) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas px-4 text-accent">
        <p>{loadError}</p>
      </main>
    );
  }

  if (!room) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas px-4 text-muted">
        <p>Loading room…</p>
      </main>
    );
  }

  const canStart = services.length > 0 && !starting;

  return (
    <main className="min-h-screen bg-canvas text-ink">
      <div className="mx-auto w-full max-w-xl px-5 py-6 sm:px-8">
        <RoomCodeBar code={code} />

        {/* Hero */}
        <div className="mt-12">
          <p className={EYEBROW}>Room setup</p>
          <h1 className="mt-1 font-serif text-5xl font-bold leading-none">
            Settle <span className="italic text-accent">in.</span>
          </h1>
          <p className="mt-3 text-sm text-muted">
            Set up the living room before everyone piles on the couch.
          </p>
        </div>

        {/* Name your movie night */}
        <div className="mt-8 space-y-2">
          <label htmlFor="roomName" className={EYEBROW}>
            Name your movie night <span className="text-faint">(optional)</span>
          </label>
          <input
            id="roomName"
            type="text"
            placeholder={namePlaceholder}
            value={roomName}
            maxLength={60}
            onChange={(e) => setRoomName(e.target.value)}
            onBlur={() => patchName(roomName)}
            className="w-full rounded-none border border-line bg-surface px-4 py-3 text-ink placeholder-faint focus:border-ink focus:outline-none"
          />
        </div>

        {/* Members */}
        <section className="mt-6 space-y-2">
          <p className={EYEBROW}>Members · {members.length}</p>
          <ul className="flex flex-wrap gap-2">
            {members.map((member) => (
              <li
                key={member.id}
                className="flex items-center gap-2 border border-line bg-surface px-3 py-1.5 text-sm"
              >
                <span className="flex h-5 w-5 items-center justify-center bg-accent text-[10px] font-bold text-accent-ink">
                  {member.displayName.charAt(0).toUpperCase()}
                </span>
                {member.displayName}
                {member.isHost && <span className="text-faint">· Host</span>}
                {member.id === (room.currentMemberId ?? "") && <span className="text-faint">· You</span>}
              </li>
            ))}
          </ul>
        </section>

        {/* Controls */}
        <div className="mt-8">
          <FilterControls
            services={services}
            onServicesChange={patchServices}
            minRating={minRating}
            maxRating={maxRating}
            onRatingChange={(min, max) => {
              setMinRating(min);
              setMaxRating(max);
              persistFilters({ minRating: min, maxRating: max });
            }}
            maxRuntime={maxRuntime}
            onMaxRuntimeChange={(v) => {
              setMaxRuntime(v);
              persistFilters({ maxRuntime: v === "" ? undefined : v });
            }}
            genres={selectedGenres}
            onGenresChange={(g) => {
              setSelectedGenres(g);
              persistFilters({ genres: g.length ? g : undefined });
            }}
            skipReruns={watchedFilter}
            onSkipRerunsChange={patchWatchedFilter}
            depth={depth}
            onDepthChange={(d) => {
              setDepth(d);
              persistFilters({ depth: d });
              track("feature_used", { feature: "depth_change", depth: d }, { roomId: code });
            }}
            showServicesError={services.length === 0}
          />
        </div>

        {/* Start */}
        <div className="mt-8 h-px bg-ink/80" />
        {startError && <p className="mt-4 text-sm font-medium text-accent">{startError}</p>}
        <button
          type="button"
          onClick={handleStart}
          disabled={!canStart}
          className="mt-5 w-full rounded-none bg-ink px-6 py-4 text-sm font-semibold uppercase tracking-[0.14em] text-canvas transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:bg-faint/50"
        >
          {starting ? "Starting…" : "Start voting ›"}
        </button>
      </div>
    </main>
  );
}
