// #619: what a rendered helps article shows: its quote blocks, its bold and italic
// words, and each Markdown mark that is still on the screen as text.
import type { Locator } from '@playwright/test';

export function articleMarks(article: Locator) {
  return article.evaluate((el) => {
    const text = el.textContent ?? '';
    const quotes = [...el.querySelectorAll('blockquote > p')];
    const firstQuote = el.querySelector('blockquote');
    const firstBold = el.querySelector('strong');
    return {
      quoteBlocks: quotes.length,
      nestedQuoteBlocks: el.querySelectorAll('blockquote blockquote > p').length,
      quotes: quotes.map((p) => (p.textContent ?? '').slice(0, 80)),
      // How far the text of the first quote sits from the start edge of the article: the indent and the bar.
      quoteIndentPx: firstQuote
        ? parseFloat(getComputedStyle(firstQuote).paddingInlineStart) + parseFloat(getComputedStyle(firstQuote).borderInlineStartWidth)
        : 0,
      bold: [...el.querySelectorAll('strong')].map((s) => s.textContent ?? ''),
      boldWeight: firstBold ? Number(getComputedStyle(firstBold).fontWeight) : 0,
      italic: [...el.querySelectorAll('em')].map((s) => s.textContent ?? ''),
      linesThatStartWithQuoteMark: [...el.querySelectorAll('p')].map((p) => p.textContent ?? '').filter((line) => line.startsWith('>')),
      doubleUnderscores: text.split('__').length - 1,
      doubleAsterisks: text.split('**').length - 1,
    };
  });
}
