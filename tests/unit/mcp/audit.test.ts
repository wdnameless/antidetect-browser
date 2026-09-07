import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { McpAuditLogger, verifyLog, RETENTION_MONTHS } from '../../../mcp/src/audit';
import { SessionTokenManager, TokenRevocationList } from '../../../mcp/src/auth';

describe('MCP Audit Logging & Auth Verification', () => {
  let tempAuditPath: string;
  let logger: McpAuditLogger;

  beforeEach(() => {
    tempAuditPath = path.join(os.tmpdir(), `mcp-audit-test-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
    logger = new McpAuditLogger(tempAuditPath);
  });

  afterEach(() => {
    if (fs.existsSync(tempAuditPath)) {
      try {
        fs.unlinkSync(tempAuditPath);
      } catch {
        // ignore
      }
    }
  });

  it('generates SHA-256 hash-chained JSONL records', () => {
    const r1 = logger.log({
      nonce: 'nonce-1',
      tool: 'profiles.list',
      args: { limit: 10 },
      decision: 'allow',
      caller: 'test-agent',
    });

    const r2 = logger.log({
      nonce: 'nonce-2',
      tool: 'browser.navigate',
      args: { profile_id: 'p1', url: 'https://example.com' },
      decision: 'allow',
      caller: 'test-agent',
    });

    const r3 = logger.log({
      nonce: 'nonce-3',
      tool: 'profiles.delete',
      args: { profile_id: 'p1' },
      decision: 'deny',
      error: 'Forbidden',
      caller: 'test-agent',
    });

    expect(r1.prevHash).toBe('0'.repeat(64));
    expect(r2.prevHash).toBe(r1.hash);
    expect(r3.prevHash).toBe(r2.hash);

    const verification = verifyLog(tempAuditPath);
    expect(verification.valid).toBe(true);
    expect(verification.totalRecords).toBe(3);
  });

  it('detects tampering or mutation in hash chain', () => {
    logger.log({
      nonce: 'nonce-1',
      tool: 'profiles.list',
      args: {},
      decision: 'allow',
    });

    logger.log({
      nonce: 'nonce-2',
      tool: 'browser.navigate',
      args: { url: 'https://example.com' },
      decision: 'allow',
    });

    logger.log({
      nonce: 'nonce-3',
      tool: 'profiles.delete',
      args: { profile_id: 'p1' },
      decision: 'allow',
    });

    // Verify initially valid
    expect(verifyLog(tempAuditPath).valid).toBe(true);

    // Tamper with line 2
    const lines = fs.readFileSync(tempAuditPath, 'utf8').split('\n').filter((l) => l.trim().length > 0);
    const tamperedRecord = JSON.parse(lines[1]);
    tamperedRecord.tool = 'cdp.send'; // Alter tool name
    lines[1] = JSON.stringify(tamperedRecord);
    fs.writeFileSync(tempAuditPath, lines.join('\n') + '\n', 'utf8');

    const result = verifyLog(tempAuditPath);
    expect(result.valid).toBe(false);
    expect(result.brokenLineIndex).toBe(1);
    expect(result.error).toContain('Hash mismatch');
  });

  it('validates 15-minute token TTL & expiration', () => {
    const tokenManager = new SessionTokenManager('test-secret', 900); // 15 mins (900s)

    const token = tokenManager.generateToken('user-1', 'standard', 900);
    const nowSec = Math.floor(Date.now() / 1000);

    const validCheck = tokenManager.verifyToken(token, nowSec);
    expect(validCheck.valid).toBe(true);
    expect(validCheck.payload?.sub).toBe('user-1');
    expect(validCheck.payload?.scope).toBe('standard');
    expect(validCheck.payload?.exp).toBe(nowSec + 900);

    // Verify expiration check after 901s
    const expiredCheck = tokenManager.verifyToken(token, nowSec + 901);
    expect(expiredCheck.valid).toBe(false);
    expect(expiredCheck.error).toContain('expired');
  });

  it('rejects tokens signed with invalid secret or tampered payload', () => {
    const tokenManager = new SessionTokenManager('secret-a');
    const attackerManager = new SessionTokenManager('secret-b');

    const forgedToken = attackerManager.generateToken('user-1', 'admin');
    const verifyResult = tokenManager.verifyToken(forgedToken);

    expect(verifyResult.valid).toBe(false);
    expect(verifyResult.error).toContain('Invalid token signature');
  });

  it('enforces 24-month audit retention and preserves hash chain integrity', () => {
    const now = new Date('2026-09-07T12:00:00.000Z');

    // Generate 3 old records (e.g. 30, 26, 25 months ago) and 2 new records (e.g. 6 months ago, today)
    const date30MonthsAgo = new Date(now.getTime());
    date30MonthsAgo.setMonth(date30MonthsAgo.getMonth() - 30);

    const date26MonthsAgo = new Date(now.getTime());
    date26MonthsAgo.setMonth(date26MonthsAgo.getMonth() - 26);

    const date6MonthsAgo = new Date(now.getTime());
    date6MonthsAgo.setMonth(date6MonthsAgo.getMonth() - 6);

    // Write mock records directly to tempAuditPath
    const rec1 = {
      seq: 1,
      prevHash: '0'.repeat(64),
      hash: 'mockhash1',
      ts: date30MonthsAgo.toISOString(),
      nonce: 'nonce1',
      tool: 'profiles.list',
      argsHash: 'a1',
      decision: 'allow' as const,
    };
    const rec2 = {
      seq: 2,
      prevHash: 'mockhash1',
      hash: 'mockhash2',
      ts: date26MonthsAgo.toISOString(),
      nonce: 'nonce2',
      tool: 'profiles.list',
      argsHash: 'a2',
      decision: 'allow' as const,
    };
    const rec3 = {
      seq: 3,
      prevHash: 'mockhash2',
      hash: 'mockhash3',
      ts: date6MonthsAgo.toISOString(),
      nonce: 'nonce3',
      tool: 'profiles.list',
      argsHash: 'a3',
      decision: 'allow' as const,
    };
    const rec4 = {
      seq: 4,
      prevHash: 'mockhash3',
      hash: 'mockhash4',
      ts: now.toISOString(),
      nonce: 'nonce4',
      tool: 'profiles.list',
      argsHash: 'a4',
      decision: 'allow' as const,
    };

    fs.writeFileSync(
      tempAuditPath,
      [rec1, rec2, rec3, rec4].map((r) => JSON.stringify(r)).join('\n') + '\n',
      'utf8'
    );

    const customLogger = new McpAuditLogger(tempAuditPath);
    // Constructor already purges expired records (startup retention guarantee),
    // so the explicit call below is idempotent and reports no further purges.
    const purgeResult = customLogger.purgeExpiredRecords(now);

    expect(purgeResult.purgedCount).toBe(0);
    expect(purgeResult.remainingCount).toBe(2);

    // The remaining chain must be valid under verifyLog()
    const verifyRes = verifyLog(tempAuditPath);
    expect(verifyRes.valid).toBe(true);
    expect(verifyRes.totalRecords).toBe(2);
  });

  it('manages token revocation and revoke-on-refresh semantics', () => {
    const revocationList = new TokenRevocationList();
    const jti1 = 'jti-uuid-1';
    const jti2 = 'jti-uuid-2';
    const expFuture = Math.floor(Date.now() / 1000) + 3600;

    expect(revocationList.isRevoked(jti1)).toBe(false);
    revocationList.revoke(jti1, expFuture);
    expect(revocationList.isRevoked(jti1)).toBe(true);
    expect(revocationList.isRevoked(jti2)).toBe(false);

    // SessionTokenManager reissue revokes previous token
    const tokenManager = new SessionTokenManager('test-secret');
    const tok1 = tokenManager.generateToken('sub-1', 'admin', 900);
    const payload1 = tokenManager.verifyToken(tok1).payload!;
    expect(payload1.jti).toBeDefined();

    // Generate new token for same sub + aud
    const tok2 = tokenManager.generateToken('sub-1', 'admin', 900);
    const payload2 = tokenManager.verifyToken(tok2).payload!;

    // Previous token is now revoked!
    const v1 = tokenManager.verifyToken(tok1);
    expect(v1.valid).toBe(false);
    expect(v1.error).toContain('revoked');

    // New token is valid
    const v2 = tokenManager.verifyToken(tok2);
    expect(v2.valid).toBe(true);
  });

  it('prunes expired JTIs from TokenRevocationList', () => {
    const revocationList = new TokenRevocationList();
    const expPast = Math.floor(Date.now() / 1000) - 10;
    const expFuture = Math.floor(Date.now() / 1000) + 3600;

    revocationList.revoke('expired-jti', expPast);
    revocationList.revoke('active-jti', expFuture);

    expect(revocationList.size()).toBe(2);
    revocationList.prune();
    expect(revocationList.size()).toBe(1);
    expect(revocationList.isRevoked('expired-jti')).toBe(false);
    expect(revocationList.isRevoked('active-jti')).toBe(true);
  });
});
