// Packaged OBS lifecycle smoke entry. This is bundled into the artifact and
// runs the same JournalingStore used by the desktop client, rather than making
// raw ingredient writes. It is intentionally independent of the HTTP-only
// smoke-api probe: #347 must fail before a client can mask a stale template.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ServerApi } from '../src/data/serverApi';
import { JournalingStore } from '../src/data/journal/journalingStore';
import { verifyProjectAgainstJournal, describeVerifierReport } from '../src/data/journal/verify';
import { INSTALLED_SUITE } from '../src/data/installedSuite';
import { seedStory } from '../journal/story.mjs';

const [base, abbr, marker, storeDir] = process.argv.slice(2);
if (!base || !abbr || !marker || !storeDir) throw new Error('usage: smoke-journal <api> <abbr> <marker> <storeDir>');

const kvMap = new Map<string, string>();
const kv = {
  get: async (key: string) => kvMap.get(key),
  set: async (key: string, value: string) => { kvMap.set(key, value); },
  setIfAbsent: async (key: string, value: string) => {
    const found = kvMap.get(key);
    if (found !== undefined) return found;
    kvMap.set(key, value);
    return value;
  },
  keys: async (prefix: string) => [...kvMap.keys()].filter((key) => key.startsWith(prefix)),
  delete: async (key: string) => { kvMap.delete(key); },
};

const repoAbbr = `${abbr}clientobs`;
const repoPath = `_local_/_local_/${repoAbbr}`;
const storyPath = (number: number) => `content/${String(number).padStart(2, '0')}.md`;
const repoDir = path.join(storeDir, ...repoPath.split('/'));
const storyFile = (number: number) => path.join(repoDir, 'ingredients', storyPath(number));
const committed = (number: number): Buffer => execFileSync('git', ['-C', repoDir, 'show', `HEAD:ingredients/${storyPath(number)}`]);
const failIfDifferent = (number: number, expected: Buffer, actual: Buffer, surface: string): void => {
  if (!actual.equals(expected)) throw new Error(`${surface} ${storyPath(number)} differs from the expected bytes`);
};
const outsideFirstFrameViolation = (before: string, after: string): string | null => {
  const imageLine = /^!\[[^\]]*\]\([^)]*\)$/;
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  const beforeImages = beforeLines.flatMap((line, index) => imageLine.test(line) ? [index] : []);
  const afterImages = afterLines.flatMap((line, index) => imageLine.test(line) ? [index] : []);
  if (beforeImages.length < 2) return 'seed has no second frame';
  if (afterImages.length !== beforeImages.length) return 'frame image boundaries changed';
  // Frame 1 is the region after image 1 and before image 2. Compare the exact
  // line sequences on both sides so the assertion covers every unrelated byte,
  // including the title, image lines, trailing blanks, and later frames.
  if (beforeLines.slice(0, beforeImages[0] + 1).join('\n') !== afterLines.slice(0, afterImages[0] + 1).join('\n'))
    return 'bytes before frame 1 changed';
  if (beforeLines.slice(beforeImages[1]).join('\n') !== afterLines.slice(afterImages[1]).join('\n'))
    return 'bytes after frame 1 changed';
  return null;
};

const main = async (): Promise<void> => {
  const api = new ServerApi({ baseUrl: base });
  const store = new JournalingStore({ api, kv });
  let created = false;
  try {
  // Negative control first: this path must be absent before the client creates it.
    if ((await api.listLocalRepos()).includes(repoPath)) throw new Error(`negative control failed: ${repoPath} already exists`);
    const createdProject = await store.createObsProject({ content_name: 'tC4 real client smoke', content_abbr: repoAbbr, content_language_code: 'fr' });
    created = true;
    if (createdProject.repoPath !== repoPath) throw new Error(`client created ${createdProject.repoPath}, expected ${repoPath}`);

  // This is the production path: open, seed the installed suite/settings, and
  // checkpoint through JournalingStore (not direct /ingredient/raw writes).
    await store.open(repoPath);
    await store.writeResources(INSTALLED_SUITE as never, null);
    await store.writeSettings({ schemaVersion: 1, checkingLanguage: 'en', textDirection: 'ltr', textFont: null, languageName: 'Français' }, null);

    for (let number = 1; number <= 50; number += 1) {
      const template = fs.readFileSync(path.join(__dirname, 'lib', 'templates', 'content_templates', 'text_stories', 'ingredients', storyPath(number)));
      const expected = Buffer.from(seedStory(template.toString('utf8')), 'utf8');
      const actual = Buffer.from((await store.readStory(number)).bytes, 'utf8');
      failIfDifferent(number, expected, actual, 'HTTP/client');
      failIfDifferent(number, expected, fs.readFileSync(storyFile(number)), 'disk');
      failIfDifferent(number, expected, committed(number), 'Git HEAD');
    }
    const homeProjects = await store.listProjects();
    if (!homeProjects.some((project) => project.id === repoPath && project.flavor === 'textStories'))
      throw new Error(`Home did not list ${repoPath} as an OBS project`);

    const beforeEdit = (await store.readStory(1)).bytes;
    await store.writeFrame(1, 1, marker);
    await store.commit('Packaged real-client smoke checkpoint');
    const edited = Buffer.from((await store.readStory(1)).bytes, 'utf8');
    if (!edited.toString('utf8').includes(marker)) throw new Error('JournalingStore frame edit did not read back');
    const outside = outsideFirstFrameViolation(beforeEdit, edited.toString('utf8'));
    if (outside) throw new Error(`JournalingStore frame edit changed unrelated bytes: ${outside}`);
    failIfDifferent(1, edited, fs.readFileSync(storyFile(1)), 'disk after edit');
    failIfDifferent(1, edited, committed(1), 'Git HEAD after edit');
    for (let number = 2; number <= 50; number += 1) {
      const template = fs.readFileSync(path.join(__dirname, 'lib', 'templates', 'content_templates', 'text_stories', 'ingredients', storyPath(number)));
      const expected = Buffer.from(seedStory(template.toString('utf8')), 'utf8');
      failIfDifferent(number, expected, Buffer.from((await store.readStory(number)).bytes, 'utf8'), 'HTTP/client after edit');
      failIfDifferent(number, expected, fs.readFileSync(storyFile(number)), 'disk after edit');
      failIfDifferent(number, expected, committed(number), 'Git HEAD after edit');
    }
    const report = await verifyProjectAgainstJournal(api, repoPath);
    if (!report.ok) throw new Error(describeVerifierReport(report));

  // Simulate a reopen in a new store instance (the same lifecycle as a restart).
    store.dispose();
    const reopened = new JournalingStore({ api, kv });
    try {
      await reopened.open(repoPath);
      const reopenedStory = Buffer.from((await reopened.readStory(1)).bytes, 'utf8');
      failIfDifferent(1, edited, reopenedStory, 'reopened client');
      const reopenedReport = await verifyProjectAgainstJournal(api, repoPath);
      if (!reopenedReport.ok) throw new Error(describeVerifierReport(reopenedReport));
    } finally {
      reopened.dispose();
    }
    console.log(`ok OBS real-client lifecycle: ${repoPath} seeded, listed on Home, edited, checkpointed, reopened, and journal-verified`);
  } finally {
    if (created) await api.deleteRepo(repoPath).catch(() => {});
    store.dispose();
  }
};

main().catch((error: unknown) => {
  console.error(`FAIL OBS real-client lifecycle: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
