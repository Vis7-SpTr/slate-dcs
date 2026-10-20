// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  ErrorMessage,
  Hello,
  MsgReceived,
  negotiateProtocol,
  Reject,
  RelayReceipt,
  Welcome,
} from './control.js';
import { envelope, ID_2 } from './test-helpers.js';

describe('confirmations', () => {
  it('accepts relay.receipt with a seq', () => {
    const msg = { ...envelope({ re: ID_2 }), type: 'relay.receipt', body: { seq: 4183 } };
    expect(RelayReceipt.safeParse(msg).success).toBe(true);
  });

  it('rejects relay.receipt without a seq', () => {
    const msg = { ...envelope({ re: ID_2 }), type: 'relay.receipt', body: {} };
    expect(RelayReceipt.safeParse(msg).success).toBe(false);
  });

  it('accepts msg.received with an empty body', () => {
    const msg = { ...envelope({ re: ID_2 }), type: 'msg.received', body: {} };
    expect(MsgReceived.safeParse(msg).success).toBe(true);
  });
});

describe('error', () => {
  const error = (body: unknown) => ({ ...envelope({ re: ID_2 }), type: 'error', body });

  it('accepts the example from protocol.md §1.3', () => {
    expect(
      ErrorMessage.safeParse(error({ code: 'badCode', text: 'Unknown session code' })).success,
    ).toBe(true);
  });

  it('accepts an error code it does not know (newer relay)', () => {
    expect(ErrorMessage.safeParse(error({ code: 'somethingNew', text: '' })).success).toBe(true);
  });

  it.each([{ code: '', text: 'x' }, { text: 'x' }, { code: 'badCode' }])('rejects %o', (body) => {
    expect(ErrorMessage.safeParse(error(body)).success).toBe(false);
  });
});

describe('version handshake', () => {
  const hello = (body: unknown) => ({
    ...envelope({ from: '', session: '' }),
    type: 'hello',
    body,
  });
  const welcome = (body: unknown) => ({ ...envelope({ re: ID_2 }), type: 'welcome', body });
  const reject = (body: unknown) => ({ ...envelope({ re: ID_2 }), type: 'reject', body });

  it('accepts hello from protocol.md §3.3', () => {
    const msg = hello({ protocols: [1], app: 'slate-host 0.1.0', features: [] });
    expect(Hello.safeParse(msg).success).toBe(true);
  });

  it.each([
    ['no protocols', { protocols: [], app: 'slate-host 0.1.0', features: [] }],
    ['protocol 0', { protocols: [0], app: 'slate-host 0.1.0', features: [] }],
    ['no app name', { protocols: [1], app: '', features: [] }],
    ['no features list', { protocols: [1], app: 'slate-host 0.1.0' }],
  ])('rejects hello with %s', (_why, body) => {
    expect(Hello.safeParse(hello(body)).success).toBe(false);
  });

  it('accepts welcome from protocol.md §3.4', () => {
    const msg = welcome({
      protocol: 1,
      relay: 'slate-relay 0.1.0',
      features: [],
      time: 1792156980200,
      heartbeatSec: 15,
    });
    expect(Welcome.safeParse(msg).success).toBe(true);
  });

  it('rejects welcome with a heartbeat of 0 s', () => {
    const msg = welcome({
      protocol: 1,
      relay: 'slate-relay 0.1.0',
      features: [],
      time: 0,
      heartbeatSec: 0,
    });
    expect(Welcome.safeParse(msg).success).toBe(false);
  });

  it('accepts reject from protocol.md §3.4', () => {
    expect(Reject.safeParse(reject({ reason: 'versionMismatch', supported: [2] })).success).toBe(
      true,
    );
  });

  it('rejects reject without supported versions', () => {
    expect(Reject.safeParse(reject({ reason: 'versionMismatch', supported: [] })).success).toBe(
      false,
    );
  });
});

describe('negotiateProtocol', () => {
  it('picks the only common version', () => {
    expect(negotiateProtocol([1], [1])).toBe(1);
  });

  it('picks the highest common version', () => {
    expect(negotiateProtocol([1, 2, 3], [2, 3, 4])).toBe(3);
  });

  it('returns null when there is no common version', () => {
    expect(negotiateProtocol([1], [2])).toBeNull();
  });

  it('returns null for an empty offer', () => {
    expect(negotiateProtocol([], [1])).toBeNull();
  });
});
