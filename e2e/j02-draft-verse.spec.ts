// J2 — Open book → draft verses beside sources → autosave → progress updates
// docs/JOURNEYS.md J2 · shipped v4.0.0-alpha.1 · run LTR and RTL (the J10 axis)
// Increment 1 slice (@inc1): draft one verse in the seeded project and prove on disk —
//   · the typed text was saved to ingredients/TIT.usfm through the store (FR-6)
//   · D8 byte-strict: nothing outside the edited verse changed (FR-7)
//   · no alignment markup written at rest (FR-8, I-1)
//   · no auto-commit — commits happen only at checkpoints (FR-34, W-4)
import { test, expect } from './helpers/test';
import type { Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { verifyAllJournaledProjects } from './helpers/journal';
import { QA_SERVER, USER, dropOrigin, git } from './helpers/door43Share';
import { recordExternal } from './helpers/externalRequests';
import { captureDownload } from './helpers/export';
import { proveHelpsDragAndToggle, proveHelpsToolbar } from './helpers/helps';
import { lane } from './lane.mjs';
import {
  SEEDED_PROJECT,
  TC4_ROOT,
  readIngredient,
  rigRepo,
  commitCount,
  lastCommitMessage,
  byteStrictViolation,
  verseTextSpan,
  sideloadedIngredient,
  resetPlaces,
  writePlace,
} from './helpers/rig';

const BOOK_IPATH = 'ingredients/TIT.usfm';
// TIT 2:1 is an undrafted stub ("___") in the seeded fixture — the natural first draft.
const CHAPTER = 2;
const VERSE = 1;
const DRAFT_TEXT = 'Pero tú habla lo que está de acuerdo con la sana doctrina.';

/** The seeded project's journal segment files (every actor), newest last. */
function segmentFiles(): string[] {
  const journal = path.join(rigRepo(SEEDED_PROJECT), 'ingredients', 'checking', 'journal');
  if (!fs.existsSync(journal)) return [];
  return fs
    .readdirSync(journal)
    .flatMap((actor) => {
      const dir = path.join(journal, actor, 'segments');
      return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.action.json')).map((f) => path.join(dir, f)) : [];
    })
    .sort();
}

/** The events of one segment file (the §8.1 container: `body` is the JSON text of `{ events }`). */
function readSegmentEvents(file: string): SegmentEvent[] {
  const container = JSON.parse(fs.readFileSync(file, 'utf8')) as { body: string };
  return (JSON.parse(container.body) as { events: SegmentEvent[] }).events;
}

type SegmentEvent = {
  op: string;
  chapter?: string;
  verse?: string;
  text?: string;
  skeleton?: string;
  transitions?: Record<string, { text: string; sources: Array<{ key: string; ts: string }> }>;
  dispositions?: Array<{ surface: string; key?: string; action: string }>;
};

/** The events published since `before` — the journey's own writes. */
const eventsSince = (before: Set<string>): SegmentEvent[] =>
  segmentFiles().filter((f) => !before.has(f)).flatMap((f) => readSegmentEvents(f));

/** The whole verse line `\\v <key> <body>\n` of one verse of Titus 2 in the file. */
const verseLine = (usfm: string, verse: number): { start: number; end: number } => {
  const span = verseTextSpan(usfm, CHAPTER, verse);
  return { start: span.start - `\\v ${verse} `.length, end: span.end };
};

/** Titus's percent in its own rail row (every rail row may show one). */
const titusRailPct = (page: Page) => page.locator('aside button', { hasText: 'Titus' }).first().getByText(/%$/);

// #329: a Home tile returns to where this client last worked; this journey opens
// books from their tiles and states its own start (Translate, chapter 1). With no
// place, a tile opens in Understand (D87), so the start is written as a place.
test.beforeEach(() => {
  resetPlaces();
  writePlace(SEEDED_PROJECT, 'TIT', { mode: 'draft', chapter: 1 });
});
// #506: the first test gives the seeded project an `origin`; none stays behind.
test.afterEach(() => {
  dropOrigin(SEEDED_PROJECT);
});

test.describe('J2 — a translator drafts a verse', () => {
  test(
    'open the seeded project, draft verse Titus 2:1, and the save is byte-strict with no auto-commit',
    { tag: ['@inc1', '@J2'] },
    async ({ page }, testInfo) => {
      const bytesBefore = readIngredient(SEEDED_PROJECT, BOOK_IPATH);
      const commitsBefore = commitCount(SEEDED_PROJECT);

      await test.step('open the app — the seeded project is listed', async () => {
        // A project on the QA server: its card names the server (#506). The origin is the
        // record of a share (D84 point 1), read once when Home first loads.
        dropOrigin(SEEDED_PROJECT); // an origin left by a killed run
        git(rigRepo(SEEDED_PROJECT), 'remote', 'add', 'origin', `${QA_SERVER}/${USER.username}/${SEEDED_PROJECT}.git`);
        await page.goto('/');
        await expect(
          page.getByText('Equipo Ejemplo — Tito y Jonás').first(),
        ).toBeVisible();
      });

      await test.step('open the book Titus at chapter 2', async () => {
        await page.getByTestId('project-_local_/_local_/sample_burrito').getByRole('button', { name: /Titus/ }).click();
        await page.getByRole('button', { name: '2', exact: true }).click();
      });

      await test.step('verse 1 is undrafted — start it (the first stub in the chapter)', async () => {
        await page.getByRole('tab', { name: 'Verse', exact: true }).click();
        await page.getByRole('button', { name: 'Start this verse' }).first().click();
      });

      await test.step('type the draft and leave the verse (blur saves)', async () => {
        const editor = page.getByRole('textbox', { name: 'Verse 1' });
        await editor.fill(DRAFT_TEXT);
        await editor.blur();
      });

      await test.step('the save indicator confirms a real write', async () => {
        await expect(page.getByText('Saved')).toBeVisible();
        await page.getByRole('tab', { name: 'Section', exact: true }).click();
      });

      await test.step('the typed text is on disk in ingredients/TIT.usfm (FR-6)', async () => {
        await expect
          .poll(() => readIngredient(SEEDED_PROJECT, BOOK_IPATH).toString('utf8'), {
            timeout: 10_000,
          })
          .toContain(DRAFT_TEXT);
      });

      await test.step('the write was byte-strict outside Titus 2:1 (FR-7 / D8)', async () => {
        const bytesAfter = readIngredient(SEEDED_PROJECT, BOOK_IPATH);
        expect(byteStrictViolation(bytesBefore, bytesAfter, CHAPTER, VERSE)).toBeNull();
      });

      await test.step('no alignment markup was written at rest (FR-8 / I-1)', async () => {
        const after = readIngredient(SEEDED_PROJECT, BOOK_IPATH).toString('utf8');
        expect(after).not.toContain('\\zaln');
      });

      // #536: counted BEFORE the step below leaves the project. Leaving is a checkpoint
      // (D9, #183) that the app starts in the background (startLeaveCheckpoint), so a
      // count taken after the Switch project click raced that commit.
      await test.step('nothing auto-committed — commits are checkpoint-only (FR-34 / W-4)', async () => {
        expect(commitCount(SEEDED_PROJECT)).toBe(commitsBefore);
      });

      await test.step('the project card names the QA Door43 server in its meta line (#506)', async () => {
        // The journeys run on the Vite dev server, so account and write calls
        // target qa.door43.org and the card must say so. The top bar has no label.
        await page.getByTitle('Switch project').click();
        const meta = page.getByTestId('share-state-_local_/_local_/sample_burrito');
        await expect(meta).toHaveText(`Shared at qa.door43.org/${USER.username}/${SEEDED_PROJECT}`);
        await expect(page.getByTestId('dcs-server-label')).toHaveCount(0);
        // The run's artifact, kept on disk under test-results/: the meta line text
        // and a screenshot of the card.
        const textPath = testInfo.outputPath('card-meta.txt');
        fs.writeFileSync(textPath, `${(await meta.textContent()) ?? ''}\n`);
        await testInfo.attach('card-meta.txt', { path: textPath, contentType: 'text/plain' });
        const shotPath = testInfo.outputPath('project-card.png');
        await page.getByTestId('project-_local_/_local_/sample_burrito').screenshot({ path: shotPath });
        await testInfo.attach('project-card.png', { path: shotPath, contentType: 'image/png' });
      });

      await test.step('leaving the project makes one checkpoint commit and no other (D9, #183)', async () => {
        // Started, not awaited, by the app: poll the disk until it lands.
        await expect.poll(() => commitCount(SEEDED_PROJECT), { timeout: 20_000 }).toBe(commitsBefore + 1);
        expect(lastCommitMessage(SEEDED_PROJECT)).toMatch(/^Checkpoint, leaving the project: .*TIT text/);
      });
    },
  );

  test(
    'draft a two-verse section (Titus 2:9–10): type it straight through, place verse 10, save — the bytes and one text.verse.set per verse land on disk (#141, J2 revised)',
    { tag: ['@inc5', '@J2'] },
    async ({ page }, testInfo) => {
      // ULT chunks Titus 2 at 1, 3, 6, 9, 11, 14, 15 (\ts\* markers in the
      // sideloaded en_ult TIT.usfm), so 9–10 is a two-verse section no sibling
      // test touches. Verse 10 is placed at "no".
      const VERSE_9 = 'Exhorta a los siervos a que se sujeten a sus amos y a que agraden en todo';
      const VERSE_10 = 'no defraudando sino mostrando toda buena fe';
      const bytesBefore = readIngredient(SEEDED_PROJECT, BOOK_IPATH);
      const segmentsBefore = new Set(segmentFiles());

      await page.goto('/');
      await page.getByTestId('project-_local_/_local_/sample_burrito').getByRole('button', { name: /Titus/ }).click();
      await page.getByRole('button', { name: '2', exact: true }).click();

      await test.step('the section row exists and opens the section card in Type mode', async () => {
        await page.getByRole('button', { name: 'Draft section 9–10' }).click();
        await expect(page.getByText('Drafting 9–10')).toBeVisible();
        await page.getByRole('textbox', { name: 'Section 9–10' }).fill(`${VERSE_9} ${VERSE_10}`);
      });

      await test.step('Place verse numbers: pick up 10 from the bank, drop it on "no"', async () => {
        await page.getByRole('tab', { name: 'Place verse numbers' }).click();
        // Verse 9 begins the section and is fixed: no pin for it in the bank.
        await expect(page.getByTestId('pin-bank').getByRole('button', { name: 'Move where verse 9 begins' })).toHaveCount(0);
        // The instruction while 10 waits in the bank and no number is in hand (#604).
        const idle = page.getByTestId('pin-bank').getByText('Click a verse number, then click the word that begins the verse.');
        await expect(idle).toBeVisible();
        // What the box shows, hidden text left out.
        const shown = async () => (await page.getByTestId('pin-bank').innerText()).replace(/\s+/g, ' ').trim();
        const idleText = await shown();
        await page.getByTestId('pin-bank').getByRole('button', { name: 'Move where verse 10 begins' }).click();
        await expect(idle).toBeHidden();
        await page.getByRole('button', { name: 'Begin verse 10 at no' }).click();
        // Placed: the bank is empty and the pin sits in the text before "no".
        await expect(page.getByTestId('pin-bank').getByRole('button', { name: /Move where verse/ })).toHaveCount(0);
        await expect(page.getByTestId('place-words').getByRole('button', { name: 'Move where verse 10 begins' })).toBeVisible();
        const empty = page.getByTestId('pin-bank').getByText('Every verse is placed. Click a verse number to move where its verse begins.');
        await expect(empty).toBeVisible();
        await expect(idle).toBeHidden();
        // The run's artifact: all that the bank shows in the two states.
        const bankPath = testInfo.outputPath('j02-place-instructions.txt');
        fs.writeFileSync(bankPath, [
          `10 waits in the bank: ${idleText}`,
          `every verse is placed: ${await shown()}`,
          '',
        ].join('\n'));
        await testInfo.attach('j02-place-instructions.txt', { path: bankPath, contentType: 'text/plain' });
      });

      await test.step('the placed 10 moves with two mouse clicks while the bank is empty, then back with a mouse drag (#598, D70.3)', async () => {
        const words = page.getByTestId('place-words');
        const pin = words.getByRole('button', { name: 'Move where verse 10 begins' });
        const hint = page.getByTestId('pin-bank').getByText(/^Click the word where verse \d+ begins$/);
        await expect(words).toHaveText(/todo\s*10\s*no defraudando/);
        // The words do not move when the number is picked up: the instruction
        // has its place in the bank before it shows. So the release of this
        // click stays on the number, and no other word arrives under it.
        // Positions are from the card's corner: the page may scroll on a click.
        const boxes = async () => {
          const card = (await page.getByTestId('section-editor').boundingBox())!;
          const at = async (l: typeof pin) => {
            const box = (await l.boundingBox())!;
            return { x: box.x - card.x, y: box.y - card.y };
          };
          return JSON.stringify([await at(pin), await at(words.getByText('mostrando', { exact: true }))]);
        };
        const before = await boxes();
        await expect(hint).toBeHidden();
        await pin.click();
        await expect(hint).toBeVisible();
        await expect(hint).toHaveText('Click the word where verse 10 begins');
        const inHand = await boxes();
        expect(inHand).toBe(before);
        await expect(words).toHaveText(/todo\s*10\s*no defraudando/);
        await page.getByRole('button', { name: 'Begin verse 10 at mostrando' }).click();
        await expect(hint).toBeHidden();
        await expect(words).toHaveText(/todo\s*no defraudando sino\s*10\s*mostrando/);
        const moved = (await words.textContent()) ?? '';
        await pin.dragTo(words.getByText('no', { exact: true }));
        await expect(words).toHaveText(/todo\s*10\s*no defraudando sino\s*mostrando/);
        // A double click on the number picks it up and puts it back.
        await pin.dblclick();
        await expect(hint).toBeHidden();
        await expect(words).toHaveText(/todo\s*10\s*no defraudando sino\s*mostrando/);
        // The run's artifact: the positions before and after the pick-up, and
        // the words after each move.
        const movePath = testInfo.outputPath('j02-click-move-placed-pin.txt');
        fs.writeFileSync(movePath, [
          `pin and "mostrando" before the pick-up: ${before}`,
          `pin and "mostrando" with the number in hand: ${inHand}`,
          `after the click on "mostrando": ${moved}`,
          `after the drag back and the double click: ${(await words.textContent()) ?? ''}`,
          '',
        ].join('\n'));
        await testInfo.attach('j02-click-move-placed-pin.txt', { path: movePath, contentType: 'text/plain' });
      });

      await test.step('Save section writes through the scheduler', async () => {
        await page.getByRole('button', { name: 'Save section' }).click();
        await expect(page.getByTestId('save-indicator')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
        await expect(page.getByTestId('section-editor')).toHaveCount(0);
      });

      await test.step('the file is the seeded file with exactly those two stubs replaced (FR-7 / D8)', async () => {
        // The WHOLE expected file, not a permitted window: a window between the
        // two edits would also accept duplicated text or a stray marker
        // (Codex round 1). Every other byte must be the seeded byte.
        const before = bytesBefore.toString('utf8');
        // Splice by SPAN, not by text: `\v 9 ___` also occurs in Titus 1 and 3.
        // Verse 10 first — replacing it does not move verse 9's offsets.
        const put = (usfm: string, verse: number, text: string) => {
          const span = verseTextSpan(usfm, CHAPTER, verse);
          expect(usfm.slice(span.start, span.end)).toBe('___\n'); // the seeded stub
          return usfm.slice(0, span.start) + text + '\n' + usfm.slice(span.end);
        };
        const expected = put(put(before, 10, VERSE_10), 9, VERSE_9);
        await expect
          .poll(() => readIngredient(SEEDED_PROJECT, BOOK_IPATH).toString('utf8'), { timeout: 10_000 })
          .toBe(expected);
      });

      await test.step('the journal carries exactly one text.verse.set per edited verse', async () => {
        const events = segmentFiles()
          .filter((f) => !segmentsBefore.has(f))
          .flatMap((f) => readSegmentEvents(f))
          .filter((e) => e.op === 'text.verse.set');
        const slots = events.map((e) => `${e.chapter}:${e.verse}`).sort();
        expect(slots).toEqual(['2:10', '2:9']);
        // A §8.4 slot's text runs to the next marker, line terminator included.
        expect(events.find((e) => e.verse === '9')?.text?.trim()).toBe(VERSE_9);
        expect(events.find((e) => e.verse === '10')?.text?.trim()).toBe(VERSE_10);
      });

      await test.step('the verse-by-verse form is still there: a drafted verse opens alone', async () => {
        await page.getByRole('tab', { name: 'Verse', exact: true }).click();
        await page.getByTitle('Edit this verse').filter({ hasText: 'defraudando' }).click();
        await expect(page.getByRole('textbox', { name: 'Verse 10' })).toHaveValue(VERSE_10);
        await page.getByRole('button', { name: 'Cancel' }).click();
        await expect(page.getByRole('textbox', { name: 'Verse 10' })).toHaveCount(0);
        await page.getByRole('tab', { name: 'Section', exact: true }).click();
      });
    },
  );

  test(
    'empty a drafted section (Titus 2:9–10): delete all the text, or leave only the verse numbers, confirm the save — both verses are the ___ stub again, one text.verse.set each, and the percentage goes down (#600)',
    { tag: ['@inc9', '@J2'] },
    async ({ page }, testInfo) => {
      const VERSE_9 = 'Exhorta a los siervos a que se sujeten a sus amos y a que agraden en todo';
      const VERSE_10 = 'no defraudando sino mostrando toda buena fe';
      test.setTimeout(60_000); // four saves
      const onDisk = () => readIngredient(SEEDED_PROJECT, BOOK_IPATH).toString('utf8');
      const railPct = titusRailPct(page);
      const sectionText = page.getByRole('textbox', { name: 'Section 9–10' });
      const saveButton = page.getByRole('button', { name: 'Save section' });
      const confirm = page.getByRole('dialog', { name: 'Remove all the text of section 9–10?' });
      const record: string[] = [];

      await page.goto('/');
      await page.getByTestId('project-_local_/_local_/sample_burrito').getByRole('button', { name: /Titus/ }).click();
      await page.getByRole('button', { name: '2', exact: true }).click();

      /** Draft 9 and 10 as two verses; the file is the proof (the #141 case may have drafted them already). */
      const draftTwoVerses = async (gap = '') => {
        await page.getByRole('button', { name: 'Draft section 9–10' }).click();
        await sectionText.fill(`9 ${VERSE_9}\n${gap ? '\n' : ''}10 ${VERSE_10}`);
        await saveButton.click();
        await expect(page.getByTestId('section-editor')).toHaveCount(0);
        await expect
          .poll(() => { const usfm = onDisk(); return usfm.slice(verseLine(usfm, 9).start, verseLine(usfm, 10).end); }, { timeout: 10_000 })
          .toBe(`\\v 9 ${VERSE_9}\n${gap}\\v 10 ${VERSE_10}\n`);
      };

      /** Leave `typed` in the drafted section, save it, and prove the result on disk. */
      const emptyWith = async (name: string, typed: string, gap = '') => {
        await draftTwoVerses(gap);
        const drafted = onDisk();
        const pctDrafted = (await railPct.textContent()) ?? '';
        const segmentsBefore = new Set(segmentFiles());
        // The whole expected file: the drafted file with the two bodies as the stub.
        // By line, not by slot: a verse's slot also holds a \p line that follows it.
        const stub = (usfm: string, verse: number, body: string) => {
          const parts = usfm.split(`\\v ${verse} ${body}\n`);
          expect(parts).toHaveLength(2);
          return parts.join(`\\v ${verse} ___\n`);
        };
        const expected = stub(stub(drafted, 10, VERSE_10), 9, VERSE_9);

        await page.getByRole('button', { name: 'Draft section 9–10' }).click();
        await expect(sectionText).toHaveValue(`9 ${VERSE_9}\n${gap ? '\n' : ''}10 ${VERSE_10}`);
        await sectionText.fill(typed);
        await expect(saveButton).toBeEnabled();
        record.push(`${name}: Save section enabled=${await saveButton.isEnabled()}`);

        // The save asks first. Escape and "Keep editing" write nothing and keep the card.
        await saveButton.click();
        await expect(confirm).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(confirm).toHaveCount(0);
        await expect(sectionText).toHaveValue(typed);
        expect(onDisk()).toBe(drafted);
        await saveButton.click();
        await confirm.getByRole('button', { name: 'Keep editing' }).click();
        await expect(confirm).toHaveCount(0);
        await expect(sectionText).toHaveValue(typed);
        expect(onDisk()).toBe(drafted);
        record.push(`${name}: confirmation shown=true, file after "Keep editing" unchanged=${onDisk() === drafted}`);

        await saveButton.click();
        await confirm.getByRole('button', { name: 'Remove the text' }).click();
        await expect(page.getByTestId('save-indicator')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
        await expect(page.getByTestId('section-editor')).toHaveCount(0);
        await expect.poll(onDisk, { timeout: 10_000 }).toBe(expected);

        const slots = () => eventsSince(segmentsBefore).filter((e) => e.op === 'text.verse.set').map((e) => `${e.chapter}:${e.verse}=${JSON.stringify(e.text)}`).sort();
        // A §8.4 slot's text runs to the next verse marker: verse 9's holds the \p line.
        await expect.poll(slots, { timeout: 10_000 }).toEqual(['2:10="___\\n"', `2:9=${JSON.stringify(`___\n${gap}`)}`]);
        record.push(`${name}: text.verse.set events=${slots().join(' ')}`);

        const pctEmptied = (await railPct.textContent()) ?? '';
        expect(Number.parseInt(pctEmptied, 10)).toBeLessThan(Number.parseInt(pctDrafted, 10));
        record.push(`${name}: Titus percent drafted=${pctDrafted} emptied=${pctEmptied}`);
        return expected;
      };

      await test.step('all the Type text deleted: Save section is on, asks, and writes the two stubs', async () => {
        await emptyWith('empty text', '');
      });

      const stored = await test.step('only the section\'s own verse numbers left: the save is the same', async () => {
        return emptyWith('verse numbers only', '9\n10');
      });

      await test.step('a paragraph break between the two verses stays: the save changes the verse bodies only', async () => {
        const kept = await emptyWith('paragraph break between the verses', '', '\\p\n');
        const usfm = onDisk();
        expect(kept).toBe(usfm);
        const between = usfm.slice(verseLine(usfm, 9).start, verseLine(usfm, 10).end);
        expect(between).toBe('\\v 9 ___\n\\p\n\\v 10 ___\n');
        record.push(`paragraph break between the verses: lines of 9 and 10=${JSON.stringify(between)}`);
      });

      await test.step('a section with no draft has nothing to save: Save section stays off', async () => {
        await page.getByRole('button', { name: 'Draft section 9–10' }).click();
        await expect(sectionText).toHaveValue('');
        await expect(saveButton).toBeDisabled();
        record.push(`undrafted section, empty text: Save section enabled=${await saveButton.isEnabled()}`);
        await page.getByTestId('section-editor').getByRole('button', { name: 'Cancel' }).click();
      });

      await test.step('leave the section as two plain verses for the cases that follow', async () => {
        // A save with text and no blank line removes the paragraph break again.
        await draftTwoVerses();
      });

      // The run's artifacts: the recorded states and the stored book.
      const textPath = testInfo.outputPath('j02-empty-section.txt');
      fs.writeFileSync(textPath, `${record.join('\n')}\n`);
      await testInfo.attach('j02-empty-section.txt', { path: textPath, contentType: 'text/plain' });
      const usfmPath = testInfo.outputPath('j02-empty-section-TIT.usfm');
      fs.writeFileSync(usfmPath, stored);
      await testInfo.attach('j02-empty-section-TIT.usfm', { path: usfmPath, contentType: 'text/plain' });
    },
  );

  test(
    'create a verse span (Titus 2:9-10): stack verse 10 on verse 9 in Place mode, save — one \\v 9-10 line and one text.structure.apply on disk (#63, D70)',
    { tag: ['@inc5', '@J2'] },
    async ({ page }, testInfo) => {
      const VERSE_9 = 'Exhorta a los siervos a que se sujeten a sus amos y a que agraden en todo';
      const VERSE_10 = 'no defraudando sino mostrando toda buena fe';
      test.setTimeout(60_000); // seven saves and four page loads
      const onDisk = () => readIngredient(SEEDED_PROJECT, BOOK_IPATH).toString('utf8');
      /** The lines of Titus 2:9 and 2:10 in the file, while they are two verses. */
      const twoVerseLines = () => {
        const usfm = onDisk();
        return usfm.slice(verseLine(usfm, 9).start, verseLine(usfm, 10).end);
      };

      await page.goto('/');
      await page.getByTestId('project-_local_/_local_/sample_burrito').getByRole('button', { name: /Titus/ }).click();
      await page.getByRole('button', { name: '2', exact: true }).click();
      // #572 (D94): the journey reads Titus's percent in its own rail row at
      // four states of verses 9 and 10. It sets each state itself, so it does
      // not need the sibling #141 case to have drafted them.
      const railPct = titusRailPct(page);
      const railNow = async () => (await railPct.textContent()) ?? '';
      // The row reads "9–10" for two verses and "9-10" for the one span verse.
      const openSection = () => page.getByRole('button', { name: /^Draft section 9[–-]10$/ }).click();
      const sectionText = page.getByRole('textbox', { name: /^Section 9[–-]10$/ });
      const saveSection = async () => {
        await page.getByRole('button', { name: 'Save section' }).click();
        await expect(page.getByTestId('save-indicator')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
        await expect(page.getByTestId('section-editor')).toHaveCount(0);
      };
      const stackVerse10OnTheFirstWord = async () => {
        await openSection();
        await sectionText.fill(`${VERSE_9} ${VERSE_10}`);
        await page.getByRole('tab', { name: 'Place verse numbers' }).click();
        await page.getByTestId('pin-bank').getByRole('button', { name: 'Move where verse 10 begins' }).click();
        // The first word carries the fixed verse 9: dropping 10 there joins them.
        await page.getByRole('button', { name: 'Join verse 10 to verse 9 at Exhorta' }).click();
        await expect(page.getByTestId('pin-bank').getByRole('button', { name: /Move where verse/ })).toHaveCount(0);
        await expect(page.getByTestId('place-words').getByRole('button', { name: 'Move where verse 10 begins' })).toBeVisible();
      };

      /** Empty one verse in the verse-by-verse form: it returns to the `___` stub. */
      const clearVerse = async (key: string, word: string) => {
        await page.getByRole('tab', { name: 'Verse', exact: true }).click();
        await page.getByTitle('Edit this verse').filter({ hasText: word }).click();
        const editor = page.getByRole('textbox', { name: `Verse ${key}`, exact: true });
        await editor.fill('');
        await editor.blur();
        await expect(page.getByTestId('save-indicator')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
        await page.getByRole('tab', { name: 'Section', exact: true }).click();
      };
      const draftTwoVerses = async () => {
        await openSection();
        await sectionText.fill(`${VERSE_9} ${VERSE_10}`);
        await page.getByRole('tab', { name: 'Place verse numbers' }).click();
        await page.getByTestId('pin-bank').getByRole('button', { name: 'Move where verse 10 begins' }).click();
        await page.getByRole('button', { name: 'Begin verse 10 at no' }).click();
        // No wait on the save indicator: when 9 and 10 hold this text already
        // (the #141 case ran first), the save writes nothing. The file is the proof.
        await page.getByRole('button', { name: 'Save section' }).click();
        await expect(page.getByTestId('section-editor')).toHaveCount(0);
        await expect.poll(twoVerseLines, { timeout: 10_000 }).toBe(`\\v 9 ${VERSE_9}\n\\v 10 ${VERSE_10}\n`);
        return railNow();
      };

      const pctTwoUndrafted = await test.step('two undrafted verses: draft 9 and 10, then empty each one in the verse form', async () => {
        const drafted = await draftTwoVerses();
        await clearVerse('10', 'defraudando');
        await clearVerse('9', 'Exhorta');
        await expect.poll(twoVerseLines, { timeout: 10_000 }).toBe('\\v 9 ___\n\\v 10 ___\n');
        const pct = await railNow();
        // Two drafted verses fewer move the percent: the rail is live.
        expect(pct).toMatch(/^\d+%$/);
        expect(pct).not.toBe(drafted);
        return pct;
      });

      const pctBefore = await test.step('two drafted verses: type the section, place verse 10 at "no", save', async () => {
        const settled = new Set(segmentFiles());
        const pct = await draftTwoVerses();
        expect(pct).not.toBe(pctTwoUndrafted);
        // Both verse writes are in the journal before the join starts its own count.
        await expect
          .poll(() => eventsSince(settled).filter((e) => e.op === 'text.verse.set').map((e) => `${e.chapter}:${e.verse}`).sort(), { timeout: 10_000 })
          .toEqual(['2:10', '2:9']);
        return pct;
      });

      const bytesBefore = readIngredient(SEEDED_PROJECT, BOOK_IPATH);
      const segmentsBefore = new Set(segmentFiles());

      await test.step('type the section, then stack verse 10 on the first word', async () => {
        await stackVerse10OnTheFirstWord();
      });

      await test.step('Save section writes the structural change through the scheduler', async () => {
        await saveSection();
        // The row now holds the one span verse.
        await expect(page.getByRole('button', { name: 'Draft section 9-10' })).toBeVisible();
      });

      await test.step('the file is the previous file with the two verse lines replaced by one \\v 9-10 line (AC1, AC6)', async () => {
        // Exactly the two verse lines are replaced; every other byte stays.
        const before = bytesBefore.toString('utf8');
        const from = verseLine(before, 9);
        const to = verseLine(before, 10);
        const expected = `${before.slice(0, from.start)}\\v 9-10 ${VERSE_9} ${VERSE_10}\n${before.slice(to.end)}`;
        await expect
          .poll(() => readIngredient(SEEDED_PROJECT, BOOK_IPATH).toString('utf8'), { timeout: 10_000 })
          .toBe(expected);
      });

      await test.step('the journal carries ONE text.structure.apply: the span claims both verses; every disposition is invalidate-retain (AC4)', async () => {
        const events = eventsSince(segmentsBefore);
        const structural = events.filter((e) => e.op === 'text.structure.apply');
        expect(structural).toHaveLength(1);
        expect(events.filter((e) => e.op === 'text.verse.set')).toEqual([]);
        const [action] = structural;
        expect(action.skeleton).toContain('\\v 9-10 ');
        expect(action.transitions?.['2:9-10']?.text.trim()).toBe(`${VERSE_9} ${VERSE_10}`);
        expect(action.transitions?.['2:9-10']?.sources.map((s) => s.key)).toEqual(['2:9', '2:10']);
        expect(action.dispositions?.every((d) => d.action === 'invalidate-retain')).toBe(true);
      });

      const pctAfter = await test.step('the join of two drafted verses does not move the drafted percentage (#572)', async () => {
        await expect(railPct).toHaveText(pctBefore);
        return railNow();
      });
      const spanned = onDisk();

      const pctUndraftedSpan = await test.step('an undrafted span counts as two undrafted verses: empty the span in the verse form (#572)', async () => {
        await clearVerse('9-10', 'Exhorta');
        await expect
          .poll(onDisk, { timeout: 10_000 })
          .toBe(spanned.replace(`\\v 9-10 ${VERSE_9} ${VERSE_10}`, '\\v 9-10 ___'));
        await expect(railPct).toHaveText(pctTwoUndrafted);
        return railNow();
      });

      await test.step('the span holds its text again; the rail and the Home tile show the percentage of before the join (#572)', async () => {
        await stackVerse10OnTheFirstWord();
        await saveSection();
        await expect.poll(onDisk, { timeout: 10_000 }).toBe(spanned);
        await expect(railPct).toHaveText(pctBefore);
        // A reload: Home computes the tile again from the file.
        await page.goto('/');
        const tilePct = page.getByTestId('project-_local_/_local_/sample_burrito').getByRole('button', { name: /Titus/ }).getByText(/%$/);
        await expect(tilePct).toHaveText(pctBefore);
        const textPath = testInfo.outputPath('drafted-percent.txt');
        fs.writeFileSync(
          textPath,
          [
            `before the join=${pctBefore}`,
            `after the join=${pctAfter}`,
            `two undrafted verses=${pctTwoUndrafted}`,
            `undrafted span=${pctUndraftedSpan}`,
            `home tile=${await tilePct.textContent()}`,
          ].join('\n') + '\n',
        );
        await testInfo.attach('drafted-percent.txt', { path: textPath, contentType: 'text/plain' });
      });

      await test.step('the span can be re-aligned and re-checked: Align opens 2:9-10, and the verse-9 note reads the span text (AC5)', async () => {
        // The seeded project pins the original-language text (UGNT v0.34) and
        // the helps already; nothing is written on disk here.
        await page.goto('/');
        await page.getByTestId('project-_local_/_local_/sample_burrito').getByRole('button', { name: /Titus/ }).click();
        await page.getByRole('tab', { name: 'Check', exact: true }).click();
        await page.getByTestId('open-align').click();
        await expect(page.getByTestId('align-session')).toBeVisible();
        const row = page.getByTestId('align-verse-list').locator('button[data-ref="2:9-10"]');
        // Nothing was aligned on 9 or 10 before the span: the span is to do, not invalid.
        await expect(row).toHaveAttribute('data-status', 'todo');
        await row.click();
        await expect(page.getByTestId('align-session')).toBeVisible();
        // The original text of BOTH verses is the anchor, and every word of
        // the span — verse 10's too — is in the bank, ready to place.
        await expect(page.getByTestId('align-ref-text')).toBeVisible();
        await expect(page.getByTestId('align-bank')).toContainText('defraudando');
        await expect(page.getByTestId('align-bank')).toContainText('Exhorta');
        // Check: the note on verse 9 shows the span's words as its translation.
        await page.goto('/');
        await page.getByTestId('project-_local_/_local_/sample_burrito').getByRole('button', { name: /Titus/ }).click();
        await page.getByRole('tab', { name: 'Check', exact: true }).click();
        await page.getByTestId('open-translationNotes').click();
        await expect(page.getByTestId('check-progress')).toBeVisible();
        await page.getByTestId('check-list').locator('button[data-ref="2:9"]').first().click();
        await expect(page.getByTestId('check-target')).toHaveAttribute('data-drafted', '1');
        await expect(page.getByTestId('check-target')).toContainText('defraudando');
      });
    },
  );

  test(
    'break a verse span (Titus 2:11-12): move verse 12 past text with two clicks in Place mode, save — two verse lines again, verse 13 byte-identical (#63, #598, D70)',
    { tag: ['@inc5', '@J2'] },
    async ({ page }, testInfo) => {
      // The 11–13 section: 11 and 12 become a span with 13 placed after it,
      // then the span is broken. Verse 13 is not touched by the break.
      const VERSE_11 = 'Porque la gracia de Dios se ha manifestado';
      const VERSE_12 = 'enseñándonos a vivir sobria y justamente';
      const VERSE_13 = 'aguardando la esperanza bienaventurada';
      const bytesBefore = readIngredient(SEEDED_PROJECT, BOOK_IPATH);

      await page.goto('/');
      await page.getByTestId('project-_local_/_local_/sample_burrito').getByRole('button', { name: /Titus/ }).click();
      await page.getByRole('button', { name: '2', exact: true }).click();

      await test.step('make the span: place 13, stack 12 on 11, save', async () => {
        await page.getByRole('button', { name: 'Draft section 11–13' }).click();
        await page.getByRole('textbox', { name: 'Section 11–13' }).fill(`${VERSE_11} ${VERSE_12} ${VERSE_13}`);
        await page.getByRole('tab', { name: 'Place verse numbers' }).click();
        await page.getByTestId('pin-bank').getByRole('button', { name: 'Move where verse 13 begins' }).click();
        await page.getByRole('button', { name: 'Begin verse 13 at aguardando' }).click();
        await page.getByTestId('pin-bank').getByRole('button', { name: 'Move where verse 12 begins' }).click();
        await page.getByRole('button', { name: 'Join verse 12 to verse 11 at Porque' }).click();
        await page.getByRole('button', { name: 'Save section' }).click();
        await expect(page.getByTestId('save-indicator')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
        const before = bytesBefore.toString('utf8');
        const from = verseLine(before, 11);
        const to = verseLine(before, 13);
        const expected = `${before.slice(0, from.start)}\\v 11-12 ${VERSE_11} ${VERSE_12}\n\\v 13 ${VERSE_13}\n${before.slice(to.end)}`;
        await expect
          .poll(() => readIngredient(SEEDED_PROJECT, BOOK_IPATH).toString('utf8'), { timeout: 10_000 })
          .toBe(expected);
      });

      const spanned = readIngredient(SEEDED_PROJECT, BOOK_IPATH).toString('utf8');
      const segmentsBefore = new Set(segmentFiles());
      // #572: the rail's percent while 11 and 12 are one span.
      const pctWithSpan = (await titusRailPct(page).textContent()) ?? '';
      expect(pctWithSpan).toMatch(/^\d+%$/);

      await test.step('reopen the section: the span opens as one line, its pins stacked; click 12, then click its first word', async () => {
        await page.getByRole('button', { name: 'Draft section 11–13' }).click();
        await expect(page.getByRole('textbox', { name: 'Section 11–13' })).toHaveValue(`11-12 ${VERSE_11} ${VERSE_12}\n13 ${VERSE_13}`);
        await page.getByRole('tab', { name: 'Place verse numbers' }).click();
        // Verse 12's pin sits on the first word beside the fixed 11. Two mouse
        // clicks move it, as for a number from the bank (#598): one on the
        // pin, one on the word it begins at.
        const pin = page.getByTestId('place-words').getByRole('button', { name: 'Move where verse 12 begins' });
        const hint = page.getByTestId('pin-bank').getByText(/^Click the word where verse \d+ begins$/);
        const target = page.getByRole('button', { name: 'Begin verse 12 at enseñándonos' });
        await pin.click();
        await expect(hint).toBeVisible();
        await expect(hint).toHaveText('Click the word where verse 12 begins');
        await expect(target).toBeVisible();
        // The run's artifact: the instruction while the number is in hand.
        const hintPath = testInfo.outputPath('j02-placed-pin-in-hand.txt');
        fs.writeFileSync(hintPath, `${(await hint.textContent()) ?? ''}\n`);
        await testInfo.attach('j02-placed-pin-in-hand.txt', { path: hintPath, contentType: 'text/plain' });
        // A second click on the number puts it back, as in the bank.
        await pin.click();
        await expect(hint).toBeHidden();
        await expect(target).toHaveCount(0);
        await pin.click();
        await target.click();
        await expect(hint).toBeHidden();
        await page.getByRole('button', { name: 'Save section' }).click();
        await expect(page.getByTestId('save-indicator')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
      });

      await test.step('the file has verses 11 and 12 again; verse 13 and everything else is byte-identical (AC2, AC6)', async () => {
        const line = `\\v 11-12 ${VERSE_11} ${VERSE_12}`;
        expect(spanned).toContain(line);
        const expected = spanned.replace(line, `\\v 11 ${VERSE_11}\n\\v 12 ${VERSE_12}`);
        await expect
          .poll(() => readIngredient(SEEDED_PROJECT, BOOK_IPATH).toString('utf8'), { timeout: 10_000 })
          .toBe(expected);
        // The run's artifact: the stored book after the two clicks.
        const usfmPath = testInfo.outputPath('j02-click-move-TIT.usfm');
        fs.writeFileSync(usfmPath, readIngredient(SEEDED_PROJECT, BOOK_IPATH));
        await testInfo.attach('j02-click-move-TIT.usfm', { path: usfmPath, contentType: 'text/plain' });
      });

      await test.step('the drafted percentage is the same with the span and with the two verses apart (#572)', async () => {
        await expect(titusRailPct(page)).toHaveText(pctWithSpan);
      });

      await test.step('the journal carries ONE text.structure.apply: verse 11 claims the span head, verse 12 states its text (AC4)', async () => {
        const events = eventsSince(segmentsBefore);
        const structural = events.filter((e) => e.op === 'text.structure.apply');
        expect(structural).toHaveLength(1);
        const [action] = structural;
        expect(action.skeleton).toContain('\\v 11 ');
        expect(action.skeleton).toContain('\\v 12 ');
        expect(action.transitions?.['2:11']?.sources.map((s) => s.key)).toEqual(['2:11-12']);
        expect(action.transitions?.['2:12']).toMatchObject({ sources: [] });
        expect(action.transitions?.['2:12']?.text.trim()).toBe(VERSE_12);
        expect(action.transitions?.['2:13']?.sources.map((s) => s.key)).toEqual(['2:13']);
        expect(action.dispositions?.every((d) => d.action === 'invalidate-retain')).toBe(true);
      });
    },
  );

  test(
    'join two verses in separate paragraphs into a span (Jonah 1): the paragraphs merge into one — no \\p and no blank line in the stored span, and the reading view, Type mode and the USFM export show one paragraph (#575, D94)',
    { tag: ['@inc9', '@J2'] },
    async ({ page }, testInfo) => {
      test.setTimeout(120_000);
      // Jonah: no other journey drafts in it, and resetSeededChecking restores it.
      const JON_IPATH = 'ingredients/JON.usfm';
      const FIRST = 'Vino palabra de Jehová a Jonás hijo de Amitai (párrafo uno)';
      const SECOND = 'Levántate y ve a Nínive aquella gran ciudad (párrafo dos)';
      writePlace(SEEDED_PROJECT, 'JON', { mode: 'draft', chapter: 1 });
      await page.goto('/');
      await page.getByTestId(`project-_local_/_local_/${SEEDED_PROJECT}`).getByRole('button', { name: /Jonah/ }).click();
      await expect(page.getByRole('heading', { name: 'Jonah 1', exact: true })).toBeVisible({ timeout: 60_000 });
      await page.getByRole('tab', { name: 'Section', exact: true }).click();
      // The first section of Jonah 1 with two verses or more, read from the page:
      // its verses are A to B. The journey drafts A and A+1 as two paragraphs.
      const sectionButton = page.getByRole('button', { name: /^Draft section \d+–\d+$/ }).first();
      const label = (await sectionButton.textContent())!.trim();
      const [a, b] = label.replace('Draft section ', '').split('–');
      const next = String(Number(a) + 1);
      expect(Number(b)).toBeGreaterThanOrEqual(Number(next));
      const spanKey = `${a}-${next}`;
      const textbox = page.getByRole('textbox', { name: `Section ${a}–${b}` });

      await test.step(`draft verses ${a} and ${next} as two paragraphs and save: a \\p stands between them`, async () => {
        await sectionButton.click();
        await textbox.fill(`${a} ${FIRST}\n\n${next} ${SECOND}`);
        await page.getByRole('button', { name: 'Save section' }).click();
        await expect(page.getByTestId('save-indicator')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
        await expect
          .poll(() => readIngredient(SEEDED_PROJECT, JON_IPATH).toString('utf8'), { timeout: 10_000 })
          .toContain(`\\v ${a} ${FIRST}\n\\p\n\\v ${next} ${SECOND}\n`);
      });

      const before = readIngredient(SEEDED_PROJECT, JON_IPATH).toString('utf8');

      await test.step(`join verse ${next} to verse ${a} in Place mode and save`, async () => {
        await sectionButton.click();
        await page.getByRole('tab', { name: 'Place verse numbers' }).click();
        await page.getByTestId('place-words').getByRole('button', { name: `Move where verse ${next} begins` }).press('Enter');
        // The keyboard gesture, whole: Enter on the number, Enter on the word.
        await page.getByRole('button', { name: `Join verse ${next} to verse ${a} at Vino`, exact: true }).press('Enter');
        await page.getByRole('button', { name: 'Save section' }).click();
        await expect(page.getByTestId('save-indicator')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
      });

      await test.step(`the stored file is the previous file with the two verses and the \\p between them replaced by one \\v ${spanKey} line`, async () => {
        const pair = `\\v ${a} ${FIRST}\n\\p\n\\v ${next} ${SECOND}\n`;
        expect(before.split(pair)).toHaveLength(2);
        const expected = before.replace(pair, `\\v ${spanKey} ${FIRST} ${SECOND}\n`);
        await expect
          .poll(() => readIngredient(SEEDED_PROJECT, JON_IPATH).toString('utf8'), { timeout: 10_000 })
          .toBe(expected);
      });

      const stored = readIngredient(SEEDED_PROJECT, JON_IPATH);

      await test.step('the reading view shows the span as one paragraph', async () => {
        await expect(page.getByTestId('section-editor')).toHaveCount(0);
        const paragraphs = page.locator('p').filter({ hasText: 'Vino palabra de Jehová' });
        await expect(paragraphs).toHaveCount(1);
        await expect(paragraphs).toContainText('Levántate y ve a Nínive');
      });

      await test.step('Type mode shows the span as one line, with no blank line', async () => {
        await sectionButton.click();
        const value = await textbox.inputValue();
        expect(value.split('\n')[0]).toBe(`${spanKey} ${FIRST} ${SECOND}`);
        expect(value).not.toMatch(/\n\s*\n/);
        await page.getByTestId('section-editor').getByRole('button', { name: 'Cancel' }).click();
      });

      await test.step('the plain USFM export is the stored book, with the span on one line', async () => {
        await page.getByRole('tab', { name: 'Check', exact: true }).click();
        await page.getByTestId('open-community-checking').click();
        await page.getByTestId('export-menu-trigger').click();
        const download = await captureDownload(page, page.getByRole('menuitem', { name: 'USFM, plain', exact: true }));
        expect(download.filename).toMatch(/^JON-\d{4}-\d{2}-\d{2}\.usfm$/);
        expect(download.bytes.equals(stored)).toBe(true);
        expect(download.bytes.toString('utf8')).toContain(`\\v ${spanKey} ${FIRST} ${SECOND}\n`);
      });

      // The run's artifact: the stored book after the join.
      const artifactPath = testInfo.outputPath('j02-span-paragraph-merge-JON.usfm');
      fs.writeFileSync(artifactPath, stored);
      await testInfo.attach('j02-span-paragraph-merge-JON.usfm', { path: artifactPath, contentType: 'text/plain' });
    },
  );

  test(
    'source panes render beside the draft: ULT/UST tabs from pinned extraScripture (FR-10 — the orig pane is the alignment increment, D24a)',
    { tag: ['@inc1', '@J2'] },
    async ({ page }) => {
      await page.goto('/');
      await page.getByTestId('project-_local_/_local_/sample_burrito').getByRole('button', { name: /Titus/ }).click();
      // ULT is the default tab: real pinned text for Titus 1:1
      await expect(page.getByText('an apostle of Jesus Christ')).toBeVisible({ timeout: 20_000 });
      // Switch to UST: a genuinely different rendering of the same verse
      await page.getByTestId('source-tab-ust').click();
      await expect(page.getByText('a representative of Jesus the Messiah')).toBeVisible();
      await expect(page.getByText('an apostle of Jesus Christ')).not.toBeVisible();
    },
  );

  test(
    'idle debounce also saves — no blur — and the indicator binds to the actual write (FR-6/FR-32)',
    { tag: ['@inc1', '@J2'] },
    async ({ page }) => {
      const TEXT = 'Enséñales a los ancianos a ser sobrios.';
      await page.goto('/');
      await page.getByTestId('project-_local_/_local_/sample_burrito').getByRole('button', { name: /Titus/ }).click();
      await page.getByRole('button', { name: '2', exact: true }).click();
      await page.getByRole('tab', { name: 'Verse', exact: true }).click();
      await page.getByRole('button', { name: 'Start this verse' }).first().click();
      await page.getByRole('textbox', { name: /Verse/ }).fill(TEXT);
      // Do NOT blur. The 2 s idle debounce must flush the write on its own.
      await expect(page.getByTestId('save-indicator')).toHaveAttribute('data-state', 'saved', {
        timeout: 10_000,
      });
      await expect
        .poll(() => readIngredient(SEEDED_PROJECT, BOOK_IPATH).toString('utf8'), {
          timeout: 10_000,
        })
        .toContain(TEXT);
    },
  );

  test(
    'a drafting session, with a restart, uses no internet: every request goes to the local server (FR-31, #43; D88)',
    { tag: ['@inc4', '@J2'] },
    async ({ page }, testInfo) => {
      // Every request the client makes from the first paint through a saved draft.
      // The one local host is the dev client (baseURL), which proxies /api to the rig
      // (vite.config.js); everything else is a network dependency, and any other host
      // fails the test (the shared recorder, e2e/helpers/externalRequests.ts, also
      // counts /api/gitea/ and /api/git/push/, the routes that make the server use the
      // internet). The fonts are local since #3. The session starts with the internet
      // off, as every session does (D95), and includes a restart.
      const OFFLINE_DRAFT = 'Recuérdales que estén dispuestos a toda buena obra.';
      const recorder = recordExternal(page);
      // A SharedWorker's requests bypass the page listeners (Playwright detaches
      // shared-worker targets), so every worker the client constructs is recorded and
      // judged below — only a dedicated same-origin worker is admitted.
      await page.addInitScript(() => {
        const w = window as unknown as { __workers: string[]; Worker: typeof Worker; SharedWorker: typeof SharedWorker };
        w.__workers = [];
        for (const name of ['Worker', 'SharedWorker'] as const) {
          const Orig = w[name];
          if (typeof Orig !== 'function') continue;
          const Patched = function (this: unknown, url: string | URL, opts?: unknown) {
            w.__workers.push(`${name} ${String(url)}`);
            return new (Orig as unknown as new (u: string | URL, o?: unknown) => unknown)(url, opts);
          };
          Patched.prototype = Orig.prototype;
          (w as unknown as Record<string, unknown>)[name] = Patched;
        }
      });
      await page.goto('/');
      // The account menu is there and signed out; nothing was asked or sent.
      await expect(page.getByTestId('account-menu')).toHaveAttribute('data-state', 'out');
      await page.getByTestId('project-_local_/_local_/sample_burrito').getByRole('button', { name: /Titus/ }).click();
      await expect(page.getByText('an apostle of Jesus Christ')).toBeVisible({ timeout: 20_000 });
      await page.getByRole('button', { name: '3', exact: true }).click();
      await page.getByRole('tab', { name: 'Verse', exact: true }).click();
      await page.getByRole('button', { name: 'Start this verse' }).first().click();
      const editor = page.getByRole('textbox', { name: /Verse/ });
      await editor.fill(OFFLINE_DRAFT);
      await editor.blur();
      await expect(page.getByTestId('save-indicator')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
      // The save's follow-up is the debounced Resume record: a queued read then a write
      // of the client-settings document (src/state.jsx, recordLastEdit/flushLastEdit).
      // Wait for THAT write to land on the rig's disk, not for a fixed time, then a
      // short window for anything that trails it.
      const settingsFile = path.join(TC4_ROOT, 'dev-env', 'state', 'work', 'client_settings', 'uw-tc4.json');
      await expect
        .poll(() => {
          try {
            const doc = JSON.parse(fs.readFileSync(settingsFile, 'utf8')) as { lastEdit?: { snippet?: string } };
            return doc.lastEdit?.snippet ?? null;
          } catch {
            return null;
          }
        }, { timeout: 10_000 })
        .toBe(OFFLINE_DRAFT);
      // The workers of the first app session, before the restart replaces the page's record.
      const workersBefore = await page.evaluate(() => (window as unknown as { __workers: string[] }).__workers);
      // A restart: the app starts again, with the draft kept.
      await page.reload();
      await expect(page.getByTestId('account-menu')).toHaveAttribute('data-state', 'out');
      await expect(page.getByTestId('project-_local_/_local_/sample_burrito')).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(1000);
      // No worker whose traffic could escape the page's request event: a SharedWorker or
      // a cross-origin worker is refused outright (constructed workers were recorded by
      // the init script; service workers are read from their registry). A DEDICATED
      // worker loaded from the client's own origin is the one kind admitted — since #94
      // the fold runs in one — because Playwright reports a dedicated worker's requests
      // through the page, so the host assertion below covers what it talks to.
      const workers = [...workersBefore, ...(await page.evaluate(() => (window as unknown as { __workers: string[] }).__workers))];
      const escaping = workers.filter((w) => !w.startsWith(`Worker ${lane().clientOrigin}/`));
      expect(escaping, 'workers whose traffic the page cannot observe').toEqual([]);
      const serviceWorkers = await page.evaluate(() =>
        'serviceWorker' in navigator ? navigator.serviceWorker.getRegistrations().then((r) => r.length) : 0);
      expect(serviceWorkers, 'service workers registered').toBe(0);

      const log = await recorder.save(testInfo, 'j2-external-requests');
      console.log(`J2 offline check: ${recorder.all().length} requests, external = ${recorder.external().join(', ') || 'none'} (${log})`);
      expect(recorder.external(), 'requests to anything but the local server').toEqual([]);
      // The rig was reached through the proxy: the session was a real one, not an empty page.
      expect(recorder.all().some((r) => r.path.startsWith('/api/'))).toBe(true);
    },
  );

  test(
    'drafting an undrafted verse updates the progress display (FR-9)',
    { tag: ['@inc1', '@J2'] },
    async ({ page }) => {
      await page.goto('/');
      await page.getByTestId('project-_local_/_local_/sample_burrito').getByRole('button', { name: /Titus/ }).click();
      // Every rail row may show a percent now (design 2026-07-31) — read the
      // percent inside TITUS's own row, not the first one in the aside.
      const pctText = () =>
        page
          .locator('aside button', { hasText: 'Titus' })
          .first()
          .getByText(/%$/)
          .textContent();
      const before = parseInt((await pctText()) || '0', 10);
      await page.getByRole('button', { name: '3', exact: true }).click();
      await page.getByRole('tab', { name: 'Verse', exact: true }).click();
      await page.getByRole('button', { name: 'Start this verse' }).first().click();
      await page.getByRole('textbox', { name: /Verse/ }).fill('Recuérdales que se sometan.');
      await page.getByRole('textbox', { name: /Verse/ }).blur();
      await page.getByRole('tab', { name: 'Section', exact: true }).click();
      await expect
        .poll(async () => parseInt((await pctText()) || '0', 10))
        .toBeGreaterThan(before);
      // The percent updates from in-memory state BEFORE the journal write
      // lands; without waiting for the real save (like every sibling test
      // does) the issue-#62 teardown verifier races the in-flight write and
      // flakes with "journal materialization FAILED" (seen 2026-08-27, same
      // commit passing and failing back-to-back).
      await expect(page.getByTestId('save-indicator')).toHaveAttribute('data-state', 'saved', {
        timeout: 10_000,
      });
    },
  );

  test(
    'paragraph breaks and poetry lines from the section editing card (Titus 2:11-13): \\q1 and \\p formats save as preceding verse slots (#54)',
    { tag: ['@inc5', '@J2'] },
    async ({ page }) => {
      const bytesBefore = readIngredient(SEEDED_PROJECT, BOOK_IPATH);
      const before = bytesBefore.toString('utf8');
      const v11Span = verseTextSpan(before, CHAPTER, 11);
      const v12Span = verseTextSpan(before, CHAPTER, 12);
      const v13Span = verseTextSpan(before, CHAPTER, 13);
      const v11 = before.slice(v11Span.start, v11Span.end).trim();
      const v12 = before.slice(v12Span.start, v12Span.end).trim();
      const v13 = before.slice(v13Span.start, v13Span.end).trim();
      const segmentsBefore = new Set(segmentFiles());

      await page.goto('/');
      await page.getByTestId('project-_local_/_local_/sample_burrito').getByRole('button', { name: /Titus/ }).click();
      await page.getByRole('button', { name: '2', exact: true }).click();

      await test.step('open Draft section 11–13, fill formatted text, and save', async () => {
        await page.getByRole('button', { name: 'Draft section 11–13' }).click();
        const textbox = page.getByRole('textbox', { name: 'Section 11–13' });
        await textbox.fill(`11 ${v11}\n\t12 ${v12}\n\n13 ${v13}`);
        await page.getByRole('button', { name: 'Save section' }).click();
        await expect(page.getByTestId('save-indicator')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
        await expect(page.getByTestId('section-editor')).toHaveCount(0);
      });

      await test.step('assert the WHOLE file equals prior file with \\q1 after verse 11 line and \\p after verse 12 line', async () => {
        const line11 = verseLine(before, 11);
        const line12 = verseLine(before, 12);
        const expected =
          before.slice(0, line11.end) +
          '\\q1\n' +
          before.slice(line11.end, line12.end) +
          '\\p\n' +
          before.slice(line12.end);
        await expect
          .poll(() => readIngredient(SEEDED_PROJECT, BOOK_IPATH).toString('utf8'), { timeout: 10_000 })
          .toBe(expected);
      });

      await test.step('eventsSince holds text.verse.set for exactly [2:11, 2:12], no text.structure.apply', async () => {
        const events = eventsSince(segmentsBefore);
        const verseSets = events.filter((e) => e.op === 'text.verse.set');
        expect(verseSets.map((e) => `${e.chapter}:${e.verse}`).sort()).toEqual(['2:11', '2:12']);
        expect(events.filter((e) => e.op === 'text.structure.apply')).toEqual([]);
      });

      await test.step('reopen: textbox shows what was filled; fill unformatted, save: prior bytes', async () => {
        await page.getByRole('button', { name: 'Draft section 11–13' }).click();
        const textbox = page.getByRole('textbox', { name: 'Section 11–13' });
        await expect(textbox).toHaveValue(`11 ${v11}\n\t12 ${v12}\n\n13 ${v13}`);
        await textbox.fill(`11 ${v11}\n12 ${v12}\n13 ${v13}`);
        await page.getByRole('button', { name: 'Save section' }).click();
        await expect(page.getByTestId('save-indicator')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
        await expect
          .poll(() => readIngredient(SEEDED_PROJECT, BOOK_IPATH).toString('utf8'), { timeout: 10_000 })
          .toBe(before);
      });

      await test.step('fill changed text for verse 13 together with the two formats, save, and assert file bytes and events', async () => {
        const segmentsBefore13 = new Set(segmentFiles());
        const newV13 = `${v13} editado`;
        await page.getByRole('button', { name: 'Draft section 11–13' }).click();
        const textbox = page.getByRole('textbox', { name: 'Section 11–13' });
        await textbox.fill(`11 ${v11}\n\t12 ${v12}\n\n13 ${newV13}`);
        await page.getByRole('button', { name: 'Save section' }).click();
        await expect(page.getByTestId('save-indicator')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
        await expect(page.getByTestId('section-editor')).toHaveCount(0);

        const line11 = verseLine(before, 11);
        const line12 = verseLine(before, 12);
        const expected =
          before.slice(0, line11.end) +
          '\\q1\n' +
          before.slice(line11.end, line12.end) +
          '\\p\n' +
          before.slice(line12.end, v13Span.start) +
          newV13 +
          '\n' +
          before.slice(v13Span.end);
        await expect
          .poll(() => readIngredient(SEEDED_PROJECT, BOOK_IPATH).toString('utf8'), { timeout: 10_000 })
          .toBe(expected);

        const events = eventsSince(segmentsBefore13);
        const verseSets = events.filter((e) => e.op === 'text.verse.set');
        expect(verseSets.map((e) => `${e.chapter}:${e.verse}`).sort()).toEqual(['2:11', '2:12', '2:13']);
        expect(events.filter((e) => e.op === 'text.structure.apply')).toEqual([]);

        // Restore: fill original three lines without tabs/blank line and assert prior bytes
        await page.getByRole('button', { name: 'Draft section 11–13' }).click();
        await page.getByRole('textbox', { name: 'Section 11–13' }).fill(`11 ${v11}\n12 ${v12}\n13 ${v13}`);
        await page.getByRole('button', { name: 'Save section' }).click();
        await expect(page.getByTestId('save-indicator')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
        await expect
          .poll(() => readIngredient(SEEDED_PROJECT, BOOK_IPATH).toString('utf8'), { timeout: 10_000 })
          .toBe(before);
      });
    },
  );

  test(
    'read original-language pane (Titus 1): click source-tab-orig, verify Greek text, dir, and zero writes (#207)',
    { tag: ['@inc5', '@J2'] },
    async ({ page }) => {
      const bytesBefore = readIngredient(SEEDED_PROJECT, BOOK_IPATH);
      const commitsBefore = commitCount(SEEDED_PROJECT);

      await page.goto('/');
      await page.getByTestId('project-_local_/_local_/sample_burrito').getByRole('button', { name: /Titus/ }).click();
      await page.getByRole('button', { name: '1', exact: true }).click();

      await test.step('click source-tab-orig and verify Greek text and dir="ltr"', async () => {
        await page.getByTestId('source-tab-orig').click();
        const text = sideloadedIngredient('el-x-koine_ugnt', 'TIT.usfm');
        const span = verseTextSpan(text.replace(/\\v (\d+)\n/g, '\\v $1 '), 1, 1);
        const rawSpan = text.slice(span.start, span.end);
        const greek = rawSpan.replace(/\\w\s+([^|]+)\|[^\\]*\\w\*/g, '$1').replace(/\s+/g, ' ').trim();

        const para = page.locator('p[dir="ltr"]', { hasText: greek });
        await expect(para).toBeVisible();
        await expect(para).toHaveAttribute('dir', 'ltr');
        await expect(para).toHaveAttribute('lang', 'el');
        await expect(para).toContainText(greek);
      });

      await test.step('switching the tab writes nothing to disk and creates no commit (FR-34 / W-4)', async () => {
        const bytesAfter = readIngredient(SEEDED_PROJECT, BOOK_IPATH);
        expect(bytesAfter.equals(bytesBefore)).toBe(true);
        expect(commitCount(SEEDED_PROJECT)).toBe(commitsBefore);
      });
    },
  );

  test(
    'resize the helps panel (#602): a drag of the divider resizes the panel, one show/hide button and no widen button, drafting still saves, and Check still opens',
    { tag: ['@inc9', '@J2'] },
    async ({ page }, testInfo) => {
      const WIDE_DRAFT = 'Nuestra gente debe aprender a dedicarse a hacer el bien.';

      await page.goto('/');
      await page.getByTestId('project-_local_/_local_/sample_burrito').getByRole('button', { name: /Titus/ }).click();
      await page.getByRole('button', { name: '3', exact: true }).click();

      await test.step('the toolbar has one show/hide button and no widen button', async () => {
        await proveHelpsToolbar(page, testInfo, 'translate');
      });

      await test.step('a drag of the divider widens the panel; hide and show keep the width', async () => {
        await proveHelpsDragAndToggle(page, testInfo, 'translate');
      });

      await test.step('drafting still works after the resize', async () => {
        await page.getByRole('tab', { name: 'Verse', exact: true }).click();
        await page.getByRole('button', { name: 'Start this verse' }).first().click();
        const editor = page.getByRole('textbox', { name: /Verse/ });
        await editor.fill(WIDE_DRAFT);
        await editor.blur();
        await expect(page.getByTestId('save-indicator')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
        await expect
          .poll(() => readIngredient(SEEDED_PROJECT, BOOK_IPATH).toString('utf8'), { timeout: 10_000 })
          .toContain(WIDE_DRAFT);
      });

      await test.step('Check still opens after the resize', async () => {
        await page.getByRole('tab', { name: 'Check', exact: true }).click();
        await page.getByTestId('open-translationNotes').click();
        await expect(page.getByTestId('check-progress')).toBeVisible();
      });
    },
  );
});

// Issue #62 teardown: after this journey's mutations, every journaled local
// project must be a verified byte-for-byte materialization of its journal.
test.afterAll(async () => {
  await verifyAllJournaledProjects();
});
