// J9c (#844): start a new Bible project from USFM files. New Bible asks how to start; from USFM
// files the translator picks the files first, and each row says what its file is: a damaged file
// is refused with the reason and its line, a second file of one book is refused naming the book.
// Then the usual fields open with the versification the files fit (ruling H13) and a note saying
// how, and Create makes the project and all its books in one write; a create that fails leaves
// no project and keeps the files. Add a book follows, as for a blank project, with the files'
// books in the project. The server's side (one write, the guess, a valid Scripture Burrito) is
// tested in tc-app (crates/tc-app/tests/app/create.rs) and tc-store; this file is what a person
// sees and does.
//
//   TC4_BIN=target/debug/tc4 TC4_UI=target/tc-ui-app node --test parity/app/journeys/j09c-from-usfm.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO } from '../env-rust.mjs';
import { browserTest, catalog, until, withApp } from './kit.mjs';

const en = { ...catalog('en'), ...JSON.parse(fs.readFileSync(path.join(REPO, 'crates', 'tc-ui', 'assets', 'i18n-rebuild', 'en.json'), 'utf8')) };
const fixture = (...parts) => path.join(REPO, 'fixtures', 'tc4', 'test-fixtures', ...parts);
const listed = (env) => fs.readdirSync(env.projectsDir).sort();
const read = (env, ...parts) => fs.readFileSync(path.join(env.projectsDir, ...parts));

async function openUsfm(page) {
  await page.getByTestId('add-project').click();
  await page.getByTestId('add-project-bible').click();
  await page.getByTestId('nb-start-usfm').click();
  await page.getByTestId('nb-usfm-drop').waitFor();
}

browserTest('J9c 1. New Bible asks how to start: blank, from USFM files, or from a Scripture Burrito', async () => {
  await withApp(async ({ page }) => {
    await page.getByTestId('add-project').click();
    await page.getByTestId('add-project-bible').click();
    for (const way of ['blank', 'usfm', 'burrito']) await page.getByTestId(`nb-start-${way}`).waitFor();
    assert.equal(await page.getByLabel(en['newBible.name']).count(), 0, 'the fields come after the choice');
    assert.equal(await page.getByTestId('nb-start-burrito').isDisabled(), false, 'J9d brings its importer');
    // From USFM files, then Back: the choice again.
    await page.getByTestId('nb-start-usfm').click();
    await page.getByRole('button', { name: en['importer.kind.back'] }).click();
    await page.getByTestId('nb-start-blank').click();
    await page.getByLabel(en['newBible.name']).waitFor();
  });
});

browserTest('J9c 2. From USFM files: damaged and doubled files are refused in their rows, then Create makes the project and its books in one write', async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tc4-j9c-'));
  const damaged = path.join(scratch, 'bad.usfm');
  fs.writeFileSync(damaged, '\\id GEN\n\\c 1\n\\v 1 In\n\\c 1\n\\v 2 again\n');
  const twin = path.join(scratch, 'TIT-copy.usfm');
  fs.copyFileSync(fixture('en_ult', 'TIT.usfm'), twin);
  const jonah = fixture('usfm-corpus', 'sample-JON-span.usfm');
  try {
    await withApp(async ({ page, env }) => {
      const before = listed(env);
      await openUsfm(page);
      await page.getByTestId('nb-usfm-input').setInputFiles([fixture('en_ult', 'TIT.usfm'), twin, damaged, jonah]);
      const rows = page.getByTestId('nb-usfm-file');
      await until('every file is read', async () => (await rows.count()) === 4 && !(await page.getByText(en['addBook.usfmReading']).count()));
      const status = async () => Promise.all([0, 1, 2, 3].slice(0, await rows.count()).map((n) => rows.nth(n).getAttribute('data-status')));
      assert.deepEqual(await status(), ['valid', 'refused', 'refused', 'valid']);
      assert.match(await rows.nth(1).textContent(), /TIT\.usfm and TIT-copy\.usfm are both the book TIT/);
      assert.match(await rows.nth(2).textContent(), /bad\.usfm cannot be added: line 4: chapter 1 appears twice/);
      const next = page.getByTestId('nb-usfm-next');
      assert.equal(await next.isDisabled(), true, 'a refused file is removed or replaced first');
      await rows.nth(2).getByRole('button', { name: en['importer.files.remove'] }).click();
      await rows.nth(1).getByRole('button', { name: en['importer.files.remove'] }).click();
      assert.deepEqual(await status(), ['valid', 'valid']);
      await next.click();

      // The usual fields, with the files' books and the versification they fit.
      await page.getByLabel(en['newBible.name']).waitFor();
      assert.equal(await page.getByTestId('nb-usfm-books').textContent(), en['newBible.usfmBooks'].replace('{books}', 'Titus, Jonah'));
      const note = page.getByTestId('nb-versification-note');
      // Jonah's verse counts fit eng alone; a tie (Titus alone) is tested in tc-app.
      assert.equal(await note.getAttribute('data-fit'), 'exact');
      assert.equal(await note.textContent(), en['importer.review.schemeExact'].replace('{scheme}', 'eng'));
      assert.match(await page.getByRole('combobox', { name: en['wizard.versification'] }).textContent(), /^eng\b/);

      // A create that fails (the name is taken) makes nothing and keeps the files.
      await page.getByLabel(en['newBible.name']).fill('Sample Burrito');
      await page.getByLabel(en['newBible.langName']).fill('Español');
      await page.getByLabel(en['newBible.code'], { exact: true }).click(); // leaving the field closes its suggestions
      await page.getByLabel(en['newBible.code'], { exact: true }).fill('es-419');
      const create = page.getByRole('button', { name: en['newBible.create'] });
      await create.click();
      await page.getByRole('alert').waitFor();
      assert.deepEqual(listed(env), before, 'the refused create left nothing');

      await page.getByLabel(en['newBible.name']).fill('Equipo J9c');
      await create.click();
      // Add a book follows, as for a blank project.
      await page.getByRole('button', { name: en['addBook.blankTitle'] }).waitFor();
      const made = listed(env).filter((name) => !before.includes(name));
      assert.deepEqual(made, ['equipo_j9c'], 'one new project, no staging folder');
      const [folder] = made;
      const meta = JSON.parse(read(env, folder, 'metadata.json'));
      assert.ok(meta.ingredients['ingredients/TIT.usfm'] && meta.ingredients['ingredients/JON.usfm'], 'both books are in');
      assert.deepEqual(read(env, folder, 'ingredients', 'JON.usfm'), fs.readFileSync(jonah), 'a plain book byte for byte');
      const titus = read(env, folder, 'ingredients', 'TIT.usfm').toString('utf8');
      assert.match(titus, /^\\c 3$/m);
      assert.doesNotMatch(titus, /\\zaln/);
      assert.ok(fs.existsSync(path.join(env.projectsDir, folder, 'ingredients', 'checking', 'alignments', 'TIT.json')), 'the alignments are kept');
      assert.ok(fs.existsSync(path.join(env.projectsDir, folder, 'ingredients', 'checking', 'resources.json')), 'the installed sources are pinned');
    });
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
