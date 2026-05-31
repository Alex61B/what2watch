// lib/preferences.ts
import { prisma } from '@/lib/prisma'
import type { MoviePreferenceType, UserMoviePreference } from '@prisma/client'

export async function addPreference(
  userId: string,
  tmdbMovieId: string,
  type: MoviePreferenceType,
  sourceRoomId: string | null = null
): Promise<void> {
  await prisma.userMoviePreference.upsert({
    where: { userId_tmdbMovieId_type: { userId, tmdbMovieId, type } },
    create: { userId, tmdbMovieId, type, sourceRoomId },
    update: {},
  })
}

export async function removePreference(
  userId: string,
  tmdbMovieId: string,
  type: MoviePreferenceType
): Promise<void> {
  await prisma.userMoviePreference.deleteMany({
    where: { userId, tmdbMovieId, type },
  })
}

export async function listPreferences(
  userId: string,
  type: MoviePreferenceType
): Promise<UserMoviePreference[]> {
  return prisma.userMoviePreference.findMany({
    where: { userId, type },
    orderBy: { createdAt: 'desc' },
  })
}
