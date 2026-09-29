// The story Markdown producer (issue #360): the server's zip of an OBS
// repository → a zip of `content/` exactly as stored, byte for byte.
import { describe, expect, it, vi } from 'vitest';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { OBS_MARKDOWN, storyMarkdownFromRepoZip } from '../../src/data/export/obsMarkdown';
import type { BurritoStore, ProjectSummary } from '../../src/data/burritoStore';

const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');

const SAMPLE = path.resolve(__dirname, '../../conformance/sample-burrito-obs');

/** Every file under `dir`, as repository-relative path → bytes. */
const filesUnder = (dir: string): Record<string, Uint8Array> =>
  Object.fromEntries(
    (fs.readdirSync(path.join(SAMPLE, dir), { recursive: true }) as string[])
      .map((name) => `${dir}/${name.split(path.sep).join('/')}`)
      .filter((name) => fs.statSync(path.join(SAMPLE, name)).isFile())
      .map((name) => [name, new Uint8Array(fs.readFileSync(path.join(SAMPLE, name)))]),
  );

/** The sample OBS repository's zip entries, the way the server names them: directory entries, `.git/`, backups, Finder files. */
const serverEntries = () => ({
  '.git/HEAD': strToU8('ref: refs/heads/main\n'),
  'metadata.json': new Uint8Array(fs.readFileSync(path.join(SAMPLE, 'metadata.json'))),
  'ingredients/': new Uint8Array(0),
  'ingredients/content/': new Uint8Array(0),
  'ingredients/content/01.md.bak': strToU8('old'),
  'ingredients/content/.DS_Store': strToU8('finder'),
  ...filesUnder('ingredients'),
});

const serverZip = () => zipSync(serverEntries());

/** The same zip the way the Windows server names it (#425, PLATFORM-NOTES note 41): `\` in every entry name. */
const windowsServerZip = () => zipSync(Object.fromEntries(Object.entries(serverEntries()).map(([name, bytes]) => [name.replaceAll('/', '\\'), bytes])));

describe('storyMarkdownFromRepoZip', () => {
  it('holds every file of content/, byte-identical, and nothing else', () => {
    const stored = filesUnder('ingredients/content');
    const out = unzipSync(storyMarkdownFromRepoZip(serverZip()));
    expect(Object.keys(out).sort()).toEqual(Object.keys(stored).map((name) => name.slice('ingredients/'.length)).sort());
    expect(Object.keys(out)).toContain('content/50.md');
    for (const [name, bytes] of Object.entries(stored)) expect(Buffer.from(out[name.slice('ingredients/'.length)]).equals(Buffer.from(bytes))).toBe(true);
  });

  it('a Windows server zip (`\\` entry names, #425) gives the same export, not an empty zip', () => {
    const expected = unzipSync(storyMarkdownFromRepoZip(serverZip()));
    const out = unzipSync(storyMarkdownFromRepoZip(windowsServerZip()));
    expect(Object.keys(out).sort()).toEqual(Object.keys(expected).sort());
    expect(Object.keys(out).length).toBeGreaterThan(0);
    for (const [name, bytes] of Object.entries(expected)) expect(Buffer.from(out[name]).equals(Buffer.from(bytes))).toBe(true);
  });
});

describe('the story Markdown producer', () => {
  const obs = { name: 'Equipo', flavor: 'textStories' } as ProjectSummary;

  it('shows for an OBS project only', () => {
    expect(OBS_MARKDOWN.label).toBe('Story Markdown (.zip)');
    expect(OBS_MARKDOWN.appliesTo(obs)).toBe(true);
    expect(OBS_MARKDOWN.appliesTo({ ...obs, flavor: 'textTranslation' })).toBe(false);
  });

  it('reads the zipped repository and names the file <project>-stories-<date>.zip', async () => {
    const store = { readZipped: vi.fn(async () => serverZip()) } as unknown as BurritoStore;
    const file = await OBS_MARKDOWN.produce({ store, project: obs });
    expect(file.filename).toMatch(/^Equipo-stories-\d{4}-\d{2}-\d{2}\.zip$/);
    expect(file.mime).toBe('application/zip');
    expect(Object.keys(unzipSync(file.bytes)).every((name) => name.startsWith('content/'))).toBe(true);
  });
});
