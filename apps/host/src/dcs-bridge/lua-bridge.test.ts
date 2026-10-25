// SPDX-License-Identifier: GPL-3.0-or-later
// End-to-end check of the Lua side: runs SLATE-export.lua, SLATE-hook.lua and
// the server hook in Lua 5.1 (as DCS does) against a mocked DCS
// (dcs/export/test/harness.lua) and reads every datagram they send with the
// host's own schemas.
//
// Needs a Lua 5.1 interpreter (`lua5.1` or `lua`). Without one the tests are
// skipped – except in CI, where SLATE_REQUIRE_LUA=1 makes that a failure.

import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AnnouncementReader, parseBridgeDatagram } from '@slate-dcs/shared';
import type { BridgeChat, BridgeDatagram, BridgeOwn, BridgeSession } from '@slate-dcs/shared';
import { describe, expect, it } from 'vitest';

import { announceFileText, announcementLines, autostartFileText } from '../cas-relay/announce.js';
import { exportValues } from './convert.js';

const HARNESS = fileURLToPath(new URL('../../../../dcs/export/test/harness.lua', import.meta.url));

function findLua(): string | null {
  for (const command of ['lua5.1', 'lua']) {
    const result = spawnSync(command, ['-v'], { encoding: 'utf8' });
    if (result.error === undefined && `${result.stdout}${result.stderr}`.includes('Lua 5.1')) {
      return command;
    }
  }
  return null;
}

const lua = findLua();
if (lua === null && process.env['SLATE_REQUIRE_LUA'] === '1') {
  throw new Error('SLATE_REQUIRE_LUA=1 but no Lua 5.1 interpreter (lua5.1) was found');
}

interface Run {
  lines: string[];
  datagrams: BridgeDatagram[];
  own: BridgeOwn[];
  sessions: BridgeSession[];
  chain: string[];
  logs: string[];
}

function run(scenario: string, savedGames?: string): Run {
  if (lua === null) throw new Error('no Lua');
  const args = savedGames === undefined ? [HARNESS, scenario] : [HARNESS, scenario, savedGames];
  const result = spawnSync(lua, args, { encoding: 'utf8' });
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  const lines = result.stdout.trim().split('\n');
  expect(lines.at(-1)).toBe('DONE');
  const datagrams = lines
    .filter((line) => line.startsWith('DGRAM '))
    .map((line) => {
      const parsed = parseBridgeDatagram(line.slice(6));
      if (!parsed.ok) throw new Error(`Rejected by the host: ${JSON.stringify(parsed)}\n${line}`);
      return parsed.datagram;
    });
  return {
    lines,
    datagrams,
    own: datagrams.filter((d): d is BridgeOwn => d.t === 'own'),
    sessions: datagrams.filter((d): d is BridgeSession => d.t === 'session'),
    chain: lines.filter((line) => line.startsWith('CHAIN ')).map((line) => line.slice(6)),
    logs: lines.filter((line) => line.startsWith('LOG ')),
  };
}

describe.skipIf(lua === null)('Lua bridge – export script', () => {
  it('sends hello and own at 4 Hz to 127.0.0.1:7791, all accepted by the host', () => {
    const { lines, datagrams, own } = run('export');
    expect(lines[0]).toBe('PEER 127.0.0.1 7791');
    expect(datagrams[0]).toEqual({ t: 'hello', bv: 4, env: 'export', dcs: '2.9.30.28738' });
    // 2.5 s of frames at 50 fps → one datagram every 13th frame (0.26 s).
    expect(own.length).toBeGreaterThanOrEqual(9);
    expect(own.length).toBeLessThanOrEqual(10);
  });

  it('gives the host what it needs: true heading, fuel, payload', () => {
    const [first] = run('export').own;
    if (first === undefined) throw new Error('no own datagram');
    const values = exportValues(first);
    expect(values.hdg).toBeCloseTo(45.61, 1);
    expect(values.hdgMag).toBeCloseTo(38.53, 1);
    expect(values.fuel?.internalKg).toBe(4900);
    expect(values.fuel?.externalKg).toBeCloseTo(1018, 0);
    expect(
      values.armament?.stations.map((s) => `${String(s.st)} ${s.name} ×${String(s.count)}`),
    ).toEqual(['1 AIM-9X ×1', '2 AGM-65F Maverick ×1', '3 Mk20 Rockeye ×2']);
    expect(values.armament?.stores.map((s) => s.name)).toEqual(['Litening TGP', 'FPU-8A tank']);
    expect(values.armament?.gun?.rounds).toBe(578);
    expect(values.countermeasures).toEqual({ chaff: 60, flare: 60 });
    expect(values.airData).toEqual({ tas: 282.638885498, mach: 0.827642619915, vs: 0 });
    expect(first.start).toBe(64800);
  });

  it('reports a release within the next datagram, and looks names up once per type', () => {
    const { own, lines } = run('export');
    const counts = own.map((d) => d.payload?.find((s) => s.st === 1)?.count);
    expect(counts.slice(0, 7).every((c) => c === 1)).toBe(true);
    expect(counts.at(-1)).toBe(0);
    expect(lines).toContain('LOOKUPS 5');
  });

  it('keeps the other export tool working (daisy chain)', () => {
    const { chain } = run('export');
    expect(chain.filter((c) => c === 'start')).toHaveLength(1);
    expect(chain.filter((c) => c === 'frame')).toHaveLength(125);
    expect(chain.filter((c) => c === 'stop')).toHaveLength(1);
  });

  it('chains only once when loaded twice', () => {
    const { chain, datagrams } = run('twice');
    expect(chain.filter((c) => c === 'start')).toHaveLength(1);
    expect(chain.filter((c) => c === 'frame')).toHaveLength(15);
    expect(datagrams.filter((d) => d.t === 'hello')).toHaveLength(1);
  });

  it('sends bare datagrams for a JTAC on the F10 map', () => {
    const [first] = run('empty').own;
    if (first === undefined) throw new Error('no own datagram');
    expect(exportValues(first).avail).toEqual({
      pos: false,
      fuel: false,
      payload: false,
    });
  });

  it('survives getters that raise, and the other tool keeps running', () => {
    const { own, chain } = run('errors');
    expect(own.length).toBeGreaterThan(0);
    expect(own[0]?.lat).toBeNull();
    expect(chain.filter((c) => c === 'frame')).toHaveLength(30);
  });

  it('works with no Lo* functions and no other tool', () => {
    expect(run('missing').own.length).toBeGreaterThan(0);
  });

  it('keeps sending while the mission is paused (model time stands still)', () => {
    const own = run('pause').own;
    expect(own.length).toBeGreaterThanOrEqual(5);
    expect(own.slice(-3).every((d) => d.mt === own.at(-1)?.mt)).toBe(true);
  });
});

describe.skipIf(lua === null)('Lua bridge – GUI hook', () => {
  it('reports load, start, slot change, beats and stop', () => {
    const { sessions } = run('hook');
    expect(sessions.map((s) => s.ev)).toEqual(['load', 'start', 'slot', 'beat', 'stop']);
    expect(sessions[0]).toMatchObject({
      running: false,
      mission: { name: 'VWA_CAU_2.2.11', theatre: 'Caucasus', date: '2026-10-09', start: 36000 },
      mp: true,
      server: false,
      player: { name: 'VWA | Pilot', side: 0, slot: null, unitType: null },
    });
    expect(sessions[2]?.player).toEqual({
      name: 'VWA | Pilot',
      side: 2,
      slot: '1000043',
      unitType: 'FA-18C_hornet',
    });
    expect(sessions.at(-1)).toMatchObject({ ev: 'stop', running: false });
  });

  it('never sends the UCID or IP address', () => {
    const { lines } = run('hook');
    const all = lines.join('\n');
    expect(all).not.toContain('SECRET-UCID');
    expect(all).not.toContain('10.0.0.9');
  });

  it('counts what DCS.getCurrentMission() shows, per coalition', () => {
    const check = run('hook').datagrams.find((d) => d.t === 'missionCheck');
    expect(check).toEqual({
      t: 'missionCheck',
      bv: 4,
      coalitions: {
        blue: { groups: 3, units: 7, routed: 1, withFrequency: 1 },
        red: { groups: 0, units: 0, routed: 0, withFrequency: 0 },
      },
    });
  });

  it('keeps working with an unreadable mission and a broken net table', () => {
    const { sessions } = run('hookErrors');
    expect(sessions.map((s) => s.ev)).toEqual(['load', 'start']);
    expect(sessions[1]).toMatchObject({ running: true, mission: null, player: null });
  });
});

describe.skipIf(lua === null)('Lua bridge – discovery chat (P1.7)', () => {
  it('passes only [SLATE] lines on, marked when the server sent them', () => {
    const chats = run('hookChat').datagrams.filter((d): d is BridgeChat => d.t === 'chat');
    expect(chats.map((c) => [c.server, c.text.slice(0, 30)])).toEqual([
      [true, '[SLATE] v1 lan 192.168.1.20:77'],
      [false, '[SLATE] v1 lan 10.6.6.6:7790 c'],
      [true, '[SLATE] v1 code RED-7K3Q9XPM'],
      [true, '[SLATE] yyyyyyyyyyyyyyyyyyyyyy'],
    ]);
    expect(chats.at(-1)?.text.length).toBe(1000);
    expect(chats.map((c) => [c.from, c.serverId])).toEqual([
      [1, 1],
      [7, 1],
      [1, 1],
      [1, 1],
    ]);
  });
});

describe.skipIf(lua === null)('Lua server hook (P1.7)', () => {
  const FP = 'NZ5N-SEHR-0N1A-CA2G-QN0B-WFQE-30';
  const lines = announcementLines({
    codes: { blue: 'BLUE-7K3Q9XPM', red: 'RED-4H8W2NCD' },
    fingerprint: FP,
    publicAddress: 'slate-grp.dyndns.org:7790',
    lanAddress: '192.168.1.20:7790',
    maxLength: 80,
  });

  async function withServerFolder<T>(text: string | null, fn: (dir: string) => T): Promise<T> {
    const dir = await mkdtemp(join(tmpdir(), 'slate-server-'));
    try {
      if (text !== null) {
        await mkdir(join(dir, 'Scripts', 'SLATE'), { recursive: true });
        await writeFile(join(dir, 'Scripts', 'SLATE', 'SLATE-announce.lua'), text);
      }
      return fn(dir);
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  }

  it("sends a player his coalition's lines on join and slot change, throttled", async () => {
    const out = await withServerFolder(announceFileText(lines), (dir) => run('server', dir));
    const chat = out.lines.filter((l) => l.startsWith('CHAT ') || l.startsWith('MARK '));
    const blue = lines.blue.map((l) => `CHAT 2 1 ${l}`);
    const red = lines.red.map((l) => `CHAT 2 1 ${l}`);
    // join (blue), 11 s later again, red at once, rejoin; nothing in single player
    expect(chat).toEqual([...blue, ...blue, ...red, ...red, 'MARK single']);
    expect(out.logs).toEqual([]);

    // What the client's host makes of the split lines: the announcement again.
    const reader = new AnnouncementReader();
    const parsed = lines.red.map((l) => reader.feed(l, 0)).at(-1);
    expect(parsed).toMatchObject({
      code: 'RED-4H8W2NCD',
      lan: '192.168.1.20:7790',
      fingerprint: FP,
    });
  });

  it('announces nothing while the relay is stopped', async () => {
    const out = await withServerFolder(announceFileText(null), (dir) => run('server', dir));
    expect(out.lines.filter((l) => l.startsWith('CHAT '))).toEqual([]);
  });

  it('keeps quiet without an announce file and with a broken net table', async () => {
    const out = await withServerFolder(null, (dir) => run('serverNoFile', dir));
    expect(out.lines.filter((l) => l.startsWith('CHAT '))).toEqual([]);
    expect(out.logs).toHaveLength(1);
    expect(out.logs[0]).toMatch(/server hook onPlayerChangeSlot: .*net broken/);
  });

  it('a broken announce file sends nothing', async () => {
    const out = await withServerFolder('return { blue = { os.exit(1) } }', (dir) =>
      run('server', dir),
    );
    expect(out.lines.filter((l) => l.startsWith('CHAT '))).toEqual([]);
  });

  it('starts the relay on a mission load when nothing answers on its port', async () => {
    const start = autostartFileText({
      exe: 'C:\\SLATE\\relay\\slate-relay.exe',
      args: ['--data', 'C:\\SLATE\\relay\\data'],
      port: 7790,
    });
    const dir = await mkdtemp(join(tmpdir(), 'slate-server-'));
    try {
      await mkdir(join(dir, 'Scripts', 'SLATE'), { recursive: true });
      await writeFile(join(dir, 'Scripts', 'SLATE', 'SLATE-relay.lua'), start);
      const out = run('serverAutostart', dir);
      expect(out.lines.filter((l) => /^(PROBE|EXEC) /.test(l))).toEqual([
        'PROBE 127.0.0.1 7790',
        'EXEC start "slate-relay" /min "C:\\SLATE\\relay\\slate-relay.exe" "--data" "C:\\SLATE\\relay\\data"',
        'PROBE 127.0.0.1 7790',
        'PROBE 127.0.0.1 7790',
      ]);
      expect(out.logs).toEqual(['LOG starting slate-relay: C:\\SLATE\\relay\\slate-relay.exe']);
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });

  it('does nothing on a mission load without the autostart file', async () => {
    const out = await withServerFolder(announceFileText(null), (dir) =>
      run('serverAutostart', dir),
    );
    expect(out.lines.filter((l) => /^(PROBE|EXEC) /.test(l))).toEqual([]);
  });
});
