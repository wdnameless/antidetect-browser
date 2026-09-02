import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { canonicalizeJson } from './jcs';

export interface AssertionResult {
  id: string;
  name: string;
  passed: boolean;
  message?: string;
  details?: unknown;
}

export interface ArtifactEntry {
  path: string;
  sha256?: string;
  description?: string;
}

export type EvidenceStatus = 'pass' | 'fail' | 'unresolved';

export interface EvidenceRecord {
  schemaVersion: '1';
  command: string;
  status: EvidenceStatus;
  passed: number;
  failed: number;
  unresolved: number;
  assertions: AssertionResult[];
  artifacts: ArtifactEntry[];
  startedAt: string;
  finishedAt: string;
  [key: string]: unknown;
}

export interface NormalizedSummaryRecord extends EvidenceRecord {
  rawPath?: string;
  rawSha256?: string;
  summarySha256?: string;
}

export function computeSha256(filePathOrContent: string | Buffer): string {
  if (Buffer.isBuffer(filePathOrContent)) {
    return createHash('sha256').update(filePathOrContent).digest('hex');
  }
  if (typeof filePathOrContent === 'string' && fs.existsSync(filePathOrContent) && fs.statSync(filePathOrContent).isFile()) {
    return createHash('sha256').update(fs.readFileSync(filePathOrContent)).digest('hex');
  }
  return createHash('sha256').update(filePathOrContent, 'utf8').digest('hex');
}

export function buildEvidenceReport(params: {
  command: string;
  status?: EvidenceStatus;
  assertions?: AssertionResult[];
  artifacts?: ArtifactEntry[];
  startedAt?: string;
  finishedAt?: string;
  extra?: Record<string, unknown>;
}): EvidenceRecord {
  const assertions = params.assertions || [];
  const artifacts = params.artifacts || [];
  const startedAt = params.startedAt || new Date().toISOString();
  const finishedAt = params.finishedAt || new Date().toISOString();

  const passed = assertions.filter((a) => a.passed).length;
  const failed = assertions.filter((a) => !a.passed).length;
  const unresolved = 0;

  let computedStatus: EvidenceStatus = 'pass';
  if (failed > 0) {
    computedStatus = 'fail';
  } else if (unresolved > 0) {
    computedStatus = 'unresolved';
  }

  const finalStatus = params.status || computedStatus;

  return {
    schemaVersion: '1',
    command: params.command,
    status: finalStatus,
    passed,
    failed,
    unresolved,
    assertions,
    artifacts,
    startedAt,
    finishedAt,
    ...(params.extra || {}),
  };
}

export function writeImmutableRawEvidence(rawPath: string, data: unknown): { rawPath: string; rawSha256: string } {
  const resolved = path.resolve(rawPath);
  if (fs.existsSync(resolved)) {
    throw new Error(`Immutable raw evidence file already exists and cannot be overwritten: ${resolved}`);
  }
  const dir = path.dirname(resolved);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  fs.writeFileSync(resolved, content, 'utf8');
  const rawSha256 = computeSha256(Buffer.from(content, 'utf8'));
  return { rawPath: resolved, rawSha256 };
}

export function writeCanonicalSummaryEvidence(
  summaryPath: string,
  record: EvidenceRecord,
  rawMeta?: { rawPath: string; rawSha256: string }
): { summaryPath: string; summarySha256: string; content: string } {
  const resolved = path.resolve(summaryPath);
  const dir = path.dirname(resolved);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const payload: NormalizedSummaryRecord = {
    ...record,
    ...(rawMeta ? { rawPath: path.normalize(rawMeta.rawPath), rawSha256: rawMeta.rawSha256 } : {}),
  };

  const canonicalString = canonicalizeJson(payload);
  const summarySha256 = createHash('sha256').update(canonicalString, 'utf8').digest('hex');
  
  payload.summarySha256 = summarySha256;
  const finalCanonical = canonicalizeJson(payload);

  fs.writeFileSync(resolved, finalCanonical, 'utf8');
  return { summaryPath: resolved, summarySha256, content: finalCanonical };
}

export function createRawAndNormalizedEvidence(options: {
  rawOutPath: string;
  normalizedOutPath: string;
  report: EvidenceRecord;
  rawData?: unknown;
  overwriteRaw?: boolean;
}): { rawPath: string; rawSha256: string; summaryPath: string; summarySha256: string; normalized: NormalizedSummaryRecord } {
  const resolvedRaw = path.resolve(options.rawOutPath);
  if (!options.overwriteRaw && fs.existsSync(resolvedRaw)) {
    throw new Error(`Refusing to overwrite existing raw evidence: ${resolvedRaw}`);
  }

  const rawMeta = writeImmutableRawEvidence(resolvedRaw, options.rawData !== undefined ? options.rawData : options.report);
  const summaryRes = writeCanonicalSummaryEvidence(options.normalizedOutPath, options.report, rawMeta);

  const normalized = JSON.parse(summaryRes.content) as NormalizedSummaryRecord;
  return {
    rawPath: rawMeta.rawPath,
    rawSha256: rawMeta.rawSha256,
    summaryPath: summaryRes.summaryPath,
    summarySha256: summaryRes.summarySha256,
    normalized,
  };
}

export async function runEvidenceWrapper(
  command: string,
  outPath: string | undefined,
  executor: () => Promise<{ assertions: AssertionResult[]; artifacts?: ArtifactEntry[]; extra?: Record<string, unknown>; statusOverride?: EvidenceStatus }>,
  options?: { rawOutPath?: string; strict?: boolean }
): Promise<EvidenceRecord> {
  const startedAt = new Date().toISOString();
  let assertions: AssertionResult[] = [];
  let artifacts: ArtifactEntry[] = [];
  let extra: Record<string, unknown> = {};
  let statusOverride: EvidenceStatus | undefined;

  try {
    const res = await executor();
    assertions = res.assertions;
    artifacts = res.artifacts || [];
    extra = res.extra || {};
    statusOverride = res.statusOverride;
  } catch (err: unknown) {
    assertions.push({
      id: 'execution-error',
      name: `Execution failure in ${command}`,
      passed: false,
      message: err instanceof Error ? err.message : String(err),
    });
  }

  const finishedAt = new Date().toISOString();
  const passed = assertions.filter((a) => a.passed).length;
  const failed = assertions.filter((a) => !a.passed).length;
  const unresolved = 0;

  let computedStatus: EvidenceStatus = 'pass';
  if (failed > 0) {
    computedStatus = 'fail';
  } else if (unresolved > 0) {
    computedStatus = 'unresolved';
  }

  const status: EvidenceStatus = statusOverride || computedStatus;

  // Enrich artifacts with sha256 digests if available
  const enrichedArtifacts = artifacts.map((art) => {
    if (!art.sha256 && fs.existsSync(art.path) && fs.statSync(art.path).isFile()) {
      return { ...art, sha256: computeSha256(art.path) };
    }
    return art;
  });

  const record = buildEvidenceReport({
    command,
    status,
    assertions,
    artifacts: enrichedArtifacts,
    startedAt,
    finishedAt,
    extra,
  });

  if (outPath) {
    let rawMeta: { rawPath: string; rawSha256: string } | undefined;
    if (options?.rawOutPath) {
      rawMeta = writeImmutableRawEvidence(options.rawOutPath, record);
    }
    writeCanonicalSummaryEvidence(outPath, record, rawMeta);
  } else {
    console.log(JSON.stringify(record, null, 2));
  }

  if (record.status !== 'pass') {
    process.exitCode = 1;
  }

  return record;
}
