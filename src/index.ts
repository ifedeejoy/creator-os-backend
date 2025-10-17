import cron from 'node-cron';
import dotenv from 'dotenv';
import http from 'node:http';
import TikTokScraper from './scrapers/tiktok-scraper.js';
import { DiscoveryWorker } from './workers/discovery-worker.js';
import { db } from './db/index.js';
import { creatorDiscoveries } from './db/schema.js';

dotenv.config();

console.log('🚀 Lumo Backend Workers Starting...\n');

const port = Number.parseInt(process.env.PORT ?? '8080', 10);

const server = http.createServer((req, res) => {
  if (req.method === 'GET' || req.method === 'HEAD') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }

  res.writeHead(405);
  res.end();
});

server.listen(port, () => {
  console.log(`🌐 HTTP health endpoint listening on :${port}\n`);
});

const scraper = new TikTokScraper();
const discoveryWorker = new DiscoveryWorker();

// Start the discovery worker (polls database for jobs)
discoveryWorker.start().then(() => {
  console.log('✅ Discovery Worker started - polling for jobs\n');
});

// Optional: Keep the scheduled daily scraping job
const hashtags: string[] = ['tiktokshop', 'tiktokmademebuy', 'tiktokfinds'];

cron.schedule('0 2 * * *', async () => {
  console.log('⏰ Running scheduled daily scraping job...');

  try {
    // Queue jobs for the daily hashtags
    for (const tag of hashtags) {
      await db.insert(creatorDiscoveries).values({
        username: `scheduled-${tag}-${Date.now()}`,
        source: `hashtag:${tag}`,
        status: 'pending',
        payload: {
          hashtag: tag,
          limit: 20,
          scheduledAt: new Date().toISOString(),
          type: 'scheduled',
        },
      });
      console.log(`   Queued scraping job for #${tag}`);
    }

    console.log('✅ Daily scraping jobs queued\n');
  } catch (error) {
    console.error('❌ Failed to queue daily jobs:', error);
  }
});

console.log('✅ Background workers initialized');
console.log('📅 Services running:');
console.log('   - Discovery Worker: Polling database every 5s');
console.log('   - Daily scheduled jobs: 2:00 AM (auto-queue)');
console.log('\n💡 Jobs are now processed automatically from the database!');
console.log('💡 Trigger scraping from the frontend or API\n');

process.on('SIGINT', async () => {
  console.log('\n👋 Shutting down workers...');
  server.close();
  await discoveryWorker.stop();
  await scraper.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n👋 Shutting down workers (SIGTERM)...');
  server.close();
  await discoveryWorker.stop();
  await scraper.close();
  process.exit(0);
});
