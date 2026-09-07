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
function readSegmentEvents(file: string): Array<{ op: string; chapter?: string; verse?: string; text?: string }> {
  const container = JSON.parse(fs.readFileSync(file, 'utf8')) as { body: string };
  return (JSON.parse(container.body) as { events: Array<{ op: string; chapter?: string; verse?: string; text?: string }> }).events;
}

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
});

// Issue #62 teardown: after this journey's mutations, every journaled local
// project must be a verified byte-for-byte materialization of its journal.
test.afterAll(async () => {
  await verifyAllJournaledProjects();
});
