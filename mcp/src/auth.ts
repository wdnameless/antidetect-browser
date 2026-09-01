import * as crypto from 'node:crypto';

export interface TokenPayload {
  sub: string;
  aud: 'antidetect-mcp';
  scope: string;
  iat: number;
  exp: number;
  nonce?: string;
  [key: string]: unknown;
}

export const PROHIBITED_TOOL_NAMES = new Set<string>([
  'cdp.send',
  'cdp',
  'Runtime.evaluate',
  'runtime.evaluate',
  'Page.addScriptToEvaluateOnNewDocument',
  'process.exec',
  'child_process',
  'fs.read',
  'fs.write',
  'fs.delete',
  'credentials.dump',
  'credentials.extract',
  'evaluate_raw',
  'eval',
  'shell.exec',
]);

export const GATED_TOOL_NAMES = new Set<string>([
  'profiles.delete',
  'profiles.restore',
  'profiles.export_preserved',
  'profiles.cleanup_preserved',
  'browser.evaluate_allowlisted',
]);

export const DEFAULT_TOOL_NAMES = new Set<string>([
  'profiles.list',
  'profiles.get',
  'profiles.create',
  'profiles.start',
  'profiles.stop',
  'browser.navigate',
  'browser.click',
  'browser.type',
  'browser.screenshot',
  'diagnostics.run',
]);

export class NonceReplayDefense {
  private readonly seenNonces: Map<string, number> = new Map();
  private readonly windowMs: number;

  constructor(windowMs: number = 15 * 60 * 1000) {
    this.windowMs = windowMs;
  }

  public validateAndRecord(nonce: string, now: number = Date.now()): { valid: boolean; error?: string } {
    if (!nonce || typeof nonce !== 'string' || nonce.trim() === '') {
      return { valid: false, error: 'Nonce is required' };
    }

    this.cleanup(now);

    if (this.seenNonces.has(nonce)) {
      return { valid: false, error: `Replayed nonce detected: ${nonce}` };
    }

    this.seenNonces.set(nonce, now);
    return { valid: true };
  }

  private cleanup(now: number): void {
    const cutoff = now - this.windowMs;
    for (const [n, ts] of this.seenNonces.entries()) {
      if (ts < cutoff) {
        this.seenNonces.delete(n);
      }
    }
  }

  public clear(): void {
    this.seenNonces.clear();
  }
}

export class SessionTokenManager {
  private readonly secret: string;
  private readonly maxTtlSeconds: number;

  constructor(secret: string = process.env.ANTIDETECT_MCP_SECRET || 'antidetect-mcp-default-secret', maxTtlSeconds: number = 900) {
    this.secret = secret;
    this.maxTtlSeconds = Math.min(maxTtlSeconds, 900); // 15 mins max
  }

  public generateToken(sub: string, scope: string = 'standard', ttlSeconds?: number, nonce?: string): string {
    const now = Math.floor(Date.now() / 1000);
    const ttl = ttlSeconds !== undefined ? Math.min(ttlSeconds, this.maxTtlSeconds) : this.maxTtlSeconds;
    const payload: TokenPayload = {
      sub,
      aud: 'antidetect-mcp',
      scope,
      iat: now,
      exp: now + ttl,
      ...(nonce ? { nonce } : {}),
    };

    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto
      .createHmac('sha256', this.secret)
      .update(`${header}.${body}`)
      .digest('base64url');

    return `${header}.${body}.${signature}`;
  }

  public verifyToken(token: string, nowSec: number = Math.floor(Date.now() / 1000)): { valid: boolean; payload?: TokenPayload; error?: string } {
    if (!token || typeof token !== 'string') {
      return { valid: false, error: 'Token missing or invalid format' };
    }

    const parts = token.split('.');
    if (parts.length !== 3) {
      return { valid: false, error: 'Invalid JWT structure' };
    }

    const [headerB64, bodyB64, signature] = parts;
    const expectedSig = crypto
      .createHmac('sha256', this.secret)
      .update(`${headerB64}.${bodyB64}`)
      .digest('base64url');

    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return { valid: false, error: 'Invalid token signature' };
    }

    try {
      const payload = JSON.parse(Buffer.from(bodyB64, 'base64url').toString('utf8')) as TokenPayload;

      if (payload.aud !== 'antidetect-mcp') {
        return { valid: false, error: `Invalid audience: expected antidetect-mcp, got ${payload.aud}` };
      }

      if (payload.exp && payload.exp < nowSec) {
        return { valid: false, error: `Token expired at ${payload.exp}, current ${nowSec}` };
      }

      return { valid: true, payload };
    } catch (err) {
      return { valid: false, error: `Malformed token payload: ${String(err)}` };
    }
  }
}

export function isProhibitedTool(toolName: string): boolean {
  if (PROHIBITED_TOOL_NAMES.has(toolName)) {
    return true;
  }
  const lower = toolName.toLowerCase();
  if (
    lower.includes('cdp') ||
    lower.includes('runtime.eval') ||
    lower.includes('child_process') ||
    lower.includes('process.exec') ||
    lower.includes('credentials') ||
    lower.includes('fs.read') ||
    lower.includes('fs.write')
  ) {
    return true;
  }
  return false;
}

export function isAuthorized(toolName: string, callerScope: string = 'standard', allowedGatedEnv?: string): boolean {
  if (isProhibitedTool(toolName)) {
    return false;
  }

  if (DEFAULT_TOOL_NAMES.has(toolName)) {
    return true;
  }

  if (GATED_TOOL_NAMES.has(toolName)) {
    if (callerScope === 'admin' || callerScope === 'profile:write_danger') {
      return true;
    }
    const envList = allowedGatedEnv !== undefined ? allowedGatedEnv : (process.env.ANTIDETECT_MCP_GATED || '');
    if (envList) {
      const allowed = envList.split(',').map((s) => s.trim().toLowerCase());
      if (allowed.includes('*') || allowed.includes(toolName.toLowerCase())) {
        return true;
      }
    }
    return false;
  }

  // Unknown tools are unauthorized by default
  return false;
}
