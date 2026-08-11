// WebRTC / UDP leak validation.
// Launches a profile on the fingerprint kernel, gathers WebRTC ICE candidates
// in-page, and reports which IPs (local/public) leak.
// The kernel default policy disables non-proxied UDP (--disable-non-proxied-udp),
// which should suppress UDP-based WebRTC leaks.
// Run: $env:API_PORT="50342"; npx tsx scripts/verify-webrtc.ts
import puppeteer from 'puppeteer-core';
import { startService } from '../src/main/index';
import { getApiKey, API_HOST, API_PORT } from '../src/main/config';

interface CandidateInfo {
  type: string; // host | srflx | prflx | relay
  ip: string;
  protocol: string;
  raw: string;
}

const GATHER_JS = `
async () => {
  const candidates = [];
  const PC = window.RTCPeerConnection || window.webkitRTCPeerConnection || window.mozRTCPeerConnection;
  const info = {
    hasRTCPeerConnection: !!window.RTCPeerConnection,
    hasWebkitRTC: !!window.webkitRTCPeerConnection,
    hasMediaDevices: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
  };
  if (!PC) {
    return { supported: false, ...info, candidates: [] };
  }
  try {
    await new Promise((resolve) => {
      const pc = new PC({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
      pc.createDataChannel('leak-test');
      pc.onicecandidate = (e) => {
        if (e.candidate && e.candidate.candidate) {
          candidates.push(e.candidate.candidate);
        }
      };
      pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === 'complete') {
          try { pc.close(); } catch (_) {}
          resolve();
        }
      };
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .catch(() => resolve());
      setTimeout(() => { try { pc.close(); } catch (_) {} resolve(); }, 6000);
    });
  } catch (err) {
    return { supported: true, ...info, error: String(err), candidates };
  }
  return { supported: true, ...info, candidates };
}
`;

function parseCandidate(raw: string): CandidateInfo | null {
  // candidate:FOUNDATION COMPONENT PROTO PRIORITY IP PORT typ TYPE ...
  const m = raw.match(/candidate:\S+\s+\d+\s+(\S+)\s+\d+\s+(\S+)\s+(\d+)\s+typ\s+(\S+)/);
  if (!m) return null;
  return { protocol: m[1], ip: m[2], type: m[4], raw };
}

function isPrivateIp(ip: string): boolean {
  return (
    /^10\./.test(ip) ||
    /^192\.168\./.test(ip) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
    ip === '127.0.0.1'
  );
}

async function gatherForProfile(label: string, base: string, headers: Record<string, string>): Promise<void> {
  const created = await fetch(`${base}/api/v1/browser-profile/create`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: label }),
  }).then((r) => r.json());
  const id: string = created?.data?.user_id;
  if (!id) throw new Error(`create failed: ${JSON.stringify(created)}`);

  const started = await fetch(`${base}/api/v1/browser/start?user_id=${id}`, { headers }).then((r) => r.json());
  if (started?.code !== 0) throw new Error(`start failed: ${started?.msg}`);

  const browser = await puppeteer.connect({ browserWSEndpoint: started.data.ws.puppeteer, defaultViewport: null });
  try {
    const pages = await browser.pages();
    const page = pages[0] ?? (await browser.newPage());
    await page.goto('about:blank');
    await page.reload();

    const result = (await page.evaluate(GATHER_JS)) as {
      supported: boolean;
      hasRTCPeerConnection?: boolean;
      hasWebkitRTC?: boolean;
      hasMediaDevices?: boolean;
      error?: string;
      candidates: string[];
    };

    console.log(`\n--- ${label} ---`);
    console.log(
      `RTCPeerConnection=${result.hasRTCPeerConnection} webkitRTC=${result.hasWebkitRTC} mediaDevices=${result.hasMediaDevices}`
    );
    if (!result.supported) {
      console.log('WebRTC API NOT available -> WebRTC/UDP leak fully mitigated (WebRTC disabled in kernel)');
      return;
    }
    if (result.error) console.log('gather error:', result.error);

    const parsed = result.candidates.map(parseCandidate).filter((c): c is CandidateInfo => c !== null);
    if (parsed.length === 0) {
      console.log('No ICE candidates gathered (UDP suppressed -> WebRTC leak mitigated)');
      return;
    }
    const seen = new Set<string>();
    let leakedPrivate = false;
    let leakedPublic = false;
    for (const c of parsed) {
      const key = `${c.type}:${c.ip}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const priv = isPrivateIp(c.ip);
      if (priv) leakedPrivate = true;
      else if (c.type === 'srflx' || c.type === 'relay') leakedPublic = true;
      console.log(`  [${c.type}] ${c.ip} (${c.protocol})`);
    }
    console.log(
      `  => private-IP leak: ${leakedPrivate ? 'YES' : 'no'}; public-IP (srflx/relay) leak: ${leakedPublic ? 'YES' : 'no'}`
    );
  } finally {
    browser.disconnect();
    await fetch(`${base}/api/v1/browser/stop?user_id=${id}`, { headers });
  }
}

async function main(): Promise<void> {
  await startService();
  const base = `http://${API_HOST}:${API_PORT}`;
  const headers = { Authorization: `Bearer ${getApiKey()}`, 'Content-Type': 'application/json' };

  await gatherForProfile('webrtc-noproxy', base, headers);

  console.log('\n=== NOTE ===');
  console.log(
    'Kernel default policy disables non-proxied UDP. With no proxy, UDP candidates should be suppressed.\n' +
      'A real leak test with a SOCKS proxy requires an external proxy; the UDP policy routes/blocks UDP accordingly.'
  );
  process.exit(0);
}

main().catch((err) => {
  console.error('WEBRTC TEST FAILED', err);
  process.exit(1);
});
