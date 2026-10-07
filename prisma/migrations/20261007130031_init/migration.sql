-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'ENRICHING', 'ENRICHED', 'FAILED', 'QUALIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "Tier" AS ENUM ('A', 'B', 'C');

-- CreateEnum
CREATE TYPE "LeadSourceType" AS ENUM ('CSV', 'SEED', 'MANUAL');

-- CreateEnum
CREATE TYPE "MergeReason" AS ENUM ('DOMAIN', 'FUZZY_NAME');

-- CreateEnum
CREATE TYPE "MergeStatus" AS ENUM ('PENDING', 'MERGED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "SuppressionType" AS ENUM ('DOMAIN', 'EMAIL');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('ENRICH', 'SCORE', 'IMPORT');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "Icp" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "industries" TEXT[],
    "locations" TEXT[],
    "minEmployees" INTEGER,
    "maxEmployees" INTEGER,
    "includeKeywords" TEXT[],
    "excludeKeywords" TEXT[],
    "signals" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Icp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "industry" TEXT,
    "location" TEXT,
    "employees" INTEGER,
    "foundedYear" INTEGER,
    "description" TEXT,
    "source" "LeadSourceType" NOT NULL DEFAULT 'CSV',
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "icpId" TEXT,
    "score" INTEGER,
    "tier" "Tier",
    "scoreDetails" JSONB,
    "scoreHash" TEXT,
    "rawData" JSONB,
    "mergedIntoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Enrichment" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "emails" JSONB NOT NULL DEFAULT '[]',
    "phones" TEXT[],
    "socials" JSONB NOT NULL DEFAULT '{}',
    "about" TEXT,
    "techStack" TEXT[],
    "sourceUrls" TEXT[],
    "robotsAllowed" BOOLEAN NOT NULL DEFAULT true,
    "error" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Enrichment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutreachDraft" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "tone" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "factsUsed" JSONB NOT NULL DEFAULT '[]',
    "edited" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutreachDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MergeCandidate" (
    "id" TEXT NOT NULL,
    "leadAId" TEXT NOT NULL,
    "leadBId" TEXT NOT NULL,
    "similarity" DOUBLE PRECISION NOT NULL,
    "reason" "MergeReason" NOT NULL,
    "status" "MergeStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MergeCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Suppression" (
    "id" TEXT NOT NULL,
    "type" "SuppressionType" NOT NULL,
    "value" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Suppression_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedView" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "type" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "total" INTEGER NOT NULL DEFAULT 0,
    "done" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LlmCache" (
    "contentHash" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LlmCache_pkey" PRIMARY KEY ("contentHash")
);

-- CreateTable
CREATE TABLE "Counter" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Counter_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "Lead_domain_key" ON "Lead"("domain");

-- CreateIndex
CREATE INDEX "Lead_tier_idx" ON "Lead"("tier");

-- CreateIndex
CREATE INDEX "Lead_status_idx" ON "Lead"("status");

-- CreateIndex
CREATE INDEX "Lead_icpId_score_idx" ON "Lead"("icpId", "score");

-- CreateIndex
CREATE INDEX "Lead_industry_idx" ON "Lead"("industry");

-- CreateIndex
CREATE UNIQUE INDEX "Enrichment_leadId_key" ON "Enrichment"("leadId");

-- CreateIndex
CREATE INDEX "Enrichment_expiresAt_idx" ON "Enrichment"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "OutreachDraft_leadId_tone_key" ON "OutreachDraft"("leadId", "tone");

-- CreateIndex
CREATE INDEX "MergeCandidate_status_idx" ON "MergeCandidate"("status");

-- CreateIndex
CREATE UNIQUE INDEX "MergeCandidate_leadAId_leadBId_key" ON "MergeCandidate"("leadAId", "leadBId");

-- CreateIndex
CREATE UNIQUE INDEX "Suppression_value_key" ON "Suppression"("value");

-- CreateIndex
CREATE INDEX "Job_status_idx" ON "Job"("status");

-- CreateIndex
CREATE INDEX "LlmCache_kind_idx" ON "LlmCache"("kind");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_icpId_fkey" FOREIGN KEY ("icpId") REFERENCES "Icp"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrichment" ADD CONSTRAINT "Enrichment_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachDraft" ADD CONSTRAINT "OutreachDraft_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MergeCandidate" ADD CONSTRAINT "MergeCandidate_leadAId_fkey" FOREIGN KEY ("leadAId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MergeCandidate" ADD CONSTRAINT "MergeCandidate_leadBId_fkey" FOREIGN KEY ("leadBId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
