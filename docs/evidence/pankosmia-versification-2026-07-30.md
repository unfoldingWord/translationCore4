# Evidence: how Pankosmia implements versification and passage sets — 2026-07-30

**Trigger:** the project owner remembered that Pankosmia already handles versification and
permits non-contiguous passage sets. Both points are correct. This file records the mechanism,
so that tC4 adopts it and does not invent a new one. It replaces the pessimistic view in the
first draft of OPEN-QUESTIONS #26.

**Method:** source reads of `upstream/pankosmia-web` at `origin/main` (**0.18.4**), and reads
of the supplied scheme files and client bundles in `dev-env/app-resources/`.

⚠ **Process finding:** the local mirror was pinned at `68e480d` (**0.16.18**), and it was **15
commits behind** `origin/main`. The newest relevant work (translation-plan scope) has the date
2026-07-29, and it was not visible until a `git fetch`. **Fetch the mirror before you make any
platform claim.** An old mirror looks exactly like an absent feature.

## 1. Versification data — full, shipped, six schemes

The scheme files are at `app-resources/templates/content_templates/vrs/<scheme>.json`. They use
the standard vrs-to-JSON shape: `maxVerses`, `mappedVerses`, `excludedVerses`, `partialVerses`.

| scheme | books | mappedVerses | excludedVerses | partialVerses |
|---|---|---|---|---|
| eng | 92 | 265 | 0 | 0 |
| lxx | 89 | 267 | 0 | 74 |
| org | 95 | 8 | 0 | 0 |
| rsc | 66 | 231 | 0 | 0 |
| rso | 79 | 374 | 0 | 0 |
| vul | 86 | 475 | 0 | 0 |

`mappedVerses` is a true mapping table, and it is **range-capable**. 126 of the 265 eng entries
are ranges (`"GEN 32:1-32": "GEN 32:2-33"`, `"EXO 8:1-4": "EXO 7:26-29"`). org has cross-book
range mappings (`"S3Y 1:1-29": "DAG 3:24-52"`). `lxx` uses `partialVerses` (74 entries). This
data makes it possible to implement the D24(c) storage-frame ruling. A table controls the
mapping between frames, and tC4 does not have to derive it.

## 2. Server role — scheme provider and scaffolder, not converter

[VERIFIED at 0.18.4; these files are **unchanged** between 0.16.18 and 0.18.4]

- `GET /content-utils/versifications` → array of scheme names (from the vrs directory listing).
- `GET /content-utils/versification/<name>` → that scheme as JSON.
- At creation, `new_text_translation`, `new_bcv_resource`, `new_translation_plan_resource`, and
  `new_audio_translation` each require a `versification` field.
- `new_text_translation.rs` writes the whole chosen scheme into the project as
  **`ingredients/vrs.json`** and registers it in `metadata.json`.
- `new_scripture_book.rs` reads `maxVerses` from the project's own scheme to scaffold
  chapters and verses.
- `utils/bcv_ref.rs::canonical_book_codes` still reads a **hardcoded `eng.json`** at 0.18.4.
  The canonical book-code list comes from eng, whatever the project's scheme is. This is the
  one eng assumption in the server. It controls which filenames get a `scope` in the metadata,
  because `ingredients_metadata_from_files` compares basenames against that list.
- **No conversion code exists server-side.** The server stores and serves schemes. It never
  maps a reference.

## 3. Conversion — client-side, via Proskomma

[VERIFIED 2026-07-27, `OPEN-QUESTIONS #26`] The bundled clients (text-translation handler,
workspace, PDF publisher) include the Proskomma versification toolkit: `mapVerse`,
`succinctifyVerseMapping(s)`, `unsuccinctifyVerseMapping`, `preSuccinctVerseMapping`, and
`bookCodeIndex`. They use `verseMapping.forward` / `reversed` in the document query path.

## 4. Non-contiguous passage sets — CONFIRMED, two layers

**a. Translation plans (`x-translationplan` flavor).** The template
`content_templates/x-translationplan/plan.json` carries `versification`,
`sectionStructure`, `fieldInitialValues`, and `sections`. Each section names a `bookCode`.
A plan is an ordered list of sections. Therefore a plan can cover any selection of material,
including parts that are not adjacent. **New at 0.18.4** (`ede5122`, Mark Howe, 2026-07-29,
"find metadata scope from translation plan"): `new_translation_plan_resource.rs` now finds the
burrito's metadata `scope` from the plan. It collects the `bookCode` of each section into a
`BTreeSet` and writes `"<BOOK>": {}` entries. Before this commit, the server wrote an empty
scope.

**b. Section `bcvRange` + the `bcvWrapper` type (PDF publisher).** Each section that the
publisher renders carries a `bcvRange`, which is a book-chapter-verse range. A section without
a `bcvRange` is an error. The `bcvWrapper` section type holds an **array** `ranges`, and it
repeats every section across every range. This is an explicit non-contiguous passage set: a
document has N ranges of any kind, and the same section structure renders each range.

## 5. Consequences for tC4

- Do not design a versification mapper. Use the supplied scheme files and the Proskomma
  mapping, exactly as the other clients do.
- The spec must still model **`ingredients/vrs.json`** (§26a). Every project that the platform
  creates contains this file, and the harness did not see it before.
- Record the D24(c) frame rule (refs stored in the project's chosen versification) in
  BURRITO-SPEC §5.2. Add the harness check in the same commit (§9).
- **Passage sets are a platform concept, not a tC4 invention.** The native form is a
  translation plan with a `bookCode`/range for each section, or the range-array `scope` form
  of SB. **[decided 2026-07-30]** Passage sets are a minor UI option, and whole books stay the
  default path. But the architecture and the data model MUST be passage-set capable from the
  start. The necessary changes go with the `vrs.json` spec edit, and the harness changes go in
  the same commit:
  1. **BURRITO-SPEC §3 rule 4** now mandates `currentScope` as one key per book with an
     empty array (`{"TIT": [], "JON": []}`). **Rule 5** mandates the ingredient `scope` as
     `{"<BOOK>": []}`. Both MUSTs must become wider and permit the SB range-array form
     (`{"TIT": ["1:1-2:5"]}`). They must keep `[]` (whole book) as the default and common case.
  2. **Progress** (§5.2 / ARCHITECTURE §3.3, `progress = decided ÷ derived-total`) must take
     its denominator from the project's scope, not from the whole book.
  3. **Derive** must filter check items to the scope, so out-of-scope items are never counted
     or shown.
  4. A **partially populated book file is legal**. Drafting, checking, and publish must not
     assume that a book file covers the whole book.
- Know about the eng-hardcoded `canonical_book_codes` before you scaffold a non-eng project.
  A book file with a basename outside the eng canon gets no `scope` entry.
  **[decided 2026-07-30]** Non-canonical books are not allowed at this time. Therefore this is
  an accepted constraint, and it is not a defect to route upstream.
