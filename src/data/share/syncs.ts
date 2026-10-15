// #678: which projects sync with Door43 (D98 round 1). The one rule: the Home
// card reads it for its button, and the share actions read it before a push.
// After its first share, a project that syncs never runs the share push: a
// sync keeps the live project's history different from Door43 `main`
// (owner ruling 2026-10-14), so that push would not be a fast-forward.

/** A shared project syncs, except an OBS project (round 1 syncs Bible projects only). */
export const projectSyncs = (project: { flavor?: string }, shared: unknown): boolean =>
  !!shared && project.flavor !== 'textStories';
