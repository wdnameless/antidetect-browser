import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';

export interface AuditRecord {
  seq?: number;
  ts: string;
  nonce: string;
  tool: string;
  argsHash: string;
  decision: 'allow' | 'deny' | 'error';
  prevHash: string;
  hash: string;
  error?: string;
  caller?: string;
}

export interface VerificationResult {
  valid: boolean;
  brokenLineIndex?: number;
  error?: string;
  totalRecords?: number;
}

export class McpAuditLogger {
  private readonly filePath: string;
  private prevHash: string;
  private seq: number;

  constructor(customPath?: string) {
    if (customPath) {
      this.filePath = path.resolve(customPath);
    } else if (process.env.ANTIDETECT_MCP_AUDIT_PATH) {
      this.filePath = path.resolve(process.env.ANTIDETECT_MCP_AUDIT_PATH);
    } else {
      const appData =
        process.env.APPDATA ||
        (process.platform === 'darwin'
          ? path.join(os.homedir(), 'Library', 'Application Support')
          : path.join(os.homedir(), '.config'));
      this.filePath = path.join(appData, 'antidetect-browser', 'mcp-audit.jsonl');
    }

    this.prevHash = '0'.repeat(64);
    this.seq = 0;

    this.initFromExisting();
  }

  public getFilePath(): string {
    return this.filePath;
  }

  private initFromExisting(): void {
    if (!fs.existsSync(this.filePath)) {
      return;
    }

    try {
      const content = fs.readFileSync(this.filePath, 'utf8');
      const lines = content.split('\n').filter((l) => l.trim().length > 0);
      if (lines.length > 0) {
        const lastLine = lines[lines.length - 1];
        const record = JSON.parse(lastLine) as AuditRecord;
        if (record.hash) {
          this.prevHash = record.hash;
        }
        if (typeof record.seq === 'number') {
          this.seq = record.seq;
        } else {
          this.seq = lines.length;
        }
      }
    } catch {
      // If unable to read or parse last line, fallback to genesis
      this.prevHash = '0'.repeat(64);
      this.seq = 0;
    }
  }

  public computeArgsHash(args: unknown): string {
    const raw = args !== undefined && args !== null ? JSON.stringify(args) : '{}';
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  public log(entry: {
    nonce: string;
    tool: string;
    args?: unknown;
    argsHash?: string;
    decision: 'allow' | 'deny' | 'error';
    error?: string;
    caller?: string;
    ts?: string;
  }): AuditRecord {
    this.seq += 1;
    const ts = entry.ts || new Date().toISOString();
    const nonce = entry.nonce;
    const tool = entry.tool;
    const argsHash = entry.argsHash || this.computeArgsHash(entry.args);
    const decision = entry.decision;
    const prevHash = this.prevHash;

    const hashPayload = prevHash + ts + nonce + tool + argsHash + decision;
    const hash = crypto.createHash('sha256').update(hashPayload).digest('hex');

    const record: AuditRecord = {
      seq: this.seq,
      ts,
      nonce,
      tool,
      argsHash,
      decision,
      prevHash,
      hash,
      ...(entry.error ? { error: entry.error } : {}),
      ...(entry.caller ? { caller: entry.caller } : {}),
    };

    this.prevHash = hash;

    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.appendFileSync(this.filePath, JSON.stringify(record) + '\n', 'utf8');
    } catch (err) {
      console.error(`[McpAuditLogger] Failed to write audit record:`, err);
    }

    return record;
  }
}

export function verifyLog(filePath: string): VerificationResult {
  if (!fs.existsSync(filePath)) {
    return { valid: true, totalRecords: 0 };
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n').filter((l) => l.trim().length > 0);

  let expectedPrevHash = '0'.repeat(64);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let record: AuditRecord;
    try {
      record = JSON.parse(line) as AuditRecord;
    } catch (err) {
      return {
        valid: false,
        brokenLineIndex: i,
        error: `JSON parse error on line ${i + 1}: ${String(err)}`,
        totalRecords: lines.length,
      };
    }

    if (record.prevHash !== expectedPrevHash) {
      return {
        valid: false,
        brokenLineIndex: i,
        error: `Invalid prevHash at line ${i + 1}: expected ${expectedPrevHash}, got ${record.prevHash}`,
        totalRecords: lines.length,
      };
    }

    const payload = record.prevHash + record.ts + record.nonce + record.tool + record.argsHash + record.decision;
    const computedHash = crypto.createHash('sha256').update(payload).digest('hex');

    if (computedHash !== record.hash) {
      return {
        valid: false,
        brokenLineIndex: i,
        error: `Hash mismatch at line ${i + 1}: computed ${computedHash}, got ${record.hash}`,
        totalRecords: lines.length,
      };
    }

    expectedPrevHash = record.hash;
  }

  return { valid: true, totalRecords: lines.length };
}
