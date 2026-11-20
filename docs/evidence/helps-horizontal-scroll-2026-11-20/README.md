# Fitting helps without horizontal overflow — 2026-11-20

Issue #993, PR #1065. The final product change is one local `flex-wrap: wrap`
on the helps Switcher. The window-layout experiment in `fbf66ec6` was withdrawn
at the owner's request. Its record remains in that commit; neither its responsive
layout nor its window tests form part of the final change.

This record adds a default-width reproduction to the earlier 280 px evidence.
It supersedes the earlier partial-scope conclusion, not the historical measurements.

## Reproduction and result

Both UI builds use the current merged main. For the before build, only
`helps_panel.rs` was restored from `origin/main`; it has the original single-row
Switcher. The after build contains only the local wrapping change. No runtime
CSS mutation or changed viewport was used to manufacture the failure.

The `en-pins` sample with the French interface reproduces the defect at the default
340 px helps width in Translate. Before and after a real Words card click, the
list measures 339/339 px client/scroll width: the card fits. The panel and tabs
measure 339/350 px. The tabs, not the card or its outline, extend beyond the pane.
The before test fails after the click, with `fr-Translate-340-word-click`.

After wrapping the tabs, panel, tabs and list all measure 339/339 px after the same
click. The Comments tab moves to the next row inside the helps pane. The book rail,
passage columns and header keep their original layout. See `fr-default-before.png`
and `fr-default-after.png`.

The same before run fails in English Translate at 280 px (279/337 px panel) and
Arabic Translate at 280 px after the word click (279/302 px panel). All six final
English/French/Arabic Understand/Translate cases pass, with zero skips.
`before.tap`, `after.tap` and `measurements.jsonl` hold the captured results.
The outline hypothesis was not observed; this fix removes the measured tab overflow.

## Acceptance checks

| Criterion | Proof |
| --- | --- |
| Fitting note, word and question clicks | Both English mode cases measure pane, tabs and list after each kind; four translated cases also check Words clicks. |
| Tabs, Show more, article and empty-list clicks | Both English cases exercise each action, including Academy and Words articles; translated cases check Questions tabs and Words articles at each width. |
| Vertical scrolling without horizontal overflow | Actual vertical wheel input moves the taller list, followed by measured horizontal extents. |
| Unclipped focus ring | Keyboard modality activates the original outline; its complete bounds fit inside the list. `focus-ring.png` shows the result. |
| Divider resizing | English cases drag to 480/280/340 px; translated cases drag to 340/280/480/340 px with the appropriate pointer direction in RTL. |
| Genuinely wide content may still scroll | A real unwrapped Notes label exceeds 280 px; horizontal wheel input still changes the list's position. |

The original question renderer check uses the existing OBS TSV fixture through
the passage response, because `en-pins` has no Bible questions resource. No network
resource is downloaded. The rig validates the resulting Scripture Burritos.

All browser runs are headless and use isolated sample projects, the copied
`target/test-rig/tc4.exe`, and Chromium 141.0.7390.37. The two UI build identifiers
are `e7b587e9d58f27cd` (before) and `fb665dba27958147` (after). The screenshot pairs
and full focus ring were visually inspected. The user's screen was not captured.
