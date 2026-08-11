
ALTER TABLE "contactFact" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "contactBrief" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "emailThread" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "emailMessage" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "calendarEvent" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "calendarAttendee" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "companyEnrichment" ADD COLUMN "organizationId" TEXT;

UPDATE "contactFact" SET "organizationId" = COALESCE((SELECT "organizationId" FROM "contact" WHERE "contact".id = "contactFact"."contactId"), (SELECT id FROM "organization" ORDER BY "createdAt" ASC, id ASC LIMIT 1));
UPDATE "contactBrief" SET "organizationId" = COALESCE((SELECT "organizationId" FROM "contact" WHERE "contact".id = "contactBrief"."contactId"), (SELECT id FROM "organization" ORDER BY "createdAt" ASC, id ASC LIMIT 1));
UPDATE "emailThread" SET "organizationId" = COALESCE((SELECT "organizationId" FROM "contact" WHERE "contact".id = "emailThread"."contactId"), (SELECT id FROM "organization" ORDER BY "createdAt" ASC, id ASC LIMIT 1));
UPDATE "emailMessage" SET "organizationId" = COALESCE((SELECT "organizationId" FROM "emailThread" WHERE "emailThread".id = "emailMessage"."threadId"), (SELECT id FROM "organization" ORDER BY "createdAt" ASC, id ASC LIMIT 1));
UPDATE "calendarEvent" SET "organizationId" = COALESCE((SELECT "organizationId" FROM "contact" WHERE "contact".id = "calendarEvent"."contactId"), (SELECT id FROM "organization" ORDER BY "createdAt" ASC, id ASC LIMIT 1));
UPDATE "calendarAttendee" SET "organizationId" = COALESCE((SELECT "organizationId" FROM "calendarEvent" WHERE "calendarEvent".id = "calendarAttendee"."eventId"), (SELECT id FROM "organization" ORDER BY "createdAt" ASC, id ASC LIMIT 1));
UPDATE "companyEnrichment" SET "organizationId" = COALESCE((SELECT "organizationId" FROM "company" WHERE "company".id = "companyEnrichment"."companyId"), (SELECT id FROM "organization" ORDER BY "createdAt" ASC, id ASC LIMIT 1));

UPDATE "emailThread" SET "organizationId" = COALESCE((SELECT "organizationId" FROM "company" WHERE "company".id = "emailThread"."companyId"), "organizationId");
UPDATE "calendarEvent" SET "organizationId" = COALESCE((SELECT "organizationId" FROM "company" WHERE "company".id = "calendarEvent"."companyId"), "organizationId");

ALTER TABLE "contactFact" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "contactBrief" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "emailThread" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "emailMessage" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "calendarEvent" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "calendarAttendee" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "companyEnrichment" ALTER COLUMN "organizationId" SET NOT NULL;

CREATE INDEX "contactFact_organizationId_idx" ON "contactFact"("organizationId");
CREATE INDEX "contactBrief_organizationId_idx" ON "contactBrief"("organizationId");
CREATE INDEX "emailThread_organizationId_idx" ON "emailThread"("organizationId");
CREATE INDEX "emailMessage_organizationId_idx" ON "emailMessage"("organizationId");
CREATE INDEX "calendarEvent_organizationId_idx" ON "calendarEvent"("organizationId");
CREATE INDEX "calendarAttendee_organizationId_idx" ON "calendarAttendee"("organizationId");
CREATE INDEX "companyEnrichment_organizationId_idx" ON "companyEnrichment"("organizationId");

ALTER TABLE "contactFact" ADD CONSTRAINT "contactFact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contactBrief" ADD CONSTRAINT "contactBrief_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "emailThread" ADD CONSTRAINT "emailThread_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "emailMessage" ADD CONSTRAINT "emailMessage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendarEvent" ADD CONSTRAINT "calendarEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendarAttendee" ADD CONSTRAINT "calendarAttendee_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "companyEnrichment" ADD CONSTRAINT "companyEnrichment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
