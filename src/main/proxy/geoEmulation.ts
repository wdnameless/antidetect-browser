// Geolocation spoofing via CDP.
// Applies Emulation.setGeolocationOverride and auto-grants the geolocation
// permission for every origin the profile visits (permission must be granted
// per-origin; a wildcard origin is not accepted by CDP).
// Keeps a persistent CDP connection (like proxyAuth) and returns a cleanup fn.
import puppeteer, { Page, Target } from 'puppeteer-core';

export interface GeoConfig {
  latitude: number;
  longitude: number;
  accuracy?: number;
}

export async function applyGeolocation(wsEndpoint: string, geo: GeoConfig): Promise<() => void> {
  const browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint, defaultViewport: null });

  const override = {
    latitude: geo.latitude,
    longitude: geo.longitude,
    accuracy: geo.accuracy ?? 50,
  };

  const setupPage = async (page: Page): Promise<void> => {
    try {
      const session = await page.createCDPSession();
      await session.send('Emulation.setGeolocationOverride', override);

      const grantForCurrentOrigin = async (): Promise<void> => {
        try {
          const origin = await page
            .evaluate(() => (globalThis as unknown as { location?: { origin?: string } }).location?.origin ?? '')
            .catch(() => '');
          if (origin && origin !== 'null') {
            await session
              .send('Browser.grantPermissions', { origin, permissions: ['geolocation'] })
              .catch(() => undefined);
          }
        } catch {
          // ignore
        }
      };

      page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) void grantForCurrentOrigin();
      });
      void grantForCurrentOrigin();
    } catch {
      // ignore per-page setup failures
    }
  };

  const pages = await browser.pages();
  for (const page of pages) await setupPage(page);

  const onTarget = async (target: Target): Promise<void> => {
    if (target.type() !== 'page') return;
    const page = await target.page().catch(() => null);
    if (page) await setupPage(page);
  };
  browser.on('targetcreated', (target) => void onTarget(target));

  return () => browser.disconnect();
}
