// deriveForProject — derive, MAP into the project frame, scope-filter, merge
// (epic #33 / issue #15).
//
// The ordering is the thing under test. #15's acceptance requires that scope
// checks and the decision identity key operate on the MAPPED reference, and the
// §8.5 journal is append-only, so a reference must be mapped before anything
// stores or filters on it. These tests drive the real en_tn/en_twl fixtures.
import { describe, expect, it } from 'vitest';
import {
  deriveForProject,
  deriveTnItems,
  deriveTwlItems,
  isDecided,
  progressOf,
} from '../src/data/derive';
import { SCHEME_NAMES, type SchemeDoc, type SchemeName } from '../src/data/versification';

const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');
const read = (rel: string): string =>
  fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');

const VRS_DIR = path.resolve(process.cwd(), 'test/fixtures/vrs');
const schemes = Object.fromEntries(
  SCHEME_NAMES.map((n) => [
    n,
    JSON.parse(fs.readFileSync(path.join(VRS_DIR, `${n}.json`), 'utf8')) as SchemeDoc,
  ]),
) as Record<SchemeName, SchemeDoc>;

// Jonah is the discriminating book: eng JON 1 has 17 verses, every other scheme
// ends chapter 1 at 16. So an eng->non-eng project shifts every JON 1:17 and
// every JON 2:x reference.
const TN_JON = read('test/fixtures/resources/en_tn@v86/JON.tsv');
const TWL_TIT = read('test/fixtures/resources/en_twl@v86/TIT.tsv');

const refsOf = (items: { contextId: { reference: { chapter: unknown; verse: unknown } } }[]) =>
  items.map((i) => `${i.contextId.reference.chapter}:${i.contextId.reference.verse}`);

describe('same-frame projects are untouched', () => {
  it('an eng project derives exactly what the unmapped pipeline derives', async () => {
    const out = await deriveForProject({
      tsv: TN_JON,
      tool: 'translationNotes',
      bookId: 'jon',
      from: 'eng',
      to: 'eng',
      schemes,
    });
    expect(out.mapped).toBe(false);
    expect(out.unplaceable).toEqual([]);
    // Byte-for-byte the same items as the untouched sync path — the default
    // project must not change behaviour at all.
    expect(out.items).toEqual(deriveTnItems(TN_JON, 'jon'));
  });

  it('the tW path is equally untouched', async () => {
    const out = await deriveForProject({
      tsv: TWL_TIT,
      tool: 'translationWords',
      bookId: 'tit',
      from: 'eng',
      to: 'eng',
      schemes,
    });
    expect(out.mapped).toBe(false);
    expect(out.items).toEqual(deriveTwlItems(TWL_TIT, 'tit'));
  });
});

describe('cross-frame projects map before anything else happens', () => {
  it('shifts every Jonah reference into the rsc frame', async () => {
    const before = deriveTnItems(TN_JON, 'jon');
    const out = await deriveForProject({
      tsv: TN_JON,
      tool: 'translationNotes',
      bookId: 'jon',
      from: 'eng',
      to: 'rsc',
      schemes,
    });

    expect(out.mapped).toBe(true);
    // eng JON 1:17 does not exist in rsc; it becomes JON 2:1.
    expect(refsOf(before)).toContain('1:17');
    expect(refsOf(out.items)).not.toContain('1:17');

    const seventeen = before.filter((i) => `${i.contextId.reference.verse}` === '17');
    expect(seventeen.length).toBeGreaterThan(0);
    for (const item of seventeen) {
      const moved = out.items.find((i) => i.contextId.checkId === item.contextId.checkId);
      expect(moved?.contextId.reference).toMatchObject({ chapter: 2, verse: 1 });
    }
  });

  it('keeps bookId lowercase after mapping (§5.2 tC3 convention)', async () => {
    const out = await deriveForProject({
      tsv: TN_JON,
      tool: 'translationNotes',
      bookId: 'jon',
      from: 'eng',
      to: 'rsc',
      schemes,
    });
    expect(out.items.length).toBeGreaterThan(0);
    for (const item of out.items) expect(item.contextId.reference.bookId).toBe('jon');
  });

  it('preserves checkId, quote and occurrence — mapping touches only the reference', async () => {
    const before = deriveTnItems(TN_JON, 'jon');
    const out = await deriveForProject({
      tsv: TN_JON,
      tool: 'translationNotes',
      bookId: 'jon',
      from: 'eng',
      to: 'rsc',
      schemes,
    });
    for (const item of out.items) {
      const original = before.find((b) => b.contextId.checkId === item.contextId.checkId);
      expect(original).toBeDefined();
      expect(item.contextId.quoteString).toBe(original?.contextId.quoteString);
      expect(item.contextId.occurrence).toBe(original?.contextId.occurrence);
      expect(item.contextId.groupId).toBe(original?.contextId.groupId);
    }
  });

  it('the identity key is unique after mapping, because checkId is', async () => {
    // The measured "reference collisions" put two checks on one verse; they do
    // NOT collide the §5.2 identity key, because the TSV ID column is unique
    // per book. This asserts that directly rather than trusting the reasoning.
    const out = await deriveForProject({
      tsv: TN_JON,
      tool: 'translationNotes',
      bookId: 'jon',
      from: 'eng',
      to: 'vul',
      schemes,
    });
    const keys = out.items.map((i) =>
      [
        i.contextId.checkId,
        i.contextId.reference.bookId,
        String(i.contextId.reference.chapter),
        String(i.contextId.reference.verse),
        i.contextId.occurrence,
      ].join('|'),
    );
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('scope filtering runs on the MAPPED reference', () => {
  it('a scope range in project numbering keeps the mapped verse, not the source verse', async () => {
    // eng JON 1:17 maps to rsc JON 2:1. A project whose scope is chapter 2 must
    // therefore INCLUDE that check. If scope filtering ran before mapping, the
    // item would have been dropped as out-of-scope at 1:17.
    const out = await deriveForProject({
      tsv: TN_JON,
      tool: 'translationNotes',
      bookId: 'jon',
      from: 'eng',
      to: 'rsc',
      schemes,
      scopeRanges: ['2:1'],
    });
    expect(out.items.length).toBeGreaterThan(0);
    for (const item of out.items) {
      expect(String(item.contextId.reference.chapter)).toBe('2');
      expect(String(item.contextId.reference.verse)).toBe('1');
    }
    // And the source-frame 1:17 items are among what survived.
    const sourceSeventeen = deriveTnItems(TN_JON, 'jon').filter(
      (i) => `${i.contextId.reference.chapter}:${i.contextId.reference.verse}` === '1:17',
    );
    expect(sourceSeventeen.length).toBeGreaterThan(0);
    for (const item of sourceSeventeen) {
      expect(out.items.some((i) => i.contextId.checkId === item.contextId.checkId)).toBe(true);
    }
  });
});

describe('unplaceable items are dropped and reported, never journaled', () => {
  it('reports a reason per dropped item and drops it from the list', async () => {
    // The eng->vul map has the most out-of-scheme landings of the six (171 in
    // the 66-book canon), so Jonah exercises the reporting path.
    const out = await deriveForProject({
      tsv: TN_JON,
      tool: 'translationNotes',
      bookId: 'jon',
      from: 'eng',
      to: 'vul',
      schemes,
    });
    const derived = deriveTnItems(TN_JON, 'jon');
    expect(out.items.length + out.unplaceable.length).toBe(derived.length);
    for (const dropped of out.unplaceable) {
      expect(dropped.reason).toBeTruthy();
      expect(
        out.items.some((i) => i.contextId.checkId === dropped.item.contextId.checkId),
      ).toBe(false);
    }
  });

  it('an unresolved project frame drops everything with unknown-frame, rather than assuming eng', async () => {
    const out = await deriveForProject({
      tsv: TN_JON,
      tool: 'translationNotes',
      bookId: 'jon',
      from: 'eng',
      to: null,
      schemes,
    });
    expect(out.items).toEqual([]);
    expect(out.unplaceable.length).toBe(deriveTnItems(TN_JON, 'jon').length);
    expect(new Set(out.unplaceable.map((u) => u.reason))).toEqual(new Set(['unknown-frame']));
  });
});


describe('the progress metric still reaches 100% when checks are dropped', () => {
  // The concern this answers: does dropping unplaceable checks leave the meter
  // stuck at "99.8% checked"? No — a dropped check leaves the DENOMINATOR, it is
  // not counted as undecided. This is the same rule §4.2/D26 already applies to
  // scope filtering: the denominator is the derived in-scope total, never the
  // whole book. A verse the project's Bible does not contain is not work the
  // translator declined; it is work that does not exist.
  it('the denominator excludes dropped checks, so deciding everything shown gives 100%', async () => {
    const out = await deriveForProject({
      tsv: TN_JON,
      tool: 'translationNotes',
      bookId: 'jon',
      from: 'eng',
      to: 'vul',
      schemes,
    });
    // vul is the scheme that actually drops things.
    expect(out.unplaceable.length).toBeGreaterThan(0);

    const before = progressOf(out.items);
    expect(before.total).toBe(out.items.length);
    // The dropped ones are NOT in the denominator.
    expect(before.total).toBeLessThan(deriveTnItems(TN_JON, 'jon').length);

    // Decide every check that IS shown.
    const allDecided = out.items.map((it) => ({
      ...it,
      selections: [{ text: 'x', occurrence: 1, occurrences: 1 }],
    }));
    const after = progressOf(allDecided);
    expect(after.decided).toBe(after.total);
    expect(after.total).toBeGreaterThan(0);
    expect(allDecided.every(isDecided)).toBe(true);
    // 100%, not 99.x%.
    expect((after.decided / after.total) * 100).toBe(100);
  });

  it('an eng project drops nothing, so the denominator is the full derived list', async () => {
    const out = await deriveForProject({
      tsv: TN_JON,
      tool: 'translationNotes',
      bookId: 'jon',
      from: 'eng',
      to: 'eng',
      schemes,
    });
    expect(out.unplaceable).toEqual([]);
    expect(progressOf(out.items).total).toBe(deriveTnItems(TN_JON, 'jon').length);
  });
});
