-- The outbound seam to FundReporting.
--
-- A workspace names the asset manager it is, on their side. It is nullable and
-- has no default on purpose: a handoff with no asset manager refuses rather
-- than filing one workspace's won deal under another's book.
ALTER TABLE "organization" ADD COLUMN "assetManagerId" TEXT;

CREATE TYPE "HandoffState" AS ENUM ('PENDING', 'SENT', 'FAILED', 'REFUSED');

-- One row per deal — the unique constraint is the idempotency, so a re-fired
-- stage change updates the lead it already filed instead of creating a second.
CREATE TABLE "investorLeadHandoff" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "leadId" TEXT,
    "state" "HandoffState" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "investorLeadHandoff_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "investorLeadHandoff_dealId_key" ON "investorLeadHandoff"("dealId");
CREATE INDEX "investorLeadHandoff_organizationId_state_idx" ON "investorLeadHandoff"("organizationId", "state");

ALTER TABLE "investorLeadHandoff" ADD CONSTRAINT "investorLeadHandoff_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "investorLeadHandoff" ADD CONSTRAINT "investorLeadHandoff_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
