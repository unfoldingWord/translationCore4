// J1 — First run → create project (language, direction, name) → add book(s)
// JOURNEYS-AND-GAPS §2 J1 · PRD FR-1..FR-5 · TEST-PLAN E-J1 (Increment-1 subset)
// Increment 1 slice (@inc1): the create flow with source selection — a conforming
// Scripture Burrito git repo appears on disk in the rig, with vrs.json (D25),
// the installed-suite pins incl. extraScripture (D10/#13), and books seeded
// client-side from the pinned ULT structure (PLATFORM-NOTES #19, D14: no \ts).
// Pins/preflight/absence-handling UI (FR-3..FR-5) is Increment 5 (@inc5).
import { test, expect } from '@playwright/test';
import { verifyAllJournaledProjects } from './helpers/journal';
import { listLocalRepos, rigRepo, ingredientExists, commitCount } from './helpers/rig';
import fs from 'node:fs';
import path from 'node:path';

test.describe('J1 — a translator creates a project', () => {
  test(
    'create a project (name, language, direction, one book): a rejected region subtag surfaces as a designed error, then the corrected code yields a conforming repo on disk',
    { tag: ['@inc1', '@J1'] },
    async ({ page }) => {
      const reposBefore = listLocalRepos();

      await test.step('open the app', async () => {
        await page.goto('/');
      });

      await test.step('choose “New Bible”', async () => {
        await page.getByRole('button', { name: 'New Bible' }).click();
      });

      await test.step('name it, set the language code, pick the text direction', async () => {
        await page.getByLabel('Bible name').fill('Equipo Rig — Tito');
        await page.getByLabel('Code').fill('es-419');
        await page.getByRole('button', { name: 'Left to right' }).click();
      });

      await test.step('the server rejects the region subtag with a designed error, not a crash (PLATFORM-NOTES #27)', async () => {
        await page.getByRole('button', { name: 'Create Bible' }).click();
        await expect(page.getByRole('alert')).toContainText(/language code/i);
        // The failed attempt git-inits a debris repo (PLATFORM-NOTES #28); the modal
        // cleans it up asynchronously — poll until the rig is back to baseline.
        await expect
          .poll(() => listLocalRepos(), { timeout: 10_000 })
          .toEqual(reposBefore);
      });

      await test.step('correct the language code and create — the Add-a-book dialog follows', async () => {
        await page.getByLabel('Code').fill('es');
        await page.getByRole('button', { name: 'Create Bible' }).click();
        await page
          .getByRole('button', { name: 'Start a blank book' })
          .click({ timeout: 20_000 });
      });

      await test.step('pick the book Titus and create it — the new project opens in Draft', async () => {
        await page.getByLabel('Book', { exact: true }).selectOption('TIT');
        await page.getByRole('button', { name: 'Create book' }).click();
        await expect(page.getByText('Equipo Rig — Tito').first()).toBeVisible({ timeout: 20_000 });
        await expect(page.getByRole('button', { name: 'start this verse' }).first()).toBeVisible({
          timeout: 20_000,
        });
      });

      const repo = await test.step('the project exists on disk as a git repo with metadata + book file', async () => {
        const created = listLocalRepos().filter((r) => !reposBefore.includes(r));
        expect(created, 'exactly one new repo directory in the rig').toHaveLength(1);
        const r = created[0];
        expect(fs.existsSync(path.join(rigRepo(r), 'metadata.json'))).toBe(true);
        expect(fs.existsSync(path.join(rigRepo(r), '.git'))).toBe(true);
        expect(ingredientExists(r, path.join('ingredients', 'TIT.usfm'))).toBe(true);
        return r;
      });

      await test.step('the platform wrote the versification scheme (D25 — eng default)', async () => {
        const vrs = JSON.parse(
          fs.readFileSync(path.join(rigRepo(repo), 'ingredients', 'vrs.json'), 'utf8'),
        );
        expect(vrs).toHaveProperty('maxVerses.TIT');
      });

      await test.step('resources.json is the NORMATIVE §5.3 schemaVersion-2 two-language-set shape (D17/D30): languageSets.primary+fallback each a coherent tn+twl+tw+tA, set-independent originals/lexicons, top-level extraScripture ULT/UST with SHAs', async () => {
        const resFile = JSON.parse(
          fs.readFileSync(
            path.join(rigRepo(repo), 'ingredients', 'checking', 'resources.json'),
            'utf8',
          ),
        );
        expect(resFile.schemaVersion).toBe(2);
        // Exactly two rungs — the automatic ladder is primary -> fallback (D30.2).
        expect(Object.keys(resFile.languageSets).sort()).toEqual(['fallback', 'primary']);
        // The fallback rung is always the installed English suite (D30.2).
        expect(resFile.languageSets.fallback.gatewayLanguage).toEqual({
          languageId: 'en', owner: 'unfoldingWord',
        });
        // At creation no gateway language has been chosen yet, so primary === fallback
        // (the §5.3 migration rule's initial state).
        expect(resFile.languageSets.primary).toEqual(resFile.languageSets.fallback);
        for (const rung of ['primary', 'fallback']) {
          for (const slot of ['translationNotes', 'translationWordsLinks', 'translationWords', 'translationAcademy']) {
            const pin = resFile.languageSets[rung][slot];
            expect(pin.repoPath, `${rung}.${slot}.repoPath`).toMatch(/^git\.door43\.org\//);
            expect(pin.version, `${rung}.${slot}.version`).toMatch(/^v[\d.]+$/);
            expect(pin.flavor, `${rung}.${slot}.flavor`).toBeTruthy();
            if ('sha' in pin) expect(pin.sha).toMatch(/^[0-9a-f]{40}$/);
          }
        }
        // Set-independent pins stay under `resources` (§5.3).
        expect(resFile.resources.originalLanguage.nt.repoPath).toContain('el-x-koine_ugnt');
        expect(resFile.resources.originalLanguage.ot.repoPath).toContain('hbo_uhb');
        expect(resFile.resources.lexicon.nt.repoPath).toContain('en_ugl');
        // The v1 shape's top-level keys MUST be gone (a v1 reader would misread them).
        expect(resFile.gatewayLanguage).toBeUndefined();
        expect(resFile.resources.translationWords).toBeUndefined();
        const extra = Object.fromEntries(
          resFile.extraScripture.map((e: { id: string }) => [e.id, e]),
        );
        expect(extra.ult.version).toBe('v89');
        expect(extra.ult.sha).toMatch(/^[0-9a-f]{40}$/);
        expect(extra.ust.version).toBe('v89');
      });

      await test.step('the chosen text direction is persisted (settings.json) — app-created summaries report "?" so the app reads it back from here', async () => {
        const settings = JSON.parse(
          fs.readFileSync(
            path.join(rigRepo(repo), 'ingredients', 'checking', 'settings.json'),
            'utf8',
          ),
        );
        expect(settings.textDirection).toBe('ltr');
        expect(settings.checkingLanguage).toBe('en');
        expect(settings.textFont).toBeTruthy();
      });

      await test.step('the book was seeded client-side from the pinned ULT structure: stub bodies, source chapters/spans, no \\ts, no \\zaln (PLATFORM-NOTES #19, D14, I-1)', async () => {
        const seeded = fs.readFileSync(
          path.join(rigRepo(repo), 'ingredients', 'TIT.usfm'),
          'utf8',
        );
        expect((seeded.match(/^\\c /gm) || []).length).toBe(3); // Titus has 3 chapters
        expect(seeded).toMatch(/^\\v 1 ___$/m);
        expect(seeded).toMatch(/^\\p$/m); // paragraph structure from the source
        expect(seeded).not.toMatch(/\\ts/);
        expect(seeded).not.toMatch(/\\zaln/);
      });

      await test.step('creation committed at the checkpoints — and only then (W-4/D9)', async () => {
        // platform initial + create-Bible checkpoint + add-book checkpoint
        expect(commitCount(repo)).toBeGreaterThanOrEqual(3);
      });
    },
  );

  // ——— Increment 5 (@inc5): full creation flow — preflight, absence states, pickers ———
  test.fixme(
    'a resource missing for the chosen gateway language is a guided first-class state, not an error (FR-3)',
    { tag: ['@inc5', '@J1'] },
    async () => {},
  );
  test.fixme(
    'an incoherent pin set warns with the broken cross-links listed (FR-4)',
    { tag: ['@inc5', '@J1'] },
    async () => {},
  );
  test.fixme(
    'preflight at creation verifies every pinned resource resolves locally (FR-5)',
    { tag: ['@inc5', '@J1'] },
    async () => {},
  );
});

// Issue #62 teardown: after this journey's mutations, every journaled local
// project must be a verified byte-for-byte materialization of its journal.
test.afterAll(async () => {
  await verifyAllJournaledProjects();
});
