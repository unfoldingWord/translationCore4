// The project-settings contract (#529): the journal owns settings — a change
// records `settings.set` events and folding them generates the
// `checking/settings.json` mirror (BURRITO-SPEC §5.4, R-8.7.1). The product
// writes the presentation fields only (textDirection, textFont, languageName);
// `checkingLanguage` is obsolete — new projects never write it, the checking
// language lives in the resource pins (§5.3, D30) — and a pre-release project
// that still carries it stays readable, with the field preserved and ignored.
//
// Written before the writers changed (AGENTS.md "How to test"): on main these
// tests fail on the `checkingLanguage` writes; the #529 change set makes them pass.
// Each test leaves one JSON witness in its output folder: the settings and pins
// on disk, the journal's `settings.set` paths, the fold-compare verdict, and the
// round-trip result.
import { test, expect } from './helpers/test';
import type { Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { verifyAllJournaledProjects } from './helpers/journal';
import {
  SEEDED_PROJECT,
  listLocalRepos,
  pinForSideloaded,
  readProjectPins,
  resetPlaces,
  resetSeededChecking,
  rigRepo,
  writeProjectPins,
} from './helpers/rig';
import { RIG_API, readSegmentEvents, segmentFiles } from './helpers/story';
import { captureDownload } from './helpers/export';
import { importFixture } from './helpers/import';
import { pickOption } from './helpers/dropdown';
import { ServerApi } from '../src/data/serverApi';
import { describeVerifierReport, verifyProjectAgainstJournal, type VerifierReport } from '../src/data/journal/verify';

// The j13 keys: a gateway option card is keyed `languageId::owner`.
const ES_KEY = 'es-419::es-419_gl';
const SPANISH_CARD = 'This project checks in Español (Latinoamérica) · es-419_gl.'; // #579: the own name (D94)
const SETTINGS_IPATH = 'checking/settings.json';
const EN = () => ({
  tn: pinForSideloaded('en_tn', 'v91'),
  tw: pinForSideloaded('en_tw', 'v91'),
  ta: pinForSideloaded('en_ta', 'v91'),
});

/** The generated settings mirror, parsed. */
const readSettings = (repo: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(path.join(rigRepo(repo), 'ingredients', 'checking', 'settings.json'), 'utf8'));

/** Every `settings.set` event the project's journal holds, across all segments. */
const settingsEvents = (repo: string): Array<{ path?: string; value?: unknown; removed?: boolean }> =>
  segmentFiles(repo).flatMap(readSegmentEvents).filter((e) => e.op === 'settings.set') as never;

/** The project's pins as identities (repoPath + sha, D58): an open legally adds
 * the recorded coverage to a pin (D41), which is not a change. */
function pinIdentities(repo: string) {
  type Pin = { repoPath?: string; sha?: string };
  const pins = readProjectPins(repo) as unknown as {
    languageSets: { primary: Record<string, Pin>; fallback: Record<string, Pin> };
    extraScripture?: Array<{ id: string } & Pin>;
  };
  const identities = (set: Record<string, Pin>) =>
    Object.fromEntries(Object.entries(set).map(([slot, pin]) => [slot, pin.repoPath ? `${pin.repoPath}@${pin.sha}` : pin]));
  return {
    primary: identities(pins.languageSets.primary),
    fallback: identities(pins.languageSets.fallback),
    extraScripture: (pins.extraScripture ?? []).map((e) => `${e.id}=${e.repoPath}@${e.sha}`),
  };
}

/** The fold-compare verdict on one project (src/data/journal/verify.ts): the
 * journal is valid and every derived file equals its projection. The app may
 * still be writing when a test asks, so the verdict is polled until it holds. */
async function foldVerdict(repo: string): Promise<VerifierReport> {
  const api = new ServerApi({ baseUrl: RIG_API });
  let report: VerifierReport | undefined;
  await expect
    .poll(async () => {
      report = await verifyProjectAgainstJournal(api, `_local_/_local_/${repo}`);
      return report.ok ? 'ok' : describeVerifierReport(report);
    }, { timeout: 30_000 })
    .toBe('ok');
  return report!;
}

/** What one project holds on disk and in its journal. No repository name and no
 * time is recorded, so each run writes the same witness. */
async function projectWitness(repo: string) {
  const report = await foldVerdict(repo);
  // The folded settings generate the mirror: a byte-identical mirror is the comparison.
  expect(report.clean, 'the settings mirror equals the folded settings').toContain(SETTINGS_IPATH);
  return {
    settings: readSettings(repo),
    pins: pinIdentities(repo),
    settingsSetPaths: [...new Set(settingsEvents(repo).map((e) => e.path))].sort(),
    journal: {
      ok: report.ok,
      settingsMirrorEqualsFold: report.clean.includes(SETTINGS_IPATH),
      invalidSegments: report.invalidSegments.length,
      mismatches: report.mismatches.map((m) => m.ipath),
    },
  };
}

/** Save `witness` as this test's artifact (AGENTS.md "How to test"). */
async function attachWitness(name: string, witness: unknown): Promise<void> {
  const file = test.info().outputPath(`settings-contract-${name}.json`);
  fs.writeFileSync(file, `${JSON.stringify(witness, null, 2)}\n`);
  await test.info().attach(path.basename(file), { path: file, contentType: 'application/json' });
}

/** A name no earlier run left on the rig (the shell refuses an existing folder). */
const fresh = (base: string) => `${base} ${Date.now()}`;
const abbrOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/** #505: Project Settings opens from the Settings button on the project's Home card.
 * The form reads the saved settings after it opens, and that read replaces a choice
 * made before it ends; Save is enabled when the read is done. */
async function openSettingsFromHome(page: Page, project: string) {
  const leave = page.getByTitle('Switch project');
  if (await leave.count()) await leave.click();
  else await page.goto('/');
  await page.getByTestId(`project-_local_/_local_/${project}`).getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeEnabled({ timeout: 20_000 });
}

/** Confirm a gateway change and wait for its one journal action (j13). */
async function confirmChange(page: Page) {
  await page.getByTestId('gateway-confirm').click();
  await expect(page.getByTestId('gateway-change').or(page.getByTestId('gateway-error'))).toHaveCount(0, { timeout: 30_000 });
}

/** Export the open project's Scripture Burrito zip from Community Checking. */
async function exportBurritoZip(page: Page, repo: string): Promise<Buffer> {
  await page.getByRole('tab', { name: 'Check', exact: true }).click();
  await page.getByTestId('open-community-checking').click();
  // The first open may commit what it writes; an export needs the clean tree.
  await expect
    .poll(() => execFileSync('git', ['-C', rigRepo(repo), 'status', '--porcelain'], { encoding: 'utf8' }), { timeout: 20_000 })
    .toBe('');
  await page.getByTestId('export-menu-trigger').click();
  const { bytes } = await captureDownload(page, page.getByRole('menuitem', { name: 'Scripture Burrito (.zip)' }));
  await expect(page.getByTestId('export-failure')).toHaveCount(0);
  return bytes;
}

/** Import `bytes` as a Scripture Burrito and return the new repo's name. */
async function importBurritoZip(page: Page, bytes: Buffer, name: string): Promise<string> {
  await page.goto('/');
  await importFixture(page, { name: 'settings-contract.zip', mimeType: 'application/zip', buffer: bytes }, { kind: 'burrito', edits: { name } });
  await expect(page.getByTestId('import-toast')).toBeVisible();
  const repo = abbrOf(name);
  expect(fs.existsSync(rigRepo(repo)), `imported repo ${repo} on disk`).toBe(true);
  return repo;
}

/** Every file under checking/, keyed by relative path, as base64 — the round-trip
 * comparator: settings mirror, pins and journal history all live here. */
function checkingTree(repo: string): Record<string, string> {
  const root = path.join(rigRepo(repo), 'ingredients', 'checking');
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (!p.endsWith('.bak')) out[path.relative(root, p).split(path.sep).join('/')] = fs.readFileSync(p).toString('base64');
    }
  };
  walk(root);
  return out;
}

/** Export `source`, import the zip as a new project, and compare checking/ byte for
 * byte: the settings mirror, the pins and the journal segments. */
async function roundTrip(page: Page, source: string, importedName: string) {
  const zip = await exportBurritoZip(page, source);
  const imported = await importBurritoZip(page, zip, importedName);
  const before = checkingTree(source);
  const after = checkingTree(imported);
  const names = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  // The comparison must cover what the criterion names, not an empty folder.
  expect(names).toEqual(expect.arrayContaining(['settings.json', 'resources.json']));
  expect(names.some((n) => n.startsWith('journal/')), 'the journal segments are compared').toBe(true);
  const differing = names.filter((n) => before[n] !== after[n]);
  expect(differing, 'checking/ is byte-identical after export and import').toEqual([]);
  return { imported, result: { identical: differing.length === 0, differing } };
}

// #329: Home tiles resume where a client last worked; these tests open projects
// from their tiles and state their own start.
test.beforeEach(() => {
  resetPlaces();
});

// The projects the ordered tests below share (one worker, fullyParallel: false).
// A failure restarts the worker and clears module state, so a later test that
// finds its project missing creates its own.
let bibleRepo = '';
let obsRepo = '';

/** Create a Bible project with one book through the real UI (the J1 happy path). */
async function createBibleViaUi(page: Page): Promise<string> {
  const reposBefore = listLocalRepos();
  await page.goto('/');
  await page.getByTestId('add-project').click();
  await page.getByTestId('add-project-bible').click();
  await page.getByLabel('Bible name').fill(fresh('Contrato — Tito'));
  await page.getByLabel('Language name').fill('Español');
  await page.getByLabel('Code').fill('es');
  await page.getByRole('button', { name: 'Left to right' }).click();
  await page.getByRole('button', { name: 'Create Bible' }).click();
  await page.getByRole('button', { name: 'Start a blank book' }).click({ timeout: 20_000 });
  await pickOption(page, 'Book', 'Titus');
  await page.getByRole('button', { name: 'Create book' }).click();
  await expect(page.getByTestId('understand')).toBeVisible({ timeout: 20_000 });
  const created = listLocalRepos().filter((r) => !reposBefore.includes(r));
  expect(created, 'exactly one new repo').toHaveLength(1);
  return created[0];
}

/** Create an OBS project through the real UI (the J20 happy path). */
async function createObsViaUi(page: Page): Promise<string> {
  const reposBefore = listLocalRepos();
  await page.goto('/');
  await page.getByTestId('add-project').click();
  await page.getByTestId('add-project-obs').click();
  await page.getByLabel('Project name').fill(fresh('Contrato — Historias'));
  await page.getByLabel('Language name').fill('Español');
  await page.getByLabel('Code').fill('es');
  await page.getByRole('button', { name: 'Left to right' }).click();
  await page.getByRole('button', { name: 'Create stories →' }).click();
  const created = await expect
    .poll(() => listLocalRepos().filter((r) => !reposBefore.includes(r)), { timeout: 30_000 })
    .toHaveLength(1)
    .then(() => listLocalRepos().filter((r) => !reposBefore.includes(r)));
  await expect(page.getByTestId(`project-_local_/_local_/${created[0]}`)).toBeVisible({ timeout: 30_000 });
  return created[0];
}

test.describe('#529 — the settings contract: journal-owned, presentation fields only, no checkingLanguage', () => {
  test(
    'a new Bible project writes exactly the presentation settings: no checkingLanguage in the mirror, no settings.set event for it',
    { tag: ['@inc9', '@settings-contract'] },
    async ({ page }) => {
      bibleRepo = await test.step('create a Bible project through the real UI (J1 happy path)', () => createBibleViaUi(page));

      await test.step('the mirror holds the presentation fields and nothing else (§5.4)', async () => {
        const settings = readSettings(bibleRepo);
        expect(Object.keys(settings).sort()).toEqual(['languageName', 'schemaVersion', 'textDirection', 'textFont']);
        expect(settings.schemaVersion).toBe(1);
        expect(settings.textDirection).toBe('ltr');
        expect(settings.languageName).toBe('Español');
        expect(typeof settings.textFont).toBe('string'); // the wizard's default font
        expect(settings).not.toHaveProperty('checkingLanguage');
      });

      await test.step('the journal agrees: settings.set events for the presentation paths, none for checkingLanguage', async () => {
        const paths = settingsEvents(bibleRepo).map((e) => e.path);
        expect(paths).toEqual(expect.arrayContaining(['textDirection', 'textFont', 'languageName']));
        expect(paths).not.toContain('checkingLanguage');
      });

      await attachWitness('bible-creation', await projectWitness(bibleRepo));
    },
  );

  test(
    'a new Open Bible Stories project: the same contract',
    { tag: ['@inc9', '@settings-contract'] },
    async ({ page }) => {
      obsRepo = await test.step('create an OBS project through the real UI (J20 happy path)', () => createObsViaUi(page));

      await test.step('mirror and journal: presentation fields only, no checkingLanguage', async () => {
        const settings = readSettings(obsRepo);
        expect(Object.keys(settings).sort()).toEqual(['languageName', 'schemaVersion', 'textDirection', 'textFont']);
        expect(settings.schemaVersion).toBe(1);
        expect(settings.textDirection).toBe('ltr');
        expect(settings.languageName).toBe('Español');
        expect(settings).not.toHaveProperty('checkingLanguage');
        const paths = settingsEvents(obsRepo).map((e) => e.path);
        expect(paths).toEqual(expect.arrayContaining(['textDirection', 'languageName']));
        expect(paths).not.toContain('checkingLanguage');
      });

      await attachWitness('obs-creation', await projectWitness(obsRepo));
    },
  );

  test(
    'editing direction and font preserves the language name, and the choices survive a restart',
    { tag: ['@inc9', '@settings-contract'] },
    async ({ page }) => {
      bibleRepo ||= await createBibleViaUi(page);
      const before = readSettings(bibleRepo);
      const font = page.getByRole('combobox', { name: 'Script font', exact: true });

      await test.step('change direction and font in Project Settings and save', async () => {
        await openSettingsFromHome(page, bibleRepo);
        await page.getByRole('button', { name: 'Right to left' }).click();
        await pickOption(page, font, 'Charis SIL');
        await page.getByRole('button', { name: 'Save changes' }).click();
        await expect(page.getByTestId('settings-gateway')).toHaveCount(0); // the modal closed on success
      });

      await test.step('the mirror holds the new choices with everything else intact', async () => {
        await expect.poll(() => readSettings(bibleRepo).textDirection, { timeout: 10_000 }).toBe('rtl');
        const settings = readSettings(bibleRepo);
        expect(settings.textFont).toBe('Charis SIL');
        expect(settings.languageName).toBe('Español'); // unrelated settings preserved
        expect(settings).not.toHaveProperty('checkingLanguage');
      });

      await test.step('a restart shows the saved choices', async () => {
        await page.reload();
        await openSettingsFromHome(page, bibleRepo);
        await expect(page.getByRole('button', { name: 'Right to left' })).toHaveAttribute('data-selected', 'true');
        await expect(font).toContainText('Charis SIL');
      });

      await attachWitness('settings-edit', {
        before,
        after: await projectWitness(bibleRepo),
        shownAfterRestart: { textDirection: 'rtl', textFont: 'Charis SIL' },
      });
    },
  );

  test(
    'choosing another installed checking-language package moves the pins, not the settings file, and survives a restart',
    { tag: ['@inc9', '@settings-contract'] },
    async ({ page }) => {
      resetSeededChecking();
      writeProjectPins(SEEDED_PROJECT, EN());
      const settingsBefore = readSettings(SEEDED_PROJECT);

      await test.step('change the package to Spanish from Project Settings (the J13 flow)', async () => {
        await openSettingsFromHome(page, SEEDED_PROJECT);
        await page.getByTestId(`settings-gateway-${ES_KEY}`).click();
        await expect(page.getByTestId('gateway-change')).toBeVisible({ timeout: 30_000 });
        await confirmChange(page);
      });

      await test.step('the pins carry the choice; the settings mirror does not', async () => {
        expect(readProjectPins(SEEDED_PROJECT).languageSets.primary.gatewayLanguage).toEqual({ languageId: 'es-419', owner: 'es-419_gl' });
        const settings = readSettings(SEEDED_PROJECT);
        expect(settings).not.toHaveProperty('checkingLanguage');
        expect(settings).toEqual(settingsBefore); // the change writes pins and decisions, never settings
      });

      await test.step('the choice survives a restart', async () => {
        await page.reload();
        await openSettingsFromHome(page, SEEDED_PROJECT);
        await expect(page.getByTestId('settings-gateway-current')).toHaveText(SPANISH_CARD);
      });

      await attachWitness('package-change', {
        settingsBefore,
        after: await projectWitness(SEEDED_PROJECT),
        cardAfterRestart: SPANISH_CARD,
      });
    },
  );

  test(
    'a Scripture Burrito export/import round trip preserves settings, pins and journal history — Bible',
    { tag: ['@inc9', '@settings-contract'] },
    async ({ page }) => {
      bibleRepo ||= await createBibleViaUi(page);
      await page.goto('/');
      await page.getByTestId(`project-_local_/_local_/${bibleRepo}`).getByRole('button', { name: /Titus/ }).click();
      const { imported, result } = await roundTrip(page, bibleRepo, fresh('Contrato ida y vuelta'));
      expect(readSettings(imported)).not.toHaveProperty('checkingLanguage');
      await attachWitness('round-trip-bible', {
        source: await projectWitness(bibleRepo),
        imported: await projectWitness(imported),
        roundTrip: result,
      });
    },
  );

  test(
    'the same round trip preserves an Open Bible Stories project',
    { tag: ['@inc9', '@settings-contract'] },
    async ({ page }) => {
      obsRepo ||= await createObsViaUi(page);
      await page.goto('/');
      await page.getByTestId(`project-_local_/_local_/${obsRepo}`).getByTestId('story-tile-1').click();
      const { imported, result } = await roundTrip(page, obsRepo, fresh('Contrato historias'));
      await attachWitness('round-trip-obs', {
        source: await projectWitness(obsRepo),
        imported: await projectWitness(imported),
        roundTrip: result,
      });
    },
  );

  test(
    'an existing project that carries the obsolete checkingLanguage keeps it, and the field has no effect',
    { tag: ['@inc9', '@settings-contract'] },
    async ({ page }) => {
      test.setTimeout(120_000); // four flows in one test: seed, save, package change, round trip
      const legacyRepo = `legado_${Date.now()}`;
      const seeded = await test.step('seed a pre-#529 project: the store writes settings WITH checkingLanguage, as the old creation path did', async () => {
        const { JournalingStore } = await import('../src/data/journal/journalingStore');
        const { memKv } = await import('../test/helpers/journalingRig');
        const { INSTALLED_SUITE } = await import('../src/data/installedSuite');
        const store = new JournalingStore({ api: new ServerApi({ baseUrl: RIG_API }), kv: memKv() });
        const { repoPath } = await store.createObsProject({ content_name: 'Contrato — legado', content_abbr: legacyRepo, content_language_code: 'es' });
        await store.open(repoPath);
        await store.writeResources(INSTALLED_SUITE, null);
        await store.writeSettings({ schemaVersion: 1, checkingLanguage: 'en', textDirection: 'ltr', textFont: null, languageName: 'Español' }, null);
        await store.commit('Project created (pre-#529 shape)');
        store.dispose();
        expect(readSettings(legacyRepo).checkingLanguage).toBe('en');
        return readSettings(legacyRepo);
      });

      const afterSave = await test.step('a settings save preserves the obsolete field and the unrelated settings', async () => {
        await page.goto('/');
        await openSettingsFromHome(page, legacyRepo);
        await page.getByRole('button', { name: 'Right to left' }).click();
        await page.getByRole('button', { name: 'Save changes' }).click();
        await expect.poll(() => readSettings(legacyRepo).textDirection, { timeout: 10_000 }).toBe('rtl');
        const settings = readSettings(legacyRepo);
        expect(settings.checkingLanguage).toBe('en'); // preserved, never dropped
        expect(settings.languageName).toBe('Español');
        return settings;
      });

      await test.step('the field does not choose the checking language: the pins do', async () => {
        await openSettingsFromHome(page, legacyRepo);
        await page.getByTestId(`settings-gateway-${ES_KEY}`).click();
        await expect(page.getByTestId('gateway-change')).toBeVisible({ timeout: 30_000 });
        await confirmChange(page);
        await page.reload();
        await openSettingsFromHome(page, legacyRepo);
        // The card reads the pins (Spanish) while the obsolete field still says 'en'.
        await expect(page.getByTestId('settings-gateway-current')).toHaveText(SPANISH_CARD);
        expect(readSettings(legacyRepo).checkingLanguage).toBe('en');
      });

      await test.step('export/import keeps the project whole, obsolete field included', async () => {
        await page.goto('/');
        await page.getByTestId(`project-_local_/_local_/${legacyRepo}`).getByTestId('story-tile-1').click();
        const { imported, result } = await roundTrip(page, legacyRepo, fresh('Contrato legado'));
        expect(readSettings(imported).checkingLanguage).toBe('en');
        await attachWitness('obsolete-field', {
          seeded,
          afterSave,
          afterPackageChange: await projectWitness(legacyRepo),
          cardAfterPackageChange: SPANISH_CARD,
          imported: await projectWitness(imported),
          roundTrip: result,
        });
      });
    },
  );
});

// Issue #62 teardown — and this contract's fold agreement: every journaled local
// project (the imported copies included) is a verified materialization of its
// journal, so each settings mirror equals its folded settings (R-8.7.1).
test.afterAll(async () => {
  await verifyAllJournaledProjects();
});
