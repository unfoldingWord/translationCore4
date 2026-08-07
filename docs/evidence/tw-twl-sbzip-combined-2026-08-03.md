# Evidence: the DCS sb-zip export of `en_tw` is ITSELF the combined TW+TWL artifact

**Date:** 2026-08-03 · **Method:** live rig (`pankosmia-web 0.18.5`, `99fd9be`) +
direct sb-zip fetch from git.door43.org. Affects **D32** (OPEN-QUESTIONS #29) and the
§5.3 `translationWordsLinks` slot.

## What was measured

**1. The RC catalog lists tw and twl as separate repos with different flavors**
[VERIFIED — `GET /api/gitea/remote-repos/git.door43.org/unfoldingword` on the rig,
66 repos, 17 carrying the `tc-ready` topic]:

| repo | flavor | book_codes | tag |
|---|---|---|---|
| `en_tw` | `peripheral/x-peripheralArticles` | 1 | master |
| `en_twl` | `parascriptural/x-bcvarticles` | 66 | master |
| `en_tn` | `parascriptural/x-bcvnotes` | 66 | master |
| `en_ta` | `peripheral/x-peripheralArticles` | 4 | master |

**2. But the sb-zip EXPORT of `en_tw` v87 is the combined form** [VERIFIED — fetched and
unzipped 2026-08-03; export metadata revision `eaeb7bfefcf84132d0cbcbed185f3ea2be3d86dd`]:

- declares `parascriptural/x-bcvarticles` (NOT the catalog's peripheral flavor);
- 1026 files: **66 per-book TWL TSVs** (`ingredients/<BOOK>.tsv`, header
  `Reference/ID/Tags/OrigWords/Occurrence/TWLink`) **+ 954 articles** under
  `ingredients/payload/kt|names|other/`;
- its TWLink column uses **repo-relative** links (`./payload/names/seth.md`), not the
  `rc://*/tw/dict/bible/...` form.

**3. The `en_twl` sb-zip export is links-only** [VERIFIED 2026-07-31]: `ingredients/<BOOK>.tsv`
only, no articles.

**⚠ CORRECTION (2026-08-03, same day).** This record first stated that the `en_twl` export
"uses `rc://` TWLinks". **That was wrong, and it was asserted without being checked** — an
untagged assumption written as [VERIFIED]. Measured directly:

| Source | TWLink form |
|---|---|
| `unfoldingWord/en_twl` **RC master branch**, `twl_TIT.tsv` | `rc://*/tw/dict/bible/names/paul` |
| `unfoldingWord/en_twl` **sb-zip export** v86, `TIT.tsv` | `./payload/names/paul.md` (188/188 rows) |
| `unfoldingWord/en_tw` **sb-zip export** v87, `TIT.tsv` | `./payload/names/paul.md` (182/182 rows) |

So **every sb-zip export uses repo-relative links** — `go-rc2sb` rewrites the RC `rc://` form
on conversion. The `rc://` form appears only in the RC source branches, which tC4 never
fetches (D23b pins the export). The "readers MUST accept both forms" rule still stands, but
its reason changed: the second form comes from **RC sources and tC3-era stored decisions**,
not from a standalone `_twl` export. Downstream fixes applied in the same change set:
BURRITO-SPEC §5.3's attribution, STATE.md D34's closing note, and the derive test, which now
asserts that BOTH exports are relative and pins the rc:// case to a synthetic row.

## Consequence — D32's rationale needs an owner amendment

D32 (2026-07-31) ruled "import SEPARATE burritos via sb-zip; no post-pull combining step",
reasoning that the combined form was a convention of the `uw` content org. That premise is
now only half right: **DCS's own `go-rc2sb` converter produces the combined artifact** when
exporting `en_tw`. Pankosmia's `uw/en_tw` is a published copy of that output, not a
Pankosmia invention.

What this does NOT change:
- No combining step is ever needed on our side — correct either way, which is D32's
  operative instruction.
- The §5.3 two-slot schema still represents both worlds: both slots MAY name the same repo
  at the same version (already normative in §5.3, added 2026-07-31).

What it DOES change — the choice the owner should re-rule on:
- **(A) One pin per language for tW** — pin `<lang>_tw` and fetch its sb-zip; it carries
  links + articles together, with internal relative links. Fewer fetches; matches what
  Pankosmia's own client consumes; `translationWordsLinks` and `translationWords` name the
  SAME repo.
- **(B) Two pins** — `<lang>_twl` (rc:// links) + `<lang>_tw` (articles), accepting that
  the en_tw fetch also drags in a duplicate copy of the TSVs we would then ignore.

(A) is now the lower-friction path on the evidence; (B) keeps provenance split per tool
input. **This is a product-truth decision — not taken here.** Filed as OPEN-QUESTIONS #30.

## Incidental corrections this turn

- `resources.json` (product writer) recorded `en_tw` as `parascriptural/x-bcvarticles`.
  The sb-zip export agrees; the RC catalog says `peripheral/x-peripheralArticles`. The
  export is the pin target (D23b), so the recorded flavor is right — but the two sources
  disagree and readers MUST NOT treat the catalog flavor as the pin's flavor.
- The rig ships **net-disabled** (`NET_IS_ENABLED` defaults false); `POST /api/net/enable`
  turns it on and the gitea endpoints return `{"is_good":false,"reason":"offline mode"}`
  until it does. That is the real offline gate D30.4/D30.5 must read.
- The catalog's `book_codes` field gives **per-repo book coverage directly from the
  platform** — the `Coverage` input `resolve.ts` needs, with no TSV scanning.
