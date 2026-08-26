// Panel authentication: human-friendly username/password for the web UI.
// First visit performs a one-time setup (no credentials exist yet); later
// visits log in and receive the API key as their session token, so every
// existing endpoint (Bearer) and WebSocket (?key=) keeps working unchanged.
//
// Storage: DATA_DIR/panel_auth.json { username, salt, hash } (scrypt).
import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { DATA_DIR } from '../config';
import { getApiKey } from '../config';

const AUTH_FILE = path.join(DATA_DIR, 'panel_auth.json');

const MAX_ATTEMPTS = 10;
const WINDOW_MS = 60_000;
const attempts = new Map<string, { count: number; windowStart: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of attempts) {
    if (now - v.windowStart >= WINDOW_MS * 2) attempts.delete(k);
  }
}, WINDOW_MS).unref();

function tooManyAttempts(ip: string): boolean {
  const now = Date.now();
  let a = attempts.get(ip);
  if (!a || now - a.windowStart >= WINDOW_MS) {
    a = { count: 0, windowStart: now };
    attempts.set(ip, a);
  }
  a.count++;
  return a.count > MAX_ATTEMPTS;
}

interface StoredAuth {
  username: string;
  salt: string;
  hash: string;
}

export interface PanelSession {
  at: number;
  ip: string;
  ua: string;
  username: string;
}

const SESSIONS_FILE = path.join(DATA_DIR, 'panel_sessions.json');
const MAX_SESSIONS = 50;

export function recordSession(ip: string, ua: string, username: string): void {
  try {
    let list: PanelSession[] = [];
    try {
      list = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8')) as PanelSession[];
    } catch {
      // first entry
    }
    list.unshift({ at: Date.now(), ip, ua: String(ua || '').slice(0, 200), username });
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(list.slice(0, MAX_SESSIONS), null, 2), 'utf8');
  } catch {
    // never fail a login because of session bookkeeping
  }
}

function readAuth(): StoredAuth | undefined {
  try {
    const raw = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8')) as StoredAuth;
    if (raw && typeof raw.hash === 'string' && typeof raw.salt === 'string') return raw;
  } catch {
    // no credentials yet
  }
  return undefined;
}

function writeAuth(auth: StoredAuth): void {
  fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), 'utf8');
}

function hashPassword(password: string, saltHex: string): string {
  return scryptSync(password, Buffer.from(saltHex, 'hex'), 64).toString('hex');
}

function verifyPassword(password: string, stored: StoredAuth): boolean {
  const candidate = Buffer.from(hashPassword(password, stored.salt), 'hex');
  const expected = Buffer.from(stored.hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function hasPanelPassword(): boolean {
  return readAuth() !== undefined;
}

export const panelAuthRouter = Router();

/** Public: does the panel have credentials configured? */
panelAuthRouter.get('/ui/auth-state', (_req, res) => {
  res.json({ code: 0, msg: 'success', data: { hasPassword: hasPanelPassword() } });
});

/** Login sessions (devices that signed in). Requires Bearer token. */
panelAuthRouter.get('/ui/sessions', (req, res) => {
  const header = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!header || header !== getApiKey()) {
    res.status(401).json({ code: -1, msg: 'unauthorized', data: {} });
    return;
  }
  let list: PanelSession[] = [];
  try {
    list = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8')) as PanelSession[];
  } catch {
    // empty
  }
  res.json({ code: 0, msg: 'success', data: { list } });
});

/** Public one-time setup: allowed only while no credentials exist. */
panelAuthRouter.post('/ui/setup', (req: Request, res: Response) => {
  if (hasPanelPassword()) {
    res.status(409).json({ code: -1, msg: 'password already configured', data: {} });
    return;
  }
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  if (!username || password.length < 6) {
    res.status(400).json({ code: -1, msg: 'username required, password must be 6+ chars', data: {} });
    return;
  }
  const salt = randomBytes(16).toString('hex');
  writeAuth({ username, salt, hash: hashPassword(password, salt) });
  recordSession(req.ip || 'anon', String(req.headers['user-agent'] || ''), username);
  res.json({ code: 0, msg: 'success', data: { token: getApiKey(), username } });
});

/** Public login: verify credentials, hand out the session token (= API key). */
panelAuthRouter.post('/ui/login', (req: Request, res: Response) => {
  if (tooManyAttempts(req.ip || 'anon')) {
    res.status(429).json({ code: -1, msg: 'too many attempts, try again in a minute', data: {} });
    return;
  }
  const stored = readAuth();
  if (!stored) {
    res.status(409).json({ code: -1, msg: 'setup required', data: {} });
    return;
  }
  const username = String(req.body?.username || '');
  const password = String(req.body?.password || '');
  if (username !== stored.username || !verifyPassword(password, stored)) {
    res.status(401).json({ code: -1, msg: 'invalid credentials', data: {} });
    return;
  }
  recordSession(req.ip || 'anon', String(req.headers['user-agent'] || ''), username);
  res.json({ code: 0, msg: 'success', data: { token: getApiKey(), username } });
});
