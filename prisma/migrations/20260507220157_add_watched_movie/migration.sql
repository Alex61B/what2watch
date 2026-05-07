-- CreateTable
CREATE TABLE "WatchedMovie" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "tmdbMovieId" TEXT NOT NULL,
    "markedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WatchedMovie_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WatchedMovie_memberId_idx" ON "WatchedMovie"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "WatchedMovie_memberId_tmdbMovieId_key" ON "WatchedMovie"("memberId", "tmdbMovieId");

-- AddForeignKey
ALTER TABLE "WatchedMovie" ADD CONSTRAINT "WatchedMovie_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
