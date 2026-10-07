// #42 — keyboard pass on the Check pages: a logical tab order and a visible
// focus ring. The tool picker, a translationWords session (rail, detail pane,
// Academy drawer) and the GuidedFix and SourceTexts dialogs, worked with the
// keyboard alone once the Check tab is open.
//
// At each Tab stop the journey asserts the focused element and its computed
// focus ring: an outline 2px or wider in the colour of `--accent`
// (src/ds/tokens/base.css). The ordered list of Tab stops (data-testid, role,
// nearest data-testid scope) is the run's artifact, `check-keyboard-stops.json`
// under test-results/. The fixture is reset before the run, so each run writes
// the same file.
//
// The rig fixtures it needs: the English helps suite at the shipped pins and the
// seeded sample project (dev-env/README.md, "Journeys from a clean clone").
import { test, expect } from './helpers/test';
import type { Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {
  SEEDED_PROJECT,
  rigRepo,
  pinForSideloaded,
  writeProjectPins,
  readDecisionFile,
  resetSeededChecking,
  resetPlaces,
} from './helpers/rig';
import { verifyAllJournaledProjects } from './helpers/journal';

const PINS = () => ({
  tn: pinForSideloaded('en_tn', 'v91'),
  tw: pinForSideloaded('en_tw', 'v91'),
  ta: pinForSideloaded('en_ta', 'v91'),
});

type Stop = { testid: string | null; role: string; scope: string | null };

/** The focused element, as the artifact records it. */
async function focused(page: Page): Promise<Stop> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return { testid: null, role: 'body', scope: null };
    return {
      testid: el.dataset.testid ?? null,
      role: el.getAttribute('role') ?? el.tagName.toLowerCase(),
      scope: el.parentElement?.closest<HTMLElement>('[data-testid]')?.dataset.testid ?? null,
    };
  });
}

/** Assert the focused element shows the design system ring: an outline 2px or
 * wider, in the computed colour of --accent. */
async function expectRing(page: Page): Promise<void> {
  const ring = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    const probe = document.createElement('span');
    probe.style.color = 'var(--accent)';
    document.body.appendChild(probe);
    const accent = getComputedStyle(probe).color;
    probe.remove();
    const cs = getComputedStyle(el);
    return { width: parseFloat(cs.outlineWidth), style: cs.outlineStyle, color: cs.outlineColor, accent };
  });
  expect(ring.style, 'the focused element has an outline').not.toBe('none');
  expect(ring.width, 'the outline is 2px or wider').toBeGreaterThanOrEqual(2);
  expect(ring.color, 'the outline is --accent').toBe(ring.accent);
}

/** One recorder for the whole run: every Tab stop, in order, with its ring checked. */
function recorder(page: Page) {
  const stops: Array<Stop & { step: string }> = [];
  let step = '';
  const record = async () => {
    await expectRing(page);
    const stop = await focused(page);
    stops.push({ step, ...stop });
    return stop;
  };
  return {
    stops,
    step: (name: string) => { step = name; },
    record,
    /** Press Tab once and return the new stop. */
    tab: async (shift = false) => {
      await page.keyboard.press(shift ? 'Shift+Tab' : 'Tab');
      return record();
    },
    /** Press Tab (Shift+Tab with `back`) until the stop matches; fail after `max` stops. */
    tabTo: async (match: (s: Stop) => boolean, max = 60, back = false) => {
      for (let n = 0; n < max; n++) {
        await page.keyboard.press(back ? 'Shift+Tab' : 'Tab');
        const stop = await record();
        if (match(stop)) return stop;
      }
      throw new Error(`no Tab stop matched within ${max} presses`);
    },
  };
}

const isTestId = (id: string) => (s: Stop) => s.testid === id;
const activeIs = (page: Page, selector: string) =>
  page.evaluate((sel) => document.activeElement?.matches(sel) ?? false, selector);

/** A pin of a French suite that is not installed: the resolver falls back to the
 * installed English suite and warns (the j04 B20 fixture). */
const frPin = (name: string, n: number) => ({
  repoPath: `git.door43.org/fr_gl/${name}`,
  version: 'v10',
  sha: String(n).repeat(40).slice(0, 40),
  flavor: name.endsWith('_ta') ? 'peripheral/x-peripheralArticles' : name.endsWith('_tn') ? 'parascriptural/x-bcvnotes' : 'parascriptural/x-bcvarticles',
});

/** Primary French (absent), fallback English (installed): every ready card
 * carries a fetch button for its missing primary. */
function writeFallbackPins(): void {
  const en = PINS();
  const setFor = (gw: { languageId: string; owner: string }, tn: unknown, tw: unknown, ta: unknown) => ({
    gatewayLanguage: gw,
    translationNotes: tn,
    translationWordsLinks: tw,
    translationWords: tw,
    translationAcademy: ta,
  });
  const dir = path.join(rigRepo(SEEDED_PROJECT), 'ingredients', 'checking');
  const p = path.join(dir, 'resources.json');
  const file: Record<string, unknown> = {
    schemaVersion: 2,
    languageSets: {
      primary: setFor({ languageId: 'fr', owner: 'unfoldingWord' }, frPin('fr_tn', 1), frPin('fr_tw', 2), frPin('fr_ta', 3)),
      fallback: setFor({ languageId: 'en', owner: 'unfoldingWord' }, en.tn, en.tw, en.ta),
    },
  };
  // The writeProjectPins carry-forward rule: keep every top-level field this
  // file does not own (extraScripture, the resources groups).
  const existing = JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown>;
  for (const [key, value] of Object.entries(existing)) {
    if (key !== 'schemaVersion' && key !== 'languageSets') file[key] = value;
  }
  fs.writeFileSync(p, `${JSON.stringify(file, null, 2)}\n`);
}

/** Open the seeded project's Titus (setup, with the mouse), then the Check tab
 * with the keyboard. Focus is on the Check tab when this returns. */
async function openCheckTab(page: Page): Promise<void> {
  await page.goto('/');
  await page
    .getByTestId(`project-_local_/_local_/${SEEDED_PROJECT}`)
    .getByRole('button', { name: /Titus/ })
    .click();
  const tab = page.getByRole('tab', { name: 'Check', exact: true });
  await expect(tab).toBeVisible();
  await tab.focus();
  await page.keyboard.press('Enter');
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('preflight-translationWords')).toHaveAttribute('data-state', 'ready');
}

/** Focus stays inside the dialog for a full Tab cycle, and Escape returns it to
 * the button that opened the dialog. */
async function expectDialogHoldsFocus(page: Page, rec: ReturnType<typeof recorder>, dialogTestId: string, openerTestId: string) {
  const dialog = page.getByTestId(dialogTestId);
  await expect(dialog).toBeVisible();
  const inside = () => page.evaluate((id) => {
    const d = document.querySelector(`[data-testid="${id}"]`);
    return !!d && d.contains(document.activeElement);
  }, dialogTestId);
  await expect.poll(inside).toBe(true);
  const seen = new Set<string>();
  for (let n = 0; n < 40; n++) {
    const stop = await rec.tab();
    expect(await inside(), `Tab stop ${n + 1} stays inside ${dialogTestId}`).toBe(true);
    const key = JSON.stringify(stop);
    if (seen.has(key) && n > 0) break; // the cycle came round
    seen.add(key);
  }
  expect(await inside(), 'Shift+Tab stays inside too').toBe(true);
  await rec.tab(true);
  expect(await inside()).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => activeIs(page, `[data-testid="${openerTestId}"]`)).toBe(true);
  await rec.record();
}

test.beforeEach(() => {
  resetSeededChecking();
  resetPlaces();
});

test.describe('#42 — the Check pages work with the keyboard alone', () => {
  test(
    'picker, tW session and dialogs: a logical Tab order, a visible focus ring, and focus that moves where the user is',
    { tag: ['@keyboard', '@J4'] },
    async ({ page }, testInfo) => {
      test.setTimeout(120_000);
      const rec = recorder(page);

      // 1 · The picker. A ready card with a missing primary has two Tab stops:
      // open first, then fetch. The fetch button opens SourceTexts, which holds
      // and returns focus.
      rec.step('picker: open, then fetch');
      writeFallbackPins();
      await openCheckTab(page);
      await expect(page.getByTestId('fetch-primary-translationNotes')).toBeVisible();
      await rec.tabTo(isTestId('open-translationNotes'));
      expect(await rec.tab()).toMatchObject({ testid: 'fetch-primary-translationNotes' });
      rec.step('SourceTexts dialog');
      await page.keyboard.press('Enter');
      await expectDialogHoldsFocus(page, rec, 'sources-modal', 'fetch-primary-translationNotes');

      // 6 (dialogs) · GuidedFix opens from a card whose pinned resource is
      // missing. It holds focus and returns it to its button.
      rec.step('GuidedFix dialog');
      const en = PINS();
      writeProjectPins(SEEDED_PROJECT, { ...en, tn: { ...en.tn, version: 'v1', sha: 'a'.repeat(40) } });
      await openCheckTab(page);
      await expect(page.getByTestId('preflight-translationNotes')).toHaveAttribute('data-state', 'fetch');
      await rec.tabTo(isTestId('fix-translationNotes'));
      await page.keyboard.press('Enter');
      await expectDialogHoldsFocus(page, rec, 'guided-fix', 'fix-translationNotes');

      // 2 · A clean English tW session. No stored decisions, so the only
      // decision on disk is the one this journey makes.
      rec.step('open the tW session');
      writeProjectPins(SEEDED_PROJECT, PINS());
      fs.rmSync(path.join(rigRepo(SEEDED_PROJECT), 'ingredients', 'checking', 'translationWords', 'TIT.json'), { force: true });
      await openCheckTab(page);
      await rec.tabTo(isTestId('open-translationWords'));
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('check-progress')).toBeVisible();
      await expect.poll(() => activeIs(page, '[data-testid="check-list"] [aria-current="true"]')).toBe(true);
      await rec.record();

      // 3 · The rail is one Tab stop; the arrow keys move the selection.
      rec.step('rail arrows');
      const counter = page.getByTestId('check-item-counter');
      const first = await counter.textContent();
      await page.keyboard.press('ArrowDown');
      await expect(counter).not.toHaveText(first ?? '');
      expect(await activeIs(page, '[data-testid="check-list"] [aria-current="true"]')).toBe(true);
      await rec.record();
      await page.keyboard.press('ArrowUp');
      await expect(counter).toHaveText(first ?? '');
      // Move on until the item's verse is drafted with two words or more.
      for (let n = 0; n < 40; n++) {
        if (await page.locator('[data-testid="check-target"][data-drafted="1"] [data-testid="tw-1"]').count()) break;
        await page.keyboard.press('ArrowDown');
      }
      await expect(page.getByTestId('tw-1')).toBeVisible();
      expect(await activeIs(page, '[data-testid="check-list"] [aria-current="true"]')).toBe(true);
      await rec.record();
      // Tab leaves the list at once: the rail's footer, then the detail pane.
      rec.step('rail to detail');
      expect(await rec.tab()).toMatchObject({ testid: 'check-to-draft' });
      await rec.tab();
      expect(await page.evaluate(() => !!document.activeElement?.closest('main'))).toBe(true);

      // The Academy drawer holds focus and returns it.
      rec.step('Academy drawer');
      if (!(await activeIs(page, '[data-testid="open-academy"]'))) await rec.tabTo(isTestId('open-academy'));
      await page.keyboard.press('Enter');
      await expectDialogHoldsFocus(page, rec, 'academy-drawer', 'open-academy');

      // 4 · The target words are one Tab stop. Shift+Right selects two words.
      rec.step('target words');
      const word = await rec.tabTo((s) => /^tw-\d+$/.test(s.testid ?? ''));
      expect(word.testid).toBe('tw-0');
      const w0 = (await page.getByTestId('tw-0').textContent())?.trim();
      const w1 = (await page.getByTestId('tw-1').textContent())?.trim();
      await page.keyboard.press('Shift+ArrowRight');
      await expect(page.getByTestId('tw-0')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('tw-1')).toHaveAttribute('aria-pressed', 'true');
      expect(await activeIs(page, '[data-testid="tw-1"]')).toBe(true);
      await rec.record();
      // Space clears the focused word and selects it again: gaps stay possible.
      await page.keyboard.press(' ');
      await expect(page.getByTestId('tw-1')).toHaveAttribute('aria-pressed', 'false');
      await page.keyboard.press(' ');
      await expect(page.getByTestId('tw-1')).toHaveAttribute('aria-pressed', 'true');
      expect(await rec.tab()).toMatchObject({ testid: 'mark-valid' });
      const checkId = await page.locator('[data-testid="check-list"] [aria-current="true"]').getAttribute('data-check-id');
      await page.keyboard.press('Enter');
      await expect
        .poll(() => {
          const d = readDecisionFile(SEEDED_PROJECT, 'translationWords', 'TIT')?.decisions
            .find((x) => (x as { contextId?: { checkId?: string } }).contextId?.checkId === checkId) as
            { status?: string; selections?: Array<{ text: string }> } | undefined;
          return d && { status: d.status, words: d.selections?.map((x) => x.text) };
        }, { timeout: 10_000 })
        .toEqual({ status: 'valid', words: [w0, w1] });

      // 5 · A comment; Done returns focus to the comment button.
      rec.step('comment');
      await rec.tabTo(isTestId('comment-toggle'));
      await page.keyboard.press('Enter');
      expect(await rec.tab()).toMatchObject({ testid: 'comment-text' });
      await page.keyboard.type('Checked with the keyboard.');
      expect(await rec.tab()).toMatchObject({ testid: 'comment-done' });
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('comment-editor')).toHaveCount(0);
      await expect.poll(() => activeIs(page, '[data-testid="comment-toggle"]')).toBe(true);
      await rec.record();

      // 7 · Back returns focus to the card that opened the session. The Back
      // button heads the rail, so Shift+Tab walks back to it in reverse order.
      rec.step('back');
      await rec.tabTo(isTestId('check-back'), 80, true);
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('preflight-translationWords')).toBeVisible();
      await expect.poll(() => activeIs(page, '[data-testid="open-translationWords"]')).toBe(true);
      await rec.record();

      // The run's artifact: every Tab stop in order.
      const file = testInfo.outputPath('check-keyboard-stops.json');
      fs.writeFileSync(file, `${JSON.stringify(rec.stops, null, 2)}\n`);
      await testInfo.attach('check-keyboard-stops', { path: file, contentType: 'application/json' });
    },
  );
});

test.afterAll(async () => {
  try {
    await verifyAllJournaledProjects();
  } finally {
    resetSeededChecking();
  }
});
