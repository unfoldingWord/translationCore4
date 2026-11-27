// The Check picker's way out of a card that cannot open its tool (B5a): the "Get source texts"
// and "Download" buttons open the source texts dialog (tC4 `Check.jsx` calls `openSources` on
// both, and the Download one stops the click reaching the card), and a tool that is no longer
// ready when the screen opens it leaves the picker, whose Fix card says why (tC4's
// `resumeCheckTool`), instead of a dead-end error.
//
//   TC4_BIN=target/debug/tc4 TC4_UI=target/tc-ui-app node --test parity/app/journeys/check-picker.test.mjs
import assert from 'node:assert/strict';
import { applyLanguage, browserTest, catalog, until, withApp } from './kit.mjs';

const en = catalog('en');
const BIBLE = 'sample_burrito';

const openProject = async (page) => {
  await page.getByTestId(`project-${BIBLE}`).getByRole('button', { name: /Titus/ }).click();
  await page.getByTestId('understand-unit-s1').waitFor();
};

browserTest('picker_get_source_texts_and_download_open_the_source_texts_dialog', async () => {
  await withApp(async ({ page }) => {
    // The sample's Translation Words is pinned to a resource this computer lacks, and its
    // Translation Notes is ready: the answer is rewritten into a tool with no pins and a tool
    // that opens on the English fallback.
    await page.route('**/api/v1/check/picker', async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      const [words, notes] = body.value.tools;
      Object.assign(words, { state: 'unpinned', pin: null, rung: null });
      notes.fallbackFor = { repoPath: 'git.door43.org/es-419_gl/es-419_tn', version: 'v18', sha: '0'.repeat(40) };
      await route.fulfill({ response, json: body });
    });
    await openProject(page);
    await page.getByRole('tab', { name: 'Check' }).click();
    const modal = page.getByTestId('sources-modal');

    await page.getByTestId('preflight-translationWords').getByRole('button', { name: en['check.fix.getResources'] }).click();
    await modal.waitFor();
    await page.keyboard.press('Escape');
    await modal.waitFor({ state: 'detached' });

    // The Download button sits inside a card that opens its tool when clicked: only the dialog opens.
    await page.getByTestId('fetch-primary-translationNotes').click();
    await modal.waitFor();
    assert.equal(await page.getByTestId('check-progress').count(), 0, 'the click did not open the tool');
    await page.keyboard.press('Escape');
    await modal.waitFor({ state: 'detached' });
    await page.getByTestId('preflight-translationNotes').waitFor();
  });
});

// INV-CHECK-OPEN-DOES-NOT-WAIT-FOR-PLACE: the list opens while the place's answer is held, and
// the place is still recorded, so the book reopens at the same tool.
browserTest('opening_a_check_list_does_not_wait_for_the_place_and_the_place_is_kept', async () => {
  await withApp(async ({ page }) => {
    await openProject(page);
    await page.getByRole('tab', { name: 'Check' }).click();
    let release;
    const answer = new Promise((resolve) => { release = resolve; });
    await page.route('**/api/v1/prefs/recordPlace', async (route) => {
      await answer;
      await route.fallback();
    });
    await page.getByTestId('open-translationNotes').click();
    await page.getByTestId('check-progress').waitFor({ timeout: 10_000 });
    release();
    await page.unroute('**/api/v1/prefs/recordPlace');
    await page.getByTestId('project-switch').click();
    await page.getByTestId(`project-${BIBLE}`).getByRole('button', { name: /Titus/ }).click();
    await page.getByTestId('check-progress').waitFor();
    assert.equal(await page.getByTestId('open-translationNotes').count(), 0, 'the same tool, no picker');
  });
});

browserTest('resume_into_a_tool_that_is_not_ready_shows_the_picker_and_its_fix', async () => {
  await withApp(async ({ page }) => {
    await openProject(page);
    await page.getByRole('tab', { name: 'Check' }).click();
    await page.getByTestId('open-translationNotes').click();
    await page.getByTestId('check-progress').waitFor();
    await page.getByTestId('project-switch').click();
    await page.getByTestId(`project-${BIBLE}`).waitFor();
    // The place kept says Translation Notes; its pins went missing meanwhile (the sample
    // lacks Translation Words' es-419 resource, so the open asks for that tool).
    await page.route('**/api/v1/check/open', (route) => {
      const body = route.request().postDataJSON();
      body.list.tool = 'translationWords';
      return route.continue({ postData: JSON.stringify(body) });
    });
    await page.getByTestId(`project-${BIBLE}`).getByRole('button', { name: /Titus/ }).click();
    await page.getByTestId('fix-translationWords').waitFor();
    assert.equal(await page.getByTestId('check-error').count(), 0, 'no dead-end error');
    await page.getByTestId('preflight-translationNotes').waitFor();
  });
});

// INV-ONE-CHECK-BACK-CONTROL (#854): in every checking tool, "← All checking tools" reads as a
// bordered small button (>= 30 px, matching Next), sits at the top of the rail (top right in RTL)
// without scrolling at 1280x800, is reachable by keyboard, and leaves "← Back to translating".
browserTest('j4_the_way_back_to_all_checking_tools_reads_as_a_button_in_every_tool_ltr_and_rtl', async () => {
  await withApp(async ({ page }) => {
    assert.deepEqual(page.viewportSize(), { width: 1280, height: 800 });
    await openProject(page);
    await page.getByRole('tab', { name: 'Check' }).click();
    await page.getByTestId('preflight-translationNotes').waitFor();

    const openTool = async (id) => {
      await page.getByTestId(`open-${id}`).click();
      if (id === 'align') await page.getByTestId('align-rail-progress').waitFor();
      else if (id === 'community-checking') await page.getByTestId('export-menu-trigger').waitFor();
      else await page.getByTestId('check-progress').waitFor();
    };

    const measureBack = async (label) => {
      const back = page.getByRole('button', { name: label, exact: true });
      await back.waitFor();
      const metrics = await back.evaluate((el) => {
        const box = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const aside = el.closest('aside')?.getBoundingClientRect() ?? null;
        return {
          testid: el.dataset.testid ?? null,
          tabIndex: el.tabIndex,
          dataI: el.dataset.i ?? null,
          dataTone: el.dataset.tone ?? null,
          height: box.height,
          top: box.top,
          bottom: box.bottom,
          left: box.left,
          right: box.right,
          borderTopWidth: cs.borderTopWidth,
          borderTopStyle: cs.borderTopStyle,
          borderTopColor: cs.borderTopColor,
          backgroundColor: cs.backgroundColor,
          asideTop: aside?.top ?? null,
          asideLeft: aside?.left ?? null,
          asideRight: aside?.right ?? null,
        };
      });
      return { back, metrics };
    };

    const ar = catalog('ar');
    const tools = ['translationNotes', 'translationWords', 'align', 'community-checking'];
    let reference = null;

    for (const id of tools) {
      await openTool(id);
      const { back, metrics } = await measureBack(en['check.back']);
      assert.equal(metrics.testid, 'check-back', `${id}: shared data-testid`);
      assert.equal(metrics.tabIndex, 0, `${id}: reachable with Tab`);
      assert.equal(metrics.dataI, 'quiet', `${id}: design-system Secondary button`);
      assert.equal(metrics.dataTone, 'neutral', `${id}: neutral tone`);
      assert.ok(metrics.height >= 30, `INV-ONE-CHECK-BACK-CONTROL: ${id} back height ${metrics.height} < 30 px`);
      assert.ok(
        parseFloat(metrics.borderTopWidth) >= 1 && metrics.borderTopStyle === 'solid',
        `INV-ONE-CHECK-BACK-CONTROL: ${id} back has a visible border (${metrics.borderTopWidth} ${metrics.borderTopStyle})`,
      );
      if (id === 'translationNotes') {
        const nextBox = await page.getByTestId('check-next').boundingBox();
        assert.ok(nextBox && Math.abs(metrics.height - nextBox.height) < 1, `back height ${metrics.height} matches Next ${nextBox?.height}`);
        reference = metrics;
      } else {
        assert.equal(metrics.height, reference.height, `${id}: same height as translationNotes`);
        assert.equal(metrics.borderTopWidth, reference.borderTopWidth, `${id}: same border width`);
        assert.equal(metrics.borderTopColor, reference.borderTopColor, `${id}: same border color`);
        assert.equal(metrics.backgroundColor, reference.backgroundColor, `${id}: same background fill`);
      }
      assert.ok(metrics.top >= 0 && metrics.bottom <= 800 && metrics.left >= 0 && metrics.right <= 1280, `${id}: visible without scrolling at 1280x800`);
      assert.ok(metrics.asideTop !== null && metrics.top - metrics.asideTop <= 30, `${id}: at the top of the rail`);
      assert.ok(metrics.asideLeft !== null && metrics.left - metrics.asideLeft <= 30, `${id}: at inline-start of the rail in LTR`);
      if (id !== 'community-checking') {
        const foot = page.getByRole('button', { name: en['check.backToTranslating'], exact: true });
        assert.equal(await foot.count(), 1, `${id}: keeps Back to translating`);
        const footBox = await foot.boundingBox();
        assert.ok(footBox && footBox.y > metrics.bottom, `${id}: Back to translating stays at the rail's foot`);
      }

      await back.focus();
      await page.keyboard.press('Tab');
      await page.keyboard.press('Shift+Tab');
      const ring = await back.evaluate((el) => {
        const cs = getComputedStyle(el);
        return document.activeElement === el && cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2;
      });
      assert.ok(ring, `${id}: shows focus ring when focused by keyboard`);
      await page.keyboard.press(id === 'translationWords' ? 'Space' : 'Enter');
      await page.getByTestId('preflight-translationNotes').waitFor();
    }

    await applyLanguage(page, 'ar');
    for (const id of tools) {
      await openTool(id);
      const { back, metrics } = await measureBack(ar['check.back']);
      assert.ok(metrics.height >= 30, `ar ${id}: height ${metrics.height} < 30 px`);
      assert.ok(parseFloat(metrics.borderTopWidth) >= 1 && metrics.borderTopStyle === 'solid', `ar ${id}: bordered`);
      assert.ok(metrics.top >= 0 && metrics.bottom <= 800 && metrics.left >= 0 && metrics.right <= 1280, `ar ${id}: visible without scrolling at 1280x800`);
      assert.ok(metrics.asideTop !== null && metrics.top - metrics.asideTop <= 30, `ar ${id}: at top of rail`);
      assert.ok(metrics.asideRight !== null && metrics.asideRight - metrics.right <= 30, `ar ${id}: at top right of rail in RTL`);
      if (id !== 'community-checking') {
        assert.ok(1280 - metrics.right <= 40, `ar ${id}: at top right of 1280x800 window`);
      }
      await back.focus();
      await page.keyboard.press('Enter');
      await page.getByTestId('preflight-translationNotes').waitFor();
    }
  }, { scenario: 'en-pins' });
});

// INV-CHECK-TAB-LEADS-TO-TOOLS (#854): pressing the Check tab inside translationNotes or
// Translation Words closes the tool through All checking tools; switching from Understand or
// Translate keeps the open tool, and pressing Check on the tools list changes nothing.
browserTest('j4_the_check_tab_closes_an_open_tool_and_translate_back_to_check_keeps_it', async () => {
  await withApp(async ({ page }) => {
    await openProject(page);
    const tab = (name) => page.getByTestId('mode-switch').getByRole('tab', { name, exact: true });
    await tab(en['nav.check']).click();
    await page.getByTestId('preflight-translationNotes').waitFor();

    // Check tab while the tools list shows changes nothing.
    await tab(en['nav.check']).click();
    await page.getByTestId('preflight-translationNotes').waitFor();

    // translationNotes: Translate -> Check keeps it open; Check -> Check shows the tools list.
    await page.getByTestId('open-translationNotes').click();
    await page.getByTestId('check-progress').waitFor();
    await tab(en['nav.draft']).click();
    await until('Translate tab is selected', async () => (await tab(en['nav.draft']).getAttribute('aria-selected')) === 'true');
    await tab(en['nav.check']).click();
    await page.getByTestId('check-progress').waitFor();
    assert.equal(await page.getByTestId('open-translationNotes').count(), 0, 'returning from Translate keeps translationNotes open');
    await tab(en['nav.check']).click();
    await page.getByTestId('open-translationNotes').waitFor({ timeout: 5_000 }).catch(() => {
      throw new Error('INV-CHECK-TAB-LEADS-TO-TOOLS: Check tab inside translationNotes shows All checking tools');
    });
    assert.equal(await page.getByTestId('check-progress').count(), 0);

    // translationWords: Understand -> Check keeps it open; Check -> Check shows the tools list.
    await page.getByTestId('open-translationWords').click();
    await page.getByTestId('check-progress').waitFor();
    await tab(en['nav.understand']).click();
    await page.getByTestId('understand-unit-s1').waitFor();
    await tab(en['nav.check']).click();
    await page.getByTestId('check-progress').waitFor();
    assert.equal(await page.getByTestId('open-translationWords').count(), 0, 'returning from Understand keeps translationWords open');
    await tab(en['nav.check']).click();
    await page.getByTestId('open-translationWords').waitFor({ timeout: 5_000 }).catch(() => {
      throw new Error('INV-CHECK-TAB-LEADS-TO-TOOLS: Check tab inside translationWords shows All checking tools');
    });
    assert.equal(await page.getByTestId('check-progress').count(), 0);

    // Community Checking keeps working as today: Check tab leads back to the tools list.
    await page.getByTestId('open-community-checking').click();
    await page.getByTestId('export-menu-trigger').waitFor();
    await tab(en['nav.check']).click();
    await page.getByTestId('community-checking-card').waitFor();
    assert.equal(await page.getByTestId('community-checking').count(), 0);
  }, { scenario: 'en-pins' });
});
