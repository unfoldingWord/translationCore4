// The names of an open from Door43 (#677) that both the ops log (src/data/journal/opsLog.ts,
// the open section) and the platform's create routes (src/data/serverApi.ts) read. No
// imports, so the server API can use them without a cycle. `archiveNameOf` is the one
// definition for the scratch copies of a sync (#676) and of an open from Door43 (#677).

/** One name for the WHOLE project path inside `_local_/_archive_/`: `-` becomes
 * `-d` and `/` becomes `-s`. The encoding is injective, and it adds only `-`,
 * `d` and `s`, so the name keeps the platform's path rules (no `/`, no `..`;
 * pankosmia-web a83725b `utils/paths.rs` forbidden_path_strings). */
export const archiveNameOf = (repoPath: string): string => repoPath.replaceAll('-', '-d').replaceAll('/', '-s');

/** The scratch copy of an open from Door43. Under `_local_/_archive_/`, so Home never lists it. */
export const openScratchOf = (repoPath: string): string => `_local_/_archive_/tc4-open--${archiveNameOf(repoPath)}`;

/** The marker of an unfinished copy (opsLog.ts, the open section), as an ingredient path. */
export const OPEN_MARKER = 'tc4-open/move.json';

/** The folders under `ingredients/` that tC4 keeps for its own markers: `tc4-open/`
 * (#677, OPEN_MARKER) and `tc4-sync/` (#676, APPLY_MARKER). The one definition: a
 * file there that comes with Door43 content is deleted at the fixed clone path before
 * the move (the open), and the sync's apply never writes or removes one in a project. */
export const RESERVED_INGREDIENT_FOLDERS = ['tc4-open/', 'tc4-sync/'] as const;
export const isReservedIngredient = (ipath: string): boolean =>
  RESERVED_INGREDIENT_FOLDERS.some((folder) => ipath.startsWith(folder));

/** The projects whose open from Door43 runs in this app now. */
const runningOpens = new Set<string>();
export const openRunning = {
  add: (repoPath: string): void => void runningOpens.add(repoPath),
  delete: (repoPath: string): void => void runningOpens.delete(repoPath),
  has: (repoPath: string): boolean => runningOpens.has(repoPath),
};
/** Tests: a kill ends the process, and with it every open that ran (a restart starts empty). */
export const forgetRunningOpens = (): void => runningOpens.clear();
