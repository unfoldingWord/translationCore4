# Genesis check titles with a maqaf quote: rig witness (issue #765)

**Date:** 2026-10-16. **Machine:** Windows 11 Pro 10.0.26200. **Client:** branch
`issue-765-maqaf-quotes` at `5db0e70`, Vite dev server on port 5190. **Rig:** the dev rig on
port 19990, `pkg_version` 0.18.15, seeded by `dev-env/scripts/seed.zsh`. **Resources:** the
seed's sideloaded v91 pins: en_tn `e586762e330f482a60c52aedd1c7b3a2f155df8a`, en_twl
`7cbb3419f79780ce84b92ad7d42bd476cc5d8a64`, en_ult `35d215957f3203fd2e2fac5702ce14902d417f9d`.

## Method

1. Home, project "Equipo Ejemplo — Tito y Jonás", Add a book, Start a blank book, Genesis,
   Create book. The project then holds a blank Genesis with the English pins.
2. Check, Translation Notes, Start checking. Sort: By verse (the default).
3. In the browser console, the list was counted:
   `[...document.querySelectorAll('[data-testid=check-list] button')]`, and the rows whose
   text matches `/\p{Script=Hebrew}/u`.
4. The rows xxe6 and xfx7 were opened. The text of every `[data-testid=ult-hl]` mark in the
   ULT pane was read.
5. The same for Translation Words, row vzz2.

## Result

| Tool | List rows | Rows with Hebrew text | Row | Title | ULT-pane marks |
|---|---|---|---|---|---|
| Translation Notes | 2224 | 0 | Gen 1:5 xxe6 | “Then there was evening and there was morning” | Then there was evening and there was morning |
| Translation Notes | | | Gen 1:7 xfx7 | “And it was so” | And it was so |
| Translation Notes | | | Gen 1:5 c9yz | “And God called” | not opened |
| Translation Notes | | | Gen 1:5 xmx5 | “one day” | not opened |
| Translation Words | 5640 | 0 | Gen 1:28 vzz2 | “the earth” | the earth |

Screenshots:

- `maqaf-titles-tn-gen-1-5-2026-10-16.jpg`: xxe6 open, and the list from 1:1 to 1:8 in English.
- `maqaf-titles-tw-gen-1-28-2026-10-16.jpg`: vzz2 open.

Before the fix, on the same pins, a harness over the same derivation (`deriveTnItems` /
`deriveTwlItems` + `glTitleFor`) counted 95 tN and 260 tW Genesis items with no gateway
title. Every one of them had a maqaf in its quote. The harness was not committed. Issue #765
reports the same 95 on rc.2 (`52e03ba`, packaged Linux).

## Limits

- One machine, one browser (the Claude desktop app's built-in Chromium), the dev rig, not a
  packaged build.
- English gateway only. The original-language pane showed "The original-language text is not
  on this computer", because the rig does not sideload `hbo_uhb` v3.0.0. The titles and the
  ULT highlight read only the ULT alignment.
- The marks were read for the three rows named above, not for every row.
