-- AlterEnum
ALTER TYPE "RoomStatus" ADD VALUE 'DRAINED';

-- AlterTable
ALTER TABLE "Room" ADD COLUMN     "currentPosition" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "queueVersion" INTEGER NOT NULL DEFAULT 0;
