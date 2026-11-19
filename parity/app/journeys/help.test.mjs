// Help and guides (S13, tC4 #519, #632, #729): tC4's e2e/help.spec.ts, cases a to i, with the
// in-project half of a left to B3 (A5 D18), the site's own links, j and k (#1031), and the help
// in the app's language, l to p (#1036). The pages are translationCore-Suite-website's
// (https://translationcore.com/tc-help/), vendored (AD29), served by `tc4 serve` at /help/, where
// an extensionless link (`gs-install`) finds its `.html` file and a link to `/` names
// translationcore.com; the page swap and the link rules run in the page (app/help-shim.js).
//
// HELP_SHOTS=<folder> keeps case b's screenshots: the help home, a search and its first result.
//
//   TC4_BIN=target/debug/tc4 TC4_UI=target/tc-ui-app node --test parity/app/journeys/help.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { REPO } from '../env-rust.mjs';
import { LABEL, applyLanguage, browserTest, expectLanguage, focused, openMenu, panel, recordRequests, sleep, trigger, until, withApp } from './kit.mjs';

// The install page's download link, as this app serves it (H16 part 3, #1031; tc-server HELP_OVERLAY).
const DOWNLOAD = 'https://translationcore.com/desktop/';
// The top bar's and the footer's translationcore.com link (`href="/"` in the vendored pages).
const SITE = 'https://translationcore.com/';
const HOME = 'translationCore 4 Help';
const helpPanel = (page) => page.getByTestId('help-panel');
const frame = (page) => page.frameLocator('[data-testid="help-frame"]');
const h1 = (page) => frame(page).getByRole('heading', { level: 1 });
const helpFrame = (page) => page.frames().find((f) => f.url().includes('/help/'));
const onPage = (page, file) => page.frames().some((f) => f.url().endsWith(`/help/${file}`));

/** Help and guides, opened from the menu; `home` is the help home's title in the app's language. */
async function openHelp(page, home = HOME) {
  await openMenu(page);
  await page.getByTestId('account-help').click();
  await helpPanel(page).waitFor();
  // The panel slides in; a click before it stops lands where the frame was.
  await until('the panel stops', async () => (await helpPanel(page).evaluate((el) => getComputedStyle(el).transform)) === 'none');
  await until('the help home', async () => (await h1(page).textContent().catch(() => null)) === home);
}

async function expectPage(page, file, title) {
  await until(`${file} shows`, async () => (await h1(page).textContent().catch(() => null)) === title && onPage(page, file));
}

async function openInstallPage(page) {
  await frame(page).locator('a[href="gs-install"]:visible').first().click();
  await expectPage(page, 'gs-install', 'Install and start tC4');
}

async function shot(page, name) {
  if (!process.env.HELP_SHOTS) return;
  fs.mkdirSync(process.env.HELP_SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(process.env.HELP_SHOTS, `${name}.png`) });
}

async function expectClosed(page) {
  await until('the panel closes', async () => (await helpPanel(page).count()) === 0);
  await until('the focus is on the account button', async () => (await focused(page)) === 'account-menu');
}

browserTest('a. (Home half) Help and guides sits below the internet switch; the arrows reach it and Enter opens it', async () => {
  await withApp(async ({ page }) => {
    await openMenu(page);
    const ids = await panel(page).locator('[role^="menuitem"]').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-testid')));
    const at = ids.indexOf('account-internet');
    assert.deepEqual(ids.slice(at, at + 3), ['account-internet', 'account-help', 'account-language']);
    assert.equal((await page.getByTestId('account-help').textContent()).trim(), 'Help and guides');
    await page.getByTestId('account-internet').focus();
    await page.keyboard.press('ArrowDown');
    await until('Help is focused', async () => (await focused(page)) === 'account-help');
    await page.keyboard.press('Enter');
    await helpPanel(page).waitFor();
    await until('the help home', async () => (await h1(page).textContent().catch(() => null)) === 'translationCore 4 Help');
    await page.keyboard.press('Escape');
    await expectClosed(page);
  });
});

browserTest('b. with every other origin refused, the pages, their images and the search results show', async () => {
  await withApp(async ({ page, env }) => {
    const requests = recordRequests(page);
    await openHelp(page);
    await shot(page, 'help-home');
    await frame(page).locator('#q').fill('offline');
    const results = frame(page).locator('#search-results a[role="option"]');
    await results.first().waitFor();
    assert.ok((await results.count()) > 0);
    await shot(page, 'help-search');
    // A result opens its page in the panel (#1031).
    const first = results.first();
    const [href, title] = [await first.getAttribute('href'), await first.locator('.sr-title').textContent()];
    await first.click();
    await expectPage(page, href, title);
    await shot(page, 'help-search-result');
    await frame(page).locator('a[href="section-align"]:visible').first().click();
    await frame(page).locator('a[href="al-link-words"]:visible').first().waitFor();
    await frame(page).locator('a[href="al-link-words"]:visible').first().click();
    await until('the URL moves', async () => onPage(page, 'al-link-words'));
    await until('the page is swapped in', async () => (await h1(page).textContent()) === 'Link your words to the source');
    for (const img of [frame(page).locator('img.brand-logo'), frame(page).locator('img[src^="img/"]').first()]) {
      await img.scrollIntoViewIfNeeded();
      await until('the image loads', () => img.evaluate((el) => el.complete && el.naturalWidth > 0));
    }
    assert.deepEqual(env.refused(), []);
    assert.ok(requests.all.some((r) => new URL(r.url).pathname.endsWith('/help/al-link-words')));
  });
});

// Q31 (b), #763: Help never names a tC4 build, so it cannot disagree with About's version.
browserTest('help_home_shows_no_rc1_build_text_offline', async () => {
  await withApp(async ({ page, env }) => {
    await openHelp(page);
    const text = await frame(page).locator('body').innerText();
    assert.doesNotMatch(text, /Pre-release software|4\.0\.0-rc\.1|\bbuild [0-9a-f]{7}\b/);
    assert.deepEqual(env.refused(), []);
  });
});

browserTest('c. with the internet off, the download link asks first; Not now opens nothing and sends nothing', async () => {
  await withApp(async ({ page, context, env }) => {
    const requests = recordRequests(page);
    let pages = 0;
    context.on('page', () => { pages += 1; });
    await openHelp(page);
    await openInstallPage(page);
    await frame(page).locator(`a[href="${DOWNLOAD}"]`).click();
    const ask = page.getByTestId('net-ask');
    await ask.waitFor();
    assert.equal(await ask.getAttribute('data-kind'), 'helpLink');
    assert.equal(await page.getByTestId('net-ask-reason').textContent(), 'This step needs the internet to open this link in your browser.');
    // Escape belongs to the question, not to the panel under it.
    await page.keyboard.press('Escape');
    await until('the question closes', async () => (await ask.count()) === 0);
    assert.equal(await helpPanel(page).count(), 1);
    await frame(page).locator(`a[href="${DOWNLOAD}"]`).click();
    await ask.waitFor();
    await page.getByTestId('net-cancel').click();
    await until('the question closes', async () => (await ask.count()) === 0);
    await sleep(500);
    assert.equal(pages, 0, 'no window opened');
    await expectPage(page, 'gs-install', 'Install and start tC4');
    assert.equal(await trigger(page).getAttribute('data-internet'), 'off');
    assert.equal(requests.api().filter((p) => p === '/api/v1/account/helpLink').length, 0, 'nothing asked of the server');
    assert.deepEqual(env.refused(), []);
  });
});

browserTest('d. with the internet on, the download link opens a window at its address and asks nothing; the frame stays', async () => {
  await withApp(async ({ page }) => {
    await openMenu(page);
    await page.getByTestId('account-internet').click();
    await until('on', async () => (await trigger(page).getAttribute('data-internet')) === 'on');
    await page.keyboard.press('Escape');
    await openHelp(page);
    await openInstallPage(page);
    const opened = page.waitForEvent('popup');
    await frame(page).locator(`a[href="${DOWNLOAD}"]`).click();
    const popup = await opened;
    assert.equal(popup.url(), DOWNLOAD);
    await popup.close();
    assert.equal(await page.getByTestId('net-ask').count(), 0);
    await expectPage(page, 'gs-install', 'Install and start tC4');
  }, {
    // The window would load translationcore.com: a stub answers it, so the run stays on this machine.
    init: (context) => context.route(DOWNLOAD, (route) => route.fulfill({ contentType: 'text/html', body: '<title>stub</title>' })),
  });
});

browserTest('e. the ✕, Escape in the panel and Escape in the frame close it; the focus returns to the account button', async () => {
  await withApp(async ({ page }) => {
    await openHelp(page);
    await page.getByTestId('help-close').click();
    await expectClosed(page);
    await openHelp(page);
    await page.getByTestId('help-close').focus();
    await page.keyboard.press('Escape');
    await expectClosed(page);
    await openHelp(page);
    await frame(page).locator('#q').click();
    await page.keyboard.press('Escape');
    await expectClosed(page);
  });
});

browserTest('f. Ctrl, Shift, Meta and middle clicks on a help link open no window; the frame shows the page', async () => {
  await withApp(async ({ page, context, env }) => {
    let pages = 0;
    context.on('page', () => { pages += 1; });
    for (const [name, options] of [['ctrl', { modifiers: ['Control'] }], ['shift', { modifiers: ['Shift'] }], ['meta', { modifiers: ['Meta'] }], ['middle', { button: 'middle' }]]) {
      const before = pages;
      await page.goto('about:blank');
      await page.goto(`${env.origin}/#t=${env.token}`);
      await trigger(page).waitFor();
      await openHelp(page);
      await frame(page).locator('summary > a[href="section-getting-started"]').click(options);
      await sleep(500);
      assert.equal(pages - before, 0, `${name}: no window`);
      assert.equal(await helpPanel(page).count(), 1);
      await expectPage(page, 'section-getting-started', 'Getting started');
    }
  });
});

browserTest('g. a topic switch reloads nothing and paints no blank frame; of two quick clicks the second wins; the search page lists its results', async () => {
  await withApp(async ({ page }) => {
    await openHelp(page);
    await helpFrame(page).evaluate(() => { window.tc4Mark = 729; });
    const sameDocument = () => helpFrame(page).evaluate(() => window.tc4Mark === 729);
    const box = await page.getByTestId('help-frame').boundingBox();
    const logo = await frame(page).locator('img.brand-logo').boundingBox();
    const segments = [
      { x0: box.x, x1: box.x + box.width, y: box.y + 4 },
      { x0: logo.x, x1: logo.x + logo.width, y: logo.y + logo.height / 2 },
    ];
    const viewport = page.viewportSize();
    const cdp = await page.context().newCDPSession(page);
    let shots = [];
    cdp.on('Page.screencastFrame', ({ data, sessionId }) => {
      shots.push(data);
      cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    });
    const scorer = await page.context().newPage();
    const rowOf = (png, { x0, x1, y }) => scorer.evaluate(async ({ png, x0, x1, y, w, h }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${png}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const sx = img.width / w;
      return Array.from(ctx.getImageData(Math.round(x0 * sx), Math.round(y * (img.height / h)), Math.round((x1 - x0) * sx), 1).data);
    }, { png, x0, x1, y, w: viewport.width, h: viewport.height });
    const share = (row, bar) => {
      let same = 0;
      for (let i = 0; i < bar.length; i += 4) if ([0, 1, 2].every((k) => Math.abs(row[i + k] - bar[i + k]) < 24)) same += 1;
      return same / (bar.length / 4);
    };
    const rows = [];
    try {
      for (const href of ['section-bible-projects', 'bp-new-bible', 'bp-open-book', 'bp-import', 'bp-export-pdf']) {
        const before = await h1(page).textContent();
        shots = [];
        await cdp.send('Page.startScreencast', { format: 'png' });
        await sleep(300);
        await frame(page).locator(`nav a[href="${href}"]:visible`).click();
        await until(`${href} URL`, async () => onPage(page, href));
        await until(`${href} swapped in`, async () => (await h1(page).textContent()) !== before);
        await sleep(700);
        assert.equal(await sameDocument(), true, `${href} reloaded the frame`);
        await cdp.send('Page.stopScreencast');
        const [bar, mark] = await Promise.all(segments.map(async (segment) => {
          const pixels = await Promise.all(shots.map((png) => rowOf(png, segment)));
          return pixels.map((row) => share(row, pixels[0]));
        }));
        rows.push({ topic: href, frames: shots.length, blank: bar.filter((s, i) => s < 0.9 || mark[i] < 0.9).length });
      }
    } finally {
      await scorer.close();
      if (process.env.HELP_SWITCHES_OUT) fs.writeFileSync(process.env.HELP_SWITCHES_OUT, `${JSON.stringify(rows, null, 2)}\n`);
    }
    assert.equal(rows.length, 5);
    assert.ok(rows.every((r) => r.frames > 0), JSON.stringify(rows));
    assert.deepEqual(rows.filter((r) => r.blank > 0), [], 'no blank frame');

    // A second topic while the first still loads (held half a second): the second wins.
    await page.route('**/help/bp-add-book', async (route) => {
      await sleep(500);
      await route.continue().catch(() => {});
    });
    await frame(page).locator('nav a[href="bp-add-book"]:visible').click({ noWaitAfter: true });
    await frame(page).locator('nav a[href="bp-import"]:visible').click();
    await until('Import shows', async () => /^Import a translationCore 3 project/.test(await h1(page).textContent()));
    await sleep(700);
    assert.match(helpFrame(page).url(), /\/help\/bp-import$/);
    assert.match(await h1(page).textContent(), /^Import a translationCore 3 project/);
    assert.equal(await sameDocument(), true);

    // The search page builds its list from its own address when its script runs.
    await frame(page).locator('#q').fill('offline');
    await frame(page).locator('#q').press('Enter');
    await until('the search page', async () => helpFrame(page).url().includes('/help/search?q=offline'));
    await frame(page).locator('#search-page-results li').first().waitFor();
    assert.equal(await sameDocument(), true);
  });
});

browserTest('h. a read that ends outside help/ or is not HTML is not swapped in and runs no script; the frame loads the page', async () => {
  const topic = 'section-bible-projects';
  const injected = '<!doctype html><title>Injected</title><h1>Injected</h1><script>parent.tc4Injected = 1;</script>';
  const other = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html', 'access-control-allow-origin': '*' });
    res.end(injected);
  });
  await new Promise((done) => other.listen(0, '127.0.0.1', done));
  const otherUrl = `http://127.0.0.1:${other.address().port}/help/${topic}`;
  try {
    await withApp(async ({ page, env, allow }) => {
      // The read a redirect sends to another origin never leaves: the page's CSP (connect-src
      // 'self', APP-DESIGN 5.2) refuses it, which tC4's page has no rule for; the shim's check
      // of where a read ended keeps out the read that stays on this origin.
      const csp = [];
      page.on('console', (m) => { if (/Refused to connect .*Content Security Policy/.test(m.text())) csp.push(m.text()); });
      allow(/Refused to connect .*Content Security Policy/);
      const cases = [
        ['redirect to another origin', (route) => route.fulfill({ status: 302, headers: { location: otherUrl } })],
        ['redirect out of help/', (route) => route.fulfill({ status: 302, headers: { location: '/' } })],
        ['not HTML', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: injected })],
      ];
      for (const [name, answer] of cases) {
        await page.goto('about:blank');
        await page.goto(`${env.origin}/#t=${env.token}`);
        await trigger(page).waitFor();
        await openHelp(page);
        await page.unrouteAll({ behavior: 'ignoreErrors' });
        // Only the swap's read of the topic gets the bad answer; the frame's own load does not.
        await page.route(`${env.origin}/help/${topic}`, (route) => (route.request().resourceType() === 'fetch' ? answer(route) : route.fallback()));
        await frame(page).locator(`nav a[href="${topic}"]:visible`).click();
        await until(`${name}: the frame loads the topic`, async () => (await h1(page).textContent().catch(() => null)) === 'Bible projects' && onPage(page, topic));
        assert.equal(await page.evaluate(() => window.tc4Injected), undefined, `${name}: no script ran`);
      }
      assert.equal(csp.length, 1, 'the CSP refused the read to the other origin');
    });
  } finally {
    other.close();
  }
});

browserTest('i. Escape while a page loads closes the panel and the next open shows the home; a page the server lacks shows in the frame', async () => {
  await withApp(async ({ page, allow }) => {
    allow(/status of 404/);
    const topic = 'section-bible-projects';
    await openHelp(page);
    await page.route(`**/help/${topic}`, async (route) => {
      await sleep(1500);
      await route.continue().catch(() => {});
    });
    await frame(page).locator(`nav a[href="${topic}"]:visible`).click();
    await frame(page).locator('#q').press('Escape');
    await expectClosed(page);
    await sleep(2000);
    await openHelp(page);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await page.route(`**/help/${topic}`, (route) => route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not found' }));
    await frame(page).locator(`nav a[href="${topic}"]:visible`).click();
    await until('the frame is on the topic', async () => onPage(page, topic));
    await until('the server\'s answer shows', async () => (await frame(page).locator('body').textContent()) === 'Not found');
    assert.equal(await helpPanel(page).count(), 1);
    await page.getByTestId('help-close').click();
    await expectClosed(page);
  });
});

browserTest('j. (#1031) the logo opens the help home in the panel; with the internet off, a translationcore.com link asks first, and Not now opens nothing', async () => {
  await withApp(async ({ page, context, env }) => {
    const requests = recordRequests(page);
    let pages = 0;
    context.on('page', () => { pages += 1; });
    await openHelp(page);
    const mark = requests.mark();
    await openInstallPage(page);
    await frame(page).locator('header a.brand').click();
    await expectPage(page, 'index.html', HOME);
    for (const link of ['header a.site-link', 'footer.sitefoot a']) {
      const a = frame(page).locator(link).last();
      assert.equal(await a.getAttribute('href'), SITE, `${link} names the site`);
      await a.click();
      const ask = page.getByTestId('net-ask');
      await ask.waitFor();
      assert.equal(await ask.getAttribute('data-kind'), 'helpLink');
      await page.getByTestId('net-cancel').click();
      await until('the question closes', async () => (await ask.count()) === 0);
      await expectPage(page, 'index.html', HOME);
    }
    await sleep(500);
    assert.equal(pages, 0, 'no window opened');
    assert.equal(await helpPanel(page).count(), 1);
    assert.ok(requests.since(mark).every((r) => new URL(r.url).pathname !== '/' || r.type !== 'document'), 'the frame never loaded the app root');
    assert.deepEqual(env.refused(), []);
  });
});

browserTest('k. (#1031) with the internet on, the translationcore.com link opens a window there and asks nothing; the frame stays', async () => {
  await withApp(async ({ page }) => {
    await openMenu(page);
    await page.getByTestId('account-internet').click();
    await until('on', async () => (await trigger(page).getAttribute('data-internet')) === 'on');
    await page.keyboard.press('Escape');
    await openHelp(page);
    const opened = page.waitForEvent('popup');
    await frame(page).locator('header a.site-link').click();
    const popup = await opened;
    assert.equal(popup.url(), SITE);
    await popup.close();
    assert.equal(await page.getByTestId('net-ask').count(), 0);
    await expectPage(page, 'index.html', HOME);
  }, {
    // The window would load translationcore.com: a stub answers it, so the run stays on this machine.
    init: (context) => context.route(SITE, (route) => route.fulfill({ contentType: 'text/html', body: '<title>stub</title>' })),
  });
});

// ---- Help in the app's language (#1036) ------------------------------------------------------
// The pages are translationcore.com's help in each language, vendored for the help languages an
// app language shows (`help` in crates/tc-ui/src/i18n.rs LOCALES): es-419 shows `es`, pt-BR `pt`,
// and a language the site has no help in (Українська) shows English. A language's pages are in
// `/help/{lang}/`; tc-server serves each page without the site's language menu and without its
// redirect to the computer's language.
//
// HELP_SHOTS=<folder> keeps these cases' screenshots too: the help home in Spanish, Arabic and
// Ukrainian (English), and a Spanish search with its first result.

/** The `<h1>` of a vendored help page (`index.html` for the English home, `es/index.html`),
 * which `cargo test -p tc-ui --test help_pages` proves is the site's at the pin. */
const vendoredTitle = (file) => fs.readFileSync(path.join(REPO, 'crates', 'tc-ui', 'help', file), 'utf8')
  .match(/<h1[^>]*>(.*?)<\/h1>/s)[1];

/** What the help frame's document says of itself, and whether it shows the site's language menu. */
const helpDocument = (page) => helpFrame(page).evaluate(() => ({
  lang: document.documentElement.lang,
  dir: document.documentElement.dir,
  menus: document.querySelectorAll('.help-lang, a[data-locale]').length,
}));

/** Every address the page and its frames ask for from now on, and every answer that is an error. */
function recordLoads(page) {
  const asked = [];
  const errors = [];
  page.on('request', (r) => asked.push(new URL(r.url()).pathname));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${new URL(r.url()).pathname}`); });
  return { asked, errors };
}

browserTest('l. (#1036) with the app in Español and every other origin refused, the help home, a search for "alinear" and its result are Spanish', async () => {
  await withApp(async ({ page, env }) => {
    const loads = recordLoads(page);
    const home = vendoredTitle('es/index.html');
    assert.notEqual(home, HOME);
    await openHelp(page, home);
    assert.ok(onPage(page, 'es/index.html'), helpFrame(page).url());
    assert.deepEqual(await helpDocument(page), { lang: 'es-MX', dir: 'ltr', menus: 0 });
    await shot(page, 'help-home-es-419');
    await frame(page).locator('#q').fill('alinear');
    const results = frame(page).locator('#search-results a[role="option"]');
    await results.first().waitFor();
    assert.ok((await results.count()) > 0);
    await shot(page, 'help-search-es-419');
    const first = results.first();
    const [href, title] = [await first.getAttribute('href'), await first.locator('.sr-title').textContent()];
    await first.click();
    await expectPage(page, `es/${href}`, title);
    assert.deepEqual(await helpDocument(page), { lang: 'es-MX', dir: 'ltr', menus: 0 });
    await shot(page, 'help-search-result-es-419');
    // A Spanish page shows the screenshots every language shares.
    await frame(page).locator('a[href="section-align"]:visible').first().click();
    await frame(page).locator('a[href="al-link-words"]:visible').first().waitFor();
    await frame(page).locator('a[href="al-link-words"]:visible').first().click();
    await expectPage(page, 'es/al-link-words', vendoredTitle('es/al-link-words.html'));
    for (const img of [frame(page).locator('img.brand-logo'), frame(page).locator('img[src^="../img/"]').first()]) {
      await img.scrollIntoViewIfNeeded();
      await until('the image loads', () => img.evaluate((el) => el.complete && el.naturalWidth > 0));
    }
    assert.deepEqual(loads.errors, []);
    assert.ok(loads.asked.every((p) => !p.startsWith('/help/') || p.startsWith('/help/es/') || /^\/help\/(assets|img|site)\//.test(p)), 'only Spanish pages and the shared files');
    assert.deepEqual(env.refused(), []);
  }, { locale: 'es-419' });
});

browserTest('m. (#1036) with the app in العربية, the help home reads right to left and its Arabic text is painted in the vendored Noto Sans Arabic', async () => {
  await withApp(async ({ page, env }) => {
    const loads = recordLoads(page);
    await openHelp(page, vendoredTitle('ar/index.html'));
    assert.ok(onPage(page, 'ar/index.html'), helpFrame(page).url());
    assert.deepEqual(await helpDocument(page), { lang: 'ar', dir: 'rtl', menus: 0 });
    // The computer has Arabic fonts of its own, so a font the app failed to serve would still
    // show Arabic letters: the proof is the vendored face, loaded from the app and in use.
    await until('the Arabic face loads', () => helpFrame(page).evaluate(() => [...document.fonts]
      .some((face) => face.family.replace(/["']/g, '') === 'Noto Sans Arabic' && face.status === 'loaded')));
    const family = await h1(page).evaluate((el) => getComputedStyle(el).fontFamily);
    assert.match(family, /^["']?Noto Sans Arabic/);
    assert.match(await h1(page).textContent(), /[؀-ۿ]/);
    assert.ok(loads.asked.some((p) => /^\/help\/site\/assets\/fonts\/files\/noto-sans-arabic-arabic-\d+-normal\.woff2$/.test(p)), loads.asked.filter((p) => p.includes('font')).join(' '));
    await shot(page, 'help-home-ar');
    assert.deepEqual(loads.errors, []);
    assert.deepEqual(env.refused(), []);
  }, { locale: 'ar' });
});

for (const locale of ['uk', 'en']) {
  browserTest(`n. (#1036) with the app in ${LABEL[locale]}, Help and guides shows the English help`, async () => {
    await withApp(async ({ page, env }) => {
      const loads = recordLoads(page);
      assert.equal(vendoredTitle('index.html'), HOME);
      await openHelp(page);
      assert.ok(onPage(page, 'index.html'), helpFrame(page).url());
      assert.deepEqual(await helpDocument(page), { lang: 'en', dir: 'ltr', menus: 0 });
      await shot(page, `help-home-${locale}`);
      assert.deepEqual(loads.errors, []);
      assert.deepEqual(env.refused(), []);
    }, { locale });
  });
}

browserTest('o. (#1036) after the app language changes, the next opening of Help and guides shows the new language', async () => {
  await withApp(async ({ page, env }) => {
    await openHelp(page);
    assert.ok(onPage(page, 'index.html'));
    await page.getByTestId('help-close').click();
    await expectClosed(page);
    await applyLanguage(page, 'es-419');
    await openHelp(page, vendoredTitle('es/index.html'));
    assert.ok(onPage(page, 'es/index.html'), helpFrame(page).url());
    await page.keyboard.press('Escape');
    await expectClosed(page);
    await applyLanguage(page, 'uk');
    await openHelp(page);
    assert.ok(onPage(page, 'index.html'), helpFrame(page).url());
    assert.deepEqual(env.refused(), []);
  });
});

// The site's pages send a reader on the English help to the computer's language
// (`/assets/js/locale.js`, to `/es/tc-help/`, which the app does not serve). In the app the help
// follows the app's language alone.
browserTest('p. (#1036) with the app in English on a computer in Spanish, the help stays English: no page script moves the panel', async () => {
  await withApp(async ({ context, env }) => {
    const other = await context.browser().newContext({ ...env.contextOptions, locale: 'es-MX' });
    await env.prepare(other);
    const page = await other.newPage();
    try {
      await env.load(page, { locale: 'en' });
      await expectLanguage(page, 'es-419'); // no language saved: the computer's
      await applyLanguage(page, 'en');
      await expectLanguage(page, 'en');
      const loads = recordLoads(page);
      await openHelp(page);
      assert.match(await helpFrame(page).evaluate(() => navigator.language), /^es/);
      await openInstallPage(page);
      // A redirect would have left the English folder by now, for a page or for a 404.
      await sleep(500);
      assert.ok(onPage(page, 'gs-install'), helpFrame(page).url());
      assert.deepEqual(await helpDocument(page), { lang: 'en', dir: 'ltr', menus: 0 });
      assert.deepEqual(loads.errors, []);
      assert.deepEqual(loads.asked.filter((p) => /\/es\/|locale\.js/.test(p)), []);
      assert.deepEqual(env.refused(), []);
    } finally {
      await other.close();
    }
  });
});
