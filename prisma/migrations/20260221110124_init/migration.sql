-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "name" TEXT,
    "timezone" TEXT DEFAULT 'UTC',
    "goals" TEXT[],
    "newsletterOptIn" BOOLEAN NOT NULL DEFAULT false,
    "subscribedAt" TIMESTAMP(3),
    "notifyAt" TEXT DEFAULT '07:00',
    "onboardingDone" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "magic_links" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "magic_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wearable_connections" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerUserId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wearable_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wearable_tokens" (
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "scope" TEXT,
    "tokenType" TEXT NOT NULL DEFAULT 'Bearer',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wearable_tokens_pkey" PRIMARY KEY ("userId","provider")
);

-- CreateTable
CREATE TABLE "wearable_raw_ingests" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "dataType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "observedDate" TEXT,
    "payload" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wearable_raw_ingests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wearable_activities" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "calories" INTEGER,
    "distanceMeters" DOUBLE PRECISION,
    "steps" INTEGER,
    "averageHeartRate" INTEGER,
    "maxHeartRate" INTEGER,
    "source" TEXT,
    "raw" JSONB NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wearable_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wearable_sleep" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "deepSleepSeconds" INTEGER,
    "lightSleepSeconds" INTEGER,
    "remSleepSeconds" INTEGER,
    "awakeSeconds" INTEGER,
    "sleepScore" INTEGER,
    "stages" JSONB,
    "raw" JSONB NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wearable_sleep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wearable_dailies" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "steps" INTEGER,
    "calories" INTEGER,
    "distanceMeters" DOUBLE PRECISION,
    "activeMinutes" INTEGER,
    "restingHeartRate" INTEGER,
    "averageHeartRate" INTEGER,
    "maxHeartRate" INTEGER,
    "stressLevel" INTEGER,
    "floorsClimbed" INTEGER,
    "raw" JSONB NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wearable_dailies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "magic_links_token_key" ON "magic_links"("token");

-- CreateIndex
CREATE INDEX "magic_links_token_idx" ON "magic_links"("token");

-- CreateIndex
CREATE INDEX "magic_links_userId_idx" ON "magic_links"("userId");

-- CreateIndex
CREATE INDEX "wearable_connections_provider_status_idx" ON "wearable_connections"("provider", "status");

-- CreateIndex
CREATE UNIQUE INDEX "wearable_connections_userId_provider_key" ON "wearable_connections"("userId", "provider");

-- CreateIndex
CREATE INDEX "wearable_tokens_userId_idx" ON "wearable_tokens"("userId");

-- CreateIndex
CREATE INDEX "wearable_raw_ingests_userId_provider_dataType_idx" ON "wearable_raw_ingests"("userId", "provider", "dataType");

-- CreateIndex
CREATE UNIQUE INDEX "wearable_raw_ingests_userId_provider_dataType_sourceId_key" ON "wearable_raw_ingests"("userId", "provider", "dataType", "sourceId");

-- CreateIndex
CREATE INDEX "wearable_activities_userId_provider_startTime_idx" ON "wearable_activities"("userId", "provider", "startTime");

-- CreateIndex
CREATE UNIQUE INDEX "wearable_activities_userId_provider_externalId_key" ON "wearable_activities"("userId", "provider", "externalId");

-- CreateIndex
CREATE INDEX "wearable_sleep_userId_provider_date_idx" ON "wearable_sleep"("userId", "provider", "date");

-- CreateIndex
CREATE UNIQUE INDEX "wearable_sleep_userId_provider_externalId_key" ON "wearable_sleep"("userId", "provider", "externalId");

-- CreateIndex
CREATE INDEX "wearable_dailies_userId_provider_date_idx" ON "wearable_dailies"("userId", "provider", "date");

-- CreateIndex
CREATE UNIQUE INDEX "wearable_dailies_userId_provider_date_key" ON "wearable_dailies"("userId", "provider", "date");

-- AddForeignKey
ALTER TABLE "magic_links" ADD CONSTRAINT "magic_links_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wearable_connections" ADD CONSTRAINT "wearable_connections_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
