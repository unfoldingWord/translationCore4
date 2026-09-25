// #50 — the Check rail's Bookmarked and Commented chips count and filter by the
// same predicates, and neither a bookmark nor a check comment is a decision.
import { describe, expect, it } from 'vitest';
import { RAIL_FILTERS, hasComment, isBookmarked, railCounts } from '../src/views/checkFilters.js';
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

  it('counts match the predicates; an empty string is no comment; false is no bookmark', () => {
    expect(railCounts(items)).toEqual({ all: 6, todo: 4, invalid: 1, bookmarked: 2, commented: 2 });
    expect(items.filter(RAIL_FILTERS.commented).map((i) => i.comments)).toEqual(['ask the team', 'done']);
    expect(hasComment(item({ comments: '' }))).toBe(false);
    expect(isBookmarked(item({ reminders: 'yes' as never }))).toBe(false);
  });
});
