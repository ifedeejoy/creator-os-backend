import dotenv from 'dotenv';
import { tiktokSearch } from '../scrapers/tiktok-search.js';
import path from 'path';
import fs from 'fs';

dotenv.config();

async function main() {
  console.log('🚀 Starting TikTok scraper in DEBUG mode...\n');

  try {
    const query = process.argv[2] || 'tiktokshop';
    console.log(`🔍 Using test query: "${query}"`);

    // The ms_token is a session cookie that helps authenticate the scraper
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
      query: query,
      maxResults: 10,
      headless: false, // Run in headed mode to see the browser
      sessionDir,
      msToken: msToken, // Pass the token to the scraper
      navigationTimeoutMs: 120000, // Longer timeout for manual intervention
      jitterMs: 1000, // Slower, more human-like interactions
    });

    if (challengeEncountered) {
      console.warn(`\n⚠️ Anti-bot challenge was encountered for "${query}".`);
      console.log('   You may need to solve it manually in the browser window.');
    }

    console.log(`\n✅ Scraper finished!`);
    console.log(`📊 Found ${results.length} results.`);
    console.log('\nResults:');
    console.dir(results, { depth: null });

  } catch (error) {
    console.error('❌ Debug scraper failed:', error);
    process.exit(1);
  }
}

main();
