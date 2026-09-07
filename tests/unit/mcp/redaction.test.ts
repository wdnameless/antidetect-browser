import { describe, it, expect } from 'vitest';
import { redactSensitiveArgs, REDACTED_MARKER } from '../../../mcp/src/redaction';
import { McpAuditLogger } from '../../../mcp/src/audit';

describe('MCP Redaction', () => {
  const logger = new McpAuditLogger();

  it('redacts sensitive fields in shallow objects', () => {
    const input = {
      token: 'secret-token-123',
      password: 'mypassword',
      secret: 'shh',
      credential: 'my-cred',
      proxy_password: 'proxypassword123',
      auth: 'Bearer xyz',
      authorization: 'Bearer abc',
      cookie: 'session=123',
      normal_param: 'allowed-value',
      proxy_user: 'myuser',
    };

    const redacted = redactSensitiveArgs(input) as Record<string, unknown>;
    expect(redacted.token).toBe(REDACTED_MARKER);
    expect(redacted.password).toBe(REDACTED_MARKER);
    expect(redacted.secret).toBe(REDACTED_MARKER);
    expect(redacted.credential).toBe(REDACTED_MARKER);
    expect(redacted.proxy_password).toBe(REDACTED_MARKER);
    expect(redacted.auth).toBe(REDACTED_MARKER);
    expect(redacted.authorization).toBe(REDACTED_MARKER);
    expect(redacted.cookie).toBe(REDACTED_MARKER);

    // Non-sensitive fields preserved
    expect(redacted.normal_param).toBe('allowed-value');
    expect(redacted.proxy_user).toBe('myuser');
  });

  it('handles case-insensitivity and word boundaries correctly', () => {
    const input = {
      TOKEN: 'upper-secret',
      proxy_Password: 'mixed-secret',
      my_auth_token: 'nested-word-boundary',
      proxy_user: 'not-redacted',
      user_authority: 'not-redacted-auth-prefix',
    };

    const redacted = redactSensitiveArgs(input) as Record<string, unknown>;
    expect(redacted.TOKEN).toBe(REDACTED_MARKER);
    expect(redacted.proxy_Password).toBe(REDACTED_MARKER);
    expect(redacted.my_auth_token).toBe(REDACTED_MARKER);
    expect(redacted.proxy_user).toBe('not-redacted');
    expect(redacted.user_authority).toBe('not-redacted-auth-prefix');
  });

  it('recursively redacts nested objects and arrays', () => {
    const input = {
      config: {
        server: 'https://example.com',
        credentials: {
          secret_key: 'secret-api-key',
          proxy: {
            proxy_password: 'nested-proxy-pass',
          },
        },
      },
      list: [
        { secret: 'array-secret-1' },
        { safe: 'safe-value' },
        ['plain-string', { authorization: 'Bearer inside-nested-array' }],
      ],
    };
    const redacted = redactSensitiveArgs(input) as Record<string, unknown>;
    const config = redacted.config as Record<string, unknown>;
    const creds = config.credentials as Record<string, unknown>;
    const proxy = creds.proxy as Record<string, unknown>;
    const list = redacted.list as unknown[];
    const list0 = list[0] as Record<string, unknown>;
    const list1 = list[1] as Record<string, unknown>;
    const list2 = list[2] as unknown[];
    const list2_1 = list2[1] as Record<string, unknown>;

    expect(config.server).toBe('https://example.com');
    expect(creds.secret_key).toBe(REDACTED_MARKER);
    expect(proxy.proxy_password).toBe(REDACTED_MARKER);
    expect(list0.secret).toBe(REDACTED_MARKER);
    expect(list1.safe).toBe('safe-value');
    expect(list2[0]).toBe('plain-string');
    expect(list2_1.authorization).toBe(REDACTED_MARKER);
  });

  it('produces a stable argsHash on redacted args', () => {
    const inputA = {
      token: 'secret-token-A',
      profileId: 'prof-123',
    };
    const inputB = {
      token: 'secret-token-B',
      profileId: 'prof-123',
    };

    const redactedA = redactSensitiveArgs(inputA);
    const redactedB = redactSensitiveArgs(inputB);

    const hashA = logger.computeArgsHash(redactedA);
    const hashB = logger.computeArgsHash(redactedB);

    // Because secrets are replaced with [REDACTED], their hashes match
    expect(hashA).toBe(hashB);
  });
});
