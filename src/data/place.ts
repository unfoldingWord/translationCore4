// Where the user last worked in one book or one story (#329): the mode, the
// chapter or story, the verse or frame, and the Check tool. A Home tile returns
// there. Per client, in the same settings document as `lastEdit` (user-machine
// state, never the project). One record per (project, unit); `lastEdit` stays the
// one Resume pointer.

export interface PlaceRecord {
  /** 'read' | 'draft' | 'check' ('publish', the Community Checking tool, records as 'check'). */
  mode: 'read' | 'draft' | 'check';
  /** The chapter (Bible) or the story number (OBS). */
  chapter: number | string;
  /** The verse (Bible) or the frame (OBS, 0 the title); null when none is known. */
  verse: number | string | null;
  /** The Check tool open, when mode is 'check'. */
  tool?: string;
  at: number;
}

export type PlacesByProject = Record<string, Record<string, PlaceRecord>>;

/** The unit key: a book code, or `story:N` for a story. One grammar, so a
 * currentScope book code can never be read as a story (the #289 rule). */
export const placeKey = (unit: { book?: string | null; story?: number | null }): string | null => {
  if (Number.isInteger(unit.story) && (unit.story as number) >= 1) return `story:${unit.story}`;
  if (unit.book) return unit.book;
  return null;
};

/** The view as a recorded mode: Community Checking lives in Check (D63). */
export const modeOf = (view: string | null | undefined): PlaceRecord['mode'] | null => {
  if (view === 'read' || view === 'draft' || view === 'check') return view;
  if (view === 'publish') return 'check';
  return null;
};

/** The places after one observation. Fields the observation does not carry keep
 * the stored value (a mode switch keeps the verse; a frame click keeps the mode). */
export const recordPlace = (
  places: PlacesByProject | undefined,
  repoPath: string,
  key: string,
  next: Partial<PlaceRecord> & { at: number },
): PlacesByProject => {
  const forProject = places?.[repoPath] ?? {};
  const prior = forProject[key];
  const record: PlaceRecord = {
    mode: next.mode ?? prior?.mode ?? 'draft',
    chapter: next.chapter ?? prior?.chapter ?? 1,
    verse: next.verse !== undefined ? next.verse : prior?.verse ?? null,
    at: next.at,
  };
  const tool = record.mode === 'check' ? next.tool ?? prior?.tool : undefined;
  if (tool) record.tool = tool;
  return { ...(places ?? {}), [repoPath]: { ...forProject, [key]: record } };
};
