// Book names in the interface language (#1043). Home's tiles, the Add a book list, the
// Understand and Translate headings, the book rail and the Check item header name a book as the
// interface catalog does, with Western digits after the name. In English the same project reads
// "Titus", whatever its own language.
//
//   TC4_BIN=target/debug/tc4 TC4_UI=target/tc-ui-app node --test parity/app/journeys/book-names.test.mjs
import assert from 'node:assert/strict';
import { bookName, browserTest, catalog, rebuildCatalog, until, withApp } from './kit.mjs';

// The sample project is Spanish (es-419) with Titus and Jonah.
const PROJECT = 'sample_burrito';
const card = (page) => page.getByTestId(`project-${PROJECT}`);
const tile = (page, code) => card(page).getByTestId(`book-tile-${code}`);
const heading = (page) => page.locator('main h2');

/** The interface's own words in language `id`, as the app resolves them. */
function words(id) {
  const own = { ...catalog(id), ...rebuildCatalog(id) };
  const english = { ...catalog('en'), ...rebuildCatalog('en') };
  return (key) => own[key] ?? english[key];
}

/** The book rail's rows: each book's tile, then the open book's chapter numbers. */
const railRows = (page, say) => page.locator('aside', { hasText: say('draft.books') }).getByRole('button').allTextContents();

/** Home, Add a book, Understand, the rail, Translate and a check, each naming its books as `id` does. */
async function walk(page, id) {
  const say = words(id);
  const name = (book) => bookName(id, book);

  // Home: each tile starts with its book's name.
  for (const [code, book] of [['TIT', 'titus'], ['JON', 'jonah']]) {
    await tile(page, code).waitFor();
    const shown = await tile(page, code).textContent();
    assert.ok(shown.startsWith(name(book)), `Home's tile of ${code} reads ${JSON.stringify(shown)}, not ${name(book)}`);
  }

  // Add a book: the list of all 66 books, each beside its code.
  await card(page).getByRole('button', { name: say('home.addBookTile') }).click();
  await page.getByRole('button', { name: say('addBook.blankTitle') }).click();
  await page.getByRole('combobox', { name: say('addBook.book'), exact: true }).click();
  await page.getByRole('listbox').waitFor();
  const options = await page.getByRole('listbox').getByRole('option').allTextContents();
  assert.equal(options.length, 66, 'the list holds every book');
  for (const [code, book] of [['GEN', 'genesis'], ['1SA', 'firstSamuel'], ['SNG', 'songOfSongs'], ['TIT', 'titus'], ['REV', 'revelation']]) {
    const option = options.find((text) => text.includes(code));
    assert.ok(option?.includes(name(book)), `Add a book lists ${code} as ${JSON.stringify(option)}, not ${name(book)}`);
  }
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await until('the dialog closes', async () => (await page.getByRole('dialog').count()) === 0);

  // Understand's heading and the book rail.
  await tile(page, 'TIT').click();
  await page.getByTestId('understand').waitFor();
  await until('the Understand heading', async () => (await heading(page).textContent()) === `${name('titus')} 1`);
  const rows = await railRows(page, say);
  for (const book of ['titus', 'jonah']) assert.ok(rows.some((row) => row.startsWith(name(book))), `the rail has no row for ${name(book)}: ${JSON.stringify(rows)}`);

  // Translate's heading.
  await page.getByTestId('mode-switch').getByRole('tab', { name: say('nav.draft') }).click();
  await page.getByTestId('draft-target-text').first().waitFor();
  assert.equal(await heading(page).textContent(), `${name('titus')} 1`);

  // A check's header: the book, then chapter and verse in Western digits.
  await page.getByRole('tab', { name: say('nav.check'), exact: true }).click();
  const tool = page.getByTestId('open-translationNotes');
  const allTools = page.getByRole('button', { name: say('check.back') });
  await tool.or(allTools).first().waitFor();
  if (!(await tool.count())) await allTools.click();
  await tool.click();
  await page.getByTestId('check-quote').waitFor();
  const place = await page.getByTestId('check-item-counter').locator('xpath=../span[1]').textContent();
  assert.ok(place.startsWith(`${name('titus')} `), `the check's header reads ${JSON.stringify(place)}`);
  assert.match(place.slice(name('titus').length + 1), /^[0-9]+:[0-9]+$/, `the check's header reads ${JSON.stringify(place)}`);
}

browserTest('an_english_interface_names_books_in_english_whatever_the_project', async () => {
  assert.equal(bookName('en', 'titus'), 'Titus');
  await withApp(async ({ page }) => walk(page, 'en'));
});
