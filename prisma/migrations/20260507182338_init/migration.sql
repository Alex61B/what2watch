-- CreateEnum
CREATE TYPE "RoomStatus" AS ENUM ('LOBBY', 'VOTING', 'MATCHED', 'DONE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "savedServices" TEXT[],
    "savedFilters" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Room" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "hostMemberId" TEXT NOT NULL,
    "streamingServices" TEXT[],
    "filters" JSONB,
    "status" "RoomStatus" NOT NULL DEFAULT 'LOBBY',
    "matchedMovieId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Member" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT,
    "displayName" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "isHost" BOOLEAN NOT NULL DEFAULT false,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomQueue" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "tmdbMovieId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "streamingService" TEXT NOT NULL,
    "watchUrl" TEXT NOT NULL,

    CONSTRAINT "RoomQueue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vote" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "tmdbMovieId" TEXT NOT NULL,
    "vote" BOOLEAN NOT NULL,
    "votedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Room_code_key" ON "Room"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Member_sessionToken_key" ON "Member"("sessionToken");

-- CreateIndex
CREATE INDEX "RoomQueue_roomId_position_idx" ON "RoomQueue"("roomId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "RoomQueue_roomId_tmdbMovieId_key" ON "RoomQueue"("roomId", "tmdbMovieId");

-- CreateIndex
CREATE INDEX "Vote_roomId_tmdbMovieId_vote_idx" ON "Vote"("roomId", "tmdbMovieId", "vote");

-- CreateIndex
CREATE UNIQUE INDEX "Vote_roomId_memberId_tmdbMovieId_key" ON "Vote"("roomId", "memberId", "tmdbMovieId");

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomQueue" ADD CONSTRAINT "RoomQueue_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
