import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { setTimeout as sleep } from 'timers/promises';
import { chromium, type BrowserContext, type Page } from 'playwright';

interface ProxyConfig {
  server: string;
  username?: string;
  password?: string;
}

export interface TiktokSearchOptions {
  query: string;
  maxResults?: number;
  maxScrolls?: number;
  headless?: boolean;
  sessionDir?: string;
  userAgent?: string;
  proxy?: ProxyConfig;
  msToken?: string;
  navigationTimeoutMs?: number;
}

export interface TiktokSearchResultItem {
  id: string;
  url: string;
  title?: string;
  author?: {
    username: string;
    name: string;
    profileUrl: string;
  };
  thumbnails?: string[];
}

export interface TiktokSearchResult {
  results: TiktokSearchResultItem[];
  challengeEncountered: boolean;
}

class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  async take(cost = 1): Promise<void> {
    while (true) {
      const now = Date.now();
      const elapsedSec = (now - this.lastRefill) / 1000;
      const refill = elapsedSec * this.refillPerSec;
      if (refill > 0) {
        this.tokens = Math.min(this.capacity, this.tokens + refill);
        this.lastRefill = now;
      }
      if (this.tokens >= cost) {
        this.tokens -= cost;
        return;
      }
      await sleep(250);
    }
  }
}

const DEFAULTS = {
  maxResults: 50,
  maxScrolls: 15,
  headless: true,
  challengeBackoffMs: 45_000,
  navigationTimeoutMs: 45_000,
  jitterMs: 300,
} as const;

function randomDesktopUA(): string {
  const windowsVersions = ['10.0', '11.0'];
  const winVer = windowsVersions[Math.floor(Math.random() * windowsVersions.length)];
  const chromeMajor = 120 + Math.floor(Math.random() * 5);
  const chromeBuild = `${chromeMajor}.0.${Math.floor(5000 + Math.random() * 1000)}.${Math.floor(
    100 + Math.random() * 50,
  )}`;
  return `Mozilla/5.0 (Windows NT ${winVer}; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeBuild} Safari/537.36`;
}

function makeSessionDir(base: string | null | undefined): string {
  const root = base ?? path.join(os.homedir(), '.tiktok-sessions');
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
  const dir = path.join(root, 'default');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function initContext(opts: TiktokSearchOptions): Promise<BrowserContext> {
  const sessionDir = makeSessionDir(opts.sessionDir ?? null);
  const ua = opts.userAgent ?? randomDesktopUA();
  const args = [
    '--disable-blink-features=AutomationControlled',
    '--disable-dev-shm-usage',
    '--no-sandbox',
    '--disable-features=IsolateOrigins,site-per-process',
  ];
  const proxy = opts.proxy ?? null;
  const browser = await chromium.launch({
    headless: opts.headless ?? DEFAULTS.headless,
    args,
    proxy: proxy
      ? { server: proxy.server, username: proxy.username, password: proxy.password }
      : undefined,
  });
  const context = await browser.newContext({
    userAgent: ua,
    viewport: { width: 1920, height: 1080 },
    locale: 'en-US',
    colorScheme: 'dark',
    timezoneId: 'America/New_York',
  });

  if (opts.msToken) {
    await context.addCookies([
      {
        name: 'ms_token',
        value: opts.msToken,
        domain: '.tiktok.com',
        path: '/',
        expires: Date.now() / 1000 + 365 * 24 * 60 * 60,
        httpOnly: false,
        secure: true,
        sameSite: 'Lax',
      },
    ]);
    console.log('   🔑 Injected ms_token to authenticate session.');
  }

  const cookieFile = path.join(sessionDir, 'cookies.json');
  if (fs.existsSync(cookieFile)) {
    try {
      const cookies = JSON.parse(fs.readFileSync(cookieFile, 'utf-8'));
      await context.addCookies(cookies);
    } catch {
      // ignore corrupt cookies
    }
  }

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'plugins', { get: () => [{}, {}, {}] });

    const w = window as typeof window & { chrome?: { runtime?: unknown } };
    w.chrome = w.chrome || {};
    w.chrome.runtime = w.chrome.runtime || {};

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

  context.on('close', async () => {
    try {
      const cookies = await context.cookies();
      fs.writeFileSync(cookieFile, JSON.stringify(cookies, null, 2));
    } catch {
      // ignore
    }
  });

  return context;
}

function looksLikeChallenge(html: string): boolean {
  const needles = [
    'tiktok.com/404.html',
    'data-captcha',
    'hcaptcha',
    'cf-chl-bypass',
    'Access Denied',
    'Just a moment...',
    'verify you are human',
    'unusual traffic',
  ];
  const lower = html.toLowerCase();
  return needles.some((needle) => lower.includes(needle.toLowerCase()));
}

async function humanize(page: Page): Promise<void> {
  await sleep(400 + Math.floor(Math.random() * 600));
  await page.mouse.move(100 + Math.random() * 200, 100 + Math.random() * 300, { steps: 20 });
  await sleep(200 + Math.floor(Math.random() * 400));
  await page.mouse.move(250 + Math.random() * 150, 300 + Math.random() * 200, { steps: 15 });
  await sleep(150 + Math.floor(Math.random() * 350));
}

async function extractResults(page: Page, max: number): Promise<TiktokSearchResultItem[]> {
  const results: TiktokSearchResultItem[] = [];
  const seen = new Set<string>();

  const itemContainers = await page.$$(
    'div[data-e2e="search-video-card"], div[data-e2e="search_top-item"]',
  );

  for (const container of itemContainers) {
    if (results.length >= max) break;

    try {
      const videoLinkEl = await container.$('a[href*="/video/"]');
      if (!videoLinkEl) continue;

      const href = await videoLinkEl.getAttribute('href');
      if (!href) continue;

      const url = new URL(href, 'https://www.tiktok.com').toString();
      const idMatch = url.match(/video\/(\d+)/);
      const id = idMatch ? idMatch[1] : crypto.createHash('sha256').update(url).digest('hex');
      if (seen.has(id)) continue;
      seen.add(id);

      const usernameMatch = url.match(/@([^/]+)\/video/);
      const username = usernameMatch ? usernameMatch[1] : undefined;

      const meta = (await container.evaluate((el) => {
        const captionSelectors = [
          '[data-e2e="new-desc-span"]',
          '[data-e2e="search-card-video-caption"]',
        ];
        let caption: string | null = null;
        for (let i = 0; i < captionSelectors.length; i += 1) {
          const selector = captionSelectors[i];
          const node = el.querySelector(selector) as HTMLElement | null;
          if (node && node.textContent) {
            const normalized = node.textContent.replace(/\s+/g, ' ').trim();
            if (normalized.length > 0) {
              caption = normalized;
              break;
            }
          }
        }

        const authorSelectors = [
          '[data-e2e="search-card-user-unique-id"]',
          '[data-e2e="search-card-user-link"]',
          '[data-e2e="search-card-user-link"] p',
        ];
        let authorName: string | null = null;
        for (let i = 0; i < authorSelectors.length; i += 1) {
          const selector = authorSelectors[i];
          const node = el.querySelector(selector) as HTMLElement | null;
          if (node && node.textContent) {
            const normalized = node.textContent.replace(/\s+/g, ' ').trim();
            if (normalized.length > 0) {
              authorName = normalized;
              break;
            }
          }
        }

        const img = el.querySelector('a[href*="/video/"] img') as HTMLImageElement | null;
        const thumb = img ? img.getAttribute('src') : null;
        const alt = img ? img.getAttribute('alt') : null;

        return {
          caption,
          authorName,
          thumb,
          alt,
        };
      })) as { caption: string | null; authorName: string | null; thumb: string | null; alt: string | null };

      const cleanedFromAlt =
        typeof meta.alt === 'string' ? meta.alt.split(/\s+created by\s+/i)[0]?.trim() ?? null : null;
      const mergedTitleRaw = (meta.caption || cleanedFromAlt || '').trim();
      const title = mergedTitleRaw.length > 0 ? mergedTitleRaw : undefined;

      const authorName = meta.authorName || username;
      const thumb =
        typeof meta.thumb === 'string' && meta.thumb.trim().length > 0 ? meta.thumb : undefined;

      results.push({
        id,
        url,
        title,
        author: username
          ? {
              username,
              name: authorName ? authorName.trim() : username,
              profileUrl: `https://www.tiktok.com/@${username}`,
            }
          : undefined,
        thumbnails: thumb ? [thumb] : undefined,
      });
    } catch (error) {
      console.warn('   Could not parse a search result item.', (error as Error).message);
    }
  }

  return results.slice(0, max);
}

export async function tiktokSearch(options: TiktokSearchOptions): Promise<TiktokSearchResult> {
  const opts = {
    ...DEFAULTS,
    ...options,
  } as TiktokSearchOptions & typeof DEFAULTS & { query: string };

  const bucket = new TokenBucket(5, 0.5);
  await bucket.take();

  const context = await initContext(opts);
  const page = await context.newPage();
  page.setDefaultTimeout(opts.navigationTimeoutMs ?? DEFAULTS.navigationTimeoutMs);

  let challengeEncountered = false;

  try {
    const encodedQuery = encodeURIComponent(opts.query.trim());
    const searchUrl = `https://www.tiktok.com/search?q=${encodedQuery}&t=videos`;
    console.log(`   Navigating to search URL: ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });

    await humanize(page);

    const resultsSelector = '[data-e2e="search-result-item"], a[href*="/video/"]';
    console.log('   Waiting for search results to load...');
    await page.waitForSelector(resultsSelector, { timeout: 20000 });

    const firstContent = await page.content();
    if (looksLikeChallenge(firstContent)) {
      challengeEncountered = true;
      throw new Error('Anti-bot challenge detected after search');
    }

    const maxScrolls = opts.maxScrolls ?? DEFAULTS.maxScrolls;
    for (let i = 0; i < maxScrolls; i++) {
      await page.evaluate(() => window.scrollBy({ top: 1000, behavior: 'smooth' }));
      await sleep(750 + Math.floor(Math.random() * 400));
      await humanize(page);
      const html = await page.content();
      if (looksLikeChallenge(html)) {
        challengeEncountered = true;
        break;
      }
    }

    const results = await extractResults(page, opts.maxResults ?? DEFAULTS.maxResults);
    return { results, challengeEncountered };
  } catch (err) {
    console.error('   ❌ An error occurred during the search interaction:', (err as Error).message);
    challengeEncountered = true;
    try {
      const debugDir = path.join(process.cwd(), 'playwright-debug');
      if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir);
      const errorHtmlPath = path.join(
        debugDir,
        `tiktok-search-error-${new Date().toISOString().replace(/:/g, '-')}.html`,
      );
      fs.writeFileSync(errorHtmlPath, await page.content());
      console.log(`   📝 Saved page HTML to ${errorHtmlPath} for debugging.`);
    } catch (error) {
      console.error('   Failed to save debug HTML.', error);
    }
    return { results: [], challengeEncountered };
  } finally {
    try {
      const cookies = await context.cookies();
      const sessionDir = makeSessionDir(opts.sessionDir ?? null);
      fs.writeFileSync(path.join(sessionDir, 'cookies.json'), JSON.stringify(cookies, null, 2));
    } catch {
      // ignore
    }
    await context.close().catch(() => null);
  }
}
