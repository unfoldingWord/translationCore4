// The sync core — team sync round 1 (BURRITO-SPEC §8.7 R-8.7.7–R-8.7.12, D98; issue #675,
// epic #24). ONE pure function: the files of Door43 main and the files of this computer go
// in; the files to write into the copy and ONE Report (`op: 'sync'`) come out. It reads no
// disk and no network. The shell (#676) gets the files and pushes the result.
//
// The guarantees this function enforces (the table of D98):
//   G1 (R-8.7.7)  Own work is never lost. Each own journal file and each outbox entry is in
//                 the result byte for byte: on Door43 main already, or in `write`. A different
//                 file at an own path on Door43 main refuses (`sync.own-file-differs`). Nothing
//                 is lost: a teammate file that this computer holds and Door43 main does not
//                 is carried back into `write` too.
//   G2 (R-8.7.8)  Incoming files are checked. Each file under `checking/journal/` on Door43
//                 main passes the one validator. One failure refuses the whole sync
//                 (`sync.incoming-invalid`), and the refusal names each path that fails.
//   G3 (R-8.7.9, R-8.7.10)  Derived files are rebuilt, never trusted. Each non-journal file in
//                 `write` is the checkpoint projection of the fold over the base inputs: the
//                 journal files of Door43 main, of this computer and of the outbox, the
//                 (tool, book) resource records from `resolve`, and the base `metadata.json`
//                 of Door43 main. The bytes of a derived file on Door43 main are never an
//                 input. A derived file on Door43 main that the fold no longer projects is in
//                 `remove` (the checkpoint's own rule, `isRemovableDerivedClass`). `write`
//                 never holds `metadata.json`; a `project.meta.set` overlay refuses
//                 (`sync.metadata-overlay`).
//   G6 (R-8.7.11) The same journals give the same project. `write` is a function of the
//                 inputs only: no clock, no random value, keys in sorted order.
//   G7 (R-8.7.12) Only verse text reaches a person. A `text|` fork goes to `textConflicts`.
//                 Each other fork keeps its newest head (the fold does that) and is counted
//                 once in `newestWins`: a fork that the fold of this computer's journal
//                 alone already had is not counted again.
// The app rule of D98: an OBS project refuses (`sync.obs-unsupported`).
//
// A refusal returns an empty `write`, an empty `remove` and a failed Report with the code. The function changes
// nothing, so "the project does not change" (G1, G2, G3) holds by construction.
//
// The file layer is a parameter, like `resolve`. `journal/files.mjs` is bound to Node (fs,
// node:crypto), and the browser bundle imports this module (runtime.ts, issue #62). So the
// caller passes the one validator: `journal/files.mjs` in Node (conformance, tests), and
// `src/data/journal/seal.ts` in the app. Both export `validateSegment`, `validateActorDoc` and
// `segmentName` with the same verdicts (test/journalStore.test.ts, group A). The verdict of
// `validateSegment` can be a Promise (seal.ts uses Web Crypto), so the function is async.
//
// Paths: every map key is a path in the project's ingredient space, the keys of the
// checkpoint projection (`TIT.usfm`, `checking/resources.json`, `checking/journal/<actor>/…`).
// `metadata.json` is the project's metadata document, as in `derivedProjections`.
import { fold } from './fold.mjs';
import { derivedProjections, isRemovableDerivedClass } from './checkpoint.mjs';
import { actorSlugError } from './grammar.mjs';
import { Refusal, okReport, failedReport } from './report.mjs';

export const JOURNAL_PREFIX = 'checking/journal/';
const METADATA = 'metadata.json';

// The same OBS test that projectMetadata applies (R-10.1.1).
const isObsMetadata = (meta) =>
  meta?.type?.flavorType?.name === 'gloss' && meta?.type?.flavorType?.flavor?.name === 'textStories';

const sortedKeys = (map) => [...map.keys()].sort();

/**
 * Check ONE journal file by its path, with the one validator (R-8.1.2, R-8.1.6, R-8.1.10,
 * R-8.1.12, R-8.1.13). Returns `{ ok: true, actor, events }` (events is `[]` for an
 * `actor.json`) or `{ ok: false, actor?, kind, reason }`.
 */
const checkJournalFile = async (files, ipath, bytes) => {
  const parts = ipath.slice(JOURNAL_PREFIX.length).split('/');
  const actor = parts[0];
  if (actorSlugError(actor)) return { ok: false, kind: 'invalid', reason: 'actor-slug' };
  if (parts.length === 2 && parts[1] === 'actor.json') {
    const r = files.validateActorDoc(bytes, actor);
    if (!r.ok) return { ok: false, actor, kind: /^actor-mismatch/.test(r.reason) ? 'record-mismatch' : 'invalid', reason: r.reason };
    return { ok: true, actor, events: [] };
  }
  if (parts.length !== 3 || parts[1] !== 'segments' || !parts[2].endsWith('.action.json'))
    return { ok: false, actor, kind: 'invalid', reason: 'not-a-journal-file (R-8.1.10)' };
  const r = await files.validateSegment(bytes);
  if (!r.ok) return { ok: false, actor, kind: 'invalid', reason: r.reason };
  const foreign = r.events.find((e) => e.actor !== actor);
  if (foreign) return { ok: false, actor, kind: 'foreign-actor', reason: `actor-mismatch:${foreign.actor}` };
  if (parts[2] !== files.segmentName(r.events[0].ts)) return { ok: false, actor, kind: 'misnamed', reason: `segment-misnamed:${parts[2]}` };
  return { ok: true, actor, events: r.events };
};

// The code of a local (own or already-held) journal file that fails the validator. These
// are the codes the journal store throws for the same faults.
const LOCAL_CODES = {
  invalid: 'segment.invalid',
  'foreign-actor': 'segment.foreign-actor',
  misnamed: 'segment.misnamed',
  'record-mismatch': 'actor.record-mismatch',
};

/** The kind of a fold register key: its prefix (`text`, `align`, `dec`, `pin`, ...). */
const kindOf = (key) => key.slice(0, key.indexOf('|'));

/**
 * The sync core (issue #675). Pure: no disk, no network, and `write` holds no clock value.
 *
 * @param {object} input
 * @param {Map<string, string>} input.remote  every file of the Door43 main copy, by ingredient path
 * @param {{ actor: string, journal: Map<string, string>, outbox: Map<string, string> }} input.mine
 *   `actor`: this computer's actor id. `journal`: every journal file this project holds now
 *   (all actors), by path. `outbox`: each staged segment of this actor, by the path it
 *   publishes at (`checking/journal/<actor>/segments/<segmentName>`).
 * @param {(tool: string, book: string, pins: Record<string, unknown>) => object} input.resolve
 *   the §5.2 `resource` record of one (tool, book) decision file (D30), from the folded pins.
 * @param {{ validateSegment: Function, validateActorDoc: Function, segmentName: Function }} input.files
 *   the one validator: `journal/files.mjs` (Node) or `src/data/journal/seal.ts` (the app).
 * @returns {Promise<{ write: Map<string, string>, remove: string[], report: object }>}
 *   `write`: the files to write into the copy, keys sorted (empty on refusal).
 *   `remove`: the derived files on Door43 main that the fold no longer projects, sorted
 *     (empty on refusal). Never a journal file and never `metadata.json`.
 *   `report`: one Report, `op: 'sync'`. When `ok`, `report.facts` is:
 *     carried:       number — own files (journal and outbox) added to the copy
 *     restored:      number — teammate journal files this computer holds that Door43 main
 *                    lacked, carried back to the copy
 *     received:      { [actor]: number } — teammate segment files that `mine.journal` did not have
 *     textConflicts: [{ key, heads: [{ actor, ts, text }], provisional }] — each verse-text fork
 *                    (`text|` key) of the fold; `provisional` is the ts of the newest head
 *     newestWins:    [{ key, kind, winner }] — each other fork, kept on its newest head
 *                    (`winner`, a ts), that the fold of `mine.journal` alone did not have
 *     names:         { [actor]: username } — the folded Door43 usernames (R-8.5.25)
 */
export const syncCore = async ({ remote, mine, resolve, files }) => {
  const startedAt = new Date().toISOString();
  try {
    const result = await syncOrRefuse({ remote, mine, resolve, files });
    return { write: result.write, remove: result.remove, report: okReport('sync', startedAt, new Date().toISOString(), result.facts) };
  } catch (error) {
    return { write: new Map(), remove: [], report: failedReport('sync', startedAt, new Date().toISOString(), error) };
  }
};

const syncOrRefuse = async ({ remote, mine, resolve, files }) => {
  const { actor, journal, outbox } = mine;
  const ownPrefix = `${JOURNAL_PREFIX}${actor}/`;

  // app rule (D98): Bible projects only
  const baseMetadata = remote.has(METADATA) ? JSON.parse(remote.get(METADATA)) : null;
  if (isObsMetadata(baseMetadata))
    throw new Refusal('sync.obs-unsupported', 'round 1 syncs Bible projects only; this project is an OBS project (D98)');

  // G1: the own files, as they are before the sync — the own journal files, then the outbox
  const own = new Map();
  for (const p of sortedKeys(journal)) if (p.startsWith(ownPrefix)) own.set(p, journal.get(p));
  for (const p of sortedKeys(outbox)) {
    const bytes = outbox.get(p);
    if (!p.startsWith(`${ownPrefix}segments/`))
      throw new Refusal('outbox.invalid', `outbox entry ${p} is not a segment path of this actor`, { path: p });
    if (own.has(p) && own.get(p) !== bytes)
      throw new Refusal('outbox.different-action', `outbox entry ${p} differs from the published segment at its path`, { path: p });
    own.set(p, bytes);
  }
  // G1 (R-8.7.7): a different file at an own path on Door43 main refuses
  const differs = [...own.keys()].filter((p) => remote.has(p) && remote.get(p) !== own.get(p));
  if (differs.length)
    throw new Refusal('sync.own-file-differs', `Door43 main holds a different file at ${differs.length} own path(s)`, { paths: differs });

  // G2 (R-8.7.8): every incoming journal file passes the one validator, or the sync refuses
  const incoming = sortedKeys(remote).filter((p) => p.startsWith(JOURNAL_PREFIX));
  const failures = [];
  const remoteEvents = new Map(); // path -> events
  for (const p of incoming) {
    const r = await checkJournalFile(files, p, remote.get(p));
    if (r.ok) remoteEvents.set(p, r.events);
    else failures.push({ path: p, reason: r.reason });
  }
  if (failures.length)
    throw new Refusal('sync.incoming-invalid', `${failures.length} incoming journal file(s) fail the validator`, { failures });

  // the local files: every journal file this computer holds (all actors), then the outbox.
  // Each passes the same validator; a failure throws the journal store's own code.
  const localEvents = async (p, bytes, isOutbox) => {
    const r = await checkJournalFile(files, p, bytes);
    if (r.ok) return r.events;
    const code = isOutbox ? 'outbox.invalid' : LOCAL_CODES[r.kind];
    throw new Refusal(code, `local journal file ${p} fails the validator (${r.reason})`, { path: p, reason: r.reason });
  };
  // R-8.1.5: an accepted teammate file never has two forms (own paths refused above)
  const teammateDiffers = sortedKeys(journal).filter((p) => !own.has(p) && remote.has(p) && remote.get(p) !== journal.get(p));
  if (teammateDiffers.length)
    throw new Refusal('segment.differs-from-accepted', `Door43 main and this computer hold different files at ${teammateDiffers.length} teammate path(s)`, { paths: teammateDiffers });
  // no spread into push: a whole-Bible journal exceeds the call-argument limit (issue #80)
  const heldEvents = [];
  for (const p of sortedKeys(journal)) for (const e of await localEvents(p, journal.get(p), false)) heldEvents.push(e);
  const outboxEvents = [];
  for (const p of sortedKeys(outbox)) for (const e of await localEvents(p, outbox.get(p), true)) outboxEvents.push(e);

  // R-8.7.9 (a): the fold of the journal files of Door43 main, of this computer and of the
  // outbox — nothing is lost. The fold dedups an event that two of them hold.
  const union = [];
  for (const events of remoteEvents.values()) for (const e of events) union.push(e);
  for (const e of heldEvents) union.push(e);
  for (const e of outboxEvents) union.push(e);
  const out = fold(union);

  // G3 (R-8.7.10): metadata.json belongs to the server, so an overlay has no write route
  if (Object.keys(out.projectMeta).length || out.projectMetaRemoved.length)
    throw new Refusal('sync.metadata-overlay', 'the fold carries a project.meta.set overlay; a sync never writes metadata.json (R-8.7.10)', {
      paths: Object.keys(out.projectMeta), removed: out.projectMetaRemoved,
    });

  // G3 (R-8.7.9 (b)): each (tool, book) resource record from `resolve`, never from Door43 main
  const resolutions = {};
  for (const tool of Object.keys(out.decisions).sort())
    for (const book of [...new Set(out.decisions[tool].map((d) => String(d.contextId.reference.bookId).toUpperCase()))].sort())
      (resolutions[tool] ||= {})[book] = resolve(tool, book, out.pins);
  const projected = derivedProjections(out, { baseMetadata, resolutions });
  delete projected[METADATA]; // G3 (R-8.7.10)

  // write: the derived set, then each local journal file Door43 main does not hold yet —
  // own files and outbox entries (G1, `carried`), and teammate files (`restored`)
  const entries = Object.entries(projected);
  let carried = 0;
  let restored = 0;
  for (const [p, bytes] of own) if (!remote.has(p)) { entries.push([p, bytes]); carried += 1; }
  for (const p of sortedKeys(journal)) if (!own.has(p) && !remote.has(p)) { entries.push([p, journal.get(p)]); restored += 1; }
  const write = new Map(entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  // remove: each derived file on Door43 main that the fold no longer projects, by the
  // checkpoint's own rule (a journal file and metadata.json are never in this class)
  const remove = sortedKeys(remote).filter((p) => isRemovableDerivedClass(p) && !Object.hasOwn(projected, p));

  // facts — received: teammate segments that this project did not have
  const received = {};
  for (const p of incoming)
    if (!p.startsWith(ownPrefix) && p.includes('/segments/') && !journal.has(p)) {
      const who = p.slice(JOURNAL_PREFIX.length).split('/')[0];
      received[who] = (received[who] || 0) + 1;
    }
  // G7: verse-text forks go to a person; each other fork is counted once
  const eventByTs = new Map(union.map((e) => [e.ts, e]));
  const textConflicts = out.forks.filter((f) => kindOf(f.key) === 'text').map((f) => ({
    key: f.key,
    heads: f.heads.map((ts) => ({ actor: eventByTs.get(ts)?.actor ?? null, ts, text: typeof eventByTs.get(ts)?.text === 'string' ? eventByTs.get(ts).text : null })),
    provisional: f.provisional,
  }));
  const forkId = (f) => `${f.key}\u0000${f.heads.join(',')}`;
  const hadBefore = new Set(fold(heldEvents).forks.map(forkId));
  const newestWins = out.forks
    .filter((f) => kindOf(f.key) !== 'text' && !hadBefore.has(forkId(f)))
    .map((f) => ({ key: f.key, kind: kindOf(f.key), winner: f.provisional }));

  return { write, remove, facts: { carried, restored, received, textConflicts, newestWins, names: { ...out.names } } };
};
