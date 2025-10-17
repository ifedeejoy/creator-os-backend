import dotenv from 'dotenv';
import { enqueueDiscoveryJob } from '../queue/enqueue';

dotenv.config();

async function main(): Promise<void> {
  console.log('🚀 Enqueuing hashtag discovery job...\n');

  try {
    // Get hashtags from command line arguments
    const hashtags = process.argv.slice(2);

    if (hashtags.length === 0) {
      console.log('Usage: npm run discover:hashtag <hashtag1> [hashtag2] [hashtag3] ...');
      console.log('\nExample:');
      console.log('  npm run discover:hashtag tiktokshop');
      console.log('  npm run discover:hashtag tiktokshop fashion beauty');
      console.log('\nDefaulting to: tiktokshop, tiktokmademebuy, tiktokfinds\n');
      hashtags.push('tiktokshop', 'tiktokmademebuy', 'tiktokfinds');
    }

    const limit = Number.parseInt(process.env.DISCOVERY_DEFAULT_LIMIT ?? '20', 10);

    console.log(`📋 Queueing ${hashtags.length} hashtag(s):`);
    hashtags.forEach(tag => console.log(`   - #${tag}`));
    console.log(`   Limit: ${limit} creators per hashtag\n`);

    const results = [];

    for (const hashtag of hashtags) {
      console.log(`📤 Enqueueing: #${hashtag}`);

      const result = await enqueueDiscoveryJob({
        hashtag,
        limit,
        metadata: {
          source: 'cli-script',
          enqueuedAt: new Date().toISOString(),
        },
      });

      console.log(`   ✅ Job enqueued!`);
      console.log(`      Discovery ID: ${result.discoveryId}`);
      console.log(`      Job ID: ${result.jobId}\n`);

      results.push(result);
    }

    console.log('✅ All jobs enqueued successfully!');
    console.log('\n💡 Jobs will be processed by the discovery worker.');
    console.log('   Make sure the backend is running: npm run dev\n');
    console.log('📊 Summary:');
    console.log(`   Total jobs: ${results.length}`);
    results.forEach((r, i) => {
      console.log(`   ${i + 1}. #${hashtags[i]}: ${r.jobId}`);
    });

  } catch (error) {
    console.error('❌ Failed to enqueue discovery job:', error);
    process.exit(1);
  }
}

main();
