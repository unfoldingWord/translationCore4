// #50 — the Check rail's Bookmarked and Commented chips count and filter by the
// same predicates, and neither a bookmark nor a check comment is a decision.
import { describe, expect, it } from 'vitest';
import { RAIL_FILTERS, RAIL_FILTER_ORDER, hasComment, isBookmarked, railCounts } from '../src/views/checkFilters.js';
import { isDecided, progressOf } from '../src/data/derive';
import type { CheckItem } from '../src/data/derive';

const item = (over: Partial<CheckItem>): CheckItem =>
  ({
    contextId: { checkId: 'x', occurrenceNote: '', reference: { bookId: 'tit', chapter: 1, verse: 1 }, tool: 'translationNotes', groupId: 'g', quote: [], quoteString: 'q', occurrence: 1 },
    category: 'other',
    selections: false,
    comments: false,
    reminders: false,
    nothingToSelect: false,
    verseEdits: false,
    invalidated: false,
    ...over,
  }) as CheckItem;

describe('#50 rail filters', () => {
  const items = [
    item({}), // plain todo
    item({ reminders: true }), // bookmarked, undecided
    item({ comments: 'ask the team' }), // commented, undecided
    item({ comments: 'done', reminders: true, selections: [{ text: 'Dios', occurrence: 1, occurrences: 1 }], status: 'valid' }), // both, decided
    item({ comments: '' }), // an empty string is not a comment
    item({ status: 'invalid' }),
  ];

  it('the chips are in mockup order and every chip has a predicate', () => {
    expect(RAIL_FILTER_ORDER).toEqual(['all', 'todo', 'invalid', 'bookmarked', 'commented']);
    for (const k of RAIL_FILTER_ORDER) expect(typeof RAIL_FILTERS[k as keyof typeof RAIL_FILTERS]).toBe('function');
  });

  it('counts match the predicates; an empty string is no comment; false is no bookmark', () => {
    expect(railCounts(items)).toEqual({ all: 6, todo: 4, invalid: 1, bookmarked: 2, commented: 2 });
    expect(items.filter(RAIL_FILTERS.commented).map((i) => i.comments)).toEqual(['ask the team', 'done']);
    expect(hasComment(item({ comments: '' }))).toBe(false);
    expect(isBookmarked(item({ reminders: 'yes' as never }))).toBe(false);
  });

  it('a bookmark or a comment on an undecided item is not a decision and does not move progress', () => {
    const before = progressOf([item({})]);
    expect(isDecided(item({ reminders: true }))).toBe(false);
    expect(isDecided(item({ comments: 'note to self' }))).toBe(false);
    expect(progressOf([item({ reminders: true, comments: 'x' })])).toEqual(before);
    // …and they do not undo a decision either.
    expect(isDecided(item({ nothingToSelect: true, status: 'valid', reminders: true, comments: 'x' }))).toBe(true);
  });
});
