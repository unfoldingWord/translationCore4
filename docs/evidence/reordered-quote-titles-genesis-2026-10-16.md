# Genesis check titles for a quote in a different word order: rig witness (issue #773)

**Date:** 2026-10-16. **Machine:** macOS (Darwin 25.5.0). **Client:** branch
`issue-773-fallback-tightest-run` at `ca7616a`, Vite dev server on port 5273. **Rig:** the dev
rig of the same worktree on port 19873, `pkg_version` 0.18.15, seeded by
`dev-env/scripts/seed.zsh`. **Resources:** the seed's sideloaded v91 pins: en_tn
`e586762e330f482a60c52aedd1c7b3a2f155df8a`, en_ult `35d215957f3203fd2e2fac5702ce14902d417f9d`.

## Method

1. Home, project "Equipo Ejemplo — Tito y Jonás", Add a book, Start a blank book, Genesis,
   Create book. The project then holds a blank Genesis with the English pins.
2. Check, Translation Notes. The list has 2224 rows.
3. The rows mix3 (33:5), gyfv (24:48) and r2u9 (9:11) were opened. The row text and the text
   of every `[data-testid=ult-hl]` mark in the ULT pane were read.

A Playwright scenario of the local verify skill did these steps (`result.txt`: `PASS (exit 0)`).
The rig and client doctors confirmed that the rig and the client served this worktree.

## Result

| Row | Title on `main` (issue #773) | Title on this branch | ULT-pane marks on this branch |
|---|---|---|---|
| Gen 33:5 mix3 | “his eyes … the women … whom God has graciously given to your servant” | “whom God has graciously given to your servant” | whom God has graciously given to your servant |
| Gen 24:48 gyfv | “Yahweh … the daughter of my master s brother” | “the daughter of my master s brother” | the daughter of my master s brother |
| Gen 9:11 r2u9 | “that never again will all flesh be cut off … and never” | “that never again will all flesh be cut off” | that never again will all flesh be cut off |

The `main` titles are from the issue [VERIFIED — in the app on the dev rig, `3722be2`,
2026-10-16]. They were not seen again in the app for this record.

Screenshot: `reordered-quote-tn-gen-33-5-2026-10-16.jpg`, mix3 open. The ULT pane marks only
the phrase. "his eyes" and "the women" are not marked.

## Limits

- One machine, one browser (Playwright Chromium), the dev rig, not a packaged build.
- English gateway only. The original-language pane showed "The original-language text is not
  on this computer", because the rig does not sideload `hbo_uhb` v3.0.0. The titles and the
  ULT highlight read only the ULT alignment.
- The marks were read for the three rows named above, not for every row.
