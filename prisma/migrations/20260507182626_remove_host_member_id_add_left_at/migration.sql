/*
  Warnings:

  - You are about to drop the column `hostMemberId` on the `Room` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Member" ADD COLUMN     "leftAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Room" DROP COLUMN "hostMemberId";

-- CreateIndex
CREATE INDEX "Member_roomId_idx" ON "Member"("roomId");
