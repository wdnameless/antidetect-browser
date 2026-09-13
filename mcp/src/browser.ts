import puppeteer, { Browser, Page, KeyInput } from 'puppeteer-core';
import { AntidetectClient } from '@antidetect/sdk';
import { deriveMotorSeed } from '../../src/main/motion/seeds';
import { planGlide } from '../../src/main/motion/trajectory';
import { planTyping } from '../../src/main/motion/typing';

/** Stable non-cryptographic seed from a profile id string (FNV-1a). */
function hashStringToSeed(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return (hash % 2147483646) + 1;
}
export class BrowserDriver {
  private readonly client: AntidetectClient;
  private readonly browserCache: Map<string, Browser> = new Map();

  constructor(client: AntidetectClient) {
    this.client = client;
  }

  private async getOrConnectBrowser(profileId: string): Promise<Browser> {
    const cached = this.browserCache.get(profileId);
    if (cached && cached.connected) {
      return cached;
    }

    // Check if profile is running, or start it
    let wsEndpoint: string | undefined;
    try {
      const activeResp = await this.client.browser.list({ page: 1, page_size: 100 });
      const activeProfiles = activeResp.data?.list || [];
      const found = activeProfiles.find((p: { user_id: string }) => p.user_id === profileId);
    } catch {
      // ignore check error, proceed to start
    }

    if (!wsEndpoint) {
      const startResp = await this.client.browser.start(profileId);
      const startData = startResp.data as { ws?: { puppeteer?: string }; debug_port?: number; port?: number; wsEndpoint?: string } | undefined;
      wsEndpoint = startData?.ws?.puppeteer || startData?.wsEndpoint;
      if (!wsEndpoint && (startData?.debug_port || startData?.port)) {
        const port = startData.debug_port || startData.port;
        wsEndpoint = `http://127.0.0.1:${port}`;
      }
    }
    if (!wsEndpoint) {
      throw new Error(`Failed to obtain CDP endpoint for profile ${profileId}`);
    }

    const browser = await puppeteer.connect({
      browserWSEndpoint: wsEndpoint.startsWith('ws') ? wsEndpoint : undefined,
      browserURL: !wsEndpoint.startsWith('ws') ? wsEndpoint : undefined,
    });

    this.browserCache.set(profileId, browser);
    return browser;
  }

  private async getActivePage(browser: Browser): Promise<Page> {
    const pages = await browser.pages();
    if (pages.length > 0) {
      return pages[0];
    }
    return await browser.newPage();
  }

  public async navigate(profileId: string, url: string): Promise<{ url: string; status: number | null }> {
    const browser = await this.getOrConnectBrowser(profileId);
    const page = await this.getActivePage(browser);
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    return {
      url: page.url(),
      status: resp ? resp.status() : null,
    };
  }

  public async click(profileId: string, selector: string): Promise<{ clicked: boolean; selector: string }> {
    const browser = await this.getOrConnectBrowser(profileId);
    const page = await this.getActivePage(browser);
    await page.waitForSelector(selector, { timeout: 10000 });
    await page.click(selector);
    return { clicked: true, selector };
  }

  public async type(profileId: string, selector: string, text: string): Promise<{ typed: boolean; selector: string }> {
    const browser = await this.getOrConnectBrowser(profileId);
    const page = await this.getActivePage(browser);
    await page.waitForSelector(selector, { timeout: 10000 });
    await page.type(selector, text);
    return { typed: true, selector };
  }

  /**
   * Human typing via the Motion plan engine: per-key delays from the profile's
   * motor seed, optional typo + Backspace correction. Types in real time.
   */
  public async humanType(
    profileId: string,
    selector: string,
    text: string,
    allowTypos = false
  ): Promise<{ typed: boolean; selector: string; durationMs: number }> {
    const browser = await this.getOrConnectBrowser(profileId);
    const page = await this.getActivePage(browser);
    await page.waitForSelector(selector, { timeout: 10000 });
    const seed = deriveMotorSeed(hashStringToSeed(profileId));
    const plan = planTyping(text, seed, 1, allowTypos);
    await page.focus(selector);
    for (const key of plan.keys) {
      // withResolvers needs es2024 lib; mcp targets older ES — executor form required.
      await new Promise((resolve) => setTimeout(resolve, key.delayMs));
      if (key.type === 'down') {
        await page.keyboard.down(key.key as KeyInput);
      } else {
        await page.keyboard.up(key.key as KeyInput);
      }
    }
    return { typed: true, selector, durationMs: plan.durationMs };
  }

  /**
   * Human click via a Fitts-law glide from the current pointer position to the
   * element center, with seeded jitter along a bezier path.
   */
  public async humanClick(
    profileId: string,
    selector: string,
    targetWidth = 32
  ): Promise<{ clicked: boolean; selector: string; durationMs: number }> {
    const browser = await this.getOrConnectBrowser(profileId);
    const page = await this.getActivePage(browser);
    await page.waitForSelector(selector, { timeout: 10000 });
    const handle = await page.$(selector);
    if (!handle) {
      throw new Error(`humanClick: selector ${selector} not found`);
    }
    const box = await handle.boundingBox();
    if (!box) {
      throw new Error(`humanClick: selector ${selector} has no bounding box`);
    }
    const to = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const seed = deriveMotorSeed(hashStringToSeed(profileId));
    const from = { x: Math.max(0, to.x - 200), y: Math.max(0, to.y - 120) };
    const glide = planGlide(from, to, targetWidth, seed, 1);
    for (const move of glide.moves) {
      await page.mouse.move(move.x, move.y);
      if (move.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, move.delayMs));
      }
    }
    await page.mouse.down();
    await new Promise((resolve) => setTimeout(resolve, 60 + (seed % 40)));
    await page.mouse.up();
    return { clicked: true, selector, durationMs: glide.durationMs };
  }

  public async screenshot(profileId: string, fullPage: boolean = false): Promise<{ format: string; base64: string; sizeBytes: number }> {
    const browser = await this.getOrConnectBrowser(profileId);
    const page = await this.getActivePage(browser);
    const buffer = (await page.screenshot({
      fullPage,
      encoding: 'binary',
      type: 'png',
    })) as Buffer;

    const maxCap = 5 * 1024 * 1024; // 5MB cap
    if (buffer.length > maxCap) {
      throw new Error(`Screenshot size ${buffer.length} exceeds max allowed cap of ${maxCap} bytes`);
    }

    return {
      format: 'image/png',
      base64: buffer.toString('base64'),
      sizeBytes: buffer.length,
    };
  }

  public async evaluateAllowlisted(profileId: string, scriptCode: string, params: Record<string, unknown>): Promise<unknown> {
    const browser = await this.getOrConnectBrowser(profileId);
    const page = await this.getActivePage(browser);

    const result = await page.evaluate(
      (codeStr: string, paramObj: Record<string, unknown>) => {
        // Execute the allowlisted function template safely
        const fn = new Function(`return (${codeStr})`)();
        return fn(paramObj);
      },
      scriptCode,
      params
    );

    return result;
  }

  public async disconnect(profileId: string): Promise<void> {
    const cached = this.browserCache.get(profileId);
    if (cached) {
      try {
        await cached.disconnect();
      } catch {
        // ignore disconnect error
      }
      this.browserCache.delete(profileId);
    }
  }

  public async closeAll(): Promise<void> {
    for (const [id, browser] of this.browserCache.entries()) {
      try {
        await browser.disconnect();
      } catch {
        // ignore
      }
    }
    this.browserCache.clear();
  }
}
