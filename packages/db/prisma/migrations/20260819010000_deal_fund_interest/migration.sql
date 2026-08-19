-- AlterTable
ALTER TABLE "deal" ADD COLUMN     "fundId" TEXT,
ADD COLUMN     "shareClassId" TEXT,
ADD COLUMN     "committedAmount" DECIMAL(18,2);
