// SPDX-License-Identifier: GPL-3.0-or-later
// The SLATE block in Saved Games\<DCS>\Scripts\Export.lua (architecture.md
// §1.2): three marked lines at the end of the file that load SLATE's export
// script. Everything else in the file belongs to other tools and is never
// changed. These functions work on the file's text only; reading and writing
// is the installer's job.
//
// Text is handled as Latin-1 by the installer, so any byte in other tools'
// lines survives unchanged.

export const BLOCK_BEGIN = '-- SLATE BEGIN - managed by SLATE, do not edit';
export const BLOCK_END = '-- SLATE END';
/**
 * The line between the markers. Wrapped in pcall, so a missing SLATE file can
 * never break Export.lua or the tools after it (architecture.md §1.1).
 */
export const BLOCK_LOAD =
  "pcall(function() local lfs = require('lfs'); dofile(lfs.writedir() .. [[Scripts\\SLATE\\SLATE-export.lua]]) end)";

// Marker lines are matched loosely: the block from the manual install
// (dcs/export/README.md before P1.3) uses an en dash, read here as Latin-1.
const BEGIN_LINE = /^\s*--\s*SLATE BEGIN\b/;
const END_LINE = /^\s*--\s*SLATE END\b/;

/** How Export.lua stands with regard to the SLATE block. */
export type BlockState =
  /** Exactly one complete block with the expected load line. */
  | 'ok'
  /** No SLATE markers at all. */
  | 'missing'
  /** A BEGIN without END (or the other way round), several blocks, or a changed load line. */
  | 'broken';

interface Lines {
  lines: string[];
  eol: '\r\n' | '\n';
  /** The text ended with a line break. */
  trailingEol: boolean;
}

function split(text: string): Lines {
  const eol = text.includes('\r\n') ? '\r\n' : text.includes('\n') ? '\n' : '\r\n';
  const trailingEol = text.endsWith('\n');
  const body = trailingEol ? text.slice(0, text.endsWith('\r\n') ? -2 : -1) : text;
  return { lines: body === '' ? [] : body.split(/\r?\n/), eol, trailingEol };
}

function join({ lines, eol }: Lines): string {
  return lines.length === 0 ? '' : lines.join(eol) + eol;
}

/** Index ranges [begin, end] of every block, plus whether the markers pair up. */
function blocks(lines: readonly string[]): { ranges: [number, number][]; paired: boolean } {
  const ranges: [number, number][] = [];
  let open: number | null = null;
  let paired = true;
  for (const [i, line] of lines.entries()) {
    if (BEGIN_LINE.test(line)) {
      if (open !== null) paired = false;
      open = i;
    } else if (END_LINE.test(line)) {
      if (open === null) paired = false;
      else ranges.push([open, i]);
      open = null;
    }
  }
  if (open !== null) paired = false;
  return { ranges, paired };
}

export function blockState(text: string): BlockState {
  const { lines } = split(text);
  const { ranges, paired } = blocks(lines);
  const hasMarker = lines.some((l) => BEGIN_LINE.test(l) || END_LINE.test(l));
  if (!hasMarker) return 'missing';
  const range = ranges[0];
  if (!paired || ranges.length !== 1 || range === undefined) return 'broken';
  const [begin, end] = range;
  const inner = lines.slice(begin + 1, end).filter((l) => l.trim() !== '');
  return inner.length === 1 && inner[0]?.trim() === BLOCK_LOAD ? 'ok' : 'broken';
}

/**
 * Removes every SLATE block and stray marker line; other lines stay exactly as
 * they were. An unpaired BEGIN removes only its marker line – never lines
 * that might belong to another tool.
 */
export function removeBlock(text: string): string {
  const parsed = split(text);
  const { ranges } = blocks(parsed.lines);
  const drop = new Set<number>();
  for (const [begin, end] of ranges) for (let i = begin; i <= end; i += 1) drop.add(i);
  parsed.lines.forEach((line, i) => {
    if (BEGIN_LINE.test(line) || END_LINE.test(line)) drop.add(i);
  });
  // Also drop the blank line SLATE put in front of its block.
  for (const [begin] of ranges) {
    if (begin > 0 && parsed.lines[begin - 1]?.trim() === '' && !drop.has(begin - 1)) {
      drop.add(begin - 1);
    }
  }
  if (drop.size === 0) return text;
  const lines = parsed.lines.filter((_, i) => !drop.has(i));
  if (lines.length === 0) return '';
  return lines.join(parsed.eol) + (parsed.trailingEol ? parsed.eol : '');
}

/**
 * Exactly one SLATE block at the end of the file (after removing any old or
 * broken ones), in the file's own line endings; CRLF for a new file.
 */
export function withBlock(text: string): string {
  const cleaned = split(removeBlock(text));
  const lines = [...cleaned.lines];
  if (lines.length > 0) lines.push('');
  lines.push(BLOCK_BEGIN, BLOCK_LOAD, BLOCK_END);
  return join({ ...cleaned, lines });
}
