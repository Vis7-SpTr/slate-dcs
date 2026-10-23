// SPDX-License-Identifier: GPL-3.0-or-later
// Paired devices and the LAN switch (architecture.md §1.1, "Pairing and access
// control"; decided 23 Oct 2026): a device stays paired until it is removed,
// or after 90 days without use. Pairing uses a single-use secret, valid
// 5 minutes, exchanged for a long random cookie; only the cookie's hash is
// stored. The file lives in SLATE's data folder (lan.json).

import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { z } from 'zod';

import { writeFileAtomic } from '../fs-safe.js';

/** How long a pairing QR code works. */
export const PAIRING_MS = 5 * 60_000;
/** Paired devices unused this long are dropped. */
export const UNUSED_MS = 90 * 24 * 3_600_000;
/** `lastSeen` is written to disk at most this often per device. */
const SEEN_WRITE_MS = 60 * 60_000;

const Record_ = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  pairedAt: z.int().nonnegative(),
  lastSeen: z.int().nonnegative(),
  tokenHash: z.string().length(64),
});
export type DeviceRecord = z.infer<typeof Record_>;
const File = z.object({ enabled: z.boolean(), devices: z.array(Record_) });

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

/** `iPad · Safari`, `Windows · Edge`, … from a User-Agent header. */
export function deviceName(userAgent: string | undefined): string {
  const ua = userAgent ?? '';
  const os = ua.includes('iPad')
    ? 'iPad'
    : ua.includes('iPhone')
      ? 'iPhone'
      : ua.includes('Android')
        ? 'Android'
        : ua.includes('Windows')
          ? 'Windows'
          : /Macintosh|Mac OS X/.test(ua)
            ? // iPadOS asks for desktop pages and calls itself a Mac.
              ua.includes('Mobile/')
              ? 'iPad'
              : 'Mac'
            : ua.includes('Linux')
              ? 'Linux'
              : 'Device';
  const browser = ua.includes('Edg/')
    ? 'Edge'
    : /Firefox\/|FxiOS/.test(ua)
      ? 'Firefox'
      : /Chrome\/|CriOS/.test(ua)
        ? 'Chrome'
        : ua.includes('Safari/')
          ? 'Safari'
          : null;
  return browser ? `${os} · ${browser}` : os;
}

export class DeviceStore {
  readonly #path: string;
  readonly #now: () => number;
  #enabled = false;
  #devices: DeviceRecord[] = [];
  #byHash = new Map<string, DeviceRecord>();
  #pairing: { secretHash: string; expiresAt: number } | null = null;
  #written = new Map<string, number>();
  #failures: number[] = [];
  #saving: Promise<void> = Promise.resolve();

  constructor(path: string, now: () => number = Date.now) {
    this.#path = path;
    this.#now = now;
  }

  get enabled(): boolean {
    return this.#enabled;
  }

  get devices(): readonly DeviceRecord[] {
    return this.#devices;
  }

  /** Reads lan.json (missing or broken = LAN off, no devices) and drops unused devices. */
  async load(): Promise<void> {
    try {
      const parsed = File.safeParse(JSON.parse(await readFile(this.#path, 'utf8')));
      if (parsed.success) {
        this.#enabled = parsed.data.enabled;
        this.#devices = parsed.data.devices;
      }
    } catch {
      // first start
    }
    await this.prune();
  }

  async setEnabled(enabled: boolean): Promise<void> {
    this.#enabled = enabled;
    if (!enabled) this.#pairing = null;
    await this.#save();
  }

  /** Opens a pairing: a new single-use secret (the previous one stops working). */
  startPairing(): { secret: string; expiresAt: number } {
    const secret = randomBytes(16).toString('base64url');
    const expiresAt = this.#now() + PAIRING_MS;
    this.#pairing = { secretHash: hash(secret), expiresAt };
    return { secret, expiresAt };
  }

  cancelPairing(): void {
    this.#pairing = null;
  }

  get pairingOpen(): boolean {
    return this.#pairing !== null && this.#now() < this.#pairing.expiresAt;
  }

  /**
   * Exchanges the secret for a device cookie token. `null` if the secret is
   * wrong, used or expired – or after 10 wrong tries in a minute (then for a
   * minute every try fails).
   */
  async pair(
    secret: string,
    userAgent: string | undefined,
  ): Promise<{ token: string; device: DeviceRecord } | null> {
    const now = this.#now();
    this.#failures = this.#failures.filter((t) => now - t < 60_000);
    if (this.#failures.length >= 10) return null;
    const pairing = this.#pairing;
    if (!pairing || now >= pairing.expiresAt || hash(secret) !== pairing.secretHash) {
      this.#failures.push(now);
      return null;
    }
    this.#pairing = null;
    const token = randomBytes(32).toString('base64url');
    const device: DeviceRecord = {
      id: `d_${randomBytes(3).toString('hex')}`,
      name: deviceName(userAgent),
      pairedAt: now,
      lastSeen: now,
      tokenHash: hash(token),
    };
    this.#devices.push(device);
    this.#index();
    await this.#save();
    return { token, device };
  }

  /** The device for a cookie token, if paired. Updates `lastSeen`. */
  verify(token: string | undefined): DeviceRecord | null {
    if (token === undefined || token === '') return null;
    const device = this.#byHash.get(hash(token)) ?? null;
    if (device) {
      const now = this.#now();
      device.lastSeen = now;
      if (now - (this.#written.get(device.id) ?? 0) > SEEN_WRITE_MS) {
        this.#written.set(device.id, now);
        // Only "last seen": a failed write is retried with the next one, it must not end SLATE.
        this.#save().catch(() => undefined);
      }
    }
    return device;
  }

  async remove(id: string): Promise<boolean> {
    const before = this.#devices.length;
    this.#devices = this.#devices.filter((d) => d.id !== id);
    this.#index();
    await this.#save();
    return this.#devices.length < before;
  }

  async removeAll(): Promise<void> {
    this.#devices = [];
    this.#index();
    await this.#save();
  }

  /** Drops devices unused for 90 days. Returns their IDs. */
  async prune(): Promise<string[]> {
    const now = this.#now();
    const gone = this.#devices.filter((d) => now - d.lastSeen > UNUSED_MS).map((d) => d.id);
    if (gone.length > 0) {
      this.#devices = this.#devices.filter((d) => !gone.includes(d.id));
      await this.#save();
    }
    this.#index();
    return gone;
  }

  #index(): void {
    this.#byHash = new Map(this.#devices.map((d) => [d.tokenHash, d]));
  }

  /** Resolves once every queued write of lan.json is done. */
  idle(): Promise<void> {
    return this.#saving.catch(() => undefined);
  }

  /** Writes lan.json; writes queue up, so two never overlap. */
  #save(): Promise<void> {
    const write = async () => {
      const data = { enabled: this.#enabled, devices: this.#devices };
      await writeFileAtomic(this.#path, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    };
    this.#saving = this.#saving.then(write, write);
    return this.#saving;
  }
}
