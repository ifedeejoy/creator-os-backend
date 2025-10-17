import http from 'node:http';
import { URL } from 'node:url';
import cron from 'node-cron';
import dotenv from 'dotenv';
import { DiscoveryWorker } from './workers/discovery-worker.js';
import { enqueueDiscoveryJob } from './queue/enqueue.js';
import { createTikTokDomain, createTikTokRoutes } from './domains/tiktok/index.js';

dotenv.config();

console.log('🚀 Lumo Backend Starting...\n');

const httpPort = Number.parseInt(process.env.HTTP_PORT ?? '3001', 10);
const tiktokDomain = createTikTokDomain();
const tiktokRoutes = createTikTokRoutes(tiktokDomain.controller);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const pathname = url.pathname;
  const method = req.method;

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (pathname === '/health' && (method === 'GET' || method === 'HEAD')) {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  if (pathname === '/api/sync' && method === 'POST') {
    await tiktokRoutes.handleSyncRequest(req, res);
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(httpPort, () => {
  console.log(`🌐 HTTP API server listening on port ${httpPort}`);
  console.log(`   POST /api/sync - Sync user TikTok videos`);
  console.log(`   GET /health - Health check\n`);
});

const discoveryWorker = new DiscoveryWorker();

discoveryWorker.start().then(() => {
  console.log('✅ Discovery Worker started - listening for Redis jobs\n');
});

const hashtags: string[] = ['tiktokshop', 'tiktokmademebuy', 'tiktokfinds'];

cron.schedule('0 2 * * *', async () => {
  console.log('⏰ Running scheduled daily scraping job...');

  try {
    for (const tag of hashtags) {
      const { jobId } = await enqueueDiscoveryJob({
        hashtag: tag,
        limit: Number.parseInt(process.env.DISCOVERY_DEFAULT_LIMIT ?? '20', 10),
        metadata: {
          scheduledAt: new Date().toISOString(),
          type: 'scheduled',
        },
      });
      console.log(`   Queued scraping job for #${tag} (job: ${jobId})`);
    }

    console.log('✅ Daily scraping jobs queued\n');
  } catch (error) {
    console.error('❌ Failed to queue daily jobs:', error);
  }
});

console.log('✅ Backend initialized');
console.log('📅 Services running:');
console.log('   - HTTP API Server: Ready for sync requests');
console.log('   - Discovery Worker: Consuming Redis queue');
console.log('   - Daily scheduled jobs: 2:00 AM (auto-queue)');
console.log('\n💡 Jobs are now processed via Redis-backed queue!');
console.log('💡 Trigger scraping from the frontend or API\n');

process.on('SIGINT', async () => {
  console.log('\n👋 Shutting down workers...');
  server.close();
  await discoveryWorker.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n👋 Shutting down workers (SIGTERM)...');
  server.close();
  await discoveryWorker.stop();
  process.exit(0);
});
