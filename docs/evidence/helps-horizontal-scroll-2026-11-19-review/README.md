# Loaded helps evidence after review, 2026-11-19

Independent review of PR #1065 at 1a93dc3a found that the earlier Translate pre-click
measurement accepted a hidden panel: all extents were zero, and the screenshot showed the
loading message. That earlier record is preserved in the sibling
`helps-horizontal-scroll-2026-11-19` folder. Its post-click, focus and resize checks used
loaded cards; only the Translate pre-click record was invalid.

The journey now waits for Translate's drafting control and its visible note before measuring.
Every panel, tabs and list measurement must have positive width and height. A negative control
hid the loaded panel before its first measurement; the new check rejected it with
`INV-HELPS-MEASURE-VISIBLE: before-click, panel: {"width":0,"scrollWidth":0,"height":0,"scrollHeight":0}`
(`before-guard.tap`). The temporary mutation was removed.

With the loaded-note wait and positive-size check, both journeys pass (`after.tap`). The two
extent JSON files contain the full action sequence, with nonzero measurements throughout.
The first Translate panel, tabs and list each measure 339 px client width and 339 px scroll
width. `Translate-before.png` was inspected: it shows the note cards before any card click.

Run: `node --test parity/app/journeys/helps-scroll.test.mjs` with the same backend, built UI,
installed Chromium and `en-pins` setup described in the earlier evidence. No product code
changed in this follow-up. This correction does not reproduce or close the original
default-width symptom in #993.
