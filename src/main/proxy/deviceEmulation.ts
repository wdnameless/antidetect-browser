// Mobile device emulation via CDP (touch, screen metrics, UA override).
// The kernel handles desktop OS spoofing natively; mobile is emulated at the CDP layer.
import puppeteer from 'puppeteer-core';
import type { DeviceEmulationConfig } from '../profiles/profileManager';

export async function applyDeviceEmulation(
  wsEndpoint: string,
  cfg: DeviceEmulationConfig
): Promise<() => void> {
  const browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint, defaultViewport: null });
  const targets = await browser.targets();
  const pageTarget = targets.find((t) => t.type() === 'page');
  if (!pageTarget) {
    browser.disconnect();
    throw new Error('no page target for device emulation');
  }
  const session = await pageTarget.createCDPSession();

  if (cfg.screen) {
    await session.send('Emulation.setDeviceMetricsOverride', {
      width: cfg.screen.width,
      height: cfg.screen.height,
      deviceScaleFactor: cfg.screen.deviceScaleFactor ?? 1,
      mobile: cfg.mobile ?? false,
    });
  }
  if (cfg.touch) {
    await session.send('Emulation.setTouchEmulationEnabled', {
      enabled: true,
      maxTouchPoints: cfg.maxTouchPoints ?? 5,
    });
  }
  if (cfg.ua) {
    await session.send('Emulation.setUserAgentOverride', { userAgent: cfg.ua });
  }

  return () => browser.disconnect();
}
