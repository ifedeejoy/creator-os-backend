import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { eq } from 'drizzle-orm';
import { tiktokSearch } from '../scrapers/tiktok-search.js';
import { db } from '../db/index.js';
import { creators, creatorDiscoveries } from '../db/schema.js';

dotenv.config();

async function stageCreatorFromScraper(result: Awaited<ReturnType<typeof tiktokSearch>>['results'][number]): Promise<void> {
  const username = result.author?.username;
  if (!username) return;

  const existing = await db.select().from(creators).where(eq(creators.username, username)).limit(1);
  if (existing.length > 0) {
    console.log(`   ℹ️  Creator @${username} already exists; skipping discovery.`);
    return;
  }

  const existingDiscovery = await db
    .select()
    .from(creatorDiscoveries)
    .where(eq(creatorDiscoveries.username, username))
    .limit(1);

  const payload = {
    discoveredAt: new Date().toISOString(),
    result,
  };

  if (existingDiscovery.length > 0) {
    await db
      .update(creatorDiscoveries)
      .set({
        status: 'pending',
        payload,
        updatedAt: new Date(),
      })
      .where(eq(creatorDiscoveries.id, existingDiscovery[0].id));
  } else {
    await db.insert(creatorDiscoveries).values({
      username,
      source: 'scraper',
      status: 'pending',
      payload,
    });
  }

  console.log(`   💾 Queued @${username} for enrichment`);
}

async function main(): Promise<void> {
  console.log('🚀 Starting TikTok creator discovery via scraper...\n');

  try {
    const keywords = process.argv.slice(2);
    const searchTerms = keywords.length > 0 ? keywords : ['tiktokshop', 'fashion', 'beauty'];

    console.log(`🔍 Using keywords: ${searchTerms.join(', ')}`);

    const sessionDir = path.join(process.cwd(), '.tiktok-sessions');
    if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

    const allCreators = new Set<string>();

    for (const keyword of searchTerms) {
      console.log(`\n🔎 Searching for "${keyword}"...`);
      const { results, challengeEncountered } = await tiktokSearch({
        query: keyword,
        maxResults: 30,
        headless: true,
        sessionDir,
      });

      if (challengeEncountered) {
        console.warn(
          `   ⚠️ Anti-bot challenge was encountered for "${keyword}". Results may be limited.`,
        );
      }

      console.log(`   ✅ Found ${results.length} potential videos for "${keyword}"`);

      for (const result of results) {
        if (result.author?.username) {
          allCreators.add(result.author.username);
          await stageCreatorFromScraper(result);
        }
      }
    }

    console.log('\n✅ Discovery complete!');
    console.log(`📊 Total unique creators found: ${allCreators.size}`);
  } catch (error) {
    console.error('❌ Discovery script failed:', error);
    process.exit(1);
  }
}

main();
