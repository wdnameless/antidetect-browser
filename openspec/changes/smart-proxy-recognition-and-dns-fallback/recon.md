# Recon: Smart Proxy Recognition & Resilient Proxy Check DNS Fallback

## Motivation
1. **False-positive proxy check failure on private/local address**:
   - The operator encountered: `Proxy check failed: lime.proxyhub.team resolved to the private address 10.250.249.66, so the request never left this machine...`
   - Root cause: `describeUnreachableResolution` in `proxyManager.ts` unconditionally rejected any proxy whose hostname resolved to an RFC1918 private address via local system DNS, refusing to even attempt a connection. On machines with corporate DNS, ISP DNS intercept/NAT, or local proxies/VPNs, `lime.proxyhub.team` resolved to `10.250.249.66`.
   - Furthermore, rotating residential proxies like `lime.proxyhub.team` send HTTP response headers terminated with bare `\n` instead of `\r\n`. Without `insecureHTTPParser: true`, Node.js throws `Parse Error: Missing expected CR after response line`.
   - Fix:
     - Implemented `resolveProxyHost`: if a public domain resolves to a private IP via local DNS or fails, it falls back to public DNS resolvers (`1.1.1.1`, `8.8.8.8`, `77.88.8.8`) and Cloudflare DoH to discover the real public gateway IP. Local proxies (127.0.0.1, 192.168.x.x, .local, localhost) are dialed directly without blocking.
     - Implemented `httpCheck` with native Node.js `http.request({ ..., insecureHTTPParser: true })`, eliminating `Missing expected CR after response line` parse crashes and returning clear, actionable HTTP status messages (e.g. HTTP 407 Proxy Authentication Required).
2. **Smart Proxy Recognition ("умное распознавание прокси")**:
   - The operator requested the ability to paste a proxy string in any format and have it automatically parsed into host, port, login, password, and protocol.
   - Enhanced `src/renderer/src/proxyParse.ts` to parse:
     - `host:port:user:pass` (common CIS/residential provider export format)
     - `ip:port:user:pass`
     - `user:pass:host:port`
     - `user:pass@host:port`
     - `scheme://...` (http, https, socks5, ssh)
     - `host:port`
     - Delimiters: colon (`:`), semicolon (`;`), pipe (`|`), tab (`\t`), spaces
     - Leaves bare hostnames/IPs alone to preserve normal field editing.
   - Added Quick Proxy String input and `onPaste` / `onChange` auto-parsing to both `Profiles.tsx` (Custom Proxy) and `Proxies.tsx` (Add Proxy modal).

## Files Touched
- `src/renderer/src/proxyParse.ts`: Enhanced `parseProxyInput` with multi-format pattern detection.
- `tests/unit/proxyParse.test.ts`: Added 6 unit tests covering all formats, delimiters, and edge cases.
- `src/renderer/src/pages/Profiles.tsx`: Added Quick Proxy String input and `onPaste` auto-parsing for Custom Proxy.
- `src/renderer/src/pages/Proxies.tsx`: Added Quick Proxy String input and `onPaste` auto-parsing for proxy management modal.
- `src/main/proxy/proxyManager.ts`: Added `resolveProxyHost` with public DNS fallback, native `httpCheck` with `insecureHTTPParser: true`, and removed premature blocking check.

## Verification
- Unit test suite `proxyParse.test.ts`: 16/16 passed.
- Full Vitest suite: 158 passed (1324 tests).
- TypeScript typecheck (renderer + main): 0 errors.
