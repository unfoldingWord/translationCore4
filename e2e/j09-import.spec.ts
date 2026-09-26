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
import { unzipSync } from 'fflate';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { checkBurrito, compileSbValidator } from '../src/data/import/burritoCheck.mjs';
import { captureDownload } from './helpers/export';
import { importFixture } from './helpers/import';
import { assertNoRepoCreated, MANIFEST_DIR, readManifest, seedEventsOf, TC3_DCS_TAGS } from '../test/helpers/import';
import { SEEDED_PROJECT, lastCommitMessage, readDecisionFile, readProjectPins, rigRepo } from './helpers/rig';

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

  // The USFM parser (#195, J9c): raw USFM files, no project around them, become
  // a new project whose books are the files byte for byte.
  // The tC3 parser (#21, J9a): a translationCore 3 project zip is one new
  // project with its text, alignments, decisions and resource pins. Every pin
  // has its sha (D82): a version DCS has is pinned as it is; offline, or for a
  // version DCS does not have, the user chooses the installed versions and the
  // decisions carry over (D36).
  test.describe('tC3', () => {
    const TIT = path.join(MANIFEST_DIR, 'tc3', 'cfm_fbt_tit_book.zip');
    const MULTI = ['jhn', 'job', 'luk'].map((b) => path.join(MANIFEST_DIR, 'tc3', 'multi', `en_kjv_${b}_book.zip`));
    const EN_TN_V87 = TC3_DCS_TAGS['git.door43.org/unfoldingWord/en_tn@v87'];
    const setNet = (on: boolean) => fetch(`http://127.0.0.1:19998/api/net/${on ? 'enable' : 'disable'}`, { method: 'POST' });
    const onDisk = (repo: string) => [...tree(path.join(repo, 'ingredients'))].map(([rel, bytes]) => [rel, bytes.toString('utf8')] as [string, string]);
    /** Every repo pin of a resources.json carries its 40-hex sha (D58). */
    const everyPinHasSha = (text: string) => (text.match(/"repoPath"/g) ?? []).length === (text.match(/"sha": "[0-9a-f]{40}"/g) ?? []).length;
    test.afterEach(async () => {
      await setNet(true);
    });

    test('tC3 offline: the review page shows what carries over; Use installed versions moves the decisions (D36); one new project that opens in Translate', { tag: ['@inc8', '@J9'] }, async ({ page }) => {
      test.setTimeout(180_000);
      await setNet(false);
      const name = fresh('Tita tC3');
      const repo = rigRepo(abbrOf(name));
      await test.step('the review page: 46 verses, 0 aligned verses, 5 decisions, 0 contributors, the license from manifest.json', async () => {
        await page.reload();
        await importFixture(page, TIT, { kind: 'tc3', edits: { name }, confirm: false });
        await expect(page.getByTestId('import-book-TIT')).toBeVisible();
        await expect(page.getByTestId('import-damaged')).toHaveCount(0);
        const carried = page.getByTestId('import-carried');
        for (const [k, v] of [['Verses', '46'], ['Alignments', '0 verses'], ['Checking decisions', '5'], ['Contributors', '0']])
          await expect(carried).toContainText(`${k}${v}`);
        await expect(page.getByText('CC BY-SA 4.0', { exact: true })).toBeVisible();
      });
      await test.step('offline: the versions cannot be looked up, so Import waits for a choice', async () => {
        await expect(page.getByTestId('import-resources')).toHaveAttribute('data-state', 'offline');
        await expect(page.getByTestId('import-go-online')).toBeVisible();
        await expect(page.getByTestId('import-run')).toBeDisabled();
        await page.getByTestId('import-use-installed').click();
        await expect(page.getByTestId('import-resources')).toHaveAttribute('data-state', 'installed');
        await expect(page.getByTestId('import-resources')).toContainText(/\d+ decisions carry over\. \d+ decisions must be checked again\./);
        await page.getByTestId('import-run').click();
        await expect(page.getByTestId('import-toast')).toBeVisible({ timeout: 120_000 });
      });
      await test.step('on disk: the book, the sidecars, pins that all have a sha, the license, the seed journaled as tc3-import, one clean commit', async () => {
        expect(fs.readFileSync(path.join(repo, 'ingredients', 'TIT.usfm'), 'utf8').match(/^\\c \d+/gm)).toHaveLength(3);
        for (const rel of ['checking/alignments/TIT.json', 'checking/translationNotes/TIT.json', 'checking/resources.json'])
          expect(fs.existsSync(path.join(repo, 'ingredients', rel)), rel).toBe(true);
        expect(everyPinHasSha(fs.readFileSync(path.join(repo, 'ingredients', 'checking', 'resources.json'), 'utf8'))).toBe(true);
        const meta = JSON.parse(fs.readFileSync(path.join(repo, 'metadata.json'), 'utf8'));
        expect(meta.languages[0].tag).toBe('cfm');
        expect(meta.copyright).toEqual({ shortStatements: [{ statement: 'CC BY-SA 4.0' }] });
        const seeded = seedEventsOf(onDisk(repo));
        expect(new Set(seeded.map((e) => e.seed.source))).toEqual(new Set(['tc3-import']));
        expect(seeded.filter((e) => e.op === 'check.decision.set')).toHaveLength(5);
        expect(seeded.filter((e) => e.op === 'align.verse.set')).toHaveLength(46);
        expect(lastCommitMessage(abbrOf(name))).toBe(`Import ${name} (tC4)`);
        expect(git(repo, 'status', '--porcelain')).toBe('');
      });
      await test.step('the new project opens in Translate at Titus with the imported text', async () => {
        await page.goto('/');
        await page.getByTestId(`project-_local_/_local_/${abbrOf(name)}`).getByRole('button', { name: /Titus/ }).click();
        await expect(page.getByRole('heading', { name: /^Titus \d+$/ })).toBeVisible({ timeout: 120_000 });
        await expect(page.getByText(/Pathian hril mipawlih zumnak/).first()).toBeVisible({ timeout: 60_000 });
        await expect(page.getByTestId('home-open-error')).toHaveCount(0);
      });
    });

    test('tC3 online: each version DCS has is a full pin; the project opens and the guided fix lists the en_tn v87 this computer lacks', { tag: ['@inc8', '@J9'] }, async ({ page }) => {
      test.setTimeout(180_000);
      // The DCS tags listing, answered from the recorded tags (TC3_DCS_TAGS) so the journey does not depend on the network.
      await page.route(/https:\/\/git\.door43\.org\/api\/v1\/repos\/.+\/tags/, async (route) => {
        const url = new URL(route.request().url());
        const repoPath = `git.door43.org/${url.pathname.split('/').slice(4, 6).join('/')}`;
        const tags = url.searchParams.get('page') === '1'
          ? Object.entries(TC3_DCS_TAGS).filter(([k]) => k.startsWith(`${repoPath}@`)).map(([k, sha]) => ({ name: k.split('@')[1], commit: { sha } }))
          : [];
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(tags) });
      });
      const name = fresh('Tita tC3 online');
      const repo = rigRepo(abbrOf(name));
      await test.step('the review page finds the versions; Import needs no choice', async () => {
        await importFixture(page, TIT, { kind: 'tc3', edits: { name }, confirm: false });
        await expect(page.getByTestId('import-resources')).toHaveAttribute('data-state', 'found');
        await expect(page.getByTestId('import-resources')).toContainText('unfoldingWord/en_tn v87');
        await page.getByTestId('import-run').click();
        await expect(page.getByTestId('import-toast')).toBeVisible({ timeout: 120_000 });
      });
      await test.step('on disk: translationNotes is pinned to en_tn v87 by its sha, and the decisions record it', async () => {
        const pins = readProjectPins(abbrOf(name));
        expect(pins.languageSets.primary.translationNotes).toMatchObject({ version: 'v87', sha: EN_TN_V87, books: ['TIT'] });
        expect(readDecisionFile(abbrOf(name), 'translationNotes', 'TIT')!.resource).toMatchObject({ sha: EN_TN_V87, languageSet: 'primary' });
        expect(everyPinHasSha(fs.readFileSync(path.join(repo, 'ingredients', 'checking', 'resources.json'), 'utf8'))).toBe(true);
      });
      await test.step('offline, Check offers the guided fix for the pinned en_tn v87', async () => {
        await setNet(false);
        await page.goto('/');
        await page.getByTestId(`project-_local_/_local_/${abbrOf(name)}`).getByRole('button', { name: /Titus/ }).click();
        await page.getByRole('tab', { name: 'Check', exact: true }).click();
        const card = page.getByTestId('preflight-translationNotes');
        await expect(card).toHaveAttribute('data-state', 'unavailable', { timeout: 60_000 });
        await card.getByTestId('fix-translationNotes').click();
        const screen = page.getByTestId('guided-fix');
        await expect(screen).toBeVisible();
        await expect(screen.getByTestId('fix-pin')).toContainText(EN_TN_V87);
      });
    });

    test('tC3 multi-zip: three books of one language are one project; the license is chosen on the review page', { tag: ['@inc8', '@J9'] }, async ({ page }) => {
      test.setTimeout(300_000);
      await setNet(false);
      const name = fresh('KJV tC3');
      const repo = rigRepo(abbrOf(name));
      await page.reload();
      await importFixture(page, MULTI, { kind: 'tc3', edits: { name }, confirm: false });
      for (const code of ['JHN', 'JOB', 'LUK']) await expect(page.getByTestId(`import-book-${code}`)).toBeVisible();
      await expect(page.getByTestId('import-damaged')).toHaveCount(0);
      await page.getByTestId('import-use-installed').click();
      await expect(page.getByTestId('import-resources')).toHaveAttribute('data-state', 'installed', { timeout: 60_000 });
      // the files disagree (CC BY-SA 4.0, CC0 1.0): Import waits for the choice
      await expect(page.getByTestId('import-run')).toBeDisabled();
      await page.getByTestId('import-license').selectOption('CC0 1.0 Public Domain');
      await page.getByTestId('import-run').click();
      await expect(page.getByTestId('import-toast')).toBeVisible({ timeout: 240_000 });
      const meta = JSON.parse(fs.readFileSync(path.join(repo, 'metadata.json'), 'utf8'));
      expect(meta.copyright).toEqual({ shortStatements: [{ statement: 'CC0 1.0 Public Domain' }] });
      for (const code of ['JHN', 'JOB', 'LUK']) expect(fs.existsSync(path.join(repo, 'ingredients', `${code}.usfm`)), code).toBe(true);
      expect(new Set(seedEventsOf(onDisk(repo)).map((e) => e.seed.source))).toEqual(new Set(['tc3-import']));
      expect(git(repo, 'status', '--porcelain')).toBe('');
    });
  });

  test.describe('USFM', () => {
    test('USFM: one file is one new project — the book byte-identical, the harness format checks pass, it opens in Translate', { tag: ['@inc8', '@J9'] }, async ({ page }) => {
      const name = fresh('Tito USFM');
      const source = path.join(MANIFEST_DIR, 'usfm', '57-TIT.usfm');
      const repo = rigRepo(abbrOf(name));
      await test.step('the review page finds Titus, and the license check says CC BY-SA 4.0 will be applied', async () => {
        await importFixture(page, source, { kind: 'usfm', edits: { name, language: 'es-419' }, confirm: false });
        await expect(page.getByTestId('import-book-TIT')).toBeVisible();
        await expect(page.getByTestId('import-damaged')).toHaveCount(0);
        await expect(page.getByText('No license was found. CC BY-SA 4.0 will be applied.')).toBeVisible();
        await page.getByTestId('import-run').click();
        await expect(page.getByTestId('import-toast')).toBeVisible({ timeout: 60_000 });
      });
      await test.step('on disk: the book byte-identical, es-419 kept, the seed journaled with seed.source, one clean commit', async () => {
        expect(fs.readFileSync(path.join(repo, 'ingredients', 'TIT.usfm')).equals(fs.readFileSync(source))).toBe(true);
        expect(JSON.parse(fs.readFileSync(path.join(repo, 'metadata.json'), 'utf8')).languages[0].tag).toBe('es-419');
        const ingredients = [...tree(path.join(repo, 'ingredients'))].map(([rel, bytes]) => [rel, bytes.toString('utf8')] as [string, string]);
        const seeded = seedEventsOf(ingredients);
        expect(seeded.filter((e) => e.op === 'book.add').length).toBe(1);
        expect(new Set(seeded.map((e) => e.seed.source))).toEqual(new Set(['sidecar-migration']));
        expect(lastCommitMessage(abbrOf(name))).toBe(`Import ${name} (tC4)`);
        expect(git(repo, 'status', '--porcelain')).toBe('');
      });
      await test.step("the harness's project-format checks pass on the stored project: schema, md5 and size, the exact listing", async () => {
        // validate.mjs as a whole proves the sample (its Titus verse counts, its
        // alignment sidecars); its Stage-1 format checks are burritoCheck.mjs.
        const schemaRoot = path.join(CONFORMANCE, 'sb-schema');
        const schemas = [...tree(schemaRoot)].filter(([rel]) => rel.endsWith('.json')).map(([rel, bytes]) => [rel, bytes.toString('utf8')] as [string, string]);
        const stored = Object.fromEntries([...tree(repo)].map(([rel, bytes]) => [rel, new Uint8Array(bytes)]));
        expect(checkBurrito(stored, compileSbValidator(Ajv, addFormats, schemas)!).failures).toEqual([]);
        const meta = JSON.parse(fs.readFileSync(path.join(repo, 'metadata.json'), 'utf8'));
        const onDisk = [...tree(path.join(repo, 'ingredients')).keys()].filter((rel) => !rel.endsWith('.bak')).map((rel) => `ingredients/${rel}`).sort();
        expect(Object.keys(meta.ingredients).sort()).toEqual(onDisk);
      });
      await test.step('the new project opens in Translate at Titus with the imported text', async () => {
        await page.goto('/');
        await page.getByTestId(`project-_local_/_local_/${abbrOf(name)}`).getByRole('button', { name: /Titus/ }).click();
        await expect(page.getByRole('heading', { name: /^Titus \d+$/ })).toBeVisible({ timeout: 120_000 });
        const translate = page.getByRole('tab', { name: 'Translate', exact: true });
        if ((await translate.getAttribute('aria-selected')) !== 'true') await translate.click();
        await expect(translate).toHaveAttribute('aria-selected', 'true');
        await expect(page.getByText(/Pablo, siervo de Dios y apóstol de Jesucristo/).first()).toBeVisible({ timeout: 60_000 });
        await expect(page.getByTestId('home-open-error')).toHaveCount(0);
      });
    });

    test('USFM refuse: a file with no \\id line is import.damaged.usfm-parse on the review page, and nothing is written', { tag: ['@inc8', '@J9'] }, async ({ page }) => {
      await assertNoRepoCreated(async () => {
        await importFixture(page, path.join(MANIFEST_DIR, 'usfm', 'no-id.sfm'), { kind: 'usfm', confirm: false });
        await expect(page.getByTestId('import-damaged')).toHaveAttribute('data-code', 'import.damaged.usfm-parse');
        await expect(page.getByTestId('import-run')).toBeDisabled();
      });
    });
  });

  // The Scripture Burrito parser (#196, J9d): a tC4 export (#359) comes back as
  // a new project through platform routes only, stored as it is (D80 point 2).
  test.describe('Scripture Burrito', () => {
    test('Scripture Burrito: export then import — text, checking/ and the journal byte-identical; the copy opens with no finding and no new seed event', { tag: ['@inc8', '@J9'] }, async ({ page }) => {
      const source = rigRepo(SEEDED_PROJECT);
      let exported: Record<string, Uint8Array> = {};
      let download: { bytes: Buffer; filename: string } = { bytes: Buffer.alloc(0), filename: '' };
      await test.step('export the seeded project as a Scripture Burrito zip (its first open seeds the journal)', async () => {
        await page.getByTestId(`project-_local_/_local_/${SEEDED_PROJECT}`).getByRole('button', { name: /Titus/ }).click();
        await page.getByRole('tab', { name: 'Check', exact: true }).click();
        await page.getByTestId('open-community-checking').click();
        await expect.poll(() => git(source, 'status', '--porcelain'), { timeout: 20_000 }).toBe('');
        await page.getByTestId('export-menu-trigger').click();
        download = await captureDownload(page, page.getByRole('menuitem', { name: 'Scripture Burrito (.zip)' }));
        exported = Object.fromEntries(Object.entries(unzipSync(new Uint8Array(download.bytes))).filter(([rel]) => !rel.endsWith('/')));
        expect(Object.keys(exported).some((rel) => rel.startsWith('ingredients/checking/journal/'))).toBe(true);
      });
      const name = fresh('Exportación');
      const repo = rigRepo(abbrOf(name));
      await test.step('import the zip as a Scripture Burrito: the review page carries the tC4 records', async () => {
        await page.goto('/');
        await importFixture(page, { name: download.filename, mimeType: 'application/zip', buffer: download.bytes }, { kind: 'burrito', edits: { name }, confirm: false });
        await expect(page.getByTestId('import-carried')).toBeVisible();
        await expect(page.getByTestId('import-damaged')).toHaveCount(0);
        await page.getByTestId('import-run').click();
        await expect(page.getByTestId('import-toast')).toBeVisible({ timeout: 60_000 });
      });
      const seedsBefore = seedEventsOf([...tree(path.join(repo, 'ingredients'))].map(([rel, bytes]) => [rel, bytes.toString('utf8')] as [string, string])).length;
      expect(seedsBefore).toBeGreaterThan(0); // the export's own seed, so an equal count after the open is not vacuous
      await test.step('on disk: every exported file byte-identical — the books, checking/ and the journal (remake strips .gitignore)', async () => {
        const stored = tree(repo);
        for (const [rel, bytes] of Object.entries(exported)) {
          if (rel === '.gitignore') continue;
          expect(stored.get(rel)?.equals(Buffer.from(bytes)), rel).toBe(true);
        }
        for (const book of ['TIT', 'JON']) expect(stored.get(`ingredients/${book}.usfm`)!.equals(fs.readFileSync(path.join(source, 'ingredients', `${book}.usfm`)))).toBe(true);
        expect(git(repo, 'status', '--porcelain')).toBe('');
      });
      await test.step('the copy opens with no open-time finding and no new seed event; checking/ and the journal are unchanged', async () => {
        await page.goto('/');
        await page.getByTestId(`project-_local_/_local_/${abbrOf(name)}`).getByRole('button', { name: /Titus/ }).click();
        await expect(page.getByRole('tab', { name: 'Check', exact: true })).toBeVisible(); // shown after store.open resolves
        await expect(page.getByTestId('home-open-error')).toHaveCount(0);
        const stored = tree(repo);
        const journal = Object.entries(exported).filter(([rel]) => rel.startsWith('ingredients/checking/journal/'));
        for (const [rel, bytes] of journal) expect(stored.get(rel)?.equals(Buffer.from(bytes)), rel).toBe(true);
        const after = [...stored].filter(([rel]) => rel.startsWith('ingredients/')).map(([rel, bytes]) => [rel.slice('ingredients/'.length), bytes.toString('utf8')] as [string, string]);
        expect(seedEventsOf(after).length).toBe(seedsBefore);
      });
    });
  });
});
