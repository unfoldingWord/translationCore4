#!/usr/bin/env node
// refresh-langnames.mjs — refresh the language list that New Bible and New Open Bible
// Stories suggest from (#492).
//
// The app ships a copy of Door43's language list (src/data/langnames.json) and never
// fetches it: the suggestions work offline. This script is the only reader of the Door43
// URL. Run it by hand, review the diff, and commit it like any change:
//
//   npm run langnames:refresh
//
// No build runs it (the #504 rule for the bundled resources: fixed copies, no lookup at
// build time). It keeps the five fields the app reads and writes one language per line,
// sorted by code, so a refresh shows as a small diff.
//
// exit 1, and the file is not touched, when Door43 does not answer with a list in which
// every row has a code, a name and a direction of `ltr` or `rtl`, every name is text and
// the alternate names are a list of text.
//
// .gitattributes marks the file `-diff`, so that its 9,000 lines do not fill the diff of
// a pull request. To read a refresh row by row: git diff --text src/data/langnames.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'src', 'data', 'langnames.json');
const SOURCE = 'https://git.door43.org/api/v1/languages/langnames.json';

const response = await fetch(SOURCE);
if (!response.ok) throw new Error(`${SOURCE} answered HTTP ${response.status}`);
const list = await response.json();
if (!Array.isArray(list) || list.length === 0) throw new Error(`${SOURCE} did not answer with a list`);

const rows = list.map((row) => {
  if (!row.lc || !row.ln || (row.ld !== 'ltr' && row.ld !== 'rtl')) {
    throw new Error(`a row has no code, no name or no direction: ${JSON.stringify(row)}`);
  }
  // The app reads the names as text, and the alternate names as a list of text.
  const names = [row.lc, row.ln, row.ang ?? '', ...(Array.isArray(row.alt) ? row.alt : [])];
  if ((row.alt != null && !Array.isArray(row.alt)) || names.some((name) => typeof name !== 'string')) {
    throw new Error(`a row has a name that is not text, or alternate names that are not a list: ${JSON.stringify(row)}`);
  }
  return { lc: row.lc, ang: row.ang || '', ln: row.ln, ld: row.ld, alt: row.alt || [] };
});
rows.sort((a, b) => (a.lc < b.lc ? -1 : a.lc > b.lc ? 1 : 0));

fs.writeFileSync(OUT, `[\n${rows.map((row) => JSON.stringify(row)).join(',\n')}\n]\n`);
console.log(`langnames: ${rows.length} languages written to ${path.relative(process.cwd(), OUT)}`);
