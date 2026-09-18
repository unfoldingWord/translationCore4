// The stories a translator edited most recently in one OBS project (#328): the
// collapsed Home card shows them, newest first. Per client (the same settings
// document as `lastEdit`), never the project: recency is where THIS person
// worked, not a property of the translation.

export interface RecentStory {
  story: number;
  /** Epoch milliseconds of the last edit. */
  at: number;
}

/** How many stories the collapsed card shows, and how many the list keeps. */
export const RECENT_STORIES = 3;

/** The list after an edit in `story` at `at`: that story moves to the front;
 * the list keeps the newest RECENT_STORIES entries, so a fourth distinct
 * story pushes the oldest out. A story number that is not a positive integer
 * leaves the list unchanged. */
export const recordRecentStory = (list: readonly RecentStory[] | undefined, story: number, at: number): RecentStory[] => {
  if (!Number.isInteger(story) || story < 1) return [...(list ?? [])];
  const rest = (list ?? []).filter((entry) => entry.story !== story);
  return [{ story, at }, ...rest].sort((a, b) => b.at - a.at).slice(0, RECENT_STORIES);
};
