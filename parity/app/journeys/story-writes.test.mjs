// C3 / J21: production title/frame/reference writes and the OBS editing lock.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { newRequestId } from '../env-rust.mjs';
import { browserTest, rowFit, settled, sleep, until, withApp } from './kit.mjs';

const OBS = 'sample_burrito_obs';
const scenario = { scenario: 'en-pins' };
const scope = async (env) => (await env.call('app/hello', {})).sessions[0].at;
const read = async (env, story = 1) => env.call('story/open', { at: await scope(env), story });
const editor = (page) => page.getByTestId('story-unit-editor');
const state = (page) => page.getByTestId('save-indicator').getAttribute('data-state');

async function open(page) {
  await page.getByTestId(`project-${OBS}`).getByTestId('story-tile-1').click();
  await page.getByTestId('story-understand').waitFor();
  await page.getByRole('tab', { name: 'Translate', exact: true }).click();
  await page.getByTestId('story-draft').waitFor();
}

async function edit(page, unit) {
  const row = page.getByTestId(unit);
  const text = row.getByTestId('story-unit-text');
  if (await text.count()) await text.click();
  else await row.getByRole('button').click();
  await editor(page).waitFor();
  return row.getByRole('textbox');
}

async function save(page, unit, text) {
  const box = await edit(page, unit);
  await box.fill(text);
  await editor(page).getByRole('button', { name: 'Save', exact: true }).click();
  await editor(page).waitFor({ state: 'detached' });
  await until('saved', async () => (await state(page)) === 'saved');
}

browserTest('j21_frame_title_and_reference_save_only_their_own_story_bytes_and_keep_the_rail', async () => {
  await withApp(async ({ page, env }) => {
    await open(page);
    const before = await read(env);
    const other = await read(env, 2);
    const file = path.join(env.projectsDir, OBS, 'ingredients', 'content', '01.md');
    const bytes = fs.readFileSync(file, 'utf8');
    const rail = await page.getByTestId('story-2').textContent();
    const frame = 'Así fue como Dios hizo todo.\nCreó todo en seis días.';
    const title = 'La creación revisada';
    const reference = 'Una historia bíblica de Génesis 1–2';
    assert.ok(before.frames[0].text && before.title && before.reference, 'the real sample supplies replaceable fields');
    await save(page, 'story-frame-1', frame);
    await save(page, 'story-title', title);
    await save(page, 'story-ref', reference);
    const after = await read(env);
    assert.equal(after.frames[0].text, frame);
    assert.equal(after.title, title);
    assert.equal(after.reference, reference);
    assert.deepEqual(after.frames.slice(1).map((f) => f.text), before.frames.slice(1).map((f) => f.text));
    assert.deepEqual((await read(env, 2)).frames.map((f) => f.text), other.frames.map((f) => f.text));
    assert.equal(await page.getByTestId('story-2').textContent(), rail, 'another rail row never loses its title or progress');
    await page.getByTitle(/Switch project/).click();
    await page.getByTestId(`project-${OBS}`).waitFor();
    await env.call('settings/viewFromHome', { project: OBS });
    const expected = bytes.replace(before.frames[0].text, frame).replace(before.title, title).replace(before.reference, reference);
    assert.equal(fs.readFileSync(file, 'utf8'), expected, 'only the written paragraph, title and reference bytes change');
  }, scenario);
});

browserTest('a_held_frame_save_keeps_the_editing_lock_and_writes_the_displayed_frame', async () => {
  await withApp(async ({ page, env }) => {
    await open(page);
    const box = await edit(page, 'story-frame-1');
    const wanted = 'Words held safely while this frame saves.';
    await env.call('test/hold', { request: newRequestId(), at: 'save' });
    try {
      await box.fill(wanted);
      await editor(page).getByRole('button', { name: 'Save', exact: true }).click();
      await until('saving', async () => (await state(page)) === 'saving');
      assert.equal(await page.getByRole('tab', { name: 'Check', exact: true }).isDisabled(), true);
      assert.equal(await page.getByTestId('story-2').isDisabled(), true);
      assert.equal(await box.isDisabled(), true);
      assert.equal(await box.inputValue(), wanted);
    } finally {
      await env.call('test/release', { request: newRequestId(), at: 'save' });
    }
    await editor(page).waitFor({ state: 'detached' });
    assert.equal((await read(env)).frames[0].text, wanted);
    assert.equal(await page.getByTestId('story-2').isDisabled(), false);
  }, scenario);
});

browserTest('a_refused_frame_save_keeps_the_card_until_retry_and_cancel_restores_its_opening_text', async () => {
  await withApp(async ({ page, env }) => {
    await open(page);
    const before = (await read(env)).frames[0].text;
    let refused = false;
    await page.route('**/api/v1/story/saveFrame', async (route) => {
      if (refused) return route.continue();
      refused = true;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        type: 'err', value: { type: 'notSaved', value: { type: 'disk', value: 'fixture frame save refused' } },
      }) });
    });
    const box = await edit(page, 'story-frame-1');
    await box.fill('A frame kept for Retry.');
    await editor(page).getByRole('button', { name: 'Save', exact: true }).click();
    await until('save error', async () => (await state(page)) === 'error');
    assert.equal(await box.inputValue(), 'A frame kept for Retry.');
    assert.equal((await read(env)).frames[0].text, before);
    await page.getByTestId('save-indicator').getByRole('button', { name: 'Retry' }).click();
    await until('saved after Retry', async () => (await state(page)) === 'saved');
    await editor(page).waitFor({ state: 'detached' });
    assert.equal((await read(env)).frames[0].text, 'A frame kept for Retry.');
    const reopened = await edit(page, 'story-frame-1');
    await reopened.fill('A change cancelled before saving.');
    await editor(page).getByRole('button', { name: 'Cancel', exact: true }).click();
    await editor(page).waitFor({ state: 'detached' });
    await until('cancel restored text', async () => (await state(page)) === 'saved');
    assert.equal((await read(env)).frames[0].text, 'A frame kept for Retry.');
  }, scenario);
});

browserTest('an_empty_reference_is_refused_without_losing_the_editor_and_a_correction_can_save', async () => {
  await withApp(async ({ page, env }) => {
    await open(page);
    const before = (await read(env)).reference;
    const box = await edit(page, 'story-ref');
    await box.fill('');
    await editor(page).getByRole('button', { name: 'Save', exact: true }).click();
    await until('reference refusal', async () => (await state(page)) === 'error');
    assert.equal(await box.inputValue(), '', 'the refused edit stays available for correction');
    assert.equal((await read(env)).reference, before, 'the saved reference remains intact');
    const correction = 'A corrected reference to Genesis 1–2';
    await box.fill(correction);
    await page.getByTestId('save-indicator').getByRole('button', { name: 'Retry' }).click();
    await editor(page).waitFor({ state: 'detached' });
    assert.equal((await read(env)).reference, correction);
  }, scenario);
});

// tC4's `normalizeStoryUnit`: a frame typed with a blank line and a newline at its end, and a
// title typed with spaces around it, save in their stored form, never refused, whether a pause
// or Save writes them; the card then closes on the stored text.
browserTest('a_blank_line_in_a_frame_and_spaces_around_a_title_save_in_their_stored_form', async () => {
  await withApp(async ({ page, env }) => {
    await open(page);
    const box = await edit(page, 'story-frame-1');
    await box.fill('Dios hizo todo.\n\nEn seis días.\n');
    await sleep(2300);
    assert.notEqual(await state(page), 'error', 'a pause never ends in a refusal');
    await until('the pause saved the frame', async () => (await read(env)).frames[0].text === 'Dios hizo todo.\nEn seis días.');
    await editor(page).getByRole('button', { name: 'Save', exact: true }).click();
    await editor(page).waitFor({ state: 'detached' });
    await until('saved', async () => (await state(page)) === 'saved');
    assert.equal(await page.getByTestId('story-frame-1').getByTestId('story-unit-text').textContent(), 'Dios hizo todo.\nEn seis días.');
    await save(page, 'story-title', '  La creación  ');
    assert.equal((await read(env)).title, 'La creación');
    assert.equal((await read(env)).frames[0].text, 'Dios hizo todo.\nEn seis días.');
  }, scenario);
});

// #915: a frame's editor fills the row its source (picture and text) sets, scrolls inside once
// the text is longer, keeps its resize handle, and refits when the window changes size.
const near = (a, b, what) => assert.ok(Math.abs(a - b) <= 4, `${what}: ${a} vs ${b}`);

browserTest('a_frame_editor_fills_the_row_its_source_sets_and_scrolls_inside', async () => {
  for (const size of [{ width: 1280, height: 800 }, { width: 1920, height: 1080 }]) {
    await withApp(async ({ page }) => {
      await page.setViewportSize(size);
      await open(page);
      const box = await edit(page, 'story-frame-1');
      await box.fill('Dios hizo todo.');
      await settled(page);
      const fits = await rowFit(editor(page));
      near(fits.row, fits.source, `${size.width}px: the row is as tall as its source`);
      assert.ok(fits.gap <= 4, `${size.width}px: the editor reaches the bottom of its cell (${fits.gap}px short)`);
      assert.equal(fits.scrolls, false, `${size.width}px: a short draft has no inner scrollbar`);
      await box.fill(Array.from({ length: 20 }, (_, i) => `Línea ${i + 1} de la creación.`).join('\n'));
      await settled(page);
      const long = await rowFit(editor(page));
      near(long.row, long.source, `${size.width}px: twenty lines keep the row`);
      near(long.field, fits.field, `${size.width}px: twenty lines keep the field's height`);
      assert.equal(long.scrolls, true, `${size.width}px: the text beyond the source scrolls inside`);
    }, scenario);
  }
});

browserTest('a_frame_editor_resize_handle_works_and_the_window_refits_it', async () => {
  await withApp(async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await open(page);
    const box = await edit(page, 'story-frame-1');
    await settled(page);
    assert.ok((await rowFit(editor(page))).gap <= 4, 'at 1024px the editor reaches the bottom of its cell');
    await page.setViewportSize({ width: 1920, height: 1080 });
    await settled(page);
    const refit = await rowFit(editor(page));
    near(refit.row, refit.source, 'at 1920px the row is as tall as its source again');
    assert.ok(refit.gap <= 4, `at 1920px the editor reaches the bottom of its cell (${refit.gap}px short)`);
    const drag = async (dy) => {
      const b = await box.boundingBox();
      await page.mouse.move(b.x + b.width - 3, b.y + b.height - 3);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width - 3, b.y + b.height - 3 + dy, { steps: 8 });
      await page.mouse.up();
      await settled(page);
      return (await box.boundingBox()).height;
    };
    const start = (await box.boundingBox()).height;
    const taller = await drag(80);
    assert.ok(taller >= start + 60, `dragging down grows the field: ${start} → ${taller}`);
    const shorter = await drag(-200);
    assert.ok(shorter <= start - 60, `dragging up shrinks it below where it opened: ${start} → ${shorter}`);
    await editor(page).getByRole('button', { name: 'Save', exact: true }).click({ trial: true });
  }, scenario);
});
