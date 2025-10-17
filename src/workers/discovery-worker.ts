import { Job, Worker } from 'bullmq';
import { eq } from 'drizzle-orm';
import { DISCOVERY_QUEUE_NAME, type DiscoveryJobData } from '../queue/discovery-queue.js';
import { getRedisConnectionOptions } from '../queue/redis.js';
import { db } from '../db/index.js';
import { creatorDiscoveries, creators } from '../db/schema.js';
import TikTokScraper from '../scrapers/tiktok-scraper.js';

interface CompletionStats {
  successCount: number;
  skipCount: number;
  totalProcessed: number;
}

export class DiscoveryWorker {
  private scraper: TikTokScraper;
  private worker: Worker<DiscoveryJobData> | null = null;

  constructor() {
    this.scraper = new TikTokScraper();
  }

  async start(): Promise<void> {
    console.log('🔍 Discovery Worker starting (Redis queue)...');
    await this.scraper.initialize();

    this.worker = new Worker<DiscoveryJobData>(
      DISCOVERY_QUEUE_NAME,
      async (job) => this.processJob(job),
      {
        connection: getRedisConnectionOptions(),
        concurrency: Number.parseInt(process.env.DISCOVERY_CONCURRENCY ?? '1', 10),
      },
    );

    this.worker.on('completed', (job) => {
      console.log(`✅ Job ${job.data.discoveryId} completed (attempts: ${job.attemptsMade + 1})`);
    });

    this.worker.on('failed', (job, error) => {
      const discoveryId = job?.data.discoveryId ?? job?.id ?? 'unknown';
      console.error(`❌ Job ${discoveryId} failed`, error);
    });

    this.worker.on('error', (error) => {
      console.error('❌ Worker error:', error);
    });
  }

  async stop(): Promise<void> {
    console.log('🛑 Discovery Worker stopping...');
    await this.worker?.close();
    await this.scraper.close();
  }

  private async processJob(job: Job<DiscoveryJobData>): Promise<void> {
    const { discoveryId, hashtag, limit, source } = job.data;
    const attemptsMade = job.attemptsMade + 1;

    await markAsProcessing(discoveryId, attemptsMade);

    try {
      console.log(`\n📋 Processing discovery ${discoveryId}`);
      console.log(`   Source: ${source}`);
      console.log(`   Hashtag: #${hashtag}`);
      console.log(`   Limit: ${limit}`);

      const handles = await this.scraper.scrapeHashtag(hashtag, 50);
      console.log(`   Found ${handles.length} creator handles`);

      const profilesToScrape = handles.slice(0, limit);
      console.log(`   Scraping ${profilesToScrape.length} profiles...`);

      const stats = await this.scrapeProfiles(profilesToScrape, source);

      await markAsCompleted(discoveryId, stats);

      console.log(`\n✅ Discovery ${discoveryId} completed!`);
      console.log(`   New creators: ${stats.successCount}`);
      console.log(`   Skipped: ${stats.skipCount}\n`);
    } catch (error) {
      const remainingAttempts =
        (job.opts.attempts ?? 1) - attemptsMade;
      await markAsFailed(discoveryId, attemptsMade, remainingAttempts > 0, error);
      throw error;
    }
  }

  private async scrapeProfiles(handles: string[], source: string): Promise<CompletionStats> {
    let successCount = 0;
    let skipCount = 0;

    for (const handle of handles) {
      try {
        const existing = await db
          .select()
          .from(creators)
          .where(eq(creators.username, handle))
          .limit(1);

        if (existing.length > 0) {
          console.log(`   ⏭️  @${handle} already exists, skipping`);
          skipCount++;
          continue;
        }

        const profile = await this.scraper.scrapeProfile(handle);
        if (!profile?.username) {
          console.log(`   ⚠️  Failed to scrape @${handle}`);
          continue;
        }

        await db.insert(creators).values({
          tiktokId: `tiktok_${profile.username}`,
          username: profile.username,
          followerCount: profile.followerCount,
          followingCount: profile.followingCount,
          totalLikes: profile.totalLikes,
          videoCount: profile.videoCount,
          bio: profile.bio,
          profileData: {
            avatarUrl: profile.avatarUrl,
            scrapedAt: new Date().toISOString(),
            source,
          },
          lastScrapedAt: new Date(),
        });

        successCount++;
        console.log(
          `   ✅ @${profile.username} - ${(profile.followerCount / 1000).toFixed(1)}K followers`,
        );
      } catch (error) {
        console.error(`   ❌ Error scraping @${handle}:`, error);
      }
    }

    return {
      successCount,
      skipCount,
      totalProcessed: handles.length,
    };
  }
}

async function markAsProcessing(discoveryId: string, attempts: number): Promise<void> {
  const payload = await getPayload(discoveryId);

  const updatedPayload = {
    ...payload,
    attempts,
    processingStartedAt: new Date().toISOString(),
  };

  await db
    .update(creatorDiscoveries)
    .set({
      status: 'processing',
      attempts,
      lastAttemptAt: new Date(),
      updatedAt: new Date(),
      payload: updatedPayload,
    })
    .where(eq(creatorDiscoveries.id, discoveryId));

  payloadCache.set(discoveryId, updatedPayload);
}

async function markAsCompleted(discoveryId: string, stats: CompletionStats): Promise<void> {
  const payload = await getPayload(discoveryId);

  const updatedPayload = {
    ...payload,
    completedAt: new Date().toISOString(),
    successCount: stats.successCount,
    skipCount: stats.skipCount,
    totalProcessed: stats.totalProcessed,
  };

  await db
    .update(creatorDiscoveries)
    .set({
      status: 'completed',
      updatedAt: new Date(),
      payload: updatedPayload,
    })
    .where(eq(creatorDiscoveries.id, discoveryId));

  payloadCache.set(discoveryId, updatedPayload);
  payloadCache.delete(discoveryId);
}

async function markAsFailed(
  discoveryId: string,
  attempts: number,
  willRetry: boolean,
  error: unknown,
): Promise<void> {
  const status = willRetry ? 'pending' : 'failed';
  const payload = await getPayload(discoveryId);

  const updatedPayload = {
    ...payload,
    lastError: error instanceof Error ? error.message : String(error),
    failedAt: new Date().toISOString(),
    attempts,
    willRetry,
  };

  await db
    .update(creatorDiscoveries)
    .set({
      status,
      attempts,
      updatedAt: new Date(),
      payload: updatedPayload,
    })
    .where(eq(creatorDiscoveries.id, discoveryId));

  payloadCache.set(discoveryId, updatedPayload);
  if (!willRetry) {
    payloadCache.delete(discoveryId);
  }
}

const payloadCache = new Map<string, Record<string, unknown>>();

async function getPayload(discoveryId: string): Promise<Record<string, unknown>> {
  if (payloadCache.has(discoveryId)) {
    return payloadCache.get(discoveryId)!;
  }

  const existing = await db
    .select({
      payload: creatorDiscoveries.payload,
    })
    .from(creatorDiscoveries)
    .where(eq(creatorDiscoveries.id, discoveryId))
    .limit(1);

  const payload = (existing[0]?.payload as Record<string, unknown> | undefined) ?? {};
  payloadCache.set(discoveryId, payload);
  return payload;
}
