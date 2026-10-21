// SPDX-License-Identifier: GPL-3.0-or-later
// The relay's self-signed certificate and its fingerprint (protocol.md §3.1).
// No domain or CA is needed: hosts pin the fingerprint, from the discovery
// chat line or confirmed by the player on the first manual connect.

import { createHash, webcrypto } from 'node:crypto';

// @peculiar/x509 needs the Reflect metadata polyfill loaded first.
import 'reflect-metadata';
import * as x509 from '@peculiar/x509';

/** Crockford base32 – no I, L, O, U. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export interface RelayCertificate {
  certPem: string;
  keyPem: string;
}

/** A new ECDSA P-256 key and a self-signed certificate valid for 20 years. */
export async function createCertificate(now: Date = new Date()): Promise<RelayCertificate> {
  x509.cryptoProvider.set(webcrypto);
  const algorithm = { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' };
  const keys = await webcrypto.subtle.generateKey(algorithm, true, ['sign', 'verify']);
  const notAfter = new Date(now);
  notAfter.setUTCFullYear(notAfter.getUTCFullYear() + 20);
  const cert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: Buffer.from(webcrypto.getRandomValues(new Uint8Array(16))).toString('hex'),
    name: 'CN=slate-relay',
    notBefore: now,
    notAfter,
    keys,
    signingAlgorithm: algorithm,
  });
  const pkcs8 = await webcrypto.subtle.exportKey('pkcs8', keys.privateKey);
  return {
    certPem: cert.toString('pem'),
    keyPem: x509.PemConverter.encode(pkcs8, 'PRIVATE KEY'),
  };
}

/** DER bytes of a PEM certificate. */
export function certificateDer(certPem: string): Buffer {
  const base64 = certPem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, '');
  return Buffer.from(base64, 'base64');
}

/**
 * Fingerprint (§3.1): SHA-256 of the certificate (DER), first 128 bits,
 * Crockford base32 (26 characters) in groups of four: `4D2A-QX7M-…-XY`.
 */
export function fingerprint(der: Uint8Array): string {
  const bytes = createHash('sha256').update(der).digest().subarray(0, 16);
  let bits = 0n;
  for (const byte of bytes) bits = (bits << 8n) | BigInt(byte);
  bits <<= 2n; // 128 bits → 130 = 26 × 5
  let text = '';
  for (let i = 25; i >= 0; i -= 1) text += ALPHABET.charAt(Number((bits >> BigInt(i * 5)) & 31n));
  return text.match(/.{1,4}/g)?.join('-') ?? text;
}
