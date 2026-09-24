import net from 'net';
import tls from 'tls';
import { randomUUID } from 'crypto';
import { getDb } from '../db';
import type { Database } from '../db';
import { protectSecret, revealSecret, setSecretCipher, resetSecretCiphers } from '../util/secretStore';
export { setSecretCipher, resetSecretCiphers };

export interface EmailAccount {
  id: string;
  label: string | null;
  email: string;
  host: string;
  port: number;
  username: string;
  password_enc: string | null;
  created_at: number;
  updated_at: number;
}

export interface EmailAccountMasked {
  id: string;
  label: string | null;
  email: string;
  host: string;
  port: number;
  username: string;
  has_password: boolean;
  created_at: number;
  updated_at: number;
}

export interface CreateEmailAccountInput {
  label?: string;
  email: string;
  host: string;
  port?: number;
  username: string;
  password?: string;
}

export interface UpdateEmailAccountInput {
  label?: string;
  email?: string;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
}

export interface EmailMessageSummary {
  uid: string;
  subject: string;
  from: string;
  date: string;
}

export interface EmailMessageDetail extends EmailMessageSummary {
  id: string;
  accountId: string;
  body: string;
  cached?: boolean;
  /** Why the live fetch failed, when the body came from the cache instead. */
  error?: string;
}

export interface InboxResult {
  messages: EmailMessageSummary[];
  cached: boolean;
  /**
   * Why the live read failed, when it did. The cache fallback is useful, but it used to be SILENT:
   * a rejected login or an unreachable host returned `cached: true` with an empty list, and the
   * operator saw "Cached" over an empty inbox with no reason — indistinguishable from a mailbox
   * that is genuinely empty. The provider's own words ("AUTHENTICATIONFAILED") were discarded one
   * line above being shown.
   */
  error?: string;
}

export type SocketFactory = (options: { host: string; port: number; tls?: boolean }) => net.Socket;

let customSocketFactory: SocketFactory | null = null;

export function setSocketFactory(factory: SocketFactory | null): void {
  customSocketFactory = factory;
}

export function getSocketFactory(): SocketFactory | null {
  return customSocketFactory;
}


export function ensureEmailTables(db?: Database): void {
  const d = db ?? getDb();
  d.exec(`
    CREATE TABLE IF NOT EXISTS email_accounts (
      id           TEXT PRIMARY KEY,
      label        TEXT,
      email        TEXT NOT NULL,
      host         TEXT NOT NULL,
      port         INTEGER NOT NULL,
      username     TEXT NOT NULL,
      password_enc TEXT,
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS email_messages_cache (
      id         TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
      uid        TEXT NOT NULL,
      subject    TEXT,
      from_addr  TEXT,
      date       TEXT,
      body       TEXT,
      created_at INTEGER NOT NULL,
      UNIQUE(account_id, uid)
    );

    CREATE INDEX IF NOT EXISTS idx_email_cache_account ON email_messages_cache(account_id);
  `);
}

function toMasked(row: Record<string, unknown>): EmailAccountMasked {
  return {
    id: String(row.id),
    label: (row.label as string | null) ?? null,
    email: String(row.email),
    host: String(row.host),
    port: Number(row.port) || 993,
    username: String(row.username),
    has_password: Boolean(row.password_enc),
    created_at: Number(row.created_at) || 0,
    updated_at: Number(row.updated_at) || 0,
  };
}

export async function createAccount(
  dbOrInput: Database | CreateEmailAccountInput,
  maybeInput?: CreateEmailAccountInput
): Promise<EmailAccountMasked> {
  const isDbFirst = maybeInput !== undefined;
  const db = isDbFirst ? (dbOrInput as Database) : getDb();
  const input = isDbFirst ? maybeInput : (dbOrInput as CreateEmailAccountInput);
  ensureEmailTables(db);

  const id = randomUUID();
  const now = Date.now();
  const port = input.port ?? 993;
  const passwordEnc = input.password ? protectSecret(input.password) : null;
  db.prepare(`
    INSERT INTO email_accounts (id, label, email, host, port, username, password_enc, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.label ?? null, input.email, input.host, port, input.username, passwordEnc, now, now);

  const row = db.prepare(`SELECT * FROM email_accounts WHERE id = ?`).get(id) as Record<string, unknown>;
  return toMasked(row);
}

export async function listAccounts(explicitDb?: Database): Promise<EmailAccountMasked[]> {
  const db = explicitDb ?? getDb();
  ensureEmailTables(db);
  const rows = db.prepare(`SELECT * FROM email_accounts ORDER BY created_at DESC`).all() as Record<string, unknown>[];
  return rows.map(toMasked);
}

export async function getAccount(
  dbOrId: Database | string,
  maybeId?: string
): Promise<EmailAccountMasked | null> {
  const isDbFirst = maybeId !== undefined;
  const db = isDbFirst ? (dbOrId as Database) : getDb();
  const id = isDbFirst ? maybeId : (dbOrId as string);
  ensureEmailTables(db);
  const row = db.prepare(`SELECT * FROM email_accounts WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return toMasked(row);
}

export async function updateAccount(
  dbOrId: Database | string,
  idOrInput: string | UpdateEmailAccountInput,
  maybeInput?: UpdateEmailAccountInput
): Promise<EmailAccountMasked | null> {
  const isDbFirst = maybeInput !== undefined;
  const db = isDbFirst ? (dbOrId as Database) : getDb();
  const id = isDbFirst ? (idOrInput as string) : (dbOrId as string);
  const input = isDbFirst ? maybeInput : (idOrInput as UpdateEmailAccountInput);
  ensureEmailTables(db);
  const existing = db.prepare(`SELECT * FROM email_accounts WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  if (!existing) return null;

  const now = Date.now();
  const label = input.label !== undefined ? input.label : existing.label;
  const email = input.email !== undefined ? input.email : existing.email;
  const host = input.host !== undefined ? input.host : existing.host;
  const port = input.port !== undefined ? input.port : existing.port;
  const username = input.username !== undefined ? input.username : existing.username;
  const passwordEnc = input.password !== undefined ? (input.password ? protectSecret(input.password) : null) : existing.password_enc;

  db.prepare(`
    UPDATE email_accounts
    SET label = ?, email = ?, host = ?, port = ?, username = ?, password_enc = ?, updated_at = ?
    WHERE id = ?
  `).run(label, email, host, port, username, passwordEnc, now, id);

  const row = db.prepare(`SELECT * FROM email_accounts WHERE id = ?`).get(id) as Record<string, unknown>;
  return toMasked(row);
}

export async function deleteAccount(
  dbOrId: Database | string,
  maybeId?: string
): Promise<boolean> {
  const isDbFirst = maybeId !== undefined;
  const db = isDbFirst ? (dbOrId as Database) : getDb();
  const id = isDbFirst ? maybeId : (dbOrId as string);
  ensureEmailTables(db);
  db.prepare(`DELETE FROM email_messages_cache WHERE account_id = ?`).run(id);
  const res = db.prepare(`DELETE FROM email_accounts WHERE id = ?`).run(id) as { changes?: number };
  return Boolean(res && res.changes !== 0);
}

export async function revealAccountPassword(
  dbOrId: Database | string,
  maybeId?: string
): Promise<string | null> {
  const isDbFirst = maybeId !== undefined;
  const db = isDbFirst ? (dbOrId as Database) : getDb();
  const id = isDbFirst ? maybeId : (dbOrId as string);
  ensureEmailTables(db);
  const row = db.prepare(`SELECT password_enc FROM email_accounts WHERE id = ?`).get(id) as { password_enc?: string | null } | undefined;
  if (!row || !row.password_enc) return null;
  const plaintext = revealSecret(row.password_enc);
  return plaintext ?? null;
}
export function extractCodes(text: string): string[] {
  if (!text || typeof text !== 'string') return [];

  const found: string[] = [];
  const add = (val: string) => {
    const trimmed = val.trim();
    if (trimmed && !found.includes(trimmed)) {
      found.push(trimmed);
    }
  };

  // 1. URLs for confirmation/verification links
  const urlRegex = /https?:\/\/[^\s<>"')]+(?:confirm|verify|token|activate|validate|code=)[^\s<>"')]+/gi;
  let match: RegExpExecArray | null;
  while ((match = urlRegex.exec(text)) !== null) {
    add(match[0]);
  }

  // 2. Explicit code labels (e.g. "verification code is 482910", "code: A9B2-C3D4", "code: 123456")
  const labelRegex = /(?:verification\s+code|security\s+code|confirm(?:ation)?\s+code|passcode|one-time\s+password|otp|pin|auth(?:entication)?\s+code|код(?:\s+подтверждения)?|проверочный\s+код)[\s:=]+([A-Z0-9]{4,10}(?:-[A-Z0-9]{3,6})?)/gi;
  while ((match = labelRegex.exec(text)) !== null) {
    const code = match[1];
    if (code && !/^(?:the|this|that|your|here)$/i.test(code)) {
      add(code);
    }
  }

  // 3. Hyphenated 6-digit or 8-char codes: 123-456, ABCD-EFGH
  const hyphenRegex = /\b([0-9]{3}-[0-9]{3})\b/g;
  while ((match = hyphenRegex.exec(text)) !== null) {
    add(match[1]);
    add(match[1].replace('-', ''));
  }

  const hyphenAlphaRegex = /\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/g;
  while ((match = hyphenAlphaRegex.exec(text)) !== null) {
    add(match[1]);
    add(match[1].replace('-', ''));
  }
  // 4. Standalone 6-digit numeric codes (e.g. 123456, 849201)
  const sixDigitRegex = /\b(?<![-#])([0-9]{6})\b(?![-#])/g;
  while ((match = sixDigitRegex.exec(text)) !== null) {
    const num = match[1];
    // filter out plausible dates like 202609
    add(num);
  }

  // 5. Standalone 8-character alphanumeric codes with mixed digits/letters (e.g. X7K9P2M4, 8F3K9L2P)
  const eightCharRegex = /\b([A-Z0-9]{8})\b/g;
  while ((match = eightCharRegex.exec(text)) !== null) {
    const candidate = match[1];
    // Require at least one digit and uppercase letters to avoid common 8-letter English words
    const hasDigit = /[0-9]/.test(candidate);
    const hasAlpha = /[A-Z]/.test(candidate);
    if (hasDigit && hasAlpha) {
      add(candidate);
    }
  }

  return found;
}

class SimpleImapSession {
  private socket: net.Socket | null = null;
  private buffer = '';
  private tagCounter = 1;

  async connect(host: string, port: number, socketFactory?: SocketFactory | null): Promise<void> {
    return new Promise((resolve, reject) => {
      const onConnect = () => {
        resolve();
      };

      if (socketFactory) {
        this.socket = socketFactory({ host, port, tls: port === 993 });
        this.socket.on('connect', onConnect);
        // In case custom socket is already connected or immediately triggers:
        if (this.socket.connecting === false && !this.socket.destroyed) {
          setTimeout(onConnect, 5);
        }
      } else if (port === 993) {
        this.socket = tls.connect({ host, port, rejectUnauthorized: false }, onConnect);
      } else {
        this.socket = net.connect({ host, port }, onConnect);
      }

      this.socket.on('data', (chunk) => {
        this.buffer += chunk.toString('utf8');
      });

      this.socket.on('error', (err) => {
        reject(err);
      });
    });
  }

  async readUntilTag(tag: string, timeoutMs = 5000): Promise<string> {
    const start = Date.now();
    return new Promise((resolve, reject) => {
      const check = () => {
        const regex = new RegExp(`^${tag}\\s+(OK|NO|BAD).*$`, 'm');
        const m = this.buffer.match(regex);
        if (m) {
          const matchIndex = this.buffer.indexOf(m[0]);
          const endIndex = matchIndex + m[0].length;
          const result = this.buffer.slice(0, endIndex);
          this.buffer = this.buffer.slice(endIndex);
          if (m[1] === 'OK') {
            resolve(result);
          } else {
            reject(new Error(`IMAP command failed: ${m[0]}`));
          }
          return;
        }
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`IMAP command timed out waiting for tag ${tag}`));
          return;
        }
        setTimeout(check, 20);
      };
      check();
    });
  }

  async sendCommand(cmd: string, timeoutMs = 5000): Promise<string> {
    const tag = `A${String(this.tagCounter++).padStart(3, '0')}`;
    const line = `${tag} ${cmd}\r\n`;
    if (!this.socket || this.socket.destroyed) {
      throw new Error('Socket is not connected');
    }
    this.socket.write(line);
    return this.readUntilTag(tag, timeoutMs);
  }

  async readBanner(timeoutMs = 3000): Promise<string> {
    const start = Date.now();
    return new Promise((resolve, reject) => {
      const check = () => {
        if (this.buffer.includes('* OK') || this.buffer.includes('* PREAUTH')) {
          const newline = this.buffer.indexOf('\n');
          const banner = this.buffer.slice(0, newline + 1);
          this.buffer = this.buffer.slice(newline + 1);
          resolve(banner);
          return;
        }
        if (Date.now() - start > timeoutMs) {
          // Some fake servers don't emit banner or already consumed
          resolve('');
          return;
        }
        setTimeout(check, 20);
      };
      check();
    });
  }

  close(): void {
    if (this.socket && !this.socket.destroyed) {
      try {
        this.socket.write(`A${String(this.tagCounter++).padStart(3, '0')} LOGOUT\r\n`);
      } catch {
        // ignore
      }
      this.socket.end();
      this.socket.destroy();
    }
    this.socket = null;
    this.buffer = '';
  }
}

function parseSExp(str: string): unknown {
  let pos = 0;
  function skipWhitespace(): void {
    while (pos < str.length && /\s/.test(str[pos])) pos++;
  }
  function parseItem(): unknown {
    skipWhitespace();
    if (pos >= str.length) return null;
    if (str[pos] === '(') {
      pos++;
      const list: unknown[] = [];
      while (pos < str.length) {
        skipWhitespace();
        if (str[pos] === ')') {
          pos++;
          break;
        }
        list.push(parseItem());
      }
      return list;
    } else if (str[pos] === '"') {
      pos++;
      let res = '';
      while (pos < str.length) {
        if (str[pos] === '\\') {
          pos++;
          if (pos < str.length) res += str[pos++];
        } else if (str[pos] === '"') {
          pos++;
          break;
        } else {
          res += str[pos++];
        }
      }
      return res;
    } else {
      let res = '';
      while (pos < str.length && !/[\s()]/.test(str[pos])) {
        res += str[pos++];
      }
      return res.toUpperCase() === 'NIL' ? null : res;
    }
  }
  return parseItem();
}

function parseEnvelopeResponses(raw: string): EmailMessageSummary[] {
  const list: EmailMessageSummary[] = [];
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    if (!line.startsWith('*')) continue;
    const uidMatch = line.match(/\bUID\s+(\d+)\b/i);
    const uid = uidMatch ? uidMatch[1] : '';
    if (!uid) continue;

    let subject = '(No Subject)';
    let from = 'unknown';
    let date = '';

    const envIdx = line.indexOf('ENVELOPE');
    if (envIdx !== -1) {
      const envSexp = parseSExp(line.substring(envIdx + 'ENVELOPE'.length).trim());
      if (Array.isArray(envSexp)) {
        // RFC 3501 ENVELOPE structure:
        // 0: date
        // 1: subject
        // 2: from: list of (name adl mailbox host)
        // 3: sender
        // 4: reply-to
        // 5: to
        // 6: cc
        // 7: bcc
        // 8: in-reply-to
        // 9: message-id
        if (typeof envSexp[0] === 'string' && envSexp[0]) {
          date = envSexp[0];
        }
        if (typeof envSexp[1] === 'string' && envSexp[1]) {
          subject = envSexp[1];
        }
        if (Array.isArray(envSexp[2]) && envSexp[2].length > 0) {
          const firstAddr = envSexp[2][0];
          if (Array.isArray(firstAddr) && firstAddr.length >= 4) {
            const mailbox = firstAddr[2];
            const host = firstAddr[3];
            if (mailbox && host) {
              from = `${mailbox}@${host}`;
            } else if (mailbox) {
              from = String(mailbox);
            }
          }
        }
      }
    }

    list.push({ uid, subject, from, date });
  }
  return list;
}

function parseBodyResponse(raw: string): string {
  // Typical IMAP response: * 1 FETCH (UID 101 BODY[] {45}\r\n<content>)\r\n
  const literalMatch = raw.match(/BODY(?:\[\]|\.PEEK\[\])?\s*\{(\d+)\}\r?\n/i);
  if (literalMatch && literalMatch.index !== undefined) {
    const len = parseInt(literalMatch[1], 10);
    const start = literalMatch.index + literalMatch[0].length;
    return raw.substring(start, start + len);
  }

  const quotedMatch = raw.match(/BODY(?:\[\]|\.PEEK\[\])?\s*"([^"]*)"/i);
  if (quotedMatch) {
    return quotedMatch[1];
  }

  // Fallback: strip untagged line and closing paren
  return raw.replace(/^\* \d+ FETCH \(.*?\r?\n/i, '').replace(/\)\r?\n[A-Z0-9]+ OK.*$/s, '').trim();
}

export async function listInbox(
  dbOrAccountId: Database | string,
  accountIdOrSocketFactory?: string | SocketFactory,
  maybeSocketFactory?: SocketFactory
): Promise<InboxResult> {
  const isDbFirst = typeof dbOrAccountId !== 'string';
  const db = isDbFirst ? dbOrAccountId : getDb();
  const accountId = isDbFirst ? (accountIdOrSocketFactory as string) : dbOrAccountId;
  const socketFactory = isDbFirst ? maybeSocketFactory : (accountIdOrSocketFactory as SocketFactory | undefined);
  ensureEmailTables(db);

  const account = db.prepare(`SELECT * FROM email_accounts WHERE id = ?`).get(accountId) as Record<string, unknown> | undefined;
  if (!account) {
    throw new Error(`Email account not found: ${accountId}`);
  }

  const password = account.password_enc ? revealSecret(String(account.password_enc)) : '';
  const factory = socketFactory ?? customSocketFactory;

  const session = new SimpleImapSession();
  try {
    await session.connect(String(account.host), Number(account.port) || 993, factory);
    await session.readBanner();

    // 1. LOGIN
    await session.sendCommand(`LOGIN "${account.username}" "${password}"`);

    // 2. SELECT INBOX
    await session.sendCommand(`SELECT INBOX`);

    // 3. FETCH ENVELOPE
    const fetchRes = await session.sendCommand(`UID FETCH 1:* (UID ENVELOPE)`);
    const messages = parseEnvelopeResponses(fetchRes);

    // Update cache
    for (const msg of messages) {
      db.prepare(`
        INSERT INTO email_messages_cache (id, account_id, uid, subject, from_addr, date, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(account_id, uid) DO UPDATE SET
          subject = excluded.subject,
          from_addr = excluded.from_addr,
          date = excluded.date
      `).run(randomUUID(), accountId, msg.uid, msg.subject, msg.from, msg.date, Date.now());
    }

    session.close();
    return { messages, cached: false };
  } catch (err) {
    session.close();
    /*
     * The cache is a fallback, not a disguise. The reason the live read failed is carried out to
     * the caller, because the operator's question is "why is my inbox empty", and the provider
     * already answered it precisely — `AUTHENTICATIONFAILED` means the password is wrong (iCloud
     * requires an app-specific one), a connect timeout means the host or the network is wrong.
     * Reporting neither left the two indistinguishable from an empty mailbox.
     */
    const reason = err instanceof Error ? err.message : String(err);
    const cachedRows = db.prepare(`
      SELECT uid, subject, from_addr as "from", date
      FROM email_messages_cache
      WHERE account_id = ?
      ORDER BY created_at DESC
    `).all(accountId) as EmailMessageSummary[];

    return { messages: cachedRows, cached: true, error: reason };
  }
}

export async function readMessage(
  dbOrAccountId: Database | string,
  accountIdOrUid: string,
  uidOrSocketFactory?: string | SocketFactory,
  maybeSocketFactory?: SocketFactory
): Promise<EmailMessageDetail> {
  const isDbFirst = typeof dbOrAccountId !== 'string';
  const db = isDbFirst ? dbOrAccountId : getDb();
  const accountId = isDbFirst ? accountIdOrUid : dbOrAccountId;
  const uid = isDbFirst ? (uidOrSocketFactory as string) : accountIdOrUid;
  const socketFactory = isDbFirst ? maybeSocketFactory : (uidOrSocketFactory as SocketFactory | undefined);
  ensureEmailTables(db);

  const account = db.prepare(`SELECT * FROM email_accounts WHERE id = ?`).get(accountId) as Record<string, unknown> | undefined;
  if (!account) {
    throw new Error(`Email account not found: ${accountId}`);
  }

  const cachedRow = db.prepare(`
    SELECT * FROM email_messages_cache WHERE account_id = ? AND uid = ?
  `).get(accountId, uid) as { id: string; subject: string; from_addr: string; date: string; body?: string | null } | undefined;

  const password = account.password_enc ? revealSecret(String(account.password_enc)) : '';
  const factory = socketFactory ?? customSocketFactory;

  const session = new SimpleImapSession();
  try {
    await session.connect(String(account.host), Number(account.port) || 993, factory);
    await session.readBanner();

    // 1. LOGIN
    await session.sendCommand(`LOGIN "${account.username}" "${password}"`);

    // 2. SELECT INBOX
    await session.sendCommand(`SELECT INBOX`);

    // 3. FETCH BODY
    const fetchRes = await session.sendCommand(`UID FETCH ${uid} (UID BODY[])`);
    const body = parseBodyResponse(fetchRes);

    const now = Date.now();
    const id = cachedRow?.id ?? randomUUID();
    const subject = cachedRow?.subject ?? '(No Subject)';
    const from = cachedRow?.from_addr ?? 'unknown';
    const date = cachedRow?.date ?? '';

    db.prepare(`
      INSERT INTO email_messages_cache (id, account_id, uid, subject, from_addr, date, body, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, uid) DO UPDATE SET
        body = excluded.body,
        created_at = excluded.created_at
    `).run(id, accountId, uid, subject, from, date, body, now);

    session.close();
    return {
      id,
      accountId,
      uid,
      subject,
      from,
      date,
      body,
      cached: false,
    };
  } catch (err) {
    session.close();
    if (cachedRow && cachedRow.body !== null && cachedRow.body !== undefined) {
      return {
        id: cachedRow.id,
        accountId,
        uid,
        subject: cachedRow.subject ?? '(No Subject)',
        from: cachedRow.from_addr ?? 'unknown',
        date: cachedRow.date ?? '',
        body: cachedRow.body,
        cached: true,
        // Same reason as `listInbox`: a cached body must say why it is cached, or a stale copy
        // reads as a successful live fetch.
        error: err instanceof Error ? err.message : String(err),
      };
    }
    throw err;
  }
}

export function createImapClient(
  config: { host: string; port?: number; username: string; password?: string },
  socketFactory?: SocketFactory
) {
  return {
    async fetchInbox(): Promise<EmailMessageSummary[]> {
      const session = new SimpleImapSession();
      await session.connect(config.host, config.port ?? 993, socketFactory ?? customSocketFactory);
      await session.readBanner();
      await session.sendCommand(`LOGIN "${config.username}" "${config.password ?? ''}"`);
      await session.sendCommand(`SELECT INBOX`);
      const fetchRes = await session.sendCommand(`UID FETCH 1:* (UID ENVELOPE)`);
      const messages = parseEnvelopeResponses(fetchRes);
      session.close();
      return messages;
    },
    async fetchMessageBody(uid: string): Promise<string> {
      const session = new SimpleImapSession();
      await session.connect(config.host, config.port ?? 993, socketFactory ?? customSocketFactory);
      await session.readBanner();
      await session.sendCommand(`LOGIN "${config.username}" "${config.password ?? ''}"`);
      await session.sendCommand(`SELECT INBOX`);
      const fetchRes = await session.sendCommand(`UID FETCH ${uid} (UID BODY[])`);
      const body = parseBodyResponse(fetchRes);
      session.close();
      return body;
    }
  };
}
