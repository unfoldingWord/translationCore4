// J2 — Open book → draft verses beside sources → autosave → progress updates
// docs/JOURNEYS.md J2 · shipped v4.0.0-alpha.1 · run LTR and RTL (the J10 axis)
// Increment 1 slice (@inc1): draft one verse in the seeded project and prove on disk —
//   · the typed text was saved to ingredients/TIT.usfm through the store (FR-6)
//   · D8 byte-strict: nothing outside the edited verse changed (FR-7)
//   · no alignment markup written at rest (FR-8, I-1)
//   · no auto-commit — commits happen only at checkpoints (FR-34, W-4)
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { verifyAllJournaledProjects } from './helpers/journal';
import {
  SEEDED_PROJECT,
  TC4_ROOT,
  readIngredient,
  rigRepo,
  commitCount,
  byteStrictViolation,
  verseTextSpan,
  sideloadedIngredient,
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

test.describe('J2 — a translator drafts a verse', () => {
  test(
    'open the seeded project, draft verse Titus 2:1, and the save is byte-strict with no auto-commit',
    { tag: ['@inc1', '@J2'] },
    async ({ page }) => {
      const bytesBefore = readIngredient(SEEDED_PROJECT, BOOK_IPATH);
      const commitsBefore = commitCount(SEEDED_PROJECT);

      await test.step('open the app — the seeded project is listed', async () => {
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
        await page.getByRole('button', { name: 'Start this verse' }).first().click();
      });

      await test.step('type the draft and leave the verse (blur saves)', async () => {
        const editor = page.getByRole('textbox', { name: 'Verse 1' });
        await editor.fill(DRAFT_TEXT);
        await editor.blur();
      });

      await test.step('the save indicator confirms a real write', async () => {
        await expect(page.getByText('Saved')).toBeVisible();
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

      await test.step('nothing auto-committed — commits are checkpoint-only (FR-34 / W-4)', async () => {
        expect(commitCount(SEEDED_PROJECT)).toBe(commitsBefore);
      });
    },
  );

  test(
    'draft a two-verse section (Titus 2:9–10): type it straight through, place verse 10, save — the bytes and one text.verse.set per verse land on disk (#141, J2 revised)',
    { tag: ['@inc5', '@J2'] },
    async ({ page }) => {
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
        await page.getByTestId('pin-bank').getByRole('button', { name: 'Move where verse 10 begins' }).click();
        await page.getByRole('button', { name: 'Begin verse 10 at no' }).click();
        // Placed: the bank is empty and the pin sits in the text before "no".
        await expect(page.getByTestId('pin-bank').getByRole('button', { name: /Move where verse/ })).toHaveCount(0);
        await expect(page.getByTestId('place-words').getByRole('button', { name: 'Move where verse 10 begins' })).toBeVisible();
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
        await page.getByTitle('Edit this verse').filter({ hasText: 'defraudando' }).click();
        await expect(page.getByRole('textbox', { name: 'Verse 10' })).toHaveValue(VERSE_10);
        await page.getByRole('button', { name: 'Cancel' }).click();
        await expect(page.getByRole('textbox', { name: 'Verse 10' })).toHaveCount(0);
      });
    },
  );

  test(
    'create a verse span (Titus 2:9-10): stack verse 10 on verse 9 in Place mode, save — one \\v 9-10 line and one text.structure.apply on disk (#63, D70)',
    { tag: ['@inc5', '@J2'] },
    async ({ page }) => {
      const VERSE_9 = 'Exhorta a los siervos a que se sujeten a sus amos y a que agraden en todo';
      const VERSE_10 = 'no defraudando sino mostrando toda buena fe';
      const bytesBefore = readIngredient(SEEDED_PROJECT, BOOK_IPATH);
      const segmentsBefore = new Set(segmentFiles());

      await page.goto('/');
      await page.getByTestId('project-_local_/_local_/sample_burrito').getByRole('button', { name: /Titus/ }).click();
      await page.getByRole('button', { name: '2', exact: true }).click();

      await test.step('type the section, then stack verse 10 on the first word', async () => {
        await page.getByRole('button', { name: 'Draft section 9–10' }).click();
        await page.getByRole('textbox', { name: 'Section 9–10' }).fill(`${VERSE_9} ${VERSE_10}`);
        await page.getByRole('tab', { name: 'Place verse numbers' }).click();
        await page.getByTestId('pin-bank').getByRole('button', { name: 'Move where verse 10 begins' }).click();
        // The first word carries the fixed verse 9: dropping 10 there joins them.
        await page.getByRole('button', { name: 'Join verse 10 to verse 9 at Exhorta' }).click();
        await expect(page.getByTestId('pin-bank').getByRole('button', { name: /Move where verse/ })).toHaveCount(0);
        await expect(page.getByTestId('place-words').getByRole('button', { name: 'Move where verse 10 begins' })).toBeVisible();
      });

      await test.step('Save section writes the structural change through the scheduler', async () => {
        await page.getByRole('button', { name: 'Save section' }).click();
        await expect(page.getByTestId('save-indicator')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
        await expect(page.getByTestId('section-editor')).toHaveCount(0);
        // The row now holds the one span verse.
        await expect(page.getByRole('button', { name: 'Draft section 9-10' })).toBeVisible();
      });

      await test.step('the file is the previous file with the two verse lines replaced by one \\v 9-10 line (AC1, AC6)', async () => {
        // The sibling #141 case drafted 9 and 10 before this one: whatever the
        // two lines held, exactly they are replaced; every other byte stays.
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
    'break a verse span (Titus 2:11-12): drag verse 12 past text in Place mode, save — two verse lines again, verse 13 byte-identical (#63, D70)',
    { tag: ['@inc5', '@J2'] },
    async ({ page }) => {
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

      await test.step('reopen the section: the span opens as one line, its pins stacked; drag 12 onto its first word', async () => {
        await page.getByRole('button', { name: 'Draft section 11–13' }).click();
        await expect(page.getByRole('textbox', { name: 'Section 11–13' })).toHaveValue(`11-12 ${VERSE_11} ${VERSE_12}\n13 ${VERSE_13}`);
        await page.getByRole('tab', { name: 'Place verse numbers' }).click();
        // Verse 12's pin sits on the first word beside the fixed 11. A placed
        // pin is picked up on pointerdown and dropped on pointerup (D70.3 is a
        // drag), so the keyboard gesture picks it up here: Enter on the pin,
        // then the word it begins at.
        await page.getByTestId('place-words').getByRole('button', { name: 'Move where verse 12 begins' }).press('Enter');
        await page.getByRole('button', { name: 'Begin verse 12 at enseñándonos' }).click();
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
    'a drafting session talks to no host but the local server (FR-31, #43)',
    { tag: ['@inc4', '@J2'] },
    async ({ page }) => {
      // Every request the client makes from the first paint through a saved draft.
      // The one local host is the dev client (baseURL), which proxies /api to the rig
      // (vite.config.js); everything else is a network dependency. Two are known and open (#3: the fonts come from Google's
      // CDN); the list shrinks to nothing when #3 lands. A new host fails the test.
      const OFFLINE_DRAFT = 'Recuérdales que estén dispuestos a toda buena obra.';
      const KNOWN_OFFLINE_DEFECTS: Record<string, string> = {
        'fonts.googleapis.com': '#3',
        'fonts.gstatic.com': '#3',
      };
      const hosts = new Map<string, Set<string>>();
      const seen = (url: string, label = '') => {
        const u = new URL(url);
        if (!hosts.has(u.host)) hosts.set(u.host, new Set());
        hosts.get(u.host)!.add(label + u.pathname);
      };
      page.on('request', (req) => seen(req.url()));
      // Playwright's request event does not cover WebSockets; record them too (the dev
      // client's HMR socket is local; a remote one would be a dependency).
      page.on('websocket', (ws) => seen(ws.url(), 'ws:'));
      // A worker's requests bypass the page listeners (Playwright detaches shared-worker
      // targets), so any worker the client constructs is recorded and refused below.
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
      await page.getByTestId('project-_local_/_local_/sample_burrito').getByRole('button', { name: /Titus/ }).click();
      await expect(page.getByText('an apostle of Jesus Christ')).toBeVisible({ timeout: 20_000 });
      await page.getByRole('button', { name: '3', exact: true }).click();
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
      await page.waitForTimeout(1000);
      // No worker of any kind: a worker's requests bypass the page's request event, so
      // the absence is asserted rather than assumed (constructed workers were recorded
      // by the init script; service workers are read from their registry).
      const workers = await page.evaluate(() => (window as unknown as { __workers: string[] }).__workers);
      expect(workers, 'workers constructed by the client').toEqual([]);
      const serviceWorkers = await page.evaluate(() =>
        'serviceWorker' in navigator ? navigator.serviceWorker.getRegistrations().then((r) => r.length) : 0);
      expect(serviceWorkers, 'service workers registered').toBe(0);

      const local = new Set(['localhost:5199']);
      const external = [...hosts.keys()].filter((h) => !local.has(h)).sort();
      console.log(`J2 offline check: hosts contacted = ${[...hosts.keys()].sort().join(', ')}`);
      for (const h of external) console.log(`  external ${h} (${KNOWN_OFFLINE_DEFECTS[h] ?? 'NO ISSUE'}): ${[...hosts.get(h)!].slice(0, 3).join(' ')}`);
      const unknown = external.filter((h) => !Object.hasOwn(KNOWN_OFFLINE_DEFECTS, h));
      expect(unknown, `hosts contacted with no open offline issue: ${unknown.join(', ')}`).toEqual([]);
      // The rig was reached through the proxy: the session was a real one, not an empty page.
      expect([...(hosts.get('localhost:5199') ?? [])].some((p) => p.startsWith('/api/'))).toBe(true);
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
      await page.getByRole('button', { name: 'Start this verse' }).first().click();
      await page.getByRole('textbox', { name: /Verse/ }).fill('Recuérdales que se sometan.');
      await page.getByRole('textbox', { name: /Verse/ }).blur();
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
        await expect(para).toContainText(greek);
      });

      await test.step('switching the tab writes nothing to disk and creates no commit (FR-34 / W-4)', async () => {
        const bytesAfter = readIngredient(SEEDED_PROJECT, BOOK_IPATH);
        expect(bytesAfter.equals(bytesBefore)).toBe(true);
        expect(commitCount(SEEDED_PROJECT)).toBe(commitsBefore);
      });
    },
  );
});

// Issue #62 teardown: after this journey's mutations, every journaled local
// project must be a verified byte-for-byte materialization of its journal.
test.afterAll(async () => {
  await verifyAllJournaledProjects();
});
