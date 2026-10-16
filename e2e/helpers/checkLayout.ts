// #762: the Check view's layout facts, read in one pass, and the rules that
// hold at any window width. Journeys 4 and 22 use them.
import { expect, type Page } from '@playwright/test';

/** `chars(el, n)` is n characters of el's own font, in px. The note box is
 * absent from a translationWords item. */
export const checkLayout = (page: Page) => page.evaluate(() => {
  const chars = (el: Element, n: number) => {
    const s = document.createElement('span');
    s.style.cssText = `position:absolute;visibility:hidden;width:${n}ch`;
    el.appendChild(s);
    const w = s.getBoundingClientRect().width;
    s.remove();
    return w;
  };
  const q = (sel: string) => document.querySelector(sel);
  const box = (el: Element) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width };
  };
  const row = q('[data-testid="compare-sources"]')!;
  const card = q('[data-testid="compare-card"]')!;
  const note = q('[data-testid="check-note"]');
  const main = q('[data-testid="check-session"] main')!;
  const texts = ['[data-testid="check-note-text"]', '[data-testid="orig-pane"] p', '[data-testid="ult-pane-text"]', '[data-testid="story-pane-text"]', '[data-testid="check-target"]']
    .flatMap((sel) => [...document.querySelectorAll(sel)].map((el) => ({ sel, width: el.getBoundingClientRect().width, max: chars(el, 80) })));
  return {
    dir: document.documentElement.dir || 'ltr',
    note: note ? box(note) : null,
    card: box(card),
    translation: box(q('[data-testid="compare-translation"]')!),
    cards: [...row.children].map(box),
    rowWidth: row.getBoundingClientRect().width,
    rowMin: chars(row, 40) + 40,
    gap: getComputedStyle(row).columnGap,
    translationGap: getComputedStyle(card).rowGap,
    radius: getComputedStyle(row.children[0]).borderTopLeftRadius,
    texts,
    horizontalScroll: main.scrollWidth > main.clientWidth || document.documentElement.scrollWidth > window.innerWidth,
  };
});
export type CheckLayout = Awaited<ReturnType<typeof checkLayout>>;

/** One row per fitting column count, text at most 80ch, the note and the card
 * on one leading edge, separate rounded cards with 6px and 24px gaps. */
export function expectCheckLayout(seen: CheckLayout, label: string) {
  const lead = seen.dir === 'rtl' ? 'right' : 'left';
  if (seen.note) expect(Math.abs(seen.note[lead] - seen.card[lead]), `${label}: leading edges`).toBeLessThanOrEqual(1);
  for (const t of seen.texts) expect(t.width, `${label}: ${t.sel} is at most 80ch`).toBeLessThanOrEqual(t.max + 1);
  const fit = Math.max(1, Math.floor((seen.rowWidth + 6) / (seen.rowMin + 6)));
  const columns = Math.min(seen.cards.length, fit);
  expect(seen.cards.filter((c) => Math.abs(c.top - seen.cards[0].top) < 1).length, `${label}: columns`).toBe(columns);
  const last = seen.cards[seen.cards.length - 1];
  if (seen.cards.filter((c) => Math.abs(c.top - last.top) < 1).length === 1) {
    expect(Math.abs(last.width - seen.rowWidth), `${label}: a lone last card is full width`).toBeLessThan(1);
  }
  expect(seen.translation.top, `${label}: Your translation is below the source texts`).toBeGreaterThan(Math.max(...seen.cards.map((c) => c.bottom)));
  expect([seen.gap, seen.translationGap, seen.radius === '0px'], `${label}: card gaps and corners`).toEqual(['6px', '24px', false]);
}
