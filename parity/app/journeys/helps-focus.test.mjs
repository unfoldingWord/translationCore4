// #991: the helps stay filtered to the section, verse or frame the translator clicked, also after
// Save, until another is picked or the person leaves: Bible Translate by section and by verse,
// Bible Understand, and an Open Bible Story in Translate and Understand.
//
// With TC4_EVIDENCE set to a folder, each step also saves a screenshot there (the issue's
// evidence, `docs/evidence/helps-filter-after-save-<date>/`).
//
//   TC4_BIN=target/debug/tc4 TC4_UI=target/tc-ui-app TC4_UI_HOOKS=target/tc-ui-app-hooks \
//     node --test parity/app/journeys/helps-focus.test.mjs
import assert from 'node:assert/strict';
import path from 'node:path';
import { browserTest, until, withApp } from './kit.mjs';

const BIBLE = 'sample_burrito';
const OBS = 'sample_burrito_obs';
const SCENARIO = { scenario: 'en-pins' };

const indicator = (page) => page.getByTestId('save-indicator');
const notes = (page) => page.getByTestId('helps-note');

/** The verse (a story's frame) of every note the panel lists. */
const noteFrames = (page) => notes(page).evaluateAll((cards) => cards.map((c) => c.getAttribute('data-frame')));

/** Waits until the panel lists notes, every one of them at one of `frames`. */
async function notesOnlyAt(page, frames, what) {
  await until(what, async () => {
    const shown = await noteFrames(page);
    return shown.length > 0 && shown.every((f) => frames.includes(f));
  });
}

async function shot(page, name) {
  if (process.env.TC4_EVIDENCE) await page.screenshot({ path: path.join(process.env.TC4_EVIDENCE, `${name}.png`) });
}

async function saved(page) {
  await until('saved', async () => (await indicator(page).getAttribute('data-state')) === 'saved');
}

/** Titus 1 in Translate, by section. */
async function openTranslate(page) {
  await page.getByTestId(`project-${BIBLE}`).getByRole('button', { name: /Titus/ }).click();
  await page.getByTestId('understand-unit-s1').waitFor();
  await page.getByTestId('mode-switch').getByRole('tab', { name: 'Translate' }).click();
  await page.getByRole('button', { name: /Draft section 1–3/ }).waitFor();
  await notes(page).first().waitFor();
}

/** The translation cell of the section whose pill reads `span`. */
const cell = (page, span) => page.getByRole('button', { name: `Draft section ${span}` }).locator('xpath=../..');

browserTest('a_section_clicked_in_translate_filters_the_helps_and_keeps_them_after_save', async () => {
  await withApp(async ({ page }) => {
    await openTranslate(page);
    await cell(page, '4–5').getByTestId('draft-target-text').first().click();
    await notesOnlyAt(page, ['4', '5'], 'a click on the translation filters the helps to 4–5');
    assert.equal(await page.getByTestId('section-editor').count(), 0, 'the click opens no card');
    await shot(page, '1a-translate-section-clicked');
    await page.getByRole('tab', { name: 'Words', exact: true }).click();
    await page.getByRole('tab', { name: 'Notes', exact: true }).click();
    await notesOnlyAt(page, ['4', '5'], 'a tab change keeps the filter');
    await page.getByRole('button', { name: 'Draft section 4–5' }).click();
    const box = page.getByRole('textbox', { name: 'Section 4–5' });
    await box.fill(`${await box.inputValue()} revisado`);
    await page.getByRole('button', { name: 'Save section' }).click();
    await page.getByTestId('section-editor').waitFor({ state: 'detached' });
    await saved(page);
    await notesOnlyAt(page, ['4', '5'], 'the helps stay on 4–5 after Save');
    await shot(page, '1b-translate-section-after-save');
    // Cancel leaves the filter where the card was opened.
    await page.getByRole('button', { name: 'Draft section 1–3' }).click();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByTestId('section-editor').waitFor({ state: 'detached' });
    await notesOnlyAt(page, ['intro', '1', '2', '3'], 'Cancel keeps the section the card was opened on');
  }, SCENARIO);
});

browserTest('a_verse_saved_in_verse_mode_keeps_the_helps_on_that_verse', async () => {
  await withApp(async ({ page }) => {
    await openTranslate(page);
    await page.getByRole('tab', { name: 'Verse', exact: true }).click();
    await page.getByTitle('Edit this verse').nth(3).click();
    const box = page.getByLabel('Verse 4', { exact: true });
    await box.waitFor();
    await notesOnlyAt(page, ['4'], 'the open card filters the helps to verse 4');
    await box.fill(`${await box.inputValue()} revisado`);
    await page.getByRole('button', { name: 'Save verse' }).click();
    await box.waitFor({ state: 'detached' });
    await saved(page);
    await notesOnlyAt(page, ['4'], 'after Save the helps stay on verse 4, not its section');
    await shot(page, '2-translate-verse-after-save');
  }, SCENARIO);
});

browserTest('a_unit_clicked_in_understand_keeps_the_helps_filtered_after_its_comment_is_saved', async () => {
  await withApp(async ({ page }) => {
    await page.getByTestId(`project-${BIBLE}`).getByRole('button', { name: /Titus/ }).click();
    const unit = page.getByTestId('understand-unit-s4');
    await unit.waitFor();
    await unit.locator('p').first().click();
    await notesOnlyAt(page, ['4', '5'], 'a click on the source filters the helps to 4–5');
    await shot(page, '3a-understand-source-clicked');
    const comment = unit.getByRole('textbox');
    await comment.click();
    await comment.fill('Una nota sobre 4–5');
    await page.getByRole('tab', { name: 'Questions', exact: true }).click();
    await saved(page);
    await page.getByRole('tab', { name: 'Notes', exact: true }).click();
    await notesOnlyAt(page, ['4', '5'], 'the helps stay on 4–5 after the comment is saved');
    await shot(page, '3b-understand-after-comment');
    await page.getByRole('tab', { name: 'Verse', exact: true }).click();
    const verse = page.getByTestId('understand-unit-v5');
    await verse.getByRole('textbox').click();
    await notesOnlyAt(page, ['5'], 'a click on a verse\'s comment field filters the helps to it');
  }, SCENARIO);
});

/** Story 1 from its tile on Home, in Understand. */
async function openStory1(page, env) {
  await page.getByTestId(`project-${env.projectId(`_local_/_local_/${OBS}`)}`).getByTestId('story-tile-1').click();
  await page.getByTestId('story-understand').waitFor();
  await notes(page).first().waitFor();
}

browserTest('a_frame_clicked_in_a_story_filters_the_helps_to_it_also_after_save', async () => {
  await withApp(async ({ page, env }) => {
    await openStory1(page, env);
    const unit = page.getByTestId('story-understand-unit-2');
    await unit.getByTestId('story-understand-gateway').click();
    await notesOnlyAt(page, ['2'], 'a click on the source filters the helps to frame 2');
    await shot(page, '5a-story-understand-source-clicked');
    const comment = unit.locator('[data-testid="story-understand-comment"] textarea');
    await comment.click();
    await notesOnlyAt(page, ['2'], 'the comment field keeps frame 2');
    await comment.fill('Una nota sobre el cuadro 2');
    await page.getByRole('tab', { name: 'Translate', exact: true }).click();
    await page.getByTestId('story-draft').waitFor();
    await saved(page);
    const comments = () => page.getByTestId('helps-comment').evaluateAll((c) => c.map((e) => e.getAttribute('data-frame')));
    await page.getByRole('tab', { name: 'Comments', exact: true }).click();
    await until('the Comments tab lists frame 2’s comment', async () => (await comments()).join() === '2');
    await page.getByRole('tab', { name: 'Notes', exact: true }).click();
    const row = page.getByTestId('story-frame-3');
    await row.locator(':scope > *').first().click();
    await notesOnlyAt(page, ['3'], 'a click on the source filters the helps to frame 3');
    await page.getByRole('tab', { name: 'Comments', exact: true }).click();
    await until('the Comments tab hides frame 2’s comment', async () => (await comments()).length === 0);
    await page.getByRole('tab', { name: 'Notes', exact: true }).click();
    // An undrafted frame shows its draft button where a drafted one shows its words.
    const text = row.getByTestId('story-unit-text');
    if (await text.count()) await text.click();
    else await row.getByRole('button').click();
    const editor = page.getByTestId('story-unit-editor');
    await editor.waitFor();
    await notesOnlyAt(page, ['3'], 'opening the translation keeps frame 3');
    await editor.getByRole('textbox').fill('Dios hizo la luz.');
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await editor.waitFor({ state: 'detached' });
    await saved(page);
    await notesOnlyAt(page, ['3'], 'after Save the helps stay on frame 3');
    await shot(page, '4-story-translate-after-save');
  }, SCENARIO);
});
