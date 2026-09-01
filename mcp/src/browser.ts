import puppeteer, { Browser, Page } from 'puppeteer-core';
import { AntidetectClient } from '../../packages/sdk-node/dist/index.js';

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
