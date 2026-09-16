// J20 — a facilitator creates an Open Bible Stories project (docs/JOURNEYS.md J20,
// D74; issue #287). End state on disk: the pankosmia `text_stories` template byte for
// byte except metadata.json and the fifty title lines (`# N.`, no text); currentScope
// equals the template's table and stays so through checkpoints (the app never
// rescans an OBS project, PLATFORM-NOTES #37); the metadata carries the
// `localizedNames` the server requires (PLATFORM-NOTES #36); Home shows the OBS
// tile at 0%, and one frame drafted through the store moves it. The Bible card and the New Bible
// entry are unchanged beside it (J1's proof is the regression).
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { listLocalRepos, rigRepo, commitCount, SEEDED_PROJECT } from './helpers/rig';
import { verifyAllJournaledProjects } from './helpers/journal';
import { seedStory, parseStory } from '../journal/story.mjs';

const RIG = 'http://127.0.0.1:19998/api';
const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const TEMPLATE = path.join(REPO_ROOT, 'conformance', 'fixtures', 'text_stories');

/** Every file of a tree, keyed by its path relative to `dir`. */
const treeFiles = (dir: string): Record<string, string> => {
  const out: Record<string, string> = {};
  const walk = (d: string, prefix: string): void => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(d, entry.name), rel);
      else out[rel] = fs.readFileSync(path.join(d, entry.name), 'utf8');
    }
  };
  walk(dir, '');
  return out;
};

/** The conformance harness's SB validator, built from its bundled schema. */
const sbValidator = () => {
  const conformance = path.join(REPO_ROOT, 'conformance');
  const require = createRequire(path.join(conformance, 'package.json'));
  const Ajv = require('ajv');
  const addFormats = require('ajv-formats');
  const ajv = new Ajv({ strict: false, allErrors: true });
  addFormats(ajv);
  const root = path.join(conformance, 'sb-schema');
  const BASE = 'https://sb.local/';
  const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.json') ? [path.join(d, e.name)] : []);
  for (const f of walk(root)) {
    let schema;
    try { schema = JSON.parse(fs.readFileSync(f, 'utf8').replace(/,(\s*[}\]])/g, '$1')); } catch { continue; }
    schema.$id = BASE + path.relative(root, f).split(path.sep).join('/');
    try { ajv.addSchema(schema); } catch { /* duplicate $id — first wins */ }
  }
  return ajv.getSchema(BASE + 'source_metadata.schema.json');
};

test.describe('J20 — a facilitator creates an Open Bible Stories project', () => {
  test(
    'New Open Bible Stories asks for language, name and the gateway set; the repository is the template in the seed form; Home shows the OBS tile at 0% and one drafted frame moves it',
    { tag: ['@inc7', '@J20', '@j20'] },
    async ({ page }) => {
      const reposBefore = listLocalRepos();

      await test.step('open the app: Home offers both kinds, and the seeded Bible project keeps its book tiles', async () => {
        await page.goto('/');
        await expect(page.getByRole('button', { name: 'New Bible' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'New Open Bible Stories' })).toBeVisible();
        const bible = page.getByTestId(`project-_local_/_local_/${SEEDED_PROJECT}`);
        await expect(bible).toBeVisible();
        await expect(bible.getByRole('button', { name: /Titus|Jonah/ }).first()).toBeVisible();
        await expect(bible.getByTestId('obs-marker')).toHaveCount(0);
      });

      await test.step('choose Open Bible Stories: the dialog asks for language, name and the gateway set — nothing about books or stories', async () => {
        await page.getByRole('button', { name: 'New Open Bible Stories' }).click();
        await expect(page.getByLabel('Project name')).toBeVisible();
        await expect(page.getByLabel('Language name')).toBeVisible();
        await expect(page.getByLabel('Code')).toBeVisible();
        await expect(page.getByText('English', { exact: true })).toBeVisible();
        await expect(page.getByLabel('Book', { exact: true })).toHaveCount(0);
        await expect(page.getByText(/versification/i)).toHaveCount(0);
        await expect(page.getByText(/stor(y|ies) [0-9]/i)).toHaveCount(0);
      });

      await test.step('name it, set the language, create', async () => {
        await page.getByLabel('Project name').fill('Equipo Rig — Historias');
        await page.getByLabel('Language name').fill('Español');
        await page.getByLabel('Code').fill('es');
        await page.getByRole('button', { name: 'Left to right' }).click();
        await page.getByRole('button', { name: 'Create stories →' }).click();
      });

      const repo = await test.step('Home lists the project with the OBS marker and 0% drafted', async () => {
        const created = await expect
          .poll(() => listLocalRepos().filter((r) => !reposBefore.includes(r)), { timeout: 30_000 })
          .toHaveLength(1)
          .then(() => listLocalRepos().filter((r) => !reposBefore.includes(r)));
        const r = created[0];
        const card = page.getByTestId(`project-_local_/_local_/${r}`);
        await expect(card).toBeVisible({ timeout: 30_000 });
        await expect(card.getByTestId('obs-marker')).toHaveText('OBS');
        await expect(card.getByTestId('obs-progress')).toContainText('0% drafted', { timeout: 30_000 });
        await expect(card.getByRole('button', { name: 'Add a book' })).toHaveCount(0);
        return r;
      });

      await test.step('on disk: the template byte for byte, except metadata.json and the fifty title lines', async () => {
        const template = treeFiles(path.join(TEMPLATE, 'ingredients'));
        const created = treeFiles(path.join(rigRepo(repo), 'ingredients'));
        const journaled = Object.keys(created).filter((p) => p.startsWith('checking/'));
        const content = Object.fromEntries(Object.entries(created).filter(([p]) => !p.startsWith('checking/')));
        expect(Object.keys(content).sort()).toEqual(Object.keys(template).sort());
        expect(journaled.sort()).toEqual(expect.arrayContaining(['checking/resources.json', 'checking/settings.json']));
        for (const [ipath, bytes] of Object.entries(template)) {
          const isStory = /^content\/\d\d\.md$/.test(ipath);
          expect(content[ipath], ipath).toBe(isStory ? seedStory(bytes) : bytes);
          if (isStory) {
            const story = parseStory(content[ipath]);
            expect(story.title).toBe('');
            expect(story.ref).toBeNull();
            expect(story.frames.every((f) => f.text === '')).toBe(true);
          }
        }
      });

      await test.step('metadata.json carries the project identity and validates as an OBS project (BURRITO-SPEC §10.1), currentScope verbatim (R-10.2.3)', async () => {
        const meta = JSON.parse(fs.readFileSync(path.join(rigRepo(repo), 'metadata.json'), 'utf8'));
        const tmpl = JSON.parse(
          fs.readFileSync(path.join(TEMPLATE, 'metadata.json'), 'utf8')
            .replace(/%%LANGUAGE%%/, '{"tag":"und"}').replace(/%%[A-Z_]+%%/g, 'x'),
        );
        expect(meta.type.flavorType.name).toBe('gloss');
        expect(meta.type.flavorType.flavor).toEqual({ name: 'textStories' });
        expect(meta.type.flavorType.currentScope).toEqual(tmpl.type.flavorType.currentScope);
        expect(meta.identification.name.en).toBe('Equipo Rig — Historias');
        expect(meta.localizedNames).toBeDefined();
        const validate = sbValidator();
        expect(validate, 'the harness schema loads').toBeTruthy();
        expect(validate!(meta), JSON.stringify(validate!.errors?.slice(0, 2))).toBe(true);
        for (const [key, entry] of Object.entries(meta.ingredients as Record<string, { mimeType?: string }>))
          if (/^ingredients\/content\/\d\d\.md$/.test(key)) expect(entry.mimeType, key).toBe('text/markdown');
      });

      await test.step('creation committed: the platform initial, the seed form, the creation checkpoint (D9)', async () => {
        expect(commitCount(repo)).toBeGreaterThanOrEqual(3);
        const log = execFileSync('git', ['-C', rigRepo(repo), 'log', '--format=%s'], { encoding: 'utf8' });
        expect(log).toContain('Seed the fifty stories (tC4)');
      });

      await test.step('one frame drafted through the store moves the percentage', async () => {
        // The store in node against the live rig: the same class the app runs
        // (the story screen is J21, #289).
        const { JournalingStore } = await import('../src/data/journal/journalingStore');
        const { ServerApi } = await import('../src/data/serverApi');
        const { memKv } = await import('../test/helpers/journalingRig');
        const store = new JournalingStore({ api: new ServerApi({ baseUrl: RIG }), kv: memKv() });
        await store.open(`_local_/_local_/${repo}`);
        await store.writeFrame(1, 1, 'Así hizo Dios todo al principio.');
        await store.commit('checkpoint (J20 proof)');
        store.dispose();
        await page.reload();
        const card = page.getByTestId(`project-_local_/_local_/${repo}`);
        await expect(card.getByTestId('obs-progress')).toContainText('1% drafted', { timeout: 30_000 });
        const story = parseStory(fs.readFileSync(path.join(rigRepo(repo), 'ingredients', 'content', '01.md'), 'utf8'));
        expect(story.frames[0].text).toBe('Así hizo Dios todo al principio.');
        expect(story.frames.slice(1).every((f) => f.text === '')).toBe(true);
      });

      await test.step('after two checkpoints and a draft the scope table is still the template\'s (R-10.2.3; the app never rescans an OBS project, PLATFORM-NOTES #37)', async () => {
        const meta = JSON.parse(fs.readFileSync(path.join(rigRepo(repo), 'metadata.json'), 'utf8'));
        const tmpl = JSON.parse(
          fs.readFileSync(path.join(TEMPLATE, 'metadata.json'), 'utf8')
            .replace(/%%LANGUAGE%%/, '{"tag":"und"}').replace(/%%[A-Z_]+%%/g, 'x'),
        );
        expect(meta.type.flavorType.currentScope).toEqual(tmpl.type.flavorType.currentScope);
        const committed = execFileSync('git', ['-C', rigRepo(repo), 'show', 'HEAD:metadata.json'], { encoding: 'utf8' });
        expect(JSON.parse(committed).type.flavorType.currentScope).toEqual(tmpl.type.flavorType.currentScope);
      });
    },
  );
});

// Issue #62 teardown: every journaled local project is a verified byte-for-byte
// materialization of its journal.
test.afterAll(async () => {
  await verifyAllJournaledProjects();
});
