// J14 — Joining is not merging (D53/D55; issue #62).
//
// The app-level obligation the format suite cannot assert: working in — or
// joining — one project NEVER scans for, suggests, or automatically combines a
// deliberately similar local project. Matching language, book set, or naming
// does not imply identity; the untouched project stays byte-identical,
// including its per-project actor identity (D53c).
//
// The joins/imports-a-shared-project half of the journey is test.fixme until
// the join/import flow ships (J9 is Increment 6; Phase-2 sync is out of #62's
// scope by design) — the isolation obligation is asserted NOW against the flows
// that exist: creating and working in a deliberately similar sibling.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { listLocalRepos, rigRepo } from './helpers/rig';
import { verifyAllJournaledProjects } from './helpers/journal';

/** Every byte of one project except .git (commit times differ run to run):
 * ingredients, sidecars, journal segments AND the actor identity record. */
function snapshotRepo(repo: string): Record<string, string> {
  const root = rigRepo(repo);
  const out: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else
        out[path.relative(root, full)] = crypto
          .createHash('md5')
          .update(fs.readFileSync(full))
          .digest('hex');
    }
  };
  walk(root);
  return out;
}

function actorIdsOf(repo: string): string[] {
  const dir = path.join(rigRepo(repo), 'ingredients', 'checking', 'journal');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

async function createProject(page: import('@playwright/test').Page, name: string): Promise<string> {
  const before = listLocalRepos();
  await page.goto('/');
  await page.getByRole('button', { name: 'New Bible' }).click();
  await page.getByLabel('Bible name').fill(name);
  await page.getByLabel('Code').fill('es');
  await page.getByRole('button', { name: 'Left to right' }).click();
  await page.getByRole('button', { name: 'Create Bible' }).click();
  await page.getByRole('button', { name: 'Start a blank book' }).click({ timeout: 20_000 });
  await page.getByLabel('Book').selectOption('TIT');
  await page.getByRole('button', { name: 'Create book' }).click();
  await expect(page.getByText(name).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'start this verse' }).first()).toBeVisible({
    timeout: 20_000,
  });
  const created = listLocalRepos().filter((r) => !before.includes(r));
  expect(created, 'exactly one new repo for the created project').toHaveLength(1);
  return created[0];
}

test.describe('J14 — joining is not merging: similar projects stay separate', () => {
  test(
    'two deliberately similar projects (same language, same book, near-identical names): working in one leaves the other byte-identical, actor identities included',
    { tag: ['@inc3', '@J14'] },
    async ({ page }) => {
      const repoA = await test.step('create the FIRST project (es, Titus)', () =>
        createProject(page, 'Equipo Gemelo — Tito'),
      );
      const repoB = await test.step('create the SECOND, deliberately similar project', () =>
        createProject(page, 'Equipo Gemelo Dos — Tito'),
      );
      expect(repoB).not.toBe(repoA);

      // D53c: one installation, two projects, TWO actor identities.
      const actorsA = actorIdsOf(repoA);
      const actorsB = actorIdsOf(repoB);
      expect(actorsA, 'project A has exactly one actor (this installation)').toHaveLength(1);
      expect(actorsB, 'project B has exactly one actor (this installation)').toHaveLength(1);
      expect(actorsA[0], 'per-project actor identities differ (D53c)').not.toBe(actorsB[0]);

      const snapshotA = snapshotRepo(repoA);

      await test.step('work in project B: draft a verse (B is already open in Draft)', async () => {
        await page.getByRole('button', { name: 'Start this verse' }).first().click();
        const editor = page.getByRole('textbox', { name: 'Verse 1' });
        await editor.fill('Pablo, siervo de Dios — borrador del gemelo dos.');
        await editor.blur();
        await expect(page.getByText(/saved/i).first()).toBeVisible({ timeout: 20_000 });
      });

      await test.step('reopen project B from Home (open/recovery never scans the sibling)', async () => {
        await page.goto('/');
        await page
          // listLocalRepos returns the bare directory name; the Home tile's
          // testid is the platform id (org-qualified).
          .getByTestId(`project-_local_/_local_/${repoB}`)
          .getByRole('button', { name: /Titus/ })
          .click();
        await expect(page.getByText('borrador del gemelo dos').first()).toBeVisible({
          timeout: 20_000,
        });
      });

      await test.step('the untouched project A is byte-identical — nothing scanned, suggested, or combined (D53b)', async () => {
        expect(snapshotRepo(repoA)).toEqual(snapshotA);
        expect(actorIdsOf(repoA)).toEqual(actorsA);
      });
    },
  );

  test.fixme(
    'joining/importing a third SHARED project never proposes combining it with a similar local project — pending the join/import flow (J9, Increment 6; Phase-2 sync)',
    { tag: ['@inc6', '@J14'] },
    async () => {},
  );
});

// Issue #62 teardown: after this journey's mutations, every journaled local
// project must be a verified byte-for-byte materialization of its journal.
test.afterAll(async () => {
  await verifyAllJournaledProjects();
});
