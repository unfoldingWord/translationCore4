# tC4 Project Format Specification (BURRITO-SPEC)

**Version:** 1.7-draft · 2026-08-04 (Version 1.3 corrected the transport topology; J19–J20; journal suite → 59 checks. Version 1.4 encodes STATE decisions D25–D28: `ingredients/vrs.json` and the versification frame rule (§4.3, §5.2); scope range arrays, scope-filtered derivation, and partial-book legality (§3, §4.1, §4.2); stage rules S-1/S-2 made permanent — x-roles are non-durable by design and the client re-asserts them (§5.3, §6, §7); conformance suite → 30 checks. Version 1.5 promotes `extraScripture` gateway source pins to normative (§5.3 — D10/OPEN-QUESTIONS #13); conformance suite → 31 checks, Stage-1 27. Version 1.6 lands the D17/D30 two-language-set pin schema — §5.3 `schemaVersion` 2 with `languageSets.primary/fallback` (tn+twl+tw+tA each), the (tool, book) resolution record + cross-language re-attach rule in §5.2 (OPEN-QUESTIONS #28); conformance suite → 33 checks, Stage-1 29. Version 1.7 adds the carry-over rule (§5.2 — D36, 2026-08-04): the resource is the primary key, and a decision that neither re-attach pass can place is invalidated and retained, not queued for review; conformance suite → 34 checks, Stage-1 30.)
**Status:** Normative for Phase 1. §8 (journal + publication topology) is fully specified [PROPOSED] and tested with executable checks. The checks include the transport, end-to-end against the live server (OPEN-QUESTIONS #23 closed 2026-07-18). §8 becomes normative on ratification (OPEN-QUESTIONS #10/#16).
**Audience:** implementers (human or AI). If you are new, read PLATFORM-NOTES.md first.
**Conformance language:** MUST / MUST NOT / SHOULD / MAY per RFC 2119.
**Reference implementation:** `sample-burrito/` (a conforming project) and `sample-burrito-validation/` (34 executable conformance checks [VERIFIED 2026-08-07 — Increment-2 close: 34/34 + journal 59/59]). Both live in the maintainer workspace today; publishing them is a tracked issue. If this document and the harness disagree, the harness is wrong. The harness MUST be fixed to match this document. Then this document's version bumps.

---

## 1. Overview

A **tC4 project** is one git repository. The repository is a valid Scripture Burrito (SB) at every commit, flavor `scripture/textTranslation`. It contains:

- the translation text: one plain-USFM file per book (**canonical in Phase 1**);
- checking sidecars under `ingredients/checking/`: word alignments, check decisions, resource pins, settings;
- (Phase 2, reserved) per-actor event journals. When the journals ship, the journals become canonical, and the USFM becomes a derived, committed artifact.

The same repository syncs to DCS (Door43). Other SB tools read the same repository. The tC4 app opens the same repository. There are no companion repos, no copies, and no export/import loop.

## 2. Repository layout

```
<project>/                              git repository
  metadata.json                         SB metadata (§3)
  .gitignore                            MUST contain: **/*.bak
  ingredients/
    <BOOK>.usfm                         one per book in scope (§4.1)
    vrs.json                            role x-versification — the versification scheme (§4.3)
    checking/
      alignments/<BOOK>.json            role x-alignment        (§5.1)
      translationWords/<BOOK>.json      role x-check-decisions  (§5.2)
      translationNotes/<BOOK>.json      role x-check-decisions  (§5.2)
      translationQuestions/<BOOK>.json  reserved, post-Phase-1 only (OPEN-QUESTIONS #12); same schema as §5.2
      resources.json                    role x-resource-links   (§5.3)
      settings.json                     role x-check-settings   (§5.4)
      journal/<actorId>/<BOOK>.<seq>.jsonl      role x-journal — Phase 2 only (§8)
      journal/<actorId>/_project.<seq>.jsonl    role x-journal — Phase 2 only (§8.1)
      journal/<actorId>/actor.json              role x-journal — Phase 2 only (§8.1)
```

`<BOOK>` is the UPPERCASE 3-character USFM book code (`TIT`, `JON`, `1CO` …). Book codes MUST be in the eng canon (the platform's `canonical_book_codes` derives that list from `eng.json`; a file outside it gets no `scope` entry on rescan). Non-canonical books are not allowed at this time [decided 2026-07-30 — D26].

**Reserved: audio ingredients.** Audio-carrying projects will place audio ingredients under `ingredients/audio/` [decided 2026-07-25 — OPEN-QUESTIONS #21: reserve a slot, no behavior]. Phase 1 defines no audio behavior, and a reader MUST NOT fail when files are present under that path (they register as ordinary ingredients, like every other file).

**Server path constraints (verified in pankosmia-web `utils/paths.rs`):** An ingredient path (the `ipath`, that is, the part under `ingredients/`) MUST NOT have a segment that is empty, that starts with `.`, or that contains any of: `..  ~  \  &  *  +  |  space  ?  #  %  {  }  <  >  $  !  '`. For this reason the sidecar directory is `checking/`, not `.tc4/`.

## 3. `metadata.json`

Base `metadata.json` on Pankosmia's own textTranslation template (`resource-core/templates/content_templates/text_translation/metadata.json`). Then apply these rules:

1. `meta.category` = `"source"`; `meta.normalization` = `"NFC"`; `meta.generator.softwareName` identifies tC4.
2. `idAuthorities` MUST include `local`. It MUST also include `dcs` (`{"id": "https://git.door43.org", "name": {"en": "Door43 Content Service"}}`) when `relationships` are present.
3. `type.flavorType` = `{ name: "scripture", flavor: { name: "textTranslation", usfmVersion: "3.0", … } }`.
4. `type.flavorType.currentScope` MUST contain one key per book in the project. Each value is an array. `[]` means the whole book — the default and the common case (`{"TIT": [], "JON": []}`). A value MAY instead be an array of range strings (`{"TIT": ["1:1-2:5"]}`) — a **passage set** [decided 2026-07-30 — D26: passage sets are a minor UI option, but the format and the architecture MUST support them from the start]. The range grammar is `C`, `C-C`, `C:V`, `C:V-V`, or `C:V-C:V` (harness check: scope grammar). Multi-book is native; a project MAY hold 1–66 books.
5. `ingredients` MUST list every file under `ingredients/` (the path key includes the `ingredients/` prefix). Each entry MUST have `checksum.md5`, `size`, `mimeType` (`text/plain` for `.usfm`, `application/json` for `.json`), and `role` per §2. Each file whose basename is a book code MUST also have `scope`, with the same value grammar as rule 4 (`{"<BOOK>": []}` for a whole book; range arrays for a passage set). Entries MUST NOT contain other fields (the bundled SB `ingredient.schema.json` sets `additionalProperties: false` — verified).
6. `relationships` (Stage 2 — see §6): the resource pins expressed natively. Shapes verified against the bundled `relationship.schema.json`:

```json
"relationships": [
  {"relationType": "source",         "flavor": "textTranslation",      "id": "dcs::unfoldingWord/el-x-koine_ugnt", "revision": "v0.34"},
  {"relationType": "source",         "flavor": "textTranslation",      "id": "dcs::unfoldingWord/hbo_uhb",  "revision": "v2.1.30"},
  {"relationType": "parascriptural", "flavor": "x-bcvarticles",        "id": "dcs::unfoldingWord/en_tw",    "revision": "v87"},
  {"relationType": "parascriptural", "flavor": "x-bcvnotes",           "id": "dcs::unfoldingWord/en_tn",    "revision": "v86"},
  {"relationType": "peripheral",     "flavor": "x-peripheralArticles", "id": "dcs::unfoldingWord/en_ta",    "revision": "v86"},
  {"relationType": "peripheral",     "flavor": "x-lexicon",            "id": "dcs::unfoldingWord/en_ugl",   "revision": "v2"},
  {"relationType": "peripheral",     "flavor": "x-lexicon",            "id": "dcs::unfoldingWord/en_uhl",   "revision": "v1"}
]
```

Schema constraints (verified): `id` matches `^[0-9a-zA-Z][0-9a-zA-Z\-]{1,31}::\S+$`, with the prefix declared in `idAuthorities`. The schema's `oneOf` has two effects: original-language repos MUST use `relationType: "source"` + flavor `textTranslation`, and custom `x-` flavors MUST NOT use `relationType: "target"` (that combination matches two branches and fails validation).

The full metadata example is `sample-burrito/metadata.json`. It is schema-valid against Pankosmia's bundled schema (harness check 1).

## 4. Text ingredients

### 4.1 `ingredients/<BOOK>.usfm`

- USFM 3.0, one file per book in scope. `\id`, `\usfm 3.0`, `\h`, `\toc1-3`, `\mt`, then `\c`/`\p`/`\v` content. The whole book is the default and the common case; the file MAY cover only the project's scope for that book (§3 rule 4). Untranslated verses use the platform stub convention `\v N ___`.
- **INVARIANT I-1: no alignment markup at rest.** The file MUST NOT contain `\zaln-s`/`\zaln-e` milestones or `\w` word-attribute tokens. Rationale (verified empirically): the platform drafting editor strips all such markup on save, for the whole book. If alignments stay inline, any text edit can destroy them. Alignments live in §5.1 and are folded into `\zaln` **only on export**.
- **Verse keys are strings, and MAY be spans.** A span verse uses the exact USFM span string as its key everywhere: `\v 9-10` parses to the single usfm-js key `"9-10"` (harness check 23, on the JON 2:9-10 fixture). word-aligner-lib's verse handling supports span keys (verified in its verseHelpers). Readers and writers MUST NOT coerce verse keys with `Number()` — `Number("9-10")` is `NaN` (harness check 24; this exact bug class existed in the prototype's fixtureStore). Identity keys (§5.2) and I-3 hashes key by the exact verse string.
- **A partially populated book file is legal** [decided 2026-07-30 — D26]. When the project's scope for a book is a passage set (§3 rule 4), the book file covers the in-scope material. Drafting, checking, and publish MUST NOT assume that a book file covers the whole book.
- **No translator's-section milestones in the target text.** Section grouping for drafting is presentation only. It is derived at load from the pinned *source* text (§8.4a). tC4 writers MUST NOT introduce `\ts\*` into the target USFM. If a file already carries them (an import), the file is preserved byte-exactly like any other content, and plain-text extraction ignores the milestones. [decided 2026-07-07 — D14]

### 4.2 Derivations (never stored)

These are computed at load and MUST NOT be persisted as authoritative data:
- **targetBible** for the checking components: `usfm-js.toJSON(usfm).chapters` → `{ "<ch>": { "<v>": {verseObjects} } }`, plus `headers`.
- **Check item lists** (groupsData/groupsIndex): derived from the pinned tN/tW TSVs + the original-language book, then merged with stored decisions (§5.2 identity key). Derivation MUST filter items to the project's scope (§3 rule 4): an out-of-scope item is never derived, counted, or shown. Progress = decided ÷ derived-total, where the derived total counts **in-scope** items only [decided 2026-07-30 — D26; harness check: derive honors scope]. The TSV→items derivation is owned by the client's `derive/` module (versioned TSV parsing + the tN category map). The RCL's own helpers (`twlTsvToGroupData` / `tsvObjectsToGroupData`) are the contract/parity reference; whether they also serve as a headless runtime dependency is OPEN-QUESTIONS #14. **Proof status:** the harness proves the derive+merge mechanism and progress reconstruction on a miniature TSV defined inside the suite, and the app-level proof runs on REAL published resources [VERIFIED 2026-08-03 — whole-Titus slices of en_tn v86 / en_twl v86 / es-419_tn v66 + the en_ta v86 toc, vendored from the pinned sb-zips; `translationCore4/test/derive-full-strength.test.ts`, 20 checks; `evidence/derive-full-strength-2026-08-03.md`]. OPEN-QUESTIONS #14/#15 are closed: the RCL helpers cannot import headless — contract/parity reference only.
- **Aligned USFM**: produced on export. The export merges §5.1 data into verse text (`wordaligner.merge` → `\zaln` USFM). Round-trip proven byte-equivalent (harness checks 8–11, 22).
- A derived cache MAY be written (e.g. progress `summary` blocks, see §5.2). The cache MUST be regenerable and MUST be treated as disposable.

### 4.3 `ingredients/vrs.json` (role `x-versification`)

The versification scheme of the project. The platform writes this file at project creation
(`new_text_translation.rs` [VERIFIED — pankosmia-web 0.18.5 (99fd9be, 2026-07-30); the
mechanism is unchanged 0.16.18→0.18.5]). Rules:

- The file holds the **full chosen scheme** in the platform's vrs-to-JSON shape: `maxVerses`,
  `mappedVerses`, `excludedVerses`, `partialVerses`. The platform ships six schemes
  (`eng, lxx, org, rsc, rso, vul`) and serves them at `GET /content-utils/versification[s]`
  (evidence: `docs/evidence/pankosmia-versification-2026-07-30.md`).
- New projects default to **`eng`**. The user MAY select a different scheme at creation
  [decided 2026-07-30 — OPEN-QUESTIONS #26]. The scheme is fixed for the life of the project.
- `maxVerses` MUST cover every book in `currentScope` (harness check: versification).
- The client MUST NOT edit this file after creation. Conversion between frames is a client
  concern (Proskomma's versification mapping, shipped in the platform clients — see §5.2 for
  the frame rule). The server never maps a reference.
- Non-canonical books (books outside the eng-derived canonical book-code list) are not
  allowed at this time [decided 2026-07-30 — D26; the platform's `canonical_book_codes`
  reads `eng.json`, so such files get no `scope` entry on rescan].

## 5. Checking sidecars (Phase 1 canonical user data)

Common rules:
- Every sidecar file has a top-level `schemaVersion` (integer, currently `1`).
- **INVARIANT I-2: all `occurrence`/`occurrences` fields are integers.** USFM attribute parsing yields strings. Writers MUST normalize (`Number(...)`) before they persist. The alignment libraries fail wholesale on string occurrences (verified — this exact bug cost us a debugging cycle; the current checks client carries a `fixOccurrences` patch for it).
- `contextId.reference.bookId` is **lowercase** (`"tit"`) — tC3 convention — while filenames/scope use uppercase (`TIT`). Do not "fix" this; the checking libraries expect lowercase.

### 5.1 Alignment: `checking/alignments/<BOOK>.json` (role `x-alignment`)

```jsonc
{
  "schemaVersion": 1,
  "book": "TIT",
  "chapters": {
    "1": {
      "1": {
        "alignments": [            // one entry per original-language word/word-group,
          {                        // INCLUDING empty ones (tC3 convention)
            "topWords": [          // original-language side
              {"word": "Παῦλος", "strong": "G39720", "lemma": "Παῦλος",
               "morph": "Gr,N,,,,,NMS,", "occurrence": 1, "occurrences": 1}
            ],
            "bottomWords": [       // target-language side; [] if unaligned
              {"word": "Pablo", "occurrence": 1, "occurrences": 1}
            ]
          }
        ],
        "wordBank": [              // target words not yet aligned
          {"word": "de", "occurrence": 1, "occurrences": 5}
        ],
        "invalid": false,          // set true when alignment needs re-review
        "targetVerseMd5": "<md5>", // see below
        "sourceVersion": "dcs::unfoldingWord/el-x-koine_ugnt@v0.34"
      }
    }
  }
}
```

- The `alignments`/`wordBank` payload is **exactly** what `word-aligner`'s `unmerge` produces and `merge` consumes (normalize occurrences per I-2; the library returns the key `alignment` — persist as `alignments`). Do not invent another shape; round-trip is proven with this one.
- **`targetVerseMd5`** = md5 (lowercase hex) of the UTF-8 bytes of the verse's plain text: concatenate the `text` fields of the verse's usfm-js verseObjects, then `trim()`. **INVARIANT I-3: an alignment entry is valid only if its `targetVerseMd5` matches the current verse text.** If the hash does not match, treat the entry as `invalid`, regardless of the flag. This replaces tC3's marker-file invalidation. It is Phase 2's base-hash mechanism, applied early. *Definition-by-reference caveat:* "plain text" is operationally what usfm-js 3.4.3 extracts. A non-JS implementation MUST reproduce that behavior. The sample project's stored hashes plus the harness fixtures are the executable contract to match.
- Multi-source alignments (e.g. `Ἰησοῦ`+`Χριστοῦ` → `Jesucristo`) are one entry with two `topWords`. A verse with no alignment work yet MAY be absent entirely.

### 5.2 Decisions: `checking/<toolId>/<BOOK>.json` (role `x-check-decisions`)

`toolId` ∈ `translationWords` | `translationNotes` (| `translationQuestions`, reserved).

```jsonc
{
  "schemaVersion": 1,
  "tool": "translationWords",
  "book": "TIT",
  "resource": {"repoPath": "git.door43.org/es-419_gl/es-419_twl", "version": "v18", "languageSet": "primary"},   // the (tool, book) resolution record — §5.3
  "decisions": [
    {
      "contextId": {
        "checkId": "t1g7",                       // the TSV ID column — the stable anchor
        "occurrenceNote": "",                    // tN: the note text
        "reference": {"bookId": "tit", "chapter": 1, "verse": 1},
        "tool": "translationWords",
        "groupId": "god",
        "quote": "Θεοῦ",                          // tW: string; tN: [{word, occurrence}]
        "quoteString": "Θεοῦ",
        "glQuote": "",
        "occurrence": 1
      },
      "category": "kt",                           // tW: kt|names|other; tN: tA category
      "selections": [{"text": "Dios", "occurrence": 1, "occurrences": 2}], // or false
      "comments": false,                          // or string
      "reminders": false,                         // bookmark flag
      "nothingToSelect": false,
      "verseEdits": false,
      "invalidated": false,
      "status": "valid",                          // OPTIONAL additive triage state (D2): valid|invalid|todo
      "modifiedTimestamp": "2026-07-02T14:21:07.000Z"   // Phase-2 forward-compat; REQUIRED
    }
  ],
  "summary": {"note": "derived cache, regenerable", "decided": {"kt": 2}}   // OPTIONAL, disposable
}
```

- The decision record is the **full tC3 check-item shape** — every field the `tc-checking-tool-rcl` `Checker` reads or writes (verified field-for-field against its published source). Do not simplify it; the local POC's simplified shape provably fails to round-trip.
- **Versification frame rule** [decided 2026-07-29 — D24(c)]: `reference.chapter` and
  `reference.verse` — here, in check items, and in every stored ref — are in the **project's
  chosen versification** (`ingredients/vrs.json`, §4.3). TSV and original-language refs map
  INTO the project frame at derive time. The mapping mechanism is Proskomma's versification
  toolkit, shipped client-side in the platform (`mapVerse` and the succinct mapping functions;
  the scheme's `mappedVerses` table is range-capable). tC4 does not build a mapper.
- Only *touched* checks are stored. An item with no stored decision is "unchecked". That is the representation of not-done.
- **Identity key (normative, for merge/upsert):** `(contextId.checkId, reference.bookId, reference.chapter, reference.verse, contextId.occurrence)`, with `quoteString` as a verification field. Writers SHOULD reject a key match whose quoteString differs — that difference means the resource changed; treat the record as unmatched. tN `quote` word-arrays MUST be preserved as arrays. **Chapter and verse compare as strings** (`String(...)` both sides): a single verse is its decimal string; a span verse is the exact span string (`"9-10"`). Never `Number()`-coerce (harness check 24). `reference.verse` itself stays a JSON number for single verses (tC3 convention) and is the span string for spans.
- `selections` semantics: `false` = none; `[]` is not used — empty coerces to `false` (RCL convention, verified). "Done" = `selections !== false || nothingToSelect === true`.
- **`status`** (OPTIONAL, additive — decision D2, 2026-07-06): explicit triage state, one of `"valid" | "invalid" | "todo"`. When `status` is absent, readers derive it: `invalidated` ⇒ `invalid`; done (rule above) ⇒ `valid`; else `todo`. A writer that sets `invalidated: true` MUST NOT leave `status: "valid"` in place. The field is additive-optional, so `schemaVersion` stays 1 (§9). Harness check 25.
- `verseEdits`/`invalidated` carry the re-review state that tC3 kept in timestamped marker files; the marker files are retired.
- **Resolution record** [decided 2026-07-12/2026-07-30 — D17/D30; landed 2026-07-31]: `resource` records the repo the book's check list derived from — tN: the set's `translationNotes` pin; tW: the set's `translationWordsLinks` pin. It MUST equal exactly one rung's pin in §5.3 `languageSets` (repoPath + version). The OPTIONAL additive `languageSet` field (`"primary" | "fallback"`) names that rung; when present it MUST agree with the pin match. A change to a book's resolution is a warned update, never silent. Harness check: `resolution: §5.2 files record the resolved (tool, book) resource...`.
- **Cross-language re-attach** [decided 2026-07-12 — D17]: a resolution change swaps the TSV language, so `checkId` values no longer match. When `checkId` finds no match, re-attach on **(reference + original-language quote + occurrence)**. That key is NOT unique ([VERIFIED] duplicate quote+occurrence rows in en_tn 2TI/ACT), so tiebreak on `groupId` — the language-independent slug both tools already store (tN: the tA module from `SupportReference`; tW: the TWLink slug). A still-ambiguous match is left **unplaced**; it never auto-attaches. Harness check: `derive+merge: cross-language re-attach...`.
- **Carry-over — the resource is the primary key** [decided 2026-08-04 — D36; tC3 precedent]: the check list derived from the currently-pinned resource IS the work. When a resolution change is committed, each affected book's decision file MUST be recomputed against the new resource: decisions that re-attach (by either pass above) are kept and re-keyed to the **new** resource's `contextId`; decisions that neither pass can place MUST be written back with `invalidated: true` and `status: "invalid"`. An invalidated decision keeps its full record — nothing is deleted, so re-pinning the old resource re-attaches it. It MUST NOT count toward progress: a book that was 100% checked against the old resource is honestly less than 100% against the new one, because the new resource asks checks the old one did not. There is no review queue for these. Harness check: `carry-over: an unplaceable decision is invalidated...`.

### 5.3 Resource pins: `checking/resources.json` (role `x-resource-links`)

```jsonc
{
  "schemaVersion": 2,
  "languageSets": {                     // D17: exactly these two keys — see the ladder rule below
    "primary": {                        // the project's gateway language
      "gatewayLanguage": {"languageId": "es-419", "owner": "es-419_gl"},
      "translationNotes":      {"repoPath": "git.door43.org/es-419_gl/es-419_tn",  "version": "v66", "sha": "22f3d0c61e2ab4701cb869547de9c3c43da07208", "flavor": "parascriptural/x-bcvnotes"},
      "translationWordsLinks": {"repoPath": "git.door43.org/es-419_gl/es-419_twl", "version": "v18", "sha": "c2d9547ec95e40c2ba085c597b127c94733feb8a", "flavor": "parascriptural/x-bcvarticles"},
      "translationWords":      {"repoPath": "git.door43.org/es-419_gl/es-419_tw",  "version": "v37", "sha": "7586f4ff1f0483ea40a4a68e5e1f33158e08c208", "flavor": "parascriptural/x-bcvarticles"},
      "translationAcademy":    {"repoPath": "git.door43.org/es-419_gl/es-419_ta",  "version": "v4",  "sha": "26606b578c37cc2c0ee09bb7b9a291860ff59444", "flavor": "peripheral/x-peripheralArticles"}
    },
    "fallback": {                       // the English suite that ships with the install
      "gatewayLanguage": {"languageId": "en", "owner": "unfoldingWord"},
      "translationNotes":      {"repoPath": "git.door43.org/unfoldingWord/en_tn",  "version": "v86", "flavor": "parascriptural/x-bcvnotes"},
      "translationWordsLinks": {"repoPath": "git.door43.org/unfoldingWord/en_twl", "version": "v86", "sha": "570e76d0024c847689e48a20e2ac1a1d2c6eb6e3", "flavor": "parascriptural/x-bcvarticles"},
      "translationWords":      {"repoPath": "git.door43.org/unfoldingWord/en_tw",  "version": "v87", "flavor": "parascriptural/x-bcvarticles"},
      "translationAcademy":    {"repoPath": "git.door43.org/unfoldingWord/en_ta",  "version": "v86", "flavor": "peripheral/x-peripheralArticles"}
    }
  },
  "resources": {                        // language-set-independent pins
    "originalLanguage": {
      "nt": {"repoPath": "git.door43.org/unfoldingWord/el-x-koine_ugnt", "version": "v0.34",  "flavor": "scripture/textTranslation"},
      "ot": {"repoPath": "git.door43.org/unfoldingWord/hbo_uhb",  "version": "v2.1.30","flavor": "scripture/textTranslation"}
    },
    "lexicon": {
      "nt": {"repoPath": "git.door43.org/unfoldingWord/en_ugl", "version": "v2", "flavor": "peripheral/x-lexicon"},
      "ot": {"repoPath": "git.door43.org/unfoldingWord/en_uhl", "version": "v1", "flavor": "peripheral/x-lexicon"}
    }
  },
  "extraScripture": [
    {"id": "ult", "repoPath": "git.door43.org/unfoldingWord/en_ult", "version": "v89", "sha": "84c73ba00fc8a95a9033f9efb14bb905a2a52ee4", "flavor": "scripture/textTranslation"},
    {"id": "ust", "repoPath": "git.door43.org/unfoldingWord/en_ust", "version": "v89", "sha": "37ec223166bbd73fb55abc7840be8310c0fee7f2", "flavor": "scripture/textTranslation"}
  ]
}
```

- This file replaces the per-book `version_manager.json` that the current checks client writes. `version` is the release tag of the pinned resource. The fetch path for SB-form resources is the DCS sb-zip export [decided 2026-07-25 — OPEN-QUESTIONS #24]: the import fetches `/sb/<tag>.zip` and verifies the tag's commit SHA from the export's own `metadata.json` (`identification.primary.dcs[...].revision` — [VERIFIED — `evidence/sb-zip-zaln-2026-07-25.md`]: the export preserves `\zaln` byte-identically). An entry MAY carry that expected SHA in an OPTIONAL `sha` field (40 lowercase hex; additive-optional, so `schemaVersion` stays 1 per §9). Writers SHOULD record it; imports verify it when present.
- **Two language sets** [decided 2026-07-12 — D17; landed in this schema 2026-07-31 — OPEN-QUESTIONS #28]: `languageSets` MUST contain exactly the keys `primary` and `fallback`. Each set pins a coherent helps suite at explicit versions: `translationNotes` (tn), `translationWordsLinks` (twl — the per-book TSV that check lists derive from, §4.2; its book coverage defines tW coverage), `translationWords` (tw articles), `translationAcademy` (tA). `fallback.gatewayLanguage.languageId` MUST be `"en"` — the suite that ships with the install. The twl slot is required for deterministic derivation and coverage resolution (spec-editor derivation from D17's "resolved per (tool, book) by coverage" + §4.2; the tn/tw/tA set list is D17 verbatim). Upstream models it the same way: the uW developer guide treats TWL as a first-class per-book helps resource — a sibling of tN, with tW as the dictionary "Referenced by TWL" — and every RC manifest `relation` array lists `<lang>/twl` separately from `<lang>/tw` [VERIFIED — `uW-Tools-Collab/docs/2-unfoldingword-developer-guide.mdx` §8 + ecosystem tree, read 2026-07-31]. Note: the pins record **provenance per tool input**, not a two-repo requirement. Both slots MAY name the same repo at the same version — and for tW they normally DO. **Fetch path** [decided 2026-08-03 — D34, amending D32]: for the tW tool a project pins and fetches **`<lang>_tw` only**. That repo's DCS sb-zip export already carries both halves — the per-book TWL link TSVs and the `payload/` articles — so `translationWordsLinks` and `translationWords` name the same repo; `<lang>_twl` is not fetched. [VERIFIED 2026-08-03 — `unfoldingWord/en_tw` `/sb/v87.zip` = 66 TWL TSVs + 954 articles; `es-419_gl/es-419_tw` `/sb/v37.zip` = 66 TSVs + 1056 articles; `docs/evidence/tw-twl-sbzip-combined-2026-08-03.md`.] tC4 never combines resources itself (D32 unchanged); the combining is DCS `go-rc2sb`'s. **Readers MUST accept both TWLink forms.** Every DCS **sb-zip export** rewrites links to the repo-relative form (`./payload/kt/son.md`) — measured on both `en_tw` v87 and `en_twl` v86, 100% of rows [VERIFIED 2026-08-03]. The `rc://*/tw/dict/bible/kt/god` form appears in the **RC source branches** (which tC4 does not fetch) and in **tC3-era stored decisions**, so readers still meet it. In both forms the article slug is the last path segment (drop any `.md`) and the tW category is the segment before it. The twl `flavor` value is what the DCS sb-zip export declares [VERIFIED — en_twl v86 export metadata, 2026-07-31: `parascriptural/x-bcvarticles`; `docs/evidence/es419-suite-pins-2026-07-31.md`].
- **Resolution** [decided 2026-07-30 — D30, constraints (1)–(3)]: the resolution unit is **(tool, book)**. A book's check list derives from ONE resource at ONE version. Per-check language mixing inside a book never occurs. The automatic ladder is exactly two rungs: `primary` → `fallback`, by book coverage of the pinned version. Any other language is an explicit whole-project gateway-language change (warned re-derive; no per-book language picker). The project's pins bind **every** opener — a personal language preference never changes the project's resources. The resolved rung is recorded per (tool, book) in the §5.2 decision file (`resource` field); a book's resolution change is a warned update, never silent.
- **Missing pinned version** [decided 2026-07-30 — D30, constraints (4)–(5)]: online → the app fetches it (sb-zip + SHA, OPEN-QUESTIONS #24), never a warn-toward-invalidation dialog. Offline → that (tool, book)'s checking is **unavailable as a first-class state**, not an error; drafting, other books, and other tools continue. The user MAY explicitly re-pin to a locally available version — warned, with re-derive and carry-over (§5.2 D36: unplaceable decisions are invalidated, not queued) — but the app never forces it.
- **schemaVersion 2** is a breaking change from the single-set shape (§9: readers MUST reject unknown major versions with a clear message). A `schemaVersion: 1` file (the Increment-1 writer's shape) migrates mechanically: its `gatewayLanguage` + `resources.translationWords/translationNotes/translationAcademy` become the `fallback` set (they pin the installed English suite), `primary` is initialized equal to `fallback` until the user picks a gateway language, a `translationWordsLinks` pin is added, and `originalLanguage`/`lexicon`/`extraScripture` carry over unchanged. Updating the product writer to schemaVersion 2 is the first Increment-2 resource task (it still writes the v1 shape; journey j01 asserts that as the Increment-1 shape, not as this section's shape).
- Deterministic derivation (§4.2) depends on these pins: same pins ⇒ same check lists ⇒ saved decisions always re-attach. An intentional resource upgrade re-derives. Unmatched decisions are invalidated and retained (§5.2 D36); they never silently persist as progress.
- **Stage rule S-1 (permanent** [decided 2026-07-30 — D28]**):** this file is **authoritative**, and `metadata.json.relationships` is a mirror. Upstream models `role` and `relationships` ([VERIFIED — pankosmia-web 0.18.5 (99fd9be, 2026-07-30): `structs.rs`]), and at ≥0.18.5 the `relationships` mirror **survives** regeneration in practice [VERIFIED — `evidence/rig-rebaseline-0.18.5-2026-07-30.md`; dropped at ≤0.18.3]. Authority does not move: durability is re-measured at each pin change, and the client-owned file stays the source of truth. The earlier plan — that `relationships` becomes authoritative and this file retires — is withdrawn. Do not ask upstream for more.
- **Watch — Pankosmia roadmap #160** (OPEN-QUESTIONS #20): the platform builds a native "essential/recommended resources per project" + burrito-linking mechanism (with metadata-schema changes). When that mechanism lands, the resource-pin home may become that native mechanism, not this sidecar and not a hand-rolled `relationships` block. Align to it; do not diverge. [PROPOSED — watch; 0/50 epic opened 2026-07-09]
- **`extraScripture` (normative):** a drafting project SHOULD pin its gateway source texts in an `extraScripture` array. Each entry is `{id, repoPath, version, flavor}`. `id` is a short slug for the pane (`"ult"`, `"ust"`); ids MUST be unique in the array. `flavor` is the SB flavor of the pinned source (`scripture/textTranslation`). An entry MAY carry the OPTIONAL `sha` field, with the same grammar and semantics as `sha` on the main pins (40 lowercase hex; verified at import). Readers use `extraScripture` to fill the source panes. Absence is legal: a project without source panes omits the array. [decided 2026-07-06 — D10/OPEN-QUESTIONS #13; promoted to normative 2026-07-30 in the Increment-1 change set (checklist C1b.1)]

### 5.4 Settings: `checking/settings.json` (role `x-check-settings`)

```jsonc
{
  "schemaVersion": 1,
  "checkCategories": {
    "translationWords": ["kt", "names", "other"],
    "translationNotes": ["translate"]
  },
  "ui": {
    "paneSettings": [ {"bibleId": "targetBible", "languageId": "es-419"} ],
    "toolsSettings": {}
  }
}
```

This file is the home for the RCL `saveSettings` payload (pane/tool settings — an unpersisted TODO in the current client) and for the check-category filter (`checker_setting.json` equivalent).

## 6. Server interaction rules (Phase 1)

These are verified semantics of pankosmia-web (first verified at 0.16.x; re-verified live through the 0.18.5 rig [VERIFIED — pankosmia-web 0.18.5 (99fd9be, 2026-07-30); `evidence/rig-rebaseline-0.18.5-2026-07-30.md`]). Conforming writers MUST respect them:

- **W-1** Writes go through `POST /burrito/ingredient/raw/...?ipath=<path under ingredients/>` with body `{"payload": "<string>"}` (JSON payloads are stringified). The handler creates missing directories. A missing or non-string `payload` returns a clean 500 since 0.17.0 (at ≤0.16.x it panicked the handler — PLATFORM-NOTES #7, downgraded). Never send one.
- **W-2** Registration is opt-in: pass `update_ingredients` on the write, or call `POST /burrito/metadata/remake-ingredients/...` after a batch. Regeneration rescans the whole repo. Unregistered files self-heal in, and the same rescan drops `x-` roles: the scan builds the table from what is on disk, and nothing on disk records a role. This is upstream's position by design, not a pending fix [decided 2026-07-30 — D28; evidence: `docs/evidence/upstream-roles-relationships-2026-07-30.md`]. Hence **Stage rule S-2 (permanent): paths are authoritative; roles are decorative.** Role re-assertion is scoped by access [VERIFIED — pankosmia-web 0.18.5 (99fd9be, 2026-07-30): `burrito2/raw_metadata.rs` is GET-only, and `ipath` cannot reach `metadata.json`, so **no HTTP route can write metadata**]: a writer with filesystem access (the harness generator; any future direct-disk tool) MUST re-assert its role entries after an operation that regenerates the ingredients table. A pure-HTTP client CANNOT, so app-created projects carry no `x-` roles after their first regeneration — the accepted condition. Readers MUST NOT depend on roles for anything (that is what S-2 means); Stage-2 conformance measures the locally-generated sample, and Stage-1 is the bar for app-created projects (§7).
- **W-3** `no_bak` skips the single-level `.bak` backup/undo. Writers SHOULD omit `no_bak` for USFM (keep undo) and MAY use it for high-frequency sidecar writes. `.bak` files are git-ignored and excluded from ingredient scans (verified).
- **W-4** Nothing auto-commits. The app MUST call `POST /git/add-and-commit/{path}` at checkpoints (session close, book done, pre-sync). Note: `add-and-commit` sweeps **all** pending changes in the repo, and branch switching refuses on a dirty tree (verified). Commit before any branch operation.
- **W-5** Whole-file writes only (no append; the server writes unconditionally). Phase 1 accepts the read-modify-write race on `<BOOK>.usfm` (single user, same app). Load-time revalidation (I-3 + selections validation) self-heals stale sidecars. The same whole-file race exists for every sidecar. Compare-and-swap or read-merge-retry for sidecar writes is an open item (OPEN-QUESTIONS #17).

## 7. Conformance

A project is conforming when `sample-burrito-validation`'s checks pass against it. The suite has **34 checks in three groups**:

- **Stage-1 — path-authoritative conformance (30 checks).** Schema validity; ingredient integrity; versification (`vrs.json` presence, shape, scope coverage, role); scope grammar (whole-book `[]` + range arrays, with negative controls); targetBible derivability; alignment round-trip + staleness guard; selections validity + invalidation firing; decision-shape completeness incl. the additive `status` field; derive+merge progress reconstruction; scope-filtered derivation with the in-scope progress denominator; cross-language re-attach with groupId tiebreak + irreducible ambiguity left unplaced (D17); carry-over invalidation of unplaceable decisions (D36); multi-book scope; two-language-set pin completeness (D17/D30 §5.3 shape); (tool, book) resolution records + the two-rung coverage ladder; extraScripture source pins (§5.3 entry shape, unique ids, `sha` grammar); zaln export; verse-span key semantics. These checks pass on today's pankosmia-web unmodified.
- **Stage-2 — role/relationships durability (2 checks).** Role-tagged ingredients and native SB `relationships`. The sample carries both, schema-valid. A server metadata regeneration still drops the `x-` **roles** — the scan rebuilds the table from disk, and roles are not derivable from bytes — the **accepted condition** [decided 2026-07-30 — D28], not a pending upstream fix. `relationships` **survives** regeneration at ≥0.18.5 [VERIFIED — `evidence/rig-rebaseline-0.18.5-2026-07-30.md`; it was dropped at ≤0.18.3]. So a server-rescanned copy scores Stage-2 **1/2** at the current pin (the pristine sample scores 2/2). Stage 1 treats paths as authoritative (S-2, permanent), and the client re-asserts its roles after each regeneration (§6 W-2).
- **Phase-2 — journal-merge design (2 checks).** The two-actor `metadata.json` merge conflict and the §8.7 derived-file rule that resolves it, exercised in a disposable git repo.

The **journal conformance suite** (§8.9; 59 checks, J1–J20 per `docs/JOURNAL-TEST-PLAN.md`) validates the full §8 semantics, the publication topology, and the intake rejection rules separately: `npm run validate:journal`. Both suites: `npm run validate:all`.

Run: `npm install && npm run validate` (`.npmrc` handles the required `legacy-peer-deps`).

## 8. Phase 2: the event journal (FULLY SPECIFIED — [PROPOSED], ratification pending; OPEN-QUESTIONS #10/#16)

This section defines the Phase 2 format completely. Every normative statement below maps to an executable check in the journal conformance suite (`sample-burrito-validation/validate-journal.mjs`; plan: `docs/JOURNAL-TEST-PLAN.md`). Status: the *semantics* are fully specified and tested via the reference implementation. The section flips from [PROPOSED] to normative when the project owner ratifies the design decisions (OPEN-QUESTIONS #10, #16). The Phase 2 *app* (M4) remains gated on M2/M3.

When Phase 2 ships, journals become canonical. `<BOOK>.usfm`, the checking sidecars (§5.1–5.2 shapes), and `metadata.json`'s `ingredients` table all become **derived, committed** artifacts. Checkpoints regenerate them from the fold, so the repo remains a normal Scripture Burrito for every other tool. Everything in §§3–5 remains valid for reading.

### 8.1 Files and actors

- Journal streams live under `ingredients/checking/journal/<actorId>/`:
  - `<BOOK>.<seq>.jsonl` — events scoped to one book (text, alignment, decisions, notes);
  - `_project.<seq>.jsonl` — project-scope events (resource pins, project metadata, book add/remove).
- Append-only NDJSON: one event per line, LF-terminated (`mimeType: application/x-ndjson`). `<seq>` is 5 digits from `00001`. When the current file exceeds 1 MB, writers MUST rotate to the next `<seq>` before the next append. Readers MUST read all `<seq>` files in order.
- **Torn tail rule:** all readers MUST ignore a final line that is not valid JSON (crash mid-append); the *owning* actor SHOULD truncate it on next open. Invalid JSON anywhere except the final line is corruption: the fold MUST refuse with a clear message. Non-owning actors never modify another actor's files.
- `<actorId>` = stable per-install slug, `[a-z0-9-]{4,32}` (MUST NOT contain `|`), generated from a UUID at first run. A device MUST only ever write under its own `<actorId>`. `journal/<actorId>/actor.json` records `{schemaVersion: 1, actorId, displayName, device, createdAt}`. `actorId` MUST match the directory. `displayName`/`device` are OPTIONAL and user-controlled (a pseudonym is fine: journals sync to DCS, and actor metadata is exactly the identity-exposure surface the sensitivity posture covers — PRD FR-33).
- **Journals are permanent history.** There is no compaction, rewriting, or pruning in `v: 1`. The fold's correctness depends on the full event set, and git history keeps it anyway. (At ~1 MB per rotated file of NDJSON text, a heavily-edited book stays in the low tens of MB over a project's life.)
- Journal files register as ordinary ingredients on rescan (paths authoritative, role `x-journal` per §2; the server's mime inference for `.jsonl`/`.json` is cosmetic — nothing reads the registered `mimeType`).
- **The disjoint-writer layout is the merge guarantee for the journals.** No two devices write the same file, so combining copies never conflicts *in the journals*. Shared derived files are covered by the §8.7 rule instead.

### 8.2 Time and event identity (HLC)

- `ts` is a hybrid logical clock string: `<ISO-8601 UTC, fixed-width ms, 'Z'>|<4-hex lowercase counter>|<actorId>` (e.g. `2026-07-07T14:03:22.113Z|0007|maria-x1`). Fixed-width fields make plain string comparison the total order.
- Issue rule: if physical now > last physical, the counter resets to `0000`; otherwise the counter increments. Counter overflow past `ffff` bumps the physical part by 1 ms and resets the counter. When a device receives any event (import, merge, project open), it MUST ratchet the local clock to at least the maximum `ts` seen.
- **Event identity is `ts`.** It is unique by construction: an actor writes only its own journal (§8.1), the counter breaks same-millisecond ties, and an event that was never flushed to a journal never propagated. The union of journals de-duplicates by `ts` (J13). There is no separate content-hash id. This is the fix for the review finding that same-content forks must not collapse (OPEN-QUESTIONS #16): two events with identical payloads are still distinct events.

### 8.3 Event envelope

```jsonc
{"v": 1, "op": "text.verse.set", "actor": "maria-x1",
 "ts": "2026-07-07T14:03:22.113Z|0007|maria-x1",
 "base": "<ts of the event whose state this op observed, or null>",
 "supersedes": ["<ts>", "..."],        // OPTIONAL — fork resolution only
 "batch": "<ts>",                      // OPTIONAL — groups events of one user action (§8.4a)
 "seed": {"source": "sidecar-migration|out-of-band-usfm|tc3-import", "batch": "<ts>"},  // OPTIONAL
 /* ...op-specific fields (§8.5) */ }
```

- `base` — per target key: the `ts` of the previous live event on that key that this op observed (`null` for the first write to a key). Two live events on one key with the same `base` from **different actors** = a **fork**. Same-actor events are totally ordered by `ts` and never fork.
- `supersedes` — a resolution event names the head(s) it replaces. The review queue emits it (or reconcile does, §8.8).
- `batch` — the `ts` of the first event of the same user action. A save whose editing unit is larger than one verse (a translator's section, §8.4a) emits one event per changed verse; all share a `batch`. Readers MAY use it to group related events (e.g. present per-verse forks of one section as a single review item). `batch` never affects fold state — grouping is presentation, the fold stays per-key.
- `seed` — marks migrated/imported data. In every other respect, a seeded event is an ordinary event (there is no separate `seed.import` op).
- Version policy (mirrors §9): a line with unknown `v` or unrecognized `op` MUST cause the fold to refuse with a clear message (new ops bump `v`; additive optional *fields* do not).

### 8.4 The book decomposition: skeleton + verse slots

The journal must be able to regenerate the *entire* USFM file byte-exactly. Thus the book is decomposed into exactly two kinds of state:

- **Verse content** — for each verse key: every byte after the `\v <key> ` marker, up to the next `\v ` or `\c ` marker (or end of file). Inline markup (footnotes, character styles) and inter-verse paragraph markers (`\p`, `\s5`, …) that *follow* a verse belong to that verse's content. Verse keys are strings and MAY be spans (`"4-5"`), with the §5.2 span identity rules.
- **The skeleton** — everything else: front matter (`\id`, `\usfm`, `\h`, `\toc*`, `\mt*`, …), `\c N` lines, and the `\v <key> ` markers themselves, with each verse's content replaced by a slot. (This subsumes the earlier draft's `text.headers.set` — header edits are skeleton edits.)

Recomposition (skeleton + verse map → file) MUST be byte-identical for any input file: `recompose(decompose(usfm)) === usfm` (J2, property-tested over aligned, exotic, span-keyed, and `\ts\*`-chunked corpora). The slot delimiter is `U+0001`, reserved: source files that contain `U+0001` MUST be rejected. A consequence of the content rule, stated plainly: to add or remove a paragraph break between verses is an edit to the *preceding verse's* content; to renumber, add, or remove verses or chapters is a skeleton edit.

#### 8.4a Drafting by section vs checking by verse (translator's sections)

unfoldingWord drafting *presents* verses in **translator's sections** (multi-verse chunks), while checking and alignment work **per verse**. Two facts keep these compatible:

- **Sections are presentation only, and they are not stored in the target text** (clarified by the project owner, 2026-07-07). The drafting UI derives its section grouping at load from the pinned *source* text's `\ts\*` milestones (ULT/UST carry them). The fallback ladder when the source has none: `\p` paragraphs, then per-verse [PROPOSED — validated live in tc4-POC-2, 2026-07-16: `docs/evidence/tc4-poc2-learnings-2026-07-16.md`]. The target draft never contains `\ts\*` (§4.1). There is no section object in the format and no section op in the vocabulary.
- **A section save decomposes into one `text.verse.set` per *changed* verse; all share a `batch` (§8.3).** The journal's conflict unit stays the verse — finer than the drafting unit. Thus two people who draft *different* verses of the same section never conflict. A drafter-vs-checker collision forks only on the verse that both actually edited. The `batch` id lets the review queue present per-verse forks of one section save as a single item.

Robustness note (not a target-text feature): the codec treats any milestone bytes as ordinary content. An *imported* file that carries `\ts\*` round-trips byte-exactly (J2/J16), and plain-text extraction ignores milestones. Thus milestones can never leak into checked text or false-invalidate anything (§8.5).

### 8.5 Operation vocabulary (complete)

| op | scope / key | payload (beyond envelope) | fold rule |
|---|---|---|---|
| `text.verse.set` | (book, chapter, verseKey) | `{book, chapter, verse, text, textMd5}` | LWW register with fork detection |
| `text.skeleton.set` | book | `{book, skeleton, skeletonMd5}` | LWW register with fork detection |
| `book.add` | book | `{book}` | book exists if latest add/remove head is add |
| `book.remove` | book | `{book}` | LWW vs `book.add`; content events for absent books fold but don't project |
| `align.verse.set` | (book, chapter, verseKey) | `{book, chapter, verse, alignments, wordBank, targetVerseMd5}` (§5.1 shapes, I-2 integers) | LWW; **valid only while `targetVerseMd5` = md5 of the folded verse text (I-3)** |
| `check.decision.set` | §5.2 identity key | `{toolId, decision}` (full §5.2 record incl. `status`) | LWW with fork detection |
| `note.add` | — (grow-only) | `{target, text}`; `target` is exactly one of `{book, chapter, verse}` (a verse) or `{decisionKey}` (a §5.2 identity-key string) | grow-only set (additive; no LWW). Notes are permanent in `v: 1` — no delete/edit op; hiding is app-local state. They project into fold output only (no sidecar mirror; export is an app decision) |
| `resource.pin.set` | pin slot | `{slot, entry}` (§5.3 entry shape) | LWW with fork detection |
| `project.meta.set` | JSON path | `{path, value}`; `path` is dot-separated object keys, arrays not addressable in `v: 1` (e.g. `identification.name.en`) | LWW per path; applied as an overlay after metadata regeneration (§8.7). **MUST NOT target the derived/fixed roots `format`, `ingredients`, `type`, `meta`** — the fold refuses such events with a clear message |
| `settings.set` | settings path | `{path, value}` (dot-separated path into the §5.4 document, e.g. `checkCategories.translationWords`, `ui.paneSettings`) | LWW per path with fork detection — §5.4 `settings.json` becomes a derived mirror at checkpoints; without this op it would be the last shared mutable file (the `metadata.json` bug class) |

There are no other ops in `v: 1`. The formerly-deferred structural vocabulary (OPEN-QUESTIONS #10) is resolved by §8.4: document structure lives in verse content and the skeleton. Nothing else is needed to reproduce the file.

**INVARIANT I-4: NFC on write.** Writers MUST normalize all text they journal — verse content, skeletons, note text, decision strings — to Unicode NFC before they hash or write (matching `meta.normalization` in §3). Rationale: NFC and NFD bytes of *visually identical* text hash differently. That difference would manufacture phantom forks and false alignment invalidations. This matters most for non-Latin scripts (OPEN-QUESTIONS #19). The fold does not re-normalize — normalization is a write-side duty.

**Text vs. plain text (normative).** `text.verse.set.text` carries the verse's **full content slot** (§8.4 bytes — including trailing `\p`, `\s5`, `\q*`, inline footnotes, and any imported milestones), so structure survives verse edits. All *validity* hashing — `textMd5`, `align.verse.set.targetVerseMd5`, selections revalidation — uses the **§5.1 plain-text extraction** of that content (I-3), never the raw bytes. Consequence (J16): a structure-only edit (a moved paragraph break, a stripped imported `\ts\*`) does not invalidate the verse's alignments or checks; an edit to words does.

### 8.6 The fold (normative algorithm)

Input: the union of all actors' journal lines (all streams, all `<seq>` files). Algorithm:

1. De-duplicate by `ts` (identical events may arrive via multiple copies — J13).
2. Sort by `ts` (plain string compare; total order per §8.2).
3. For each event in order, update its key's state:
   - **grow-only** ops accumulate.
   - **LWW** ops: if the event's `base` equals the `ts` of one live head, it **advances that branch** (it replaces exactly that head — a continuing edit on a forked key advances its own branch without resolving the fork). If it `supersedes` all current live heads, it resolves the key to itself. Otherwise it *joins* the live-head set as a fork; this includes a `base` that references an event not in the union (partial sync).
   - **Fork bookkeeping:** a key with >1 live heads is forked. If all live heads carry byte-identical payloads, the fold auto-merges them (highest `ts` becomes the single head; no review item — identical outcomes need no human). Otherwise the fork is surfaced in the fold output's `forks[]`, and the projection uses the highest-`ts` head **flagged provisional** — visible, never silent.
4. Project: recompose each existing book (skeleton + verse map, §8.4) — a skeleton slot with no live verse event projects as the untranslated stub (`___`, §4.1 convention); emit decision/alignment/settings structures (§5 shapes); apply the `project.meta.set` overlay; report `forks[]`, and `invalid[]` for every alignment whose `targetVerseMd5` no longer matches the **§5.1 plain-text extraction** of the folded verse content (I-3; see §8.5 "Text vs. plain text"). An alignment whose verse key has **no slot in the current skeleton** (the verse was removed or renumbered) is **orphaned** and reported in `invalid[]` regardless of its hash.

**Determinism invariant (J3, property-tested):** the fold is a pure function of the event *set* — `fold(events) ≡ fold(any permutation/partition/duplication of events)`. Incremental or cached folds MAY exist but MUST equal the full fold.

### 8.7 Checkpoints, derived files, and the merge rule

A **checkpoint** (session close, book done, pre-sync — W-4) is this sequence: fold → write **all** derived files — `<BOOK>.usfm` recomposed; §5.1 alignment and §5.2 decision sidecar mirrors for Phase-1 readers; `resources.json` from the folded pin state (§5.3 shape); `settings.json` from the folded settings state (§5.4 shape) — → regenerate `metadata.json` ingredients (rescan; per-ingredient extras carry forward) → apply the `project.meta.set` overlay → `add-and-commit`. That list is exhaustive: **every shared non-journal file is regenerable from the fold**. That property is what makes the merge rule below safe.

**Sync and integration — two local histories, one DCS project.** [Pankosmia scratch model VERIFIED — `docs/evidence/pankosmia-sync-model-2026-07-08.md`; topology and delayed-receive lifecycle VERIFIED in the reference suite — J19; app build and named-branch server capability pending]

Each device maintains two local git histories for the same logical project:

- **Working projection (`W`)** — the ordinary, fully conforming Scripture Burrito the UI opens. Checkpoints perform the full fold → derived-file regeneration → `add-and-commit` sequence above. Its commits are local recovery points, not submission commits. After collaboration begins, this repo is rebuildable from the journal union.
- **Actor publication history (`P`)** — a persistent local copy on branch `actor-<actorId>`, forked from the collaboration base. A commit on `P` MUST change only `ingredients/checking/journal/<actorId>/...`. It MUST NOT rescan metadata and MUST NOT regenerate or copy any derived file. The app appends the actor's own stream in `P` first, then mirrors those exact bytes into `W`. At checkpoint the app verifies `P`'s `git status` paths before `add-and-commit`, then checkpoints `W`. On open, if `P`'s own stream and `W` differ, `P` wins. J19 additionally verifies the resulting commit diff.

**Send without receive.** Send pushes only the current `actor-<actorId>` branch from `P`. Nobody else writes that branch. A translator may push A1, remain offline while main accepts B1, append A2 to the same actor stream, and push A2 as a fast-forward of the actor branch. A download of main is not a precondition. A working-projection branch MUST NOT be pushed as a contribution: J19 proves that its regenerated USFM/metadata conflict after main advances.

**Integrate in disposable scratch.** Start from current integration `main`/downloaded. Copy it to `_local_/_updates_/...`. Fetch the incoming actor branch. Merge that **explicitly named branch** in scratch. A valid app-produced publication branch changes only one disjoint actor directory, so the merge is clean. Then rescan in scratch (to discover and register newly arrived journal files) and compare scratch against pre-merge main: every non-journal byte and every other actor's journal byte MUST be unchanged; every previously accepted `.jsonl` file for the incoming actor MUST be a byte-prefix of the new file (no deletion, truncation, or rewrite); new files MUST be under that actor's directory and MUST satisfy the sequence and envelope rules. Only after those checks pass may the app fold the complete union, regenerate every shared derived file, commit, and fast-forward integration `main`. Any dirty tree, unexpected changed path, merge conflict, invalid journal, failed fold, or failed regeneration deletes/quarantines scratch and leaves integration `main` untouched. `.gitattributes merge=ours` is not a safety mechanism and MUST NOT be relied on. J20 proves the rejection cases and the unchanged-main invariant.

**Receive by rebuild-and-swap, never by a merge into `W`.** Before receive, commit the complete own-actor stream in `P`. Build a fresh scratch from downloaded/current `main`. Merge the explicitly named local actor branch from `P`. Rescan, fold, regenerate, and verify that every event in `P` is present byte-identically in the result. Keep the old `W` untouched until the replacement opens and validates. Then atomically switch the app's project pointer, and retain the old repo as recovery material until the next successful checkpoint. To pull or merge main directly into the divergent full-checkpoint history of `W` is forbidden (J19 counterexample).

This protocol needs a **deterministic branch-targeted integration**. That is now verified against the live server with **existing endpoints only** (transport rig, 2026-07-18 @ 0.17.0 — `docs/evidence/transport-rig-2026-07-18.md`; 10/10): each actor's publication history lives in a **single-branch publication repo**, which makes `pull-repo` deterministic (exactly one head to merge). Multi-branch `pull-repo` was measured **ordering-steered** through the HTTP API (it merged the same branch regardless of the source repo's HEAD) and MUST NOT be used for branch selection. Two verified caveats bind implementations: (1) after a *normal* `pull-repo` merge the scratch **working tree is untrustworthy** — merge-added files are absent, merge-modified files may be stale on disk, and a subsequent `add-and-commit` commits deletions. Thus the integrator MUST write the validated journal union explicitly (ingredient writes of the accepted bytes) before it regenerates and commits, and intake validation MUST read from the merge commit, never the worktree (PLATFORM-NOTES #21). (2) `add-and-commit` panics on a commitless repo — publication repos are always born with an initial commit (PLATFORM-NOTES #20). The J19 delayed-receive lifecycle and J20 zero-trust intake both pass endpoint-for-endpoint on this topology. `npm run validate:transport` is the standing acceptance suite.

Executable proof: harness 26–27 and J12 demonstrate why merging full checkpoints conflicts and why derived files are safe to regenerate only after journal union. J18 proves disjoint journal trees compose with Pankosmia's scratch idea. **J19** proves the A1 → B1/main advances → A2-without-receive → later receive lifecycle. **J20** proves that clean-merging but invalid contributions are rejected without a change to main.

### 8.8 Reconcile (out-of-band edits) and seeding (migration)

- **Out-of-band USFM edit** (another tool edited the committed file): detected at open/integration when the committed bytes ≠ the fold's projection. Reconcile decomposes the committed file (§8.4). For each differing verse/skeleton, it emits a `text.*.set` with `seed: {source: "out-of-band-usfm"}` and `base` = the current live head — a linear supersede (the file edit is "the latest edit"). If another device concurrently edited the same verse in its journal, the union produces a fork and the review queue surfaces it. An out-of-band edit can never silently destroy a journaled one (J8).
- **Phase-1 migration:** every sidecar record becomes one seeded event. `modifiedTimestamp` maps into the `ts` physical part (counter `0000`, actor = the migrating install). `targetVerseMd5` carries over. The fold of the seeded journal MUST reproduce the pre-migration sidecar state exactly (J15). Ordinary events follow.

### 8.9 Conformance (journal suite)

`npm run validate:journal` in `sample-burrito-validation/` (reference implementation under `journal/`) executes J1–J20 per `docs/JOURNAL-TEST-PLAN.md`: HLC ordering/ratchet/overflow; skeleton codec byte-identity; fold determinism under permutation (property-based); LWW; fork detection incl. identical-content auto-merge; supersedes resolution; I-3 staleness composition; out-of-band reconcile; three-device convergence; sneakernet ≡ merge; rotation and torn tail; end-to-end two-actor git merge with regeneration; de-duplication; unknown op/version refusal; Phase-1 sidecar seed migration; section-vs-verse machinery; definitions closure; Pankosmia scratch behavior (J18); the actor-publication lifecycle (J19); and zero-trust intake rejection with unchanged main (J20). The reference implementation is the contract for the Phase 2 app's `foldEngine`/`syncEngine` ports (ARCHITECTURE §9).

## 9. Spec evolution

Bump a sidecar's `schemaVersion` only for a breaking payload change. Readers MUST reject unknown major versions with a clear message. Additive optional fields do not bump the version. This document is versioned in git alongside the code. A change to this document requires a harness update in the same change.
