import fs from 'fs';
import path from 'path';
import os from 'os';
import { setTimeout as sleep } from 'timers/promises';
import { chromium } from 'playwright';
import crypto from 'crypto';

// Basic in-memory rate limiter to avoid aggressive behavior
class TokenBucket {
  constructor(capacity, refillPerSec) {
    this.capacity = capacity;
    this.refillPerSec = refillPerSec;
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }
  async take(cost = 1) {
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
};

function randomDesktopUA() {
  const windowsVersions = ['10.0', '11.0'];
  const winVer = windowsVersions[Math.floor(Math.random() * windowsVersions.length)];
  const chromeMajor = 120 + Math.floor(Math.random() * 5);
  const chromeBuild = `${chromeMajor}.0.${Math.floor(5000 + Math.random() * 1000)}.${Math.floor(100 + Math.random() * 50)}`;
  return `Mozilla/5.0 (Windows NT ${winVer}; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeBuild} Safari/537.36`;
}

function makeSessionDir(base) {
  const b = base ?? path.join(os.homedir(), '.tiktok-sessions');
  if (!fs.existsSync(b)) fs.mkdirSync(b, { recursive: true });
  const dir = path.join(b, 'default');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function initContext(opts) {
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
    proxy: proxy ? { server: proxy.server, username: proxy.username, password: proxy.password } : undefined,
  });
  const context = await browser.newContext({
    userAgent: ua,
    viewport: { width: 1920, height: 1080 },
    locale: 'en-US',
    colorScheme: 'dark',
    timezoneId: 'America/New_York',
  });

  // Manually add the ms_token if provided, as it's critical for session validity
  if (opts.msToken) {
    await context.addCookies([
      {
        name: 'ms_token',
        value: opts.msToken,
        domain: '.tiktok.com',
        path: '/',
        expires: Date.now() / 1000 + 365 * 24 * 60 * 60, // Expires in 1 year
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
    const originalQuery = window.navigator.permissions.query.bind(window.navigator.permissions);
    window.navigator.permissions.query = (parameters) =>
      parameters.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : originalQuery(parameters);
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

function looksLikeChallenge(html) {
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
  return needles.some(n => lower.includes(n.toLowerCase()));
}

async function humanize(page) {
  await sleep(400 + Math.floor(Math.random() * 600));
  await page.mouse.move(100 + Math.random() * 200, 100 + Math.random() * 300, { steps: 20 });
  await sleep(200 + Math.floor(Math.random() * 400));
  await page.mouse.move(250 + Math.random() * 150, 300 + Math.random() * 200, { steps: 15 });
  await sleep(150 + Math.floor(Math.random() * 350));
}

async function extractResults(page, max) {
  const results = [];
  const seen = new Set();

  const itemContainers = await page.$$('div[data-e2e="search-video-card"], div[data-e2e="search_top-item"]');

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

      // Extract username directly from the URL
      const usernameMatch = url.match(/@([^/]+)\/video/);
      const username = usernameMatch ? usernameMatch[1] : undefined;

      const meta = await container.evaluate((el) => {
        const getText = (selector) => {
          const node = el.querySelector(selector);
          if (!node) return null;
          const text = node.textContent || '';
          const normalized = text.replace(/\s+/g, ' ').trim();
          return normalized.length > 0 ? normalized : null;
        };

        const img = el.querySelector('a[href*="/video/"] img');

        return {
          caption:
            getText('[data-e2e="new-desc-span"]') ||
            getText('[data-e2e="search-card-video-caption"]'),
          authorName:
            getText('[data-e2e="search-card-user-unique-id"]') ||
            getText('[data-e2e="search-card-user-link"]') ||
            getText('[data-e2e="search-card-user-link"] p'),
          thumb: img?.getAttribute('src') || null,
          alt: img?.getAttribute('alt') || null,
        };
      }) ?? {};

      const cleanedFromAlt = meta?.alt
        ? meta.alt.split(/\s+created by\s+/i)[0]?.trim()
        : null;
      const mergedTitleRaw = (meta?.caption || cleanedFromAlt || '').trim();
      const title = mergedTitleRaw.length > 0 ? mergedTitleRaw : undefined;

      const authorName = meta?.authorName || username;
      const thumb = typeof meta?.thumb === 'string' && meta.thumb.trim().length > 0 ? meta.thumb : undefined;

      results.push({
        id,
        url,
        title,
        author: username ? {
          username,
          name: authorName?.trim?.() || authorName || username,
          profileUrl: `https://www.tiktok.com/@${username}`
        } : undefined,
        thumbnails: thumb ? [thumb] : undefined,
      });
    } catch (e) {
      console.warn('   Could not parse a search result item.', e.message);
    }
  }

  return results.slice(0, max);
}

export async function tiktokSearch(options) {
  const opts = { ...DEFAULTS, ...options };
  const bucket = new TokenBucket(5, 0.5);
  await bucket.take();

  const context = await initContext({ ...opts, msToken: options.msToken });
  const page = await context.newPage();
  page.setDefaultTimeout(opts.navigationTimeoutMs ?? DEFAULTS.navigationTimeoutMs);

  let challengeEncountered = false;

  try {
    // With an authenticated session, we can often go directly to the search URL
    const encodedQuery = encodeURIComponent(opts.query.trim());
    const searchUrl = `https://www.tiktok.com/search?q=${encodedQuery}&t=videos`;
    console.log(`   Navigating to search URL: ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });

    await humanize(page); // Still good to have some human-like interaction

    // Wait for search results to load on the page
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
    console.error('   ❌ An error occurred during the search interaction:', err.message);
    challengeEncountered = true;
    try {
      const debugDir = path.join(process.cwd(), 'playwright-debug');
      if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir);
      const errorHtmlPath = path.join(debugDir, `tiktok-search-error-${new Date().toISOString().replace(/:/g, '-')}.html`);
      fs.writeFileSync(errorHtmlPath, await page.content());
      console.log(`   📝 Saved page HTML to ${errorHtmlPath} for debugging.`);
    } catch (e) {
      console.error('   Failed to save debug HTML.', e);
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
