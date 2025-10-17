import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { eq } from 'drizzle-orm';
import { db } from '../db/index';
import { creators } from '../db/schema';
import fs from 'fs';
import path from 'path';

const RATE_LIMIT_MS = parseInt(process.env.SCRAPER_RATE_LIMIT_MS || '2000', 10);

export interface ScrapedProfile {
  username: string | null;
  bio: string | null;
  followerCount: number;
  followingCount: number;
  totalLikes: number;
  videoCount: number;
  avatarUrl: string | null;
}

type ContextOptions = Parameters<Browser['newContext']>[0];

class TikTokScraper {
  private browser: Browser | null = null;
  private sessionDir: string | null = null;
  private headless: boolean = true;

  async initialize(options: { sessionDir?: string } = {}): Promise<void> {
    console.log('🚀 Launching browser...');
    if (options.sessionDir) {
      this.sessionDir = options.sessionDir;
      if (!fs.existsSync(this.sessionDir)) {
        fs.mkdirSync(this.sessionDir, { recursive: true });
      }
      console.log(`   Using session persistence directory: ${this.sessionDir}`);
    }

    this.headless = process.env.SCRAPER_HEADLESS === 'false' ? false : true;
    const slowMo = parseInt(process.env.SCRAPER_SLOWMO || '0', 10);
    this.browser = await chromium.launch({
      headless: this.headless,
      slowMo: Number.isNaN(slowMo) ? 0 : slowMo,
      args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
    });
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  private async createStealthContext(extraOptions: ContextOptions = {}): Promise<BrowserContext> {
    if (!this.browser) {
      throw new Error('Browser not initialized');
    }

    const contextOptions: ContextOptions = {
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
      locale: 'en-US',
      timezoneId: 'America/New_York',
      hasTouch: false,
      colorScheme: 'light',
      ...extraOptions,
    };

    // Load existing cookies/storage state if available
    if (this.sessionDir) {
      const storageStatePath = path.join(this.sessionDir, 'default', 'storage-state.json');
      const legacyCookiesPath = path.join(this.sessionDir, 'default', 'cookies.json');

      // Try modern storage state first
      if (fs.existsSync(storageStatePath)) {
        try {
          contextOptions.storageState = storageStatePath;
          console.log('   🔐 Loaded authentication from storage state');
        } catch (e) {
          console.warn(`   ⚠️ Failed to load storage state: ${(e as Error).message}`);
        }
      }
      // Fallback to legacy cookies format
      else if (fs.existsSync(legacyCookiesPath)) {
        try {
          const cookiesData = JSON.parse(fs.readFileSync(legacyCookiesPath, 'utf-8'));
          // Convert legacy cookies to storage state format
          const storageState = {
            cookies: Array.isArray(cookiesData) ? cookiesData : [],
            origins: []
          };
          fs.writeFileSync(storageStatePath, JSON.stringify(storageState, null, 2));
          contextOptions.storageState = storageStatePath;
          console.log('   🔐 Migrated and loaded authentication from legacy cookies');
        } catch (e) {
          console.warn(`   ⚠️ Failed to migrate legacy cookies: ${(e as Error).message}`);
        }
      } else {
        console.log('   ℹ️  No existing authentication found - using guest session');
      }
    }

    const context = await this.browser.newContext(contextOptions);

    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });

      const w = window as typeof window & { chrome?: { runtime?: unknown } };
      w.chrome = w.chrome || {};
      w.chrome.runtime = w.chrome.runtime || {};

      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
      });

      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      });

      const permissions = window.navigator.permissions;
      if (permissions?.query) {
        const originalQuery = permissions.query.bind(permissions);
        permissions.query = (parameters) => {
          if (parameters?.name === 'notifications') {
            const fakeStatus = {
              state: typeof Notification !== 'undefined' ? Notification.permission : 'default',
              onchange: null,
              addEventListener: () => undefined,
              removeEventListener: () => undefined,
              dispatchEvent: () => false,
              name: (parameters.name as PermissionName) ?? 'notifications',
            };
            return Promise.resolve(fakeStatus as unknown as PermissionStatus);
          }
          return originalQuery(parameters);
        };
      }
    });

    return context;
  }

  private async isBotChallenge(page: Page): Promise<boolean> {
    const currentUrl = page.url();
    if (/\/verify\//i.test(currentUrl) || currentUrl.includes('verify/bot')) {
      return true;
    }

    try {
      const challengeDetected = await page.evaluate(() => {
        const bodyText = document.body?.innerText?.slice(0, 500).toLowerCase() || '';
        return (
          bodyText.includes('verify') ||
          bodyText.includes('unusual traffic') ||
          bodyText.includes('check that you are a real person') ||
          bodyText.includes('continue to tiktok')
        );
      });
      return challengeDetected;
    } catch {
      return false;
    }
  }

  private async isErrorPage(page: Page): Promise<boolean> {
    try {
      const errorDetected = await page.evaluate(() => {
        const bodyText = document.body?.innerText?.slice(0, 1000).toLowerCase() || '';
        return (
          bodyText.includes('something went wrong') ||
          bodyText.includes('try again') ||
          bodyText.includes('server error') ||
          document.querySelector('[data-e2e="error-page"]') !== null
        );
      });
      return errorDetected;
    } catch {
      return false;
    }
  }

  private async isAuthenticated(page: Page): Promise<boolean> {
    try {
      // Check for login button or authenticated user indicators
      const authStatus = await page.evaluate(() => {
        // Look for login button (means NOT authenticated)
        const loginButton = document.querySelector('[data-e2e="top-login-button"]');
        if (loginButton) return false;

        // Look for user avatar/profile menu (means authenticated)
        const userAvatar = document.querySelector('[data-e2e="profile-icon"]');
        const userMenu = document.querySelector('[data-e2e="nav-profile"]');
        if (userAvatar || userMenu) return true;

        // Check cookies for auth tokens
        const cookies = document.cookie;
        return cookies.includes('sessionid') || cookies.includes('sid_tt');
      });

      return authStatus;
    } catch {
      return false;
    }
  }

  private async promptForLogin(page: Page, context: BrowserContext): Promise<boolean> {
    console.log('\n⚠️  TikTok requires authentication to continue.');
    console.log('📱 Please log in to TikTok in the browser window...');
    console.log('   1. Log in with your TikTok account');
    console.log('   2. Complete any verification if prompted');
    console.log('   3. Wait for the page to fully load');
    console.log('\n   ⏳ Waiting for you to log in... (timeout: 5 minutes)\n');

    try {
      // Wait for authentication indicators or timeout
      await Promise.race([
        // Wait for login button to disappear
        page.waitForSelector('[data-e2e="top-login-button"]', { state: 'hidden', timeout: 300000 }),
        // Or wait for user profile to appear
        page.waitForSelector('[data-e2e="profile-icon"]', { state: 'visible', timeout: 300000 }),
      ]);

      // Verify authentication
      const isAuth = await this.isAuthenticated(page);

      if (isAuth) {
        console.log('✅ Authentication successful!\n');
        // Save the authenticated session
        if (this.sessionDir) {
          const storageStatePath = path.join(this.sessionDir, 'default', 'storage-state.json');
          await context.storageState({ path: storageStatePath });
          console.log('   💾 Saved authenticated session for future use\n');
        }
        return true;
      }

      console.warn('⚠️  Authentication verification failed\n');
      return false;
    } catch (error) {
      console.warn(`⚠️  Login timeout or error: ${(error as Error).message}\n`);
      return false;
    }
  }

  private async retryWithRefresh(page: Page, url: string, maxRetries = 2): Promise<boolean> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      console.log(`   🔄 Retry attempt ${attempt}/${maxRetries} - refreshing page...`);

      try {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => null);
        await page.waitForTimeout(2000);

        if (!(await this.isErrorPage(page))) {
          console.log(`   ✅ Retry ${attempt} successful - error page resolved`);
          return true;
        }
      } catch (error) {
        console.warn(`   ⚠️ Retry ${attempt} failed:`, error);
      }
    }

    console.warn(`   ❌ All ${maxRetries} retry attempts exhausted`);
    return false;
  }

  async scrapeProfile(username: string): Promise<ScrapedProfile | null> {
    console.log(`📡 Scraping profile: @${username}`);

    const context = await this.createStealthContext();
    const page = await context.newPage();

    try {
      await page.goto(`https://www.tiktok.com/@${username}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => null);

      // Check for error page and retry if needed
      if (await this.isErrorPage(page)) {
        console.warn(`⚠️ TikTok returned an error page for @${username}`);
        const retrySuccess = await this.retryWithRefresh(page, `https://www.tiktok.com/@${username}`);
        if (!retrySuccess) {
          console.error(`❌ Failed to recover from error page after retries for @${username}`);
          await context.close();
          return null;
        }
      }

      if (await this.isBotChallenge(page)) {
        console.warn(
          `⚠️ TikTok presented a verification challenge while loading @${username}.`,
        );

        // If not authenticated and not headless, offer to log in
        const isAuth = await this.isAuthenticated(page);
        if (!isAuth && !this.headless) {
          console.log('💡 You can log in to bypass this challenge...');
          const loginSuccess = await this.promptForLogin(page, context);
          if (loginSuccess) {
            console.log('🔄 Retrying after successful login...');
            await page.reload({ waitUntil: 'domcontentloaded' });
            await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => null);

            // Check if challenge is gone
            if (!(await this.isBotChallenge(page))) {
              console.log('✅ Challenge bypassed! Continuing...');
            } else {
              console.warn('⚠️ Challenge still present after login');
              await context.close();
              return null;
            }
          } else {
            await context.close();
            return null;
          }
        } else {
          console.log('💡 Try running with SCRAPER_HEADLESS=false to log in manually');
          await context.close();
          return null;
        }
      }

      await page.waitForSelector('[data-e2e="user-title"]', { timeout: 10000 }).catch(() => null);

      const profileData = await page.evaluate<ScrapedProfile>(() => {
        const usernameNode = document.querySelector('[data-e2e="user-title"]');
        const bioNode = document.querySelector('[data-e2e="user-bio"]');
        const followersNode = document.querySelector('[data-e2e="followers-count"]');
        const followingNode = document.querySelector('[data-e2e="following-count"]');
        const likesNode = document.querySelector('[data-e2e="likes-count"]');
        const avatarNode = document.querySelector('[data-e2e="user-avatar"]');

        let username: string | null = null;
        if (usernameNode && usernameNode.textContent) {
          const text = usernameNode.textContent.replace(/\s+/g, ' ').trim();
          if (text.length > 0) username = text;
        }

        let bio: string | null = null;
        if (bioNode && bioNode.textContent) {
          const text = bioNode.textContent.replace(/\s+/g, ' ').trim();
          if (text.length > 0) bio = text;
        }

        let followerCount = 0;
        if (followersNode && followersNode.textContent) {
          const rawFollowers = followersNode.textContent.replace(/\s+/g, '').replace(/,/g, '').toUpperCase();
          if (rawFollowers) {
            let multiplier = 1;
            if (rawFollowers.endsWith('M')) multiplier = 1_000_000;
            else if (rawFollowers.endsWith('K')) multiplier = 1_000;
            const numericFollowers = rawFollowers.replace(/[^0-9.]/g, '');
            const parsedFollowers = parseFloat(numericFollowers);
            if (!Number.isNaN(parsedFollowers)) followerCount = Math.floor(parsedFollowers * multiplier);
          }
        }

        let followingCount = 0;
        if (followingNode && followingNode.textContent) {
          const rawFollowing = followingNode.textContent.replace(/\s+/g, '').replace(/,/g, '').toUpperCase();
          if (rawFollowing) {
            let multiplier = 1;
            if (rawFollowing.endsWith('M')) multiplier = 1_000_000;
            else if (rawFollowing.endsWith('K')) multiplier = 1_000;
            const numericFollowing = rawFollowing.replace(/[^0-9.]/g, '');
            const parsedFollowing = parseFloat(numericFollowing);
            if (!Number.isNaN(parsedFollowing)) followingCount = Math.floor(parsedFollowing * multiplier);
          }
        }

        let totalLikes = 0;
        if (likesNode && likesNode.textContent) {
          const rawLikes = likesNode.textContent.replace(/\s+/g, '').replace(/,/g, '').toUpperCase();
          if (rawLikes) {
            let multiplier = 1;
            if (rawLikes.endsWith('M')) multiplier = 1_000_000;
            else if (rawLikes.endsWith('K')) multiplier = 1_000;
            const numericLikes = rawLikes.replace(/[^0-9.]/g, '');
            const parsedLikes = parseFloat(numericLikes);
            if (!Number.isNaN(parsedLikes)) totalLikes = Math.floor(parsedLikes * multiplier);
          }
        }
        const videoCount = document.querySelectorAll('[data-e2e="user-post-item"]').length;
        const avatarUrl =
          avatarNode instanceof HTMLImageElement && typeof avatarNode.src === 'string'
            ? avatarNode.src
            : null;

        return {
          username,
          bio,
          followerCount,
          followingCount,
          totalLikes,
          videoCount,
          avatarUrl,
        };
      });

      await context.close();

      if (!profileData.username) {
        throw new Error('Failed to extract profile data');
      }

      await this.saveProfile(username, profileData);

      console.log(`✅ Scraped @${username}: ${profileData.followerCount} followers`);

      return profileData;
    } catch (error) {
      await context.close();
      console.error(`❌ Failed to scrape @${username}:`, (error as Error).message);
      return null;
    } finally {
      if (context && this.sessionDir) {
        try {
          const storageStatePath = path.join(this.sessionDir, 'default', 'storage-state.json');
          await context.storageState({ path: storageStatePath });
          console.log('   💾 Saved authentication state');
        } catch (e) {
          console.warn(`   ⚠️ Could not save storage state: ${(e as Error).message}`);
        }
      }
      if (context) await context.close();
    }
  }

  private async saveProfile(username: string, data: ScrapedProfile): Promise<void> {
    const existing = await db
      .select()
      .from(creators)
      .where(eq(creators.username, username.toLowerCase()))
      .limit(1);

    const profileRecord = {
      tiktokId: username.toLowerCase(),
      username: data.username || username,
      followerCount: data.followerCount,
      followingCount: data.followingCount,
      totalLikes: data.totalLikes,
      videoCount: data.videoCount,
      bio: data.bio,
      profileData: {
        avatarUrl: data.avatarUrl,
        scrapedAt: new Date().toISOString(),
      },
      lastScrapedAt: new Date(),
    };

    if (existing.length > 0) {
      await db.update(creators).set(profileRecord).where(eq(creators.id, existing[0].id));
    } else {
      await db.insert(creators).values(profileRecord);
    }
  }

  async scrapeHashtag(hashtag: string, maxCreators = 50): Promise<string[]> {
    console.log(`🔍 Scraping hashtag: #${hashtag}`);
    console.log(`   URL: https://www.tiktok.com/tag/${hashtag}`);

    const context = await this.createStealthContext();
    const page = await context.newPage();

    try {
      console.log('   Loading page...');
      await page.goto(`https://www.tiktok.com/tag/${hashtag}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => null);
      await page.waitForTimeout(2000);

      // Check for error page and retry if needed
      if (await this.isErrorPage(page)) {
        console.warn('⚠️ TikTok returned an error page ("Something went wrong")');
        const retrySuccess = await this.retryWithRefresh(page, `https://www.tiktok.com/tag/${hashtag}`);
        if (!retrySuccess) {
          console.error('❌ Failed to recover from error page after retries');
          await context.close();
          return [];
        }
      }

      const sigiStateAvailable = await page
        .waitForSelector('script#SIGI_STATE', { timeout: 8000 })
        .catch(() => null);

      if (await this.isBotChallenge(page)) {
        console.warn(
          '⚠️ TikTok presented a verification challenge. Try running `npm run scrape:debug` and solve the challenge manually, or provide authenticated cookies.',
        );
        await context.close();
        return [];
      }

      if (!sigiStateAvailable) {
        console.warn('⚠️ Unable to find TikTok state payload (script#SIGI_STATE). Falling back to DOM scraping only.');
      }

      const creatorHandles = new Set<string>();
      let scrollAttempts = 0;
      const maxScrollsEnv = parseInt(process.env.SCRAPER_MAX_SCROLLS || '20', 10);
      const maxScrolls = Number.isNaN(maxScrollsEnv) ? 20 : maxScrollsEnv;

      while (creatorHandles.size < maxCreators && scrollAttempts < maxScrolls) {
        const extraction = await page.evaluate<{
          domHandles: string[];
          sigiHandles: string[];
          hasSigiState: boolean;
          sigiParseError: string | null;
        }>(() => {
          const selectors = [
            'a[href*="/@"]',
            '[data-e2e="user-link"]',
            '[data-e2e="search-card-user-link"]',
            '[data-e2e="challenge-item-user-card"] a[href*="/@"]',
          ];

          const domHandles = new Set<string>();
          selectors.forEach((selector) => {
            const elements = Array.from(document.querySelectorAll<HTMLAnchorElement>(selector));
            elements.forEach((link) => {
              const href = link.getAttribute('href') || '';
              const match = href.match(/@([^/?#]+)/);
              if (match && match[1]) {
                domHandles.add(match[1]);
              }
            });
          });

          const sigiHandles = new Set<string>();
          const sigiElement = document.querySelector<HTMLScriptElement>('script#SIGI_STATE');
          let sigiParseError: string | null = null;

          if (sigiElement?.textContent) {
            try {
              const state = JSON.parse(sigiElement.textContent) as {
                ItemModule?: Record<string, { author?: string }>;
                UserModule?: { users?: Record<string, { uniqueId?: string }> };
              };
              const itemModule = state?.ItemModule || {};
              const userModule = state?.UserModule?.users || {};

              Object.values(itemModule).forEach((item) => {
                if (item?.author) {
                  const user = userModule[item.author];
                  if (user?.uniqueId) {
                    sigiHandles.add(user.uniqueId);
                  } else if (typeof item.author === 'string') {
                    sigiHandles.add(item.author);
                  }
                }
              });

              Object.values(userModule).forEach((user) => {
                if (user?.uniqueId) {
                  sigiHandles.add(user.uniqueId);
                }
              });
            } catch (error) {
              sigiParseError = error instanceof Error ? error.message : String(error);
            }
          }

          return {
            domHandles: Array.from(domHandles),
            sigiHandles: Array.from(sigiHandles),
            hasSigiState: Boolean(sigiElement),
            sigiParseError,
          };
        });

        if (extraction.sigiParseError) {
          console.warn(`   Failed to parse SIGI_STATE payload: ${extraction.sigiParseError}`);
        }

        const combinedHandles = [...extraction.domHandles, ...extraction.sigiHandles];
        const newHandles = combinedHandles.filter((handle) => !creatorHandles.has(handle));
        newHandles.forEach((handle) => creatorHandles.add(handle));
        const newCount = newHandles.length;

        console.log(
          `   Scroll ${scrollAttempts + 1}: DOM=${extraction.domHandles.length}, SIGI=${extraction.sigiHandles.length}, new=${newHandles.length}, total=${creatorHandles.size}`,
        );

        if (newCount === 0 && scrollAttempts > 5) {
          console.log('   No new creators found after 5 scrolls, stopping');
          break;
        }

        await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
        await page.waitForTimeout(1500 + Math.floor(Math.random() * 500));
        scrollAttempts++;
      }

      await context.close();

      console.log(`✅ Found ${creatorHandles.size} creators from #${hashtag}`);
      return Array.from(creatorHandles);
    } catch (error) {
      await context.close();
      console.error(`❌ Failed to scrape hashtag #${hashtag}:`, (error as Error).message);
      return [];
    } finally {
      if (context && this.sessionDir) {
        try {
          const storageStatePath = path.join(this.sessionDir, 'default', 'storage-state.json');
          await context.storageState({ path: storageStatePath });
          console.log('   💾 Saved authentication state');
        } catch (e) {
          console.warn(`   ⚠️ Could not save storage state: ${(e as Error).message}`);
        }
      }
      if (context) await context.close();
    }
  }

  async scrapeMultipleProfiles(usernames: string[]): Promise<ScrapedProfile[]> {
    const results: ScrapedProfile[] = [];

    for (const username of usernames) {
      const data = await this.scrapeProfile(username);
      if (data) {
        results.push(data);
      }

      await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_MS));
    }

    return results;
  }
}

export default TikTokScraper;

if (require.main === module) {
  (async () => {
    const scraper = new TikTokScraper();

    try {
      await scraper.initialize();

      const hashtag = process.argv[2] || 'tiktokshop';
      const handles = await scraper.scrapeHashtag(hashtag, 20);

      console.log(`\n📊 Scraping ${handles.length} creator profiles...\n`);
      await scraper.scrapeMultipleProfiles(handles);

      console.log('\n✅ Scraping complete!');
    } catch (error) {
      console.error('❌ Scraper error:', error);
    } finally {
      await scraper.close();
      process.exit(0);
    }
  })();
}
