-- CreateEnum
CREATE TYPE "InvestorClassification" AS ENUM ('RETAIL', 'PROFESSIONAL', 'INSTITUTIONAL');

-- AlterTable
ALTER TABLE "contact" ADD COLUMN     "investorClassification" "InvestorClassification",
ADD COLUMN     "referrerEmail" TEXT;

-- AlterTable
ALTER TABLE "company" ADD COLUMN     "currency" TEXT,
ADD COLUMN     "registrationNumber" TEXT;

-- CreateIndex
CREATE INDEX "contact_organizationId_investorClassification_idx" ON "contact"("organizationId", "investorClassification");
