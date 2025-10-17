import dotenv from 'dotenv';
import { createTikTokDomain } from '../domains/tiktok/index.js';

dotenv.config();

const userId = process.argv[2];

if (!userId) {
  console.error('Usage: npm run sync <userId>');
  process.exit(1);
}

console.log(`🎬 Syncing TikTok videos for user: ${userId}\n`);

const { service } = createTikTokDomain();

service
  .syncUserData(userId)
  .then((result) => {
    console.log('\n✅ Sync completed successfully!');
    console.log(`   Videos synced: ${result.videosCount}`);
    console.log(`   Username: ${result.userInfo.display_name}`);
    console.log(`   Followers: ${result.userInfo.follower_count}`);
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Sync failed:');
    console.error(`   ${error.message}`);
    process.exit(1);
  });
