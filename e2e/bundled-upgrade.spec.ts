// #528: reproduce an app upgrade, then create Titus with the network disabled.
// Real exports and production bootstrap/selectors/journal; no invented SHAs.
import { test, expect } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { TC4_ROOT, RIG_SIDELOADED_REPOS, RIG_CLIENT_SETTINGS, listLocalRepos, rigRepo } from './helpers/rig';
import { lane } from './lane.mjs';
import { ServerApi } from '../src/data/serverApi';
import { INSTALLED_SUITE } from '../src/data/installedSuite';
import { createOldProject, prepareUpgrade, verifyUpgrade } from '../scripts/smoke-upgrade-entry';

const api = new ServerApi({ baseUrl: lane().rigApi });
const work = path.join(TC4_ROOT, 'dev-env/state/work');
const store = path.join(work, 'repos');
let backup: string;
let previousSettings: Buffer;
let previousFolders: string[];

test.afterAll(async () => {
  // The page's settleRig teardown has drained every write before restoration.
  if (!backup) return;
  await api.deleteRepo('_local_/_local_/bundled_upgrade_old').catch(() => {});
  for (const folder of fs.readdirSync(RIG_SIDELOADED_REPOS)) {
    if (/^(en_(tn|ult)|unfoldingword--en_(tn|ult)(--[0-9a-f]+)?)$/.test(folder)) fs.rmSync(path.join(RIG_SIDELOADED_REPOS, folder), { recursive: true, force: true });
  }
  for (const folder of previousFolders) fs.cpSync(path.join(backup, folder), path.join(RIG_SIDELOADED_REPOS, folder), { recursive: true });
  fs.writeFileSync(RIG_CLIENT_SETTINGS, previousSettings);
  fs.rmSync(path.join(store, '.tc4-upgrade-witness.json'), { force: true });
  fs.rmSync(backup, { recursive: true, force: true });
});

test('upgrade retains old pinned and unpinned bytes; new offline Titus uses bundled pins in all three modes', { tag: ['@J1', '@J12'] }, async ({ page, context }, testInfo) => {
  test.setTimeout(120_000);
  previousSettings = fs.readFileSync(RIG_CLIENT_SETTINGS);
  const installed = JSON.parse(previousSettings.toString()).installedResources;
  backup = fs.mkdtempSync(path.join(os.tmpdir(), 'tc4-upgrade-journey-'));
  previousFolders = fs.readdirSync(RIG_SIDELOADED_REPOS).filter((folder) => /^(en_(tn|ult)|unfoldingword--en_(tn|ult)(--[0-9a-f]+)?)$/.test(folder));
  for (const folder of previousFolders) fs.cpSync(path.join(RIG_SIDELOADED_REPOS, folder), path.join(backup, folder), { recursive: true });
  const bundled = [INSTALLED_SUITE.languageSets.fallback.translationNotes, INSTALLED_SUITE.extraScripture[0]];
  const resourcesDir = path.join(backup, 'bundle');
  fs.mkdirSync(path.join(resourcesDir, 'resources'), { recursive: true });
  fs.writeFileSync(path.join(resourcesDir, 'BUILD-MANIFEST.json'), JSON.stringify({ bundled_resources: bundled }));
  for (const pin of bundled) {
    const local = Object.keys(installed).find((key) => installed[key].repoPath === pin.repoPath && installed[key].sha === pin.sha);
    expect(local, `seed must supply ${pin.repoPath} at the real bundled revision`).toBeTruthy();
    const name = pin.repoPath.replace('git.door43.org/', '').replace('/', '--').toLowerCase();
    fs.cpSync(path.join(store, local!), path.join(resourcesDir, 'resources', name), { recursive: true });
  }
  await createOldProject(api, store, path.join(TC4_ROOT, 'test/fixtures/resources'));
  prepareUpgrade(store, RIG_CLIENT_SETTINGS, path.join(TC4_ROOT, 'test/fixtures/resources'));
  const require = createRequire(import.meta.url);
  const { bootstrap } = require('../scripts/desktop-bootstrap.cjs');
  bootstrap({ resourcesDir, home: path.dirname(work), storeLeaf: 'work/repos', profileLeaf: 'work', variant: 'production' });
  await api.disableNet();
  await verifyUpgrade(api, store, testInfo.outputPath('upgrade-witness.json'));
  await context.route((url) => !['localhost', '127.0.0.1'].includes(url.hostname), (route) => route.abort());
  const before = listLocalRepos();
  await page.goto('/');
  await page.getByTestId('add-project').click();
  await page.getByTestId('add-project-bible').click();
  await page.getByLabel('Bible name').fill('Upgrade offline Titus');
  await page.getByLabel('Code').fill('fr');
  await page.getByRole('button', { name: 'Create Bible' }).click();
  await page.getByRole('button', { name: 'Start a blank book' }).click({ timeout: 20_000 });
  await page.getByLabel('Book', { exact: true }).selectOption('TIT');
  await page.getByRole('button', { name: 'Create book' }).click();
  await expect(page.getByTestId('understand')).toBeVisible({ timeout: 20_000 });
  for (const mode of ['Translate', 'Understand', 'Check']) {
    await page.getByRole('tab', { name: mode, exact: true }).click();
    await expect(page.getByText('Needs downloading', { exact: false })).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
  }
  const created = listLocalRepos().filter((repo) => !before.includes(repo));
  expect(created).toHaveLength(1);
  const pins = JSON.parse(fs.readFileSync(path.join(rigRepo(created[0]), 'ingredients/checking/resources.json'), 'utf8'));
  expect(pins.languageSets.primary.translationNotes.sha).toBe(bundled[0].sha);
  expect(pins.languageSets.fallback.translationNotes.sha).toBe(bundled[0].sha);
  expect(pins.extraScripture[0].sha).toBe(bundled[1].sha);
  fs.writeFileSync(testInfo.outputPath('new-project-pins.json'), JSON.stringify(pins, null, 2));
  await page.screenshot({ path: testInfo.outputPath('offline-upgraded-titus-check.png'), fullPage: true });
});
