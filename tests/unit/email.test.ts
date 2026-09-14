import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import * as net from 'net';
import { initDb, closeDb, getDb, Database } from '../../src/main/db';
import {
  extractCodes,
  createAccount,
  listAccounts,
  getAccount,
  updateAccount,
  deleteAccount,
  revealAccountPassword,
  listInbox,
  readMessage,
  ensureEmailTables,
  setSecretCipher,
  resetSecretCiphers,
  createImapClient,
  SocketFactory,
} from '../../src/main/email/manager';

beforeAll(async () => {
  await initDb();
});

afterAll(() => {
  closeDb();
});

describe('Verification Code Extractor (extractCodes)', () => {
  it('fixture 1: 6-digit verification code in English', () => {
    const text = 'Your verification code is 482910. It expires in 10 minutes.';
    expect(extractCodes(text)).toContain('482910');
  });

  it('fixture 2: 6-digit confirmation code with prefix', () => {
    const text = 'Welcome! Enter this confirmation code: 938471 to verify your account.';
    expect(extractCodes(text)).toContain('938471');
  });

  it('fixture 3: 6-digit hyphenated security code', () => {
    const text = 'Your one-time security code: 123-456.';
    const codes = extractCodes(text);
    expect(codes).toContain('123-456');
    expect(codes).toContain('123456');
  });

  it('fixture 4: 8-character alphanumeric code', () => {
    const text = 'Your temporary recovery passcode is A8B2K9X4.';
    expect(extractCodes(text)).toContain('A8B2K9X4');
  });

  it('fixture 5: 8-character hyphenated code', () => {
    const text = 'Use code: ABCD-1234 to unlock your trial.';
    const codes = extractCodes(text);
    expect(codes).toContain('ABCD-1234');
    expect(codes).toContain('ABCD1234');
  });

  it('fixture 6: Russian text with 6-digit confirmation code', () => {
    const text = 'Ваш код подтверждения для входа: 572918. Никому не сообщайте.';
    expect(extractCodes(text)).toContain('572918');
  });

  it('fixture 7: Russian text with OTP and link', () => {
    const text = 'Одноразовый пароль (OTP): 829103 или перейдите по ссылке https://auth.service.com/verify?token=abc987xyz';
    const codes = extractCodes(text);
    expect(codes).toContain('829103');
    expect(codes).toContain('https://auth.service.com/verify?token=abc987xyz');
  });

  it('fixture 8: Confirmation link with token parameter', () => {
    const text = 'Please click here to confirm your email: https://app.example.com/auth/confirm?token=e1f2a3b4c5d6';
    expect(extractCodes(text)).toContain('https://app.example.com/auth/confirm?token=e1f2a3b4c5d6');
  });

  it('fixture 9: Account activation link', () => {
    const text = 'To activate your new profile: https://id.portal.io/activate?user=123&key=K92M4L1Q';
    expect(extractCodes(text)).toContain('https://id.portal.io/activate?user=123&key=K92M4L1Q');
  });

  it('fixture 10: PIN code format', () => {
    const text = 'Security PIN: 6492. Do not share this PIN with anyone.';
    expect(extractCodes(text)).toContain('6492');
  });

  it('fixture 11: Mixed email with code and link', () => {
    const text = `
      Hello Alex,
      Your login code is: 739102.
      Alternatively, verify your browser session:
      https://login.security.net/verify-session?code=739102
    `;
    const codes = extractCodes(text);
    expect(codes).toContain('739102');
    expect(codes).toContain('https://login.security.net/verify-session?code=739102');
  });

  it('fixture 12: HTML formatted email text', () => {
    const htmlText = '<p>Your confirmation code is: <b>618294</b></p><a href="https://example.com/confirm?hash=9988">Confirm</a>';
    const codes = extractCodes(htmlText);
    expect(codes).toContain('618294');
    expect(codes).toContain('https://example.com/confirm?hash=9988');
  });
});

describe('Email Account CRUD & Vault Masking', () => {
  let db: Database;

  beforeEach(async () => {
    await initDb();
    db = getDb();
    ensureEmailTables(db);
    // Setup test cipher
    setSecretCipher({
      protect: (plain) => `test-enc:${Buffer.from(plain).toString('base64')}`,
      unprotect: (cipherText) => {
        if (!cipherText.startsWith('test-enc:')) return undefined;
        return Buffer.from(cipherText.replace('test-enc:', ''), 'base64').toString('utf-8');
      }
    });
  });

  afterEach(() => {
    resetSecretCiphers();
    closeDb();
  });

  it('creates an account, encrypts password, and returns masked view', async () => {
    const account = await createAccount(db, {
      label: 'Main Mail',
      email: 'user@example.com',
      host: 'imap.example.com',
      port: 993,
      username: 'user@example.com',
      password: 'super-secret-password'
    });

    expect(account.id).toBeDefined();
    expect(account.label).toBe('Main Mail');
    expect(account.email).toBe('user@example.com');
    expect(account.has_password).toBe(true);
    const record = account as unknown as Record<string, unknown>;
    expect(record.password).toBeUndefined();
    expect(record.password_enc).toBeUndefined();

    // Plaintext password is never in list
    const list = await listAccounts(db);
    expect(list.length).toBe(1);
    expect(list[0].has_password).toBe(true);
    const itemRecord = list[0] as unknown as Record<string, unknown>;
    expect(itemRecord.password).toBeUndefined();

    // Password can only be revealed via explicit revealAccountPassword
    const revealed = await revealAccountPassword(db, account.id);
    expect(revealed).toBe('super-secret-password');
  });

  it('updates account without modifying password if not provided', async () => {
    const account = await createAccount(db, {
      label: 'Old Label',
      email: 'user@example.com',
      host: 'imap.example.com',
      port: 993,
      username: 'user@example.com',
      password: 'mypassword'
    });

    const updated = await updateAccount(db, account.id, {
      label: 'New Label',
      port: 995
    });

    expect(updated).not.toBeNull();
    expect(updated?.label).toBe('New Label');
    expect(updated?.port).toBe(995);
    expect(updated?.has_password).toBe(true);

    const revealed = await revealAccountPassword(db, account.id);
    expect(revealed).toBe('mypassword');
  });

  it('deletes an account and cascades cache', async () => {
    const account = await createAccount(db, {
      label: 'To Delete',
      email: 'delete@example.com',
      host: 'imap.example.com',
      port: 993,
      username: 'delete@example.com',
      password: 'pw'
    });

    const success = await deleteAccount(db, account.id);
    expect(success).toBe(true);

    const fetched = await getAccount(db, account.id);
    expect(fetched).toBeNull();
  });
});

describe('Minimal IMAP Client with Fake Socket Seam', () => {
  let fakeServer: net.Server;
  let serverPort: number;

  beforeEach(async () => {
    await initDb();
    await new Promise<void>((resolve) => {
      fakeServer = net.createServer((socket) => {
        // The client tears the connection down as soon as it has its response, so a
        // write can race the teardown and raise ECONNABORTED. A test fixture must
        // absorb its own socket errors rather than surfacing them as unhandled.
        socket.on('error', () => {});
        // IMAP Greeting
        socket.write('* OK IMAP4rev1 Service Ready\r\n');

        let buffer = '';
        socket.on('data', (chunk) => {
          buffer += chunk.toString('utf-8');
          while (buffer.includes('\r\n')) {
            const lineIdx = buffer.indexOf('\r\n');
            const line = buffer.substring(0, lineIdx);
            buffer = buffer.substring(lineIdx + 2);

            const parts = line.split(' ');
            const tag = parts[0];
            const cmd = (parts[1] || '').toUpperCase();

            if (cmd === 'LOGIN') {
              socket.write(`${tag} OK LOGIN completed\r\n`);
            } else if (cmd === 'SELECT') {
              socket.write('* 2 EXISTS\r\n');
              socket.write('* OK [UIDVALIDITY 1] UIDs valid\r\n');
              socket.write(`${tag} OK [READ-ONLY] SELECT completed\r\n`);
            } else if (cmd === 'FETCH' || (parts[1] === 'UID' && parts[2] === 'FETCH')) {
              if (line.includes('ENVELOPE')) {
                // Return message list
                socket.write('* 1 FETCH (UID 101 ENVELOPE ("Sat, 13 Sep 2026 10:00:00 +0000" "Your security code is 482910" (("Acme Corp" NIL "security" "acme.com")) NIL NIL NIL NIL NIL NIL))\r\n');
                socket.write('* 2 FETCH (UID 102 ENVELOPE ("Sat, 13 Sep 2026 11:30:00 +0000" "Confirm your email" (("Support" NIL "support" "service.com")) NIL NIL NIL NIL NIL NIL))\r\n');
                socket.write(`${tag} OK FETCH completed\r\n`);
              } else if (line.includes('BODY')) {
                // Return message body
                const bodyContent = 'Hello, your verification code is 482910.\nAlternatively click https://acme.com/confirm?token=xyz987';
                socket.write(`* 1 FETCH (UID 101 BODY[] {${bodyContent.length}}\r\n${bodyContent})\r\n`);
                socket.write(`${tag} OK FETCH completed\r\n`);
              }
            } else if (cmd === 'LOGOUT') {
              socket.write('* BYE IMAP4rev1 Server logging out\r\n');
              // The client may have torn the connection down already; writing to a
              // destroyed socket raises ECONNABORTED as an unhandled error.
              if (!socket.destroyed) socket.write(`${tag} OK LOGOUT completed\r\n`);
              socket.end();
            }
          }
        });
      });

      fakeServer.listen(0, '127.0.0.1', () => {
        serverPort = (fakeServer.address() as net.AddressInfo).port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    resetSecretCiphers();
    closeDb();
    await new Promise<void>((resolve) => {
      fakeServer.close(() => resolve());
    });
  });

  it('runs the 4-command IMAP sequence against fake server', async () => {
    const socketFactory: SocketFactory = (opts) => {
      return net.connect({ host: opts.host, port: opts.port });
    };

    const client = createImapClient(
      {
        host: '127.0.0.1',
        port: serverPort,
        username: 'test@example.com',
        password: 'password123'
      },
      socketFactory
    );

    const messages = await client.fetchInbox();
    expect(messages.length).toBe(2);
    expect(messages[0].uid).toBe('101');
    expect(messages[0].subject).toContain('482910');
    expect(messages[0].from).toBe('security@acme.com');

    const body = await client.fetchMessageBody('101');
    expect(body).toContain('482910');
    expect(body).toContain('https://acme.com/confirm?token=xyz987');
  });

  it('listInbox and readMessage integrate with SQLite cache and fallback', async () => {
    const db = getDb();
    ensureEmailTables(db);

    setSecretCipher({
      protect: (plain) => plain || null,
      unprotect: (cipherText) => cipherText || undefined
    });

    const account = await createAccount(db, {
      label: 'Test Imap',
      email: 'test@example.com',
      host: '127.0.0.1',
      port: serverPort,
      username: 'test@example.com',
      password: 'password123'
    });

    const socketFactory: SocketFactory = (opts) => {
      return net.connect({ host: opts.host, port: opts.port });
    };

    // First fetch: live from server and caches
    const inbox = await listInbox(db, account.id, socketFactory);
    expect(inbox.cached).toBe(false);
    expect(inbox.messages.length).toBe(2);

    // Read single message
    const msgDetail = await readMessage(db, account.id, '101', socketFactory);
    expect(msgDetail.cached).toBe(false);
    expect(msgDetail.body).toContain('482910');

    // Now simulate network failure by using unreachable socket factory
    const failingSocketFactory: SocketFactory = () => {
      const sock = new net.Socket();
      queueMicrotask(() => {
        sock.emit('error', new Error('ECONNREFUSED'));
      });
      return sock;
    };

    // Should return cached messages
    const cachedInbox = await listInbox(db, account.id, failingSocketFactory);
    expect(cachedInbox.cached).toBe(true);
    expect(cachedInbox.messages.length).toBe(2);

    // Should return cached message body
    const cachedDetail = await readMessage(db, account.id, '101', failingSocketFactory);
    expect(cachedDetail.cached).toBe(true);
    expect(cachedDetail.body).toContain('482910');

    resetSecretCiphers();
  });
});
