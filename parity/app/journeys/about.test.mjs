// About translationCore and License (M17, tC4 #520): tC4's e2e/internet-consent.spec.ts case i,
// with the walk in a project left to B3 (A5 D18), and the close inside About's focus hold. Back
// from License, About holds the focus on "Read the license" for ten frames; a close inside them
// must end the hold, as tC4's effect cancels its frame, and not read the dialog that is gone.
//
// Third-party licenses (#606) shows the THIRD-PARTY-NOTICES.txt the run was given, the way
// License shows the LICENSE.
//
//   TC4_BIN=target/debug/tc4 TC4_UI=target/tc-ui-app node --test parity/app/journeys/about.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO } from '../env-rust.mjs';
import { bundledInstalls, lockedCrates, missing, notices as writeNotices } from '../../../scripts/release/notices.mjs';
import { smallBundle } from '../../../scripts/release/notices-fixture.mjs';
import { browserTest, focused, openMenu, panel, recordRequests, sleep, trigger, until, withApp } from './kit.mjs';

const notice = fs.readFileSync(path.join(REPO, 'LICENSE'), 'utf8');
const copyright = notice.split('\n').find((line) => line.startsWith('Copyright')).trim();
const aboutDialog = (page) => page.getByRole('dialog', { name: 'About translationCore' });
const licenseDialog = (page) => page.getByRole('dialog', { name: 'License', exact: true });
const region = (page) => page.getByRole('region', { name: 'License text' });
const noticesDialog = (page) => page.getByRole('dialog', { name: 'Third-party licenses', exact: true });
const noticesRegion = (page) => page.getByRole('region', { name: 'Third-party license text' });
const gone = (what, locator) => until(`${what} closes`, async () => (await locator.count()) === 0);
const focusOn = (page, what, id) => until(`the focus on ${what}`, async () => (await focused(page)) === id);

/** Counts the page's loads from now on: a panic makes boot.js load the page again. */
function countLoads(page) {
  let loads = 0;
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) loads += 1; });
  return () => loads;
}

/** The title is not the top bar's white (tC4: the dialogs render inside the dark bar). */
async function notWhite(locator) {
  await locator.waitFor();
  assert.notEqual(await locator.evaluate((el) => getComputedStyle(el).color), 'rgb(255, 255, 255)');
}

/** The whole path by keyboard: menu, About, License, back to About, back to the trigger. */
async function walk(page, build) {
  await trigger(page).focus();
  await page.keyboard.press('Enter');
  await panel(page).waitFor();
  await page.getByTestId('account-about').focus();
  await page.keyboard.press('Enter');
  await gone('the menu', panel(page));
  await notWhite(aboutDialog(page).getByText('About translationCore').first());
  assert.equal(await page.getByTestId('about-version').textContent(), `${build.version} (${build.commit})`);
  assert.equal(await page.getByTestId('about-copyright').textContent(), copyright);
  assert.match(await page.getByTestId('about-license-name').textContent(), /MIT/);

  // Read the license closes About and opens License.
  await page.getByTestId('about-read-license').focus();
  await page.keyboard.press('Enter');
  await gone('About', aboutDialog(page));
  await notWhite(licenseDialog(page).getByText('License', { exact: true }).first());
  assert.equal(await page.getByTestId('license-notice').textContent(), notice);
  assert.equal(await page.getByTestId('license-gpl').count(), 0, 'tC4 since #838 shows the MIT notice alone');
  // The keyboard reaches the text and scrolls it.
  assert.equal(await region(page).getAttribute('tabindex'), '0');
  for (let i = 0; i < 4 && (await focused(page)) !== 'license-text'; i += 1) await page.keyboard.press('Tab');
  assert.equal(await focused(page), 'license-text', 'Tab reaches the text');
  assert.equal(await region(page).evaluate((el) => el.scrollTop), 0);
  await page.keyboard.press('End');
  await until('the text scrolls', async () => (await region(page).evaluate((el) => el.scrollTop)) > 0);

  // Escape on License returns to About, with the focus on Read the license.
  await page.keyboard.press('Escape');
  await gone('License', licenseDialog(page));
  await aboutDialog(page).waitFor();
  await focusOn(page, 'Read the license', 'about-read-license');
  // Escape on About returns the focus to the account menu trigger.
  await page.keyboard.press('Escape');
  await gone('About', aboutDialog(page));
  await focusOn(page, 'the account button', 'account-menu');
}

browserTest('i. (Home half) About and License: the keyboard opens, reads and closes them; the version, the commit, the copyright line and both license texts show, with no request', async () => {
  await withApp(async ({ page, env }) => {
    const { build } = await env.call('app/hello', {});
    const loads = countLoads(page);
    const requests = recordRequests(page);
    await page.waitForFunction(() => window.__tcIdle === true);
    const mark = requests.mark();
    // tC4's port panicked on the first walk, so the walk runs twice.
    await walk(page, build);
    await walk(page, build);
    // The Close buttons do the same as Escape.
    await openMenu(page);
    await page.getByTestId('account-about').click();
    await page.getByTestId('about-read-license').click();
    await page.getByTestId('license-close').click();
    await gone('License', licenseDialog(page));
    await focusOn(page, 'Read the license', 'about-read-license');
    await page.getByTestId('about-close').click();
    await gone('About', aboutDialog(page));
    await focusOn(page, 'the account button', 'account-menu');
    // Every value is in the bundle: the walks and the clicks sent nothing.
    assert.deepEqual(requests.since(mark), [], 'no request at all');
    assert.equal(loads(), 0, 'the page never loaded again');
    assert.deepEqual(env.refused(), []);
  });
});

// The hold lasts ten frames, about 170 ms: each close lands inside it.
for (const wait of [0, 30, 80]) {
  browserTest(`about_closed_by_escape_${wait}_ms_after_license_ends_its_focus_hold`, async () => {
    await withApp(async ({ page }) => {
      const loads = countLoads(page);
      await openMenu(page);
      await page.getByTestId('account-about').click();
      await page.getByTestId('about-read-license').click();
      await licenseDialog(page).waitFor();
      await page.keyboard.press('Escape');
      if (wait) await sleep(wait);
      await page.keyboard.press('Escape');
      await gone('About', aboutDialog(page));
      await focusOn(page, 'the account button', 'account-menu');
      // A frame of a hold that outlived About would panic here.
      await sleep(500);
      assert.equal(loads(), 0, 'no panic reloaded the page');
      assert.equal(await trigger(page).count(), 1);
    });
  });
}

browserTest('about_closed_by_mouse_right_after_license_ends_its_focus_hold', async () => {
  await withApp(async ({ page }) => {
    const loads = countLoads(page);
    for (const round of [1, 2]) {
      await openMenu(page);
      await page.getByTestId('account-about').click();
      await page.getByTestId('about-read-license').click();
      await licenseDialog(page).waitFor();
      await page.getByTestId('license-close').click();
      // At once, while About still slides in: no wait for the dialog to stop moving.
      await page.getByTestId('about-close').click({ force: true });
      await gone(`About (round ${round})`, aboutDialog(page));
      await focusOn(page, 'the account button', 'account-menu');
      await sleep(500);
    }
    assert.equal(loads(), 0, 'no panic reloaded the page');
  });
});

// tC4 #278: a QA report quotes the running build from the console, with no click: the page logs
// one line at start naming its own version and short commit and the server's (app/hello).
browserTest('the_console_names_the_running_build_at_start', async () => {
  const lines = [];
  await withApp(async ({ env }) => {
    const { build } = await env.call('app/hello', {});
    const short = build.commit.slice(0, 8);
    const expected = `translationCore ${build.version} (${short}) · server ${build.version} (${short})`;
    assert.deepEqual(lines.filter((line) => line.startsWith('translationCore ')), [expected]);
  }, { init: (context) => context.on('console', (m) => { if (m.type() === 'info') lines.push(m.text()); }) });
});

/** THIRD-PARTY-NOTICES.txt as the release writes it, over a small bundle, with what it covers. */
function releaseNotices() {
  process.env.CARGO_NET_OFFLINE = 'true';
  const given = smallBundle();
  const text = writeNotices(given);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'about-notices-')), 'THIRD-PARTY-NOTICES.txt');
  fs.writeFileSync(file, text);
  const crates = lockedCrates(fs.readFileSync(path.join(REPO, 'Cargo.lock'), 'utf8'));
  return { file, text, crates, installs: bundledInstalls(given.bundle) };
}

browserTest('third_party_licenses_show_every_notice_by_keyboard_and_ask_only_the_app', async () => {
  const given = releaseNotices();
  await withApp(async ({ page }) => {
    const requests = recordRequests(page);
    await page.waitForFunction(() => window.__tcIdle === true);
    const mark = requests.mark();
    await openMenu(page);
    await page.getByTestId('account-about').click();
    await aboutDialog(page).waitFor();
    // Third-party licenses closes About and opens the notices.
    await page.getByTestId('about-third-party').focus();
    await page.keyboard.press('Enter');
    await gone('About', aboutDialog(page));
    await notWhite(noticesDialog(page).getByText('Third-party licenses', { exact: true }).first());
    const body = page.getByTestId('notices-body');
    await body.waitFor();
    const shown = await body.textContent();
    assert.equal(shown, given.text, 'the whole file, as written');
    assert.deepEqual(missing(shown, given.crates, given.installs), [], 'every crate and resource block');
    assert.match(shown, /Font licence OFL-/);
    // The keyboard reaches the text and scrolls it.
    assert.equal(await noticesRegion(page).getAttribute('tabindex'), '0');
    for (let i = 0; i < 4 && (await focused(page)) !== 'notices-text'; i += 1) await page.keyboard.press('Tab');
    assert.equal(await focused(page), 'notices-text', 'Tab reaches the text');
    await page.keyboard.press('End');
    await until('the text scrolls', async () => (await noticesRegion(page).evaluate((el) => el.scrollTop)) > 0);
    // Escape returns to About, with the focus on Third-party licenses; Close does the same.
    await page.keyboard.press('Escape');
    await gone('the notices', noticesDialog(page));
    await aboutDialog(page).waitFor();
    await focusOn(page, 'Third-party licenses', 'about-third-party');
    await page.getByTestId('about-third-party').click();
    await page.getByTestId('notices-close').click();
    await gone('the notices', noticesDialog(page));
    await focusOn(page, 'Third-party licenses', 'about-third-party');
    // Read the license still returns to its own button.
    await page.getByTestId('about-read-license').click();
    await page.keyboard.press('Escape');
    await focusOn(page, 'Read the license', 'about-read-license');
    // Nothing but the app's own server, offline: the notices come from the local file.
    const origin = new URL(page.url()).origin;
    const asked = requests.since(mark).map((r) => r.url);
    assert.ok(asked.length > 0, 'the notices were fetched');
    assert.deepEqual(asked.filter((url) => new URL(url).origin !== origin), [], 'no request left the app');
  }, { notices: given.file });
});

browserTest('third_party_licenses_say_plainly_when_the_run_has_no_notices_file', async () => {
  await withApp(async ({ page, allow }) => {
    // The 404 of the missing file is the browser's console line, and the case under test.
    allow(/404/);
    await openMenu(page);
    await page.getByTestId('account-about').click();
    await page.getByTestId('about-third-party').click();
    const missingText = page.getByTestId('notices-missing');
    await missingText.waitFor();
    assert.match(await missingText.textContent(), /THIRD-PARTY-NOTICES\.txt/);
    assert.equal(await page.getByTestId('notices-body').count(), 0, 'no empty region');
    await page.keyboard.press('Escape');
    await focusOn(page, 'Third-party licenses', 'about-third-party');
  });
});
