import { api, type ProfileDetails } from './api';

export type PreflightStatus = 'pass' | 'warn' | 'fail';

/**
 * One diagnostic check, exactly as the backend serialises it.
 *
 * `reasonCode` and `detail` are the wire field names (`CheckVerdict` in
 * `src/main/preflight/types.ts`). They were declared here as `reason` and `message`, which do not
 * exist on the response — so the remediation lookup and the per-check summary both read
 * `undefined`, and the modal silently showed neither.
 */
export interface PreflightCheckVerdict {
  name: string;
  status: PreflightStatus;
  reasonCode?: string;
  detail: string;
  durationMs?: number;
}

/**
 * The preflight verdict as it actually arrives over HTTP.
 *
 * `checks` is an OBJECT keyed by check name and `checkList` is the same data as an array. This
 * type used to declare `checks` as an array, and the modal called `verdict.checks.map(...)` — a
 * TypeError on the first render, which unmounted the whole React tree (there is no error boundary)
 * and left the operator with a blank window: «точечный preflight чек не работает». The contract is
 * pinned by the backend's own tests (`tests/unit/preflight/preflightRoutes.test.ts` builds
 * `checks: {}` + `checkList: []`), so the array view lives in `checkList` — never in `checks`.
 */
export interface PreflightVerdict {
  profileId: string;
  overall: PreflightStatus;
  passed?: boolean;
  checks: Record<string, PreflightCheckVerdict>;
  checkList: PreflightCheckVerdict[];
  timestamp: number;
}

/**
 * The checks as an array, which is the only shape callers can iterate.
 *
 * `checkList` is authoritative because the backend builds it from the same map it serialises as
 * `checks`, and it carries each check's `name`. `Object.values` is the fallback for a verdict that
 * only has the map. Both consumers (`PreflightModal`, `Diagnostics`) go through here so the
 * object-vs-array mistake cannot be made a third time.
 */
export function checksOf(verdict: PreflightVerdict): PreflightCheckVerdict[] {
  if (Array.isArray(verdict.checkList) && verdict.checkList.length > 0) {
    return verdict.checkList;
  }
  return Object.entries(verdict.checks ?? {}).map(([name, check]) => ({ ...check, name }));
}

export const PREFLIGHT_REASON_REMEDIATION = {
  'proxy-not-found': {
    summary: 'Configured proxy record not found',
    hint: 'The proxy assigned to this profile was deleted or does not exist. Reassign a proxy or set profile to direct connection.',
  },
  'proxy-unreachable': {
    summary: 'Proxy endpoint is unreachable or connection failed',
    hint: 'Verify proxy credentials, host, port, server health, and firewall access.',
  },
  'geo-mismatch': {
    summary: 'Detected egress country does not match expected proxy country',
    hint: 'Check proxy server stability or upstream IP rotation settings.',
  },
  'geo-lookup-failed': {
    summary: 'Could not determine egress geo location',
    hint: 'Verify proxy connectivity and upstream IP lookup service availability.',
  },
  'tz-proxy-mismatch': {
    summary: 'Timezone does not match proxy location',
    hint: 'Update profile timezone in settings or configure auto-match to proxy location.',
  },
  'lang-mismatch': {
    summary: 'Language does not match proxy country',
    hint: 'Adjust browser Accept-Language and profile locale to match proxy origin.',
  },
  'webrtc-leak-risk': {
    summary: 'WebRTC routing may bypass proxy or leak local IP',
    hint: 'Proxy type cannot route UDP. Set WebRTC mode to disabled or use a SOCKS5 proxy.',
  },
  'dns-leak-risk': {
    summary: 'DNS queries may leak outside the proxy tunnel',
    hint: 'HTTP proxies do not tunnel raw DNS queries. Use SOCKS5 or configure DNS-over-HTTPS.',
  },
  'relay-unavailable': {
    summary: 'UDP/QUIC relay unavailable for proxy profile',
    hint: 'Browser will fall back to TCP/HTTP/2. Configure UDP relay or SOCKS5 with UDP associate for QUIC support.',
  },
  'coherence-fail': {
    summary: 'Critical fingerprint hardware incoherence detected',
    hint: 'Fingerprint hardware parameters (GPU, platform, architecture) conflict with catalog rules. Regenerate fingerprint.',
  },
  'coherence-warn': {
    summary: 'Fingerprint configuration has minor coherence warnings',
    hint: 'Review fingerprint settings or regenerate fingerprint to match standard browser families.',
  },
} satisfies Record<string, { summary: string; hint: string }>;

export function getRemediation(reason?: string, fallbackMessage?: string): { summary: string; hint: string } {
  if (reason && (PREFLIGHT_REASON_REMEDIATION as Record<string, { summary: string; hint: string }>)[reason]) {
    return (PREFLIGHT_REASON_REMEDIATION as Record<string, { summary: string; hint: string }>)[reason];
  }
  return {
    summary: fallbackMessage || reason || 'Check did not pass validation',
    hint: 'Review profile settings, proxy routing, and fingerprint parameters.',
  };
}

export const COUNTRY_TO_LANG = {
  US: 'en', GB: 'en', CA: 'en', AU: 'en', DE: 'de', FR: 'fr', ES: 'es', IT: 'it',
  RU: 'ru', UA: 'uk', BY: 'be', KZ: 'kk', CN: 'zh', JP: 'ja', KR: 'ko', BR: 'pt',
  PT: 'pt', NL: 'nl', PL: 'pl', TR: 'tr', IN: 'en', SG: 'en',
} satisfies Record<string, string>;

export type PreflightFixType = 'webrtc_policy' | 'timezone' | 'lang';

export interface PreflightAutoFix {
  type: PreflightFixType;
  label: string;
  labelRu: string;
  proposedValue: string;
  displayValue: string;
}

export interface PreflightFixItem {
  checkName: string;
  status: PreflightStatus;
  reasonCode?: string;
  detail: string;
  autoFix?: PreflightAutoFix;
  manualReason?: string;
  manualReasonRu?: string;
}

export interface PreflightFixPlan {
  fixableCount: number;
  unfixableCount: number;
  items: PreflightFixItem[];
}

export type FixOutcomeStatus = 'applied' | 'failed' | 'not-applicable';

export interface PreflightFixOutcome {
  checkName: string;
  actionType?: PreflightFixType;
  label: string;
  labelRu?: string;
  status: FixOutcomeStatus;
  detail: string;
  detailRu?: string;
}

function resolveCheckAutoFix(
  check: PreflightCheckVerdict,
  profile?: ProfileDetails | null
): PreflightAutoFix | null {
  const code = check.reasonCode || '';
  const name = check.name || '';

  if (code === 'webrtc-leak-risk' || code === 'webrtc-unprotected' || name === 'webrtc-hygiene') {
    return {
      type: 'webrtc_policy',
      label: 'WebRTC routing policy',
      labelRu: 'Политика WebRTC',
      proposedValue: 'disable_non_proxied_udp',
      displayValue: 'Disable non-proxied UDP (disable_non_proxied_udp)',
    };
  }

  if (code === 'tz-proxy-mismatch' || name === 'timezone-match') {
    let targetTz = profile?.proxy?.timezone;
    if (!targetTz && check.detail) {
      const m1 = check.detail.match(/Proxy timezone is '([^']+)'/i);
      const m2 = check.detail.match(/differs from proxy timezone '([^']+)'/i);
      targetTz = m1?.[1] || m2?.[1];
    }
    if (targetTz) {
      return {
        type: 'timezone',
        label: 'Profile timezone',
        labelRu: 'Часовой пояс профиля',
        proposedValue: targetTz,
        displayValue: targetTz,
      };
    }
  }

  if (code === 'lang-mismatch' || name === 'language-match') {
    let targetCountry = profile?.proxy?.country;
    if (!targetCountry && check.detail) {
      const m = check.detail.match(/proxy country '([^']+)'/i);
      if (m) {
        targetCountry = m[1];
      }
    }
    if (targetCountry) {
      const c = targetCountry.trim().toUpperCase();
      const targetLang = (COUNTRY_TO_LANG as Record<string, string>)[c] || 'en';
      return {
        type: 'lang',
        label: 'Fingerprint language',
        labelRu: 'Язык отпечатка',
        proposedValue: targetLang,
        displayValue: `${targetLang} (${c})`,
      };
    }
  }

  return null;
}

function resolveCheckManualReason(check: PreflightCheckVerdict): { manualReason: string; manualReasonRu: string } {
  const code = check.reasonCode || '';
  const name = check.name || '';

  if (code === 'dns-leak-risk' || name === 'dns-egress') {
    return {
      manualReason: 'HTTP proxies cannot tunnel raw DNS queries. Switch proxy type to SOCKS5 or configure DNS-over-HTTPS.',
      manualReasonRu: 'HTTP-прокси не поддерживают туннелирование чистого DNS. Переключитесь на SOCKS5 или используйте DNS-over-HTTPS.',
    };
  }
  if (code === 'relay-unavailable' || code === 'relay-disabled' || code === 'relay-error' || name === 'quic-relay-state') {
    return {
      manualReason: 'UDP/QUIC relay requires UDP relay infrastructure or SOCKS5 with UDP associate.',
      manualReasonRu: 'UDP/QUIC реле требует внешней инфраструктуры UDP-реле или SOCKS5 с UDP associate.',
    };
  }
  if (code === 'proxy-not-found') {
    return {
      manualReason: 'Configured proxy record does not exist. Assign an active proxy or set profile to direct connection.',
      manualReasonRu: 'Настроенная запись прокси не существует. Привяжите активный прокси или выберите прямое подключение.',
    };
  }
  if (code === 'proxy-unreachable' || code === 'proxy-auth-failed' || code === 'proxy-timeout' || code === 'proxy-error') {
    return {
      manualReason: 'Proxy endpoint is unreachable or credentials failed. Verify host, port, credentials, and firewall.',
      manualReasonRu: 'Прокси недоступен или неверны учетные данные. Проверьте хост, порт, логин/пароль и файрвол.',
    };
  }
  if (code === 'geo-mismatch' || name === 'egress-ip-geo') {
    return {
      manualReason: 'Detected egress country differs from expected proxy country. Verify upstream IP rotation or proxy provider.',
      manualReasonRu: 'Фактическая страна выхода отличается от страны прокси. Проверьте ротацию IP или настройки провайдера.',
    };
  }
  if (code === 'geo-lookup-failed') {
    return {
      manualReason: 'Could not determine egress geo location. Check proxy server connectivity and upstream lookup.',
      manualReasonRu: 'Не удалось определить геолокацию выхода. Проверьте связь с прокси и внешний сервис геодетекции.',
    };
  }
  if (code === 'coherence-fail' || code === 'coherence-warn' || name === 'coherence') {
    return {
      manualReason: 'Hardware fingerprint coherence issue detected. Regenerate fingerprint in profile settings.',
      manualReasonRu: 'Несогласованность параметров отпечатка. Перегенерируйте отпечаток в настройках профиля.',
    };
  }
  if (code === 'tz-proxy-mismatch' || name === 'timezone-match') {
    return {
      manualReason: 'Proxy does not declare a timezone to synchronize with.',
      manualReasonRu: 'Прокси не имеет заявленного часового пояса для синхронизации.',
    };
  }
  if (code === 'lang-mismatch' || name === 'language-match') {
    return {
      manualReason: 'Proxy does not declare a country to derive language.',
      manualReasonRu: 'У прокси не указана страна для определения языка.',
    };
  }
  return {
    manualReason: check.detail || 'Manual intervention required for this check.',
    manualReasonRu: check.detail || 'Требуется ручное исправление для этой проверки.',
  };
}

export function computePreflightFixPlan(
  verdict: PreflightVerdict | null,
  profile?: ProfileDetails | null
): PreflightFixPlan {
  if (!verdict) {
    return { fixableCount: 0, unfixableCount: 0, items: [] };
  }

  const checks = checksOf(verdict).filter((c) => c.status === 'warn' || c.status === 'fail');
  const items: PreflightFixItem[] = [];

  for (const check of checks) {
    const autoFix = resolveCheckAutoFix(check, profile);
    if (autoFix) {
      items.push({
        checkName: check.name,
        status: check.status,
        reasonCode: check.reasonCode,
        detail: check.detail,
        autoFix,
      });
    } else {
      const reasons = resolveCheckManualReason(check);
      items.push({
        checkName: check.name,
        status: check.status,
        reasonCode: check.reasonCode,
        detail: check.detail,
        manualReason: reasons.manualReason,
        manualReasonRu: reasons.manualReasonRu,
      });
    }
  }

  const fixableCount = items.filter((i) => Boolean(i.autoFix)).length;
  const unfixableCount = items.filter((i) => !i.autoFix).length;

  return { fixableCount, unfixableCount, items };
}

async function applySingleFix(
  profileId: string,
  fix: PreflightAutoFix,
  checkName: string
): Promise<PreflightFixOutcome> {
  const { type, proposedValue, label, labelRu } = fix;
  try {
    if (type === 'webrtc_policy') {
      const res = await api.profileUpdate({
        user_id: profileId,
        webrtc_policy: proposedValue as 'disable_non_proxied_udp',
      });
      return {
        checkName,
        actionType: type,
        label,
        labelRu,
        status: res.code === 0 ? 'applied' : 'failed',
        detail: res.code === 0 ? `WebRTC policy set to '${proposedValue}'` : (res.msg || 'Failed to update WebRTC policy'),
        detailRu: res.code === 0 ? `Политика WebRTC установлена в '${proposedValue}'` : (res.msg || 'Не удалось обновить политику WebRTC'),
      };
    }
    if (type === 'timezone') {
      const res = await api.profileUpdate({
        user_id: profileId,
        timezone: proposedValue,
      });
      return {
        checkName,
        actionType: type,
        label,
        labelRu,
        status: res.code === 0 ? 'applied' : 'failed',
        detail: res.code === 0 ? `Timezone set to '${proposedValue}'` : (res.msg || 'Failed to update timezone'),
        detailRu: res.code === 0 ? `Часовой пояс установлен в '${proposedValue}'` : (res.msg || 'Не удалось обновить часовой пояс'),
      };
    }
    if (type === 'lang') {
      const detailRes = await api.profileDetail(profileId);
      if (detailRes.code !== 0 || !detailRes.data) {
        return {
          checkName,
          actionType: type,
          label,
          labelRu,
          status: 'failed',
          detail: detailRes.msg || 'Failed to load profile details for fingerprint update',
          detailRu: detailRes.msg || 'Не удалось загрузить данные профиля для обновления отпечатка',
        };
      }
      const rawCfg = detailRes.data.fingerprint?.config;
      const cfg: Record<string, any> = rawCfg && typeof rawCfg === 'object' ? { ...rawCfg } : {};
      const fpRes = await api.profileUpdateFingerprint(profileId, { ...cfg, lang: proposedValue });
      return {
        checkName,
        actionType: type,
        label,
        labelRu,
        status: fpRes.code === 0 ? 'applied' : 'failed',
        detail: fpRes.code === 0 ? `Fingerprint language set to '${proposedValue}'` : (fpRes.msg || 'Failed to update fingerprint language'),
        detailRu: fpRes.code === 0 ? `Язык отпечатка установлен в '${proposedValue}'` : (fpRes.msg || 'Не удалось обновить язык отпечатка'),
      };
    }
  } catch (err) {
    return {
      checkName,
      actionType: type,
      label,
      labelRu,
      status: 'failed',
      detail: (err as Error).message || 'Unexpected error applying fix',
      detailRu: (err as Error).message || 'Непредвиденная ошибка при применении исправления',
    };
  }

  return {
    checkName,
    label,
    labelRu,
    status: 'failed',
    detail: 'Unknown fix type',
    detailRu: 'Неизвестный тип исправления',
  };
}

export async function applyPreflightFixes(
  profileId: string,
  plan: PreflightFixPlan
): Promise<PreflightFixOutcome[]> {
  const outcomes: PreflightFixOutcome[] = [];

  for (const item of plan.items) {
    if (!item.autoFix) {
      outcomes.push({
        checkName: item.checkName,
        label: item.checkName,
        status: 'not-applicable',
        detail: item.manualReason || 'No automatic fix available',
        detailRu: item.manualReasonRu || 'Авто-исправление недоступно',
      });
      continue;
    }

    const outcome = await applySingleFix(profileId, item.autoFix, item.checkName);
    outcomes.push(outcome);
  }

  return outcomes;
}
