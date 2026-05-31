'use client'

interface DrainedScreenProps {
  isHost: boolean
  code: string
}

export default function DrainedScreen({ isHost, code }: DrainedScreenProps) {
  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-950 text-white px-4">
      <div className="w-full max-w-sm text-center space-y-6">
        <h1 className="text-2xl font-bold">No more movies</h1>
        <p className="text-gray-400">
          The room has voted on every movie in this queue.
        </p>
        {isHost ? (
          <button
            type="button"
            disabled
            title="Coming soon"
            className="w-full rounded-xl bg-indigo-600/40 px-6 py-3 text-sm font-semibold text-white opacity-60 cursor-not-allowed"
          >
            Deal more movies (coming soon)
          </button>
        ) : (
          <p className="text-sm text-gray-500">Waiting for the host.</p>
        )}
        <a
          href={`/room/${code}/lobby`}
          className="inline-block rounded-xl border border-gray-700 hover:bg-gray-800 px-6 py-3 text-sm font-semibold transition-colors"
        >
          Back to Lobby
        </a>
      </div>
    </main>
  )
}
