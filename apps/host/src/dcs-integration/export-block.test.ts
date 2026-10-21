// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  BLOCK_BEGIN,
  BLOCK_END,
  BLOCK_LOAD,
  blockState,
  removeBlock,
  withBlock,
} from './export-block.js';

/** An Export.lua as other tools leave it (Tacview, SRS, the spike-3.2 line). */
const OTHERS = [
  "local Tacviewlfs=require('lfs');dofile(Tacviewlfs.writedir()..'Scripts/TacviewGameExport.lua')",
  "pcall(function() local dcsSr=require('lfs');dofile(dcsSr.writedir()..[[Mods\\Services\\DCS-SRS\\Scripts\\DCS-SRS-Export.lua]]); end,nil)",
  "local SLATElfs = require('lfs'); dofile(SLATElfs.writedir() .. [[Scripts\\SLATE\\SLATE-spike-export.lua]])",
];
const crlf = (lines: string[]) => lines.join('\r\n') + '\r\n';
const lf = (lines: string[]) => lines.join('\n') + '\n';

/** The block from the manual install (dcs/export/README.md), en dash read as Latin-1. */
const MANUAL_BLOCK = [
  '-- SLATE BEGIN â\u0080\u0093 managed by SLATE, do not edit',
  BLOCK_LOAD,
  '-- SLATE END',
];

describe('blockState', () => {
  it('is missing without markers, also for the spike line', () => {
    expect(blockState('')).toBe('missing');
    expect(blockState(crlf(OTHERS))).toBe('missing');
  });

  it('is ok for one complete block, including the manual one with the en dash', () => {
    expect(blockState(withBlock(crlf(OTHERS)))).toBe('ok');
    expect(blockState(crlf([...OTHERS, '', ...MANUAL_BLOCK]))).toBe('ok');
  });

  it.each([
    ['a BEGIN without END', [...OTHERS, BLOCK_BEGIN, BLOCK_LOAD]],
    ['an END without BEGIN', [...OTHERS, BLOCK_LOAD, BLOCK_END]],
    [
      'two blocks',
      [BLOCK_BEGIN, BLOCK_LOAD, BLOCK_END, ...OTHERS, BLOCK_BEGIN, BLOCK_LOAD, BLOCK_END],
    ],
    ['a changed load line', [...OTHERS, BLOCK_BEGIN, "dofile('somewhere else')", BLOCK_END]],
    ['an empty block', [...OTHERS, BLOCK_BEGIN, BLOCK_END]],
  ])('is broken with %s', (_name, lines) => {
    expect(blockState(crlf(lines))).toBe('broken');
  });
});

describe('withBlock', () => {
  it('appends the block after the other tools, keeping their lines and CRLF', () => {
    expect(withBlock(crlf(OTHERS))).toBe(crlf([...OTHERS, '', BLOCK_BEGIN, BLOCK_LOAD, BLOCK_END]));
  });

  it('keeps LF files LF', () => {
    expect(withBlock(lf(OTHERS))).toBe(lf([...OTHERS, '', BLOCK_BEGIN, BLOCK_LOAD, BLOCK_END]));
  });

  it('writes a new file with CRLF', () => {
    expect(withBlock('')).toBe(crlf([BLOCK_BEGIN, BLOCK_LOAD, BLOCK_END]));
  });

  it('handles a file without a final line break', () => {
    expect(withBlock(OTHERS.join('\r\n'))).toBe(
      crlf([...OTHERS, '', BLOCK_BEGIN, BLOCK_LOAD, BLOCK_END]),
    );
  });

  it('is idempotent: installing twice gives one block', () => {
    const once = withBlock(crlf(OTHERS));
    expect(withBlock(once)).toBe(once);
  });

  it('replaces the manual block and repairs a broken one, at the end of the file', () => {
    const manual = crlf(['-- first tool', ...MANUAL_BLOCK, '-- tool added later']);
    expect(withBlock(manual)).toBe(
      crlf(['-- first tool', '-- tool added later', '', BLOCK_BEGIN, BLOCK_LOAD, BLOCK_END]),
    );
    const broken = crlf([...OTHERS, BLOCK_BEGIN, BLOCK_LOAD]);
    expect(blockState(withBlock(broken))).toBe('ok');
  });

  it('keeps every byte of other tools’ lines (Latin-1, tabs, trailing spaces)', () => {
    const odd = crlf(['-- café ÿ\t', "dofile('x')   ", '']);
    expect(withBlock(odd).startsWith("-- café ÿ\t\r\ndofile('x')   \r\n")).toBe(true);
  });
});

describe('removeBlock', () => {
  it('takes out only the block (and the blank line before it)', () => {
    expect(removeBlock(withBlock(crlf(OTHERS)))).toBe(crlf(OTHERS));
  });

  it('removes the manual block too', () => {
    expect(removeBlock(crlf([...OTHERS, '', ...MANUAL_BLOCK]))).toBe(crlf(OTHERS));
  });

  it('leaves a file without a block exactly as it was', () => {
    const text = OTHERS.join('\n');
    expect(removeBlock(text)).toBe(text);
  });

  it('removes only the marker of an unpaired BEGIN, never the lines after it', () => {
    expect(removeBlock(crlf([BLOCK_BEGIN, ...OTHERS]))).toBe(crlf(OTHERS));
  });

  it('gives an empty file when the block was all there was', () => {
    expect(removeBlock(withBlock(''))).toBe('');
  });
});
