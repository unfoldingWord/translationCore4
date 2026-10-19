// #786: the inner poem lines of a verse. In a poetry book one verse often spans
// several lines, one `\q1`/`\q2` line per line of the poem, and only the first
// carries the `\v`. Those lines are part of the verse body (indexer.ts). The
// editors show them as the section editor shows poetry verse lines since #54:
// one leading tab for `\q1` (and a bare `\q`), two for `\q2`. This module is
// the one place that turns a body into editor text and back.

/** A line-start `\q`, `\q1` or `\q2` with text after its space continues the
 * open verse. `\q3` does not: the editors show two levels only. */
export const isInnerPoemLine = (line: string): boolean => /^\\q[12]? \S/.test(line);

/** The editor text of a verse body: each inner `\q1`/`\q2` marker becomes one
 * or two leading tabs, and line ends become `\n` (what a textarea holds). */
export const bodyToEditorText = (body: string): string =>
  body.replace(/\r?\n\\q([12]?) (?=\S)/g, (_, level: string) => (level === '2' ? '\n\t\t' : '\n\t')).replace(/\r\n/g, '\n');

/** The body to write for an edited verse: a line after the first that starts
 * with one tab becomes a `\q1` line, with two a `\q2` line. A line with no tab
 * is a line break only. `nl` is the file's line end, so a CRLF file stays CRLF.
 *
 * The editor saves on every keystroke, and the next keystroke replaces the body
 * the index reads back. So this writes only what the index reads as the verse
 * (review of PR #810): no marker on a tab line with no text yet, no space
 * between the marker and the text (`isInnerPoemLine`), and no blank line at
 * either end of the body, which the index leaves outside. */
export const editorTextToBody = (text: string, nl: '\n' | '\r\n'): string => {
  const lines = text.split('\n');
  while (lines.length > 1 && lines[0].trim() === '') lines.shift();
  while (lines.length > 1 && lines[lines.length - 1].trim() === '') lines.pop();
  return lines
    .map((line, i) => {
      const tabs = i === 0 ? 0 : /^\t\t?/.exec(line)?.[0].length ?? 0;
      if (!tabs) return line;
      const text = line.slice(tabs).replace(/^[ \t]+/, '');
      return text ? `\\q${tabs} ${text}` : '';
    })
    .join(nl);
};
