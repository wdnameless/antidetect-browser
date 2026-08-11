// Proxy authentication via CDP Fetch domain.
// The fingerprint-chromium kernel's --proxy-server flag does NOT support
// password authentication, so we attach to the browser's CDP endpoint and
// answer auth challenges with Fetch.continueWithAuth.
import puppeteer from 'puppeteer-core';

export interface ProxyCredentials {
  username: string;
  password: string;
}

/**
 * Attach to a running profile browser and install a Fetch auth handler.
 * Returns a cleanup function that disconnects the CDP client.
 */
export async function installProxyAuth(
  wsEndpoint: string,
  credentials: ProxyCredentials
): Promise<() => void> {
  const browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint, defaultViewport: null });
  const targets = await browser.targets();
  const pageTarget = targets.find((t) => t.type() === 'page');
  if (!pageTarget) {
    browser.disconnect();
    throw new Error('no page target available for proxy auth');
  }
  const session = await pageTarget.createCDPSession();
  await session.send('Fetch.enable', {
    patterns: [{ urlPattern: '*', requestStage: 'Request' }],
    handleAuthRequests: true,
  });
  session.on('Fetch.authRequired', (event) => {
    void session
      .send('Fetch.continueWithAuth', {
        requestId: event.requestId,
        authChallengeResponse: {
          response: 'ProvideCredentials',
          username: credentials.username,
          password: credentials.password,
        },
      })
      .catch(() => undefined);
  });
  session.on('Fetch.requestPaused', (event) => {
    void session
      .send('Fetch.continueRequest', { requestId: event.requestId })
      .catch(() => undefined);
  });

  return () => {
    browser.disconnect();
  };
}
