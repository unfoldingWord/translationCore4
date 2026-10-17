// J5 — Align a verse: link/unlink pairs → persists in the §5.1 sidecar
// docs/JOURNEYS.md J5 · shipped v4.0.0-alpha.2 · run LTR and RTL (the J10 axis)
// (owner-approved placement, 2026-08-03).
//
// Ground truth is the sidecar on disk. The wordMAP suggestion cases (#1, D72
// point 3; #516, D93) assert the propose-only rules and that the engine learns
// from every saved verse without a retrain in the way.
import { test, expect } from './helpers/test';
import { verifyAllJournaledProjects } from './helpers/journal';
import { holdCheckpoints } from './helpers/checkpointHold';
import { importFixture } from './helpers/import';
import { MANIFEST_DIR } from '../test/helpers/import';
import { wordTokens } from '../src/data/align/tokenize';
import fs from 'node:fs';
import path from 'node:path';
import {
  SEEDED_PROJECT,
  rigRepo,
  pinForSideloaded,
  writeProjectPins,
  resetSeededChecking,
  resetPlaces,
  sideloadedIngredient,
} from './helpers/rig';

const PINS = () => ({
  tn: pinForSideloaded('en_tn', 'v91'),
  tw: pinForSideloaded('en_tw', 'v91'),
  ta: pinForSideloaded('en_ta', 'v91'),
});

/** The project must also pin an original-language text for alignment. */
function writePinsWithOriginal() {
  writeProjectPins(SEEDED_PROJECT, PINS());
  const p = path.join(rigRepo(SEEDED_PROJECT), 'ingredients', 'checking', 'resources.json');
  const file = JSON.parse(fs.readFileSync(p, 'utf8'));
  // MERGE the originalLanguage group in — replacing the whole `resources`
  // object dropped the seed's lexicon group that writeProjectPins carries
  // forward (#124 review round 2, same unrelated-state loss as issue #123).
  file.resources = {
    ...(file.resources ?? {}),
    originalLanguage: {
      nt: pinForSideloaded('el-x-koine_ugnt', 'v0.34'),
      ot: { repoPath: 'git.door43.org/unfoldingWord/hbo_uhb', version: 'v3.0.0', sha: '74022f0fed012a3ef169886f595dd98e7b200543', flavor: 'scripture/textTranslation' },
    },
  };
  fs.writeFileSync(p, `${JSON.stringify(file, null, 2)}\n`);
}

const alignmentFile = () => {
  const p = path.join(rigRepo(SEEDED_PROJECT), 'ingredients', 'checking', 'alignments', 'TIT.json');
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
};

/** The words of these chips, without the occurrence number a repeated word
 * shows (#735). */
const wordsOf = (chips: import('@playwright/test').Locator) =>
  chips.evaluateAll((els) => els.map((el) => el.getAttribute('data-word') ?? ''));

async function openAlign(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page
    .getByTestId(`project-_local_/_local_/${SEEDED_PROJECT}`)
    .getByRole('button', { name: /Titus/ })
    .click();
  await page.getByRole('tab', { name: 'Check', exact: true }).click();
  await page.getByTestId('open-align').click();
  await expect(page.getByTestId('align-session')).toBeVisible();
}

test.beforeEach(() => {
  resetSeededChecking();
});

// #329: a Home tile returns to where this client last worked; this journey opens
// books from their tiles and states its own start (Translate, chapter 1).
test.beforeEach(() => {
  resetPlaces();
});

test.describe('J5 — a translator aligns a verse', () => {
  test(
    'writePinsWithOriginal merges, never replaces: the seed lexicon group and extraScripture survive (#123/#124 review)',
    { tag: ['@inc2', '@J5'] },
    async () => {
      const p = path.join(rigRepo(SEEDED_PROJECT), 'ingredients', 'checking', 'resources.json');
      const seed = JSON.parse(fs.readFileSync(p, 'utf8'));
      writePinsWithOriginal();
      const after = JSON.parse(fs.readFileSync(p, 'utf8'));
      expect(after.resources.lexicon).toEqual(seed.resources.lexicon);
      expect(after.extraScripture).toEqual(seed.extraScripture);
      expect(Object.keys(after.resources.originalLanguage)).toEqual(['nt', 'ot']);
    },
  );

  test(
    'the alignment surface loads the stored §5.1 record: word bank + one card per original word (FR-19)',
    { tag: ['@inc2', '@J5'] },
    async ({ page }) => {
      writePinsWithOriginal();
      const stored = alignmentFile()!.chapters['1']['1'];
      const placedInFile = stored.alignments.reduce(
        (n: number, a: { bottomWords: unknown[] }) => n + a.bottomWords.length,
        0,
      );

      await openAlign(page);

      // One card per original-language word, and the stored links are shown.
      await expect(page.locator('[data-testid^="align-card-"]')).toHaveCount(
        stored.alignments.length,
      );
      await expect(page.getByTestId('align-progress')).toHaveText(
        new RegExp(`${placedInFile} of \\d+ words placed`),
      );
      // The bank holds exactly the words that are not placed.
      await expect(page.getByTestId('align-bank').getByRole('button')).toHaveCount(
        stored.wordBank.length,
      );
    },
  );

  test(
    'clicking the already-selected verse in the rail keeps the word bank visible (#296)',
    { tag: ['@inc2', '@J5'] },
    async ({ page }, testInfo) => {
      writePinsWithOriginal();
      const stored = alignmentFile()!.chapters['1']['1'];
      await openAlign(page);

      // Click the active row twice: the first click can move the rail from
      // "no verse chosen" to 1:1; the second is always a same-verse click.
      const row = page.getByTestId('align-verse-list').locator('button[data-ref="1:1"]');
      await expect(row).toHaveAttribute('data-selected', 'true');
      await row.click();
      await row.click();

      await expect(page.getByTestId('align-session')).toBeVisible();
      await expect(page.getByTestId('align-bank').getByRole('button')).toHaveCount(
        stored.wordBank.length,
      );
      await expect(page.getByText('Opening the alignment…')).toHaveCount(0);

      // The artifact: the bank the page shows after the clicks. It holds no
      // timestamps, so each run writes the same bytes, and it must hold the
      // stored record's bank word for word, in verse order (#734).
      const artifact = {
        ref: '1:1',
        bank: await wordsOf(page.getByTestId('align-bank').getByRole('button')),
      };
      const artifactPath = testInfo.outputPath('j05-reselect-verse.json');
      fs.writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
      await testInfo.attach('j05-reselect-verse.json', { path: artifactPath, contentType: 'application/json' });
      const usfm = fs.readFileSync(path.join(rigRepo(SEEDED_PROJECT), 'ingredients', 'TIT.usfm'), 'utf8');
      const banked = new Set(stored.wordBank.map((w: { word: string; occurrence: number }) => `${w.word}/${w.occurrence}`));
      const inVerse = wordTokens(/\\v 1 ([^\\]*)/.exec(usfm)![1]).filter((t) => banked.has(`${t.text}/${t.occurrence}`));
      expect(artifact.bank).toEqual(inVerse.map((t) => t.text));
    },
  );

  test(
    'linking a word moves it from the bank into the card AND persists to the sidecar (FR-20)',
    { tag: ['@inc2', '@J5'] },
    async ({ page }) => {
      writePinsWithOriginal();
      await openAlign(page);

      const bank = page.getByTestId('align-bank').getByRole('button');
      const bankBefore = await bank.count();
      const word = (await bank.first().getAttribute('data-word')) ?? '';

      // Click the word, then a card that currently has nothing under it.
      await bank.first().click();
      await expect(bank.first()).toHaveAttribute('data-armed', '1');
      const emptyCard = page.locator('[data-testid^="align-card-"][data-count="0"]').first();
      const cardId = await emptyCard.getAttribute('data-testid');
      await emptyCard.click();

      await expect(page.getByTestId('align-bank').getByRole('button')).toHaveCount(bankBefore - 1);
      await expect(page.locator(`[data-testid="${cardId}"]`)).toHaveAttribute('data-count', '1');

      // …and it is on DISK, under the original word, with integer occurrences.
      await expect
        .poll(
          () => {
            const rec = alignmentFile()?.chapters?.['1']?.['1'];
            return rec?.alignments?.some((a: { bottomWords: Array<{ word: string }> }) =>
              a.bottomWords.some((w) => w.word === word.trim()),
            );
          },
          { timeout: 10_000 },
        )
        .toBe(true);

      const rec = alignmentFile()!.chapters['1']['1'];
      const everyWord = [
        ...rec.wordBank,
        ...rec.alignments.flatMap((a: { topWords: unknown[]; bottomWords: unknown[] }) => [
          ...a.topWords,
          ...a.bottomWords,
        ]),
      ] as Array<{ occurrence: unknown; occurrences: unknown }>;
      // I-2: the alignment stack fails wholesale on string occurrences.
      expect(everyWord.every((w) => typeof w.occurrence === 'number')).toBe(true);
      expect(everyWord.every((w) => typeof w.occurrences === 'number')).toBe(true);
      // I-3: the record states which draft it was made against.
      expect(rec.targetVerseMd5).toMatch(/^[0-9a-f]{32}$/);
      expect(rec.sourceVersion).toContain('el-x-koine_ugnt');
    },
  );

  test(
    'un-aligning returns the word to the bank, on screen and on disk (FR-20)',
    { tag: ['@inc2', '@J5'] },
    async ({ page }) => {
      writePinsWithOriginal();
      await openAlign(page);

      // The seeded sample already has placed words; take one back.
      const placedCard = page.locator('[data-testid^="align-card-"][data-count="1"]').first();
      const chip = placedCard.getByRole('button').first();
      const word = (await chip.getAttribute('data-word')) ?? '';
      const bankBefore = await page.getByTestId('align-bank').getByRole('button').count();
      await chip.click();

      await expect(page.getByTestId('align-bank').getByRole('button')).toHaveCount(bankBefore + 1);
      await expect
        .poll(
          () => {
            const rec = alignmentFile()?.chapters?.['1']?.['1'];
            return rec?.wordBank?.some((w: { word: string }) => w.word === word);
          },
          { timeout: 10_000 },
        )
        .toBe(true);
    },
  );

  // #735: a repeated word carries its occurrence number, as tC3 did — a
  // superscript only when the word occurs more than once in the verse, on the
  // target chips and on the original-language card headers, and in the
  // chip's accessible name. Titus 1:1: "de" ×5 in the bank, "Dios" placed
  // twice, Θεοῦ heads two cards; "siervo" and Παῦλος occur once.
  test(
    'repeated words show their occurrence number on chips and card headers; single words show none (#735)',
    { tag: ['@inc2', '@J5'] },
    async ({ page }, testInfo) => {
      writePinsWithOriginal();
      await openAlign(page);
      const stored = alignmentFile()!.chapters['1']['1'];
      type W = { word: string; occurrence: number; occurrences: number };
      const sup = (el: Element) => el.querySelector('sup')?.textContent ?? null;

      // Bank: each "de" chip shows its own occurrence and names it.
      const bankDe = (stored.wordBank as W[]).filter((w) => w.word === 'de');
      expect(bankDe.length).toBeGreaterThan(1);
      for (const w of bankDe) {
        const chip = page.getByTestId('align-bank').getByRole('button', { name: `de ${w.occurrence}`, exact: true });
        await expect(chip).toHaveCount(1);
        expect(await chip.evaluate(sup)).toBe(String(w.occurrence));
      }

      // Placed: the two "Dios" chips, one per θεός card.
      const placedDios = (stored.alignments as Array<{ bottomWords: W[] }>).flatMap((a) => a.bottomWords).filter((w) => w.word === 'Dios');
      expect(placedDios.length).toBe(2);
      for (const w of placedDios) {
        const chip = page.locator('[data-testid^="align-card-"]').getByRole('button', { name: `Dios ${w.occurrence}`, exact: true });
        await expect(chip).toHaveCount(1);
        expect(await chip.evaluate(sup)).toBe(String(w.occurrence));
      }

      // A word that occurs once: no number, name is the word alone.
      const siervo = page.locator('[data-testid^="align-card-"]').getByRole('button', { name: 'siervo', exact: true });
      await expect(siervo).toHaveCount(1);
      expect(await siervo.evaluate(sup)).toBeNull();

      // Card headers: each Θεοῦ card numbers its original word; Παῦλος does not.
      const headers = await page.locator('[data-testid^="align-card-"] [lang="el"]').evaluateAll((els) =>
        els.map((el) => ({ text: (el.firstChild?.textContent ?? '').trim(), sup: el.querySelector('sup')?.textContent ?? null })));
      const theou = (stored.alignments as Array<{ topWords: W[] }>).flatMap((a) => a.topWords).filter((w) => w.word === 'Θεοῦ');
      expect(theou.length).toBe(2);
      expect(headers.filter((h) => h.text.startsWith('Θεοῦ')).map((h) => h.sup)).toEqual(theou.map((w) => String(w.occurrence)));
      expect(headers.find((h) => h.text.startsWith('Παῦλος'))?.sup).toBeNull();
      // A header has no aria-label, so its number must stay readable (review round 1).
      await expect(page.locator('[data-testid^="align-card-"] [lang="el"] sup[aria-hidden]')).toHaveCount(0);

      // The number does not push its word down: a numbered chip is as tall as a
      // plain one beside it, in the bank and on the cards.
      const heights = (sel: string) => page.locator(sel).evaluateAll((els) =>
        els.map((el) => ({ sup: !!el.querySelector('sup'), h: Math.round(el.getBoundingClientRect().height) })));
      for (const sel of ['[data-testid="align-bank"] button', '[data-testid^="align-card-"] button[data-word]']) {
        const chips = await heights(sel);
        const withSup = chips.filter((c) => c.sup).map((c) => c.h);
        const plain = chips.filter((c) => !c.sup).map((c) => c.h);
        expect(withSup.length).toBeGreaterThan(0);
        expect(plain.length).toBeGreaterThan(0);
        expect(new Set([...withSup, ...plain]).size).toBe(1);
      }

      const shot = testInfo.outputPath('j05-735-occurrences.png');
      await page.getByTestId('align-session').screenshot({ path: shot });
      await testInfo.attach('j05-735-occurrences.png', { path: shot, contentType: 'image/png' });
    },
  );

  // #736: several bank words can be selected and placed on one card at once,
  // as in tC3. Ctrl/Cmd-click adds or removes a word; Shift-click adds the
  // range from the first selected word to the clicked one, in bank order
  // (Birch, Q1); the words need not be adjacent (Q2). A click on a card, or a
  // drag of any selected word, places the whole selection in one edit.
  const bankChip = (page: import('@playwright/test').Page, word: string) =>
    page.getByTestId('align-bank').locator(`button[data-word="${word}"]`).first();
  const armedWords = (page: import('@playwright/test').Page) =>
    wordsOf(page.getByTestId('align-bank').locator('button[data-armed="1"]'));
  const cardWords = (page: import('@playwright/test').Page, id: string) =>
    wordsOf(page.locator(`[data-testid="${id}"] button[data-word]`));
  const fileCardWords = (index: number) =>
    (alignmentFile()?.chapters?.['1']?.['1']?.alignments?.[index]?.bottomWords ?? []).map((w: { word: string }) => w.word);

  for (const how of ['click', 'drag', 'keyboard'] as const) {
    test(
      `several bank words selected with ${how === 'keyboard' ? 'Ctrl+Enter' : 'Ctrl-click'} go to one card in one edit, by ${how === 'drag' ? 'drag' : 'click'} (#736)`,
      { tag: ['@inc2', '@J5'] },
      async ({ page }, testInfo) => {
        writePinsWithOriginal();
        await openAlign(page);
        const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

        // Select "con" and "conocimiento" — not adjacent in the bank.
        if (how === 'keyboard') {
          await bankChip(page, 'con').focus();
          await page.keyboard.press(`${mod}+Enter`);
          await bankChip(page, 'conocimiento').focus();
          await page.keyboard.press(`${mod}+Enter`);
        } else {
          await bankChip(page, 'con').click({ modifiers: [mod] });
          await bankChip(page, 'conocimiento').click({ modifiers: [mod] });
        }
        expect((await armedWords(page)).sort()).toEqual(['con', 'conocimiento']);

        const emptyCard = page.locator('[data-testid^="align-card-"][data-count="0"]').first();
        const cardId = (await emptyCard.getAttribute('data-testid'))!;
        const index = Number(cardId.replace('align-card-', ''));
        const writes: string[] = [];
        page.on('request', (r) => {
          if (r.method() !== 'GET' && decodeURIComponent(r.url()).includes('alignments/TIT.json')) writes.push(r.url());
        });
        if (how === 'drag') await bankChip(page, 'conocimiento').dragTo(emptyCard);
        else await emptyCard.click();

        await expect(page.locator(`[data-testid="${cardId}"]`)).toHaveAttribute('data-count', '2');
        expect((await cardWords(page, cardId)).sort()).toEqual(['con', 'conocimiento']);
        expect(await armedWords(page)).toEqual([]);
        await expect.poll(() => fileCardWords(index).sort(), { timeout: 10_000 }).toEqual(['con', 'conocimiento']);
        // One edit: the alignment file was written once for the two words.
        await page.waitForTimeout(1_500);
        const artifact = { how, card: cardId, writes: writes.length, file: fileCardWords(index) };
        const artifactPath = testInfo.outputPath(`j05-736-${how}.json`);
        fs.writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
        await testInfo.attach(`j05-736-${how}.json`, { path: artifactPath, contentType: 'application/json' });
        expect(writes.length).toBe(1);
      },
    );
  }

  // #754 (Birch): a card keeps its words in verse order automatically, as tC3
  // did — wherever a word is dropped, however it got there. Titus 1:1 reads
  // "… según la fe de los escogidos …"; cards 6 (κατὰ), 7 (πίστιν) and 8
  // (ἐκλεκτῶν) start empty.
  const fileCard = (index: number) =>
    (alignmentFile()?.chapters?.['1']?.['1']?.alignments?.[index]?.bottomWords ?? []).map((w: { word: string; occurrence: number }) => `${w.word}/${w.occurrence}`);
  const place = async (page: import('@playwright/test').Page, word: string, index: number) => {
    const count = Number(await page.locator(`[data-testid="align-card-${index}"]`).getAttribute('data-count'));
    await bankChip(page, word).click();
    await page.locator(`[data-testid="align-card-${index}"]`).click();
    await expect(page.locator(`[data-testid="align-card-${index}"]`)).toHaveAttribute('data-count', String(count + 1));
  };

  test(
    '"la fe de los" placed as fe, la, los reads la, fe, los on the card and in the file; a drop on the left edge too (#754)',
    { tag: ['@inc2', '@J5'] },
    async ({ page }) => {
      writePinsWithOriginal();
      await openAlign(page);
      await expect(page.locator('[data-testid="align-card-7"]')).toHaveAttribute('data-count', '0');
      for (const w of ['fe', 'la', 'los']) await place(page, w, 7);
      expect(await cardWords(page, 'align-card-7')).toEqual(['la', 'fe', 'los']);
      await expect.poll(() => fileCard(7), { timeout: 10_000 }).toEqual(['la/1', 'fe/1', 'los/1']);

      // A drop on the far left of card 8, after "escogidos" is already there.
      await place(page, 'escogidos', 8);
      const card8 = page.locator('[data-testid="align-card-8"]');
      const box = (await card8.boundingBox())!;
      await bankChip(page, 'de').dragTo(card8, { targetPosition: { x: 3, y: box.height - 8 } });
      await expect(card8).toHaveAttribute('data-count', '2');
      expect(await cardWords(page, 'align-card-8')).toEqual(['de', 'escogidos']);
      await expect.poll(() => fileCard(8), { timeout: 10_000 }).toEqual(['de/1', 'escogidos/1']);
    },
  );

  test(
    'moving a word between cards and merging cards keep verse order (#754)',
    { tag: ['@inc2', '@J5'] },
    async ({ page }) => {
      writePinsWithOriginal();
      await openAlign(page);
      await place(page, 'la', 6);
      await place(page, 'los', 7);

      // Move "la" from card 6 onto card 7, after "los": the card reads la, los.
      await page.locator('[data-testid="align-card-6"] button[data-word="la"]').dragTo(page.locator('[data-testid="align-card-7"]'));
      await expect(page.locator('[data-testid="align-card-7"]')).toHaveAttribute('data-count', '2');
      expect(await cardWords(page, 'align-card-7')).toEqual(['la', 'los']);
      await expect.poll(() => fileCard(7), { timeout: 10_000 }).toEqual(['la/1', 'los/1']);

      // Put "fe" on card 6, then merge card 7 into card 6: la, fe, los.
      await place(page, 'fe', 6);
      await page.locator('[data-testid="align-card-7"] > div[draggable]').first().dragTo(page.locator('[data-testid="align-card-6"]'));
      await expect(page.locator('[data-testid="align-card-6"]')).toHaveAttribute('data-count', '3');
      expect(await cardWords(page, 'align-card-6')).toEqual(['la', 'fe', 'los']);
      await expect.poll(() => fileCard(6), { timeout: 10_000 }).toEqual(['la/1', 'fe/1', 'los/1']);
    },
  );

  test(
    'the selection survives a drop outside a card and is cleared by opening another verse (#736 Interruptions)',
    { tag: ['@inc2', '@J5'] },
    async ({ page }) => {
      writePinsWithOriginal();
      await openAlign(page);
      const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
      await bankChip(page, 'con').click({ modifiers: [mod] });
      await bankChip(page, 'conocimiento').click({ modifiers: [mod] });
      const before = alignmentFile()!.chapters['1']['1'];

      // A drop that misses every card (here: back onto the bank) places
      // nothing and keeps the selection.
      await bankChip(page, 'con').dragTo(page.getByTestId('align-bank'));
      expect((await armedWords(page)).sort()).toEqual(['con', 'conocimiento']);
      await expect(page.locator('[data-testid^="align-card-"] button[data-word="con"]')).toHaveCount(0);
      expect(alignmentFile()!.chapters['1']['1']).toEqual(before);

      // Opening another verse and coming back clears it.
      await page.getByTestId('align-verse-list').locator('button[data-ref="1:2"]').click();
      await expect(page.getByTestId('align-verse-list').locator('button[data-ref="1:2"]')).toHaveAttribute('data-selected', 'true');
      await page.getByTestId('align-verse-list').locator('button[data-ref="1:1"]').click();
      await expect(bankChip(page, 'con')).toBeVisible();
      expect(await armedWords(page)).toEqual([]);
    },
  );

  test(
    'Shift-click adds the range in bank order; Ctrl-click removes a word; un-aligning each returns it to verse order (#736)',
    { tag: ['@inc2', '@J5'] },
    async ({ page }) => {
      writePinsWithOriginal();
      await openAlign(page);
      const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
      const bank = page.getByTestId('align-bank').getByRole('button');
      const shown = await wordsOf(bank);
      const from = shown.indexOf('según');
      const to = shown.indexOf('los');
      expect(to).toBeGreaterThan(from + 1);

      await bankChip(page, 'según').click();
      await bankChip(page, 'los').click({ modifiers: ['Shift'] });
      const range = shown.slice(from, to + 1);
      expect(await armedWords(page)).toEqual(range);

      // Ctrl-click takes one word out of the selection.
      const dropped = range[1];
      await bank.nth(from + 1).click({ modifiers: [mod] });
      const selected = range.filter((_, i) => i !== 1);
      expect(await armedWords(page)).toEqual(selected);

      // A plain click selects that word alone, as before.
      await bankChip(page, 'verdad').click();
      expect(await armedWords(page)).toEqual(['verdad']);
      await bankChip(page, 'según').click();
      await bankChip(page, 'los').click({ modifiers: ['Shift'] });
      await bank.nth(from + 1).click({ modifiers: [mod] });
      expect(await armedWords(page)).toEqual(selected);
      expect(dropped).toBeTruthy();

      const emptyCard = page.locator('[data-testid^="align-card-"][data-count="0"]').first();
      const cardId = (await emptyCard.getAttribute('data-testid'))!;
      await emptyCard.click();
      await expect(page.locator(`[data-testid="${cardId}"]`)).toHaveAttribute('data-count', String(selected.length));

      // Un-align each placed word: the bank is back in its opening order.
      for (let n = selected.length; n > 0; n--) {
        await page.locator(`[data-testid="${cardId}"] button[data-word]`).first().click();
        await expect(page.locator(`[data-testid="${cardId}"]`)).toHaveAttribute('data-count', String(n - 1));
      }
      expect(await wordsOf(bank)).toEqual(shown);
    },
  );

  // #734: an un-aligned word goes back to its place in the verse, by click and
  // by drag alike, and the whole bank — on screen and on disk — reads in the
  // verse's word order. Titus 1:1 repeats "de" (5), "la" (3) and "y" (2).
  for (const how of ['click', 'drag'] as const) {
    test(
      `un-aligning "siervo" by ${how} puts the bank in verse order, on screen and on disk (#734)`,
      { tag: ['@inc2', '@J5'] },
      async ({ page }, testInfo) => {
        writePinsWithOriginal();
        await openAlign(page);

        const usfm = fs.readFileSync(path.join(rigRepo(SEEDED_PROJECT), 'ingredients', 'TIT.usfm'), 'utf8');
        const verseText = /\\v 1 ([^\\]*)/.exec(usfm)![1].trim();
        const key = (w: { word?: string; text?: string; occurrence: unknown }) => `${w.word ?? w.text}/${Number(w.occurrence)}`;
        const inVerseOrder = (bank: Array<{ word: string; occurrence: unknown }>) => {
          const banked = new Set(bank.map(key));
          return wordTokens(verseText).map(key).filter((k) => banked.has(k));
        };

        const bank = page.getByTestId('align-bank').getByRole('button');
        const bankBefore = await bank.count();
        // The seed stores this bank grouped by occurrence; the opened verse
        // shows it in verse order already, so the un-align below moves only
        // the returned word (#734 review round 1).
        const seeded = alignmentFile()!.chapters['1']['1'].wordBank as Array<{ word: string; occurrence: number }>;
        const screenBefore = await wordsOf(bank);
        expect(screenBefore).toEqual(inVerseOrder(seeded).map((k) => k.replace(/\/\d+$/, '')));
        const chip = page.locator('[data-testid^="align-card-"]').getByRole('button', { name: 'siervo', exact: true });
        if (how === 'click') await chip.click();
        else await chip.dragTo(page.getByTestId('align-bank'));
        await expect(bank).toHaveCount(bankBefore + 1);

        await expect
          .poll(() => alignmentFile()?.chapters?.['1']?.['1']?.wordBank?.some((w: { word: string }) => w.word === 'siervo'), { timeout: 10_000 })
          .toBe(true);
        const stored = alignmentFile()!.chapters['1']['1'].wordBank as Array<{ word: string; occurrence: number }>;
        const artifact = {
          how,
          verse: verseText,
          screenBefore,
          screen: await wordsOf(bank),
          disk: stored.map(key),
        };
        const artifactPath = testInfo.outputPath(`j05-734-${how}.json`);
        fs.writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
        await testInfo.attach(`j05-734-${how}.json`, { path: artifactPath, contentType: 'application/json' });

        expect(artifact.disk).toEqual(inVerseOrder(stored));
        expect(artifact.screen).toEqual(stored.map((w) => w.word));
        // Only "siervo" was added: every other word kept its place.
        const others = [...artifact.screen];
        others.splice(others.indexOf('siervo'), 1);
        expect(others).toEqual(screenBefore);
      },
    );
  }

  test(
    'a word is never in two places: total word count is conserved across edits',
    { tag: ['@inc2', '@J5'] },
    async ({ page }) => {
      writePinsWithOriginal();
      await openAlign(page);
      const totalOf = (rec: {
        wordBank: unknown[];
        alignments: Array<{ bottomWords: unknown[] }>;
      }) => rec.wordBank.length + rec.alignments.reduce((n, a) => n + a.bottomWords.length, 0);

      const before = totalOf(alignmentFile()!.chapters['1']['1']);

      await page.getByTestId('align-bank').getByRole('button').first().click();
      await page.locator('[data-testid^="align-card-"][data-count="0"]').first().click();
      await expect(page.getByTestId('align-progress')).toBeVisible();

      await expect
        .poll(() => totalOf(alignmentFile()!.chapters['1']['1']), { timeout: 10_000 })
        .toBe(before);
    },
  );

  test(
    '#271 Mark valid: the translator says the verse is done with words in the bank; an edit takes it back; Mark valid again restores it',
    { tag: ['@inc6', '@J5'] },
    async ({ page }) => {
      writePinsWithOriginal();
      await openAlign(page);
      const button = page.getByTestId('align-mark-valid');
      await expect(button).toHaveAttribute('data-active', '0');
      expect(alignmentFile()!.chapters['1']['1'].done).toBeUndefined();

      // Mark valid with 21 words still in the bank (the seeded 1:1).
      await button.click();
      await expect(button).toHaveAttribute('data-active', '1');
      await expect.poll(() => alignmentFile()?.chapters?.['1']?.['1']?.done, { timeout: 10_000 }).toBe(true);
      const marked = alignmentFile()!.chapters['1']['1'];
      expect(marked.wordBank.length).toBeGreaterThan(0);
      expect(marked.targetVerseMd5).toMatch(/^[0-9a-f]{32}$/);

      // Un-align one placed word: the edit takes Mark valid back, on screen and on disk.
      const placedChip = page.locator('[data-testid^="align-card-"][data-count="1"]').first().getByRole('button').first();
      await placedChip.click();
      await expect(button).toHaveAttribute('data-active', '0');
      await expect.poll(() => 'done' in (alignmentFile()?.chapters?.['1']?.['1'] ?? {}), { timeout: 10_000 }).toBe(false);

      // Mark valid again: valid again, with the word now in the bank.
      await button.click();
      await expect(button).toHaveAttribute('data-active', '1');
      await expect.poll(() => alignmentFile()?.chapters?.['1']?.['1']?.done, { timeout: 10_000 }).toBe(true);
    },
  );

  test(
    '#1 suggestions: off until switched on; a shown, unconfirmed suggestion leaves no trace; Mark valid is refused while it stands',
    { tag: ['@inc6', '@J5'] },
    async ({ page }) => {
      writePinsWithOriginal();
      await openAlign(page);
      const row = page.getByTestId('align-suggestions');
      const toggle = page.getByTestId('align-suggest-switch');
      // The switch is per client (platform client-settings); start from OFF
      // whatever an earlier run left, then prove OFF offers nothing.
      if (await toggle.isChecked()) await toggle.click();
      await expect(row).toHaveAttribute('data-status', 'off');
      await expect(page.getByTestId('align-suggest')).toHaveCount(0);

      // ON: the engine trains on the one aligned verse of the seed and says so.
      await toggle.click();
      await expect(row).toHaveAttribute('data-status', 'ready', { timeout: 30_000 });
      await expect(page.getByTestId('align-suggest-status')).toContainText('Drawn from 1 verse you have');

      const before = JSON.stringify(alignmentFile());
      const segmentsBefore = fs.readdirSync(path.join(rigRepo(SEEDED_PROJECT), 'ingredients', 'checking', 'journal')).length;
      // The one-verse corpus's answer is not deterministic and multi-card
      // phrases are omitted (O1), so wait for the reply either way; every
      // invariant below holds with chips or without, the chip-only steps run
      // when there is a chip.
      const chips = page.locator('[data-testid^="align-suggested-"]');
      const status = page.getByTestId('align-suggest-status');
      const replied = async () => (await chips.count()) > 0 || (await status.innerText()).includes('Nothing to suggest');
      await page.getByTestId('align-suggest').click();
      await expect.poll(replied, { timeout: 15_000 }).toBe(true);
      // Shown, not written: the sidecar and the journal are byte-identical,
      // the placed count ignores the proposal.
      await expect(page.getByTestId('align-progress')).toContainText('6 of 27');
      expect(JSON.stringify(alignmentFile())).toBe(before);
      expect(fs.readdirSync(path.join(rigRepo(SEEDED_PROJECT), 'ingredients', 'checking', 'journal')).length).toBe(segmentsBefore);
      if ((await chips.count()) > 0) {
        // Mark valid is refused while a suggestion stands.
        await page.getByTestId('align-mark-valid').click();
        await expect(page.getByTestId('align-mark-valid-refused')).toBeVisible();
        expect(alignmentFile()!.chapters['1']['1'].done).toBeUndefined();
        // Reject all: the words are back in the bank; still nothing on disk.
        await page.getByTestId('align-suggest-reject-all').click();
        await expect(chips).toHaveCount(0);
        expect(JSON.stringify(alignmentFile())).toBe(before);
      }
      // Leaving the verse discards a fresh proposal too (and writes nothing).
      await page.getByTestId('align-suggest').click();
      await expect.poll(replied, { timeout: 15_000 }).toBe(true);
      await page.getByTestId('align-next').click();
      await expect(page.getByTestId('align-ref-text')).not.toContainText('1:1');
      await expect(chips).toHaveCount(0);
      expect(JSON.stringify(alignmentFile())).toBe(before);
    },
  );

  test(
    '#1 suggestions: an accepted suggestion writes exactly what a manual link writes, through the same save path',
    { tag: ['@inc6', '@J5'] },
    async ({ page }) => {
      writePinsWithOriginal();
      await openAlign(page);
      const toggle = page.getByTestId('align-suggest-switch');
      if (!(await toggle.isChecked())) await toggle.click();
      await expect(page.getByTestId('align-suggestions')).toHaveAttribute('data-status', 'ready', { timeout: 30_000 });
      await page.getByTestId('align-suggest').click();
      // The engine's answer for a one-verse corpus is not deterministic (the
      // booster's split is randomized), and a prediction whose source words
      // span several cards is omitted (#1, option O1). Wait for the reply —
      // chips, or the "nothing to suggest" line — then take what appears.
      const chips = page.locator('[data-testid^="align-suggested-"]');
      await expect
        .poll(async () => (await chips.count()) > 0 || (await page.getByTestId('align-suggest-status').innerText()).includes('Nothing to suggest'), { timeout: 15_000 })
        .toBe(true);
      const recordBefore = alignmentFile()!.chapters['1']['1'];
      const placedBefore = recordBefore.alignments.reduce((n: number, a: { bottomWords: unknown[] }) => n + a.bottomWords.length, 0);
      let cardIndex: number;
      let word: string;
      if ((await chips.count()) > 0) {
        // Confirm the one chip by its check mark.
        const chip = chips.first();
        cardIndex = Number((await chip.getAttribute('data-testid'))!.replace('align-suggested-', ''));
        word = (await chip.getAttribute('data-word')) ?? '';
        await chip.click();
      } else {
        // Nothing proposed this run: place one bank word by hand on an empty
        // card — the manual path the accepted path must equal.
        const bank = page.getByTestId('align-bank').getByRole('button');
        word = (await bank.first().getAttribute('data-word')) ?? '';
        await bank.first().click();
        const emptyCard = page.locator('[data-testid^="align-card-"][data-count="0"]').first();
        cardIndex = Number((await emptyCard.getAttribute('data-testid'))!.replace('align-card-', ''));
        await emptyCard.click();
      }
      await expect
        .poll(() => alignmentFile()?.chapters?.['1']?.['1']?.alignments?.[cardIndex]?.bottomWords?.some((w: { word: string }) => w.word === word), { timeout: 10_000 })
        .toBe(true);
      const rec = alignmentFile()!.chapters['1']['1'];
      // The same shape a manual link writes (FR-20 case above): the word left
      // the bank, sits under the card, integers throughout, hash restamped.
      expect(rec.alignments.reduce((n: number, a: { bottomWords: unknown[] }) => n + a.bottomWords.length, 0)).toBe(placedBefore + 1);
      // Exactly one bank entry left, and it is this word (other occurrences of
      // the same text — "de" has five — stay banked).
      expect(recordBefore.wordBank.length - rec.wordBank.length).toBe(1);
      const gone = (recordBefore.wordBank as Array<{ word: string; occurrence: number }>).filter(
        (b) => !rec.wordBank.some((w: { word: string; occurrence: number }) => w.word === b.word && w.occurrence === b.occurrence),
      );
      expect(gone.map((w) => w.word)).toEqual([word]);
      const everyWord = [...rec.wordBank, ...rec.alignments.flatMap((a: { bottomWords: unknown[] }) => a.bottomWords)] as Array<{ occurrence: unknown; occurrences: unknown }>;
      expect(everyWord.every((w) => typeof w.occurrence === 'number' && typeof w.occurrences === 'number')).toBe(true);
      expect(rec.targetVerseMd5).toBe(recordBefore.targetVerseMd5);
      expect(rec.done).toBeUndefined(); // words remain in the bank
      // Un-aligning it by hand returns the word to the bank — the two paths meet.
      await page.locator(`[data-testid="align-card-${cardIndex}"]`).getByRole('button', { name: word }).click();
      await expect.poll(() => alignmentFile()?.chapters?.['1']?.['1']?.wordBank?.some((w: { word: string }) => w.word === word), { timeout: 10_000 }).toBe(true);
    },
  );

  test(
    '#1 suggestions: a pins write that keeps the original-language pin does not reopen the session or drop its proposals',
    { tag: ['@inc9', '@J5'] },
    async ({ page }) => {
      // The open adopts installed resources and backfills coverage into
      // resources.json (D41, D64). That write once reopened the session, and
      // a Suggest reply in flight was dropped (2026-10-06 J5 flake). Hold the
      // write until Suggest has answered, then let it land.
      writePinsWithOriginal();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      let held = false;
      await page.route(
        (url) => url.searchParams.get('ipath') === 'checking/resources.json' && url.search.includes('update_ingredients'),
        async (route) => {
          if (route.request().method() === 'POST') {
            held = true;
            await gate;
          }
          await route.continue();
        },
      );
      await openAlign(page);
      const toggle = page.getByTestId('align-suggest-switch');
      if (!(await toggle.isChecked())) await toggle.click();
      await expect(page.getByTestId('align-suggestions')).toHaveAttribute('data-status', 'ready', { timeout: 30_000 });
      await page.getByTestId('align-suggest').click();
      const chips = page.locator('[data-testid^="align-suggested-"]');
      const status = page.getByTestId('align-suggest-status');
      const replied = async () => (await chips.count()) > 0 || (await status.innerText()).includes('Nothing to suggest');
      await expect.poll(replied, { timeout: 15_000 }).toBe(true);
      const shown = { chips: await chips.count(), status: await status.innerText() };
      await expect.poll(() => held, { message: 'the open wrote resources.json', timeout: 10_000 }).toBe(true);
      const written = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('update_ingredients'));
      release();
      expect((await written).ok()).toBe(true);
      // A reopen shows within a few hundred ms (the flake's trace: 30 ms);
      // watch for two seconds that the proposals still stand.
      await page.waitForTimeout(2_000);
      await expect(chips).toHaveCount(shown.chips);
      await expect(status).toHaveText(shown.status);
    },
  );

  test(
    '#516 suggestions grow with every saved verse: align verse A, open verse B, Suggest answers in 2 s and the row never says "Learning"',
    { tag: ['@inc9', '@J5'] },
    async ({ page }, testInfo) => {
      writePinsWithOriginal();
      // Count the trainings the app posts: every `train` message to a worker.
      await page.addInitScript(() => {
        const w = window as unknown as { __trainPosts: number };
        w.__trainPosts = 0;
        const post = Worker.prototype.postMessage;
        Worker.prototype.postMessage = function (this: Worker, ...args: unknown[]) {
          if ((args[0] as { type?: string } | null)?.type === 'train') w.__trainPosts += 1;
          return Reflect.apply(post, this, args);
        } as typeof post;
      });
      const trainPosts = () => page.evaluate(() => (window as unknown as { __trainPosts: number }).__trainPosts);
      await openAlign(page);
      const row = page.getByTestId('align-suggestions');
      const status = page.getByTestId('align-suggest-status');
      const toggle = page.getByTestId('align-suggest-switch');
      if (!(await toggle.isChecked())) await toggle.click();
      // Only the first read of the project's verses may show as `reading`; once
      // ready, the row never leaves it.
      await expect(row).toHaveAttribute('data-status', 'ready', { timeout: 30_000 });
      // From here to the end an in-page observer records every data-status the
      // row takes: the assertions below sample single moments and would miss a
      // brief change of status after a save. It watches the body, not the row — the
      // session re-mounts when the verse changes — and records a row that is
      // added as well as a row whose attribute changes.
      await page.evaluate(() => {
        const ROW = '[data-testid="align-suggestions"]';
        const statusOf = (el: Element | null) => el?.getAttribute('data-status') ?? '(none)';
        const w = window as unknown as { __suggestStatuses: string[] };
        w.__suggestStatuses = [statusOf(document.querySelector(ROW))];
        new MutationObserver((mutations) => {
          for (const m of mutations) {
            if (m.type === 'attributes') {
              const el = m.target as Element;
              if (el.getAttribute('data-testid') === 'align-suggestions') w.__suggestStatuses.push(statusOf(el));
            }
            for (const node of m.addedNodes) {
              if (!(node instanceof Element)) continue;
              const added = node.matches(ROW) ? node : node.querySelector(ROW);
              if (added) w.__suggestStatuses.push(statusOf(added));
            }
          }
        }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-status'] });
      });
      await expect(status).toContainText('Drawn from 1 verse you have');

      // Verse A (1:2): place "Dios" on the θεός card by hand — one confirmed
      // save. The engine learns it without a retrain.
      await page.getByTestId('align-next').click();
      await expect(page.getByTestId('align-verse-list').locator('button[data-ref="1:2"]')).toHaveAttribute('data-selected', 'true');
      await page.getByTestId('align-bank').getByRole('button', { name: 'Dios', exact: true }).click();
      await page.locator('[data-testid^="align-card-"]', { hasText: 'Θε' }).first().click();
      // The save never flips the row out of `ready` — no "Learning…" state.
      await expect(row).toHaveAttribute('data-status', 'ready');

      // Verse B (1:3): Suggest answers within 2 seconds, from the memory that
      // now holds verse A (the pending save joins the memory ahead of the ask).
      await page.getByTestId('align-next').click();
      await expect(page.getByTestId('align-verse-list').locator('button[data-ref="1:3"]')).toHaveAttribute('data-selected', 'true');
      const chips = page.locator('[data-testid^="align-suggested-"]');
      await page.getByTestId('align-suggest').click();
      await expect.poll(async () => chips.count(), { timeout: 2_000 }).toBeGreaterThan(0);
      await expect(row).toHaveAttribute('data-status', 'ready');
      // The row's count is the memory's count: the seed verse plus verse A.
      await expect(status).toContainText('2 verses');
      expect(await status.innerText()).not.toContain('Learning');
      const proposals = await chips.count();

      // One training so far — the one at open — and none for the save. The
      // tool opened again trains once more, in the background (D93 point 3).
      const trainingsAtOpen = await trainPosts();
      expect(trainingsAtOpen).toBe(1);
      await page.getByTestId('align-rail').getByRole('button', { name: '← All checking tools' }).click();
      await page.getByTestId('open-align').click();
      await expect(page.getByTestId('align-session')).toBeVisible();
      await expect.poll(trainPosts, { timeout: 15_000 }).toBe(2);
      await expect(row).toHaveAttribute('data-status', 'ready');

      // The artifact: what the row reported, every status the observer saw
      // since the first `ready` (distinct and sorted, so each run writes the
      // same bytes), the trainings posted, and what Suggest proposed.
      const seen = await page.evaluate(() => (window as unknown as { __suggestStatuses: string[] }).__suggestStatuses);
      const artifact = {
        status: await row.getAttribute('data-status'),
        statusText: (await status.innerText()).trim(),
        statuses: [...new Set(seen)].sort(),
        trainings: { atOpen: trainingsAtOpen, afterReopen: await trainPosts() },
        proposals,
      };
      const artifactPath = testInfo.outputPath('j05-suggestions-grow.json');
      fs.writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
      await testInfo.attach('j05-suggestions-grow.json', { path: artifactPath, contentType: 'application/json' });
      expect(artifact.status).toBe('ready');
      // Never `training`, nor anything else, at any moment after the first ready.
      expect(seen.filter((st) => st !== 'ready')).toEqual([]);
      expect(artifact.proposals).toBeGreaterThan(0);
    },
  );

  test(
    'without an original-language text pinned, alignment says so instead of failing (C2.9 pattern)',
    { tag: ['@inc2', '@J5'] },
    async ({ page }) => {
      // This spec NEEDS the originalLanguage pins absent — drop exactly that
      // group (the helper carries everything else forward, lexicon included).
      writeProjectPins(SEEDED_PROJECT, PINS(), { dropOriginalLanguage: true });
      await page.goto('/');
      await page
        .getByTestId(`project-_local_/_local_/${SEEDED_PROJECT}`)
        .getByRole('button', { name: /Titus/ })
        .click();
      await page.getByRole('tab', { name: 'Check', exact: true }).click();
      await page.getByTestId('open-align').click();

      const unavailable = page.getByTestId('align-unavailable');
      await expect(unavailable).toBeVisible();
      await expect(unavailable).toContainText(/original-language/i);
    },
  );

  test(
    'Align opened before the book text arrives lists the verses when it arrives (#722: since #679 the book load waits for a checkpoint)',
    { tag: ['@inc2', '@J5'] },
    async ({ page }) => {
      writePinsWithOriginal();
      await page.goto('/');
      await page
        .getByTestId(`project-_local_/_local_/${SEEDED_PROJECT}`)
        .getByRole('button', { name: /Titus/ })
        .click();
      // The book rail row (Home's book tiles have the same name until the project opens).
      const titusRow = page.getByRole('complementary').getByRole('button', { name: /^Titus \d+%/ });
      await expect(titusRow).toBeVisible();

      // Hold the checkpoint that the next mode switch starts: the book load
      // (openBook → reconcileStaged) waits behind it, so s.bookRaw stays null.
      const hold = await holdCheckpoints(page);
      await page.getByRole('tab', { name: 'Check', exact: true }).click();
      await expect.poll(hold.held).toBeGreaterThan(0);
      await expect(page.getByTestId('open-align')).toBeVisible();
      await page.getByRole('tab', { name: 'Translate', exact: true }).click();
      await expect(page.getByRole('tab', { name: 'Translate', exact: true })).toHaveAttribute('aria-selected', 'true');
      await titusRow.click();
      await expect(page.getByText('Loading book…')).toBeVisible(); // the window: no book text
      await page.getByRole('tab', { name: 'Check', exact: true }).click();
      await page.getByTestId('open-align').click();
      // In the window: no book text yet, so the rail has no rows, and the
      // session says it is opening (never "Nothing to align yet").
      await expect(page.getByTestId('align-verse-list').locator('button')).toHaveCount(0);
      await expect.soft(page.getByText('Opening the alignment…')).toBeVisible();

      hold.release();
      await expect(page.getByTestId('align-verse-list').locator('button[data-ref="1:1"]')).toBeVisible();
      await expect(page.getByTestId('align-session')).toBeVisible();
    },
  );

  test(
    'Align opened before the book text arrives resumes at the remembered verse when it arrives (#722 class)',
    { tag: ['@inc2', '@J5'] },
    async ({ page }) => {
      writePinsWithOriginal();
      await page.goto('/');
      await page
        .getByTestId(`project-_local_/_local_/${SEEDED_PROJECT}`)
        .getByRole('button', { name: /Titus/ })
        .click();
      const titusRow = page.getByRole('complementary').getByRole('button', { name: /^Titus \d+%/ });
      await expect(titusRow).toBeVisible();
      await page.getByRole('tab', { name: 'Check', exact: true }).click();
      await page.getByTestId('open-align').click();
      await expect(page.getByTestId('align-session')).toBeVisible();
      // The remembered place (#136): the translator picks 1:3, then leaves the tool.
      const row13 = page.getByTestId('align-verse-list').locator('button[data-ref="1:3"]');
      await row13.click();
      await expect(row13).toHaveAttribute('data-selected', 'true');
      await page.getByTestId('align-rail').getByRole('button', { name: '← All checking tools' }).click();
      await expect(page.getByTestId('open-align')).toBeVisible();

      const hold = await holdCheckpoints(page);
      await page.getByRole('tab', { name: 'Translate', exact: true }).click();
      await expect.poll(hold.held).toBeGreaterThan(0);
      await titusRow.click();
      await expect(page.getByText('Loading book…')).toBeVisible(); // the window: no book text
      await page.getByRole('tab', { name: 'Check', exact: true }).click();
      await page.getByTestId('open-align').click();
      await expect(page.getByTestId('align-verse-list').locator('button')).toHaveCount(0);

      hold.release();
      await expect(page.getByTestId('align-session')).toBeVisible();
      await expect(row13).toHaveAttribute('data-selected', 'true');
      await expect(page.getByTestId('align-verse-list').locator('button[data-ref="1:1"]')).not.toHaveAttribute('data-selected', 'true');
    },
  );

  // #782: en_ult aligns one English phrase to two Hebrew words with one \zaln
  // inside another. Align (and Translate) read one level down, so Gen 1:1 lost
  // "the heavens" and 633 Genesis verses lost words. Genesis is the rig's own
  // en_ult GEN.usfm, added to a new project with Add a book → USFM (the issue's
  // steps). A whole-project USFM import of that file refuses it (not NFC).
  test(
    'Align and Translate show every word of en_ult Genesis, nested alignments included: 1:1 has "the heavens" (#782)',
    { tag: ['@inc9', '@J5'] },
    async ({ page }, testInfo) => {
      test.setTimeout(240_000);
      const usfm = sideloadedIngredient('en_ult', 'GEN.usfm');
      const name = `Genesis 782 ${Date.now()}`;
      const abbr = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      await page.goto('/');
      await importFixture(page, path.join(MANIFEST_DIR, 'usfm', '32-JON.usfm'), { kind: 'usfm', edits: { name, language: 'es-419' } });
      await expect(page.getByTestId('import-toast')).toBeVisible();
      await page.goto('/');
      const card = page.getByTestId(`project-_local_/_local_/${abbr}`);
      await card.getByRole('button', { name: 'Add a book' }).click();
      await page.getByTestId('ab-usfm-option').click();
      await page.getByTestId('ab-usfm-input').setInputFiles([{ name: 'GEN.usfm', mimeType: 'text/plain', buffer: Buffer.from(usfm) }]);
      await expect(page.getByTestId('ab-usfm-file')).toHaveAttribute('data-status', 'valid');
      await page.getByTestId('ab-usfm-add').click();
      await expect(page.getByTestId('ab-usfm')).toHaveCount(0, { timeout: 120_000 });
      await card.getByRole('button', { name: /Genesis/ }).click();
      await expect(page.getByRole('heading', { name: /^Genesis \d+$/ })).toBeVisible({ timeout: 120_000 });

      // The words of each verse as the file states them: every \w word, in file
      // order, read from the raw USFM without usfm-js. Footnotes are not verse text.
      const fileWords = new Map<string, string[]>();
      for (const chapter of usfm.replace(/\\f .*?\\f\*/gs, '').split(/\\c (?=\d)/).slice(1)) {
        const c = /^\d+/.exec(chapter)![0];
        const parts = chapter.split(/\\v (\d+(?:-\d+)?)\s/);
        for (let i = 1; i < parts.length; i += 2) fileWords.set(`${c}:${parts[i]}`, [...parts[i + 1].matchAll(/\\w ([^|\\]+)\|/g)].map((m) => m[1]));
      }
      const holdsInOrder = (text: string, words: string[]) => {
        let at = 0;
        for (const w of words) {
          const found = text.slice(at).search(new RegExp(`(?<![\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'u'));
          if (found < 0) return false;
          at += found + w.length;
        }
        return true;
      };

      let rail: Array<{ ref: string; text: string }> = [];
      await test.step('Align: every rail row holds its verse\'s words, in order', async () => {
        await page.getByRole('tab', { name: 'Check', exact: true }).click();
        await page.getByTestId('open-align').click();
        const rows = page.getByTestId('align-verse-list').locator('button[data-ref]');
        await expect(rows.first()).toBeVisible({ timeout: 120_000 });
        rail = await rows.evaluateAll((els) => els.map((el) => ({ ref: el.getAttribute('data-ref') ?? '', text: el.children[2]?.textContent ?? '' })));
        // Every row is a verse of the file. The rail leaves out 41 verses whose
        // `\v` follows `\q1` on the same line (3:15, 49:2-27, …): a separate defect
        // of the verse index, outside #782, so those verses are not compared here.
        expect(rail.length).toBeGreaterThan(1400);
        expect(rail.filter((r) => !fileWords.has(r.ref))).toEqual([]);
        const losing = rail.filter((r) => !holdsInOrder(r.text, fileWords.get(r.ref) ?? [])).map((r) => r.ref);
        expect(losing).toEqual([]);
        expect(rail.find((r) => r.ref === '1:1')?.text).toBe('In the beginning God created the heavens and the earth.');
        expect(rail.find((r) => r.ref === '1:4')?.text).toBe('And God saw the light, that {it was} good. Then God separated between the light and the darkness.');
      });

      // The rig holds no Hebrew Bible, so 1:1 opens on "not on this computer" and
      // shows no word bank here. The bank of Gen 1:1 is proven by the session
      // build in test/bookModel-nested-alignment.test.ts.
      await test.step('Align 1:1: the rail row the translator picks states the whole verse', async () => {
        const row = page.getByTestId('align-verse-list').locator('button[data-ref="1:1"]');
        await row.click();
        await expect(row).toHaveAttribute('data-selected', 'true');
        await expect(row).toContainText('In the beginning God created the heavens and the earth.');
        const shotPath = testInfo.outputPath('j05-gen-1-1-nested.png');
        await page.screenshot({ path: shotPath, animations: 'disabled' });
        await testInfo.attach('j05-gen-1-1-nested', { path: shotPath, contentType: 'image/png' });
        // The run's artifact: the counts, and 1:1 and 1:4 as the rail states them.
        const artifact = {
          rows: rail.length,
          rowsLosingWords: rail.filter((r) => !holdsInOrder(r.text, fileWords.get(r.ref) ?? [])).length,
          rail: rail.filter((r) => r.ref === '1:1' || r.ref === '1:4'),
        };
        const artifactPath = testInfo.outputPath('j05-gen-nested.json');
        fs.writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
        await testInfo.attach('j05-gen-nested.json', { path: artifactPath, contentType: 'application/json' });
      });

      await test.step('Translate states Gen 1:1 and 1:4 whole', async () => {
        const translate = page.getByRole('tab', { name: 'Translate', exact: true });
        if ((await translate.getAttribute('aria-selected')) !== 'true') await translate.click();
        const target = page.getByTestId('draft-target-text');
        await expect(target.filter({ hasText: 'In the beginning' })).toContainText('In the beginning God created the heavens and the earth.', { timeout: 60_000 });
        await expect(target.filter({ hasText: 'And God saw' }).first()).toContainText('And God saw the light, that {it was} good.');
        const shotPath = testInfo.outputPath('j05-gen-1-translate.png');
        await page.screenshot({ path: shotPath, animations: 'disabled' });
        await testInfo.attach('j05-gen-1-translate', { path: shotPath, contentType: 'image/png' });
      });
    },
  );
});

// Issue #62 teardown: after this journey's mutations, every journaled local
// project must be a verified byte-for-byte materialization of its journal.
test.afterAll(async () => {
  try {
    await verifyAllJournaledProjects();
  } finally {
    // Leave the shared fixture as we found it (#124 review round 3): this
    // file hand-mutates the seeded project's pins, and without the restore a
    // targeted or failed run leaves the rig stripped for the next user.
    resetSeededChecking();
  }
});
