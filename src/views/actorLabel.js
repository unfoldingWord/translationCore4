// The label of the person who owns a version (#679, #680): the one label
// function of the review (ConflictReview.jsx) and the sync result
// (SyncResult.jsx). Both give it the same `actors`, so one teammate has one
// number in both: the store's readTeam() and the sync's `report.facts.actors`
// are the sorted actor ids of the same journal.
import { t } from '../i18n';

/** "Mine" for this installation's actor `me`; else the teammate's Door43 name
 * from `names` (FoldOutput.names, #674); else "Teammate n". The number counts
 * the teammates with no name in the order of `actors` (every actor id of the
 * project, sorted), so a teammate keeps one number while the project is open.
 * Without `actors` the actor is numbered alone. */
export function actorLabel(actor, names, me, actors = [actor]) {
  if (actor === me) return t('conflicts.mine');
  const name = names?.[actor];
  if (name) return name;
  const unnamed = actors.filter((a) => a !== me && !names?.[a]);
  const n = unnamed.indexOf(actor);
  return t('conflicts.teammate', { n: (n < 0 ? unnamed.length : n) + 1 });
}
