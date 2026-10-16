// #754 — an Align card keeps its target words in verse order automatically,
// as tC3 did (renderedAlignment.js:40-46 on every drop, alignment.js:38-46 on
// load). Birch's ruling replaces the before/after drop preview of #753.
import { describe, expect, it } from 'vitest';
import { bootstrapVerse, cardsInVerseOrder, linkWord } from '../src/data/align/edit';
import { wordTokens } from '../src/data/align/tokenize';
import { weaveBook } from '../src/data/export/weave.mjs';
import { AlignmentHelpers } from '../src/data/vendor';
import { __buildAlignmentSessionForTests as buildAlignmentSession } from '../src/state.jsx';
import type { AlignedWord, AlignmentFile, AlignmentVerseRecord } from '../src/data/align/zaln';

const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');

const ORIG = [
  { tag: 'w', type: 'word', text: 'πίστιν', strong: 'G41020', lemma: 'πίστις', morph: 'Gr,N', occurrence: 1, occurrences: 1 },
  { tag: 'w', type: 'word', text: 'ἐκλεκτῶν', strong: 'G15880', lemma: 'ἐκλεκτός', morph: 'Gr,N', occurrence: 1, occurrences: 1 },
];
const TEXT = 'según la fe de los escogidos y la verdad';
const SOURCE = 'dcs::unfoldingWord/el-x-koine_ugnt@v0.34';
const key = (w: { word?: string; text?: string; occurrence: unknown }) => `${w.word ?? w.text}/${Number(w.occurrence)}`;
const bank = (r: AlignmentVerseRecord, word: string, occ = 1) =>
  r.wordBank.find((w) => w.word === word && Number(w.occurrence) === occ) as AlignedWord;
const card = (r: AlignmentVerseRecord, i: number) => r.alignments[i].bottomWords.map(key);

describe('#754 cardsInVerseOrder', () => {
  it('"la fe de los" dropped as fe, la, los reads la, fe, los', () => {
    let r = bootstrapVerse(TEXT, ORIG, SOURCE);
    for (const w of ['fe', 'la', 'los']) r = linkWord(r, 0, bank(r, w));
    expect(card(r, 0)).toEqual(['fe/1', 'la/1', 'los/1']); // drop order, before the sort
    expect(card(cardsInVerseOrder(r, TEXT), 0)).toEqual(['la/1', 'fe/1', 'los/1']);
  });

  it('repeated words go by occurrence: la¹ before la²', () => {
    let r = bootstrapVerse(TEXT, ORIG, SOURCE);
    r = linkWord(r, 1, bank(r, 'la', 2));
    r = linkWord(r, 1, bank(r, 'la', 1));
    expect(card(cardsInVerseOrder(r, TEXT), 1)).toEqual(['la/1', 'la/2']);
  });

  it('touches only the target words, and every card', () => {
    let r = bootstrapVerse(TEXT, ORIG, SOURCE);
    r = linkWord(linkWord(r, 0, bank(r, 'los')), 0, bank(r, 'según'));
    r = linkWord(linkWord(r, 1, bank(r, 'verdad')), 1, bank(r, 'y'));
    const sorted = cardsInVerseOrder(r, TEXT);
    expect(card(sorted, 0)).toEqual(['según/1', 'los/1']);
    expect(card(sorted, 1)).toEqual(['y/1', 'verdad/1']);
    expect(sorted.alignments.map((a) => a.topWords)).toEqual(r.alignments.map((a) => a.topWords));
    expect(sorted.wordBank).toEqual(r.wordBank);
  });

  it('a word the text no longer has goes last in its card', () => {
    let r = bootstrapVerse(TEXT, ORIG, SOURCE);
    r = linkWord(linkWord(r, 0, bank(r, 'fe')), 0, bank(r, 'según'));
    const edited = TEXT.replace('según', 'conforme a');
    expect(card(cardsInVerseOrder(r, edited), 0)).toEqual(['fe/1', 'según/1']);
    expect(wordTokens(edited).map(key)).not.toContain('según/1');
  });
});

describe('#754 load — a stored out-of-order card shows in verse order, the file is not rewritten', () => {
  it('the session record is sorted; the store sees no write', async () => {
    let r = bootstrapVerse(TEXT, ORIG, SOURCE);
    for (const w of ['los', 'fe', 'la']) r = linkWord(r, 0, bank(r, w));
    const file = { schemaVersion: 1, book: 'TIT', chapters: { '1': { '1': r } } };
    const stored = JSON.stringify(file);
    let writes = 0;
    const store = {
      readAlignmentsWithMd5: async () => ({ value: JSON.parse(stored), md5: 'm1' }),
      writeAlignments: async () => { writes++; },
    };
    const st = { book: 'TIT', bookRaw: `\\id TIT\n\\c 1\n\\p\n\\v 1 ${TEXT}\n`, project: { scriptDirection: 'ltr' } };
    const source = { testament: 'nt', pin: { repoPath: 'unfoldingWord/el-x-koine_ugnt', version: 'v0.34' }, usfmText: '' };
    const session = await buildAlignmentSession(store, null, st, '1:1', source, ORIG);
    expect(card(session.record, 0)).toEqual(['la/1', 'fe/1', 'los/1']);
    expect(writes).toBe(0);
  });
});

describe('#754 export — the card order does not change the aligned USFM', () => {
  it('weaving a card in drop order or in verse order gives the same bytes', () => {
    const sample = path.resolve(__dirname, '../conformance/sample-burrito/ingredients');
    const usfm = fs.readFileSync(path.join(sample, 'TIT.usfm'), 'utf8');
    const file: AlignmentFile = JSON.parse(fs.readFileSync(path.join(sample, 'checking/alignments/TIT.json'), 'utf8'));
    const rec = file.chapters['1']['1'];
    // Put "de" (1st) on the Παῦλος card next to "Pablo": two words in one card.
    const de = rec.wordBank.find((w) => w.word === 'de' && Number(w.occurrence) === 1)!;
    const withCard = (bottom: AlignedWord[]): AlignmentFile => ({
      ...file,
      chapters: { ...file.chapters, '1': { ...file.chapters['1'], '1': {
        ...rec,
        alignments: rec.alignments.map((a, i) => (i === 0 ? { ...a, bottomWords: bottom } : a)),
        wordBank: rec.wordBank.filter((w) => w !== de),
      } } },
    });
    const pablo = rec.alignments[0].bottomWords;
    const inOrder = weaveBook(usfm, withCard([...pablo, de]), AlignmentHelpers);
    const reversed = weaveBook(usfm, withCard([de, ...pablo]), AlignmentHelpers);
    expect(reversed).toBe(inOrder);
    expect(inOrder).toContain('\\zaln-s');
  });
});
