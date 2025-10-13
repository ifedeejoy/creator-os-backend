import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { tiktokSearch } from '../scrapers/tiktok-search.js';

dotenv.config();

async function main(): Promise<void> {
  console.log('🚀 Starting TikTok scraper in DEBUG mode...\n');

  try {
    const query = process.argv[2] || 'tiktokshop';
    console.log(`🔍 Using test query: "${query}"`);

    const msToken = process.env.MS_TOKEN || null;
    if (msToken) {
      console.log('   Found MS_TOKEN in environment variables.');
    } else {
      console.warn('   ⚠️ MS_TOKEN not found in .env. Scraping may be less reliable.');
      console.log('      See instructions for how to get your ms_token.');
    }

    const sessionDir = path.join(process.cwd(), '.tiktok-sessions-debug');
    if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

    const { results, challengeEncountered } = await tiktokSearch({
      query,
      maxResults: 10,
      headless: false,
      sessionDir,
      msToken: msToken ?? undefined,
      navigationTimeoutMs: 120_000,
    });

    if (challengeEncountered) {
      console.warn(`\n⚠️ Anti-bot challenge was encountered for "${query}".`);
      console.log('   You may need to solve it manually in the browser window.');
    }

    console.log('\n✅ Scraper finished!');
    console.log(`📊 Found ${results.length} results.`);
    console.log('\nResults:');
    console.dir(results, { depth: null });
  } catch (error) {
    console.error('❌ Debug scraper failed:', error);
    process.exit(1);
  }
}

main();
