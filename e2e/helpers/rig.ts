// Disk-level assertions against the rig's working dir. Journey specs assert what the
// user's actions actually did to the Scripture Burrito repo — bytes and commits on
// disk are the ground truth, never UI state alone.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const TC4_ROOT = path.resolve(HERE, '..', '..', '..');

// Local projects live at repos/_local_/_local_/<name> (PLATFORM-NOTES #18; seed.zsh).
export const RIG_LOCAL_REPOS = path.join(
  TC4_ROOT,
  'dev-env',
  'state',
  'work',
  'repos',
  '_local_',
  '_local_',
);

export const SEEDED_PROJECT = 'sample_burrito';

export function rigRepo(name: string): string {
  return path.join(RIG_LOCAL_REPOS, name);
}

export function listLocalRepos(): string[] {
  if (!fs.existsSync(RIG_LOCAL_REPOS)) return [];
  return fs
    .readdirSync(RIG_LOCAL_REPOS, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

export function readIngredient(repo: string, ipath: string): Buffer {
  return fs.readFileSync(path.join(rigRepo(repo), ipath));
}

export function ingredientExists(repo: string, ipath: string): boolean {
  return fs.existsSync(path.join(rigRepo(repo), ipath));
}

export function commitCount(repo: string): number {
  const out = execFileSync('git', ['-C', rigRepo(repo), 'rev-list', '--count', 'HEAD'], {
    encoding: 'utf8',
  });
  return Number(out.trim());
}

/**
 * Locate the byte span of one verse's TEXT (after the "\v N " marker) inside a
 * chapter of raw USFM. The span runs to the next \v, \c, or EOF — the same
 * splice window the D8 byte-strict editor property is defined over (PRD FR-7).
 */
export function verseTextSpan(
  usfm: string,
  chapter: number,
  verse: number,
): { start: number; end: number } {
  const chapterStart = usfm.indexOf(`\\c ${chapter}`);
  if (chapterStart < 0) throw new Error(`chapter ${chapter} not found`);
  const nextChapter = usfm.indexOf('\\c ', chapterStart + 1);
  const chapterEnd = nextChapter < 0 ? usfm.length : nextChapter;
  const marker = `\\v ${verse} `;
  const markerAt = usfm.indexOf(marker, chapterStart);
  if (markerAt < 0 || markerAt >= chapterEnd)
    throw new Error(`verse ${chapter}:${verse} not found`);
  const start = markerAt + marker.length;
  const nextVerse = usfm.indexOf('\\v ', start);
  let end = chapterEnd;
  if (nextVerse >= 0 && nextVerse < end) end = nextVerse;
  return { start, end };
}

/**
 * D8 / FR-7 byte-strict assertion: given the book bytes before and after an edit
 * to (chapter, verse), every byte outside that verse's text span must be identical.
 * Returns null when byte-strict holds, else a human-readable violation.
 */
export function byteStrictViolation(
  before: Buffer,
  after: Buffer,
  chapter: number,
  verse: number,
): string | null {
  const beforeStr = before.toString('utf8');
  const span = verseTextSpan(beforeStr, chapter, verse);

  // Length of the unchanged common prefix / suffix between the two byte sequences.
  let prefix = 0;
  const maxPrefix = Math.min(before.length, after.length);
  while (prefix < maxPrefix && before[prefix] === after[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < maxPrefix - Math.max(0, prefix - 1) &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  )
    suffix++;

  if (prefix >= before.length && before.length === after.length) return null; // no change at all

  // Byte offsets of the verse text span (beforeStr is utf8; recompute as bytes).
  const spanStartBytes = Buffer.byteLength(beforeStr.slice(0, span.start), 'utf8');
  const spanEndBytes = Buffer.byteLength(beforeStr.slice(0, span.end), 'utf8');

  if (prefix < spanStartBytes)
    return `bytes changed BEFORE the ${chapter}:${verse} span (first diff at byte ${prefix}, span starts at ${spanStartBytes})`;
  if (before.length - suffix > spanEndBytes)
    return `bytes changed AFTER the ${chapter}:${verse} span (last diff at byte ${before.length - suffix}, span ends at ${spanEndBytes})`;
  return null;
}

// ---- Increment 2: installed resources + project pins -------------------------

/** Sideloaded resources live beside local projects, under `_sideloaded_`. */
export const RIG_SIDELOADED_REPOS = path.join(
  TC4_ROOT,
  'dev-env',
  'state',
  'work',
  'repos',
  '_local_',
  '_sideloaded_',
);

export function listSideloaded(): string[] {
  if (!fs.existsSync(RIG_SIDELOADED_REPOS)) return [];
  return fs
    .readdirSync(RIG_SIDELOADED_REPOS, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

export function sideloadedRepo(name: string): string {
  return path.join(RIG_SIDELOADED_REPOS, name);
}

export function sideloadedIngredient(name: string, ipath: string): string {
  return fs.readFileSync(path.join(sideloadedRepo(name), 'ingredients', ipath), 'utf8');
}

/** One §5.3 pin naming an installed resource, read from ITS OWN metadata so the
 * journey never hardcodes a version that the rig may have moved past.
 *
 * `org` overrides the org the export's metadata records. That override is not a
 * convenience: a DCS export names the org AS IT WAS AT EXPORT TIME, so es-419's
 * exports still say `Idiomas-Puentes` — an org that 404s today (PLATFORM-NOTES #30).
 * A pin must name the address the app pins by, which is the configured org. */
export function pinForSideloaded(name: string, version: string, org?: string): {
  repoPath: string;
  version: string;
  sha?: string;
  flavor: string;
} {
  const meta = JSON.parse(
    fs.readFileSync(path.join(sideloadedRepo(name), 'metadata.json'), 'utf8'),
  ) as {
    identification: { primary: { dcs?: Record<string, { revision?: string }> } };
    type?: { flavorType?: { name?: string; flavor?: { name?: string } } };
  };
  const dcsKey = Object.keys(meta.identification.primary.dcs ?? {})[0] ?? '';
  const sha = Object.values(meta.identification.primary.dcs ?? {})[0]?.revision;
  const repoPath = org ? `${org}/${name}` : dcsKey;
  // The REAL flavor from the export's own metadata: the fold refuses a
  // resource.pin.set entry whose flavor is not a non-empty string, so a
  // placeholder '' makes every seeded open fail (found 2026-08-22).
  const flavorType = meta.type?.flavorType;
  const flavor = `${flavorType?.name ?? ''}/${flavorType?.flavor?.name ?? ''}`;
  if (flavor === '/') throw new Error(`sideloaded ${name}: metadata carries no flavorType — cannot build a pin`);
  return {
    repoPath: `git.door43.org/${repoPath}`,
    version,
    ...(sha ? { sha } : {}),
    flavor,
  };
}

/**
 * Write a §5.3 schemaVersion-2 pin file into a project, pointing every helps
 * slot at resources that are installed in the rig. Journeys pin explicitly so
 * a session's readiness is a property of the test, not of whatever the rig
 * happens to hold (D30.3: the project's pins bind every opener).
 */
export function writeProjectPins(
  repo: string,
  pins: {
    tn: { repoPath: string; version: string; sha?: string; flavor: string };
    tw: { repoPath: string; version: string; sha?: string; flavor: string };
    ta: { repoPath: string; version: string; sha?: string; flavor: string };
  },
  opts: { dropResources?: boolean } = {},
): void {
  const set = {
    gatewayLanguage: { languageId: 'en', owner: 'unfoldingWord' },
    translationNotes: pins.tn,
    translationWordsLinks: pins.tw, // D34: one repo serves both tW slots
    translationWords: pins.tw,
    translationAcademy: pins.ta,
  };
  // The §8.8 seed round-trip requires the CHECKPOINT PROJECTION form: empty
  // groups and an empty extraScripture are OMITTED by projectResources, so a
  // hand-written file that spells them out refuses to seed (D56). Write what
  // the app itself would checkpoint.
  const file: Record<string, unknown> = {
    schemaVersion: 2,
    languageSets: { primary: set, fallback: set },
  };
  const dir = path.join(rigRepo(repo), 'ingredients', 'checking');
  // This helper rewrites the WHOLE document, so every top-level field it does
  // not own is carried forward: extraScripture (the ULT/UST source-pane pins)
  // and the resources groups (originalLanguage/lexicon) were both silently
  // dropped, leaving the shared project contaminated after a journey run
  // (issue #123 + the #124 adversarial review). A test that NEEDS the
  // resources groups absent says so explicitly via dropResources.
  const p = path.join(dir, 'resources.json');
  if (fs.existsSync(p)) {
    const existing = JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown>;
    for (const [key, value] of Object.entries(existing)) {
      if (key === 'schemaVersion' || key === 'languageSets') continue;
      if (key === 'resources' && opts.dropResources) continue;
      file[key] = value;
    }
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(file, null, 2)}\n`);
}

/** The project's §5.3 pin file as it stands on disk. */
export function readProjectPins(repo: string): {
  schemaVersion: number;
  languageSets: {
    primary: { gatewayLanguage: { languageId: string; owner: string }; [slot: string]: unknown };
    fallback: { gatewayLanguage: { languageId: string; owner: string }; [slot: string]: unknown };
  };
} {
  const p = path.join(rigRepo(repo), 'ingredients', 'checking', 'resources.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/** The §5.2 decision file a checking session writes, or null when untouched. */
export function readDecisionFile(repo: string, tool: string, book: string): {
  tool: string;
  book: string;
  resource?: { repoPath: string; version: string; languageSet?: string };
  decisions: Array<Record<string, unknown>>;
} | null {
  const p = path.join(rigRepo(repo), 'ingredients', 'checking', tool, `${book}.json`);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/**
 * Restore the seeded project's checking surface to the pristine sample.
 *
 * Journeys share one rig and one seeded project, and several of them mutate it
 * on purpose (J2 drafts a verse; J6 edits the draft out from under a decision).
 * Increment-2 specs therefore reset what they depend on — the book text and the
 * decision sidecars — so each test states its own starting conditions instead
 * of inheriting whatever ran before it.
 */
export function resetSeededChecking(): void {
  const source = path.join(TC4_ROOT, 'sample-burrito', 'ingredients');
  const target = path.join(rigRepo(SEEDED_PROJECT), 'ingredients');
  for (const rel of ['TIT.usfm', 'JON.usfm']) {
    fs.copyFileSync(path.join(source, rel), path.join(target, rel));
  }
  const checkingDst = path.join(target, 'checking');
  fs.rmSync(checkingDst, { recursive: true, force: true });
  fs.cpSync(path.join(source, 'checking'), checkingDst, { recursive: true });
}
