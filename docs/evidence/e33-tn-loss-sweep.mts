// e33-tn-loss-sweep.mts — evidence for epic #33, issue #15: the "Known losses"
// numbers in BURRITO-SPEC §5.2.
//
// Measures, per target scheme, how many en_tn@v90 rows the derive pipeline
// would DROP as unplaceable when the project's frame is that scheme. It calls
// the client's own `mapReference` — the code that makes the decision at derive
// time — not a reimplementation, so the numbers cannot drift from the product.
//
// Method:
//   * Rows come from every `tn_*.tsv` of git.door43.org/unfoldingWord/en_tn at
//     commit e137f93c4de4d64281e36c84d57a68e405cb20ab (what tag v90 named on
//     2026-08-25; the COMMIT is pinned because upstream tags are not enforced —
//     the D58 rationale).
//   * A row is VERSE-SHAPED when its Reference parses as integer chapter and
//     integer-or-span verse ("1:2", "1:2-3"). Non-verse rows (`front:intro`,
//     "1:intro") are the D60 drop — every non-eng scheme drops them identically,
//     so they are reported once, apart, and excluded from the loss counts.
//   * A verse-shaped row counts as a LOSS for scheme X when
//     `mapReference({from:'eng', to:X})` returns ok:false.
//   * Schemes are the committed `test/fixtures/vrs/*.json` (byte-identical to
//     the platform templates — see that directory's README).
//
// Run (from the repo root; the pinned tsx resolves the TypeScript imports):
//   npx -y tsx@4.23.12 docs/evidence/e33-tn-loss-sweep.mts
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mapReference } from '../../src/data/mapReference';
import type { SchemeDoc, SchemeName } from '../../src/data/versification';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VRS = path.join(HERE, '../../test/fixtures/vrs');
const REPO = 'https://git.door43.org/api/v1/repos/unfoldingWord/en_tn';
// The exact commit tag v90 named when the sweep was recorded (2026-08-25).
// Pinned by sha, not tag: upstream tags are mutable and unenforced (D58).
const REF = 'e137f93c4de4d64281e36c84d57a68e405cb20ab';

const schemes: Partial<Record<SchemeName, SchemeDoc>> = {};
for (const name of ['eng', 'org', 'lxx', 'rsc', 'rso', 'vul'] as const) {
  schemes[name] = JSON.parse(fs.readFileSync(path.join(VRS, `${name}.json`), 'utf8'));
}

const listing = (await (await fetch(`${REPO}/contents?ref=${REF}`)).json()) as Array<{
  name: string;
  download_url: string;
}>;
const books = listing.filter((f) => /^tn_[A-Z0-9]{3}\.tsv$/.test(f.name));
console.log(`en_tn@${REF}: ${books.length} book TSVs`);

interface Row {
  book: string;
  chapter: number;
  verse: number | string;
}
const rows: Row[] = [];
let total = 0;
let nonVerse = 0;
for (const f of books) {
  const book = f.name.slice(3, 6);
  const tsv = await (await fetch(f.download_url)).text();
  for (const line of tsv.split('\n').slice(1)) {
    if (line.trim() === '') continue;
    total += 1;
    const ref = line.split('\t')[0];
    const m = /^(\d+):(\d+(?:-\d+)?)$/.exec(ref);
    if (!m) {
      nonVerse += 1; // front:intro / 1:intro — the D60 drop, scheme-independent
      continue;
    }
    const verse = /^\d+$/.test(m[2]) ? Number(m[2]) : m[2];
    rows.push({ book, chapter: Number(m[1]), verse });
  }
}
console.log(`${total} rows total; ${nonVerse} non-verse (front/intro, D60); ` +
  `${rows.length} verse-shaped rows swept per scheme\n`);

for (const to of ['eng', 'rsc', 'rso', 'lxx', 'vul'] as const) {
  const byRef = new Map<string, number>();
  let losses = 0;
  for (const row of rows) {
    const out = await mapReference({ from: 'eng', to, ...row, schemes });
    if (out.ok) continue;
    losses += 1;
    const key = `${row.book} ${row.chapter}:${row.verse} (${out.reason})`;
    byRef.set(key, (byRef.get(key) ?? 0) + 1);
  }
  console.log(`${to}: loses ${losses} of ${rows.length} rows across ${byRef.size} distinct references`);
  for (const [key, n] of [...byRef.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    console.log(`    ${key} × ${n}`);
  }
}
