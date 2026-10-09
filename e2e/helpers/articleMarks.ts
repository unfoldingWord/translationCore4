// #619: what a rendered helps article shows: its quote blocks, its bold and italic
// words, and each Markdown mark that is still on the screen as text.
import type { Locator } from '@playwright/test';

export function articleMarks(article: Locator) {
  return article.evaluate((el) => {
    const text = el.textContent ?? '';
    return {
      quoteBlocks: el.querySelectorAll('blockquote > p').length,
      nestedQuoteBlocks: el.querySelectorAll('blockquote blockquote > p').length,
      bold: [...el.querySelectorAll('strong')].map((s) => s.textContent ?? ''),
      italic: [...el.querySelectorAll('em')].map((s) => s.textContent ?? ''),
      linesThatStartWithQuoteMark: [...el.querySelectorAll('p')].map((p) => p.textContent ?? '').filter((line) => line.startsWith('>')),
      doubleUnderscores: text.split('__').length - 1,
      doubleAsterisks: text.split('**').length - 1,
    };
  });
}
