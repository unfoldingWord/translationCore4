// checkFilters.js — the Check rail's filter chips (#50, D72 point 4).
//
// One predicate per chip, one place: the counts on the chips and the rows the
// list shows come from the same functions, so they can never disagree. A
// bookmark is the §5.2 `reminders` flag; a check comment is a non-empty
// `comments` string. Neither touches `isDecided`, so neither moves progress.
import { isDecided } from '../data/derive';

/** True when the item carries a check comment (the stored field is `false` otherwise). */
export const hasComment = (it) => typeof it.comments === 'string' && it.comments.length > 0;

/** True when the item is bookmarked (the stored field name is `reminders`). */
export const isBookmarked = (it) => it.reminders === true;

export const RAIL_FILTERS = {
  all: () => true,
  todo: (it) => !isDecided(it),
  invalid: (it) => it.status === 'invalid',
  bookmarked: isBookmarked,
  commented: hasComment,
};

export const RAIL_FILTER_ORDER = ['all', 'todo', 'invalid', 'bookmarked', 'commented'];

/** Chip counts over the session's items, in chip order. */
export const railCounts = (items) =>
  Object.fromEntries(RAIL_FILTER_ORDER.map((k) => [k, items.filter(RAIL_FILTERS[k]).length]));
