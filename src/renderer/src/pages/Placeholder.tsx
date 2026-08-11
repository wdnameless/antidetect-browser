const PHASE_HINTS: Record<string, string> = {
  proxies: 'Proxy manager — Phase 3 (HTTP/HTTPS/SOCKS5/SSH, per-profile binding, checking).',
  fingerprints: 'Fingerprint manager — Phase 2 (kernel-level spoofing via patched Chromium).',
  devices: 'Device presets & switching — Phase 4 (Win/macOS/iOS/Android).',
  settings: 'Settings — Phase 5 (API key, ports, kernel path, packaging).',
};

export function Placeholder({ page }: { page: string }) {
  return (
    <section>
      <header className="page-header">
        <h1 className="capitalize">{page}</h1>
      </header>
      <div className="placeholder">{PHASE_HINTS[page] ?? 'Coming soon.'}</div>
    </section>
  );
}
