// J7 — Publish: typeset preview → PDF → aligned USFM export
// docs/JOURNEYS.md J7 · Increment 8 · run LTR and RTL (the J10 axis)
//
// The kernel case (#375) proves the export plumbing every producer sits on,
// with the dev-only fake producer (src/data/export/producers.ts): the export
// menu renders it, a click downloads the file, and the project repository is
// byte-identical except at most one D9 checkpoint commit. The producer cases
// (USFM #19, Scripture Burrito zip #359, PDF #20, OBS #360) add their own blocks.
import { test, expect } from './helpers/test';
import type { Page } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { captureDownload } from './helpers/export';
import { RIG_API, createObsProject, storyBytes } from './helpers/story';
import { assertProjectUnchanged } from '../test/helpers/export';
import { SEEDED_PROJECT, readIngredient, resetPlaces, resetSeededChecking, rigRepo } from './helpers/rig';
import { DRAFT } from '../conformance/fixtures/obs-draft.mjs';
import { decompose } from '../journal/skeleton.mjs';
import { verseTextMd5 } from '../journal/fold.mjs';
import { extractVerseFromZalnUsfm, origWordsFromAlignments } from '../test/helpers/zaln';
import type { AlignmentFile } from '../src/data/align/zaln';

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

// The PDF (#20): every chapter with a drafted verse, printed by the desktop
// bridge (scripts/desktop-main.cjs `export:pdf`). A browser has no bridge, so
// the journey installs a test double with the same contract — a print
// document in, PDF bytes out — printed by this Chromium's own `page.pdf()`,
// the print path Electron's `printToPDF` uses. The double keeps each document
// it prints. The packaged-app check of the real bridge is
// docs/evidence/pdf-bridge-2026-09-24.md.
const installPdfBridge = async (page: Page): Promise<string[]> => {
  const documents: string[] = [];
  await page.exposeFunction('__tc4PrintPdf', async (html: string) => {
    documents.push(html);
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
  return documents;
};

/** The page count and the first page's MediaBox of a Chromium PDF. */
const pdfShape = (bytes: Buffer): { pages: number; mediaBox: string } => {
  const text = bytes.toString('latin1');
  return { pages: (text.match(/\/Type\s*\/Page[^s]/g) || []).length, mediaBox: text.match(/\/MediaBox\s*\[([^\]]+)\]/)?.[1].trim() ?? '' };
};

/** The chapters a print document holds. */
const printedChapterCount = (html: string): number => (html.match(/<section class="print-chapter"/g) || []).length;

/** A Bible project with every verse of Titus drafted, made through the store
 * the app runs (as createObsProject does for OBS): the seeded Titus has five
 * drafted verses, too few for Double spacing to add a page. */
const createDraftedTitus = async (): Promise<string> => {
  const { JournalingStore } = await import('../src/data/journal/journalingStore');
  const { ServerApi } = await import('../src/data/serverApi');
  const { memKv } = await import('../test/helpers/journalingRig');
  const { INSTALLED_SUITE } = await import('../src/data/installedSuite');
  const verse1 = 'Pablo, siervo de Dios y apóstol de Jesucristo, según la fe de los escogidos de Dios.';
  const usfm = fs
    .readFileSync(path.join(CONFORMANCE, 'sample-burrito/ingredients/TIT.usfm'), 'utf8')
    .replace(/^\\v (\d+) *(___)?$/gm, `\\v $1 ${verse1}`);
  const store = new JournalingStore({ api: new ServerApi({ baseUrl: RIG_API }), kv: memKv() });
  const repo = `j07pdf_${Date.now()}`;
  const { repoPath } = await store.createProject({
    content_name: 'Equipo Rig — J7 PDF', content_abbr: repo, content_language_code: 'es', content_language_name: null,
    add_book: false, versification: 'eng',
  });
  await store.open(repoPath);
  await store.writeResources(INSTALLED_SUITE, null);
  await store.writeSettings({ schemaVersion: 1, checkingLanguage: 'en', textDirection: 'ltr', textFont: null, languageName: 'Español' }, null);
  await store.addBook({ book_code: 'TIT', book_title: 'Tito', book_abbr: 'TIT', add_cv: true, initialUsfm: usfm });
  await store.commit('Project created (journey precondition)');
  store.dispose();
  return repo;
};

/** Open `name`'s Titus in Community Checking and wait for a clean working tree. */
const openTitusCommunityChecking = async (page: Page, name: string): Promise<void> => {
  await page.goto('/');
  await page.getByTestId(`project-_local_/_local_/${name}`).getByRole('button', { name: /Titus/ }).click();
  await page.getByRole('tab', { name: 'Check', exact: true }).click();
  await page.getByTestId('open-community-checking').click();
  await expect.poll(() => execFileSync('git', ['-C', rigRepo(name), 'status', '--porcelain'], { encoding: 'utf8' }), { timeout: 20_000 }).toBe('');
};

/** Export the PDF of the open book and prove the project did not change. */
const exportPdf = async (page: Page, name: string): Promise<{ bytes: Buffer; filename: string }> => {
  let download: { bytes: Buffer; filename: string } = { bytes: Buffer.alloc(0), filename: '' };
  const commits = await assertProjectUnchanged(rigRepo(name), async () => {
    await page.getByTestId('export-menu-trigger').click();
    download = await captureDownload(page, page.getByRole('menuitem', { name: 'Export PDF' }));
  });
  expect(commits).toBe(0); // a clean project makes no checkpoint
  await expect(page.getByTestId('export-failure')).toHaveCount(0);
  return download;
};

test.describe('J7 — PDF', () => {
  test(
    'PDF: the seeded Titus prints only its drafted chapter, and the project is unchanged',
    { tag: ['@inc8', '@J7'] },
    async ({ page }) => {
      const documents = await installPdfBridge(page);
      await openTitusCommunityChecking(page, SEEDED_PROJECT);
      await expect(page.getByTestId('cc-chapter')).toHaveCount(1); // the preview follows the same rule

      const pdf = await exportPdf(page, SEEDED_PROJECT);
      expect(pdf.filename).toMatch(/^TIT-\d{4}-\d{2}-\d{2}\.pdf$/);
      expect(pdf.bytes.subarray(0, 5).toString()).toBe('%PDF-');
      // Chapter 1 has verses 1–5 drafted; chapters 2 and 3 have none and are left out.
      expect(printedChapterCount(documents[0])).toBe(1);
      expect(documents[0]).toContain('[ verse not yet drafted ]'); // 1:6–16, inside the printed chapter
      expect(pdfShape(pdf.bytes)).toEqual({ pages: 1, mediaBox: '0 0 594.95996 841.91998' });
    },
  );

  test(
    'PDF: a drafted book prints every chapter with its page setup — Double spacing adds pages, Letter sets the paper, the preview shows the same pages',
    { tag: ['@inc8', '@J7'] },
    async ({ page }) => {
      test.setTimeout(60_000); // the project is made here, and its first open folds a new journal
      const name = await createDraftedTitus();
      const documents = await installPdfBridge(page);
      await openTitusCommunityChecking(page, name);

      /** The preview shows as many page sheets as the PDF has pages (the same DOM and stylesheet). */
      const expectPreviewSheets = async (pages: number): Promise<void> => {
        await page.evaluate(() => document.fonts.ready);
        await expect.poll(() => page.getByTestId('cc-page').count()).toBe(pages);
      };

      const single = pdfShape((await exportPdf(page, name)).bytes);
      expect(printedChapterCount(documents[0])).toBe(3);
      expect(documents[0]).not.toContain('[ verse not yet drafted ]');
      // Titus, 46 verses, A4, one column, Single spacing, in the fonts installed on this
      // machine (the print document loads no web font).
      expect(single).toEqual({ pages: 2, mediaBox: '0 0 594.95996 841.91998' });
      await expectPreviewSheets(single.pages);

      await page.getByRole('group', { name: 'Spacing' }).getByRole('button', { name: 'Double' }).click();
      const double = pdfShape((await exportPdf(page, name)).bytes);
      expect(double.pages).toBeGreaterThan(single.pages); // Double spacing changes the page count
      await expectPreviewSheets(double.pages);

      await page.getByRole('group', { name: 'Columns' }).getByRole('button', { name: '2' }).click();
      await expectPreviewSheets(pdfShape((await exportPdf(page, name)).bytes).pages);

      await page.getByRole('group', { name: 'Paper size' }).getByRole('button', { name: 'Letter' }).click();
      expect(pdfShape((await exportPdf(page, name)).bytes).mediaBox).toBe('0 0 612 792');
    },
  );
});

// The USFM export (#19): the open book as aligned USFM (the stored §5.1
// records woven in as `\zaln` and `\w`) and as plain USFM (the stored file).
// Each download is attached to the run as its artifact.
test.describe('J7 — USFM', () => {
  /** Export the open book with `item` and prove the project did not change. */
  const exportUsfm = async (page: Page, item: string): Promise<{ bytes: Buffer; filename: string }> => {
    let download: { bytes: Buffer; filename: string } = { bytes: Buffer.alloc(0), filename: '' };
    const commits = await assertProjectUnchanged(rigRepo(SEEDED_PROJECT), async () => {
      await page.getByTestId('export-menu-trigger').click();
      download = await captureDownload(page, page.getByRole('menuitem', { name: item, exact: true }));
    });
    expect(commits).toBe(0); // a clean project makes no checkpoint
    await expect(page.getByTestId('export-failure')).toHaveCount(0);
    await test.info().attach(download.filename, { body: download.bytes, contentType: 'text/plain' });
    return download;
  };

  /** The aligned download against the stored book: every byte outside the verses is the same; 1:1, the one verse the sample aligns, unweaves to its stored record; every other verse is its stored text. Returns the woven 1:1. */
  const expectAlignedDownload = (download: { bytes: Buffer }): string => {
    const book = decompose(readIngredient(SEEDED_PROJECT, 'ingredients/TIT.usfm').toString('utf8'));
    const stored = book.verses as Record<string, string>;
    const alignments = JSON.parse(readIngredient(SEEDED_PROJECT, 'ingredients/checking/alignments/TIT.json').toString('utf8')) as AlignmentFile;
    const aligned = decompose(download.bytes.toString('utf8'));
    const out = aligned.verses as Record<string, string>;
    expect(aligned.skeleton).toBe(book.skeleton);
    expect(Object.keys(out)).toEqual(Object.keys(stored));
    const woven = Object.keys(stored).filter((key) => /\\zaln-s/.test(out[key]));
    expect(woven).toEqual(['1:1']);
    for (const key of Object.keys(stored)) {
      const [chapter, verse] = key.split(':');
      const record = alignments.chapters[chapter]?.[verse];
      if (!woven.includes(key)) {
        expect(out[key], key).toBe(stored[key]);
        continue;
      }
      expect(extractVerseFromZalnUsfm(out[key], origWordsFromAlignments(record.alignments)), key).toEqual({
        alignments: record.alignments,
        wordBank: record.wordBank,
      });
    }
    return out['1:1'];
  };

  test(
    'USFM, aligned: unweaving every verse gives the stored alignment records; a verse with no record is its stored text',
    { tag: ['@inc8', '@J7'] },
    async ({ page }) => {
      await openTitusCommunityChecking(page, SEEDED_PROJECT);
      const download = await exportUsfm(page, 'USFM, aligned');
      expect(download.filename).toMatch(/^TIT-aligned-\d{4}-\d{2}-\d{2}\.usfm$/);
      expectAlignedDownload(download);
    },
  );

  test(
    'USFM, aligned: a footnote inside an aligned verse stays in the download',
    { tag: ['@inc8', '@J7'] },
    async ({ page }) => {
      const ingredients = path.join(rigRepo(SEEDED_PROJECT), 'ingredients');
      const bookPath = path.join(ingredients, 'TIT.usfm');
      const footnote = '\\f + \\ft Nota de prueba.\\f*';
      fs.writeFileSync(bookPath, fs.readFileSync(bookPath, 'utf8').replace('con la piedad,', `con la piedad,${footnote}`));
      // The record is stamped against the verse as stored (I-3), as the aligner stamps it.
      const alignmentsPath = path.join(ingredients, 'checking', 'alignments', 'TIT.json');
      const alignments = JSON.parse(fs.readFileSync(alignmentsPath, 'utf8')) as AlignmentFile;
      alignments.chapters['1']['1'].targetVerseMd5 = verseTextMd5((decompose(fs.readFileSync(bookPath, 'utf8')).verses as Record<string, string>)['1:1']);
      fs.writeFileSync(alignmentsPath, `${JSON.stringify(alignments, null, 2)}\n`);

      await openTitusCommunityChecking(page, SEEDED_PROJECT);
      const download = await exportUsfm(page, 'USFM, aligned');
      expect(expectAlignedDownload(download)).toContain(footnote);
    },
  );

  test(
    'USFM, plain: the download is the stored book file byte for byte',
    { tag: ['@inc8', '@J7'] },
    async ({ page }) => {
      await openTitusCommunityChecking(page, SEEDED_PROJECT);
      const download = await exportUsfm(page, 'USFM, plain');
      expect(download.filename).toMatch(/^TIT-\d{4}-\d{2}-\d{2}\.usfm$/);
      expect(download.bytes.equals(readIngredient(SEEDED_PROJECT, 'ingredients/TIT.usfm'))).toBe(true);
    },
  );

  test(
    'USFM, plain: a book stored with a leading byte-order mark exports with it',
    { tag: ['@inc8', '@J7'] },
    async ({ page }) => {
      // An imported USFM file keeps its byte-order mark (src/data/import/usfm.ts).
      const book = path.join(rigRepo(SEEDED_PROJECT), 'ingredients', 'TIT.usfm');
      fs.writeFileSync(book, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), fs.readFileSync(book)]));
      await openTitusCommunityChecking(page, SEEDED_PROJECT);
      const stored = readIngredient(SEEDED_PROJECT, 'ingredients/TIT.usfm');
      expect(stored.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(true);
      const download = await exportUsfm(page, 'USFM, plain');
      expect(download.bytes.equals(stored)).toBe(true);
    },
  );
});

// OBS (#360, J23): the story Markdown zip is `content/` byte for byte; the PDF
// prints the drafted stories in the flow layout, through the same bridge double
// as the Bible PDF (#454: one line for each run of undrafted frames or stories,
// no picture for an undrafted frame). The projects are made by the app's OBS
// create path, drafted from the conformance fixture.
test.describe('J23 — OBS', () => {
  const openObsCommunityChecking = async (page: Page, name: string): Promise<void> => {
    await page.goto('/');
    await page.getByTestId(`project-_local_/_local_/${name}`).getByTestId('story-tile-1').click();
    await page.getByRole('tab', { name: 'Check', exact: true }).click();
    await page.getByTestId('open-community-checking').click();
    await expect(page.locator('[data-testid="cc-story"][data-story="1"]').getByTestId('cc-picture-1')).toBeVisible(); // the preview resolved its pictures
    // The first open commits what it writes (the journal seed); an export then makes no checkpoint.
    await expect.poll(() => execFileSync('git', ['-C', rigRepo(name), 'status', '--porcelain'], { encoding: 'utf8' }), { timeout: 20_000 }).toBe('');
  };
  const createDraftedObs = (abbr: string): Promise<string> =>
    createObsProject(abbr, `Equipo Rig — J23 ${abbr}`, async (s) => {
      const store = s as unknown as { writeTitle: (story: number, text: string) => Promise<void> };
      await store.writeTitle(1, DRAFT.title);
      await s.writeFrame(1, 1, DRAFT.frames[1]);
    });

  test(
    'OBS: Story Markdown (.zip) holds content/ exactly as stored, and the project is unchanged',
    { tag: ['@inc8', '@J23'] },
    async ({ page }) => {
      const name = await createDraftedObs('j23md');
      const repo = rigRepo(name);
      await openObsCommunityChecking(page, name);
      let download: { bytes: Buffer; filename: string } = { bytes: Buffer.alloc(0), filename: '' };
      const commits = await assertProjectUnchanged(repo, async () => {
        await page.getByTestId('export-menu-trigger').click();
        await expect(page.getByRole('menuitem')).toHaveText(['Story Markdown (.zip)', 'Scripture Burrito (.zip)']); // a browser: no PDF bridge
        download = await captureDownload(page, page.getByRole('menuitem', { name: 'Story Markdown (.zip)' }));
      });
      expect(commits).toBe(0);
      await expect(page.getByTestId('export-failure')).toHaveCount(0);
      expect(download.filename).toMatch(/^Equipo Rig — J23 j23md-stories-\d{4}-\d{2}-\d{2}\.zip$/);
      const zipped = Object.entries(unzipSync(new Uint8Array(download.bytes))).filter(([entry]) => !entry.endsWith('/'));
      const stored = repoFiles(path.join(repo, 'ingredients')).filter((p) => p.startsWith('content/'));
      expect(zipped.map(([entry]) => entry).sort()).toEqual(stored);
      expect(stored).toContain('content/50.md');
      for (const [entry, bytes] of zipped) expect(Buffer.from(bytes).equals(fs.readFileSync(path.join(repo, 'ingredients', entry))), entry).toBe(true);
    },
  );

  /** A title of story 6, and nothing else of it. */
  const TITLE_ONLY = 'Solo el título';

  /** Story 1: its title and frames 1 and 3; story 4: frame 1; story 6: its
   * title only. So story 1 has undrafted frames in the middle and at the end,
   * stories 2–3 and story 5 lie between drafted stories, story 6 is drafted by
   * its title alone (a short page), and stories 7–50 come after the last one (#454). */
  const createGappedObs = (abbr: string): Promise<string> =>
    createObsProject(abbr, `Equipo Rig — J23 ${abbr}`, async (s) => {
      const store = s as unknown as { writeTitle: (story: number, text: string) => Promise<void> };
      await store.writeTitle(1, DRAFT.title);
      await s.writeFrame(1, 1, DRAFT.frames[1]);
      await s.writeFrame(1, 3, DRAFT.frames[2]);
      await s.writeFrame(4, 1, DRAFT.frames[1]);
      await store.writeTitle(6, TITLE_ONLY);
    });

  /** The number of frames of `story` as the project stores it (each frame is one image line). */
  const storedFrames = (repo: string, story: number): number => (storyBytes(repo, story).match(/^!\[/gm) || []).length;

  /** The lines of an OBS print document in order: titles, frame texts, gap lines, references. */
  const printedLines = (html: string): string[] =>
    [...html.matchAll(/<(?:h1|p) class="(?:print-title print-story-title|print-frame-text|print-frame-gap|print-story-gap|print-story-reference|print-nothing-drafted)"[^>]*>([^<]*)<\/(?:h1|p)>/g)].map((m) => m[1]);

  const escapeText = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  test(
    'OBS: the PDF prints the drafted stories, one line for each run of undrafted frames or stories, pictures only on drafted frames, the preview the same, and the project is unchanged',
    { tag: ['@inc8', '@J23'] },
    async ({ page }) => {
      test.setTimeout(240_000);
      const name = await createGappedObs('j23pdf');
      const [frames1, frames4, frames6] = [storedFrames(name, 1), storedFrames(name, 4), storedFrames(name, 6)];
      const documents = await installPdfBridge(page);
      await openObsCommunityChecking(page, name);
      await page.getByTestId('export-menu-trigger').click();
      await expect(page.getByRole('menuitem')).toHaveText(['Export PDF', 'Story Markdown (.zip)', 'Scripture Burrito (.zip)']);
      await page.keyboard.press('Escape');

      const expected = [
        DRAFT.title, escapeText(DRAFT.frames[1]), '[ frame 2 not yet drafted ]', escapeText(DRAFT.frames[2]), `[ frames 4–${frames1} not yet drafted ]`,
        '[ stories 2–3 not yet drafted ]',
        'Story 4', escapeText(DRAFT.frames[1]), `[ frames 2–${frames4} not yet drafted ]`,
        '[ story 5 not yet drafted ]',
        TITLE_ONLY, `[ frames 1–${frames6} not yet drafted ]`,
      ];
      // The preview states the same stories and lines as the PDF.
      const stories = page.getByTestId('cc-story');
      await expect(stories).toHaveCount(3);
      expect(await stories.evaluateAll((els) => els.map((el) => el.getAttribute('data-story')))).toEqual(['1', '4', '6']);
      await expect(page.getByTestId('cc-story-gap')).toHaveText(['[ stories 2–3 not yet drafted ]', '[ story 5 not yet drafted ]']);
      await expect(page.getByTestId('cc-frame-gap')).toHaveText(['[ frame 2 not yet drafted ]', `[ frames 4–${frames1} not yet drafted ]`, `[ frames 2–${frames4} not yet drafted ]`, `[ frames 1–${frames6} not yet drafted ]`]);
      await expect(page.locator('[data-testid^="cc-picture-"]')).toHaveCount(3);
      await expect(page.getByText('The export shows each run of undrafted frames or stories as one line, without pictures.', { exact: false })).toBeVisible();
      // Every story page is one sheet wide, the short title-only page too (a flex
      // column once shrank it to its content).
      const widths = await stories.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().width)));
      expect(new Set(widths).size, `story page widths ${widths.join(', ')}`).toBe(1);
      await test.info().attach('j23-obs-preview.png', { body: await page.getByTestId('community-checking').screenshot(), contentType: 'image/png' });

      const pdf = await exportPdf(page, name);
      expect(pdf.filename).toMatch(/^Equipo Rig — J23 j23pdf-\d{4}-\d{2}-\d{2}\.pdf$/);
      expect(pdf.bytes.subarray(0, 5).toString()).toBe('%PDF-');
      const html = documents[0];
      expect(printedLines(html)).toEqual(expected);
      expect(html.match(/<section class="print-story"/g)).toHaveLength(3); // stories 1, 4 and 6
      expect(html.match(/<div class="print-frame">/g)).toHaveLength(3); // the three drafted frames
      expect(html.match(/<img class="print-frame-picture" src="data:image\//g)).toHaveLength(3); // no picture for an undrafted frame
      const withPictures = pdfShape(pdf.bytes);
      expect(withPictures.mediaBox).toBe('0 0 594.95996 841.91998');
      await test.info().attach('j23-obs-pictures-on.html', { body: html, contentType: 'text/html' });

      await page.getByTestId('cc-pictures').click();
      const noPictures = pdfShape((await exportPdf(page, name)).bytes);
      expect(documents[1]).not.toContain('<img');
      expect(printedLines(documents[1])).toEqual(expected);
      // Three drafted stories, each its title page and its frames' pages, in the fonts
      // installed on this machine; the #454 report had 362 pages with pictures and
      // 100 without, for one drafted frame.
      expect({ on: withPictures.pages, off: noPictures.pages }).toEqual({ on: 7, off: 6 });
    },
  );

  test(
    'OBS: with no story drafted, the PDF is one line that says so, and the preview says the same',
    { tag: ['@inc8', '@J23'] },
    async ({ page }) => {
      test.setTimeout(120_000);
      const name = await createObsProject('j23none', 'Equipo Rig — J23 j23none');
      const documents = await installPdfBridge(page);
      await page.goto('/');
      // A project with no story in progress shows no recent tiles: open the full list first.
      await page.getByTestId(`toggle-stories-_local_/_local_/${name}`).click();
      await page.getByTestId(`project-_local_/_local_/${name}`).getByTestId('story-tile-1').click();
      await page.getByRole('tab', { name: 'Check', exact: true }).click();
      await page.getByTestId('open-community-checking').click();
      await expect(page.getByTestId('cc-nothing-drafted')).toHaveText('Nothing is drafted in this project yet.');
      await expect.poll(() => execFileSync('git', ['-C', rigRepo(name), 'status', '--porcelain'], { encoding: 'utf8' }), { timeout: 20_000 }).toBe('');

      const pdf = await exportPdf(page, name);
      expect(printedLines(documents[0])).toEqual(['Nothing is drafted in this project yet.']);
      expect(pdfShape(pdf.bytes).pages).toBe(1);
    },
  );

  test(
    'OBS: the PDF in the wrapped layout floats a quarter-width picture at each drafted frame\'s start corner, and the text wraps it',
    { tag: ['@inc8', '@J23'] },
    async ({ page }) => {
      test.setTimeout(240_000);
      const name = await createGappedObs('j23wrap');
      const documents = await installPdfBridge(page);
      await openObsCommunityChecking(page, name);
      await page.getByRole('button', { name: 'Pictures wrapped' }).click();
      const story = page.locator('[data-testid="cc-story"][data-story="1"]');
      await expect(story).toHaveAttribute('data-layout', 'wrapped');
      // On screen: the picture is a quarter of the frame's width, at its left (a left-to-right project).
      const box = async (id: string) => (await story.getByTestId(id).boundingBox())!;
      const [picture, frame] = [await box('cc-picture-1'), await box('cc-frame-1')];
      expect(Math.abs(picture.width - frame.width / 4)).toBeLessThan(2);
      expect(Math.abs(picture.x - frame.x)).toBeLessThan(2);

      const pdf = await exportPdf(page, name);
      const html = documents[0];
      expect(html).toContain('<main class="print-book print-stories print-stories-wrapped">');
      expect(html.match(/<img class="print-frame-picture" src="data:image\/[^"]+" alt="[^"]*" style="float:left"\/>/g)).toHaveLength(3);
      expect(html.match(/style="float/g)).toHaveLength(3); // a gap line floats nothing
      expect(pdfShape(pdf.bytes).pages).toBe(6);
    },
  );
});
