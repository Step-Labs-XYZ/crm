-- The agent's queue and its transcript belong to a workspace.
--
-- agentTask and agentEvent carry contactId/companyId as plain columns with no
-- foreign key, on purpose — they outlive the records they name — so neither can
-- inherit a workspace through a join. They need their own column.
--
-- Existing rows are backfilled onto the oldest organization, the workspace a
-- single-tenant install has always been using.

ALTER TABLE "agentTask" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "agentEvent" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "agentConversation" ADD COLUMN "organizationId" TEXT;

UPDATE "agentTask" SET "organizationId" = (SELECT id FROM "organization" ORDER BY "createdAt" ASC, id ASC LIMIT 1);
UPDATE "agentEvent" SET "organizationId" = (SELECT id FROM "organization" ORDER BY "createdAt" ASC, id ASC LIMIT 1);
UPDATE "agentConversation" SET "organizationId" = (SELECT id FROM "organization" ORDER BY "createdAt" ASC, id ASC LIMIT 1);

ALTER TABLE "agentTask" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "agentEvent" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "agentConversation" ALTER COLUMN "organizationId" SET NOT NULL;

CREATE INDEX "agentTask_organizationId_dueAt_leasedUntil_idx" ON "agentTask"("organizationId", "dueAt", "leasedUntil");
CREATE INDEX "agentEvent_organizationId_idx" ON "agentEvent"("organizationId");
CREATE INDEX "agentConversation_organizationId_idx" ON "agentConversation"("organizationId");

ALTER TABLE "agentTask" ADD CONSTRAINT "agentTask_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agentEvent" ADD CONSTRAINT "agentEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agentConversation" ADD CONSTRAINT "agentConversation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- "Who we are" is per workspace: the profile's id IS the workspace it describes.
-- A row whose id names no organization is a profile of nobody, so it goes.
DELETE FROM "workspaceProfile" WHERE id NOT IN (SELECT id FROM "organization");

ALTER TABLE "workspaceProfile" ADD CONSTRAINT "workspaceProfile_id_fkey" FOREIGN KEY ("id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
