// #993: a small window must not collapse the passage or push fitting helps off screen.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { browserTest, settled, until, withApp } from './kit.mjs';

async function capture(page, name) {
  await settled(page);
  const measured = await page.evaluate(() => {
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    };
    const header = document.querySelector('header');
    const pane = document.querySelector('[data-testid="helps-panel"]');
    const main = pane.previousElementSibling;
    return {
      viewport: innerWidth,
      main: box(main),
      helps: box(pane),
      list: { width: pane.children[2].clientWidth, scrollWidth: pane.children[2].scrollWidth },
      header: [
        ['brand', header.firstElementChild.firstElementChild],
        ['project', header.querySelector('[data-testid="project-switch"]')],
        ['modes', header.querySelector('[data-testid="mode-switch"]')],
        ['status', header.lastElementChild],
      ].map(([name, el]) => ({ name, ...box(el) })),
    };
  });
  if (process.env.TC4_EVIDENCE) {
    fs.mkdirSync(process.env.TC4_EVIDENCE, { recursive: true });
    fs.writeFileSync(path.join(process.env.TC4_EVIDENCE, `${name}.json`), `${JSON.stringify(measured, null, 2)}\n`);
    await page.screenshot({ path: path.join(process.env.TC4_EVIDENCE, `${name}.png`) });
  }
  return measured;
}

function fitsWindow(measured) {
  assert.ok(measured.main.width >= Math.min(320, measured.viewport), `INV-READING-SPACE: passage collapsed: ${JSON.stringify(measured)}`);
  for (const name of ['main', 'helps']) {
    const b = measured[name];
    assert.ok(b.width > 0 && b.height > 0 && b.left >= 0 && b.right <= measured.viewport + 1,
      `INV-READING-SPACE: ${name} outside the window: ${JSON.stringify(measured)}`);
  }
  assert.ok(measured.list.width > 0 && measured.list.scrollWidth <= measured.list.width,
    `INV-HELPS-NO-SPURIOUS-X-SCROLL: fitting word cards: ${JSON.stringify(measured.list)}`);
  for (const a of measured.header) {
    assert.ok(a.width > 0 && a.height > 0 && a.left >= 0 && a.right <= measured.viewport + 1,
      `INV-HEADER-CONTROLS-FIT: ${JSON.stringify(a)}`);
    for (const b of measured.header.filter((b) => b.name !== a.name)) {
      const overlaps = a.right > b.left + 1 && a.left < b.right - 1 && a.bottom > b.top + 1 && a.top < b.bottom - 1;
      assert.equal(overlaps, false, `INV-HEADER-CONTROLS-FIT: ${a.name} overlaps ${b.name}`);
    }
  }
}

async function resizeHelps(page, width) {
  const pane = page.getByTestId('helps-panel');
  const before = await pane.boundingBox();
  const divider = await page.getByTestId('helps-divider').boundingBox();
  const x = divider.x + divider.width / 2;
  const y = divider.y + 100;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + before.width - width, y, { steps: 4 });
  await page.mouse.up();
  await until(`helps width ${width}`, async () => Math.round((await pane.boundingBox()).width) === width);
}

for (const story of [false, true]) {
  for (const mode of ['Understand', 'Translate']) {
    const name = `${story ? 'story' : 'bible'}_${mode.toLowerCase()}`;
    browserTest(`the_passage_helps_and_header_remain_reachable_in_a_small_${name}_window`, async () => {
      await withApp(async ({ page }) => {
        if (story) {
          await page.getByTestId('project-sample_burrito_obs').getByTestId('story-tile-1').click();
          await page.getByTestId('story-understand').waitFor();
        } else {
          await page.getByTestId('project-sample_burrito').getByRole('button', { name: /Titus/ }).click();
          await page.getByTestId('understand').waitFor();
        }
        await page.getByTestId('helps-note').first().waitFor();
        if (mode === 'Translate') await page.getByTestId('mode-switch').getByRole('tab', { name: mode, exact: true }).click();
        const helps = page.getByTestId('helps-panel');
        await helps.getByRole('tab', { name: 'Words', exact: true }).click();
        const word = page.getByTestId('helps-word').first();
        await word.waitFor();
        fitsWindow(await capture(page, `${name}-wide`));
        for (const requested of [340, 720]) {
          await resizeHelps(page, requested);
          for (const width of [960, 500]) {
            await page.setViewportSize({ width, height: 938 });
            await word.scrollIntoViewIfNeeded();
            fitsWindow(await capture(page, `${name}-${requested}-${width}-before`));
            await word.click({ position: { x: 8, y: 8 } });
            fitsWindow(await capture(page, `${name}-${requested}-${width}-clicked`));
          }
          await page.setViewportSize({ width: 1280, height: 800 });
          await until('the requested helps width returns', async () => Math.round((await helps.boundingBox()).width) === requested);
          fitsWindow(await capture(page, `${name}-${requested}-restored`));
        }
        await page.setViewportSize({ width: 500, height: 938 });
        if (story) {
          const unit = (frame) => page.getByTestId(mode === 'Translate' ? `story-frame-${frame}` : `story-understand-unit-${frame}`);
          for (const frame of [2, 1]) {
            await page.getByTestId(`frame-marker-${frame}`).click();
            await until(`frame ${frame} is focused`, async () => (await unit(frame).getAttribute('data-focused')) === 'true');
          }
        } else {
          for (const chapter of [2, 1]) {
            await page.getByRole('button', { name: `${chapter}`, exact: true }).click();
            await page.getByRole('heading', { name: `Titus ${chapter}`, exact: true }).waitFor();
          }
        }
        await word.waitFor();
        // Both existing hide/show paths must remain usable after the panels stack.
        const toggle = page.getByTitle('Toggle helps panel');
        await toggle.scrollIntoViewIfNeeded();
        await toggle.click();
        await helps.waitFor({ state: 'detached' });
        await toggle.click();
        await word.waitFor();
        await word.scrollIntoViewIfNeeded();
        fitsWindow(await capture(page, `${name}-shown-again`));
        await resizeHelps(page, 280);
        fitsWindow(await capture(page, `${name}-resized-in-small-window`));
        const reading = helps.locator('xpath=..');
        const beforeScroll = await reading.evaluate((el) => el.scrollTop);
        const helpBox = await helps.boundingBox();
        // The blank strip beside the narrowed helps belongs to the workspace, not its list.
        await page.mouse.move(4, Math.min(908, helpBox.y + helpBox.height - 20));
        await page.mouse.wheel(0, beforeScroll > 0 ? -600 : 600);
        await until('the stacked panels scroll with the wheel', async () => (await reading.evaluate((el) => el.scrollTop)) !== beforeScroll);
        fitsWindow(await capture(page, `${name}-workspace-scrolled`));
        if (mode === 'Translate') {
          if (story) {
            const row = page.getByTestId('story-frame-1');
            const text = row.getByTestId('story-unit-text');
            if (await text.count()) await text.click();
            else await row.getByRole('button').click();
            const editor = page.getByTestId('story-unit-editor');
            const field = editor.getByRole('textbox');
            await field.fill(`${await field.inputValue()} revisado`);
            await editor.getByRole('button', { name: 'Save', exact: true }).click();
            await editor.waitFor({ state: 'detached' });
          } else {
            await page.getByRole('button', { name: 'Draft section 1–3', exact: true }).click();
            const field = page.getByRole('textbox', { name: 'Section 1–3', exact: true });
            await field.fill(`${await field.inputValue()} revisado`);
            await page.getByRole('button', { name: 'Save section', exact: true }).click();
            await page.getByTestId('section-editor').waitFor({ state: 'detached' });
          }
          await until('the narrow-window draft is saved', async () => (await page.getByTestId('save-indicator').getAttribute('data-state')) === 'saved');
          assert.ok((await page.locator('main').textContent()).includes('revisado'), 'INV-READING-SPACE: the saved draft is visible');
          await word.waitFor();
          fitsWindow(await capture(page, `${name}-saved`));
        }
        await page.setViewportSize({ width: 1280, height: 800 });
        await until('the last dragged width returns', async () => Math.round((await helps.boundingBox()).width) === 280);
        fitsWindow(await capture(page, `${name}-restored`));
      }, { scenario: 'en-pins' });
    });
  }
}

for (const locale of ['fr', 'ar']) {
  browserTest(`the_reading_controls_fit_a_small_${locale}_window`, async () => {
    await withApp(async ({ page }) => {
      await page.getByTestId('project-sample_burrito').getByRole('button', { name: /Titus/ }).click();
      await page.getByTestId('helps-note').first().waitFor();
      // The order is Notes, Words, Questions, Simplified in every interface language.
      await page.getByTestId('helps-panel').getByRole('tab').nth(1).click();
      const word = page.getByTestId('helps-word').first();
      await word.waitFor();
      await page.setViewportSize({ width: 500, height: 938 });
      await word.scrollIntoViewIfNeeded();
      fitsWindow(await capture(page, `${locale}-500-before`));
      await word.click({ position: { x: 8, y: 8 } });
      fitsWindow(await capture(page, `${locale}-500-clicked`));
    }, { scenario: 'en-pins', locale });
  });
}
