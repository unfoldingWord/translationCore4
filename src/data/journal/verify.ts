// The fold-compare invariant verifier (issue #62).
//
// One reusable check that the project on disk IS a materialization of its
// journal: read the journal the app wrote, validate every segment with the
// conformance reader, fold, generate the exhaustive journal-derived file set
// into a disposable in-memory tree, and byte-compare that set against the real
// project — reporting every mismatched, missing, and extra derived path with
// hashes. The comparison scope is the complete journal-derived set; it is NOT
// .git (invisible over the ingredient surface anyway), the journal files
// themselves, audio or another tolerated unjournaled ingredient class.
//
// metadata.json is owned by the server (no HTTP write route — D28), so its
// byte form is the server's; it is verified SEMANTICALLY: the regenerated
// currentScope must equal the fold's scope state (R-8.7.2), and a folded
// project.meta.set overlay that the document does not carry is a failure.
//
// Runs everywhere the issue requires: in CI against fixture projects
// (test/journalVerify.test.ts and the store suites), and from the rig journey
// teardown after every journey that mutates a project (e2e/helpers/rig.ts).
import { ServerApi, ServerApiError } from '../serverApi';
import { md5Hex } from '../httpStore';
import { actorSlugError, isTs } from '../../../conformance/journal/grammar.mjs';
import { segmentName, segmentTs, validateSegment, type JournalEvent } from './seal';
import {
  classifyDivergence,
  fold,
  derivedProjections,
  isUnjournaledIngredient,
  projectResources,
  projectSettings,
  type FoldOutput,
} from './runtime';

/** The two EMPTY checkpoint documents. §8.7's regeneration set is complete, so
 * the checkpoint materializes resources.json/settings.json even when nothing is
 * folded for them; between checkpoints those files legitimately do not exist
 * yet. An ABSENT disk file whose projection is exactly the empty document is
 * therefore "not yet checkpointed", never divergence. */
const EMPTY_DOCUMENTS = new Set([projectResources({}), projectSettings({})]);

export interface VerifierMismatch {
  ipath: string;
  kind: 'mismatched' | 'missing' | 'extra';
  diskMd5: string | null;
  projectedMd5: string | null;
}

export interface VerifierReport {
  ok: boolean;
  repoPath: string;
  /** Journal files the conformance reader refused — any entry fails the run. */
  invalidSegments: Array<{ path: string; reason: string }>;
  /** The fold or checkpoint materialization itself refused (an incomplete or
   * corrupt journal) — reported, never thrown past the caller. */
  projectionFailure: string | null;
  mismatches: VerifierMismatch[];
  /** Semantic metadata failures (scope reconstruction, unapplied overlay). */
  metadataProblems: string[];
  tolerated: string[];
  /** Paths that byte-matched. */
  clean: string[];
  foldReports: {
    forks: FoldOutput['forks'];
    retained: FoldOutput['retained'];
    invalid: FoldOutput['invalid'];
    pendingStructural: FoldOutput['pendingStructural'];
  };
}

const JOURNAL_PREFIX = 'checking/journal/';

/** Read + validate every journal segment over the ingredient surface with the
 * SAME conformance reader the store uses. Nothing invalid is dropped silently. */
const readJournal = async (
  api: ServerApi,
  repoPath: string,
  paths: string[],
): Promise<{ events: JournalEvent[]; invalidSegments: Array<{ path: string; reason: string }> }> => {
  const events: JournalEvent[] = [];
  const invalidSegments: Array<{ path: string; reason: string }> = [];
  for (const path of paths) {
    if (!path.startsWith(JOURNAL_PREFIX)) continue;
    const parts = path.slice(JOURNAL_PREFIX.length).split('/');
    if (parts.length === 2 && parts[1] === 'actor.json') continue; // identity record, not stream
    if (parts.length !== 3 || parts[1] !== 'segments') {
      invalidSegments.push({ path, reason: 'not-a-segment-path' });
      continue;
    }
    const [actor, , name] = parts;
    if (actorSlugError(actor)) {
      invalidSegments.push({ path, reason: 'actor-slug' });
      continue;
    }
    const ts = segmentTs(name);
    if (!isTs(ts) || segmentName(ts) !== name) {
      invalidSegments.push({ path, reason: 'misnamed' });
      continue;
    }
    let raw: string;
    try {
      raw = await api.readIngredient(repoPath, path);
    } catch (error) {
      if (error instanceof ServerApiError && error.isNotFound) {
        invalidSegments.push({ path, reason: 'vanished' });
        continue;
      }
      throw error;
    }
    const verdict = await validateSegment(raw);
    if (!verdict.ok) {
      invalidSegments.push({ path, reason: verdict.reason });
      continue;
    }
    const foreign = verdict.events.find((event) => event.actor !== actor);
    if (foreign) {
      invalidSegments.push({ path, reason: `actor-mismatch:${foreign.actor}` });
      continue;
    }
    if (verdict.events[0].ts !== ts) {
      invalidSegments.push({ path, reason: 'segment-misnamed' });
      continue;
    }
    events.push(...verdict.events);
  }
  return { events, invalidSegments };
};

/**
 * Verify that `repoPath`'s derived files are exactly the fold of its journal.
 *
 * `resolutions` is harvested from the on-disk decision files themselves (the
 * §5.2 `resource` field is derive-time state the journal does not carry); a
 * decision file without one is reported as a mismatch by the byte compare.
 */
export const verifyProjectAgainstJournal = async (
  api: ServerApi,
  repoPath: string,
): Promise<VerifierReport> => {
  const paths = await api.listPaths(repoPath);

  // 1. The journal, validated by the conformance reader.
  const { events, invalidSegments } = await readJournal(api, repoPath, paths);

  // 2. The real project's derived bytes (everything except the journal and the
  //    tolerated unjournaled classes).
  const diskFiles: Record<string, string> = {};
  for (const path of paths) {
    if (path.startsWith(JOURNAL_PREFIX)) continue;
    try {
      diskFiles[path] = await api.readIngredient(repoPath, path);
    } catch (error) {
      if (error instanceof ServerApiError && error.isNotFound) continue;
      throw error;
    }
  }

  // 3. Fold + generate the exhaustive derived set into a disposable tree. A
  //    refusal here (a corrupt/incomplete journal) is REPORTED, never thrown:
  //    the verifier's job is the verdict.
  const failed = (projectionFailure: string): VerifierReport => ({
    ok: false,
    repoPath,
    invalidSegments,
    projectionFailure,
    mismatches: [],
    metadataProblems: [],
    tolerated: [],
    clean: [],
    foldReports: { forks: [], retained: [], invalid: [], pendingStructural: [] },
  });
  let foldOut: FoldOutput;
  try {
    foldOut = fold(events);
  } catch (error) {
    return failed(`fold refused: ${String((error as Error).message ?? error)}`);
  }
  const baseMetadata = await api.getMetadataRaw(repoPath);
  const resolutions: Record<string, Record<string, unknown>> = {};
  for (const [ipath, text] of Object.entries(diskFiles)) {
    const m = /^checking\/(translationWords|translationNotes)\/([A-Z0-9]{3})\.json$/.exec(ipath);
    if (!m) continue;
    try {
      const resource = (JSON.parse(text) as { resource?: Record<string, unknown> }).resource;
      if (resource) (resolutions[m[1]] ??= {})[m[2]] = resource;
    } catch {
      /* unparseable — the byte compare reports it */
    }
  }
  let projections: Record<string, string>;
  try {
    projections = derivedProjections(foldOut, { baseMetadata, resolutions });
  } catch (error) {
    return failed(`checkpoint materialization refused: ${String((error as Error).message ?? error)}`);
  }

  // 4. metadata.json is verified semantically (server-owned bytes, D28).
  delete projections['metadata.json'];
  const metadataProblems: string[] = [];
  const scope = (baseMetadata?.type?.flavorType?.currentScope ?? {}) as Record<string, string[]>;
  if (JSON.stringify(Object.keys(scope).sort()) !== JSON.stringify(Object.keys(foldOut.scope).sort()))
    metadataProblems.push(
      `currentScope books [${Object.keys(scope).sort().join(', ')}] != fold scope [${Object.keys(foldOut.scope).sort().join(', ')}] (R-8.7.2)`,
    );
  else
    for (const [book, value] of Object.entries(foldOut.scope))
      if (JSON.stringify(scope[book]) !== JSON.stringify(value))
        metadataProblems.push(`currentScope["${book}"] ${JSON.stringify(scope[book])} != fold ${JSON.stringify(value)}`);
  const overlayPaths = [...Object.keys(foldOut.projectMeta), ...foldOut.projectMetaRemoved];
  if (overlayPaths.length)
    metadataProblems.push(
      `a project.meta.set overlay is folded (${overlayPaths.join(', ')}) but the platform ` +
        `cannot materialize it over HTTP (D28) — unverifiable, treated as a failure`,
    );

  // 5. Byte-compare, enumerating from the union of both sets (a deleted derived
  //    file is divergence too — R-8.7.5).
  const verdict = classifyDivergence(diskFiles, projections);
  const notYetCheckpointed = (ipath: string): boolean =>
    !Object.hasOwn(diskFiles, ipath) &&
    Object.hasOwn(projections, ipath) &&
    EMPTY_DOCUMENTS.has(projections[ipath]);
  const mismatches: VerifierMismatch[] = verdict.diverged
    .filter((ipath) => !notYetCheckpointed(ipath))
    .map((ipath) => {
    const disk = Object.hasOwn(diskFiles, ipath) ? diskFiles[ipath] : null;
    const projected = Object.hasOwn(projections, ipath) ? projections[ipath] : null;
    return {
      ipath,
      kind: disk === null ? 'missing' : projected === null ? 'extra' : 'mismatched',
      diskMd5: disk === null ? null : md5Hex(disk),
      projectedMd5: projected === null ? null : md5Hex(projected),
    };
  });

  return {
    ok: invalidSegments.length === 0 && mismatches.length === 0 && metadataProblems.length === 0,
    repoPath,
    invalidSegments,
    projectionFailure: null,
    mismatches,
    metadataProblems,
    tolerated: verdict.tolerated.filter((p) => isUnjournaledIngredient(p)),
    clean: verdict.clean,
    foldReports: {
      forks: foldOut.forks,
      retained: foldOut.retained,
      invalid: foldOut.invalid,
      pendingStructural: foldOut.pendingStructural,
    },
  };
};

/** One-line human summary for journey teardowns and CI failure output. */
export const describeVerifierReport = (report: VerifierReport): string => {
  if (report.ok) return `${report.repoPath}: journal materialization verified (${report.clean.length} derived paths byte-identical)`;
  return [
    `${report.repoPath}: journal materialization FAILED`,
    ...report.invalidSegments.map((s) => `  invalid segment ${s.path}: ${s.reason}`),
    ...(report.projectionFailure ? [`  ${report.projectionFailure}`] : []),
    ...report.mismatches.map(
      (m) => `  ${m.kind} ${m.ipath} (disk ${m.diskMd5 ?? 'absent'} vs projected ${m.projectedMd5 ?? 'absent'})`,
    ),
    ...report.metadataProblems.map((p) => `  metadata: ${p}`),
  ].join('\n');
};
