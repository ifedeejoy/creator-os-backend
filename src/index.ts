import cron from 'node-cron';
import dotenv from 'dotenv';
import TikTokScraper from './scrapers/tiktok-scraper.js';

dotenv.config();

console.log('🚀 Lumo Backend Workers Starting...\n');

const scraper = new TikTokScraper();

const hashtags: string[] = ['tiktokshop', 'tiktokmademebuy', 'tiktokfinds'];

cron.schedule('0 2 * * *', async () => {
  console.log('⏰ Running daily scraping job...');

  try {
    await scraper.initialize();

    for (const tag of hashtags) {
      const handles = await scraper.scrapeHashtag(tag, 50);
      console.log(`Found ${handles.length} creators from #${tag}`);

      await scraper.scrapeMultipleProfiles(handles.slice(0, 20));
    }

    await scraper.close();
    console.log('✅ Daily scraping complete\n');
  } catch (error) {
    console.error('❌ Scraping job failed:', error);
  }
});

console.log('✅ Background workers initialized');
console.log('📅 Scheduled jobs:');
console.log('   - Daily scraping: 2:00 AM');
console.log('\n💡 Run manual scrape: npm run scrape\n');

process.on('SIGINT', async () => {
  console.log('\n👋 Shutting down workers...');
  await scraper.close();
  process.exit(0);
});
