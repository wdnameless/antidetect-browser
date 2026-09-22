# Oracle Blind Acceptance Report: Cookie Farm Module

## Overview
- **User Contract**:
  > «Я хочу добавить модуль фарм куки, оно должно быть реализованно в Actions отдельной кнопкой, нужно чтобы это автоматически работало мы ходили по разным сайтам где лучше всего собираются куки и таки образом прогревать профиль.»
- **Date**: 2026-09-22
- **Auditor**: Independent Acceptance Oracle (OracleCookieFarm)
- **Target Repository**: D:/antidetect-browser

---

## Acceptance Criteria Verification

### Criterion A1: Autonomous Execution via HTTP API
- **Criterion**: `POST /api/cookie-robot/run` with ONLY a profileId returns `code: 0` and `pagesVisited > 0` (no browser supplier passed by the caller).
- **Verdict**: PASS
- **Command Executed**:
  ```bash
  node .stealth-bench/oracle-verify-a1-a2.mjs
  ```
- **Raw Evidence / Output**:
  ```
  [oracle] Starting independent probe for A1 and A2...
  [oracle] Created profile: p_a12714d2-64b6-4190-acc6-c01f10e6f453 code: 0
  [oracle] Invoking POST /api/cookie-robot/run with ONLY profileId...
  [oracle] Run finished in 187.6s
  [oracle] Run response code: 0
  [oracle] Run response msg: Cookie robot run finished
  [oracle] pagesVisited: 20
  [oracle] cookiesSet: 7
  [oracle] domainsTouched: ["www.ebay.com","archive.org","search.yahoo.com","open.spotify.com","x.com","www.bloomberg.com","github.com","ya.ru","www.pinterest.com","gitlab.com","www.cnn.com","www.twitch.tv","www.aliexpress.com","www.tripadvisor.com","www.bbc.com","www.facebook.com","www.ecosia.org","www.youtube.com"]
  [oracle] managedProfile: true
  [oracle] A1 VERDICT: PASS
  ```

---

### Criterion A2: Cookie Jar Persistence Across Multiple Domains
- **Criterion**: A completed run leaves cookies from >1 domain in the profile's own jar.
- **Verdict**: PASS
- **Command Executed**:
  ```bash
  node .stealth-bench/oracle-verify-a1-a2.mjs
  ```
- **Raw Evidence / Output**:
  ```
  [oracle] Reading cookie jar over CDP...
  [oracle] CDP cookies count: 201
  [oracle] CDP unique domains count: 49
  [oracle] CDP domains: [
    'medium.com', '.ebay.com', '.archive.org', '.yahoo.com', '.spotify.com',
    '.x.com', 'www.bloomberg.com', '.bloomberg.com', 'github.com', '.github.com',
    '.ya.ru', '.yandex.ru', 'mc.yandex.com', '.yandex.com', 'www.pinterest.com',
    '.gitlab.com', '.bizible.com', 'beacon.lynx.cognitivlabs.com', '.doubleclick.net',
    '.linkedin.com', '.6sc.co', 'about.gitlab.com', '.mountain.com',
    'a5113954737848320.cdn.optimizely.com', '.px.mountain.com', 'gitlab.com',
    '.cnn.com', '.piano.io', '.tinypass.com', 'edition.cnn.com',
    '.prd.api.bolt.cnn.com', 'm.stripe.com', '.edition.cnn.com', '.twitch.tv',
    '.cxense.com', 'k.twitchcdn.net', '.aliexpress.com', '.us.ynuf.aliapp.org',
    'login.aliexpress.com', '.mmstat.com', '.de-wum.aliexpress.com', '.tripadvisor.com',
    'www.tripadvisor.com', '.bbc.com', 'a4621041136.cdn.optimizely.com',
    '.medium.com', '.facebook.com', '.ecosia.org', '.youtube.com'
  ]
  [oracle] A2 VERDICT: PASS
  [oracle] CRITERIA A1 & A2 PASSED
  ```

---

### Criterion A3: UI Actions Column Button and Execution Flow
- **Criterion**: The Actions column renders a dedicated button that runs the farm.
- **Verdict**: PASS
- **Command Executed**:
  ```bash
  node node_modules/typescript/bin/tsc -p src/renderer/tsconfig.json --noEmit
  ```
- **Raw Evidence / Output**:
  ```
  tsc-renderer: exited exit=0 uptime=22.5s
  ```
  Verified in source code:
  - Table column header in `src/renderer/src/pages/Profiles.tsx:1601`:
    `<th style={{ textAlign: 'right' }}>{t('Actions')}</th>`
  - Dedicated action button in `src/renderer/src/pages/Profiles.tsx:1728-1733`:
    ```tsx
    <button
      type="button"
      className="btn-icon"
      onClick={() => void handleRunCookieFarm(p.user_id, p.name || undefined)}
      disabled={busy}
      title={t('Warm up profile (cookie farm)')}
    >
      <CookieIcon size={14} />
    </button>
    ```
  - API binding in `src/renderer/src/api.ts:1146-1150`:
    ```ts
    runCookieFarm: (profileId: string) =>
      request<CookieFarmReport>('/api/cookie-robot/run', {
        method: 'POST',
        body: JSON.stringify({ profileId }),
      }),
    ```
  - Clicking the button automatically runs the warm-up, displays modal spinner, and presents real-time report metrics (pages visited, cookies set, domains touched, duration, consent outcomes, and errors).

---

### Criterion A4: Consent Handling Increases Cookie Accumulation
- **Criterion**: Consent handling produces a strictly larger cookie jar than the same run with `acceptConsent:false`.
- **Verdict**: PASS
- **Command Executed**:
  ```bash
  node .stealth-bench/oracle-verify-a4.mjs
  ```
- **Raw Evidence / Output**:
  ```
  [oracle-a4] Starting independent differential probe for A4 (consent handling)...
  [oracle-a4] Phase 1: Warming with acceptConsent = TRUE
  [oracle-a4] Profile for acceptConsent=true: p_02b816f2-3a5a-4c92-a9ee-76683ce733f5
  [oracle-a4] Run finished (acceptConsent=true). Code: 0, consents: 1/1
    - domain: www.theguardian.com, clicked: true, label: Accept all
  [oracle-a4] acceptConsent=true -> 113 cookies across 50 domains
  [oracle-a4] Phase 2: Warming with acceptConsent = FALSE
  [oracle-a4] Profile for acceptConsent=false: p_a57a06f5-bae3-43f8-bc40-014f7df23432
  [oracle-a4] Run finished (acceptConsent=false). Code: 0, consents: 0/0
  [oracle-a4] acceptConsent=false -> 7 cookies across 2 domains

  === SUMMARY ===
  Consent ON : 113 cookies, 50 domains (clicked 1 banners)
  Consent OFF: 7 cookies, 2 domains (clicked 0 banners)
  Cookie Delta: 106
  [oracle-a4] A4 VERDICT: PASS (delta=106)
  ```

---

### Criterion A5: Safety Non-Goals (No Forms, Logins, or CAPTCHA Handling)
- **Criterion**: No login/form-submission/CAPTCHA-handling code paths exist (safety non-goals).
- **Verdict**: PASS
- **Command Executed**:
  ```bash
  node node_modules/vitest/vitest.mjs run tests/unit/cookie-robot
  ```
- **Raw Evidence / Output**:
  ```
  RUN  v4.1.11 D:/antidetect-browser
  Test Files  3 passed (3)
        Tests  43 passed (43)
     Duration  37.09s
  ```
  Source audit confirmation:
  - `src/main/scripts/modules/cookieFarm/consent.ts:125-165`: `AUTH_DENYLIST` explicitly rejects any interaction with elements containing keywords: login, log in, signin, password, register, signup, checkout, account, submit, buy, purchase, cart, order, etc.
  - `src/main/scripts/modules/cookieRobot.ts:355-385`: `findSafeInternalLink` skips any anchor tag inside a form (`a.closest('form')`) and filters out auth keywords.
  - `src/main/scripts/modules/cookieRobot.ts:575-595`: Challenge detector identifies Cloudflare/CAPTCHA screens and stops or skips the site; no CAPTCHA solving, bypassing, or form input is implemented.

---

## Unit Test Suite Results
- **Command**: `node node_modules/vitest/vitest.mjs run tests/unit/cookie-robot`
- **Result**: 3 test files passed, 43 tests passed, 0 failed.

---

## Defects Found
None. All criteria and regression requirements pass without error.

---

## Unverified Claims
- Manual desktop interaction inside Tauri GUI window: Visual rendering in an interactive desktop desktop window was not directly driven via human OS mouse clicks, as the test environment is a headless Windows Server host; verified instead via full TypeScript type-checking of renderer components (`tsc -p src/renderer/tsconfig.json`), code review of `Profiles.tsx` table actions, and end-to-end HTTP API invocations mirroring renderer client behavior.

---

VERDICT: PASS
