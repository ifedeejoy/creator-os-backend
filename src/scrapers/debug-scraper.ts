import { chromium } from 'playwright';

interface PageInfo {
  title: string;
  bodyText: string | undefined;
  linkCount: number;
  userLinks: number;
  dataE2ELinks: number;
  dataE2ETypes: string[];
  sampleHrefs: string[];
}

async function debug(): Promise<void> {
  console.log('🔍 Debug TikTok scraper\n');

  const browser = await chromium.launch({
    headless: false,
  });

  const page = await browser.newPage();

  const hashtag = process.argv[2] || 'tiktokshop';
  const url = `https://www.tiktok.com/tag/${hashtag}`;

  console.log(`Opening: ${url}\n`);
  await page.goto(url);

  console.log('Waiting 5 seconds for page to load...\n');
  await page.waitForTimeout(5000);

  const pageInfo = await page.evaluate<PageInfo>(() => {
    return {
      title: document.title,
      bodyText: document.body?.innerText?.slice(0, 200),
      linkCount: document.querySelectorAll('a').length,
      userLinks: document.querySelectorAll('a[href*="/@"]').length,
      dataE2ELinks: document.querySelectorAll('[data-e2e]').length,
      dataE2ETypes: Array.from(
        new Set(
          Array.from(document.querySelectorAll('[data-e2e]')).map((el) =>
            el.getAttribute('data-e2e'),
          ),
        ),
      ).filter((type): type is string => Boolean(type)),
      sampleHrefs: Array.from(document.querySelectorAll<HTMLAnchorElement>('a'))
        .slice(0, 20)
        .map((a) => a.href),
    };
  });

  console.log('📊 Page Analysis:');
  console.log('─'.repeat(50));
  console.log(`Title: ${pageInfo.title}`);
  console.log(`Total links: ${pageInfo.linkCount}`);
  console.log(`User links (/@): ${pageInfo.userLinks}`);
  console.log(`Elements with data-e2e: ${pageInfo.dataE2ELinks}`);
  console.log('\ndata-e2e types found:');
  pageInfo.dataE2ETypes.forEach((type) => console.log(`  - ${type}`));
  console.log('\nSample hrefs:');
  pageInfo.sampleHrefs.slice(0, 10).forEach((href) => console.log(`  ${href}`));
  console.log('\n');

  console.log('🖱️  Browser window is open. Check what you see!');
  console.log('Press Ctrl+C when done...\n');

  await new Promise(() => {});
}

debug().catch((error) => {
  console.error(error);
  process.exit(1);
});
