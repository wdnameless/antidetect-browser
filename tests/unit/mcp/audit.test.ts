import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { McpAuditLogger, verifyLog } from '../../../mcp/src/audit';
import { SessionTokenManager } from '../../../mcp/src/auth';

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
});
