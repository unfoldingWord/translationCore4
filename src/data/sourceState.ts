// The two ABSENT states of a source pane (#164, D30: absence and error are
// distinct stated states, and the two absences are distinct too).
//
//   'not-installed' — the pinned source repository is not on this computer
//                     (or not at the pinned identity), so no book of it can be read.
//   'missing'       — the source IS installed, and it lacks the open book.
//
// A pane read that is CONFIRMED not-found (isNotFoundError) resolves to one of
// these by looking the pin up in the install resolver's cache. The platform
// cannot tell the two apart for us: the ingredient read is ONE
// `std::fs::read_to_string(<repo_dir>/<repo_path>/ingredients/<ipath>)`, and any
// error of that read — no such repository, no such book — returns the same
// HTTP 400 "could not read ingredient content: …" [VERIFIED — pankosmia-web
// 0.18.5 (99fd9be, 2026-07-30), src/endpoints/burrito2/raw_text_ingredient.rs:26-56
// (raw_bytes_ingredient.rs:55 is the same shape); rig probe 2026-09-04: a missing
// repository and a missing book under en_ult both answered 400 with reason
// "could not read ingredient content: No such file or directory (os error 2)"].
//
// Every view guards pane text through isSourceAbsent, and picks the sentence
// through absenceMessageKey, so the two absences never split their meaning
// across views.
export const SOURCE_MISSING = 'missing' as const;
export const SOURCE_NOT_INSTALLED = 'not-installed' as const;

export type SourceAbsence = typeof SOURCE_MISSING | typeof SOURCE_NOT_INSTALLED;

export const isSourceAbsent = (src: unknown): src is SourceAbsence =>
  src === SOURCE_MISSING || src === SOURCE_NOT_INSTALLED;

/** The ONE catalog key for each absence (i18n `source.*`). Views call this
 * instead of choosing keys themselves. */
export const absenceMessageKey = (src: SourceAbsence): 'source.notInstalled' | 'source.unavailable' =>
  src === SOURCE_NOT_INSTALLED ? 'source.notInstalled' : 'source.unavailable';
