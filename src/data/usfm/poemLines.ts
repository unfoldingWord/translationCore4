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
      if (kind === 'poem') return TABS[/^\\q(\d?)/.exec(line)![1]] + line.slice(line.indexOf(' ') + 1);
      return kind === 'break' || kind === 'blank' ? '' : line;
    })
    .join('\n');

/** A line the index reads as verse text when it ends a body: a break or a
 * heading there is the next verse's paragraph (indexer.ts). */
const endsAVerse = (line: string): boolean => line.trim() !== '' && lineKind(line) !== 'break' && lineKind(line) !== 'heading';

/** The body to write for an edited verse. `opened` is the body as it was when
 * the editor opened: each blank line takes back the break it had there, in
 * order (`\ts\*`, `\m`, …), and a new blank line is a `\p`. A line after the
 * first that starts with one to three tabs becomes a `\q1` to `\q3` line; a
 * line with no tab stays as it is. `nl` is the file's line end, so a CRLF file
 * stays CRLF.
 *
 * The editor saves on every keystroke, and the next keystroke replaces the body
 * the index reads back. So this writes only what the index reads as the verse
 * (review of PR #810): no marker on a tab line with no text yet, no space
 * between the marker and the text, nothing blank before the first line, and
 * no break, heading or blank line after the last, which the index leaves
 * outside. */
export const editorTextToBody = (text: string, nl: '\n' | '\r\n', opened = ''): string => {
  const breaks = opened.split(/\r?\n/).slice(1).filter((l) => lineKind(l) === 'break' || lineKind(l) === 'blank');
  const lines = text.split('\n');
  while (lines.length > 1 && lines[0].trim() === '') lines.shift();
  while (lines.length > 1 && !endsAVerse(lines[lines.length - 1].replace(/^\t+/, ''))) lines.pop();
  let b = 0;
  return lines
    .map((line, i) => {
      if (i === 0) return line;
      const tabs = /^\t{1,3}/.exec(line)?.[0].length ?? 0;
      const rest = line.slice(tabs).replace(/^[ \t]+/, '');
      if (line.trim() === '') return breaks[b++] ?? '\\p';
      return tabs ? `\\q${tabs} ${rest}` : line;
    })
    .join(nl);
};
