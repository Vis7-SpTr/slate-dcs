// SPDX-License-Identifier: GPL-3.0-or-later

import { createPrivateKey, X509Certificate } from 'node:crypto';

import { RelayFingerprint } from '@slate-dcs/shared';
import { describe, expect, it } from 'vitest';

import { certificateDer, createCertificate, fingerprint } from './tls.js';

describe('fingerprint (§3.1)', () => {
  it('is the first 128 bits of SHA-256 in Crockford base32, groups of four', () => {
    // SHA-256("slate") starts b62f3b3b1b40cb86438bf4d2affd121f.
    expect(fingerprint(Buffer.from('slate'))).toBe('PRQK-PERV-835R-CGWB-YK9A-ZZ8J-3W');
    expect(RelayFingerprint.safeParse(fingerprint(Buffer.from('slate'))).success).toBe(true);
  });
});

describe('createCertificate', () => {
  it('makes a self-signed P-256 certificate that matches its key, valid for 20 years', async () => {
    const now = new Date('2026-10-21T20:00:00Z');
    const { certPem, keyPem } = await createCertificate(now);
    const cert = new X509Certificate(certPem);
    expect(cert.subject).toBe('CN=slate-relay');
    expect(cert.checkIssued(cert)).toBe(true);
    expect(cert.checkPrivateKey(createPrivateKey(keyPem))).toBe(true);
    expect(new Date(cert.validTo).getUTCFullYear()).toBe(2046);
    expect(fingerprint(certificateDer(certPem))).toBe(fingerprint(cert.raw));
  });
});
