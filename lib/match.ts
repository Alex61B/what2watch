import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'

interface MatchRow {
  tmdb_movie_id: string | null
  yes_count: bigint
  active_count: bigint
}

export async function checkForMatch(roomId: string, tmdbMovieId: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<MatchRow[]>(Prisma.sql`
    SELECT
      v."tmdbMovieId" AS tmdb_movie_id,
      COUNT(*) FILTER (WHERE v.vote = true)::bigint AS yes_count,
      (
        SELECT COUNT(*)::bigint FROM "Member" m
        WHERE m."roomId" = ${roomId}
          AND m."leftAt" IS NULL
          AND m."approved" = true
      ) AS active_count
    FROM "Vote" v
    WHERE v."roomId" = ${roomId}
      AND v."tmdbMovieId" = ${tmdbMovieId}
    GROUP BY v."tmdbMovieId"
  `)

  const row = rows[0]
  if (!row || row.active_count === BigInt(0) || row.yes_count < row.active_count) {
    return null
  }

  // Guard on status so only a room that is still VOTING can transition to MATCHED.
  // A concurrent request may have already advanced/drained/matched it — never
  // resurrect a terminal room, and don't report a match we didn't actually write.
  const updated = await prisma.room.updateMany({
    where: { id: roomId, status: 'VOTING' },
    data: { status: 'MATCHED', matchedMovieId: tmdbMovieId },
  })
  if (updated.count === 0) return null

  return tmdbMovieId
}
