// The quotation marks around a quoted phrase (#1075): the heading of a check, its row of the
// Check list, the title of a note card and the reference on Align.
// INV-QUOTE-MARKS-FOLLOW-INTERFACE: the marks are the interface language's, the ones its catalog
// has around `{quote}` in `check.next`. INV-QUOTE-MARKS-AT-PHRASE-ENDS: the opening mark is
// drawn before the first word and the closing mark after the last, on one line and on two,
// whichever way the phrase and the interface read; the phrase stays on the side of its box
// where it sat before.
//
// The fixtures hold English helps, so a journey reaches an English phrase only: #1075's case b
// (Arabic interface), case c (English), the French marks and Align. An Arabic phrase (cases a
// and d) needs Arabic helps; the helper's unit tests prove those (crates/tc-ui/src/quotation.rs).
//
//   TC4_BIN=target/debug/tc4 TC4_UI=target/tc-ui-app node --test parity/app/journeys/quotation-marks.test.mjs
import assert from 'node:assert/strict';
import { applyLanguage, browserTest, catalog, settled, until, withApp } from './kit.mjs';

const BIBLE = 'sample_burrito';
const STORIES = 'sample_burrito_obs';
const SCENARIO = { scenario: 'en-pins' };
const [OPEN_CURLY, CLOSE_CURLY, OPEN_ANGLE, CLOSE_ANGLE, NO_BREAK_SPACE] = ['\u{201C}', '\u{201D}', '\u{AB}', '\u{BB}', '\u{A0}'];
// The text of a place that holds a quoted phrase starts with a quotation mark of some pair.
const QUOTED = /^[\u{201C}\u{201D}\u{AB}]/u;

/**
 * Where the first and the last character of `el`'s text are drawn: the line (1 is the top one)
 * and the end of that line (`left` or `right`; `inside` when other text is on both sides,
 * `alone` when the line holds nothing else). Also the direction of the run that holds the marks,
 * the lines the text takes, and the side of its box that its last line sits on.
 */
function drawn(el) {
  const chars = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    for (let i = 0; i < node.data.length; i += 1) {
      const range = document.createRange();
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const r = range.getClientRects()[0];
      if (r && r.width > 0 && node.data[i].trim() !== '') chars.push({ ch: node.data[i], left: r.left, right: r.right, top: r.top, height: r.height });
    }
  }
  if (chars.length === 0) return { text: el.textContent, lines: 0 };
  const sameLine = (a, b) => Math.abs(a.top - b.top) < a.height / 2;
  const tops = [];
  for (const c of chars) if (!tops.some((t) => sameLine(c, t))) tops.push(c);
  tops.sort((a, b) => a.top - b.top);
  const at = (c) => {
    const line = chars.filter((o) => o !== c && sameLine(o, c));
    const end = line.length === 0 ? 'alone'
      : c.right <= Math.min(...line.map((o) => o.left)) + 0.5 ? 'left'
        : c.left >= Math.max(...line.map((o) => o.right)) - 0.5 ? 'right' : 'inside';
    return { char: c.ch, line: tops.findIndex((t) => sameLine(t, c)) + 1, end };
  };
  // The last line is the one with room to spare, so it shows the side.
  const box = el.getBoundingClientRect();
  const lastLine = chars.filter((c) => sameLine(c, tops.at(-1)));
  const gapLeft = Math.min(...lastLine.map((c) => c.left)) - box.left;
  const gapRight = box.right - Math.max(...lastLine.map((c) => c.right));
  return {
    text: el.textContent,
    dir: (el.querySelector('bdi') ?? el).getAttribute('dir'),
    lines: tops.length,
    first: at(chars[0]),
    last: at(chars.at(-1)),
    side: Math.abs(gapLeft - gapRight) <= 2 ? 'fills the box' : gapLeft < gapRight ? 'left' : 'right',
    cutShort: el.scrollWidth > el.clientWidth,
  };
}

/**
 * Narrows `el` one pixel at a time, down to `narrowest`, and counts the widths at which the
 * first character of its text is not on the line of the letter after it, or the last character
 * not on the line of the letter before it. `ends` replaces the two marks (the first and the
 * last text node) for the sweep.
 */
function sweep(el, { narrowest, ends }) {
  const nodes = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.data.length > 0) nodes.push(node);
  if (nodes.length < 3) throw new Error(`the marks are not text nodes of their own: ${nodes.length} text node(s)`);
  const own = [nodes[0].data, nodes.at(-1).data, el.style.width];
  if (ends) [nodes[0].data, nodes.at(-1).data] = ends;
  const chars = [];
  for (const node of nodes) {
    for (let i = 0; i < node.data.length; i += 1) if (node.data[i].trim() !== '') chars.push({ ch: node.data[i], node, i });
  }
  const lineOf = (c) => {
    const range = document.createRange();
    range.setStart(c.node, c.i);
    range.setEnd(c.node, c.i + 1);
    const r = range.getClientRects()[0];
    return r ? Math.round(r.top) : null;
  };
  const letters = chars.slice(1, -1).filter((c) => /\p{L}/u.test(c.ch));
  const [first, last, firstLetter, lastLetter] = [chars[0], chars.at(-1), letters[0], letters.at(-1)];
  const found = { widths: 0, mostLines: 0, openAlone: 0, closeAlone: 0 };
  for (let w = Math.floor(el.getBoundingClientRect().width); w >= narrowest; w -= 1) {
    el.style.width = `${w}px`;
    found.widths += 1;
    found.mostLines = Math.max(found.mostLines, new Set(chars.map(lineOf)).size);
    if (lineOf(first) !== lineOf(firstLetter)) found.openAlone += 1;
    if (lineOf(last) !== lineOf(lastLetter)) found.closeAlone += 1;
  }
  [nodes[0].data, nodes.at(-1).data, el.style.width] = own;
  return found;
}

const heading = (page) => page.getByTestId('check-quote');
const rows = (page) => page.locator('[data-testid="check-list"] [data-rail-index]');
/** The title of a row of the Check list: the span that holds the quoted phrase. */
const titleOf = (row) => row.locator('span').filter({ hasText: QUOTED });

/** The fonts are loaded and the layout is drawn: a measure taken earlier reads another font. */
async function ready(page) {
  await page.evaluate(() => document.fonts.ready);
  return settled(page);
}

async function openBook(page) {
  await page.getByTestId(`project-${BIBLE}`).getByTestId('book-tile-TIT').click();
  await page.getByTestId('understand-unit-s1').waitFor();
}

/** From the open book to the translationNotes list. */
async function toNotes(page, words) {
  await page.getByRole('tab', { name: words['nav.check'], exact: true }).click();
  await page.getByTestId('open-translationNotes').click();
  await heading(page).waitFor();
  await rows(page).first().waitFor();
  return ready(page);
}

async function openNotes(page, words) {
  await openBook(page);
  return toNotes(page, words);
}

/** Shows the check of row `i` and waits for its heading. */
async function showCheck(page, i) {
  const row = rows(page).nth(i);
  const index = await row.getAttribute('data-rail-index');
  if ((await row.getAttribute('aria-current')) !== 'true') await row.click();
  await page.locator(`[data-testid="check-quote"][data-check-index="${index}"]`).waitFor();
  return ready(page);
}

/** The rows whose title fits, shortest title first, each with its title (the phrase in its
 * two marks). */
const fittingRows = async (page) => (await rows(page).evaluateAll((all, quoted) => all.map((row, i) => {
  const span = [...row.querySelectorAll('span')].find((s) => new RegExp(quoted, 'u').test(s.textContent));
  return span && span.scrollWidth <= span.clientWidth ? { i, title: span.textContent } : null;
}).filter(Boolean), QUOTED.source)).sort((a, b) => a.title.length - b.title.length);

/** The first shown check whose heading takes `lines` lines (one, or more than one). */
async function checkWithHeadingOn(page, lines) {
  const fitting = await fittingRows(page);
  const order = [...fitting].sort((a, b) => (lines === 1 ? a.title.length - b.title.length : b.title.length - a.title.length)).slice(0, 4);
  for (const row of [{ i: 0 }, ...order]) {
    await showCheck(page, row.i);
    const found = await heading(page).evaluate(drawn);
    if ((lines === 1) === (found.lines === 1)) return found;
  }
  throw new Error(`no heading on ${lines === 1 ? 'one line' : 'two lines'} among the first row and the ${order.length} tried`);
}

/** The two marks are `open` and `close`, each at its end of the phrase: `ends` is the end of the
 * first line the opening mark is at and the end of the last line the closing mark is at. */
function assertEnds(found, { open, close, ends: [first, last], where }) {
  assert.deepEqual([found.first.char, found.last.char], [open, close], `INV-QUOTE-MARKS-FOLLOW-INTERFACE: ${where}: ${found.text}`);
  assert.deepEqual([found.first.line, found.first.end], [1, first], `INV-QUOTE-MARKS-AT-PHRASE-ENDS: ${where}: the opening mark is before the first word: ${JSON.stringify(found)}`);
  assert.deepEqual([found.last.line, found.last.end], [found.lines, last], `INV-QUOTE-MARKS-AT-PHRASE-ENDS: ${where}: the closing mark is after the last word: ${JSON.stringify(found)}`);
}

// Case b of #1075: an English phrase under the Arabic interface reads left to right, between «
// and », and stays on the right, where the interface puts it.
browserTest('j4_an_english_phrase_in_the_arabic_interface_has_guillemets_at_its_two_ends', async () => {
  await withApp(async ({ page }) => {
    const ar = catalog('ar');
    await openNotes(page, ar);
    const angle = { open: OPEN_ANGLE, close: CLOSE_ANGLE, ends: ['left', 'right'] };

    // A window a person may have, in which the longest phrases take two lines.
    await page.setViewportSize({ width: 900, height: 800 });
    await ready(page);
    const two = await checkWithHeadingOn(page, 2);
    assertEnds(two, { ...angle, where: 'the heading on two lines' });
    assert.equal(two.dir, 'ltr', 'the phrase reads its own way');
    assert.notEqual(two.side, 'left', `the heading stays on the interface's side: ${JSON.stringify(two)}`);
    const one = await checkWithHeadingOn(page, 1);
    assertEnds(one, { ...angle, where: 'the heading on one line' });
    assert.equal(one.side, 'right', `the heading stays on the interface's side: ${JSON.stringify(one)}`);
    await page.setViewportSize({ width: 1280, height: 800 });
    await ready(page);

    const [fitting] = await fittingRows(page);
    assert.ok(fitting, 'a row of the list shows its whole title');
    const row = await titleOf(rows(page).nth(fitting.i)).evaluate(drawn);
    assertEnds(row, { ...angle, where: 'a row of the Check list' });
    assert.equal(row.dir, 'ltr');
    assert.equal(row.side, 'right', `the title stays by its dot: ${JSON.stringify(row)}`);
  }, { ...SCENARIO, locale: 'ar' });
});

// The note card's title keeps its own side, as before: an English phrase sits on the left, also
// under the Arabic interface.
browserTest('j16_a_note_card_title_in_the_arabic_interface_has_guillemets_at_its_two_ends', async () => {
  await withApp(async ({ page }) => {
    await openBook(page);
    const titles = page.locator('[data-testid="helps-note"] p[dir]');
    await titles.first().waitFor();
    await ready(page);
    const all = [];
    for (let i = 0; i < await titles.count(); i += 1) all.push(await titles.nth(i).evaluate(drawn));
    const quoted = all.filter((t) => t.lines > 0 && QUOTED.test(t.text));
    assert.ok(quoted.length > 0, `a note card has a quoted title: ${JSON.stringify(all.map((t) => t.text).slice(0, 3))}`);
    assert.ok(quoted.some((t) => t.lines === 1), 'a title on one line');
    assert.ok(quoted.some((t) => t.lines > 1), 'a title on two lines');
    for (const title of quoted) {
      assertEnds(title, { open: OPEN_ANGLE, close: CLOSE_ANGLE, ends: ['left', 'right'], where: 'a note card title' });
      assert.equal(title.dir, 'ltr', title.text);
      // A last line that reaches both edges still starts at the left one.
      assert.notEqual(title.side, 'right', `the title keeps its own side: ${JSON.stringify(title)}`);
    }
  }, { ...SCENARIO, locale: 'ar' });
});

// The reference on Align: the marks follow the interface, and the opening mark is where the
// reference starts, whichever way its first letter reads.
browserTest('j5_the_reference_on_align_has_the_interface_marks_at_its_two_ends', async () => {
  await withApp(async ({ page }) => {
    const ar = catalog('ar');
    await openBook(page);
    await page.getByRole('tab', { name: ar['nav.check'], exact: true }).click();
    await page.getByTestId('open-align').click();
    await page.getByTestId('align-bank').waitFor();
    const reference = page.locator('h1').filter({ hasText: QUOTED });
    await reference.waitFor();
    await ready(page);
    const found = await reference.evaluate(drawn);
    const firstLetter = [...found.text].find((ch) => /\p{L}/u.test(ch));
    const rightToLeft = /[\u{590}-\u{8FF}\u{FB1D}-\u{FDFF}\u{FE70}-\u{FEFF}]/u.test(firstLetter);
    assertEnds(found, { open: OPEN_ANGLE, close: CLOSE_ANGLE, ends: rightToLeft ? ['right', 'left'] : ['left', 'right'], where: 'the reference on Align' });
    assert.equal(found.dir, rightToLeft ? 'rtl' : 'ltr', `the reference reads as its first letter does: ${found.text}`);
    assert.equal(found.side, 'right', `the reference stays on the interface's side: ${JSON.stringify(found)}`);
  }, { ...SCENARIO, locale: 'ar' });
});

// French sets a space inside « and ». It is a no-break space on screen, so no line ends with «
// or starts with ».
browserTest('j4_a_french_mark_stays_with_its_word_at_every_width', async () => {
  await withApp(async ({ page }) => {
    await openNotes(page, catalog('fr'));
    await showCheck(page, 0);
    const text = await heading(page).textContent();
    assert.ok(text.startsWith(`${OPEN_ANGLE}${NO_BREAK_SPACE}`) && text.endsWith(`${NO_BREAK_SPACE}${CLOSE_ANGLE}`),
      `INV-QUOTE-MARKS-FOLLOW-INTERFACE: French sets a space inside its marks: ${JSON.stringify(text)}`);
    assert.ok(!text.includes(` ${CLOSE_ANGLE}`) && !text.includes(`${OPEN_ANGLE} `), 'the space beside a mark is a no-break space');
    // The sweep can see a lone mark: a letter in place of each mark, with a plain space, is
    // left alone at some width.
    const control = await heading(page).evaluate(sweep, { narrowest: 120, ends: ['X ', ' X'] });
    assert.ok(control.mostLines >= 2 && control.closeAlone > 0, `the control leaves its last word alone at some width: ${JSON.stringify(control)}`);
    const found = await heading(page).evaluate(sweep, { narrowest: 120 });
    assert.ok(found.mostLines >= 2, `the heading takes two lines at some width: ${JSON.stringify(found)}`);
    assert.deepEqual([found.openAlone, found.closeAlone], [0, 0],
      `INV-QUOTE-MARKS-AT-PHRASE-ENDS: a mark is left without its word: ${JSON.stringify(found)}`);
  }, { ...SCENARIO, locale: 'fr' });
});

// Case c of #1075, and the marks of a check that is open when the interface language changes.
browserTest('j4_the_marks_follow_a_change_of_the_interface_language_with_a_check_open', async () => {
  await withApp(async ({ page }) => {
    const curly = { open: OPEN_CURLY, close: CLOSE_CURLY, ends: ['left', 'right'] };
    await openBook(page);
    const cards = page.locator('[data-testid="helps-note"] p[dir]').filter({ hasText: QUOTED });
    await cards.first().waitFor();
    await ready(page);
    const card = await cards.first().evaluate(drawn);
    assertEnds(card, { ...curly, where: 'a note card title in English' });
    assert.notEqual(card.side, 'right', `the title sits on the left: ${JSON.stringify(card)}`);

    await toNotes(page, catalog('en'));
    const [fitting] = await fittingRows(page);
    await showCheck(page, fitting.i);
    const phrase = fitting.title.slice(1, -1);
    const before = await heading(page).evaluate(drawn);
    assert.equal(before.text, `${OPEN_CURLY}${phrase}${CLOSE_CURLY}`);
    assertEnds(before, { ...curly, where: 'the heading in English' });
    assert.equal(before.side, 'left');
    const row = () => titleOf(rows(page).nth(fitting.i));
    assertEnds(await row().evaluate(drawn), { ...curly, where: 'a row in English' });

    await applyLanguage(page, 'ar');
    await page.waitForFunction((lang) => document.documentElement.lang === lang, 'ar');
    await until('the heading has the Arabic marks', async () => (await heading(page).textContent()) === `${OPEN_ANGLE}${phrase}${CLOSE_ANGLE}`);
    await until('the row has the Arabic marks', async () => (await row().textContent()) === `${OPEN_ANGLE}${phrase}${CLOSE_ANGLE}`);
    await ready(page);
    assertEnds(await heading(page).evaluate(drawn), { open: OPEN_ANGLE, close: CLOSE_ANGLE, ends: ['left', 'right'], where: 'the heading after the change' });

    await applyLanguage(page, 'fr');
    await page.waitForFunction((lang) => document.documentElement.lang === lang, 'fr');
    await until('the heading has the French marks', async () => (await heading(page).textContent()) === `${OPEN_ANGLE}${NO_BREAK_SPACE}${phrase}${NO_BREAK_SPACE}${CLOSE_ANGLE}`);
  }, SCENARIO);
});

// A phrase with no letter reads left to right, as `dir="auto"` read it: a note of story 16,
// frame 10 quotes "32,000", and its card title stays on the left in the Arabic interface,
// over its English note.
browserTest('j25_a_number_in_a_note_card_title_stays_on_the_left_in_the_arabic_interface', async () => {
  await withApp(async ({ page, env }) => {
    const stories = page.getByTestId(`project-${env.projectId(`_local_/_local_/${STORIES}`)}`);
    await stories.getByTestId('story-tile-1').click();
    await page.getByTestId('story-understand').waitFor();
    await page.getByTestId('story-16').click();
    await until('story 16 is open', async () => (await page.getByTestId('story-16').getAttribute('aria-current')) === 'page');
    await page.getByTestId('frame-marker-10').click();
    const number = page.locator('[data-testid="helps-note"] p[dir]').filter({ hasText: /^.32,000.$/u });
    await number.first().waitFor();
    await ready(page);
    const found = await number.first().evaluate(drawn);
    assertEnds(found, { open: OPEN_ANGLE, close: CLOSE_ANGLE, ends: ['left', 'right'], where: 'the title of a number' });
    assert.equal(found.dir, 'ltr', 'INV-QUOTE-MARKS-AT-PHRASE-ENDS: a phrase with no letter reads left to right');
    assert.equal(found.side, 'left', `INV-QUOTE-MARKS-AT-PHRASE-ENDS: the title stays on the left: ${JSON.stringify(found)}`);
  }, { ...SCENARIO, locale: 'ar' });
});
