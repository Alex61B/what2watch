-- CreateEnum
CREATE TYPE "FriendshipStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED');

-- CreateEnum
CREATE TYPE "MoviePreferenceType" AS ENUM ('WATCHLIST', 'SEEN_BEFORE');

-- CreateTable
CREATE TABLE "Friendship" (
    "id" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "receiverId" TEXT NOT NULL,
    "status" "FriendshipStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Friendship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserMoviePreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tmdbMovieId" TEXT NOT NULL,
    "type" "MoviePreferenceType" NOT NULL,
    "sourceRoomId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserMoviePreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MovieCache" (
    "tmdbMovieId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "posterUrl" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "overview" TEXT NOT NULL,
    "rating" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MovieCache_pkey" PRIMARY KEY ("tmdbMovieId")
);

-- CreateIndex
CREATE INDEX "Friendship_receiverId_idx" ON "Friendship"("receiverId");

-- CreateIndex
CREATE INDEX "Friendship_requesterId_idx" ON "Friendship"("requesterId");

-- CreateIndex
CREATE UNIQUE INDEX "Friendship_requesterId_receiverId_key" ON "Friendship"("requesterId", "receiverId");

-- CreateIndex
CREATE INDEX "UserMoviePreference_userId_type_idx" ON "UserMoviePreference"("userId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "UserMoviePreference_userId_tmdbMovieId_type_key" ON "UserMoviePreference"("userId", "tmdbMovieId", "type");

-- AddForeignKey
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserMoviePreference" ADD CONSTRAINT "UserMoviePreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
