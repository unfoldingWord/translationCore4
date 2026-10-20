// #786, #812: the lines of a verse body in the editors. One verse often spans
// several lines of the file: poem lines (`\q1`/`\q2`/`\q3`, only the first
// carries the `\v`), paragraph and stanza breaks (`\p`, `\m`, `\b`, `\pi1`),
// `\ts\*` milestones and headings. They are part of the verse body
// (indexer.ts). The editors show:
// - a poem line with leading tabs: one for `\q1` (and a bare `\q`), two for
//   `\q2`, three for `\q3`, as the section editor shows poetry verse lines (#54);
// - a break as a blank line, as the section editor shows a `\p` between verses;
// - any other line as it is, a heading with its marker (`\s1 …`, `\qa …`).
// This module is the one place that turns a body into editor text and back,
// by the indexer's own line kinds (`lineKind`).
import { lineKind } from './indexer';

const TABS: Record<string, string> = { '': '\t', 1: '\t', 2: '\t\t', 3: '\t\t\t' };

/** The editor text of a verse body. Line ends become `\n`, what a textarea holds. */
export const bodyToEditorText = (body: string): string =>
  body
    .split(/\r?\n/)
    .map((line, i) => {
      if (i === 0) return line;
      const kind = lineKind(line);
      // lineKind reads the tag case-blind (`\Q2 …`): so does this, with one tab at worst.
      if (kind === 'poem') return (TABS[/^\\q(\d?)/i.exec(line)?.[1] ?? ''] ?? '\t') + line.slice(line.indexOf(' ') + 1);
      return kind === 'break' || kind === 'blank' ? '' : line;
    })
    .join('\n');

/** A line the index reads as verse text when it ends a body: a break or a
 * heading there is the next verse's paragraph (indexer.ts). */
const endsAVerse = (line: string): boolean => line.trim() !== '' && lineKind(line) !== 'break' && lineKind(line) !== 'heading';

/** The verse to write for an edited editor text: its `body`, and its `tail`.
 * `opened` is the body as it was when the editor opened: each blank line takes
 * back the break it had there, in order (`\ts\*`, `\m`, …), and a new blank
 * line is a `\p`. A line after the first that starts with one to three tabs
 * becomes a `\q1` to `\q3` line; a line with no tab stays as it is. `nl` is the
 * file's line end, so a CRLF file stays CRLF.
 *
 * The editor saves on every keystroke, and the next keystroke replaces the body
 * the index reads back. So the body is only what the index reads as the verse
 * (review of PR #810): no marker on a tab line with no text yet, no space
 * between the marker and the text, no tab and nothing blank before the first
 * line, and no break, heading or blank line after the last. A break or a
 * heading the translator left after the verse's last words is not lost: it is
 * the `tail`, which the caller writes right after the verse (splice.ts
 * `spliceVerseWithTail`), where the index leaves it outside the verse. */
export const editorTextToVerse = (text: string, nl: '\n' | '\r\n', opened = ''): { body: string; tail: string[] } => {
  const breaks = opened.split(/\r?\n/).slice(1).filter((l) => lineKind(l) === 'break' || lineKind(l) === 'blank');
  const lines = text.split('\n');
  while (lines.length > 1 && lines[0].trim() === '') lines.shift();
  lines[0] = lines[0].replace(/^\t+/, '');
  const left: string[] = [];
  while (lines.length > 1 && !endsAVerse(lines[lines.length - 1].replace(/^\t+/, ''))) left.unshift(lines.pop()!);
  let b = 0;
  const body = lines
    .map((line, i) => {
      if (i === 0) return line;
      const tabs = /^\t{1,3}/.exec(line)?.[0].length ?? 0;
      const rest = line.slice(tabs).replace(/^[ \t]+/, '');
      if (line.trim() === '') return breaks[b++] ?? '\\p';
      return tabs ? `\\q${tabs} ${rest}` : line;
    })
    .join(nl);
  // A blank line left last keeps a break it had; a new one is nothing.
  const tail = left.flatMap((line) => (line.trim() !== '' ? [line.replace(/^\t+/, '')] : b < breaks.length ? [breaks[b++]] : []));
  return { body, tail };
};

/** The body alone: for a write that replaces the lines after the verse too
 * (a span joined or broken, `spliceSection`), or where no tail can be left. */
export const editorTextToBody = (text: string, nl: '\n' | '\r\n', opened = ''): string => editorTextToVerse(text, nl, opened).body;
