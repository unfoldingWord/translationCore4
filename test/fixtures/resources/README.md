# Vendored resource fixtures (derive-at-full-strength — OPEN-QUESTIONS #15)

Real one-book slices of published Door43 resources, cut from the DCS **sb-zip
export** of each pinned release (the pin path decided in OPEN-QUESTIONS #24).
Fetched 2026-08-03. Do not edit these files — refetch to update, and record the
new provenance here.

Each directory is `<repo>@<tag>/` and contains the slice plus the export's own
`metadata.json` **unmodified**. The metadata is the authoritative provenance:
`identification.primary.dcs[...].revision` is the tag's commit SHA, verified
against the project pins by the test suite. This README adds only what the
metadata cannot say: the fetch date, the pin slot each fixture serves, and the
fact that these are one-book slices of the full export.

| Directory | Source (sb-zip) | Tag commit SHA (from export metadata) | Pin slot served |
|---|---|---|---|
| `en_tn@v86/` | `git.door43.org/unfoldingWord/en_tn/sb/v86.zip` | `c354b8ae66a23c485bf6f38fd35bd8f7ef81e4e5` | fallback `translationNotes` |
| `en_twl@v86/` | `git.door43.org/unfoldingWord/en_twl/sb/v86.zip` | `570e76d0024c847689e48a20e2ac1a1d2c6eb6e3` | fallback `translationWordsLinks` |
| `es-419_tn@v66/` | `git.door43.org/Es-419_gl/es-419_tn/sb/v66.zip` | `22f3d0c61e2ab4701cb869547de9c3c43da07208` | primary `translationNotes` |
| `en_ta@v86/` | `git.door43.org/unfoldingWord/en_ta/sb/v86.zip` | `c7caddfb474efd713f36b35a3ffc927866c7b180` | fallback `translationAcademy` |

Slice contents (paths flattened, `ingredients/` prefix dropped, `/` → `-`):

- `*_tn/twl`: `TIT.tsv` — the whole Titus TSV, byte-identical to the export.
- `en_ta`: `translate-toc.yaml` (the translate manual's toc — the tN groupId
  target space) + one full article (`translate-figs-abstractnouns-01.md` +
  `title.md`) as the article-shape fixture.

Ground truth (counted at vendor time; the test suite asserts these):

- `en_tn@v86/TIT.tsv`: 206 data rows; 49 have no SupportReference (plain notes,
  never checks) → **157 derivable items**, 28 distinct groupIds, all 28 present
  in the tA v86 translate toc. Category distribution through the tC3 map:
  grammar 71, figures 53, culture 26, other 6, discourse 1.
- `en_twl@v86/TIT.tsv`: **188 derivable items**; TWLink categories kt 111,
  other 71, names 6.
- `es-419_tn@v66/TIT.tsv`: 216 data rows → **112 derivable items**; 89 of the
  157 en checkIds also exist in es (cross-language re-attach exercises both the
  checkId-match and the fallback-key paths on real data).

Adding a book: create the same files for the new book in each directory (same
export, same tag) and extend the suite's per-book expectations — the layout is
per-book by design (multiple books are the declared next step).
