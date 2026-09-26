export interface FarmSite {
  url: string;
  category: 'search' | 'social' | 'commerce' | 'news' | 'media' | 'reference' | 'dev';
  weight: number;
}

/**
 * Curated list of high-traffic, durable cookie-setting sites across 7 major categories.
 * Reachable without mandatory authentication; weights reflect cookie value for profile warming.
 */
export const FARM_SITES: readonly FarmSite[] = [
  // Search engines: universal tracking, geo-targeting, and search session cookies
  { url: 'https://www.google.com', category: 'search', weight: 3 },
  { url: 'https://www.bing.com', category: 'search', weight: 2 },
  { url: 'https://duckduckgo.com', category: 'search', weight: 1 },
  { url: 'https://ya.ru', category: 'search', weight: 3 },
  { url: 'https://search.yahoo.com', category: 'search', weight: 2 },
  { url: 'https://www.ecosia.org', category: 'search', weight: 1 },

  // Social networks: persistent tracking pixels, device IDs, and engagement telemetry
  { url: 'https://www.reddit.com', category: 'social', weight: 3 },
  { url: 'https://x.com', category: 'social', weight: 3 },
  { url: 'https://www.facebook.com', category: 'social', weight: 3 },
  { url: 'https://www.linkedin.com', category: 'social', weight: 3 },
  { url: 'https://www.pinterest.com', category: 'social', weight: 2 },
  { url: 'https://www.tumblr.com', category: 'social', weight: 1 },

  // Commerce: cart session identifiers, high-value advertising tokens, and currency cookies
  { url: 'https://www.amazon.com', category: 'commerce', weight: 3 },
  { url: 'https://www.ebay.com', category: 'commerce', weight: 3 },
  { url: 'https://www.etsy.com', category: 'commerce', weight: 2 },
  { url: 'https://www.aliexpress.com', category: 'commerce', weight: 3 },
  { url: 'https://www.ozon.ru', category: 'commerce', weight: 3 },

  // News portals: CMP consent records, ad-network identifiers, and paywall counters
  { url: 'https://www.cnn.com', category: 'news', weight: 2 },
  { url: 'https://www.bbc.com', category: 'news', weight: 2 },
  { url: 'https://www.nytimes.com', category: 'news', weight: 2 },
  { url: 'https://www.theguardian.com', category: 'news', weight: 2 },
  { url: 'https://www.reuters.com', category: 'news', weight: 2 },
  { url: 'https://www.bloomberg.com', category: 'news', weight: 2 },

  // Media & streaming: content delivery cookies, player preference tokens, and analytics
  { url: 'https://www.youtube.com', category: 'media', weight: 3 },
  { url: 'https://open.spotify.com', category: 'media', weight: 3 },
  { url: 'https://www.twitch.tv', category: 'media', weight: 3 },
  { url: 'https://vimeo.com', category: 'media', weight: 1 },
  { url: 'https://soundcloud.com', category: 'media', weight: 2 },
  { url: 'https://www.dailymotion.com', category: 'media', weight: 1 },

  // Reference & encyclopedias: language preferences and session cache tokens
  { url: 'https://www.wikipedia.org', category: 'reference', weight: 1 },
  { url: 'https://www.wikihow.com', category: 'reference', weight: 1 },
  { url: 'https://www.imdb.com', category: 'reference', weight: 2 },
  { url: 'https://www.tripadvisor.com', category: 'reference', weight: 2 },
  { url: 'https://www.goodreads.com', category: 'reference', weight: 1 },
  { url: 'https://archive.org', category: 'reference', weight: 1 },

  // Developer & technical: auth pre-flight, CDN routing, and tech-stack cookies
  { url: 'https://github.com', category: 'dev', weight: 3 },
  { url: 'https://stackoverflow.com', category: 'dev', weight: 2 },
  { url: 'https://gitlab.com', category: 'dev', weight: 2 },
  { url: 'https://dev.to', category: 'dev', weight: 1 },
  { url: 'https://medium.com', category: 'dev', weight: 2 },
  { url: 'https://www.npmjs.com', category: 'dev', weight: 1 },

  /*
   * Second wave, added after MEASURING each candidate against a real browser rather than assuming
   * it would be useful. Every entry below was loaded headless, allowed to settle, and kept only if
   * it set cookies without authentication — the count in the comment is that measurement.
   *
   * Three candidates were dropped for a specific reason worth recording: `producthunt.com`,
   * `ikea.com` and `stackexchange.com` all answered with a Cloudflare interstitial ("Just a
   * moment...", "Attention Required!") instead of content. They set a challenge cookie, not a
   * normal browsing footprint, and the robot treats a challenge page as a skip — so listing them
   * would spend a page visit to collect nothing. `quora.com`, `bbc.co.uk`, `news.ycombinator.com`
   * and `angel.co` set no cookies at all and were dropped for that.
   *
   * Cookie count is the weight: a site leaving 15+ cookies seeds a richer footprint than one
   * leaving 3, and the weighted selection favours them without excluding the rest.
   */

  // Commerce — the heaviest cookie setters measured (cart sessions, currency, ad tokens)
  { url: 'https://www.walmart.com', category: 'commerce', weight: 3 },      // 17
  { url: 'https://www.target.com', category: 'commerce', weight: 3 },       // 17
  { url: 'https://www.alibaba.com', category: 'commerce', weight: 3 },      // 15
  { url: 'https://www.flipkart.com', category: 'commerce', weight: 3 },     // 15
  { url: 'https://www.rakuten.com', category: 'commerce', weight: 3 },      // 13
  { url: 'https://www.airbnb.com', category: 'commerce', weight: 2 },       // 9
  { url: 'https://www.booking.com', category: 'commerce', weight: 2 },      // 7-9

  // News — CMP consent records and ad-network identifiers
  { url: 'https://edition.cnn.com', category: 'news', weight: 3 },          // 21
  { url: 'https://www.forbes.com', category: 'news', weight: 3 },           // 11
  { url: 'https://www.wired.com', category: 'news', weight: 2 },            // 7
  { url: 'https://arstechnica.com', category: 'news', weight: 1 },          // 2
  { url: 'https://www.theverge.com', category: 'news', weight: 2 },         // 6

  // Media & streaming — player preferences, analytics, recommendation state
  { url: 'https://www.last.fm', category: 'media', weight: 3 },             // 14
  { url: 'https://www.metacritic.com', category: 'media', weight: 2 },      // 9
  { url: 'https://www.rottentomatoes.com', category: 'media', weight: 2 },  // 9
  { url: 'https://www.deezer.com', category: 'media', weight: 1 },          // 4
  { url: 'https://www.ign.com', category: 'media', weight: 1 },             // 5
  { url: 'https://store.steampowered.com', category: 'media', weight: 1 },  // 3

  // Reference & weather — location and language preference cookies
  { url: 'https://www.accuweather.com', category: 'reference', weight: 3 }, // 11
  { url: 'https://weather.com', category: 'reference', weight: 2 },         // 7
  { url: 'https://www.trustpilot.com', category: 'reference', weight: 1 },  // 3
  { url: 'https://www.g2.com', category: 'reference', weight: 1 },          // 3
  { url: 'https://www.crunchbase.com', category: 'reference', weight: 1 },  // 3
  { url: 'https://www.timeanddate.com', category: 'reference', weight: 1 }, // 1

  // Dev infrastructure — CDN routing and session tokens
  { url: 'https://www.digitalocean.com', category: 'dev', weight: 3 },      // 13
  /* namecheap.com set 13-15 cookies in one pass and served a Cloudflare challenge in
     another. A coin-flip site wastes a page visit and logs a spurious error, so it is excluded
     until its challenge rate is zero. */
  /* cloudflare.com measured 3 cookies but is unusable here: its own URL contains the word
     "cloudflare", which the robot's challenge detector matches, so every visit would be
     skipped as a challenge and reported as an error. */
] as const;

/**
 * 32-bit Mulberry32 PRNG.
 * Provides high-entropy deterministic pseudo-random floats in [0, 1) without pulling in external math libraries.
 */
function createPrng(seed: number): () => number {
  let s = Math.trunc(seed) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministically selects a distinct subset of sites across diverse categories.
 * Category round-robin prevents domain clustering, while site weights bias selection toward higher-value targets.
 */
export function selectFarmSites(seed: number, count: number): FarmSite[] {
  // Clamp requested count within valid bounds [1, FARM_SITES.length]
  const targetCount = Math.max(1, Math.min(Math.trunc(count) || 1, FARM_SITES.length));
  const rand = createPrng(seed);

  const categories: FarmSite['category'][] = [
    'search',
    'social',
    'commerce',
    'news',
    'media',
    'reference',
    'dev',
  ];

  // Group sites into category pools to enable round-robin interleaving
  const pools = new Map<FarmSite['category'], FarmSite[]>();
  for (const cat of categories) {
    pools.set(cat, []);
  }
  for (const site of FARM_SITES) {
    pools.get(site.category)!.push({ ...site });
  }

  const selected: FarmSite[] = [];
  let activeCategories = [...categories];

  while (selected.length < targetCount && activeCategories.length > 0) {
    // Shuffle active categories each round so category pick order varies with seed
    for (let i = activeCategories.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = activeCategories[i];
      activeCategories[i] = activeCategories[j];
      activeCategories[j] = tmp;
    }

    for (let k = 0; k < activeCategories.length && selected.length < targetCount; k++) {
      const cat = activeCategories[k];
      const pool = pools.get(cat)!;
      if (pool.length === 0) continue;

      let totalWeight = 0;
      for (let i = 0; i < pool.length; i++) {
        totalWeight += pool[i].weight;
      }

      let roll = rand() * totalWeight;
      let chosenIndex = pool.length - 1;
      for (let i = 0; i < pool.length; i++) {
        roll -= pool[i].weight;
        if (roll <= 0) {
          chosenIndex = i;
          break;
        }
      }

      const [chosen] = pool.splice(chosenIndex, 1);
      selected.push(chosen);
    }

    // Filter out exhausted categories to maintain efficient round-robin progression
    activeCategories = activeCategories.filter((cat) => pools.get(cat)!.length > 0);
  }

  return selected;
}
