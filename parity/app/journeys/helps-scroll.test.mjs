// #993: the helps' focus ink and vertical scroll must not create horizontal overflow.
// TC4_EVIDENCE optionally saves the screenshots and measured extents of the real app.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO } from '../env-rust.mjs';
import { browserTest, settled, until, withApp } from './kit.mjs';

const panel = (page) => page.getByTestId('helps-panel');
const list = (page) => panel(page).locator(':scope > div').nth(2);

async function extents(page) {
  return panel(page).evaluate((pane) => {
    const extent = (el) => ({ width: el.clientWidth, scrollWidth: el.scrollWidth, height: el.clientHeight, scrollHeight: el.scrollHeight });
    return { panel: extent(pane), tabs: extent(pane.querySelector('[role="tablist"]')), list: extent(pane.children[2]) };
  });
}

async function fits(page, name, records) {
  await settled(page);
  const measured = await extents(page);
  records.push({ name, ...measured });
  for (const [part, size] of Object.entries(measured)) {
    assert.ok(size.width > 0 && size.height > 0, `INV-HELPS-MEASURE-VISIBLE: ${name}, ${part}: ${JSON.stringify(size)}`);
    assert.ok(size.scrollWidth <= size.width, `INV-HELPS-NO-SPURIOUS-X-SCROLL: ${name}, ${part}: ${JSON.stringify(size)}`);
  }
}

async function shot(page, name) {
  if (process.env.TC4_EVIDENCE) await page.screenshot({ path: path.join(process.env.TC4_EVIDENCE, `${name}.png`) });
}

async function resize(page, width) {
  const before = await panel(page).boundingBox();
  const divider = await page.getByTestId('helps-divider').boundingBox();
  const x = divider.x + divider.width / 2;
  const y = divider.y + 100;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + before.width - width, y, { steps: 4 });
  await page.mouse.up();
  await until(`helps width ${width}`, async () => Math.round((await panel(page).boundingBox()).width) === width);
}

for (const mode of ['Understand', 'Translate']) {
  browserTest(`fitting_helps_keep_their_focus_and_scroll_after_clicks_in_${mode.toLowerCase()}`, async () => {
    const records = [];
    await withApp(async ({ page }) => {
      // en-pins has no Bible tQ. Draw the real questions from the OBS resource fixture
      // as a ready slot, through the same passage response and question-card renderer.
      const [, ...rows] = fs.readFileSync(path.join(REPO, 'fixtures/tc4/test-fixtures/resources/en_obs-tq@v10/OBS.tsv'), 'utf8').trim().split(/\r?\n/);
      const items = rows.slice(0, 2).map((row) => {
        const [reference, id, , , , question, response] = row.split('\t');
        const [chapter, verse] = reference.split(':');
        return { id, chapter, verse, question, response };
      });
      await page.route('**/api/v1/helps/passage', async (route) => {
        const reply = await (await route.fetch()).json();
        reply.value.questions = { type: 'ready', value: { items, dir: 'ltr', fallback: false } };
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reply) });
      });
      await page.getByTestId('project-sample_burrito').getByRole('button', { name: /Titus/ }).click();
      await page.getByTestId('helps-note').first().waitFor();
      if (mode === 'Translate') {
        await page.getByTestId('mode-switch').getByRole('tab', { name: mode, exact: true }).click();
        await page.getByRole('button', { name: 'Draft section 1–3', exact: true }).waitFor();
      }
      const note = page.getByTestId('helps-note').first();
      await note.waitFor();
      await fits(page, 'before-click', records);
      await shot(page, `${mode}-before`);
      await note.click({ position: { x: 8, y: 8 } });
      assert.equal(await note.evaluate((el) => document.activeElement === el), true, 'the clicked card has focus');
      await fits(page, 'note-click', records);
      // Keyboard modality exercises the design system's :focus-visible ring as well.
      await page.keyboard.press('Tab');
      await note.focus();
      const ring = await note.evaluate((el) => {
        const css = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        const clip = el.closest('aside').children[2].getBoundingClientRect();
        const ink = parseFloat(css.outlineWidth) + parseFloat(css.outlineOffset);
        return { visible: el.matches(':focus-visible') && css.outlineStyle !== 'none' && parseFloat(css.outlineWidth) > 0,
          inside: rect.left - ink >= clip.left && rect.right + ink <= clip.right && rect.top - ink >= clip.top && rect.bottom + ink <= clip.bottom };
      });
      assert.deepEqual(ring, { visible: true, inside: true }, 'INV-HELPS-FOCUS-VISIBLE: the whole focus ring fits inside the scrollport');
      await fits(page, 'keyboard-focus', records);
      await shot(page, `${mode}-focused`);
      const more = note.getByTestId('note-expand');
      await more.click();
      assert.equal(await more.getAttribute('aria-expanded'), 'true');
      await fits(page, 'show-more', records);
      await more.click();
      const academy = page.getByTestId('helps-note').filter({ has: page.getByRole('button', { name: /→/ }) }).first().getByRole('button', { name: /→/ });
      await academy.click();
      await page.getByTestId('understand-article').waitFor();
      await fits(page, 'academy-article', records);
      await page.getByTestId('helps-article-close').click();
      // An empty part of the list's padding is still a click in the helps.
      await list(page).click({ position: { x: 4, y: 4 } });
      await fits(page, 'empty-space', records);
      const size = (await extents(page)).list;
      assert.ok(size.scrollHeight > size.height, 'INV-HELPS-VERTICAL-SCROLL: the real chapter needs vertical scrolling');
      await list(page).hover();
      await page.mouse.wheel(0, 400);
      await until('the helps scroll down', async () => (await list(page).evaluate((el) => el.scrollTop)) > 0);
      await fits(page, 'vertical-scroll', records);
      await panel(page).getByRole('tab', { name: 'Words', exact: true }).click();
      const word = page.getByTestId('helps-word').first();
      await word.waitFor();
      await word.click({ position: { x: 8, y: 8 } });
      await fits(page, 'word-click', records);
      await word.getByRole('button', { name: /Read the article/ }).click();
      await page.getByTestId('understand-article').waitFor();
      await fits(page, 'word-article', records);
      await page.getByTestId('helps-article-close').click();
      for (const width of [480, 280, 340]) {
        await resize(page, width);
        await fits(page, `resize-${width}`, records);
        const tabsInside = await panel(page).getByRole('tab').evaluateAll((tabs) => tabs.every((tab) => {
          const box = tab.getBoundingClientRect();
          const pane = tab.closest('aside').getBoundingClientRect();
          return box.left >= pane.left && box.right <= pane.right;
        }));
        assert.equal(tabsInside, true, 'INV-HELPS-NO-SPURIOUS-X-SCROLL: every tab stays inside the resized pane');
        await shot(page, `${mode}-${width}`);
      }
      await panel(page).getByRole('tab', { name: 'Questions', exact: true }).click();
      await fits(page, 'questions-tab', records);
      await page.getByTestId('understand-question').first().click();
      await fits(page, 'question-click', records);
      // The real Notes resource has an unwrapped article label wider than 280px.
      // This is permitted overflow: the person must still be able to reach its end.
      await panel(page).getByRole('tab', { name: 'Notes', exact: true }).click();
      await resize(page, 280);
      const wide = await extents(page);
      assert.ok(wide.list.scrollWidth > wide.list.width, 'the real unwrapped label is wider than this pane');
      await list(page).hover();
      await page.mouse.wheel(400, 0);
      await until('genuinely wide content scrolls horizontally', async () => (await list(page).evaluate((el) => el.scrollLeft)) > 0);
      records.push({ name: 'genuinely-wide-content', ...wide });
      await shot(page, `${mode}-wide-content`);
      await page.setViewportSize({ width: 500, height: 938 });
      await note.scrollIntoViewIfNeeded();
      await resize(page, 480);
      await note.click({ position: { x: 8, y: 8 } });
      await fits(page, 'small-window-note-click', records);
      await more.click();
      await fits(page, 'small-window-show-more', records);
      await more.click();
      await panel(page).getByRole('tab', { name: 'Questions', exact: true }).click();
      await page.getByTestId('understand-question').first().click();
      await fits(page, 'small-window-question-click', records);
      await panel(page).getByRole('tab', { name: 'Words', exact: true }).click();
      await word.click({ position: { x: 8, y: 8 } });
      await word.getByRole('button', { name: /Read the article/ }).click();
      await page.getByTestId('understand-article').waitFor();
      await fits(page, 'small-window-word-article', records);
      await shot(page, `${mode}-small-window-article`);
      await page.getByTestId('helps-article-close').click();
      if (process.env.TC4_EVIDENCE) fs.writeFileSync(path.join(process.env.TC4_EVIDENCE, `${mode}-extents.json`), `${JSON.stringify(records, null, 2)}\n`);
    }, { scenario: 'en-pins' });
  });
}
