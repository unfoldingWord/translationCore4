// A sync downloads the versions the project pins and this computer lacks (#1013; owner rulings
// of 2026-11-12: with no question, Cancel is the way to refuse, and a cancelled or failed
// download leaves the sync in place). The scenario computer lacks five of the versions the
// sample pins (es-419_twl, es-419_tw, es-419_ta, en_tq, hbo_uhb), and the fake Door43 gives
// them. In the second case a teammate on another computer (B, driven through its API) gets the
// release of en_ult that A chose through Source texts (J12).
//
//   TC4_BIN=target/debug/tc4 TC4_UI=target/tc-ui-app TC4_DOOR43_FAKE=target/debug/tc-door43-fake \
//     node --test parity/app/journeys/sync-downloads.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { FAKE_USER } from '../../tc4-baseline/mock-server/fake-door43.mjs';
import { REPO } from '../env-rust.mjs';
import { BIBLE as BIBLE_REPO } from '../screens.mjs';
import { browserTest, catalog, until, withApp } from './kit.mjs';

const en = catalog('en');
const rebuild = JSON.parse(fs.readFileSync(path.join(REPO, 'crates', 'tc-ui', 'assets', 'i18n-rebuild', 'en.json'), 'utf8'));
const BIBLE = 'sample_burrito';
const opts = { door43: true, realSync: true, scenario: 'shared' };

/** The texts of the result's notes with `testid`. */
const notes = (page, testid) => page.getByTestId('sync-result').getByTestId(testid).allTextContents();

/** The card's Sync, then the result: the first one asks for the internet and the sign-in. */
async function sync(page, { first = false } = {}) {
  await page.getByTestId(`share-${BIBLE}`).click();
  if (first) {
    await page.getByTestId('net-confirm').click();
    await page.getByTestId('share-signin').waitFor();
    await page.getByLabel(en['signIn.login']).fill(FAKE_USER.username);
    await page.getByLabel(en['signIn.password'], { exact: true }).fill(FAKE_USER.password);
    await page.getByTestId('signin-submit').click();
  }
}

browserTest('J26 (#1013). A sync downloads the versions the project pins: the card names each with a bar and Cancel; Cancel and a version Door43 cannot give leave the sync done and say why; the next sync gets the rest', async () => {
  await withApp(async ({ page, env }) => {
    await env.door43.giveSamplePins();
    await page.getByTestId(`share-${BIBLE}`).waitFor();
    await env.pushToDoor43(BIBLE_REPO);

    // 1. Door43 keeps the first missing version waiting: the card names it, draws its bar and
    //    offers Cancel. Cancel ends the download; the sync is done, and the result says why
    //    the five versions are still missing, with Download.
    await env.door43.fault({ method: 'GET', path: '/es-419_gl/es-419_twl/sb/', times: 1, fault: { type: 'hold' } });
    await sync(page, { first: true });
    const row = page.getByTestId(`sync-download-${BIBLE}`);
    await row.waitFor({ timeout: 60_000 });
    const [before, after] = rebuild['openDoor43.downloading'].replace('{pin}', 'es-419_twl v18').split('{n}');
    await until('the card names es-419_twl v18', async () => (await row.textContent()).includes(before));
    const said = (await row.textContent()).replace(rebuild['home.cancelDownload'], '');
    assert.ok(said.startsWith(before) && said.endsWith(after), said);
    assert.equal(said.slice(before.length, said.length - after.length), '4', 'four versions follow it');
    assert.equal(await row.getByTestId('sync-download-bar').count(), 1, 'the bar');
    const cancel = page.getByTestId(`sync-download-cancel-${BIBLE}`);
    assert.equal(await cancel.isEnabled(), true, 'Cancel is enabled while it downloads');
    await cancel.click();
    const result = page.getByTestId('sync-result');
    await result.waitFor({ timeout: 120_000 });
    await env.door43.release();
    assert.equal(await result.getAttribute('data-ok'), '1', 'the sync is done');
    assert.deepEqual(await notes(page, 'sync-download-stopped'), [rebuild['syncResult.downloadCancelled']]);
    assert.deepEqual(await notes(page, 'sync-missing-pins'), [en['syncResult.missingPinsMany'].replace('{n}', '5')]);
    assert.equal(await page.getByTestId('sync-download').count(), 1, 'Download stays');
    assert.equal(await row.count(), 0, 'the card no longer shows a download');
    await page.getByTestId('sync-dismiss').click();

    // 2. Door43 does not have one of them: the sync gets the others and names that one.
    await env.door43.fault({ method: 'GET', path: '/es-419_gl/es-419_tw/sb/', times: 1, fault: { type: 'status', status: 404, message: 'Not Found' } });
    await sync(page);
    await result.waitFor({ timeout: 120_000 });
    assert.equal(await result.getAttribute('data-ok'), '1');
    assert.deepEqual(await notes(page, 'sync-not-downloaded'), [rebuild['refusal.open-door43.pin-not-on-door43'].replace('{pin}', 'es-419_tw v37')]);
    assert.deepEqual(await notes(page, 'sync-missing-pins'), [en['syncResult.missingPinsOne']]);
    assert.equal(await notes(page, 'sync-download-stopped').then((n) => n.length), 0);
    await page.getByTestId('sync-dismiss').click();

    // 3. The next sync gets the last one: nothing is missing, and the result is as before #1013.
    await sync(page);
    await result.waitFor({ timeout: 120_000 });
    assert.equal(await result.getAttribute('data-ok'), '1');
    for (const testid of ['sync-missing-pins', 'sync-not-downloaded', 'sync-download-stopped']) {
      assert.equal((await notes(page, testid)).length, 0, `no ${testid}`);
    }
    assert.equal(await page.getByTestId('sync-download').count(), 0, 'no Download');
  }, opts);
});

/** The pin of `repo` in the project's pin file in `projectsDir`. */
const pinOf = (projectsDir, project, repo) => {
  const file = JSON.parse(fs.readFileSync(path.join(projectsDir, project, 'ingredients', 'checking', 'resources.json'), 'utf8'));
  return Object.values(file).flat().find((pin) => pin?.repoPath?.endsWith(`unfoldingWord/${repo}`));
};

browserTest('J26 (#1013). A teammate changes a version the project uses: A upgrades en_ult through the screens and syncs; B\'s next sync downloads exactly that release and leaves none missing', async () => {
  await withApp(async ({ page, env, teammate }) => {
    await env.door43.giveSamplePins();
    await page.getByTestId(`share-${BIBLE}`).waitFor();
    await env.pushToDoor43(BIBLE_REPO);
    const result = page.getByTestId('sync-result');
    await sync(page, { first: true });
    await result.waitFor({ timeout: 120_000 });
    await page.getByTestId('sync-dismiss').click();
    const b = await teammate('teammate-b');
    const pb = await b.join(env.door43Repo(BIBLE_REPO));

    // A upgrades en_ult to the release Door43 publishes (J12), then syncs: the new pin reaches Door43.
    const ult = (await (await fetch(`${env.door43.url}/api/v1/catalog/search?owner=unfoldingWord`)).json()).data.find((entry) => entry.name === 'en_ult');
    assert.notEqual(pinOf(b.env.projectsDir, pb, 'en_ult').sha, ult.commit_sha, 'B pins another en_ult');
    await page.getByTestId(`project-${BIBLE}`).getByRole('button', { name: en['home.settings'], exact: true }).click();
    await page.getByTestId('settings-manage-sources').click();
    const sources = page.getByTestId('sources-modal');
    await sources.waitFor();
    await page.getByTestId('check-updates').click();
    const apply = page.getByTestId('upgrade-text-apply-en_ult');
    await apply.or(page.getByTestId('net-confirm')).first().waitFor();
    if (await page.getByTestId('net-confirm').count()) await page.getByTestId('net-confirm').click();
    await apply.click();
    const confirm = page.getByTestId('upgrade-confirm');
    await confirm.getByTestId('upgrade-apply').click();
    await confirm.waitFor({ state: 'detached', timeout: 60_000 });
    await until('A pins the release', () => pinOf(env.projectsDir, BIBLE, 'en_ult').sha === ult.commit_sha, 30_000);
    await sources.getByRole('button', { name: en['common.close'], exact: true }).first().click();
    await page.getByTestId('project-switch').click();
    await sync(page);
    await result.waitFor({ timeout: 120_000 });
    assert.equal(await result.getAttribute('data-ok'), '1', 'A syncs');
    await page.getByTestId('sync-dismiss').click();

    // B syncs: the teammate's pin arrives, and the sync downloads that release with no question.
    await env.door43.clear();
    const view = await b.sync(pb);
    assert.equal(pinOf(b.env.projectsDir, pb, 'en_ult').sha, ult.commit_sha, 'B pins the release A chose');
    assert.equal(view.missingPins, 0, 'nothing is missing on B');
    assert.deepEqual(view.notDownloaded, []);
    assert.equal(view.downloadStopped, null);
    const asked = (await env.door43.requests()).filter((r) => r.path.startsWith('/unfoldingWord/'));
    assert.ok(asked.length > 0 && asked.every((r) => r.path.startsWith('/unfoldingWord/en_ult/')), `B asked only for en_ult: ${JSON.stringify(asked.map((r) => r.path))}`);
  }, opts);
});
