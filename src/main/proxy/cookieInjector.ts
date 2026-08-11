// Cookie injection via CDP Network.setCookies.
import puppeteer from 'puppeteer-core';

export async function injectCookies(
  wsEndpoint: string,
  cookies: Array<Record<string, unknown>>
): Promise<void> {
  if (!cookies.length) return;
  const browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint, defaultViewport: null });
  try {
    const targets = await browser.targets();
    const pageTarget = targets.find((t) => t.type() === 'page');
    if (!pageTarget) return;
    const session = await pageTarget.createCDPSession();
    await session.send('Network.setCookies', {
      cookies: cookies as unknown as Array<{ name: string; value: string }>,
    });
    await session.detach().catch(() => undefined);
  } finally {
    browser.disconnect();
  }
}
