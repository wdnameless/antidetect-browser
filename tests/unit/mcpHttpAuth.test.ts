// Regression guard for MCP HTTP authentication.
//
// THE BUG THIS PINS
// `POST /mcp` accepted requests with no `Authorization` header and gave them the default
// scope. Because the server runs with the app's own API credentials in its environment, an
// unauthenticated local caller could EXECUTE tools, not just list them. Verified against the
// running service before the fix: a `profiles.create` call with no header at all returned a
// `user_id`, and the row was present in the database afterwards. Any local process could drive
// the operator's browser profiles.
//
// Both halves are asserted, because a fix that simply rejects everything would also "pass" a
// one-sided test while making the transport unusable.
import { describe, it, expect } from 'vitest';
import { SessionTokenManager } from '../../mcp/src/auth';

describe('MCP session tokens', () => {
  it('accepts a token it signed and rejects one signed with the published default', () => {
    const secret = 'a-per-run-secret';
    const manager = new SessionTokenManager(secret);
    const token = manager.generateToken('app-operator', 'standard');

    expect(manager.verifyToken(token).valid).toBe(true);

    // The server's fallback secret is hardcoded in the source tree. A token forged with it must
    // not be accepted by a server running with a real per-run secret — that was the whole risk.
    const forged = new SessionTokenManager('antidetect-mcp-default-secret').generateToken(
      'attacker',
      'admin',
    );
    expect(manager.verifyToken(forged).valid).toBe(false);
  });

  it('carries the scope it was issued with, and cannot upgrade itself', () => {
    const manager = new SessionTokenManager('scope-secret');
    const standard = manager.verifyToken(manager.generateToken('op', 'standard'));
    expect(standard.payload?.scope).toBe('standard');

    const admin = manager.verifyToken(manager.generateToken('op', 'admin'));
    expect(admin.payload?.scope).toBe('admin');
  });
});
