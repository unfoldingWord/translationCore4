// J9 — Import existing work as a new project
// docs/JOURNEYS.md J9a–J9d · Increment 8 (#361 shell, #21 tC3, #195 USFM, #196 Burrito, #41 damaged input)
//
// The shell block (#361) proves the import plumbing every parser sits on, with
// the dev-only fake parser (src/data/import/parsers.ts): the screen, the
// all-or-nothing rollback, and the new project on disk. The parser blocks
// (tC3 #21, USFM #195, Scripture Burrito #196, damaged input #41) add their own.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importFixture } from './helpers/import';
import { assertNoRepoCreated, MANIFEST_DIR, readManifest, seedEventsOf } from '../test/helpers/import';
import { lastCommitMessage, rigRepo } from './helpers/rig';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFORMANCE = path.resolve(HERE, '..', 'conformance');
const SAMPLE = path.join(CONFORMANCE, 'sample-burrito');
const git = (repo: string, ...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });

/** Every file under `dir` (outside `.git`) as relative path -> bytes. */
const tree = (dir: string): Map<string, Buffer> => {
  const out = new Map<string, Buffer>();
  const walk = (at: string) => {
    for (const e of fs.readdirSync(at, { withFileTypes: true })) {
      if (e.name === '.git') continue;
      const full = path.join(at, e.name);
      if (e.isDirectory()) walk(full);
      else out.set(path.relative(dir, full).split(path.sep).join('/'), fs.readFileSync(full));
    }
  };
  walk(dir);
  return out;
};

/** A name no earlier run left on the rig: the shell refuses an existing folder. */
const fresh = (base: string) => `${base} ${Date.now()}`;
const abbrOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('tc4.e2e.fakeImport', '1'));
  await page.goto('/');
});

test.describe('J9 — a facilitator imports existing work', () => {
  test.describe('shell', () => {
    test('a two-file drop is one new project; its books are the files, and every seeded event carries seed.source', { tag: ['@inc8', '@J9'] }, async ({ page }) => {
      const name = fresh('Fake import');
      const files = ['TIT', 'JON'].map((b) => path.join(SAMPLE, 'ingredients', `${b}.usfm`));
      await test.step('the review page lists both files as one bundle', async () => {
        await importFixture(page, files, { edits: { name }, confirm: false });
        await expect(page.getByTestId('import-book-TIT')).toBeVisible();
        await expect(page.getByTestId('import-book-JON')).toBeVisible();
        await expect(page.getByTestId('import-damaged')).toHaveCount(0);
      });
      await test.step('Import makes one project; Home shows its card with the Imported badge', async () => {
        await page.getByTestId('import-run').click();
        await expect(page.getByTestId('import-toast')).toBeVisible({ timeout: 60_000 });
        const card = page.getByTestId(`project-_local_/_local_/${abbrOf(name)}`);
        await expect(card).toBeVisible();
        await expect(card.getByTestId('imported-badge')).toBeVisible();
      });
      await test.step('on disk: the books byte-identical, the metadata keeps es-419, the seed journaled with seed.source, one clean commit', async () => {
        const repo = rigRepo(abbrOf(name));
        for (const f of files) expect(fs.readFileSync(path.join(repo, 'ingredients', path.basename(f))).equals(fs.readFileSync(f))).toBe(true);
        const meta = JSON.parse(fs.readFileSync(path.join(repo, 'metadata.json'), 'utf8'));
        expect(meta.languages[0].tag).toBe('es-419');
        // the harness's Stage-1 listing rule: metadata lists exactly the files on disk (.bak undo copies aside)
        const onDisk = [...tree(path.join(repo, 'ingredients')).keys()].filter((rel) => !rel.endsWith('.bak')).map((rel) => `ingredients/${rel}`).sort();
        expect(Object.keys(meta.ingredients).sort()).toEqual(onDisk);
        const ingredients = [...tree(path.join(repo, 'ingredients'))].map(([rel, bytes]) => [rel, bytes.toString('utf8')] as [string, string]);
        const seeded = seedEventsOf(ingredients);
        expect(seeded.filter((e) => e.op === 'book.add').length).toBe(2);
        expect(new Set(seeded.map((e) => e.seed.source))).toEqual(new Set(['sidecar-migration']));
        expect(lastCommitMessage(abbrOf(name))).toBe(`Import ${name} (tC4)`);
        expect(git(repo, 'status', '--porcelain')).toBe('');
      });
    });

    for (const entry of readManifest().filter((e) => e.parser === 'fake' && e.expect === 'accept')) {
      test(`manifest ${JSON.stringify(entry.file)}: a Scripture Burrito is stored as it is — byte for byte, ${entry.language} kept, the harness passes`, { tag: ['@inc8', '@J9'] }, async ({ page }) => {
        const name = fresh('Muestra');
        const source = path.resolve(MANIFEST_DIR, entry.file as string);
        await importFixture(page, source, { edits: { name } });
        await expect(page.getByTestId('import-toast')).toBeVisible();
        const repo = rigRepo(abbrOf(name));
        await test.step('every file of the archive is byte-identical in the new project (remake strips .gitignore by design)', async () => {
          const stored = tree(repo);
          for (const [rel, bytes] of tree(source)) {
            if (rel === '.gitignore') continue;
            expect(stored.get(rel)?.equals(bytes), rel).toBe(true);
          }
          expect(JSON.parse(stored.get('metadata.json')!.toString('utf8')).languages[0].tag).toBe(entry.language);
          for (const [book, chapters] of Object.entries(entry.counts?.chapters ?? {}))
            expect(stored.get(`ingredients/${book}.usfm`)!.toString('utf8').match(/^\\c \d+/gm)?.length).toBe(chapters);
          expect(git(repo, 'status', '--porcelain')).toBe('');
        });
        await test.step('the conformance harness passes on the stored project', async () => {
          const out = execFileSync('node', ['validate.mjs'], { cwd: CONFORMANCE, env: { ...process.env, BURRITO: repo }, encoding: 'utf8' });
          expect(out).toMatch(/\n\d+ passed, 0 failed\n?$/);
        });
      });
    }

    test('refuse: a damaged file is refused on the review page and nothing is written', { tag: ['@inc8', '@J9'] }, async ({ page }) => {
      await assertNoRepoCreated(async () => {
        await importFixture(page, { name: 'TIT-damaged.usfm', mimeType: 'text/plain', buffer: fs.readFileSync(path.join(SAMPLE, 'ingredients', 'TIT.usfm')) }, { confirm: false });
        await expect(page.getByTestId('import-damaged')).toHaveAttribute('data-code', 'import.damaged.truncated');
        await expect(page.getByTestId('import-run')).toBeDisabled();
      });
    });

    test('all or nothing: a write failure after the repository exists removes it and says import.write-failed', { tag: ['@inc8', '@J9'] }, async ({ page }) => {
      await page.route('**/api/burrito/remake_burrito_from_zip/**', (route) => route.fulfill({ status: 500, body: '{"is_good":false,"reason":"injected by the e2e shell block"}' }));
      await assertNoRepoCreated(async () => {
        await importFixture(page, path.join(SAMPLE, 'ingredients', 'TIT.usfm'), { edits: { name: fresh('Falla') } });
        await expect(page.getByTestId('import-failed')).toHaveAttribute('data-code', 'import.write-failed');
      });
    });

    test('a refused create leaves no repository: the create route refuses the primary subtag too', { tag: ['@inc8', '@J9'] }, async ({ page }) => {
      await assertNoRepoCreated(async () => {
        await importFixture(page, path.join(SAMPLE, 'ingredients', 'TIT.usfm'), { edits: { name: fresh('Rechazo'), language: 'qaa' } });
        await expect(page.getByTestId('import-failed')).toHaveAttribute('data-code', 'import.write-failed');
      });
    });
  });
});
