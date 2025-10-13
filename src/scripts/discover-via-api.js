import dotenv from 'dotenv';
import { tiktokSearch } from '../scrapers/tiktok-search.js';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { creators } from '../db/schema.js';
import { isNotNull, desc, eq } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';

dotenv.config();

// Fetches the most recent session cookies from an authenticated user
async function getSessionCookies() {
  const [latestUser] = await db
    .select({ cookies: users.profileData }) // Assuming cookies are in profileData
    .from(users)
    .where(isNotNull(users.profileData))
    .orderBy(desc(users.updatedAt))
    .limit(1);

  if (!latestUser || !latestUser.cookies) {
    console.warn('⚠️ No session cookies found in DB. Scraping without logging in.');
    return null;
  }
  return latestUser.cookies;
}

async function saveCreatorFromScraper(searchResult) {
  if (!searchResult.author?.username) return;

  const username = searchResult.author.username;
  const existing = await db.select().from(creators).where(eq(creators.username, username)).limit(1);

  if (existing.length > 0) {
    // Optionally update existing record, for now we just skip
    return;
  }

  const profileRecord = {
    tiktokId: searchResult.id,
    username: username,
    displayName: searchResult.author.name,
    profileData: {
      url: searchResult.url,
      thumbnails: searchResult.thumbnails,
      source: 'scraper',
      fetchedAt: new Date().toISOString(),
    },
    lastScrapedAt: new Date(),
  };

  await db.insert(creators).values(profileRecord);
  console.log(`   💾 Saved new creator: @${username}`);
}


async function main() {
  console.log('🚀 Starting TikTok creator discovery via scraper...\n');

  try {
    const keywords = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['tiktokshop', 'fashion', 'beauty'];

    console.log(`🔍 Using keywords: ${keywords.join(', ')}`);

    // We can pass session cookies to the scraper if we have them
    // For now, we'll let the scraper manage its own session
    const sessionDir = path.join(process.cwd(), '.tiktok-sessions');
    if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

    const allCreators = new Set();

    for (const keyword of keywords) {
      console.log(`\n🔎 Searching for "${keyword}"...`);
      const { results, challengeEncountered } = await tiktokSearch({
        query: keyword,
        maxResults: 30, // More targeted results per keyword
        headless: true, // Run in headless mode for CI/server environments
        sessionDir,
      });

      if (challengeEncountered) {
        console.warn(`   ⚠️ Anti-bot challenge was encountered for "${keyword}". Results may be limited.`);
      }

      console.log(`   ✅ Found ${results.length} potential videos for "${keyword}"`);

      for (const result of results) {
        if (result.author?.username) {
          allCreators.add(result.author.username);
          await saveCreatorFromScraper(result);
        }
      }
    }

    console.log(`\n✅ Discovery complete!`);
    console.log(`📊 Total unique creators found: ${allCreators.size}`);

  } catch (error) {
    console.error('❌ Discovery script failed:', error);
    process.exit(1);
  }
}

main();
