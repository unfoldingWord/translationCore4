// The two ABSENT states of a source pane (#164, D30: absence and error are
// distinct stated states, and the two absences are distinct too).
//
//   'not-installed' — the pinned source repository is not on this computer
//                     (or not at the pinned identity), so no book of it can be read.
//   'missing'       — the source IS installed, and it lacks the open book.
//
// A pane read that is CONFIRMED not-found (isNotFoundError) resolves to one of
// these by looking the pin up in the install resolver's cache; the platform
// itself answers both cases with the same not-found. Every view guards pane
// text through isSourceAbsent so the two strings never split the predicate.
export const SOURCE_MISSING = 'missing' as const;
export const SOURCE_NOT_INSTALLED = 'not-installed' as const;

export type SourceAbsence = typeof SOURCE_MISSING | typeof SOURCE_NOT_INSTALLED;

export const isSourceAbsent = (src: unknown): src is SourceAbsence =>
  src === SOURCE_MISSING || src === SOURCE_NOT_INSTALLED;
