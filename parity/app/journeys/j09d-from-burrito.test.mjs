// J9d (#845): start a new Bible project from a Scripture Burrito. New Bible asks how to start;
// from a Scripture Burrito the translator picks the .zip, which is opened and checked before
// anything is written. The usual fields then open filled from its metadata.json; its own
// versification is kept and no choice is shown (ruling H13); its books and other files are
// listed; a name already in use is flagged and Create stays off (#436). Create makes the project
// with its books, sidecars, metadata and files in one write. A Burrito that is work for a
// project, or not a Bible translation, is refused in words. The server's side (one write, P9,
// no vrs.json, a valid Scripture Burrito) is tested in crates/tc-app/tests/app/create_burrito.rs;
// this file is what a person sees and does.
//
//   TC4_BIN=target/debug/tc4 TC4_UI=target/tc-ui-app node --test parity/app/journeys/j09d-from-burrito.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { REPO } from '../env-rust.mjs';
import { browserTest, catalog, until, withApp } from './kit.mjs';

const en = { ...catalog('en'), ...JSON.parse(fs.readFileSync(path.join(REPO, 'crates', 'tc-ui', 'assets', 'i18n-rebuild', 'en.json'), 'utf8')) };
const SAMPLE = path.join(REPO, 'fixtures', 'tc4', 'sample-burrito');
const listed = (env) => fs.readdirSync(env.projectsDir).sort();
const read = (env, ...parts) => fs.readFileSync(path.join(env.projectsDir, ...parts));

/** Every file of a folder, by its path inside it. */
function filesOf(root, rel = '') {
  const out = {};
  for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const at = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(out, filesOf(root, at));
    else out[at] = fs.readFileSync(path.join(root, at));
  }
  return out;
}

/** The files zipped, as a picked file. */
function zipped(name, files) {
  // Resolved here, not at load: CI's node job installs nothing, and the file must still load there.
  // fflate sits beside Playwright: in this checkout's tc4-baseline, or next to PLAYWRIGHT_MODULE.
  const modules = process.env.PLAYWRIGHT_MODULE ? path.dirname(process.env.PLAYWRIGHT_MODULE) : path.join(REPO, 'parity', 'tc4-baseline', 'node_modules');
  const fflate = createRequire(import.meta.url)(path.join(modules, 'fflate'));
  const entries = Object.fromEntries(Object.entries(files).map(([at, bytes]) => [at, new Uint8Array(bytes)]));
  return { name, mimeType: 'application/zip', buffer: Buffer.from(fflate.zipSync(entries)) };
}

async function pick(page, file) {
  await page.getByTestId('add-project').click();
  await page.getByTestId('add-project-bible').click();
  await page.getByTestId('nb-start-burrito').click();
  await page.getByTestId('nb-burrito-drop').waitFor();
  await page.getByTestId('nb-burrito-input').setInputFiles(file);
}

browserTest('J9d 1. From a Scripture Burrito: its metadata fills the fields and its own versification is kept; a name in use keeps Create off; Create makes the project with its books, sidecars and files in one write', async () => {
  const source = filesOf(SAMPLE);
  await withApp(async ({ page, env }) => {
    const before = listed(env);
    await pick(page, zipped('ejemplo.zip', source));
    const name = page.getByLabel(en['newBible.name']);
    await name.waitFor();
    assert.equal(await name.inputValue(), 'Equipo Ejemplo — Tito y Jonás');
    assert.equal(await page.getByLabel(en['newBible.code'], { exact: true }).inputValue(), 'es-419');
    assert.equal(await page.getByTestId('nb-burrito-books').textContent(), en['newBible.burritoBooks'].replace('{books}', 'Jonah, Titus'));
    const note = page.getByTestId('nb-versification-note');
    assert.equal(await note.getAttribute('data-fit'), 'own');
    assert.equal(await note.textContent(), en['newBible.burritoVersification']);
    assert.equal(await page.getByRole('button', { name: en['wizard.versification'] }).count(), 0, 'no versification choice (H13)');
    assert.deepEqual(listed(env), before, 'reading the Burrito wrote nothing');

    // A name already used by a project on this computer is flagged, and Create stays off (#436).
    const create = page.getByRole('button', { name: en['newBible.create'] });
    await name.fill('Sample Burrito');
    await page.getByTestId('nb-name-in-use').waitFor();
    assert.equal(await create.isDisabled(), true);
    await name.fill('Equipo J9d');
    await until('the flag goes', async () => (await page.getByTestId('nb-name-in-use').count()) === 0);
    await create.click();

    // Add a book follows, as for a blank project, with the Burrito's books in the project.
    await page.getByRole('button', { name: en['addBook.blankTitle'] }).waitFor();
    const made = listed(env).filter((entry) => !before.includes(entry));
    assert.deepEqual(made, ['equipo_j9d'], 'one new project, no staging folder');
    for (const at of ['ingredients/TIT.usfm', 'ingredients/JON.usfm', 'ingredients/vrs.json']) {
      assert.deepEqual(read(env, 'equipo_j9d', ...at.split('/')), source[at], `${at} byte for byte`);
    }
    for (const at of ['alignments/TIT.json', 'translationWords/TIT.json', 'translationNotes/TIT.json']) {
      assert.ok(fs.existsSync(path.join(env.projectsDir, 'equipo_j9d', 'ingredients', 'checking', ...at.split('/'))), `${at} is kept`);
    }
    const meta = JSON.parse(read(env, 'equipo_j9d', 'metadata.json'));
    const given = JSON.parse(source['metadata.json']);
    assert.deepEqual(meta.identification.name, { en: 'Equipo J9d' }, 'the name the translator gave');
    assert.deepEqual(meta.identification.description, given.identification.description, 'the rest as written');
    assert.deepEqual(meta.languages, given.languages);
  });
});

browserTest('J9d 2. A Burrito that is work for a project, or not a Bible, is refused in words and nothing is written', async () => {
  const source = filesOf(SAMPLE);
  const obs = JSON.parse(source['metadata.json']);
  obs.type.flavorType = { name: 'gloss', flavor: { name: 'textStories' } };
  await withApp(async ({ page, env }) => {
    const before = listed(env);
    await pick(page, zipped('stories.zip', { ...source, 'metadata.json': Buffer.from(JSON.stringify(obs)) }));
    const refused = page.getByTestId('nb-burrito-refused');
    await refused.waitFor();
    assert.equal(await refused.textContent(), en['newBible.burritoFlavor'].replace('{flavor}', 'gloss/textStories'));
    assert.equal(await page.getByTestId('nb-burrito-receive').count(), 0);

    // Work for a project goes to Receive work instead.
    await page.getByTestId('nb-burrito-input').setInputFiles(zipped('work.zip', { ...source, 'ingredients/tc/project.json': Buffer.from('{}') }));
    await until('the second refusal', async () => (await refused.textContent()) === en['newBible.burritoForReceive']);
    await page.getByTestId('nb-burrito-receive').click();
    await page.getByText(en['exchange.receive.title'], { exact: true }).first().waitFor();
    assert.deepEqual(listed(env), before, 'nothing was written');
  });
});
