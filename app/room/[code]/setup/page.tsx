"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import StreamingServicePicker from "@/components/StreamingServicePicker";
import MemberList from "@/components/MemberList";
import { ServiceId, TMDB_GENRES } from "@/lib/tmdb";

interface RoomFilters {
  genres?: number[];
  maxRuntime?: number;
  minRating?: number;
  maxRating?: number;
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

export default function SetupPage() {
  const router = useRouter();
  const params = useParams();
  const code = params.code as string;

  const [room, setRoom] = useState<RoomState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [roomName, setRoomName] = useState("");

  // Local copies of mutable fields
  const [services, setServices] = useState<ServiceId[]>([]);
  const [minRating, setMinRating] = useState<number | "">(0);
  const [maxRating, setMaxRating] = useState<number | "">(10);
  const [activeThumb, setActiveThumb] = useState<'min' | 'max'>('max');
  const [maxRuntime, setMaxRuntime] = useState<number | "">("");
  const [selectedGenres, setSelectedGenres] = useState<number[]>([]);
  const [watchedFilter, setWatchedFilter] = useState(false);

  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const [patchingWatchedFilter, setPatchingWatchedFilter] = useState(false);

  const [copied, setCopied] = useState(false);

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

        if (data.status === "VOTING") {
          router.replace(`/room/${code}/vote`);
          return;
        }
        if (data.status === "MATCHED") {
          router.replace(`/room/${code}/match`);
          return;
        }
        if (data.status === "DONE") {
          router.replace(`/room/${code}/done`);
          return;
        }

        if (!data.isCurrentUserHost) {
          router.replace(`/room/${code}/lobby`);
          return;
        }

        setRoom(data);
        setMembers(data.members ?? []);
        setRoomName(data.name ?? "");
        setServices(data.streamingServices ?? []);
        setWatchedFilter(data.watchedFilter ?? false);
        if (data.filters) {
          setMinRating(data.filters.minRating ?? 0);
          setMaxRuntime(data.filters.maxRuntime ?? "");
          setSelectedGenres(data.filters.genres ?? []);
        }

        // Pre-fill from user's saved preferences if the room is freshly created (no services yet)
        if ((data.streamingServices ?? []).length === 0) {
          try {
            const prefRes = await fetch('/api/user/preferences')
            if (prefRes.ok) {
              const prefs = await prefRes.json()
              if (prefs.savedServices?.length > 0) {
                setServices(prefs.savedServices)
                // Also PATCH the room so the server knows about the pre-filled services
                await fetch(`/api/rooms/${code}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ streamingServices: prefs.savedServices }),
                })
              }
              if (prefs.savedFilters) {
                const f = prefs.savedFilters as RoomFilters
                setMinRating(f.minRating ?? 0)
                setMaxRating(f.maxRating ?? 10)
                setMaxRuntime(f.maxRuntime ?? '')
                setSelectedGenres(f.genres ?? [])
                // Also PATCH the room filters
                await fetch(`/api/rooms/${code}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ filters: f }),
                })
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

  // Patch room name (host-only; sent on blur)
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

  // Patch streaming services
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

  // Patch filters helper
  const patchFilters = useCallback(
    async (partial: Partial<RoomFilters>) => {
      const current: RoomFilters = {
        minRating: minRating === "" ? undefined : Number(minRating),
        maxRating: (maxRating === "" || Number(maxRating) >= 10) ? undefined : Number(maxRating),
        maxRuntime: maxRuntime === "" ? undefined : Number(maxRuntime),
        genres: selectedGenres.length ? selectedGenres : undefined,
      };
      const merged = { ...current, ...partial };
      await fetch(`/api/rooms/${code}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filters: merged }),
      });
    },
    [code, minRating, maxRating, maxRuntime, selectedGenres]
  );

  // Patch watchedFilter (top-level boolean, separate from filters JSON)
  const patchWatchedFilter = useCallback(async (enabled: boolean) => {
    if (patchingWatchedFilter) return;
    setPatchingWatchedFilter(true);
    setWatchedFilter(enabled);  // optimistic update
    try {
      await fetch(`/api/rooms/${code}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ watchedFilter: enabled }),
      });
    } catch {
      setWatchedFilter(!enabled);  // revert on error
    } finally {
      setPatchingWatchedFilter(false);
    }
  }, [code, patchingWatchedFilter]);

  function handleGenreToggle(genreId: number) {
    const updated = selectedGenres.includes(genreId)
      ? selectedGenres.filter(id => id !== genreId)
      : [...selectedGenres, genreId];
    setSelectedGenres(updated);
    patchFilters({ genres: updated.length ? updated : undefined });
  }

  function handleMinRatingChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = parseFloat(e.target.value);
    const currentMax = maxRating === "" ? 10 : Number(maxRating);
    const clamped = Math.min(val, currentMax);
    setMinRating(clamped);
    patchFilters({ minRating: clamped });
  }

  function handleMaxRatingChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = parseFloat(e.target.value);
    const currentMin = minRating === "" ? 0 : Number(minRating);
    const clamped = Math.max(val, currentMin);
    setMaxRating(clamped);
    patchFilters({ maxRating: clamped >= 10 ? undefined : clamped });
  }

  function handleMaxRuntimeChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    if (raw === "") {
      setMaxRuntime("");
      patchFilters({ maxRuntime: undefined });
    } else {
      const val = parseInt(raw, 10);
      if (!isNaN(val)) {
        setMaxRuntime(val);
        patchFilters({ maxRuntime: val });
      }
    }
  }

  async function handleStart() {
    setStarting(true);
    setStartError(null);
    try {
      const res = await fetch(`/api/rooms/${code}/start`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to start room.");
      }
      router.push(`/room/${code}/vote`);
    } catch (err) {
      setStartError(err instanceof Error ? err.message : "Failed to start.");
      setStarting(false);
    }
  }

  async function handleCopy() {
    const shareUrl = `${window.location.origin}/room/${code}/lobby`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback: select the text manually
    }
  }

  const shareUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/room/${code}/lobby`
      : `/room/${code}/lobby`;

  if (loadError) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-950 text-white px-4">
        <p className="text-red-400">{loadError}</p>
      </main>
    );
  }

  if (!room) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-950 text-white px-4">
        <p className="text-gray-400">Loading room…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white px-4 py-12">
      <div className="w-full max-w-lg mx-auto space-y-8">
        {/* Header */}
        <div className="space-y-3">
          <div className="space-y-1">
            <h1 className="text-3xl font-bold tracking-tight">Room Setup</h1>
            <p className="text-gray-400 text-sm">
              Room code:{" "}
              <span className="font-mono font-semibold text-indigo-400">{code}</span>
            </p>
          </div>
          <div className="space-y-1">
            <label htmlFor="roomName" className="block text-sm font-medium text-gray-300">
              Room name (optional)
            </label>
            <input
              id="roomName"
              type="text"
              placeholder="e.g. Friday Movie Night"
              value={roomName}
              maxLength={60}
              onChange={(e) => setRoomName(e.target.value)}
              onBlur={() => patchName(roomName)}
              className="w-full rounded-lg bg-gray-800 border border-gray-700 px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>

        {/* Members — live count so the host sees who has joined */}
        <section className="space-y-2">
          <p className="text-xs uppercase tracking-widest text-gray-500 font-semibold">
            Members · {members.length}
          </p>
          <MemberList members={members} currentMemberId={room.currentMemberId ?? ""} />
        </section>

        {/* Streaming services */}
        <section className="bg-gray-900 rounded-2xl p-6 space-y-4">
          <h2 className="text-lg font-semibold">Streaming Services</h2>
          <p className="text-gray-400 text-sm">
            Select which services to pull movies from.
          </p>
          <StreamingServicePicker selected={services} onChange={patchServices} />
        </section>

        {/* Filters */}
        <section className="bg-gray-900 rounded-2xl p-6 space-y-5">
          <h2 className="text-lg font-semibold">Filters (optional)</h2>

          {/* Rating range — dual-handle slider */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-300">
              Rating range:{" "}
              <span className="font-semibold text-white">
                {minRating === "" ? "0" : minRating}
                {" – "}
                {maxRating === "" ? 10 : maxRating}
              </span>
            </label>
            <div className="relative mx-1" style={{ height: 20 }}>
              <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1 rounded-full bg-gray-700" />
              <div
                className="absolute top-1/2 -translate-y-1/2 h-1 rounded-full bg-indigo-500"
                style={{
                  left: `${(Number(minRating) / 10) * 100}%`,
                  right: `${((10 - Number(maxRating === "" ? 10 : maxRating)) / 10) * 100}%`,
                }}
              />
              <input
                type="range"
                min={0}
                max={10}
                step={0.5}
                value={minRating === "" ? 0 : Number(minRating)}
                onPointerDown={() => setActiveThumb('min')}
                onChange={handleMinRatingChange}
                className="dual-thumb absolute w-full h-full"
                style={{ zIndex: activeThumb === 'min' ? 5 : 4 }}
                aria-label="Minimum rating"
              />
              <input
                type="range"
                min={0}
                max={10}
                step={0.5}
                value={maxRating === "" ? 10 : Number(maxRating)}
                onPointerDown={() => setActiveThumb('max')}
                onChange={handleMaxRatingChange}
                className="dual-thumb absolute w-full h-full"
                style={{ zIndex: activeThumb === 'max' ? 5 : 4 }}
                aria-label="Maximum rating"
              />
            </div>
            <div className="flex justify-between text-xs text-gray-500">
              <span>0</span>
              <span>10</span>
            </div>
          </div>

          {/* Max runtime */}
          <div className="space-y-2">
            <label
              htmlFor="maxRuntime"
              className="block text-sm font-medium text-gray-300"
            >
              Max runtime (minutes)
            </label>
            <input
              id="maxRuntime"
              type="number"
              min={1}
              step={1}
              placeholder="e.g. 120 (leave blank for any)"
              value={maxRuntime}
              onChange={handleMaxRuntimeChange}
              className="w-full rounded-lg bg-gray-800 border border-gray-700 px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* Genres */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-gray-300">
              Genres{" "}
              <span className="text-gray-500 font-normal">
                {selectedGenres.length === 0 ? "(any)" : `(${selectedGenres.length} selected)`}
              </span>
            </p>
            <div className="flex flex-wrap gap-2">
              {TMDB_GENRES.map(genre => {
                const active = selectedGenres.includes(genre.id);
                return (
                  <button
                    key={genre.id}
                    type="button"
                    onClick={() => handleGenreToggle(genre.id)}
                    className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                      active
                        ? "bg-indigo-600 text-white"
                        : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200"
                    }`}
                  >
                    {genre.name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Watched history filter */}
          <div className="flex items-center justify-between">
            <label htmlFor="watchedFilter" className="text-sm font-medium text-gray-300">
              Exclude movies anyone here has already seen
            </label>
            <button
              id="watchedFilter"
              type="button"
              role="switch"
              aria-checked={watchedFilter}
              onClick={() => patchWatchedFilter(!watchedFilter)}
              disabled={patchingWatchedFilter}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-60 ${
                watchedFilter ? "bg-indigo-600" : "bg-gray-700"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  watchedFilter ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>
        </section>

        {/* Share link */}
        <section className="bg-gray-900 rounded-2xl p-6 space-y-3">
          <h2 className="text-lg font-semibold">Invite others</h2>
          <p className="text-gray-400 text-sm">Share this link so others can join the lobby.</p>
          <div className="flex items-center gap-3">
            <span className="flex-1 truncate rounded-lg bg-gray-800 border border-gray-700 px-4 py-2.5 text-sm text-gray-300 font-mono">
              {shareUrl}
            </span>
            <button
              type="button"
              onClick={handleCopy}
              className="shrink-0 rounded-lg bg-gray-700 hover:bg-gray-600 px-4 py-2.5 text-sm font-medium transition-colors"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        </section>

        {/* Start */}
        {startError && (
          <p className="text-red-400 text-sm">{startError}</p>
        )}
        <button
          type="button"
          onClick={handleStart}
          disabled={services.length === 0 || starting}
          className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed px-6 py-3.5 text-lg font-semibold transition-colors"
        >
          {starting ? "Starting…" : "Start Voting"}
        </button>
        {services.length === 0 && (
          <p className="text-center text-sm text-gray-500">
            Select at least one streaming service to start.
          </p>
        )}
      </div>
    </main>
  );
}
