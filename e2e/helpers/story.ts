// OBS journey helpers (J21, J22, J25 — docs/JOURNEYS.md, D74; issue #292). A story
// journey creates its own OBS project through the store in node against the live rig
// (the class the app runs, as J20 drafts through it), then drives the app on it, then
// reads the story file and the journal on disk. Bytes on disk are the ground truth.
import fs from 'node:fs';
import path from 'node:path';
import { rigRepo } from './rig';
import { storyIpath } from '../../journal/story.mjs';

export const RIG_API = 'http://127.0.0.1:19998/api';

/** Create an OBS project on the rig through the store, optionally drafting into it
 * first (a J21 precondition for J22). Returns the local repository name. */
export async function createObsProject(
  abbr: string,
  name: string,
  draft?: (store: { writeFrame: (story: number, frame: number, text: string) => Promise<void> }) => Promise<void>,
): Promise<string> {
  const { JournalingStore } = await import('../../src/data/journal/journalingStore');
  const { ServerApi } = await import('../../src/data/serverApi');
  const { memKv } = await import('../../test/helpers/journalingRig');
  const { INSTALLED_SUITE } = await import('../../src/data/installedSuite');
  const store = new JournalingStore({ api: new ServerApi({ baseUrl: RIG_API }), kv: memKv() });
  const repo = `${abbr}_${Date.now()}`;
  const { repoPath } = await store.createObsProject({ content_name: name, content_abbr: repo, content_language_code: 'es' });
  await store.open(repoPath);
  // What the app's New Open Bible Stories writes after the create (state.jsx createObs;
  // J20 proves that path): the bundled English suite, which carries the OBS members
  // (#288, D75), and the language settings the platform does not record.
  await store.writeResources(INSTALLED_SUITE, null);
  await store.writeSettings({ schemaVersion: 1, checkingLanguage: 'en', textDirection: 'ltr', textFont: null, languageName: 'Español' }, null);
  if (draft) await draft(store);
  await store.commit('Project created (journey precondition)');
  store.dispose();
  return repo;
}

/** The bytes of one story file as the working tree holds them. */
export function storyBytes(repo: string, story: number): string {
  return fs.readFileSync(path.join(rigRepo(repo), 'ingredients', storyIpath(story)), 'utf8');
}

/** The project's journal segment files (every actor), sorted. */
export function segmentFiles(repo: string): string[] {
  const journal = path.join(rigRepo(repo), 'ingredients', 'checking', 'journal');
  if (!fs.existsSync(journal)) return [];
  return fs
    .readdirSync(journal)
    .flatMap((actor) => {
      const dir = path.join(journal, actor, 'segments');
      return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.action.json')).map((f) => path.join(dir, f)) : [];
    })
    .sort();
}

export type SegmentEvent = { op: string } & Record<string, unknown>;

/** The events of one segment file (the §8.1 container: `body` is the JSON text of `{ events }`). */
export function readSegmentEvents(file: string): SegmentEvent[] {
  const container = JSON.parse(fs.readFileSync(file, 'utf8')) as { body: string };
  return (JSON.parse(container.body) as { events: SegmentEvent[] }).events;
}

/** The segments added since `before`, each with its events — the poll target of "one
 * segment per save": exactly one new file holding exactly one event. */
export function newSegments(repo: string, before: Set<string>): SegmentEvent[][] {
  return segmentFiles(repo).filter((f) => !before.has(f)).map(readSegmentEvents);
}

const IMAGE_RE = /^!\[[^\]]*\]\([^)]*\)$/;
const REF_RE = /^_[^\n]*_$/;

/** The byte span of one frame's paragraph region: from the end of the frame's image
 * line (its newline included) to the start of the next image line, the reference line,
 * or the end of the file. Everything outside is another frame, the title, or the
 * reference — bytes a frame write MUST NOT touch (R-10.3.4). Computed from the image
 * lines alone, independently of the app's writer. */
export function frameSpan(bytes: string, frame: number): { start: number; end: number } {
  const lines = bytes.split('\n');
  let seen = 0;
  let offset = 0;
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const lineEnd = offset + lines[i].length + 1; // past this line's newline
    if (start >= 0 && (IMAGE_RE.test(lines[i]) || REF_RE.test(lines[i]))) return { start, end: offset };
    if (IMAGE_RE.test(lines[i]) && ++seen === frame) start = lineEnd;
    offset = lineEnd;
  }
  if (start < 0) throw new Error(`frame ${frame}: no image line`);
  return { start, end: bytes.length };
}

/** Null when `after` differs from `before` only inside the frame's region. */
export function outsideFrameViolation(before: string, after: string, frame: number): string | null {
  const { start, end } = frameSpan(before, frame);
  if (!after.startsWith(before.slice(0, start))) return `bytes before frame ${frame} changed`;
  if (!after.endsWith(before.slice(end))) return `bytes after frame ${frame} changed`;
  return null;
}

/** Null when `after` differs from `before` only in the first line (the `# N.` title). */
export function outsideTitleViolation(before: string, after: string): string | null {
  const b = before.split('\n');
  const a = after.split('\n');
  return b.slice(1).join('\n') === a.slice(1).join('\n') ? null : 'bytes after the title line changed';
}

const stripTrailingBlank = (lines: string[]): string[] => {
  const out = [...lines];
  while (out.length && out[out.length - 1].trim() === '') out.pop();
  return out;
};

/** Null when `after` is `before` plus the closing `_…_` line (with its trailing
 * newline): a reference write changes nothing but the trailing region of the file. */
export function outsideRefViolation(before: string, after: string): string | null {
  const b = stripTrailingBlank(before.split('\n'));
  const a = stripTrailingBlank(after.split('\n'));
  const last = a.pop();
  if (last === undefined || !REF_RE.test(last)) return 'the file does not end in a reference line';
  return stripTrailingBlank(a).join('\n') === b.join('\n') ? null : 'bytes before the reference line changed';
}
