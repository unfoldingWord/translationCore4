// J7 — Publish: typeset preview → PDF → aligned USFM export
// docs/JOURNEYS.md J7 · Increment 8 · run LTR and RTL (the J10 axis)
//
// The kernel case (#375) proves the export plumbing every producer sits on,
// with the dev-only fake producer (src/data/export/producers.ts): the export
// menu renders it, a click downloads the file, and the project repository is
// byte-identical except at most one D9 checkpoint commit. The producer cases
// (USFM #19, Scripture Burrito zip #359, PDF #20, OBS #360) add their own blocks.
import { test, expect, type Page } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { captureDownload } from './helpers/export';
import { createObsProject } from './helpers/story';
import { assertProjectUnchanged } from '../test/helpers/export';
import { SEEDED_PROJECT, readIngredient, resetPlaces, resetSeededChecking, rigRepo } from './helpers/rig';
import { DRAFT } from '../conformance/fixtures/obs-draft.mjs';

const CONFORMANCE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'conformance');

/** Every file of the repository outside `.git/`, minus the backups and Finder files the export drops. */
const repoFiles = (repo: string): string[] => {
  const walk = (dir: string, base = ''): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const rel = base ? `${base}/${e.name}` : e.name;
      if (rel === '.git') return [];
      return e.isDirectory() ? walk(path.join(dir, e.name), rel) : [rel];
    });
  return walk(repo).filter((p) => !p.endsWith('.bak') && path.basename(p) !== '.DS_Store').sort();
};

/** Unzip the downloaded bytes into a fresh directory and return it. */
const unzipTo = (bytes: Buffer): string => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'tc4-burrito-export-'));
  for (const [name, data] of Object.entries(unzipSync(new Uint8Array(bytes)))) {
    if (name.endsWith('/')) continue;
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), data);
  }
  return dir;
};

/** Run the conformance harness with `env` and return its output lines. */
const validate = (env: Record<string, string>): string[] =>
  spawnSync('node', ['validate.mjs'], { cwd: CONFORMANCE, env: { ...process.env, ...env }, encoding: 'utf8' }).stdout.split('\n');

/** Open the export menu, download the Scripture Burrito zip, and prove the repository did not change. */
const exportBurrito = async (page: Page, repo: string): Promise<{ bytes: Buffer; filename: string }> => {
  await expect.poll(() => execFileSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf8' }), { timeout: 20_000 }).toBe('');
  const metadataBefore = fs.readFileSync(path.join(repo, 'metadata.json'));
  let download: { bytes: Buffer; filename: string } = { bytes: Buffer.alloc(0), filename: '' };
  const commits = await assertProjectUnchanged(repo, async () => {
    await page.getByTestId('export-menu-trigger').click();
    download = await captureDownload(page, page.getByRole('menuitem', { name: 'Scripture Burrito (.zip)' }));
  });
  expect(commits).toBe(0); // a clean project makes no checkpoint
  expect(fs.readFileSync(path.join(repo, 'metadata.json')).equals(metadataBefore)).toBe(true);
  await expect(page.getByTestId('export-failure')).toHaveCount(0);
  return download;
};

/** The zip holds exactly the repository's files (no `.git/`, `.bak`, `.DS_Store`), every one byte-identical except metadata.json. */
const expectRepositoryBytes = (dir: string, repo: string): void => {
  const zipped = repoFiles(dir);
  expect(zipped).toEqual(repoFiles(repo));
  expect(zipped.some((p) => p.startsWith('.git/'))).toBe(false);
  const differ = zipped.filter((p) => !fs.readFileSync(path.join(dir, p)).equals(fs.readFileSync(path.join(repo, p))));
  expect(differ.filter((p) => p !== 'metadata.json')).toEqual([]);
};

test.beforeEach(() => {
  resetSeededChecking();
  resetPlaces();
});

test.describe('J7 — a facilitator publishes the book', () => {
  test(
    'kernel: the export menu renders the producer table, a click downloads the file, and the project is unchanged except one checkpoint',
    { tag: ['@inc8', '@J7'] },
    async ({ page }) => {
      await page.addInitScript(() => localStorage.setItem('tc4.e2e.fakeExport', '1'));
      const repo = rigRepo(SEEDED_PROJECT);

      await test.step('open Titus, then Community Checking from Check', async () => {
        await page.goto('/');
        await page.getByTestId(`project-_local_/_local_/${SEEDED_PROJECT}`).getByRole('button', { name: /Titus/ }).click();
        await page.getByRole('tab', { name: 'Check', exact: true }).click();
        await page.getByTestId('open-community-checking').click();
        await expect(page.getByTestId('export-menu')).toBeVisible();
      });

      await test.step('the mode-switch checkpoint (D9) has settled: the working tree is clean', async () => {
        await expect.poll(() => execFileSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf8' }), { timeout: 20_000 }).toBe('');
      });

      await test.step('the fake export downloads the book as it is on disk; the project does not change', async () => {
        let download: { bytes: Buffer; filename: string } = { bytes: Buffer.alloc(0), filename: '' };
        const commits = await assertProjectUnchanged(repo, async () => {
          await page.getByTestId('export-menu-trigger').click();
          download = await captureDownload(page, page.getByRole('menuitem', { name: 'Fake export (e2e)' }));
        });
        expect(commits).toBe(0); // a clean project makes no checkpoint
        expect(download.filename).toMatch(/-TIT-\d{4}-\d{2}-\d{2}\.txt$/);
        expect(download.bytes.equals(readIngredient(SEEDED_PROJECT, 'ingredients/TIT.usfm'))).toBe(true);
        await expect(page.getByTestId('export-failure')).toHaveCount(0);
      });
    },
  );
});

// The Scripture Burrito zip (#359): the whole project as the server zips it,
// without `.git/`, `.bak` and `.DS_Store`, with the relationships mirror in
// metadata.json. The harness validates the captured bytes: Stage-1 and the
// relationships check for a Bible project, the OBS group for an OBS project.
test.describe('J7/J23 — Scripture Burrito', () => {
  test(
    'Scripture Burrito: a Bible project exports as a zip that passes the harness, every file byte-identical, the project unchanged',
    { tag: ['@inc8', '@J7'] },
    async ({ page }) => {
      const repo = rigRepo(SEEDED_PROJECT);
      await page.goto('/');
      await page.getByTestId(`project-_local_/_local_/${SEEDED_PROJECT}`).getByRole('button', { name: /Titus/ }).click();
      await page.getByRole('tab', { name: 'Check', exact: true }).click();
      await page.getByTestId('open-community-checking').click();

      const download = await exportBurrito(page, repo);
      expect(download.filename).toMatch(/^Equipo Ejemplo — Tito y Jonás-\d{4}-\d{2}-\d{2}\.zip$/);
      const dir = unzipTo(download.bytes);
      expectRepositoryBytes(dir, repo);

      const out = validate({ BURRITO: dir });
      expect(out.find((l) => l.startsWith('Stage-1'))).toMatch(/: \d+ passed, 0 failed$/);
      expect(out.find((l) => l.includes('SB schema: metadata.json valid'))).toMatch(/^PASS/);
      expect(out.find((l) => l.includes('resources: same pins expressed as SB relationships'))).toMatch(/^PASS/);
      const meta = JSON.parse(fs.readFileSync(path.join(dir, 'metadata.json'), 'utf8'));
      expect(meta.idAuthorities.dcs.id).toBe('https://git.door43.org');
      fs.rmSync(dir, { recursive: true, force: true });
    },
  );

  test(
    'Scripture Burrito: an OBS project exports as a zip that passes the harness OBS group, every file byte-identical, the project unchanged',
    { tag: ['@inc8', '@J23'] },
    async ({ page }) => {
      const pins = JSON.parse(fs.readFileSync(path.join(CONFORMANCE, 'sample-burrito-obs/ingredients/checking/resources.json'), 'utf8'));
      // The OBS group checks the reference project's content, so the project gets
      // the sample's story 1 draft and pins.
      const name = await createObsProject('j07sb', 'Equipo Rig — J7 burrito', async (s) => {
        const store = s as unknown as {
          writeTitle: (story: number, text: string) => Promise<void>;
          writeFrame: (story: number, frame: number, text: string) => Promise<void>;
          writeRef: (story: number, text: string) => Promise<void>;
          writeResources: (resources: unknown) => Promise<void>;
        };
        await store.writeTitle(1, DRAFT.title);
        for (const [frame, text] of Object.entries(DRAFT.frames)) await store.writeFrame(1, Number(frame), text);
        await store.writeRef(1, DRAFT.ref);
        await store.writeResources(pins);
      });
      const repo = rigRepo(name);
      await page.goto('/');
      await page.getByTestId(`project-_local_/_local_/${name}`).getByTestId('story-tile-1').click();
      await page.getByRole('tab', { name: 'Check', exact: true }).click();
      await page.getByTestId('open-community-checking').click();

      const download = await exportBurrito(page, repo);
      expect(download.filename).toMatch(/^Equipo Rig — J7 burrito-\d{4}-\d{2}-\d{2}\.zip$/);
      const dir = unzipTo(download.bytes);
      expectRepositoryBytes(dir, repo);

      const out = validate({ OBS_BURRITO: dir });
      expect(out.find((l) => l.startsWith('OBS (the OBS project kind'))).toMatch(/: 7 passed, 0 failed$/);
      fs.rmSync(dir, { recursive: true, force: true });
    },
  );
});

// The PDF (#20): the whole book, printed by the desktop bridge (scripts/
// desktop-main.cjs `export:pdf`). A browser has no bridge, so the journey
// installs a test double with the same contract — a print document in, PDF
// bytes out — printed by this Chromium's own `page.pdf()`, the print path
// Electron's `printToPDF` uses. The packaged-app check of the real bridge is
// docs/evidence/pdf-bridge-2026-09-24.md.
const installPdfBridge = async (page: Page): Promise<void> => {
  await page.exposeFunction('__tc4PrintPdf', async (html: string) => {
    const printer = await page.context().newPage();
    try {
      await printer.setContent(html);
      return (await printer.pdf({ preferCSSPageSize: true })).toString('base64');
    } finally {
      await printer.close();
    }
  });
  await page.addInitScript(() => {
    const w = window as unknown as { __tc4PrintPdf: (html: string) => Promise<string>; tc4Desktop: unknown };
    w.tc4Desktop = { printPdf: async (html: string) => Uint8Array.from(atob(await w.__tc4PrintPdf(html)), (c) => c.charCodeAt(0)) };
  });
};

/** The page count and the first page's MediaBox of a Chromium PDF. */
const pdfShape = (bytes: Buffer): { pages: number; mediaBox: string } => {
  const text = bytes.toString('latin1');
  return { pages: (text.match(/\/Type\s*\/Page[^s]/g) || []).length, mediaBox: text.match(/\/MediaBox\s*\[([^\]]+)\]/)?.[1].trim() ?? '' };
};

test.describe('J7 — PDF', () => {
  test(
    'PDF: the export menu prints the whole book with its page setup, and the project is unchanged',
    { tag: ['@inc8', '@J7'] },
    async ({ page }) => {
      const repo = rigRepo(SEEDED_PROJECT);
      await installPdfBridge(page);
      await page.goto('/');
      await page.getByTestId(`project-_local_/_local_/${SEEDED_PROJECT}`).getByRole('button', { name: /Titus/ }).click();
      await page.getByRole('tab', { name: 'Check', exact: true }).click();
      await page.getByTestId('open-community-checking').click();
      await expect.poll(() => execFileSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf8' }), { timeout: 20_000 }).toBe('');

      const exportPdf = async (): Promise<{ bytes: Buffer; filename: string }> => {
        let download: { bytes: Buffer; filename: string } = { bytes: Buffer.alloc(0), filename: '' };
        const commits = await assertProjectUnchanged(repo, async () => {
          await page.getByTestId('export-menu-trigger').click();
          download = await captureDownload(page, page.getByRole('menuitem', { name: 'Export PDF' }));
        });
        expect(commits).toBe(0); // a clean project makes no checkpoint
        await expect(page.getByTestId('export-failure')).toHaveCount(0);
        return download;
      };

      const single = await exportPdf();
      expect(single.filename).toMatch(/^TIT-\d{4}-\d{2}-\d{2}\.pdf$/);
      expect(single.bytes.subarray(0, 5).toString()).toBe('%PDF-');
      const a4 = pdfShape(single.bytes);
      // Titus, 3 chapters, A4, one column, Single spacing, in the fonts installed on this
      // machine (the print document loads no web font).
      expect(a4).toEqual({ pages: 1, mediaBox: '0 0 594.95996 841.91998' });

      await page.getByRole('group', { name: 'Spacing' }).getByRole('button', { name: 'Double' }).click();
      const double = pdfShape((await exportPdf()).bytes);
      expect(double.pages).toBeGreaterThan(a4.pages); // Double spacing changes the page count

      await page.getByRole('group', { name: 'Paper size' }).getByRole('button', { name: 'Letter' }).click();
      expect(pdfShape((await exportPdf()).bytes).mediaBox).toBe('0 0 612 792');
    },
  );
});
