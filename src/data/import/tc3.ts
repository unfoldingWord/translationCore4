// The tC3 parser (issue #21, journey J9a, docs/ARCHITECTURE.md §8): one or
// several translationCore 3 project zips → one ImportBundle. It imports the
// current state only (D80 point 3): the text, the alignments, the decisions,
// the contributors and the resource versions. The check history under
// `apps/translationCore/checkData/` gives no journal event; it gives only the
// time of each decision's latest record.
//
// - Text: tC3's own USFM export (`USFMExportActions.setUpUSFMJSONObject` +
//   `usfm.toUSFM(…, {forcedNewLines: true})`) over the chapter JSON, with the
//   stored `headers.json` and a `\usfm 3.0` header (`makeSureUsfm3InHeader`).
// - Alignments: `apps/translationCore/alignmentData/<book>/<ch>.json`, one §5.1
//   record for each verse. The export's `wordAlignments/<project>.usfm` is made
//   from the same files; the golden test proves the two agree.
// - Decisions: the check index items (`apps/translationCore/index/<tool>/<book>/`)
//   that hold user data, as §5.2 records.
// - Resource versions: `manifest.json` `externalResources`. A version is never
//   stored without its sha (D58): the review step resolves each one (D82), and
//   `applyVersions` writes the pins.
import { unzipSync } from 'fflate';
import { t } from '../../i18n';
import { normalizeOccurrences, type WithOccurrences } from '../align/occurrences';
import type { DecisionFile, ResourcePin, ResourcesFile } from '../burritoStore';
import { carryOverDecisions } from '../carryOver';
import type { CheckItem } from '../derive';
import { decompose, verseTextMd5 } from '../journal/runtime';
import { usfmjs } from '../vendor';
import type { AlignmentRecord, DecisionRecord, ImportBundle, ImportFile, ImportParser, VersionRequest } from './types';

const decoder = new TextDecoder();
const APP = 'apps/translationCore';
const TOOLS = ['translationNotes', 'translationWords'] as const;
type Tool = (typeof TOOLS)[number];
type Finding = ImportBundle['findings'][number];
type Files = Record<string, Uint8Array>;
type Manifest = {
  project?: { id?: string; name?: string };
  resource?: { id?: string; name?: string };
  target_language?: { id?: string; name?: string };
  license?: string;
  translators?: unknown[];
  checkers?: unknown[];
  time_created?: string;
  toolsSelectedGLs?: Record<string, string>;
  toolsSelectedOwners?: Record<string, string>;
  tsv_relation?: string[];
  externalResources?: Record<string, string | string[]>;
};

const damaged = (text: string, code?: Finding['code']): Finding => ({ kind: 'damaged', text, warn: true, ...(code ? { code } : {}) });
const damagedBundle = (findings: Finding[]): ImportBundle => ({ kind: 'bible', facts: { language: '', name: '' }, books: [], findings });
const json = (bytes: Uint8Array | undefined): unknown => (bytes ? JSON.parse(decoder.decode(bytes)) : undefined);
const byNumber = (a: string, b: string) => Number(a) - Number(b);

/** I-4: journaled content is NFC. tC3 stores the original-language words as
 * the resource spells them (the Hebrew of UHB is not NFC), so an alignment
 * record is normalized before the seed journals it. */
const nfc = <T>(value: T): T => JSON.parse(JSON.stringify(value), (_k, v) => (typeof v === 'string' ? v.normalize('NFC') : v)) as T;

/** §5.1 stores exactly what word-aligner's `unmerge` gives: tC3 also writes
 * `type: "bottomWord"` on a target word, which `unmerge` does not. */
const unmergeWord = (word: WithOccurrences) => normalizeOccurrences(Object.fromEntries(Object.entries(word).filter(([k]) => k !== 'type')) as WithOccurrences);

/** The files of one zip under its project folder: the export is flat, a
 * re-zipped copy may sit under one top-level folder. */
function projectFiles(entries: Files): Files | null {
  if ('manifest.json' in entries) return entries;
  const names = Object.keys(entries);
  const folder = names.map((n) => /^([^/]+)\/manifest\.json$/.exec(n)?.[1]).find((f) => f && names.some((n) => n.startsWith(`${f}/${APP}/`)));
  if (!folder) return null;
  const prefix = `${folder}/`;
  return Object.fromEntries(Object.entries(entries).filter(([n]) => n.startsWith(prefix)).map(([n, b]) => [n.slice(prefix.length), b]));
}

/** tC3's USFM export of the chapter JSON (see the header comment). */
function bookUsfm(files: Files, book: string): string | null {
  const chapters: Record<string, Record<string, { verseObjects: Array<{ type: string; text: string }> }>> = {};
  for (const name of Object.keys(files).filter((n) => new RegExp(`^${book}/\\d+\\.json$`).test(n))) {
    const chapter = String(parseInt(name.slice(book.length + 1), 10));
    const verses = json(files[name]) as Record<string, string>;
    chapters[chapter] = {};
    for (const verse of Object.keys(verses)) chapters[chapter][verse] = { verseObjects: [{ text: `${verses[verse]}\n`, type: 'text' }] };
  }
  if (Object.keys(chapters).length === 0) return null;
  const headers = ((json(files[`${book}/headers.json`]) as Array<{ tag: string; content?: string }> | undefined) ?? []).map((h) => ({ ...h }));
  const usfmHeader = headers.find((h) => h.tag === 'usfm');
  if (usfmHeader) usfmHeader.content = '3.0';
  else headers.splice(headers.length < 2 ? headers.length : 1, 0, { tag: 'usfm', content: '3.0' });
  return usfmjs.toUSFM({ headers, chapters }, { forcedNewLines: true }) as string;
}

/** The `dcs::owner/repo@tag` of a tC3 resource URL (`…/archive/<tag>.zip`). */
const dcsRef = (url: string | undefined) => {
  const m = /git\.door43\.org\/([^/]+)\/([^/]+)\/archive\/(.+)\.zip$/.exec(url ?? '');
  return m ? { repoPath: `git.door43.org/${m[1]}/${m[2]}`, version: m[3] } : null;
};

/** One §5.1 file: a record for each verse of `alignmentData`, keyed to the
 * verse text of `usfm` (I-3), invalid where tC3 kept an invalid marker. */
function alignmentFile(files: Files, book: string, code: string, usfm: string, sourceVersion: string) {
  const { verses } = decompose(usfm);
  const out: Record<string, Record<string, AlignmentRecord>> = {};
  const dir = `${APP}/alignmentData/${book}/`;
  for (const name of Object.keys(files).filter((n) => n.startsWith(dir) && /^\d+\.json$/.test(n.slice(dir.length))).sort((a, b) => byNumber(a.slice(dir.length, -5), b.slice(dir.length, -5)))) {
    const chapter = name.slice(dir.length, -5);
    const data = json(files[name]) as Record<string, { alignments?: Array<{ topWords: WithOccurrences[]; bottomWords: WithOccurrences[] }>; wordBank?: WithOccurrences[] }>;
    for (const verse of Object.keys(data).sort(byNumber)) {
      const content = verses[`${chapter}:${verse}`];
      if (content === undefined) continue; // no such verse in the text: nothing to key the record to
      (out[chapter] ??= {})[verse] = {
        alignments: nfc((data[verse].alignments ?? []).map((a) => ({ topWords: a.topWords.map(normalizeOccurrences), bottomWords: a.bottomWords.map(unmergeWord) }))),
        wordBank: nfc((data[verse].wordBank ?? []).map(normalizeOccurrences)),
        invalid: `${APP}/tools/wordAlignment/invalid/${chapter}/${verse}.json` in files,
        targetVerseMd5: verseTextMd5(content),
        sourceVersion,
      };
    }
  }
  return { schemaVersion: 1, book: code, chapters: out };
}

/** The identity a checkData record and an index item share. */
const contextKey = (c: { groupId?: string; checkId?: string; reference?: { chapter?: unknown; verse?: unknown }; occurrence?: unknown; quote?: unknown }) =>
  JSON.stringify([c.groupId, c.checkId ?? '', String(c.reference?.chapter), String(c.reference?.verse), String(c.occurrence), c.quote]);
/** A checkData file name is its time, with `:` written as `_`. */
const fileTime = (name: string) => name.split('/').pop()!.replace(/\.json$/, '').replace(/_/g, ':');

/** The latest time of each check in the history, and of each verse's edits. */
function latestTimes(files: Files, book: string) {
  const byCheck = new Map<string, string>();
  const byVerse = new Map<string, string>();
  const later = (map: Map<string, string>, key: string, time: string) => {
    if (!map.has(key) || map.get(key)! < time) map.set(key, time);
  };
  const dir = `${APP}/checkData/`;
  for (const name of Object.keys(files)) {
    const m = new RegExp(`^${dir}([^/]+)/${book}/(\\d+)/(\\d+)/[^/]+\\.json$`).exec(name);
    if (!m) continue;
    const record = json(files[name]) as { contextId?: Parameters<typeof contextKey>[0]; modifiedTimestamp?: string };
    const time = record.modifiedTimestamp ?? fileTime(name);
    if (m[1] === 'verseEdits') later(byVerse, `${m[2]}:${m[3]}`, time);
    else if (record.contextId) later(byCheck, contextKey(record.contextId), time);
  }
  return { byCheck, byVerse };
}

/** A check index item holds user data: the §5.2 "touched" rule. */
const touched = (item: Record<string, unknown>) =>
  !!((Array.isArray(item.selections) ? item.selections.length : item.selections) || item.nothingToSelect || item.comments || item.reminders || item.verseEdits || item.invalidated);

/** One book's §5.2 files (without the resource record, which `applyVersions` adds). */
function decisionFiles(files: Files, book: string, code: string, fallbackTime: string): Record<Tool, DecisionFile | null> {
  const times = latestTimes(files, book);
  const out = {} as Record<Tool, DecisionFile | null>;
  for (const tool of TOOLS) {
    const dir = `${APP}/index/${tool}/${book}/`;
    const category = new Map<string, string>();
    for (const name of Object.keys(files).filter((n) => n.startsWith(`${dir}categoryIndex/`) && n.endsWith('.json')))
      for (const groupId of json(files[name]) as string[]) category.set(groupId, name.slice(`${dir}categoryIndex/`.length, -5));
    const decisions: DecisionRecord[] = [];
    for (const name of Object.keys(files).filter((n) => n.startsWith(dir) && /^[^/]+\.json$/.test(n.slice(dir.length))).sort()) {
      for (const item of json(files[name]) as Array<Record<string, unknown> & { contextId: Parameters<typeof contextKey>[0] & { reference: { chapter: unknown; verse: unknown } } }>) {
        if (!touched(item)) continue;
        const ref = item.contextId.reference;
        const history = [times.byCheck.get(contextKey(item.contextId)), item.verseEdits ? times.byVerse.get(`${ref.chapter}:${ref.verse}`) : undefined].filter(Boolean) as string[];
        decisions.push({
          contextId: item.contextId,
          category: category.get(String(item.contextId.groupId)) ?? '',
          selections: Array.isArray(item.selections) && item.selections.length ? item.selections : false,
          comments: item.comments ?? false,
          reminders: item.reminders ?? false,
          nothingToSelect: item.nothingToSelect ?? false,
          verseEdits: item.verseEdits ?? false,
          invalidated: item.invalidated ?? false,
          modifiedTimestamp: history.sort().pop() ?? fallbackTime,
        });
      }
    }
    out[tool] = decisions.length ? ({ schemaVersion: 1, tool, book: code, decisions } as unknown as DecisionFile) : null;
  }
  return out;
}

/** The resource versions one project names, for the tools it holds decisions for
 * and for its original-language text. `master` is a branch, not a version. */
function versionRequests(manifest: Manifest, code: string, tools: Tool[]): VersionRequest[] {
  const ext = manifest.externalResources ?? {};
  const out: VersionRequest[] = [];
  const tagged = (ref: ReturnType<typeof dcsRef>) => (ref && ref.version !== 'master' ? [ref] : []);
  for (const tool of tools) {
    const ref = dcsRef(ext[tool === 'translationNotes' ? 'tNotesGateway' : 'tWordsGateway'] as string | undefined);
    out.push({ slot: tool, book: code, candidates: tagged(ref) });
  }
  const refs = [ext.tNotesOriginalLang, ext.tWordsOriginalLang, ext.waOriginalLang].map((u) => dcsRef(u as string | undefined));
  const testament = refs.some((r) => r?.repoPath.endsWith('/hbo_uhb')) ? 'ot' : 'nt';
  const repo = testament === 'ot' ? 'hbo_uhb' : 'el-x-koine_ugnt';
  const relation = (manifest.tsv_relation ?? []).map((r) => /^(?:hbo\/uhb|el-x-koine\/ugnt)\?v=(.+)$/.exec(r)).find((m, i) => m && (manifest.tsv_relation![i].startsWith('hbo') === (testament === 'ot')));
  const candidates = [...refs.flatMap(tagged).filter((r) => r.repoPath.endsWith(`/${repo}`)), ...(relation ? [{ repoPath: `git.door43.org/unfoldingWord/${repo}`, version: `v${relation[1]}` }] : [])];
  out.push({ slot: `originalLanguage.${testament}`, book: code, candidates });
  return out;
}

/** One zip → its book, or the finding that refuses it. */
function readProject(file: ImportFile) {
  let entries: Files;
  try {
    entries = unzipSync(file.bytes);
  } catch {
    return { finding: damaged(t('importer.tc3.notZip', { file: file.name }), 'import.damaged.truncated') };
  }
  const files = projectFiles(entries);
  if (!files) return { finding: damaged(t('importer.tc3.noManifest', { file: file.name }), 'import.damaged.no-manifest') };
  const manifest = json(files['manifest.json']) as Manifest;
  const book = manifest.project?.id?.toLowerCase() ?? '';
  const code = book.toUpperCase();
  const usfm = /^[a-z0-9]{3}$/.test(book) ? bookUsfm(files, book) : null;
  if (!usfm) return { finding: damaged(t('importer.tc3.noText', { file: file.name })) };
  const wa = dcsRef(manifest.externalResources?.waOriginalLang as string | undefined);
  const alignments = alignmentFile(files, book, code, usfm, wa ? `dcs::${wa.repoPath.split('/').slice(1).join('/')}@${wa.version}` : '');
  const decisions = decisionFiles(files, book, code, manifest.time_created ?? new Date(0).toISOString());
  const verses = Object.keys(decompose(usfm).verses).filter((k) => !k.startsWith('0:')).length;
  const gl = manifest.toolsSelectedGLs ?? {};
  return { manifest, code, usfm, alignments, decisions, verses, gl, owners: manifest.toolsSelectedOwners ?? {} };
}

async function parse(files: ImportFile[]): Promise<ImportBundle> {
  const findings: Finding[] = [];
  const projects = [];
  for (const file of files) {
    const project = readProject(file);
    if ('finding' in project) findings.push(project.finding!);
    else projects.push(project);
  }
  if (findings.length) return damagedBundle(findings);
  const languages = [...new Set(projects.map((p) => p.manifest.target_language?.id ?? ''))];
  if (languages.length > 1) return damagedBundle([damaged(t('importer.tc3.languages', { languages: languages.join(', ') }))]);
  const codes = projects.map((p) => p.code);
  const twice = codes.find((c, i) => codes.indexOf(c) !== i);
  if (twice) return damagedBundle([damaged(t('importer.tc3.twice', { code: twice }))]);
  projects.sort((a, b) => a.code.localeCompare(b.code));

  const licenses = [...new Set(projects.map((p) => p.manifest.license?.trim() ?? ''))];
  const license = licenses.length === 1 ? licenses[0] || undefined : undefined;
  findings.push(
    licenses.length > 1
      ? { kind: 'license', text: t('importer.tc3.licenses', { licenses: licenses.map((l) => l || t('importer.tc3.licenseNone')).join(' · ') }), warn: true }
      : license
        ? { kind: 'license', text: license, warn: false }
        : { kind: 'license', text: t('importer.tc3.licenseMissing'), warn: true },
  );
  const contributors = [...new Set(projects.flatMap((p) => [...(p.manifest.translators ?? []), ...(p.manifest.checkers ?? [])].map(String)))];
  const first = projects[0].manifest;
  const sidecars: Record<string, unknown> = {};
  const alignments: Record<string, AlignmentRecord[]> = {};
  const decisions: DecisionRecord[] = [];
  const versions: VersionRequest[] = [];
  for (const p of projects) {
    // A book never opened in the aligner has no records, and the checkpoint keeps no empty file.
    if (Object.keys(p.alignments.chapters).length) sidecars[`checking/alignments/${p.code}.json`] = p.alignments;
    alignments[p.code] = Object.values(p.alignments.chapters).flatMap((c) => Object.values(c));
    const tools = TOOLS.filter((tool) => p.decisions[tool]);
    for (const tool of tools) {
      sidecars[`checking/${tool}/${p.code}.json`] = p.decisions[tool];
      decisions.push(...(p.decisions[tool]!.decisions as unknown as DecisionRecord[]));
    }
    versions.push(...versionRequests(p.manifest, p.code, tools));
  }
  const gl = projects.map((p) => p.gl.translationNotes ?? p.gl.translationWords).find(Boolean) ?? 'en';
  const owner = projects.map((p) => p.owners.translationNotes ?? p.owners.translationWords).find(Boolean) ?? 'unfoldingWord';
  return {
    kind: 'bible',
    facts: {
      language: languages[0],
      name: [first.target_language?.id, first.resource?.id].filter(Boolean).join('_').toLowerCase(),
      ...(license ? { license } : {}),
      contributors,
    },
    books: projects.map((p) => ({ code: p.code, usfm: p.usfm })),
    verses: projects.reduce((sum, p) => sum + p.verses, 0),
    alignments,
    decisions,
    sidecars,
    versions,
    gateway: { languageId: gl, owner },
    ...(licenses.length > 1 ? { licenseChoices: licenses } : {}), // '' is the choice of no license
    findings,
  };
}

export const TC3_PARSER: ImportParser = {
  id: 'tc3',
  accepts: (files) => files.length > 0 && files.every((f) => f.name.toLowerCase().endsWith('.zip')),
  parse,
};

/** Where a version request's pin lives in §5.3. tW pins its links and its
 * articles from the one `<lang>_tw` repository (D34). */
const SLOT_PATHS: Record<VersionRequest['slot'], string[]> = {
  translationNotes: ['languageSets.primary.translationNotes'],
  translationWords: ['languageSets.primary.translationWordsLinks', 'languageSets.primary.translationWords'],
  'originalLanguage.nt': ['resources.originalLanguage.nt'],
  'originalLanguage.ot': ['resources.originalLanguage.ot'],
};
const TOOL_PIN: Record<Tool, string> = { translationNotes: 'translationNotes', translationWords: 'translationWordsLinks' };

/** The pins a set of lookups found: one per slot. A slot's candidates are
 * tried newest first, so books that name different original-language versions
 * get the newest version DCS has (D82 point 5). A helps slot whose books name
 * different versions is not looked up: no one pin holds all their decisions,
 * so the user takes the installed versions and every book carries over (D82
 * point 2). `lookup` gives the sha of a tag, null when DCS has no such tag,
 * or undefined when DCS did not answer: then the slot stays unresolved, so an
 * older candidate is never pinned in place of one that was not checked. */
export async function resolveVersions(
  requests: VersionRequest[],
  lookup: (repoPath: string, version: string) => Promise<string | null | undefined>,
): Promise<Partial<Record<VersionRequest['slot'], { repoPath: string; version: string; sha: string }>>> {
  const out: Awaited<ReturnType<typeof resolveVersions>> = {};
  const bySlot = new Map<VersionRequest['slot'], VersionRequest['candidates']>();
  for (const r of requests) bySlot.set(r.slot, [...(bySlot.get(r.slot) ?? []), ...r.candidates]);
  const newest = (a: { version: string }, b: { version: string }) => b.version.localeCompare(a.version, undefined, { numeric: true });
  for (const [slot, candidates] of bySlot) {
    const named = new Set(requests.filter((r) => r.slot === slot).map((r) => JSON.stringify(r.candidates)));
    if (!slot.startsWith('originalLanguage') && named.size > 1) continue;
    const seen = new Set<string>();
    for (const c of [...candidates].sort(newest)) {
      if (seen.has(`${c.repoPath}@${c.version}`)) continue;
      seen.add(`${c.repoPath}@${c.version}`);
      const sha = await lookup(c.repoPath, c.version);
      if (sha === undefined) break;
      if (sha && /^[0-9a-f]{40}$/.test(sha)) {
        out[slot] = { ...c, sha };
        break;
      }
    }
  }
  return out;
}

/** The slots that have no pin in `found`: the review page offers "Use installed versions" for them. */
export const unresolvedSlots = (requests: VersionRequest[], found: Awaited<ReturnType<typeof resolveVersions>>) =>
  [...new Set(requests.map((r) => r.slot))].filter((slot) => !found[slot]);

/** The (tool, book) decision files that move to an installed pin: they need a
 * derived check list for the carry-over. */
export const carryOverNeeds = (bundle: ImportBundle, found: Awaited<ReturnType<typeof resolveVersions>>) =>
  TOOLS.flatMap((tool) => (found[tool] ? [] : bundle.books.filter((b) => bundle.sidecars?.[`checking/${tool}/${b.code}.json`]).map((b) => ({ tool, book: b.code }))));

/** Lay the resolved versions over `base` (the pins a new project gets) and give
 * every decision file its §5.2 resource record. A decision file whose tool
 * keeps tC3's own version is stored as it is. One that moves to an installed
 * pin is carried over (D36) against `derived[<tool>/<BOOK>]`, the check list of
 * that pin: records that re-attach are kept, the others are invalidated. */
export function applyVersions(
  bundle: ImportBundle,
  base: ResourcesFile,
  found: Awaited<ReturnType<typeof resolveVersions>>,
  derived: Record<string, CheckItem[]> = {},
): { bundle: ImportBundle; carried: number; invalidated: number } {
  const resources = JSON.parse(JSON.stringify(base)) as ResourcesFile & Record<string, unknown>;
  const flavors = { ...Object.fromEntries(Object.entries(resources.languageSets.primary).map(([k, v]) => [k, (v as ResourcePin).flavor])) } as Record<string, string>;
  for (const [slot, pin] of Object.entries(found)) {
    for (const at of SLOT_PATHS[slot as VersionRequest['slot']]) {
      const keys = at.split('.');
      let node = resources as Record<string, unknown>;
      for (const k of keys.slice(0, -1)) node = (node[k] ??= {}) as Record<string, unknown>;
      const last = keys[keys.length - 1];
      const flavor = (node[last] as ResourcePin | undefined)?.flavor ?? flavors[last] ?? 'scripture/textTranslation';
      node[last] = { repoPath: pin!.repoPath, version: pin!.version, sha: pin!.sha, flavor };
    }
    // D41: the books tC3 checked against this commit are in it — a fact about
    // the commit, so the ladder asks for this pin (fetch, or the guided fix)
    // and does not fall back to English. A later local read widens it (D61).
    const tool = TOOLS.find((x) => x === slot);
    const books = tool ? bundle.books.map((b) => b.code).filter((code) => bundle.sidecars?.[`checking/${tool}/${code}.json`]) : [];
    if (books.length) (resources.languageSets.primary as unknown as Record<string, ResourcePin & { books?: string[] }>)[TOOL_PIN[tool!]].books = books;
  }
  if (bundle.gateway && (found.translationNotes || found.translationWords))
    resources.languageSets.primary = { ...resources.languageSets.primary, gatewayLanguage: bundle.gateway } as typeof resources.languageSets.primary;
  const sidecars: Record<string, unknown> = { ...bundle.sidecars, 'checking/resources.json': resources };
  let carried = 0;
  let invalidated = 0;
  for (const tool of TOOLS) {
    const pin = resources.languageSets.primary[TOOL_PIN[tool] as keyof typeof resources.languageSets.primary] as ResourcePin;
    const resource = { repoPath: pin.repoPath, ...(pin.version ? { version: pin.version } : {}), sha: pin.sha, languageSet: 'primary' };
    for (const { code } of bundle.books) {
      const rel = `checking/${tool}/${code}.json`;
      const file = sidecars[rel] as DecisionFile | undefined;
      if (!file) continue;
      if (found[tool]) {
        sidecars[rel] = { ...file, resource };
        continue;
      }
      const items = derived[`${tool}/${code}`];
      if (!items) throw new Error(`the ${tool} decisions of ${code} move to ${pin.repoPath}, but no check list of it was given`);
      const moved = carryOverDecisions(file, items, resource as Parameters<typeof carryOverDecisions>[2]);
      sidecars[rel] = { ...moved.file, resource };
      carried += moved.carried;
      invalidated += moved.invalidated;
    }
  }
  const decisions = TOOLS.flatMap((tool) => bundle.books.flatMap((b) => ((sidecars[`checking/${tool}/${b.code}.json`] as DecisionFile | undefined)?.decisions ?? []) as unknown as DecisionRecord[]));
  return { bundle: { ...bundle, sidecars, decisions }, carried, invalidated };
}
