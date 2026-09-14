import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  listAccounts,
  getAccount,
  createAccount,
  updateAccount,
  deleteAccount,
  revealAccountPassword,
  listInbox,
  readMessage,
  extractCodes,
  CreateEmailAccountInput,
  UpdateEmailAccountInput,
} from '../../email/manager';

const router = Router();

// Envelope helpers
function ok<T>(res: Response, data: T, msg = 'ok') {
  return res.json({ code: 0, msg, data });
}

function fail(res: Response, msg: string, code = -1) {
  return res.json({ code, msg, data: null });
}

// 1. Account CRUD
router.get('/accounts', async (_req: Request, res: Response) => {
  try {
    const accounts = await listAccounts();
    return ok(res, accounts);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return fail(res, message);
  }
});

router.post('/accounts', async (req: Request, res: Response) => {
  try {
    const { email, host, port, username, password, label } = req.body as CreateEmailAccountInput;
    if (!email || !host || !username) {
      return fail(res, 'email, host, and username are required');
    }
    const account = await createAccount({
      email,
      host,
      port: port ? Number(port) : 993,
      username,
      password,
      label,
    });
    return ok(res, account);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return fail(res, message);
  }
});

router.get('/accounts/:id', async (req: Request, res: Response) => {
  try {
    const account = await getAccount(req.params.id);
    if (!account) {
      return fail(res, 'Account not found');
    }
    return ok(res, account);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return fail(res, message);
  }
});

router.put('/accounts/:id', async (req: Request, res: Response) => {
  try {
    const updated = await updateAccount(req.params.id, req.body as UpdateEmailAccountInput);
    if (!updated) {
      return fail(res, 'Account not found');
    }
    return ok(res, updated);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return fail(res, message);
  }
});

router.patch('/accounts/:id', async (req: Request, res: Response) => {
  try {
    const updated = await updateAccount(req.params.id, req.body as UpdateEmailAccountInput);
    if (!updated) {
      return fail(res, 'Account not found');
    }
    return ok(res, updated);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return fail(res, message);
  }
});

router.delete('/accounts/:id', async (req: Request, res: Response) => {
  try {
    const deleted = await deleteAccount(req.params.id);
    return ok(res, { deleted });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return fail(res, message);
  }
});

// Reveal password endpoint (dedicated action per accountVault convention)
router.post('/accounts/:id/reveal', async (req: Request, res: Response) => {
  try {
    const password = await revealAccountPassword(req.params.id);
    if (password === null) {
      return fail(res, 'No password stored or account not found');
    }
    return ok(res, { password });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return fail(res, message);
  }
});

// 2. Inbox List
router.get('/accounts/:id/inbox', async (req: Request, res: Response) => {
  try {
    const result = await listInbox(req.params.id);
    return ok(res, result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return fail(res, message);
  }
});

// 3. Message read
router.get('/accounts/:id/messages/:uid', async (req: Request, res: Response) => {
  try {
    const message = await readMessage(req.params.id, req.params.uid);
    return ok(res, message);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return fail(res, message);
  }
});

// 4. Code Extraction from an inbox message or raw text
router.get('/accounts/:id/messages/:uid/codes', async (req: Request, res: Response) => {
  try {
    const message = await readMessage(req.params.id, req.params.uid);
    const codes = extractCodes(message.body || '');
    return ok(res, { codes, message });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return fail(res, message);
  }
});

router.get('/accounts/:id/codes', async (req: Request, res: Response) => {
  try {
    const { messages } = await listInbox(req.params.id);
    const codes: Array<{ uid: string; subject: string; codes: string[] }> = [];
    for (const msg of messages) {
      const extracted = extractCodes(msg.subject);
      if (extracted.length > 0) {
        codes.push({ uid: msg.uid, subject: msg.subject, codes: extracted });
      }
    }
    return ok(res, { codes });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return fail(res, message);
  }
});

router.post('/extract-codes', (req: Request, res: Response) => {
  try {
    const { text } = req.body as { text?: string };
    const codes = extractCodes(text || '');
    return ok(res, { codes });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return fail(res, message);
  }
});

export default router;
