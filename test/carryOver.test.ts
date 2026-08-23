// The resource is the primary key (tC3 precedent, set by the project owner
// 2026-08-04). The check list derived from the currently-pinned resource IS the
// work. A stored decision that cannot be placed on it is invalidated — kept,
// but no longer counted as done — so a finished book stops being finished when
// the resource behind it changes. These tests encode exactly that.
import { describe, expect, it } from 'vitest';
import { carryOverDecisions, describeCarryOver } from '../src/data/carryOver';
import { deriveTnItems, TN_HEADER } from '../src/data/derive';
import type { CheckItem } from '../src/data/derive';
import type { DecisionFile } from '../src/data/burritoStore';

const RESOURCE = { repoPath: 'git.door43.org/Es-419_gl/es-419_tn', version: 'v66' };
const NEXT = { repoPath: 'git.door43.org/unfoldingWord/en_tn', version: 'v89' };

/** A tN TSV. Each row: [ref, id, supportRef, quote, occurrence, note]. */
const tsv = (rows: string[][]): string =>
  [TN_HEADER, ...rows.map((r) => [r[0], r[1], '', r[2], r[3], r[4], r[5]].join('\t'))].join('\n');

const decided = (item: CheckItem): CheckItem => ({
  ...item,
  selections: [{ text: 'ho', occurrence: 1, occurrences: 1 }],
  comments: false,
  reminders: false,
  nothingToSelect: false,
  verseEdits: false,
  invalidated: false,
});

const file = (decisions: unknown[]): DecisionFile =>
  ({
    schemaVersion: 1,
    tool: 'translationNotes',
    book: 'TIT',
    resource: RESOURCE,
    decisions,
  }) as unknown as DecisionFile;

describe('the resource is the primary key', () => {
  const SPANISH = tsv([
    ['1:1', 'abc1', 'figs-metaphor', 'δοῦλος', '1', 'nota uno'],
    ['1:2', 'abc2', 'figs-abstractnouns', 'ἐλπίδι', '1', 'nota dos'],
  ]);
  const ENGLISH = tsv([
    // abc1 survives by identity; abc2 is gone; xyz9 is a check English asks
    // that Spanish never asked.
    ['1:1', 'abc1', 'figs-metaphor', 'δοῦλος', '1', 'note one'],
    ['1:3', 'xyz9', 'figs-activepassive', 'ἐφανέρωσεν', '1', 'note three'],
  ]);

  const spanishItems = deriveTnItems(SPANISH, 'tit');
  const englishItems = deriveTnItems(ENGLISH, 'tit');

  it('a decision the new resource still asks about carries over', () => {
    const r = carryOverDecisions(file([decided(spanishItems[0])]), englishItems, NEXT);
    expect(r.carried).toBe(1);
    expect(r.invalidated).toBe(0);
  });

  it('a decision the new resource does not ask about is INVALIDATED, not queued', () => {
    const r = carryOverDecisions(file([decided(spanishItems[1])]), englishItems, NEXT);
    expect(r.invalidated).toBe(1);
    expect(r.carried).toBe(0);
    const marked = r.file.decisions.find((d) => d.invalidated);
    expect(marked?.status).toBe('invalid');
  });

  it('nothing is deleted — an invalidated decision keeps its full §5.2 record', () => {
    const original = decided(spanishItems[1]);
    const r = carryOverDecisions(file([original]), englishItems, NEXT);
    const kept = r.file.decisions[0];
    expect(kept.contextId).toEqual(original.contextId);
    expect(kept.selections).toEqual(original.selections);
  });

  it('a FINISHED book is no longer finished: the new resource asks new questions', () => {
    // Every Spanish check was decided — the book was 100%.
    const r = carryOverDecisions(
      file(spanishItems.map(decided)),
      englishItems,
      NEXT,
    );
    expect(r.carried).toBe(1); // only abc1 survives
    expect(r.invalidated).toBe(1); // abc2 no longer exists
    expect(r.undecided).toBe(1); // xyz9 is work that now exists
  });

  it('the file is re-stamped to the resource it was reconciled against', () => {
    const r = carryOverDecisions(file([decided(spanishItems[0])]), englishItems, NEXT);
    expect(r.file.resource).toEqual(NEXT);
  });

  it('an empty file costs nothing and claims nothing', () => {
    const r = carryOverDecisions(file([]), englishItems, NEXT);
    expect(r.carried).toBe(0);
    expect(r.invalidated).toBe(0);
    expect(r.undecided).toBe(2);
  });
});

describe('D17 cross-language re-attach still applies before anything is invalidated', () => {
  // Same check, same verse, same original-language quote and occurrence — only
  // the resource's own check id and note language differ. That decision is
  // human work about the ORIGINAL text, so it carries.
  const ES = tsv([['1:1', 'es-0001', 'figs-metaphor', 'δοῦλος', '1', 'nota']]);
  const EN = tsv([['1:1', 'en-9999', 'figs-metaphor', 'δοῦλος', '1', 'note']]);

  it('carries the decision rather than invalidating it', () => {
    const r = carryOverDecisions(
      file([decided(deriveTnItems(ES, 'tit')[0])]),
      deriveTnItems(EN, 'tit'),
      NEXT,
    );
    expect(r.carried).toBe(1);
    expect(r.invalidated).toBe(0);
    expect(r.undecided).toBe(0);
  });

  it('and the carried decision is keyed to the NEW resource', () => {
    const r = carryOverDecisions(
      file([decided(deriveTnItems(ES, 'tit')[0])]),
      deriveTnItems(EN, 'tit'),
      NEXT,
    );
    expect(r.file.decisions[0].contextId.checkId).toBe('en-9999');
  });
});

describe('a book UNCOVERED by both rungs still enters the plan (official review round 6, R5)', () => {
  const ES = tsv([
    ['1:1', 'a1', 'figs-metaphor', 'δοῦλος', '1', 'nota'],
    ['1:2', 'a2', 'figs-abstractnouns', 'ἐλπίδι', '1', 'nota'],
  ]);

  it('an empty derived list invalidates-and-retains EVERYTHING and keeps the old record as provenance', () => {
    const source = file(deriveTnItems(ES, 'tit').map(decided));
    const r = carryOverDecisions(source, [], source.resource as never);
    expect(r.carried).toBe(0);
    expect(r.undecided).toBe(0);
    expect(r.invalidated).toBe(2);
    expect(r.file.decisions).toHaveLength(2); // retained, never deleted (D36)
    expect(r.file.decisions.every((d) => d.invalidated === true)).toBe(true);
    expect(r.file.resource).toEqual(source.resource); // provenance unchanged
  });
});

describe('what the user is told', () => {
  const ES = tsv([
    ['1:1', 'a1', 'figs-metaphor', 'δοῦλος', '1', 'nota'],
    ['1:2', 'a2', 'figs-abstractnouns', 'ἐλπίδι', '1', 'nota'],
  ]);
  const EN = tsv([['1:1', 'a1', 'figs-metaphor', 'δοῦλος', '1', 'note']]);

  it('states work that comes back, not a review queue', () => {
    const r = carryOverDecisions(
      file(deriveTnItems(ES, 'tit').map(decided)),
      deriveTnItems(EN, 'tit'),
      NEXT,
    );
    const line = describeCarryOver(r, 'Titus');
    expect(line).toContain('will need checking again');
    expect(line).not.toContain('review');
  });

  it('says so plainly when nothing is lost', () => {
    const r = carryOverDecisions(
      file([decided(deriveTnItems(EN, 'tit')[0])]),
      deriveTnItems(EN, 'tit'),
      NEXT,
    );
    expect(describeCarryOver(r, 'Titus')).toBe('Titus: every decision carried over.');
  });
});
