// The change of checking language (J13) and the release upgrade offers (J12) through the app on
// the store with the fake Door43 (unit C8): the plan is made from the project, shown, and
// confirmed by its id; the pins move only at the accept; Keep changes nothing. J12 upgrades a
// scripture text through the screens from the fake's unfoldingWord releases and reads the moved
// pin from the project's pin file; J13 reads the primary set from it after Change.
//
//   TC4_BIN=target/debug/tc4 TC4_UI=target/tc-ui-app TC4_DOOR43_FAKE=target/debug/tc-door43-fake \
//     node --test parity/app/journeys/upgrades.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { LOCALES, browserTest, catalog, settled, sleep, until, withApp } from './kit.mjs';

const en = catalog('en');
const BIBLE = 'sample_burrito';
const settings = (page) => page.getByTestId(`project-${BIBLE}`).getByRole('button', { name: en['home.settings'], exact: true });
const english = (page) => page.getByTestId('settings-gateway-en::unfoldingWord');

/** The project's pin file as it is on disk now (INV-PINS-ON-DISK). */
const pinFile = (env) => JSON.parse(fs.readFileSync(
  path.join(env.projectsDir, BIBLE, 'ingredients', 'checking', 'resources.json'), 'utf8'));

/** The release the fake's catalog publishes for unfoldingWord's `repo`. */
const published = async (env, repo) => (await (await fetch(`${env.door43.url}/api/v1/catalog/search?owner=unfoldingWord`)).json())
  .data.find((entry) => entry.name === repo);

browserTest('Keep leaves the checking language as it was; Change moves the primary set to English', async () => {
  await withApp(async ({ page }) => {
    await settings(page).click();
    await english(page).click();
    const dialog = page.getByTestId('gateway-change');
    await dialog.waitFor();
    assert.equal(await page.getByTestId('understand').count(), 1, 'the project opened behind it');
    // J13: the change is read before anything is written, by book and tool, in tC4's words.
    assert.equal(
      await page.getByTestId('gateway-headline').textContent(),
      '4 decisions in Titus were made against the notes you are leaving.',
    );
    const rows = await page.getByTestId('gateway-plan').locator('li').allTextContents();
    assert.deepEqual(rows, [
      'Titus · Translation Words: 2 carried over, 0 to check again',
      'Titus · Translation Notes: 0 carried over, 1 to check again',
    ]);
    const keep = page.getByTestId('gateway-cancel');
    assert.equal(await keep.textContent(), en['gateway.keep'].replace('{lang}', 'Español (Latinoamérica)'));
    assert.equal(
      await page.getByTestId('gateway-confirm').textContent(),
      en['gateway.change'].replace('{lang}', 'English'),
    );
    // Keep: nothing changed.
    await keep.click();
    await dialog.waitFor({ state: 'detached' });
  });
});

/** Both buttons of the open gateway change lie inside the dialog's 24px padding, on one row, at
 * one width. */
async function assertButtonsFit(page, case_) {
  const box = await page.getByTestId('gateway-change').locator('[aria-modal="true"]').boundingBox();
  const [keep, change] = await Promise.all(
    ['gateway-cancel', 'gateway-confirm'].map((testid) => page.getByTestId(testid).boundingBox()),
  );
  for (const [testid, button] of [['gateway-cancel', keep], ['gateway-confirm', change]]) {
    assert.ok(
      button.x >= box.x + 24 - 0.5 && button.x + button.width <= box.x + box.width - 24 + 0.5,
      `${case_}: ${testid} at ${button.x}..${button.x + button.width} is not inside the dialog at ${box.x}..${box.x + box.width}`,
    );
  }
  assert.ok(Math.abs(keep.width - change.width) < 0.5, `${case_}: Keep is ${keep.width}px wide, Change ${change.width}px`);
  assert.ok(Math.abs(keep.y - change.y) < 0.5, `${case_}: the buttons are not on one row`);
}

// #855: the dialog is 520px at the smallest window the shell allows (900px, shell/lib.cjs). In
// every language of the app, left to right and right to left, both buttons stay inside it, side
// by side at one width; a label that does not fit is cut, and its tooltip gives it whole. This
// holds for the change the sample offers (Español (Latinoamérica) to English), and for the
// longest pair of names the registry has, Español (Latinoamérica) and Bahasa Indonesia, which
// the fixtures do not install, so its labels are put on the same buttons.
for (const { id } of LOCALES) {
  browserTest(`j13_both_buttons_fit_inside_the_dialog_in_${id}`, async () => {
    await withApp(async ({ page }) => {
      const words = catalog(id);
      await page.setViewportSize({ width: 900, height: 600 });
      await page.getByTestId(`project-${BIBLE}`).getByRole('button', { name: words['home.settings'], exact: true }).click();
      await english(page).click();
      const dialog = page.getByTestId('gateway-change').locator('[aria-modal="true"]');
      await dialog.waitFor();
      // The dialog scales in, from a transition that starts on the next frame, so there may be no
      // animation to wait for yet. Measured before it ends, it is narrower than it stays.
      await until('the dialog to finish opening', () => dialog.evaluate((el) => Math.abs(el.getBoundingClientRect().width - el.offsetWidth) < 0.01));
      await assertButtonsFit(page, 'Español (Latinoamérica) to English');
      for (const [testid, label] of [
        ['gateway-cancel', words['gateway.keep'].replace('{lang}', 'Español (Latinoamérica)')],
        ['gateway-confirm', words['gateway.change'].replace('{lang}', 'English')],
      ]) {
        const button = page.getByTestId(testid);
        assert.equal(await button.textContent(), label);
        assert.equal(await button.getAttribute('title'), label, `${testid}'s tooltip gives its label whole`);
      }
      await page.evaluate(([keep, change]) => {
        for (const [testid, label] of [['gateway-cancel', keep], ['gateway-confirm', change]]) {
          const button = document.querySelector(`[data-testid="${testid}"]`);
          button.firstElementChild.textContent = label;
          button.title = label;
        }
      }, [
        words['gateway.keep'].replace('{lang}', 'Español (Latinoamérica)'),
        words['gateway.change'].replace('{lang}', 'Bahasa Indonesia'),
      ]);
      await assertButtonsFit(page, 'Español (Latinoamérica) to Bahasa Indonesia');
    }, { locale: id });
  });
}

// #855: the checking language in use is marked Current and choosing it asks nothing. The sample
// lists English alone as an option, so English is made the language in use first.
browserTest('j13_the_language_in_use_is_never_asked', async () => {
  await withApp(async ({ page }) => {
    await settings(page).click();
    await english(page).click();
    await page.getByTestId('gateway-change').waitFor();
    await page.getByTestId('gateway-confirm').click();
    await page.getByTestId('gateway-change').waitFor({ state: 'detached' });
    await page.getByTestId('project-switch').click();
    await until('Home shows the project card', () => page.getByTestId(`project-${BIBLE}`).count());
    await settings(page).click();
    await until('English is the language in use', async () => (await english(page).getAttribute('data-current')) === '1');
    await english(page).click();
    await sleep(500);
    assert.equal(await page.getByTestId('gateway-change').count(), 0, 'no change of checking language is asked');
  }, { door43: true });
});

// #855: Get source texts, where the issue was seen, offers "Use for checking" for an installed
// suite, and once that suite is the language in use it only says so, both on the step left open
// and when opened again. The sample's Spanish suite is not whole on this computer, so English,
// whose suite is, is the one checked.
browserTest('j13_get_source_texts_never_offers_the_language_in_use', async () => {
  await withApp(async ({ page }) => {
    const getSourceTexts = async () => {
      await settings(page).click();
      await page.getByTestId('settings-manage-sources').click();
      await page.getByTestId('sources-modal').waitFor();
    };
    await getSourceTexts();
    // The card names English twice: its autonym and its English name.
    await page.getByTestId('sources-modal').getByText('English', { exact: true }).first().click();
    // Step 2 asks to turn the internet on to read the package list; Not now reads nothing.
    await page.getByTestId('net-cancel').click();
    await page.getByTestId('use-for-checking').click();
    await page.getByTestId('gateway-change').waitFor();
    await page.getByTestId('gateway-confirm').click();
    await page.getByTestId('gateway-change').waitFor({ state: 'detached' });
    // Get source texts stays open over the project after the change, on the same step, which
    // now says English is in use and offers it no more.
    await page.getByTestId('already-checking-in').waitFor();
    assert.equal(await page.getByTestId('use-for-checking').count(), 0, 'the open step stops offering the language in use');
    await page.getByTestId('sources-modal').getByRole('button', { name: en['common.close'], exact: true }).first().click();
    await page.getByTestId('sources-modal').waitFor({ state: 'detached' });
    await page.getByTestId('project-switch').click();
    await until('Home shows the project card', () => page.getByTestId(`project-${BIBLE}`).count());
    // Get source texts opens again on the English suite, now the language in use.
    await getSourceTexts();
    await page.getByTestId('already-checking-in').waitFor();
    assert.equal(await page.getByTestId('use-for-checking').count(), 0, 'the language in use is not offered');
  }, { door43: true });
});

browserTest('j13_change_writes_the_primary_set_to_disk', async () => {
  await withApp(async ({ page, env }) => {
    assert.deepEqual(pinFile(env).languageSets.primary.gatewayLanguage, { languageId: 'es-419', owner: 'es-419_gl' });
    await settings(page).click();
    await english(page).click();
    await page.getByTestId('gateway-change').waitFor();
    await page.getByTestId('gateway-confirm').click();
    await page.getByTestId('gateway-change').waitFor({ state: 'detached' });
    // The page afresh is Home (the server's state stays): the checking language is English
    // now, read from the pins.
    await page.getByTestId('project-switch').click();
    await until('Home shows the project card', () => page.getByTestId(`project-${BIBLE}`).count());
    await settings(page).click();
    const current = page.getByTestId('settings-gateway-current');
    await current.waitFor();
    await until('the card names English', async () => (await current.textContent()).includes('English'));
    assert.equal(await english(page).getAttribute('data-current'), '1');
    // The pin file on disk says the same: the primary set is English now.
    await until('the pin file names English', () => pinFile(env).languageSets.primary.gatewayLanguage.languageId === 'en', 30_000);
    assert.deepEqual(pinFile(env).languageSets.primary.gatewayLanguage, { languageId: 'en', owner: 'unfoldingWord' });
  }, { door43: true });
});

// J12 (P1). The sample pins Door43's own commits, which the fake cannot serve; the fake's
// releases have other commits, so it offers them, as tC4 does (D58: the commit is a release's
// identity, its label only display), even where the label reads lower.
browserTest('j12_an_upgrade_through_the_screens_moves_the_pin_on_disk', async () => {
  await withApp(async ({ page, env }) => {
    await settings(page).click();
    await page.getByTestId('settings-manage-sources').click();
    await page.getByTestId('sources-modal').waitFor();
    await env.door43.clear();
    await page.getByTestId('check-updates').click();
    const ask = page.getByTestId('net-ask');
    await ask.waitFor();
    assert.equal(await ask.getAttribute('data-kind'), 'sources');
    await page.getByTestId('net-cancel').click();
    await sleep(300);
    const sent = (await env.door43.requests()).filter((r) => r.path.startsWith('/api/'));
    assert.deepEqual(sent, [], 'Not now sends nothing');
    assert.equal(await page.getByTestId('upgrade-offer-primary').count(), 0, 'nothing is offered');
    // Asking again and turning the internet on reads what Door43 has: the primary set is
    // es-419_gl's, which the fake does not publish, so it is as current as Door43 can say; the
    // scripture text is offered at the fake's release.
    await page.getByTestId('check-updates').click();
    await ask.waitFor();
    await page.getByTestId('net-confirm').click();
    await page.getByTestId('upgrade-offer-primary').waitFor();
    assert.equal(await page.getByTestId('upgrade-offer-primary').getAttribute('data-upgrades'), '0');
    assert.equal(await page.getByTestId('upgrade-current-primary').count(), 1);
    const ult = await published(env, 'en_ult');
    const before = pinFile(env).extraScripture.find((p) => p.repoPath.endsWith('unfoldingWord/en_ult'));
    assert.notEqual(before.sha, ult.commit_sha);
    await page.getByTestId('upgrade-text-apply-en_ult').click();
    const confirm = page.getByTestId('upgrade-confirm');
    await confirm.waitFor();
    await confirm.getByTestId('upgrade-apply').click();
    await confirm.waitFor({ state: 'detached', timeout: 60_000 });
    // The pin file on disk names the release the screen offered.
    const moved = () => pinFile(env).extraScripture.find((p) => p.repoPath.endsWith('unfoldingWord/en_ult'));
    await until('the pin moved on disk', () => moved().sha === ult.commit_sha, 30_000);
    assert.equal(moved().version, ult.branch_or_tag_name);
  }, { door43: true });
});

// #982 A. Door43's catalog answer is held, so the check for updates is still out when the
// person leaves the project. `answered` resolves when the app's own call ends.
const getSourceTexts = async (page) => {
  await settings(page).click();
  await page.getByTestId('settings-manage-sources').click();
  await page.getByTestId('sources-modal').waitFor();
};
const closeSourceTexts = async (page) => {
  await page.getByTestId('sources-modal').getByRole('button', { name: en['common.close'], exact: true }).first().click();
  await page.getByTestId('sources-modal').waitFor({ state: 'detached' });
};
const toHome = async (page) => {
  await page.getByTestId('project-switch').click();
  await until('Home shows the project card', () => page.getByTestId(`project-${BIBLE}`).count());
};
async function checkWithDoor43Held(page, env) {
  await getSourceTexts(page);
  await env.door43.fault({ method: 'GET', path: '/api/v1/catalog/search', times: 1, fault: { type: 'hold' } });
  // Caught here: a journey that fails before it awaits the answer must show its own failure.
  const answered = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/v1/resources/checkUpdates', { timeout: 60_000 }).catch(() => null);
  const check = page.getByTestId('check-updates');
  await check.click();
  await page.getByTestId('net-confirm').click();
  await until('Check for updates waits for Door43', () => check.isDisabled());
  assert.equal(await check.textContent(), en['upgrade.checking']);
  await until('Door43 holds the catalog request', async () => (await env.door43.held()) > 0);
  // In an object: an async function that returned the promise itself would wait for it.
  return { answered };
}
const assertCheckIsReady = async (page, when) => {
  const check = page.getByTestId('check-updates');
  assert.equal(await check.isDisabled(), false, `INV-BUSY-ENDS-WITH-ITS-WORK: Check for updates is disabled ${when}`);
  assert.equal(await check.textContent(), en['upgrade.check'], `INV-BUSY-ENDS-WITH-ITS-WORK: the button says it is checking ${when}`);
};

browserTest('j12_a_check_answered_after_its_project_closed_leaves_check_for_updates_ready', async () => {
  await withApp(async ({ page, env }) => {
    const { answered } = await checkWithDoor43Held(page, env);
    await closeSourceTexts(page);
    await toHome(page);
    await env.door43.release();
    assert.ok(await answered, 'the app got its answer to the held check');
    await settled(page);
    await getSourceTexts(page);
    await assertCheckIsReady(page, 'with no check running for this open of the project');
    assert.equal(await page.getByTestId('upgrade-texts').count(), 0, 'INV-RESOURCE-ANSWER-HAS-AN-OWNER: an answer from before the reopening is shown');
  }, { door43: true });
});

browserTest('j12_a_check_from_an_earlier_open_never_holds_or_fills_the_reopened_project', async () => {
  await withApp(async ({ page, env }) => {
    const { answered } = await checkWithDoor43Held(page, env);
    await closeSourceTexts(page);
    await toHome(page);
    await getSourceTexts(page);
    await assertCheckIsReady(page, 'while the earlier open\'s check is still out');
    await env.door43.release();
    assert.ok(await answered, 'the app got its answer to the held check');
    await settled(page);
    await assertCheckIsReady(page, 'after the earlier open\'s answer came');
    assert.equal(await page.getByTestId('upgrade-texts').count(), 0, 'INV-RESOURCE-ANSWER-HAS-AN-OWNER: an answer from before the reopening is shown');
    // The reopened project's own check still works.
    await page.getByTestId('check-updates').click();
    await page.getByTestId('upgrade-texts').waitFor();
  }, { door43: true });
});

browserTest('j12_a_failed_check_is_said_only_in_the_open_it_was_made_for', async () => {
  await withApp(async ({ page, env, allow }) => {
    await getSourceTexts(page);
    await env.door43.fault({ method: 'GET', path: '/api/v1/catalog/search', fault: { type: 'status', status: 503, message: 'down for maintenance' } });
    allow(/503|Failed to load resource/);
    await page.getByTestId('check-updates').click();
    await page.getByTestId('net-confirm').click();
    await page.getByTestId('upgrade-error').waitFor();
    await closeSourceTexts(page);
    await toHome(page);
    await getSourceTexts(page);
    await assertCheckIsReady(page, 'after the earlier open\'s check failed');
    assert.equal(await page.getByTestId('upgrade-error').count(), 0, 'INV-RESOURCE-ANSWER-HAS-AN-OWNER: the earlier open\'s failed check is said in this open');
  }, { door43: true });
});

// #982 C. The sample has two projects, the Bible and the stories: one's late answers must
// not show over the other.
const OBS = 'sample_burrito_obs';
const sourceTextsOf = async (page, project) => {
  await page.getByTestId(`project-${project}`).getByRole('button', { name: en['home.settings'], exact: true }).click();
  await page.getByTestId('settings-manage-sources').click();
  await page.getByTestId('sources-modal').waitFor();
};
const homeFrom = async (page, project) => {
  await page.getByTestId('project-switch').click();
  await until('Home shows the project card', () => page.getByTestId(`project-${project}`).count());
};

browserTest('j13_one_projects_packages_never_show_in_another_projects_source_texts', async () => {
  await withApp(async ({ page }) => {
    // The Bible checks in English from here on; the stories do not.
    await sourceTextsOf(page, BIBLE);
    await page.getByTestId('sources-modal').getByText('English', { exact: true }).first().click();
    await page.getByTestId('net-cancel').click();
    await page.getByTestId('use-for-checking').click();
    await page.getByTestId('gateway-change').waitFor();
    await page.getByTestId('gateway-confirm').click();
    await page.getByTestId('already-checking-in').waitFor();
    await closeSourceTexts(page);
    await homeFrom(page, BIBLE);
    // The Bible's next read of its packages is held until the stories' dialog is open.
    let release;
    let reached;
    let landed;
    const held = new Promise((resolve) => { release = resolve; });
    const entered = new Promise((resolve) => { reached = resolve; });
    const answered = new Promise((resolve) => { landed = resolve; });
    let first = true;
    await page.route('**/api/v1/resources/sources', async (route) => {
      if (!first) return route.continue();
      first = false;
      const response = await route.fetch();
      reached();
      await held;
      await route.fulfill({ response });
      landed();
    });
    await sourceTextsOf(page, BIBLE);
    await entered;
    await closeSourceTexts(page);
    await homeFrom(page, BIBLE);
    await sourceTextsOf(page, OBS);
    // The dialog is still on English's step. The stories do not check in English.
    await page.getByTestId('use-for-checking').waitFor();
    release();
    await answered;
    await settled(page);
    assert.equal(await page.getByTestId('already-checking-in').count(), 0, 'INV-RESOURCE-ANSWER-HAS-AN-OWNER: the Bible\'s checking language is said in the stories\' dialog');
    assert.equal(await page.getByTestId('use-for-checking').count(), 1, 'INV-RESOURCE-ANSWER-HAS-AN-OWNER: the stories\' own packages were replaced');
  }, { door43: true });
});

/** The Bible's text upgrade is pressed with Door43 holding the download. Answers the plan job. */
async function upgradeWithDoor43Held(page, env, { thenFails = false } = {}) {
  await sourceTextsOf(page, BIBLE);
  await page.getByTestId('check-updates').click();
  await page.getByTestId('net-confirm').click();
  const apply = page.getByTestId('upgrade-text-apply-en_ult');
  await apply.waitFor();
  await env.door43.fault({ method: 'GET', path: '/unfoldingWord/en_ult/', times: 1, fault: { type: 'hold' } });
  if (thenFails) await env.door43.fault({ method: 'GET', path: '/unfoldingWord/en_ult/', fault: { type: 'status', status: 503, message: 'down for maintenance' } });
  const started = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/v1/resources/planUpgrade');
  await apply.click();
  const job = (await (await started).json()).value;
  await until('Door43 holds the download of the release', async () => (await env.door43.held()) > 0);
  return job;
}
/** The page follows a job by its frames, and asks the server once a second in case one was
 * lost: after this long it has seen an end the server already reports. A wrong build shows the
 * answer by then; a right one shows nothing, so there is no signal on the page to wait for. */
const pageSawTheJobEnd = () => sleep(1500);
const jobEnded = (env, job) => until('the plan job ended', async () => {
  const view = await env.call('jobs/get', { job });
  return ['done', 'failed', 'cancelled'].includes(view?.state?.type) ? view.state.type : null;
});

browserTest('j12_a_confirmation_made_for_a_project_that_was_left_never_shows_over_another', async () => {
  await withApp(async ({ page, env }) => {
    const job = await upgradeWithDoor43Held(page, env);
    await closeSourceTexts(page);
    await homeFrom(page, BIBLE);
    await sourceTextsOf(page, OBS);
    await env.door43.release();
    assert.equal(await jobEnded(env, job), 'done');
    await pageSawTheJobEnd();
    assert.equal(await page.getByTestId('upgrade-confirm').count(), 0, 'INV-RESOURCE-ANSWER-HAS-AN-OWNER: the Bible\'s upgrade confirmation is shown over the stories');
    // The stories' own check still runs.
    await assertCheckIsReady(page, 'in the stories, while the Bible\'s plan was made');
  }, { door43: true });
});

browserTest('j12_a_failed_install_is_said_only_in_the_open_it_was_pressed_in', async () => {
  await withApp(async ({ page, env, allow }) => {
    allow(/503|Failed to load resource/);
    const job = await upgradeWithDoor43Held(page, env, { thenFails: true });
    await closeSourceTexts(page);
    await homeFrom(page, BIBLE);
    await sourceTextsOf(page, BIBLE);
    assert.equal(await page.getByTestId('upgrade-progress').count(), 0, 'INV-BUSY-ENDS-WITH-ITS-WORK: the earlier open\'s install shows its progress in this open');
    await env.door43.release();
    assert.equal(await jobEnded(env, job), 'failed');
    await pageSawTheJobEnd();
    assert.equal(await page.getByTestId('upgrade-error').count(), 0, 'INV-RESOURCE-ANSWER-HAS-AN-OWNER: the earlier open\'s failed install is said in this open');
  }, { door43: true });
});
