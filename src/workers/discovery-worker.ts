import { db } from '../db/index.js';
import { creatorDiscoveries, creators } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import TikTokScraper from '../scrapers/tiktok-scraper.js';

const POLL_INTERVAL_MS = 5000; // Check for new jobs every 5 seconds
const MAX_RETRIES = 3;

export class DiscoveryWorker {
  private scraper: TikTokScraper;
  private isRunning = false;
  private pollTimeout: NodeJS.Timeout | null = null;

  constructor() {
    this.scraper = new TikTokScraper();
  }

  async start(): Promise<void> {
    console.log('🔍 Discovery Worker starting...');
    this.isRunning = true;
    await this.scraper.initialize();
    this.poll();
  }

  async stop(): Promise<void> {
    console.log('🛑 Discovery Worker stopping...');
    this.isRunning = false;
    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
    }
    await this.scraper.close();
  }

  private async poll(): Promise<void> {
    if (!this.isRunning) return;

    try {
      await this.processNextJob();
    } catch (error) {
      console.error('❌ Error processing job:', error);
    }

    // Schedule next poll
    this.pollTimeout = setTimeout(() => this.poll(), POLL_INTERVAL_MS);
  }

  private async processNextJob(): Promise<void> {
    // Get the next pending job
    const [job] = await db
      .select()
      .from(creatorDiscoveries)
      .where(eq(creatorDiscoveries.status, 'pending'))
      .limit(1);

    if (!job) {
      // No jobs to process
      return;
    }

    console.log(`\n📋 Processing job: ${job.id}`);
    console.log(`   Source: ${job.source}`);
    console.log(`   Created: ${job.createdAt}\n`);

    // Check if we've exceeded max retries
    if ((job.attempts ?? 0) >= MAX_RETRIES) {
      console.log(`⚠️  Job ${job.id} exceeded max retries, marking as failed`);
      await db
        .update(creatorDiscoveries)
        .set({
          status: 'failed',
          updatedAt: new Date(),
        })
        .where(eq(creatorDiscoveries.id, job.id));
      return;
    }

    // Update status to processing
    await db
      .update(creatorDiscoveries)
      .set({
        status: 'processing',
        lastAttemptAt: new Date(),
        attempts: (job.attempts ?? 0) + 1,
        updatedAt: new Date(),
      })
      .where(eq(creatorDiscoveries.id, job.id));

    try {
      // Extract hashtag from source or payload
      const payload = job.payload as any;
      const source = job.source ?? '';
      const hashtag = payload?.hashtag || source.replace('hashtag:', '');
      const limit = payload?.limit || 20;

      console.log(`🔎 Scraping hashtag: #${hashtag} (limit: ${limit})`);

      // Scrape the hashtag
      const handles = await this.scraper.scrapeHashtag(hashtag, 50);
      console.log(`   Found ${handles.length} creator handles`);

      // Scrape profiles for the top creators
      const profilesToScrape = handles.slice(0, limit);
      console.log(`   Scraping ${profilesToScrape.length} profiles...`);

      let successCount = 0;
      let skipCount = 0;

      for (const handle of profilesToScrape) {
        try {
          // Check if creator already exists
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

          // Scrape the profile
          const profile = await this.scraper.scrapeProfile(handle);

          if (!profile || !profile.username) {
            console.log(`   ⚠️  Failed to scrape @${handle}`);
            continue;
          }

          // Insert into creators table
          await db.insert(creators).values({
            tiktokId: `tiktok_${profile.username}`, // Generate a tiktokId
            username: profile.username,
            followerCount: profile.followerCount,
            followingCount: profile.followingCount,
            totalLikes: profile.totalLikes,
            videoCount: profile.videoCount,
            bio: profile.bio,
            profileData: {
              avatarUrl: profile.avatarUrl,
              scrapedAt: new Date().toISOString(),
              source: job.source,
            },
            lastScrapedAt: new Date(),
          });

          successCount++;
          console.log(
            `   ✅ @${profile.username} - ${(profile.followerCount / 1000).toFixed(1)}K followers`
          );
        } catch (error) {
          console.error(`   ❌ Error scraping @${handle}:`, error);
        }
      }

      // Mark job as completed
      await db
        .update(creatorDiscoveries)
        .set({
          status: 'completed',
          updatedAt: new Date(),
          payload: {
            ...payload,
            completedAt: new Date().toISOString(),
            successCount,
            skipCount,
            totalProcessed: profilesToScrape.length,
          },
        })
        .where(eq(creatorDiscoveries.id, job.id));

      console.log(`\n✅ Job ${job.id} completed!`);
      console.log(`   Discovered: ${successCount} new creators`);
      console.log(`   Skipped: ${skipCount} existing creators\n`);
    } catch (error) {
      console.error(`\n❌ Job ${job.id} failed:`, error);

      // Mark as failed if max retries exceeded, otherwise back to pending
      const newStatus = (job.attempts ?? 0) + 1 >= MAX_RETRIES ? 'failed' : 'pending';

      await db
        .update(creatorDiscoveries)
        .set({
          status: newStatus,
          updatedAt: new Date(),
          payload: {
            ...(job.payload as any),
            lastError: error instanceof Error ? error.message : String(error),
          },
        })
        .where(eq(creatorDiscoveries.id, job.id));

      console.log(`   Job marked as: ${newStatus}\n`);
    }
  }
}
