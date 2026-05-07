"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import StreamingServicePicker from "@/components/StreamingServicePicker";
import { ServiceId } from "@/lib/tmdb";

interface RoomFilters {
  genres?: number[];
  maxRuntime?: number;
  minRating?: number;
}

interface RoomMember {
  id: string;
  displayName: string;
  isHost: boolean;
}

interface RoomState {
  status: "LOBBY" | "VOTING" | "MATCHED" | "DONE";
  streamingServices: ServiceId[];
  filters: RoomFilters | null;
  members: RoomMember[];
  isCurrentUserHost: boolean;
}

export default function SetupPage() {
  const router = useRouter();
  const params = useParams();
  const code = params.code as string;

  const [room, setRoom] = useState<RoomState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Local copies of mutable fields
  const [services, setServices] = useState<ServiceId[]>([]);
  const [minRating, setMinRating] = useState<number | "">(0);
  const [maxRuntime, setMaxRuntime] = useState<number | "">("");

  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

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
        setServices(data.streamingServices ?? []);
        if (data.filters) {
          setMinRating(data.filters.minRating ?? 0);
          setMaxRuntime(data.filters.maxRuntime ?? "");
        }
      } catch {
        setLoadError("Failed to load room.");
      }
    }
    loadRoom();
  }, [code, router]);

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
        maxRuntime: maxRuntime === "" ? undefined : Number(maxRuntime),
      };
      const merged = { ...current, ...partial };
      await fetch(`/api/rooms/${code}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filters: merged }),
      });
    },
    [code, minRating, maxRuntime]
  );

  function handleMinRatingChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = parseFloat(e.target.value);
    setMinRating(val);
    patchFilters({ minRating: val });
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
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight">Room Setup</h1>
          <p className="text-gray-400 text-sm">
            Room code:{" "}
            <span className="font-mono font-semibold text-indigo-400">{code}</span>
          </p>
        </div>

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

          {/* Min rating */}
          <div className="space-y-2">
            <label
              htmlFor="minRating"
              className="block text-sm font-medium text-gray-300"
            >
              Minimum rating:{" "}
              <span className="font-semibold text-white">
                {minRating === "" ? "0" : minRating}
              </span>
            </label>
            <input
              id="minRating"
              type="range"
              min={0}
              max={9}
              step={0.5}
              value={minRating === "" ? 0 : minRating}
              onChange={handleMinRatingChange}
              className="w-full accent-indigo-500"
            />
            <div className="flex justify-between text-xs text-gray-500">
              <span>0</span>
              <span>9</span>
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
