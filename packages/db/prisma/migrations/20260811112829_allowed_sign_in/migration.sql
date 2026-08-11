-- CreateTable
CREATE TABLE "allowedSignIn" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "entry" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "allowedSignIn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "allowedSignIn_organizationId_idx" ON "allowedSignIn"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "allowedSignIn_entry_key" ON "allowedSignIn"("entry");

-- AddForeignKey
ALTER TABLE "allowedSignIn" ADD CONSTRAINT "allowedSignIn_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
