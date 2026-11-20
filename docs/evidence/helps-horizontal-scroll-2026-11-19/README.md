# Helps horizontal overflow, 2026-11-19

Issue #993, Windows, Chromium 141 (installed Playwright Chromium 1194), 1280 × 800.
Base: ad03da85. Scenario: `en-pins`, Titus 1, Understand and Translate.

The default-width card click did not reproduce horizontal overflow. The proposed focus-ring
cause was not confirmed. The supported 280 px divider width did reproduce overflow on Translate:
Words cards and their list fit (279 px client and scroll width), but the unwrapped tabs pushed
the panel to 337 px scroll width. `Translate-280-before-fix.png` shows this run on the base build.
`before.tap` records the regression failing with `INV-HELPS-NO-SPURIOUS-X-SCROLL` at that width.

The fix allows only the helps Switcher to wrap. The same journey passes afterwards (`after.tap`).
`Understand-extents.json` and `Translate-extents.json` record the panel, tabs and list after
each action. The PNGs show the default width before clicking, keyboard focus, and divider
widths 480, 280 and 340. The whole blue focus ring is visible in each `*-focused.png`.
The tabs remain visible at the narrow width, and no horizontal clipping was added.

The journey also clicks Show more, both article links and empty list padding, scrolls the real
chapter vertically, and clicks a question. This scenario has no Bible tQ installed: the two
question rows come from the real OBS tQ TSV fixture and enter through a ready passage response,
using the same question renderer. At 280 px, a real Notes article label is genuinely wider;
`*-wide-content.png` and the final extent record show that horizontal scrolling still works.
These are browser observations; no desktop-shell run was made.

Run from the issue worktree with `TC4_BIN=target/debug/tc4.exe`, `TC4_UI=target/tc-ui-app`,
and Playwright configured, after building the backend with `test-hooks,fixture-backend` and
the UI with `crates/tc-ui/build-app.sh`:

```text
TC4_EVIDENCE=<output-folder> node --test parity/app/journeys/helps-scroll.test.mjs
```

Locally, the installed Chromium executable was selected by an ignored preload in `target/`,
because the installed Playwright module expects a newer browser that is absent. No download
was needed. Screenshots and measured extents were inspected after the successful run.

The complete local gate did not pass. `native-gate-summary.txt` captures its native failures
and timeouts. To compare the two assertion/error failures, the only changed product file was
temporarily restored from `origin/main`, the two tests ran at one thread, and the fixed file
was restored afterwards. Both failures reproduced (`native-baseline.log`): the feedback test
expects forward slashes while Windows returns `~\translationCore4\projects`; the export test
cannot remove a fixture file because part of it is locked (Windows error 33). No native core
source changed in this PR. The other native timeouts were not rerun individually.

The cross-Windows lint cannot start without MinGW/NASM; the same gate script from `origin/main`
reports the same missing tools (`windows-tools-baseline.log`). The UI journeys were rerun with
the official journeys gate after releasing an executable held by a concurrent test. That gate
passed without skips (`after.tap`). The additional existing screen journeys all passed across
their initial run and isolated retries: the story figure-sort case had timed out, and the
300 ms open-overlay case had failed while the full gate was loading the machine. Neither
needed a code change.
