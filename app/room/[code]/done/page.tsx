"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import BrandFooter from "@/components/BrandFooter";

export default function DonePage() {
  const params = useParams();
  const router = useRouter();
  const code = params.code as string;

  const [roomName, setRoomName] = useState<string | null>(null);

  useEffect(() => {
    async function fetchName() {
      try {
        const res = await fetch(`/api/rooms/${code}`);
        if (!res.ok) return;
        const data = await res.json();
        setRoomName(data.name ?? null);
      } catch {
        // best-effort; name is decorative on this screen
      }
    }
    fetchName();
  }, [code]);

  return (
    <main className="flex min-h-screen flex-col bg-canvas text-ink">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-5 text-center">
        {roomName && (
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-faint">
            {roomName}
          </p>
        )}
        <h1 className="mt-2 font-serif text-5xl font-bold leading-none">
          No match <span className="italic text-accent">tonight.</span>
        </h1>
        <p className="mt-4 text-sm text-muted">
          You ran out of movies to vote on. Loosen the filters and give it another go.
        </p>

        <button
          onClick={() => router.push(`/room/${code}/setup`)}
          className="mt-8 w-full rounded-none bg-ink px-6 py-4 text-sm font-semibold uppercase tracking-[0.14em] text-canvas transition-opacity hover:opacity-90"
        >
          ↻ Pik again
        </button>

        <Link
          href="/"
          className="mt-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted underline-offset-4 hover:text-ink hover:underline"
        >
          Back to home
        </Link>
      </div>
      <div className="px-5 pb-6">
        <BrandFooter />
      </div>
    </main>
  );
}
