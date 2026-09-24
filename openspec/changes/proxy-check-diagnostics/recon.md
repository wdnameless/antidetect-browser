# Recon — proxy check failure with a residential proxy

## Reported
> «Проблема во время чека прокси, это резиденсткие прокси
> (…login:password@lime.proxyhub.team:8080…) в формате login:password@ip:port»

Screenshot: the proxy check reported
`✕ Proxy check failed: request to http://ip-api.com/json/?fields=… failed, reason: connect ETIMEDOUT 10.250.249.66:8080`

## What the evidence actually showed

| Step | Method | Result |
|---|---|---|
| Does the proxy work at all? | `curl -x http://user:pass@lime.proxyhub.team:8080` | **200**, exit IP `148.74.22.12`, US / The Bronx |
| Does DNS resolve correctly? | `dns.lookup` + `nslookup` | yes — `51.195.126.46` and friends, all public |
| Does the app's own path work? | `POST /api/v1/proxy/test` against the operator's **running** instance | **6/6 ok**, and 6/6 again concurrently |
| Does Node's own resolver differ? | `dns.lookup` from Node 24 | no — same public addresses |
| Is there a route to `10.250.x`? | `Get-NetRoute` | **none**, and no VPN adapter |
| Does any code rewrite the host? | grep `proxy.host` | no — passed verbatim to the agent |

So the proxy, the DNS on this machine, and our code path were all correct **here**. The reported
`10.250.249.66` is RFC1918: the operator's machine resolved a public proxy hostname to a private
address, and the request never left it.

That is a real defect even though this machine cannot reproduce it, because:

1. **The message blamed the wrong party.** `connect ETIMEDOUT 10.250.249.66:8080` reads as a network
   or provider fault. The provider was not at fault, and the address is one only a local resolver
   can produce. The operator was sent to the wrong place.
2. **Nothing retried.** Reproduced here against the operator's own running instance:
   `Parse Error: Missing expected CR after response line` — a rotating residential gateway returns
   that occasionally, and the next identical request succeeds. One transient bad response was
   reported as a dead proxy.

## Changes

**`src/main/proxy/proxyManager.ts`**
- Resolve the host with `dns.lookup` **before** dialing. A private, loopback, link-local or CGNAT
  answer is reported as the DNS problem it is, naming the host and the wrong address, and saying
  explicitly that it is not a fault in the proxy.
- Retry **once** on a transport-level failure (parse error, reset, timeout). A well-formed answer
  saying the proxy is bad is a fact and is returned immediately.

**`src/main/util/ipInfo.ts`**
- `isPrivateOrLocal` extracted here, because the network diagnostic already had a local copy of the
  same list. One implementation, so the two cannot drift. Covers RFC1918, loopback, link-local and
  CGNAT (the local copy omitted CGNAT, so `100.64.x` read as public in the leak check).

**`src/renderer/src/proxyParse.ts` + the proxy host field**
- Accepts the provider's single line — `login:password@host:port`, with or without a scheme. A bare
  hostname returns null by design, so the ordinary case is untouched. Splits on the **last** `@`,
  because a password may contain one.

## Acceptance check

- Working proxy still passes: `ok: true`, `148.74.22.12`, 560 ms — the fixes do not block good proxies.
- `10.250.249.66` now reports *"is a private address; a public proxy cannot be reached there"*.
- A host resolving privately reports *"resolved to the private address … This is a DNS problem on
  this computer, not a fault in the proxy"*.
- `isPrivateOrLocal`: 17/17 boundary cases (including `172.15`/`172.32` staying public, and CGNAT).
- Pasting the full provider line into the host field fills host, port, username and password.
- `tests/unit/proxyParse.test.ts`: 10 cases, including a password containing `@`.

## Note on the suite
`tests/unit/mcpBundle.test.ts` takes ~47s per run with a 60s timeout, so it times out whenever other
heavy work shares the machine (measured 81–443s under load, 47s alone). It shares no files with this
change. Both this and the earlier `Worker exited unexpectedly` are environmental.
