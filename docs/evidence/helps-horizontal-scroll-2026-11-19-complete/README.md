# Helps and small-window layout — 2026-11-19

Issue #993, PR #1065. This record completes the earlier minimum-width tab fix.
The owner supplied a 500 px screenshot with a missing passage, clipped helps and
overlapping header controls. The original focus-outline hypothesis did not reproduce.

## Before

The new `helps-window.test.mjs` cases failed on the published partial fix
(`1cb11625`). All four Bible/story Understand/Translate cases reached a passage
only 10 px wide in a 960 px window with 720 px helps (`before-960.tap`).
At the default 340 px helps width in a 500 px window, Translate's passage was
0 px wide, helps extended to x=516, and focusing/scrolling into the clipped view
shifted the brand to x=-38 (`before-500.tap`, `before-default-500.png`). The
list itself measured 339 px client width and 339 px scroll width. Fitting text
was therefore insufficient: the surrounding fixed-width layout did not fit.

## Change and after

The shared reading workspace stacks its existing rail, passage and helps below
1280 px. The header uses two rows at 800 px or below. Source and translation
use one column at 640 px or below. No control is hidden. The default helps width
remains 340 px; an explicitly dragged width is capped by the available space and
returns when the window grows. The earlier wrapped tabs and original focus ring
remain in use. Wide card content still has horizontal scrolling.

`measurements.json` contains every final window capture and the failed default
500 px measurement. In the final default-width Bible Translate click capture,
the passage is 500 px wide, helps end at x=500, and the list still measures
339/339 px. Header rectangles fit without overlap.

`window-after.tap` records six passing headless cases: Bible and story in both
modes, plus French and Arabic controls. They check 1280, 960 and 500 px windows,
340 and 720 px requested helps widths, restoring the requested width, a 280 px
divider drag while narrow, chapter/frame navigation, hiding/showing helps, and
real wheel scrolling of the stacked workspace. Both Translate cases edit and
save existing text in the small window, and the rig validates the resulting
Scripture Burritos.

`helps-after.tap` records both passing click/focus/scroll cases, including the
new 500 px note, Show more, Questions, Words and article interactions. The
existing checks still cover the full keyboard focus ring, both article kinds,
empty-list clicks, vertical wheel scrolling and genuinely wide content.
The questions renderer uses the existing OBS TSV fixture because `en-pins`
has no Bible questions resource; it does not download or invent questions.

All runs used isolated projects, `target/test-rig/tc4.exe` and the new UI build
in `target/tc-ui-next`, with headless Chromium 141.0.7390.37. No user screen or
foreground browser was used. The screenshots are test-page captures.

Selected screenshots show the default 500 px fix, the widest helps at 960 px,
saved Bible/story text, an Arabic header and the small-window article. They
were visually inspected. Earlier dated evidence remains unchanged.
