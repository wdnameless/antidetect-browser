import * as path from 'path';
import { chromium } from 'playwright-core';
import { getRunningWs } from '../launcher/chromium';

export async function loadExtensionRuntime(profileId: string, extensionPath: string): Promise<boolean> {
  const ws = getRunningWs(profileId);
  if (!ws) {
    return false;
  }

  try {
    const browser = await chromium.connectOverCDP(`ws://127.0.0.1:${ws}`);
    const contexts = browser.contexts();
    if (contexts.length > 0) {
      // Runtime extension loading via CDP session on context if needed
    }
    await browser.close();
    return true;
  } catch {
    return false;
  }
}
