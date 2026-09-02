import { generateKeyPairSync, sign, verify, createHash } from 'crypto';
import { canonicalizeJson } from './jcs';

export const DOMAIN_SEPARATOR_LEGACY_CORPUS = 'antidetect:legacy-corpus:v1\0';

export interface KeyPairResult {
  publicKeyPem: string;
  privateKeyPem: string;
  keyId: string;
  publicKey: string;
  privateKey: string;
}

export function generateEd25519KeyPair(): KeyPairResult {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const keyId = createHash('sha256').update(publicKey, 'utf8').digest('hex').substring(0, 16);
  return {
    publicKeyPem: publicKey,
    privateKeyPem: privateKey,
    publicKey,
    privateKey,
    keyId,
  };
}

export function signCorpusPayload(
  payloadWithoutSignature: Record<string, unknown>,
  privateKeyPem: string,
  domain: string = DOMAIN_SEPARATOR_LEGACY_CORPUS
): string {
  const canonicalBytes = Buffer.from(canonicalizeJson(payloadWithoutSignature), 'utf8');
  const domainBytes = Buffer.from(domain, 'utf8');
  const messageToSign = Buffer.concat([domainBytes, canonicalBytes]);

  const signatureBuffer = sign(null, messageToSign, privateKeyPem);
  return signatureBuffer.toString('hex');
}

export function verifyCorpusPayload(
  payloadWithoutSignature: Record<string, unknown>,
  signatureHex: string,
  publicKeyPem: string,
  domain: string = DOMAIN_SEPARATOR_LEGACY_CORPUS
): boolean {
  try {
    const canonicalBytes = Buffer.from(canonicalizeJson(payloadWithoutSignature), 'utf8');
    const domainBytes = Buffer.from(domain, 'utf8');
    const messageToVerify = Buffer.concat([domainBytes, canonicalBytes]);
    const signatureBuffer = Buffer.from(signatureHex, 'hex');

    return verify(null, messageToVerify, publicKeyPem, signatureBuffer);
  } catch {
    return false;
  }
}

export function signLegacyCorpus(
  payloadWithoutSignature: Record<string, unknown>,
  privateKeyPem: string
): string {
  return signCorpusPayload(payloadWithoutSignature, privateKeyPem, DOMAIN_SEPARATOR_LEGACY_CORPUS);
}

export function verifyLegacyCorpus(
  payloadWithoutSignature: Record<string, unknown>,
  signatureHex: string,
  publicKeyPem: string
): boolean {
  return verifyCorpusPayload(payloadWithoutSignature, signatureHex, publicKeyPem, DOMAIN_SEPARATOR_LEGACY_CORPUS);
}

export interface SignedLegacyCorpusEnvelope {
  schemaVersion: string;
  envelope: string;
  timestamp: string;
  publicKey: string;
  signature: string;
  fixtures: Array<{
    path: string;
    method: string;
    body?: Record<string, unknown>;
    expectedStatus?: number;
    expectedErrorCode?: string;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

export function verifyLegacyCorpusSignature(envelope: SignedLegacyCorpusEnvelope): { valid: boolean; error?: string } {
  if (!envelope || typeof envelope !== 'object') {
    return { valid: false, error: 'Invalid envelope object' };
  }
  if (!envelope.publicKey || !envelope.signature) {
    return { valid: false, error: 'Missing publicKey or signature' };
  }

  const { signature, ...payloadWithoutSignature } = envelope;
  const isValid = verifyLegacyCorpus(
    payloadWithoutSignature as Record<string, unknown>,
    signature,
    envelope.publicKey
  );

  if (!isValid) {
    return { valid: false, error: 'Signature mismatch or payload tampered' };
  }

  return { valid: true };
}
