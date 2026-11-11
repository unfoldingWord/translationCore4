// Project settings from Home and Get source texts (B9a), through the app on the store with the
// fake Door43: the settings-contract's read part on the sample (the checking language from the
// pins, by its own name, #579), and Get source texts' second step behind the internet question
// (tC4's D95: Not now reads nothing and offers to read the list; reading it asks Door43's
// catalog for the organization). The fake publishes unfoldingWord's resource releases (J3):
// the English package for Titus is downloaded through the screen and its source text lands on
// disk at the release Door43 publishes.
//
//   TC4_BIN=target/debug/tc4 TC4_UI=target/tc-ui-app TC4_DOOR43_FAKE=target/debug/tc-door43-fake \
//     node --test parity/app/journeys/source-texts.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO } from '../env-rust.mjs';
import { browserTest, catalog, settled, sleep, until, withApp } from './kit.mjs';

const en = catalog('en');
const rebuild = JSON.parse(fs.readFileSync(path.join(REPO, 'crates', 'tc-ui', 'assets', 'i18n-rebuild', 'en.json'), 'utf8'));
const doneLine = (key) => key.replace('{book}', 'Titus').replace('{lang}', 'English');
const BIBLE = 'sample_burrito';
const settings = (page) => page.getByTestId(`project-${BIBLE}`).getByRole('button', { name: en['home.settings'], exact: true });
const apiRequests = async (door43) => (await door43.requests()).filter((r) => r.path.startsWith('/api/'));

browserTest('Settings from Home show the project as its files hold it, and Save waits for them', async () => {
  await withApp(async ({ page }) => {
    await settings(page).click();
    const current = page.getByTestId('settings-gateway-current');
    await current.waitFor();
    assert.equal(
      await current.textContent(),
      en['settings.gatewayCurrent'].replace('{lang}', 'Español (Latinoamérica)').replace('{org}', 'es-419_gl'),
    );
    assert.equal(await page.getByTestId('settings-gateway-en::unfoldingWord').getAttribute('data-current'), '0');
    await until('Save is enabled once the values came', () => page.getByRole('button', { name: en['settings.save'] }).isEnabled());
    assert.equal(await page.getByRole('button', { name: en['wizard.ltr'] }).getAttribute('data-selected'), 'true');
  });
});

/** The installs of `owner/repo` in the run's app data: each receipt's pin. */
const installs = (env, owner, repo) => {
  const dir = path.join(env.appData, 'resources', 'dcs', owner.toLowerCase(), repo);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).map((sha) => JSON.parse(fs.readFileSync(path.join(dir, sha, 'receipt.json'), 'utf8')).pin);
};

/** The project's pin of unfoldingWord's `repo` among its scripture texts, on disk now. */
const textPin = (env, repo) => JSON.parse(fs.readFileSync(
  path.join(env.projectsDir, BIBLE, 'ingredients', 'checking', 'resources.json'), 'utf8'))
  .extraScripture.find((p) => p.repoPath.endsWith(`unfoldingWord/${repo}`));

// J3 (P1): Get source texts reads a package only after the internet question (D95), then
// downloads it, and the version the project pins lands on disk. The sample pins Door43's own
// commits, which the fake cannot serve (the download rightly refuses another commit under a
// pinned version); so the text's pin is first moved to the fake's release through the upgrade
// screen, as a translator's upgrade would, and its install removed: this computer lacks it.
// shortcut: the fake has one en_ult release, so the pin is also the latest and this cannot tell
// "the pinned version" from "the newest"; a fake control route that adds a release would.
/** Get source texts on English, step 2, for Titus, with `en_ult` pinned at the fake's release
 * and its install removed, so Download has a text to fetch from the fake. Answers the pin. */
async function aTextToFetch(page, env) {
  await settings(page).click();
  await page.getByTestId('settings-manage-sources').click();
  await page.getByTestId('sources-modal').waitFor();
  await page.getByTestId('understand').waitFor();
  await page.getByTestId('check-updates').click();
  await page.getByTestId('net-ask').waitFor();
  await page.getByTestId('net-confirm').click();
  await page.getByTestId('upgrade-text-apply-en_ult').click();
  const confirm = page.getByTestId('upgrade-confirm');
  await confirm.waitFor();
  await confirm.getByTestId('upgrade-apply').click();
  await confirm.waitFor({ state: 'detached', timeout: 60_000 });
  const ult = (await (await fetch(`${env.door43.url}/api/v1/catalog/search?owner=unfoldingWord`)).json())
    .data.find((entry) => entry.name === 'en_ult');
  await until('the text is pinned at the fake\'s release', () => textPin(env, 'en_ult').sha === ult.commit_sha, 30_000);
  const pinned = textPin(env, 'en_ult');
  fs.rmSync(path.join(env.appData, 'resources', 'dcs', 'unfoldingword', 'en_ult'), { recursive: true, force: true });
  assert.deepEqual(installs(env, 'unfoldingWord', 'en_ult'), []);
  await env.door43.clear();
  await page.getByTestId('sources-modal').getByText('English', { exact: true }).first().click();
  await page.getByTestId('sources-download').waitFor();
  return pinned;
}

browserTest('j3_a_download_from_the_seeded_fake_installs_the_pinned_version', async () => {
  await withApp(async ({ page, env }) => {
    const pinned = await aTextToFetch(page, env);
    const download = page.getByTestId('sources-download');
    await download.waitFor();
    await download.click();
    // The package's other parts (notes, word links) download too: wait for the whole of it.
    const finished = page.getByTestId('sources-done').or(page.getByTestId('sources-error'));
    await finished.waitFor({ timeout: 60_000 });
    assert.equal(await page.getByTestId('sources-error').count(), 0,
      `the download says no failure: ${await finished.textContent()}`);
    assert.equal(await finished.textContent(), doneLine(en['sources.ready']), 'a download that fetched says ready');
    assert.equal(installs(env, 'unfoldingWord', 'en_ult').length, 1, 'the source text is installed');
    assert.ok((await env.door43.requests()).some((r) => r.path.startsWith('/unfoldingWord/en_ult/')), 'the text came from the fake');
    const [installed] = installs(env, 'unfoldingWord', 'en_ult');
    assert.equal(installed.sha, pinned.sha, 'the install on disk is the pinned commit');
    assert.equal(installed.version, pinned.version, 'at the pinned version');
  }, { door43: true });
});

// Owner, 2026-10-27 (4.1.0-preview tester): English comes with the app, so its download fetches
// nothing and says so, where tC4 says "is ready" (declared difference download-already-here).
browserTest('a package already on this computer says so and fetches nothing', async () => {
  await withApp(async ({ page, env }) => {
    await settings(page).click();
    await page.getByTestId('settings-manage-sources').click();
    await page.getByTestId('sources-modal').waitFor();
    await page.getByTestId('understand').waitFor();
    await page.getByTestId('sources-modal').getByText('English', { exact: true }).first().click();
    await page.getByTestId('net-ask').waitFor();
    await page.getByTestId('net-confirm').click();
    const download = page.getByTestId('sources-download');
    await download.waitFor();
    await env.door43.clear();
    await download.click();
    const finished = page.getByTestId('sources-done').or(page.getByTestId('sources-error'));
    await finished.waitFor({ timeout: 60_000 });
    assert.equal(await finished.textContent(), doneLine(rebuild['sources.alreadyHere']));
    const fetched = (await env.door43.requests()).filter((r) => !r.path.startsWith('/api/'));
    assert.deepEqual(fetched, [], 'INV-DOWNLOAD-SAYS-FETCHED: nothing was downloaded');
  }, { door43: true });
});

browserTest('Get source texts reads a package only after the internet question, and Not now reads nothing', async () => {
  await withApp(async ({ page, env }) => {
    await settings(page).click();
    await page.getByTestId('settings-manage-sources').click();
    await page.getByTestId('sources-modal').waitFor();
    await page.getByTestId('understand').waitFor();
    await env.door43.clear();
    await page.getByTestId('sources-modal').getByText('English', { exact: true }).first().click();
    const ask = page.getByTestId('net-ask');
    await ask.waitFor();
    assert.equal(await ask.getAttribute('data-kind'), 'sources');
    await page.getByTestId('net-cancel').click();
    const read = page.getByTestId('sources-allow-internet');
    await read.waitFor();
    assert.equal(await read.textContent(), en['sources.goOnline']);
    await sleep(300);
    assert.deepEqual(await apiRequests(env.door43), [], 'Not now sends nothing to Door43');
    await read.click();
    await ask.waitFor();
    await page.getByTestId('net-confirm').click();
    await page.getByTestId('sources-download').waitFor();
    const asked = (await apiRequests(env.door43)).map((r) => `${r.path}?${r.query ?? ''}`);
    assert.deepEqual(asked, ['/api/v1/catalog/search?owner=unfoldingWord']);
  }, { door43: true });
});

// tC4 #833.5: tC4's registry names v89 under English while this computer has v91 installed.
browserTest('a package card names the notes, words and academy releases installed here', async () => {
  await withApp(async ({ page, env }) => {
    await settings(page).click();
    await page.getByTestId('settings-manage-sources').click();
    const modal = page.getByTestId('sources-modal');
    await modal.waitFor();
    const choose = page.getByText(en['sources.chooseGateway']);
    if (!(await choose.count())) await page.getByRole('button', { name: en['sources.changeLanguage'] }).click();
    await choose.waitFor();
    const release = (repo) => {
      const dir = path.join(env.appData, 'resources', 'dcs', 'unfoldingword', repo);
      const versions = fs.readdirSync(dir).map((sha) => JSON.parse(fs.readFileSync(path.join(dir, sha, 'receipt.json'), 'utf8')).pin.version);
      assert.equal(versions.length, 1, `${repo}: one release installed`);
      return versions[0];
    };
    const line = en['sources.suiteSeen'].replace('{tn}', release('en_tn')).replace('{tw}', release('en_tw')).replace('{ta}', release('en_ta'));
    await until('the English card names the installed releases', () => modal.getByText(`unfoldingWord · ${line}`, { exact: true }).count(), 15_000);
  });
});

// es-419_gl publishes no resources on this fake: its package says so and offers no download.
browserTest('a package with nothing for the book says so and offers no download', async () => {
  await withApp(async ({ page }) => {
    await settings(page).click();
    await page.getByTestId('settings-manage-sources').click();
    await page.getByTestId('sources-modal').waitFor();
    await page.getByTestId('understand').waitFor();
    await page.getByTestId('sources-modal').getByText('Español (Latinoamérica)', { exact: true }).first().click();
    await page.getByTestId('net-ask').waitFor();
    await page.getByTestId('net-confirm').click();
    const none = en['sources.noneForBook'].replace('{book}', 'Titus').replace('{lang}', 'Español (Latinoamérica)');
    await page.getByText(none).waitFor();
    assert.equal(await page.getByTestId('sources-download').count(), 0, 'nothing to download');
  }, { door43: true });
});

// #982 B. The download of Titus is held at Door43 while the person chooses another book and goes
// back to step 1: it keeps its line and its Cancel, Download is not offered beside it, and its
// end names what it fetched.
const heldDownload = async (page, env) => {
  await aTextToFetch(page, env);
  await env.door43.fault({ method: 'GET', path: '/unfoldingWord/en_ult/', times: 1, fault: { type: 'hold' } });
  await page.getByTestId('sources-download').click();
  await page.getByTestId('sources-cancel').waitFor();
  await until('Door43 holds the download of the text', async () => (await env.door43.held()) > 0);
};
const chooseBook = async (page, name) => {
  await page.getByRole('combobox', { name: en['sources.book'], exact: true }).click();
  await page.getByPlaceholder(en['addBook.findBook']).fill(name);
  await page.keyboard.press('Enter');
  await until(`${name} is chosen and its package is read`, async () =>
    (await page.getByRole('combobox', { name: en['sources.book'], exact: true }).textContent()).includes(name)
    && (await page.getByText(en['sources.loadingCatalog']).count()) === 0);
};
const assertUnderWay = async (page, when) => {
  assert.equal(await page.getByTestId('sources-cancel').count(), 1, `INV-BUSY-ENDS-WITH-ITS-WORK: the running download has no Cancel ${when}`);
  assert.equal(await page.getByTestId('sources-download').count(), 0, `INV-BUSY-ENDS-WITH-ITS-WORK: Download is offered ${when}, while one runs`);
};

browserTest('j3_a_download_keeps_its_cancel_and_names_its_own_book_whatever_is_chosen_meanwhile', async () => {
  await withApp(async ({ page, env }) => {
    await heldDownload(page, env);
    await chooseBook(page, 'Hebrews');
    await assertUnderWay(page, 'after another book was chosen');
    await page.getByRole('button', { name: en['sources.changeLanguage'] }).click();
    await page.getByText(en['sources.chooseGateway']).waitFor();
    await assertUnderWay(page, 'on step 1');
    await page.getByTestId('sources-modal').getByText('English', { exact: true }).first().click();
    await page.getByRole('combobox', { name: en['sources.book'], exact: true }).waitFor();
    await env.door43.release();
    const done = page.getByTestId('sources-done');
    await done.waitFor({ timeout: 60_000 });
    assert.equal(await done.textContent(), doneLine(en['sources.ready']), 'INV-DOWNLOAD-NAMES-WHAT-IT-FETCHED: the finished line names Titus, the book that was downloaded');
    assert.equal(installs(env, 'unfoldingWord', 'en_ult').length, 1, 'the text is installed');
    // Hebrews was not downloaded: once its package is read again, it is offered.
    await page.getByTestId('sources-download').waitFor({ timeout: 30_000 });
  }, { door43: true });
});

browserTest('j3_cancel_stops_the_download_it_belongs_to_after_another_book_was_chosen', async () => {
  await withApp(async ({ page, env }) => {
    await heldDownload(page, env);
    await chooseBook(page, 'Hebrews');
    await assertUnderWay(page, 'after another book was chosen');
    await page.getByTestId('sources-cancel').click();
    await page.getByTestId('sources-cancel').waitFor({ state: 'detached', timeout: 60_000 });
    assert.equal(await page.getByTestId('sources-done').count(), 0, 'a cancelled download says nothing is ready');
    assert.deepEqual(installs(env, 'unfoldingWord', 'en_ult'), [], 'what was not finished is not installed');
    await page.getByTestId('sources-download').waitFor();
  }, { door43: true });
});

/** Step 2 on English for Titus, whose package is already on this computer. */
const englishStepTwo = async (page) => {
  await settings(page).click();
  await page.getByTestId('settings-manage-sources').click();
  await page.getByTestId('sources-modal').waitFor();
  await page.getByTestId('understand').waitFor();
  await page.getByTestId('sources-modal').getByText('English', { exact: true }).first().click();
  await page.getByTestId('net-ask').waitFor();
  await page.getByTestId('net-confirm').click();
  await page.getByTestId('sources-download').waitFor();
};
const START = '**/api/v1/resources/download';

browserTest('j3_two_quick_presses_of_download_start_one_download', async () => {
  await withApp(async ({ page }) => {
    await englishStepTwo(page);
    const sent = [];
    let release;
    let reached;
    const held = new Promise((resolve) => { release = resolve; });
    const entered = new Promise((resolve) => { reached = resolve; });
    await page.route(START, async (route) => {
      sent.push(route.request().postDataJSON());
      if (sent.length === 1) {
        reached();
        await held;
      }
      await route.continue();
    });
    const download = page.getByTestId('sources-download');
    await download.click();
    await entered;
    await settled(page);
    // The second press, before the server gave a job.
    if (await download.count()) await download.click();
    release();
    await page.getByTestId('sources-done').waitFor({ timeout: 60_000 });
    assert.equal(sent.length, 1, 'INV-BUSY-ENDS-WITH-ITS-WORK: a second press before the job started another download');
  }, { door43: true });
});

browserTest('j3_a_download_whose_first_answer_was_lost_is_asked_again_as_the_same_request', async () => {
  await withApp(async ({ page, allow }) => {
    await englishStepTwo(page);
    allow(/Failed to load resource|net::ERR_FAILED/);
    const sent = [];
    await page.route(START, async (route) => {
      sent.push(route.request().postDataJSON());
      if (sent.length === 1) {
        // The server gets the request and starts its job; its answer never reaches the page.
        await route.fetch();
        await route.abort('failed');
      } else {
        await route.continue();
      }
    });
    const download = page.getByTestId('sources-download');
    await download.click();
    await page.getByTestId('sources-error').waitFor();
    await download.click();
    await page.getByTestId('sources-done').waitFor({ timeout: 60_000 });
    assert.equal(sent.length, 2);
    assert.equal(sent[1].request, sent[0].request, 'INV-ONE-REQUEST-PER-ATTEMPT: the retry is another request, which could start a second download');
  }, { door43: true });
});
