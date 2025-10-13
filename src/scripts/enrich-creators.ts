import dotenv from 'dotenv';
import { eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { creatorDiscoveries } from '../db/schema.js';
import TikTokScraper, { ScrapedProfile } from '../scrapers/tiktok-scraper.js';

dotenv.config();

const BATCH_SIZE = parseInt(process.env.CREATOR_ENRICH_BATCH_SIZE || '50', 10);
const MAX_ATTEMPTS = parseInt(process.env.CREATOR_ENRICH_MAX_ATTEMPTS || '5', 10);

type DiscoveryPayload = Record<string, unknown> | null;

function buildSuccessPayload(existing: DiscoveryPayload, profile: ScrapedProfile) {
  const payload: Record<string, unknown> =
    existing && typeof existing === 'object' ? { ...existing } : {};

  payload.enrichedAt = new Date().toISOString();
  payload.profile = profile;
  delete payload.error;

  return payload;
}

function buildFailurePayload(existing: DiscoveryPayload, error: unknown) {
  const payload: Record<string, unknown> =
    existing && typeof existing === 'object' ? { ...existing } : {};

  const errors = Array.isArray(payload.errors) ? [...payload.errors] : [];
  errors.push({
    message: error instanceof Error ? error.message : String(error),
    at: new Date().toISOString(),
  });
  payload.errors = errors;

  return payload;
}

async function fetchPendingDiscoveries(limit: number) {
  return db
    .select()
    .from(creatorDiscoveries)
    .where(eq(creatorDiscoveries.status, 'pending'))
    .orderBy(creatorDiscoveries.createdAt)
    .limit(limit);
}

async function updateDiscoveryStatus(
  id: string,
  status: 'pending' | 'processing' | 'completed' | 'failed',
  payload: Record<string, unknown> | null,
) {
  await db
    .update(creatorDiscoveries)
    .set({
      status,
      payload,
      updatedAt: new Date(),
    })
    .where(eq(creatorDiscoveries.id, id));
}

async function enrichCreators(): Promise<void> {
  const pending = await fetchPendingDiscoveries(BATCH_SIZE);

  if (pending.length === 0) {
    console.log('ℹ️  No pending creator discoveries to enrich.');
    return;
  }

  console.log(`🔄 Enriching ${pending.length} pending creators...`);

  const scraper = new TikTokScraper();
  await scraper.initialize();

  try {
    for (const discovery of pending) {
      const username = discovery.username;
      const priorAttempts = discovery.attempts ?? 0;
      console.log(`\n🔍 Enriching @${username} (attempt ${priorAttempts + 1})`);

      const [{ attempts }] = await db
        .update(creatorDiscoveries)
        .set({
          status: 'processing',
          attempts: sql`${creatorDiscoveries.attempts} + 1`,
          lastAttemptAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(creatorDiscoveries.id, discovery.id))
        .returning({ attempts: creatorDiscoveries.attempts });

      try {
        const profile = await scraper.scrapeProfile(username);
        if (profile) {
          const payload = buildSuccessPayload(discovery.payload as DiscoveryPayload, profile);
          await updateDiscoveryStatus(discovery.id, 'completed', payload);
          console.log(`   ✅ Enriched @${username}`);
        } else {
          const payload = buildFailurePayload(
            discovery.payload as DiscoveryPayload,
            'Scrape returned null profile',
          );
          const safeAttempts = attempts ?? 0;
          const status = safeAttempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
          await updateDiscoveryStatus(discovery.id, status, payload);
          console.warn(
            `   ⚠️ Failed to enrich @${username}. Attempts: ${safeAttempts}/${MAX_ATTEMPTS}. Status: ${status}`,
          );
        }
      } catch (error) {
        const payload = buildFailurePayload(discovery.payload as DiscoveryPayload, error);
        const safeAttempts = attempts ?? 0;
        const status = safeAttempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
        await updateDiscoveryStatus(discovery.id, status, payload);
        console.error(
          `   ❌ Error enriching @${username}. Attempts: ${safeAttempts}/${MAX_ATTEMPTS}. Status: ${status}`,
          error,
        );
      }
    }
  } finally {
    await scraper.close();
  }
}

enrichCreators()
  .then(() => {
    console.log('\n✅ Creator enrichment run complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Creator enrichment failed:', error);
    process.exit(1);
  });
