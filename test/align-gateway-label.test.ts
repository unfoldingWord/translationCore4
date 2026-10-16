// #768 — the gateway lens's card label after an alignment is saved.
//
// A saved alignment passes through the journal seal, which writes every content
// string in NFC (I-4). The Hebrew of hbo_uhb is not NFC, so the seal changes
// some `topWords[].word` values. The ULT's `x-content` keeps the resource's
// form. The card label (`gwLabelFor`) must still find the ULT words for every
// card. Inputs are the pinned resources' own Genesis 1:1 (test/fixtures/README.md).
//
// The ways this can fail, written before the fix:
//   1. A word the seal changed no longer matches its `x-content`: the label is
//      empty and the card falls back to the Hebrew (the reported defect).
//   2. A looser match finds ULT words of another card: a label gains words.
//   3. A card whose Hebrew is already NFC gets a different label than before.
//   4. The test misses the window: the seal changes no word, so 1 cannot show.
import { describe, expect, it } from 'vitest';
import { usfmjs } from '../src/data/vendor';
import { bootstrapVerse } from '../src/data/align/edit';
import { normalizeEvent } from '../src/data/journal/runtime';
import { tokenizeVerse } from '../src/data/sourceHighlight';
import { gwLabelFor } from '../src/views/Align.jsx';

// Real node builtins via the runtime (see align-tokenize.test.ts).
const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');
const read = (rel: string) => fs.readFileSync(path.resolve(process.cwd(), 'test/fixtures', rel), 'utf8');

type Verse = { verseObjects: Array<Record<string, unknown>> };
const gen11 = (rel: string): Verse =>
  (usfmjs.toJSON(read(rel)) as unknown as { chapters: Record<string, Record<string, Verse>> }).chapters['1']['1'];

const uhb = gen11('hbo_uhb/GEN-1-1.usfm');
const ultTokens = tokenizeVerse(gen11('en_ult/GEN-1-1.usfm') as never);
// The ULT's own verse text is the draft: the bootstrap needs target words, and
// the label reads only the original-language side.
const draft = ultTokens.map((t) => t.text).join('').replace(/\s+/g, ' ').trim();
const record = bootstrapVerse(draft, uhb.verseObjects, 'dcs::unfoldingWord/hbo_uhb@v3.0.0');

// The event shape journalingStore.alignmentEvents publishes, sealed as the journal seals it.
const sealed = normalizeEvent({
  v: 1, op: 'align.verse.set', actor: 'test-actor', ts: '', base: null, generation: '',
  book: 'GEN', chapter: '1', verse: '1', ...record,
} as never) as unknown as typeof record;

const labels = (r: typeof record) => r.alignments.map((a) => gwLabelFor(a.topWords, ultTokens));

describe('#768 gateway card label survives the journal seal (Genesis 1:1)', () => {
  it('the seal changes the non-NFC Hebrew words (failure mode 4)', () => {
    const changed = record.alignments
      .map((a, i) => (a.topWords[0].word !== sealed.alignments[i].topWords[0].word ? a.topWords[0].word : null))
      .filter((w): w is string => w !== null);
    expect(changed.every((w) => w !== w.normalize('NFC'))).toBe(true);
    // The literals here are NFC: compare in that form.
    expect(changed.map((w) => w.normalize('NFC'))).toEqual(['בְּ⁠רֵאשִׁ֖ית', 'בָּרָ֣א', 'הַ⁠שָּׁמַ֖יִם']);
  });

  it('every card shows its ULT words before the save (failure modes 2 and 3)', () => {
    expect(labels(record)).toEqual([
      'In the beginning', 'created', 'God', 'the heavens', 'the heavens', 'and', 'the earth',
    ]);
  });

  it('every card shows the same ULT words after the save (failure mode 1)', () => {
    expect(labels(sealed)).toEqual(labels(record));
  });
});
