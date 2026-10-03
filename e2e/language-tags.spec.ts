// #461 (D90): language tags at project creation on the pinned server, pankosmia-web
// 0.18.15. A regional tag such as `es-419` is stored whole from the New Bible wizard
// (J1 proves that path), the New Open Bible Stories wizard and an OBS import; an `x-`
// code is stored with its language name; an invalid code is refused with the server's
// reason shown, and no repository is left (PLATFORM-NOTES #43, #28).
//
// The artifact `language-tags.json` records each case's code, outcome and stored
// language. It holds no project name and no time, so every run writes the same file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { test, expect } from './helpers/test';
import { importFixture } from './helpers/import';
import { listLocalRepos, rigRepo } from './helpers/rig';
import { verifyAllJournaledProjects } from './helpers/journal';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OBS_SAMPLE = path.resolve(HERE, '..', 'conformance', 'sample-burrito-obs');
const fresh = (base: string) => `${base} ${Date.now()}`;

type Row = { path: string; code: string; languageName: string | null; outcome: 'created' | 'refused'; tag?: string; name?: string; reason?: string };

/** The language record of the one repository created since `before`, read after
 * Home shows its tile: a reload before the create finishes rolls the create back. */
const createdLanguage = async (page: Page, before: string[]): Promise<{ tag: string; name: string }> => {
  await expect.poll(() => listLocalRepos().filter((r) => !before.includes(r)), { timeout: 30_000 }).toHaveLength(1);
  const repo = listLocalRepos().find((r) => !before.includes(r))!;
  await expect(page.getByTestId(`project-_local_/_local_/${repo}`)).toBeVisible({ timeout: 30_000 });
  const language = JSON.parse(fs.readFileSync(path.join(rigRepo(repo), 'metadata.json'), 'utf8')).languages[0];
  return { tag: language.tag, name: language.name.en };
};

/** From Home: the New Open Bible Stories wizard with this code and language name. */
const createObs = async (page: Page, code: string, languageName: string) => {
  await page.getByTestId('add-project').click();
  await page.getByTestId('add-project-obs').click();
  await page.getByLabel('Project name').fill(fresh('Historias'));
  await page.getByLabel('Language name').fill(languageName);
  await page.getByLabel('Code').fill(code);
  await page.getByRole('button', { name: 'Left to right' }).click();
  await page.getByRole('button', { name: 'Create stories →' }).click();
};

test.describe('#461 — language tags at project creation (pankosmia-web 0.18.15)', () => {
  test(
    'es-419 stays whole from the OBS wizard and an OBS import; an x- code keeps its name; an invalid code is refused with the reason shown and no repository',
    { tag: ['@J20', '@J9'] },
    async ({ page }, testInfo) => {
      const rows: Row[] = [];
      await page.goto('/');

      await test.step('New Open Bible Stories with es_419!: the wizard shows the server refusal, and no repository is left', async () => {
        const before = listLocalRepos();
        await createObs(page, 'es_419!', 'Español');
        const alert = page.getByRole('alert');
        await expect(alert).toContainText("Language code 'es_419!' is not Scripture Burrito schema valid", { timeout: 30_000 });
        // Watch the listing long enough for a late create to show.
        await page.waitForTimeout(2_000);
        expect(listLocalRepos()).toEqual(before);
        rows.push({ path: 'obs-wizard', code: 'es_419!', languageName: 'Español', outcome: 'refused', reason: (await alert.textContent())?.trim() });
        await page.keyboard.press('Escape');
      });

      await test.step('New Open Bible Stories with es-419: stored as es-419, named by the server', async () => {
        await page.goto('/');
        const before = listLocalRepos();
        await createObs(page, 'es-419', 'Español');
        const stored = await createdLanguage(page, before);
        expect(stored).toEqual({ tag: 'es-419', name: 'Spanish (419)' });
        rows.push({ path: 'obs-wizard', code: 'es-419', languageName: 'Español', outcome: 'created', ...stored });
      });

      await test.step('New Open Bible Stories with x-abc and a language name: stored with that name', async () => {
        await page.goto('/');
        const before = listLocalRepos();
        await createObs(page, 'x-abc', 'Abc Language');
        const stored = await createdLanguage(page, before);
        expect(stored).toEqual({ tag: 'x-abc', name: 'Abc Language' });
        rows.push({ path: 'obs-wizard', code: 'x-abc', languageName: 'Abc Language', outcome: 'created', ...stored });
      });

      await test.step('import the OBS Scripture Burrito with es-419: one new project that keeps es-419', async () => {
        await page.goto('/');
        const before = listLocalRepos();
        await importFixture(page, OBS_SAMPLE, { kind: 'burrito', edits: { name: fresh('Muestra OBS'), language: 'es-419' } });
        await expect(page.getByTestId('import-toast')).toBeVisible();
        const stored = await createdLanguage(page, before);
        expect(stored.tag).toBe('es-419');
        rows.push({ path: 'obs-import', code: 'es-419', languageName: null, outcome: 'created', tag: stored.tag });
      });

      await test.step('import the OBS Scripture Burrito with es_419!: the review page refuses it (#437), Import stays off, and no repository is made', async () => {
        await page.goto('/');
        const before = listLocalRepos();
        await importFixture(page, OBS_SAMPLE, { kind: 'burrito', edits: { name: fresh('Rechazo OBS'), language: 'es_419!' }, confirm: false });
        const details = page.getByText('The language code is missing or not valid. Enter it below.');
        await expect(details).toBeVisible();
        await expect(page.getByTestId('import-run')).toBeDisabled();
        expect(listLocalRepos()).toEqual(before);
        rows.push({ path: 'obs-import', code: 'es_419!', languageName: null, outcome: 'refused', reason: (await details.textContent())?.trim() });
      });

      const artifactPath = testInfo.outputPath('language-tags.json');
      fs.writeFileSync(artifactPath, `${JSON.stringify(rows, null, 2)}\n`);
      await testInfo.attach('language-tags.json', { path: artifactPath, contentType: 'application/json' });
    },
  );
});

test.afterAll(async () => {
  await verifyAllJournaledProjects();
});
