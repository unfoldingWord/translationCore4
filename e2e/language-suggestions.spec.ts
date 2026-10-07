// #492: the Language name field of New Bible and New Open Bible Stories suggests
// languages from the Door43 list that ships with the app (src/data/langnames.json).
// A choice fills the name, the Code box and the text direction, and all three stay
// editable. A name and a code that are not in the list still create a project. Import
// review and Project settings keep their plain fields.
//
// Every language below is a row of the shipped list, read here from the same file the
// app reads. `ug` (Uyghur) is in the list and not in the server's own table
// (pankosmia-web 0.18.15, PLATFORM-NOTES #43): the server refuses it, and the dialog
// then names the private-use code `x-ug`.
//
// The artifact `language-suggestions.json` records each query's first suggestions and
// each created project's stored language. It holds no project name and no time, so
// every run writes the same file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page, TestInfo } from '@playwright/test';
import { test, expect } from './helpers/test';
import { importFixture } from './helpers/import';
import { listLocalRepos, rigRepo } from './helpers/rig';
import { verifyAllJournaledProjects } from './helpers/journal';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OBS_SAMPLE = path.resolve(HERE, '..', 'conformance', 'sample-burrito-obs');
const fresh = (base: string) => `${base} ${Date.now()}`;

type Language = { lc: string; ang: string; ln: string; ld: 'ltr' | 'rtl' };
const LIST: Language[] = JSON.parse(fs.readFileSync(path.resolve(HERE, '..', 'src', 'data', 'langnames.json'), 'utf8'));
const language = (code: string): Language => {
  const row = LIST.find((l) => l.lc === code);
  if (!row) throw new Error(`${code} is not in src/data/langnames.json`);
  return row;
};
/** A suggestion row as the user reads it: the anglicized name, the language's
 * own name when it differs, the code. */
const rowText = (code: string): string => {
  const { ang, ln, lc } = language(code);
  const name = ang || ln;
  return `${name}${ln !== name ? ln : ''}${lc}`;
};

type Row =
  | { dialog: string; query: string; suggestions: string[] }
  | { dialog: string; chosen: string; name: string; code: string; direction: string }
  | { dialog: string; code: string; outcome: 'created' | 'refused'; tag?: string; name?: string; languageName?: string | null; textDirection?: string; reason?: string };

const nameField = (page: Page) => page.getByLabel('Language name');
const codeField = (page: Page) => page.getByLabel('Code');
const selectedDirection = async (page: Page): Promise<string> =>
  (await page.getByRole('button', { name: 'Right to left' }).getAttribute('data-selected')) === 'true' ? 'rtl' : 'ltr';

/** Type `query` in Language name; the first suggestions are the rows of `expected`, in order. */
const suggest = async (page: Page, query: string, expected: string[]): Promise<string[]> => {
  await nameField(page).fill(query);
  const options = page.getByRole('option');
  for (const [i, code] of expected.entries()) await expect(options.nth(i)).toHaveText(rowText(code));
  return expected.map(rowText);
};

/** What the one repository created since `before` stores about its language. */
const stored = async (page: Page, before: string[]) => {
  await expect.poll(() => listLocalRepos().filter((r) => !before.includes(r)), { timeout: 30_000 }).toHaveLength(1);
  const repo = listLocalRepos().find((r) => !before.includes(r))!;
  await expect(page.getByTestId(`project-_local_/_local_/${repo}`)).toBeVisible({ timeout: 30_000 });
  const metadata = JSON.parse(fs.readFileSync(path.join(rigRepo(repo), 'metadata.json'), 'utf8')).languages[0];
  const settings = JSON.parse(fs.readFileSync(path.join(rigRepo(repo), 'ingredients', 'checking', 'settings.json'), 'utf8'));
  return {
    repo,
    kept: {
      tag: metadata.tag as string,
      name: metadata.name.en as string,
      languageName: settings.languageName as string | null,
      textDirection: settings.textDirection as string,
    },
  };
};

const save = async (testInfo: TestInfo, rows: Row[]) => {
  const artifactPath = testInfo.outputPath('language-suggestions.json');
  fs.writeFileSync(artifactPath, `${JSON.stringify(rows, null, 2)}\n`);
  await testInfo.attach('language-suggestions.json', { path: artifactPath, contentType: 'application/json' });
};

test.describe('#492 — language suggestions from the shipped Door43 list', () => {
  test(
    'New Bible, with the internet off: Hausa is suggested and fills name, code and direction; the keyboard works; the code and the direction stay the user\'s; Project settings keeps its plain field',
    { tag: ['@J1'] },
    async ({ page, context }, testInfo) => {
      const rows: Row[] = [];
      // The list ships with the app: every request that leaves this machine fails.
      const listRequests: string[] = [];
      page.on('request', (request) => {
        const url = new URL(request.url());
        if (!['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname.includes('langnames')) listRequests.push(request.url());
      });
      await context.route((url) => url.protocol.startsWith('http') && !['localhost', '127.0.0.1'].includes(url.hostname), (route) => route.abort());
      const before = listLocalRepos();

      await page.goto('/');
      await page.getByTestId('add-project').click();
      await page.getByTestId('add-project-bible').click();
      await page.getByLabel('Bible name').fill(fresh('Sugerencias'));

      await test.step('negative control: text that matches no language shows no list', async () => {
        await nameField(page).fill('zzzzqqq');
        await expect(page.getByRole('listbox')).toHaveCount(0);
      });

      await test.step('"Hausa" offers Hausa (ha) first, with its own name and its code', async () => {
        rows.push({ dialog: 'new-bible', query: 'Hausa', suggestions: await suggest(page, 'Hausa', ['ha', 'hsl']) });
      });

      await test.step('Esc closes the list and changes neither box; the dialog stays open', async () => {
        await page.keyboard.press('Escape');
        await expect(page.getByRole('listbox')).toHaveCount(0);
        await expect(nameField(page)).toHaveValue('Hausa');
        await expect(codeField(page)).toHaveValue('');
      });

      await test.step('arrow down, then Enter, chooses Hausa: name, code and direction come from its row', async () => {
        await nameField(page).press('ArrowDown');
        await expect(page.getByRole('option').first()).toHaveText(rowText('ha'));
        await nameField(page).press('ArrowDown');
        await nameField(page).press('ArrowUp');
        await nameField(page).press('Enter');
        await expect(page.getByRole('listbox')).toHaveCount(0);
        await expect(nameField(page)).toHaveValue('Hausa');
        await expect(codeField(page)).toHaveValue('ha');
        expect(await selectedDirection(page)).toBe(language('ha').ld);
        rows.push({ dialog: 'new-bible', chosen: 'ha', name: 'Hausa', code: 'ha', direction: await selectedDirection(page) });
      });

      await test.step('"es-419" offers Latin American Spanish first; choosing nothing keeps the code already there', async () => {
        await expect(codeField(page)).toBeEditable();
        rows.push({ dialog: 'new-bible', query: 'es-419', suggestions: await suggest(page, 'es-419', ['es-419']) });
        await page.keyboard.press('Escape');
        await expect(nameField(page)).toHaveValue('es-419');
        await expect(codeField(page)).toHaveValue('ha');
      });

      await test.step('Arabic sets Right to left; the user sets Left to right and it stays', async () => {
        await suggest(page, 'Arabic', ['ar']);
        await page.getByRole('option').first().click();
        await expect(codeField(page)).toHaveValue('ar');
        expect(await selectedDirection(page)).toBe('rtl');
        rows.push({ dialog: 'new-bible', chosen: 'ar', name: 'Arabic', code: 'ar', direction: 'rtl' });
        await page.getByRole('button', { name: 'Left to right' }).click();
        expect(await selectedDirection(page)).toBe('ltr');
        await expect(nameField(page)).toHaveValue('Arabic');
        await expect(codeField(page)).toHaveValue('ar');
      });

      const project = await test.step('choose Hausa, change the direction, create: the project stores ha and the direction the user set', async () => {
        await suggest(page, 'Hausa', ['ha']);
        await page.getByRole('option').first().click();
        expect(await selectedDirection(page)).toBe('ltr');
        await page.getByRole('button', { name: 'Right to left' }).click();
        await page.getByRole('button', { name: 'Create Bible' }).click();
        await expect(page.getByRole('button', { name: 'Start a blank book' })).toBeVisible({ timeout: 20_000 });
        await page.goto('/');
        const { repo, kept } = await stored(page, before);
        expect(kept).toEqual({ tag: 'ha', name: 'Hausa', languageName: 'Hausa', textDirection: 'rtl' });
        rows.push({ dialog: 'new-bible', code: 'ha', outcome: 'created', ...kept });
        return repo;
      });

      await test.step('the list never came from the internet', async () => {
        expect(listRequests).toEqual([]);
      });

      await test.step('Project settings: Language name is the plain disabled field, with no suggestions', async () => {
        await page.getByTestId(`project-_local_/_local_/${project}`).getByRole('button', { name: 'Settings' }).click();
        await expect(page.getByLabel('Language name')).toBeDisabled();
        await expect(page.getByLabel('Language name')).toHaveValue('Hausa');
        await expect(page.getByRole('combobox', { name: 'Language name' })).toHaveCount(0);
      });

      await save(testInfo, rows);
    },
  );

  test(
    'New Open Bible Stories: Hausa is suggested; an unlisted name and code create a project; a listed code the server refuses names its x- code; Import review keeps its plain field',
    { tag: ['@J20', '@J9'] },
    async ({ page }, testInfo) => {
      test.setTimeout(120_000); // two creates, one refusal and an import review
      const rows: Row[] = [];
      const open = async () => {
        await page.goto('/');
        await page.getByTestId('add-project').click();
        await page.getByTestId('add-project-obs').click();
        await page.getByLabel('Project name').fill(fresh('Sugerencias OBS'));
      };

      await test.step('"Hausa" offers Hausa (ha); a press on it fills the name and the code', async () => {
        await open();
        rows.push({ dialog: 'new-obs', query: 'Hausa', suggestions: await suggest(page, 'Hausa', ['ha', 'hsl']) });
        await page.getByRole('option').first().click();
        await expect(nameField(page)).toHaveValue('Hausa');
        await expect(codeField(page)).toHaveValue('ha');
        rows.push({ dialog: 'new-obs', chosen: 'ha', name: 'Hausa', code: 'ha', direction: await selectedDirection(page) });
      });

      await test.step('a name that is not in the list keeps the code; with the unlisted code x-abc the project is created with both', async () => {
        const before = listLocalRepos();
        await nameField(page).fill('Abc Language');
        await expect(page.getByRole('listbox')).toHaveCount(0);
        await expect(codeField(page)).toHaveValue('ha');
        await codeField(page).fill('x-abc');
        await page.getByRole('button', { name: 'Create stories →' }).click();
        const { kept } = await stored(page, before);
        expect(kept).toEqual({ tag: 'x-abc', name: 'Abc Language', languageName: 'Abc Language', textDirection: 'ltr' });
        rows.push({ dialog: 'new-obs', code: 'x-abc', outcome: 'created', ...kept });
      });

      await test.step('Uyghur (ug) is in the list and not in the server\'s table: the refusal names x-ug, and no repository is left', async () => {
        await open();
        const before = listLocalRepos();
        await suggest(page, 'Uyghur', ['ug']);
        await page.getByRole('option').first().click();
        await expect(codeField(page)).toHaveValue('ug');
        await page.getByRole('button', { name: 'Create stories →' }).click();
        const alert = page.getByRole('alert');
        await expect(alert).toContainText("Language code 'ug' is not custom (no 'x-') but has not been found in the BCP47 lookup table", { timeout: 30_000 });
        await expect(alert).toContainText('To create the project anyway, use the code x-ug.');
        // Watch the listing long enough for a late create to show.
        await page.waitForTimeout(2_000);
        expect(listLocalRepos()).toEqual(before);
        rows.push({ dialog: 'new-obs', code: 'ug', outcome: 'refused', reason: (await alert.textContent())?.trim() });

        await codeField(page).fill('x-ug');
        await page.getByRole('button', { name: 'Create stories →' }).click();
        const { kept } = await stored(page, before);
        expect(kept).toEqual({ tag: 'x-ug', name: 'Uyghur', languageName: 'Uyghur', textDirection: 'ltr' });
        rows.push({ dialog: 'new-obs', code: 'x-ug', outcome: 'created', ...kept });
      });

      await test.step('Import review: Language code is the plain field, with no suggestions', async () => {
        await page.goto('/');
        await importFixture(page, OBS_SAMPLE, { kind: 'burrito', edits: { language: 'ha' }, confirm: false });
        await expect(page.getByTestId('import-lang')).toHaveValue('ha');
        await expect(page.getByTestId('import-lang')).not.toHaveAttribute('role', 'combobox');
        await expect(page.getByRole('option')).toHaveCount(0);
      });

      await save(testInfo, rows);
    },
  );
});

test.afterAll(async () => {
  await verifyAllJournaledProjects();
});
