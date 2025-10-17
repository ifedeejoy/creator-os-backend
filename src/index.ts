import http from 'node:http';
import { URL } from 'node:url';
import cron from 'node-cron';
import dotenv from 'dotenv';
import { DiscoveryWorker } from './workers/discovery-worker';
import { enqueueDiscoveryJob } from './queue/enqueue';
import { createTikTokDomain, createTikTokRoutes } from './domains/tiktok';

dotenv.config();

console.log('🚀 Lumo Backend Starting...\n');

// Cloud Run uses PORT env variable, fallback to HTTP_PORT or 3001
const httpPort = Number.parseInt(process.env.PORT ?? process.env.HTTP_PORT ?? '3001', 10);
console.log(`📍 Server will bind to port: ${httpPort}`);
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

  if (pathname === '/api/discovery' && method === 'POST') {
    try {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
      }

      const data = JSON.parse(body);
      const { hashtag, limit = 20, discoveryId, requestedBy, metadata } = data;

      if (!hashtag) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'hashtag is required' }));
        return;
      }

      const result = await enqueueDiscoveryJob({
        hashtag,
        limit,
        discoveryId,
        source: `hashtag:${hashtag}`,
        requestedBy,
        metadata,
      });

      console.log(`✅ Enqueued discovery job: ${result.jobId} for #${hashtag}`);

      res.writeHead(200);
      res.end(JSON.stringify({
        success: true,
        jobId: result.jobId,
        discoveryId: result.discoveryId,
        hashtag
      }));
    } catch (error) {
      console.error('❌ Failed to enqueue discovery job:', error);
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Failed to enqueue job', details: (error as Error).message }));
    }
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

// Start HTTP server IMMEDIATELY for health checks (Cloud Run requirement)
server.listen(httpPort, '0.0.0.0', () => {
  console.log(`✅ HTTP API server listening on port ${httpPort}`);
  console.log(`   POST /api/discovery - Enqueue discovery job`);
  console.log(`   POST /api/sync - Sync user TikTok videos`);
  console.log(`   GET /health - Health check`);
  console.log(`   🏥 Container is healthy and ready!\n`);
});

// Initialize worker asynchronously (doesn't block health checks)
console.log('⏳ Initializing Discovery Worker (background)...');
const discoveryWorker = new DiscoveryWorker();

discoveryWorker.start()
  .then(() => {
    console.log('✅ Discovery Worker started - listening for Redis jobs\n');
  })
  .catch((error) => {
    console.error('❌ Failed to start Discovery Worker:', error);
    console.log('⚠️  API server continues running, but worker is unavailable\n');
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
