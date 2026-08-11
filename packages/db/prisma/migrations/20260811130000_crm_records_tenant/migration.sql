-- Every CRM record gains the workspace it belongs to.
--
-- Existing rows are backfilled onto the oldest organization, which is the
-- workspace a single-tenant install has always been using. An install with CRM
-- rows and no organization at all fails the NOT NULL below rather than having
-- one invented for it.

ALTER TABLE "company" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "contact" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "deal" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "dealContact" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "activity" ADD COLUMN "organizationId" TEXT;

UPDATE "company" SET "organizationId" = (SELECT id FROM "organization" ORDER BY "createdAt" ASC, id ASC LIMIT 1);
UPDATE "contact" SET "organizationId" = (SELECT id FROM "organization" ORDER BY "createdAt" ASC, id ASC LIMIT 1);
UPDATE "deal" SET "organizationId" = (SELECT id FROM "organization" ORDER BY "createdAt" ASC, id ASC LIMIT 1);
UPDATE "dealContact" SET "organizationId" = (SELECT id FROM "organization" ORDER BY "createdAt" ASC, id ASC LIMIT 1);
UPDATE "activity" SET "organizationId" = (SELECT id FROM "organization" ORDER BY "createdAt" ASC, id ASC LIMIT 1);

ALTER TABLE "company" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "contact" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "deal" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "dealContact" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "activity" ALTER COLUMN "organizationId" SET NOT NULL;

-- A domain and an address are unique to a workspace, not to the install. Two
-- asset managers can hold the same prospect without the second one meeting a
-- conflict about a record it cannot see.
DROP INDEX "company_domain_key";
DROP INDEX "contact_email_key";

CREATE UNIQUE INDEX "company_organizationId_domain_key" ON "company"("organizationId", "domain");
CREATE UNIQUE INDEX "contact_organizationId_email_key" ON "contact"("organizationId", "email");

CREATE INDEX "company_organizationId_idx" ON "company"("organizationId");
CREATE INDEX "contact_organizationId_idx" ON "contact"("organizationId");
CREATE INDEX "deal_organizationId_idx" ON "deal"("organizationId");
CREATE INDEX "dealContact_organizationId_idx" ON "dealContact"("organizationId");
CREATE INDEX "activity_organizationId_idx" ON "activity"("organizationId");

ALTER TABLE "company" ADD CONSTRAINT "company_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contact" ADD CONSTRAINT "contact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "deal" ADD CONSTRAINT "deal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dealContact" ADD CONSTRAINT "dealContact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "activity" ADD CONSTRAINT "activity_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
