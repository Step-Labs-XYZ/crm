-- A suppression is one workspace's decision, not the install's.
--
-- Both tables were keyed on the address alone, so one asset manager deleting a
-- contact stopped every other asset manager's sync from filing that person —
-- and the second workspace to suppress the same address met a unique
-- constraint on a row it could not see. The key becomes the pair.
--
-- Existing rows are backfilled onto the oldest organization, which on a
-- single-tenant install is the workspace that made the decision.

ALTER TABLE "suppressedDomain" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "suppressedContact" ADD COLUMN "organizationId" TEXT;

UPDATE "suppressedDomain" SET "organizationId" = (SELECT id FROM "organization" ORDER BY "createdAt" ASC, id ASC LIMIT 1);
UPDATE "suppressedContact" SET "organizationId" = (SELECT id FROM "organization" ORDER BY "createdAt" ASC, id ASC LIMIT 1);

DELETE FROM "suppressedDomain" WHERE "organizationId" IS NULL;
DELETE FROM "suppressedContact" WHERE "organizationId" IS NULL;

ALTER TABLE "suppressedDomain" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "suppressedContact" ALTER COLUMN "organizationId" SET NOT NULL;

ALTER TABLE "suppressedDomain" DROP CONSTRAINT "suppressedDomain_pkey";
ALTER TABLE "suppressedContact" DROP CONSTRAINT "suppressedContact_pkey";

ALTER TABLE "suppressedDomain" ADD CONSTRAINT "suppressedDomain_pkey" PRIMARY KEY ("organizationId", "domain");
ALTER TABLE "suppressedContact" ADD CONSTRAINT "suppressedContact_pkey" PRIMARY KEY ("organizationId", "email");

CREATE INDEX "suppressedDomain_organizationId_idx" ON "suppressedDomain"("organizationId");
CREATE INDEX "suppressedContact_organizationId_idx" ON "suppressedContact"("organizationId");

ALTER TABLE "suppressedDomain" ADD CONSTRAINT "suppressedDomain_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "suppressedContact" ADD CONSTRAINT "suppressedContact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
