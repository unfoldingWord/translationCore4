# tC4 Project Format Specification (BURRITO-SPEC)

**Version:** 1.8 · 2026-08-14 (Version 1.8 is the D48 flip change set: §8 becomes normative. It applies the seven issue-#22 contract corrections — pin-slot grammar per §5.3 with a golden projection test; the §5.1 extraction as the fold's only I-3 hash; actor-binding refusal; the same-actor linear rule; self-contained `book.add` with `scope`; out-of-band divergence detection for every derived shared file; `project.meta.set` never writes `type`. It adds `text.structure.apply` (#65, with the structural-lineage rule), `project.vrs.set` (immutable first-value register), the §8.1 sealed action-segment write model (D50), removal semantics per surface, the multi-key head-identity rule, the flavor boundary sentence, unjournaled-ingredient tolerance, and the `creation` seed source. It removes `textMd5`/`skeletonMd5` from `v: 1` (`targetVerseMd5` stays). Journal suite → 137 checks. Version 1.3 corrected the transport topology; J19–J20; journal suite → 59 checks. Version 1.4 encodes STATE decisions D25–D28: `ingredients/vrs.json` and the versification frame rule (§4.3, §5.2); scope range arrays, scope-filtered derivation, and partial-book legality (§3, §4.1, §4.2); stage rules S-1/S-2 made permanent — x-roles are non-durable by design and the client re-asserts them (§5.3, §6, §7); conformance suite → 30 checks. Version 1.5 promotes `extraScripture` gateway source pins to normative (§5.3 — D10/OPEN-QUESTIONS #13); conformance suite → 31 checks, Stage-1 27. Version 1.6 lands the D17/D30 two-language-set pin schema — §5.3 `schemaVersion` 2 with `languageSets.primary/fallback` (tn+twl+tw+tA each), the (tool, book) resolution record + cross-language re-attach rule in §5.2 (OPEN-QUESTIONS #28); conformance suite → 33 checks, Stage-1 29. Version 1.7 adds the carry-over rule (§5.2 — D36, 2026-08-04): the resource is the primary key, and a decision that neither re-attach pass can place is invalidated and retained, not queued for review; conformance suite → 34 checks, Stage-1 30.)
**Status:** Normative for Phase 1 **and for §8** (journal + publication topology). §8 became normative on 2026-08-14 with the D48 flip change set (this version; issue #22). The checks include the transport, end-to-end against the live server (OPEN-QUESTIONS #23 closed 2026-07-18).
**Audience:** implementers (human or AI). If you are new, read PLATFORM-NOTES.md first.
**Conformance language:** MUST / MUST NOT / SHOULD / MAY per RFC 2119.
**Reference implementation:** `conformance/sample-burrito/` (a conforming project) and `conformance/` (34 executable conformance checks [VERIFIED 2026-08-14 — the D48 flip change set: 34/34 + journal 137/137]). Both live in `conformance/` in this repository (published per issue #47, D48). If this document and the harness disagree, the harness is wrong. The harness MUST be fixed to match this document. Then this document's version bumps.

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
      journal/<actorId>/segments/<encoded-ts>.action.json  role x-journal — Phase 2 write form (§8.1)
      journal/<actorId>/<BOOK>.<seq>.jsonl      role x-journal — Phase 2, read-compat only (§8.1)
      journal/<actorId>/_project.<seq>.jsonl    role x-journal — Phase 2, read-compat only (§8.1)
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
- **Check item lists** (groupsData/groupsIndex): derived from the pinned tN/tW TSVs + the original-language book, then merged with stored decisions (§5.2 identity key). Derivation MUST filter items to the project's scope (§3 rule 4): an out-of-scope item is never derived, counted, or shown. Progress = decided ÷ derived-total, where the derived total counts **in-scope** items only [decided 2026-07-30 — D26; harness check: derive honors scope]. The TSV→items derivation is owned by the client's `derive/` module (versioned TSV parsing + the tN category map). The RCL's own helpers (`twlTsvToGroupData` / `tsvObjectsToGroupData`) are the contract/parity reference; whether they also serve as a headless runtime dependency is OPEN-QUESTIONS #14. **Proof status:** the harness proves the derive+merge mechanism and progress reconstruction on a miniature TSV defined inside the suite, and the app-level proof runs on REAL published resources [VERIFIED 2026-08-03 — whole-Titus slices of en_tn v86 / en_twl v86 / es-419_tn v66 + the en_ta v86 toc, vendored from the pinned sb-zips; the product repo's `test/derive-full-strength.test.ts`, 20 checks; `evidence/derive-full-strength-2026-08-03.md`]. OPEN-QUESTIONS #14/#15 are closed: the RCL helpers cannot import headless — contract/parity reference only.
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
- Phase 2: the journal carries this file's exact bytes once, in the creation/seed
  segment (`project.vrs.set`, §8.5). Checkpoints project the file verbatim (§8.7).

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

A project is conforming when `conformance/`'s checks pass against it. The suite has **34 checks in three groups**:

- **Stage-1 — path-authoritative conformance (30 checks).** Schema validity; ingredient integrity; versification (`vrs.json` presence, shape, scope coverage, role); scope grammar (whole-book `[]` + range arrays, with negative controls); targetBible derivability; alignment round-trip + staleness guard; selections validity + invalidation firing; decision-shape completeness incl. the additive `status` field; derive+merge progress reconstruction; scope-filtered derivation with the in-scope progress denominator; cross-language re-attach with groupId tiebreak + irreducible ambiguity left unplaced (D17); carry-over invalidation of unplaceable decisions (D36); multi-book scope; two-language-set pin completeness (D17/D30 §5.3 shape); (tool, book) resolution records + the two-rung coverage ladder; extraScripture source pins (§5.3 entry shape, unique ids, `sha` grammar); zaln export; verse-span key semantics. These checks pass on today's pankosmia-web unmodified.
- **Stage-2 — role/relationships durability (2 checks).** Role-tagged ingredients and native SB `relationships`. The sample carries both, schema-valid. A server metadata regeneration still drops the `x-` **roles** — the scan rebuilds the table from disk, and roles are not derivable from bytes — the **accepted condition** [decided 2026-07-30 — D28], not a pending upstream fix. `relationships` **survives** regeneration at ≥0.18.5 [VERIFIED — `evidence/rig-rebaseline-0.18.5-2026-07-30.md`; it was dropped at ≤0.18.3]. So a server-rescanned copy scores Stage-2 **1/2** at the current pin (the pristine sample scores 2/2). Stage 1 treats paths as authoritative (S-2, permanent), and the client re-asserts its roles after each regeneration (§6 W-2).
- **Phase-2 — journal-merge design (2 checks).** The two-actor `metadata.json` merge conflict and the §8.7 derived-file rule that resolves it, exercised in a disposable git repo.

The **journal conformance suite** (§8.9; 137 checks, J1–J30 per Appendix A) validates the full §8 semantics, the publication topology, and the intake rejection rules separately: `npm run validate:journal`. Both suites: `npm run validate:all`.

Run: `npm install && npm run validate` (`.npmrc` handles the required `legacy-peer-deps`).

## 8. Phase 2: the event journal (NORMATIVE — ratified per D48, 2026-08-14)

This section defines the Phase 2 format completely, and it is **normative**. The owner conditionally ratified the architecture as D48 (2026-08-14); the flip conditions — the seven issue-#22 contract corrections, `text.structure.apply` (#65), the flavor boundary, the D47(d) supersession note, and the published harness (#47) — landed together in the version 1.8 change set. Every normative statement below maps to an executable check in the journal conformance suite (`conformance/validate-journal.mjs`; plan: Appendix A). The Phase 2 *app* work (fold/sync/review UI) remains gated per D47(c); the journal **write side** ships in 4.0.0 (issue #52).

When Phase 2 ships, journals become canonical. `<BOOK>.usfm`, the checking sidecars (§5.1–5.2 shapes), and `metadata.json`'s `ingredients` table all become **derived, committed** artifacts. Checkpoints regenerate them from the fold, so the repo remains a normal Scripture Burrito for every other tool. Everything in §§3–5 remains valid for reading.

### 8.1 Files and actors: immutable sealed action segments

**The write model (D50): every mutation publishes as one immutable, checksum-sealed action segment.** The HTTP boundary has no append, no rename, and no fsync ([VERIFIED — `post_raw_ingredient.rs` is a whole-file `std::fs::write` with `.bak`-then-replace]), and a rewrite-to-append would put accepted history inside the crash window. So `v: 1` writers MUST NOT append to or rewrite any journal file. Each store mutation — single-event included — writes one new segment file, never modified after acceptance.

- Segments live under `ingredients/checking/journal/<actorId>/segments/`, one file per action:
  `<encoded-ts>.action.json`, where `<encoded-ts>` is the action's first event `ts` with each `:` replaced by `_` and each `|` replaced by `,`. The full §8.2 `ts` alphabet was audited against Windows filename rules and the §2 ingredient-path constraints: `:` and `|` are the only reserved characters a `ts` carries (`|` is also §2-forbidden); every other `ts` character (digits, `-`, `T`, `.`, `Z`, lowercase hex, `[a-z0-9-]` actor slugs) is legal on both. `_` and `,` never occur in a raw `ts`, so the escape is **injective and reversible**. The escaped characters sit at fixed positions (§8.2 fixed-width fields), so filename sort equals `ts` sort within an actor directory. The encoded name cannot collide with a Windows reserved device name (it always starts with a 4-digit year) and never ends in a dot or space (it ends `.json`).
- **The action-container contract.** A segment file is one JSON document:
  `{"container": 1, "body": "<string>", "sha256": "<hex>"}` — `body` is the action JSON, serialized exactly once as a string; `sha256` is computed over the UTF-8 bytes of that exact body string. The body parses to `{"events": [event, …]}`: all events of ONE store mutation. The action shape is part of the contract — the array MUST be non-empty, the events MUST be in strictly ascending `ts` order, and every event MUST carry one and the same actor (the directory's, which intake and readers bind). Writers MUST refuse to seal an action violating the shape, and readers MUST treat a segment violating it as invalid — an empty or mis-ordered action is malformed, not tolerable. **Multi-scope actions are allowed**: one segment MAY carry `_project`-scope and book-scope events together (one action, one file — this dissolves the cross-stream atomicity problem).
- **Size limit:** 4 MiB per segment file. A structural action on a whole book fits with headroom; anything larger is a design smell surfaced early. Readers MUST treat an oversize segment as invalid.
- **Parse/checksum validity IS the commit marker.** Validation: parse the outer document → verify `container: 1` → verify the sha256 over the body-string bytes → parse the body. A crash mid-write leaves a file that fails this chain; readers MUST treat the ENTIRE segment as unpublished — all-or-nothing from a plain, non-atomic whole-file write. There is no half-published action. Readers MUST surface an invalid segment (report or refuse) — a reader MUST NOT silently drop one.
- **Writers never overwrite an accepted segment.** At an existing segment path: a byte-identical rewrite is an idempotent accept (a retry after a lost acknowledgement); a DIFFERENT valid action at the same path MUST be rejected; an invalid existing file may be replaced ONLY through the staged-intent recovery below, after the staged bytes themselves validate.
- **Validation behavior is asymmetric on purpose (D50):**
  - a LOCAL invalid segment with durable staged intent (the owning installation's outbox — installation-local, never registered, never committed) → the owner republishes the staged bytes; the republished segment MUST be byte-identical to the staged action;
  - a local invalid segment with no staged intent → the action never happened; report incomplete and project the pre-action state;
  - an INCOMING segment (sync intake) that fails validation → **reject the contribution loudly** (zero-trust posture, J20) — never silently ignored, never partially integrated.
- **Durability posture (owner risk ruling, D50):** process-crash atomicity is guaranteed (sealed segments + staged intent); power-loss durability is detected but not guaranteed (no fsync at the HTTP boundary; the §8.8 out-of-band classification catches survivors). The platform durability primitive is a non-blocking owner-routed upstream question.
- **Read-compat only: legacy NDJSON streams.** Readers MUST also accept the pre-1.8 stream form — `<BOOK>.<seq>.jsonl` / `_project.<seq>.jsonl`, one event per line, LF-terminated, `<seq>` 5 digits from `00001`, read in order — including the torn-tail rule: ignore a final line that is not valid JSON; invalid JSON anywhere except the final line is corruption and the fold MUST refuse with a clear message. Readers MUST mark each event read from this form (`legacy` — reader-attached, never written): the mark is what carries the §8.5 generation-stamp exemption, so a segment-borne event can never claim it. `v: 1` writers MUST NOT produce this form. Non-owning actors never modify another actor's files.
- `<actorId>` = stable per-install slug, `[a-z0-9-]{4,32}` (MUST NOT contain `|`), generated from a UUID at first run. A device MUST only ever write under its own `<actorId>`. `journal/<actorId>/actor.json` records `{schemaVersion: 1, actorId, displayName, device, createdAt}`. `actorId` MUST match the directory, and every event in the directory MUST carry that actor (§8.3 actor binding). `displayName`/`device` are OPTIONAL and user-controlled (a pseudonym is fine: journals sync to DCS, and actor metadata is exactly the identity-exposure surface the sensitivity posture covers — PRD FR-33).
- **Journals are permanent history.** There is no compaction, rewriting, or pruning in `v: 1`. The fold's correctness depends on the full event set, and git history keeps it anyway. The tradeoff of one file per action is explicit (D50): roughly one segment per save, so hundreds per book of active drafting — git and the platform rescan handle that scale; if file count ever bites, compaction arrives as a versioned ritual (§9), never an ad-hoc rewrite. A side benefit: journal files are never rewritten, so the platform's `.bak`-on-rewrite behavior never touches the journal directory.
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
 "seed": {"source": "creation|sidecar-migration|out-of-band-usfm|tc3-import", "batch": "<ts>"},  // OPTIONAL
 /* ...op-specific fields (§8.5) */ }
```

- **Actor binding (refusal rule):** `actor` MUST equal the actor field of `ts`, and both MUST equal the `<actorId>` directory that carries the event. The fold MUST refuse an event whose `actor` differs from its `ts` actor; intake MUST reject a contribution whose events name a different actor than their directory.
- `base` — per target key: the `ts` of the previous live event on that key that this op observed (`null` for the first write to a key). Two live events on one key with the same `base` from **different actors** = a **fork**. Same-actor events are totally ordered by `ts` and never fork: when an event's `base` matches no live head but a live head carries the same actor, the event advances that actor's head linearly (the fold rule in §8.6 step 3 — an actor cannot fork against itself).
- `supersedes` — a resolution event names the head(s) it replaces. The review queue emits it (or reconcile does, §8.8).
- `batch` — the `ts` of the first event of the same user action. A save whose editing unit is larger than one verse (a translator's section, §8.4a) emits one event per changed verse; all share a `batch`. Readers MAY use it to group related events (e.g. present per-verse forks of one section as a single review item). `batch` never affects fold state — grouping is presentation, the fold stays per-key.
- `seed` — marks migrated/imported data. In every other respect, a seeded event is an ordinary event (there is no separate `seed.import` op).
- Version policy (mirrors §9): a line with unknown `v` or unrecognized `op` MUST cause the fold to refuse with a clear message (new ops bump `v`; additive optional *fields* do not).

### 8.4 The book decomposition: skeleton + verse slots

The journal must be able to regenerate the *entire* USFM file byte-exactly. Thus the book is decomposed into exactly two kinds of state:

- **Verse content** — for each verse key: every byte after the `\v <key> ` marker, up to the next `\v ` or `\c ` marker (or end of file). Inline markup (footnotes, character styles) and inter-verse paragraph markers (`\p`, `\s5`, …) that *follow* a verse belong to that verse's content. Verse keys are strings and MAY be spans (`"4-5"`), with the §5.2 span identity rules.
- **The skeleton** — everything else: front matter (`\id`, `\usfm`, `\h`, `\toc*`, `\mt*`, …), `\c N` lines, and the `\v <key> ` markers themselves, with each verse's content replaced by a slot. (This subsumes the earlier draft's `text.headers.set` — header edits are skeleton edits.)

Recomposition (skeleton + verse map → file) MUST be byte-identical for any input file: `recompose(decompose(usfm)) === usfm` (J2, property-tested over aligned, exotic, span-keyed, and `\ts\*`-chunked corpora). The slot delimiter is `U+0001`, reserved: source files that contain `U+0001` MUST be rejected. A consequence of the content rule, stated plainly: to add or remove a paragraph break between verses is an edit to the *preceding verse's* content. To renumber, add, or remove verses or chapters is a **structural change**: it changes the slot set, and it MUST use `text.structure.apply` (§8.5). `text.skeleton.set` is restricted to slot-preserving edits (headers, chapter formatting), and it is an **ordinary chain link** — the same lineage rule as `text.structure.apply`: its `base` MUST name the predecessor skeleton head (a `book.add`, `text.skeleton.set`, or `text.structure.apply` of the same book; the first skeleton always comes from `book.add`, so `base` is never null). The link inherits its base's structural ancestry — there is no historical-base branch, no implicit rebasing, and no ancestry reconstruction, so an accepted slot-preserving edit can never move the selected chain or drop verse content (the byte invariant: every current verse projection stays byte-identical). The fold MUST refuse: a null `base`; a `base` that is not a skeleton head of the book; a slot sequence differing from the base's (`text.structure.apply` is the only slot-changing op); and a `base` the SAME actor's own head has already advanced past (a writer defect — a skeleton edit cannot silently reverse a `text.structure.apply`). Cross-actor same-base competitors **fork** (an explicit §8.3 conflict, branch-coherent, surfaced for review). An unknown `base` (not yet in the union) is **pending** until it arrives — the pre-event state projects, and fold determinism stays per event-SET, never per arrival order.

#### 8.4a Drafting by section vs checking by verse (translator's sections)

unfoldingWord drafting *presents* verses in **translator's sections** (multi-verse chunks), while checking and alignment work **per verse**. Two facts keep these compatible:

- **Sections are presentation only, and they are not stored in the target text** (clarified by the project owner, 2026-07-07). The drafting UI derives its section grouping at load from the pinned *source* text's `\ts\*` milestones (ULT/UST carry them). The fallback ladder when the source has none: `\p` paragraphs, then per-verse [PROPOSED — validated live in tc4-POC-2, 2026-07-16: `docs/evidence/tc4-poc2-learnings-2026-07-16.md`]. The target draft never contains `\ts\*` (§4.1). There is no section object in the format and no section op in the vocabulary.
- **A section save decomposes into one `text.verse.set` per *changed* verse; all share a `batch` (§8.3).** The journal's conflict unit stays the verse — finer than the drafting unit. Thus two people who draft *different* verses of the same section never conflict. A drafter-vs-checker collision forks only on the verse that both actually edited. The `batch` id lets the review queue present per-verse forks of one section save as a single item.

Robustness note (not a target-text feature): the codec treats any milestone bytes as ordinary content. An *imported* file that carries `\ts\*` round-trips byte-exactly (J2/J16), and plain-text extraction ignores milestones. Thus milestones can never leak into checked text or false-invalidate anything (§8.5).

### 8.5 Operation vocabulary (complete)

| op | scope / key | payload (beyond envelope) | fold rule |
|---|---|---|---|
| `text.verse.set` | (book, chapter, verseKey) | `{book, chapter, verse, text}` | LWW register with fork detection |
| `text.skeleton.set` | book | `{book, skeleton}` | **Ordinary chain link** (§8.4): `base` MUST name the predecessor skeleton head (never null); the link inherits its base's structural ancestry; **slot-preserving only** relative to that base — the fold MUST refuse a slot-set, key, or ordering change (use `text.structure.apply`) and a base the same actor's own head advanced past; cross-actor same-base competitors fork; an unknown base is pending until it arrives |
| `book.add` | book | `{book, scope, skeleton, initialVerses}` — **self-contained**: `scope` is `[] \| range[]` (§3 rule 4); `skeleton` is the initial §8.4 skeleton; `initialVerses` maps slot keys to initial content (a missing slot projects the `___` stub) | book exists if latest add/remove head is add. One event creates the whole slot topology and stub state: it sets the skeleton head AND one verse head per slot, each with the `book.add` `ts` as head identity (the multi-key rule below). `scope` projects into `type.flavorType.currentScope` at checkpoints (§8.7) |
| `book.remove` | book | `{book}` | LWW vs `book.add`; content events for absent books fold but don't project |
| `text.structure.apply` | book (the skeleton key — concurrent structural edits fork exactly as §8.3 intends) | `{book, skeleton, transitions, dispositions}` — `skeleton` is the new §8.4 skeleton; `transitions` maps EVERY destination slot key to `{text, sources}`: its required final text (merge/split content is stated, never inferred) and `sources` = immutable references `[{key, ts}, …]` to every affected live source head; `dispositions` = explicit handling for dependent records on the source keys, each `{surface: "alignment"\|"decision"\|"note", key?, ts, action: "re-key"\|"replace"\|"invalidate-retain"\|"orphan-review", to?, post?}` | **All-or-nothing.** Apply only when every referenced source `ts` is present in the union and live on this branch; a missing reference reports `incomplete`, a stale one reports `conflicted` — either way the fold projects the pre-operation state unchanged (no partial projection, no lost records, no `___` stubs, no guessing). **Dispositions MUST be complete:** the fold computes the affected-record set — every live alignment, decision, and verse-targeted note on a mapped source key (a key that is re-keyed, or removed from the base skeleton), **invalidated records included** (`invalid: true` / `invalidated: true` records are retained state per D36, never dead state) — and an event that leaves any of them without exactly one disposition is `incomplete` (pre-operation state retained). **Dispositions are CONSTRAINED to that same set:** a disposition referencing a record outside the computed affected set MUST refuse the whole event (all-or-nothing) — without this bound, a structural action mapping one verse could carry a disposition that consumes any unrelated live record in the book. A `decisionKey`-targeted note on a **re-keyed** decision is an affected record too: its §5.2 identity retires with the re-key, so it needs a disposition (re-key to the new identity string, or orphan-review); `invalidate-retain`/`replace` keep the decision's identity, so such notes stay valid without one. Malformed events (a transition key missing from the new skeleton, a destination slot without a transition, one source head claimed by two transitions, duplicate or conflicting dispositions for one record) refuse the fold. **Fork effects are branch-local** (the lineage rule below). Every produced post-image takes this event's `ts` as head identity (the multi-key rule) |
| `project.vrs.set` | per-project singleton | `{name, bytes}` — `bytes` is the exact raw `ingredients/vrs.json` content (§4.3), stored verbatim so byte-equivalence is testable | **Immutable first-value register**, not LWW (same-actor linearity must not allow a silent frame replacement): the first value by `ts` binds; an identical repeat de-duplicates; ANY different later value — regardless of actor or base — is rejected by writers and surfaced by the fold, never applied. `v: 1` writers emit it only within the creation/seed segment. Projection writes the bytes verbatim (§8.7) |
| `align.verse.set` | (book, chapter, verseKey) | `{book, chapter, verse, alignments, wordBank, targetVerseMd5, generation}` (§5.1 shapes, I-2 integers; `generation` = the book's generation root per the "Book generations" rule below — never part of the projected §5.1 record) | LWW; **valid only while `targetVerseMd5` = the md5 of the §5.1 plain-text extraction of the folded verse content (I-3)** |
| `check.decision.set` | §5.2 identity key | `{toolId, decision, generation}` (full §5.2 record incl. `status`; `generation` per the "Book generations" rule below) | LWW with fork detection |
| `note.add` | — (grow-only) | `{target, text, generation}`; `target` is exactly one of `{book, chapter, verse}` (a verse) or `{decisionKey}` (a §5.2 identity-key string); `generation` per the "Book generations" rule below | grow-only set (additive; no LWW). Notes are permanent in `v: 1` — no delete/edit op; hiding is app-local state. They project into fold output only (no sidecar mirror; export is an app decision) |
| `resource.pin.set` | pin slot | `{slot, entry}`, or the removal form `{slot, removed: true}`. **The slot grammar is the §5.3 document's own paths** (the fold refuses any other slot): `languageSets.(primary\|fallback).(gatewayLanguage\|translationNotes\|translationWordsLinks\|translationWords\|translationAcademy)`, `resources.(originalLanguage\|lexicon).(nt\|ot)`, `extraScripture.<id>` | LWW with fork detection. Pin events are the merge identity for resource state: checkpoints project the folded pins into the §5.3 `resources.json` document deterministically (byte-equivalent — the golden projection test, J26). A removed slot projects to absence; `extraScripture` entries keep the order of each id's first pin event |
| `project.meta.set` | JSON path | `{path, value}`, or the removal form `{path, removed: true}` (folds to absence); `path` is dot-separated object keys, arrays not addressable in `v: 1` (e.g. `identification.name.en`) | LWW per path; applied as an overlay after metadata regeneration (§8.7). **MUST NOT target the derived/fixed roots `format`, `ingredients`, `type`, `meta`** — the fold refuses such events with a clear message. `type` in particular: `type.flavorType.currentScope` is reconstructed at checkpoints from folded `book.add`/`book.remove` scope state (§8.7) — `project.meta.set` never writes `type` |
| `settings.set` | settings path | `{path, value}`, or the removal form `{path, removed: true}` (folds to absence) — dot-separated path into the §5.4 document, e.g. `checkCategories.translationWords`, `ui.paneSettings` | LWW per path with fork detection — §5.4 `settings.json` becomes a derived mirror at checkpoints; without this op it would be the last shared mutable file (the `metadata.json` bug class) |

There are no other ops in `v: 1`. Document structure lives in verse content, the skeleton, and `text.structure.apply` (§8.4). Nothing else is needed to reproduce the project. The `v: 1` vocabulary froze with this ratification (D48): `text.structure.apply` and `project.vrs.set` entered it in the same change set that made §8 normative — before any `v: 1` writer existed — so no written journal predates them. From here on, the §8.3 version policy binds: a new op bumps `v`.

**Multi-key head identity (normative).** Any event that produces multi-key post-images — `book.add` and `text.structure.apply` — confers its own `ts` as the initial head identity for **each** produced key. A subsequent event on a produced key uses that `ts` as its `base`. One lineage rule, two ops, no special cases.

**Book generations (normative — causal, never a timestamp cutoff).** A `book.add` `ts` is the book's **generation root** (it already confers head identity per slot). After a `book.remove`, a later `book.add` of the same code starts a NEW generation. Generation membership is CAUSAL: `align.verse.set`, `check.decision.set`, and `note.add` payloads carry a `generation` field — the `ts` of the book's rooting `book.add` as the WRITER projects it at write time (seeding stamps the seed's own `book.add` `ts`, §8.8; writers MUST stamp it). The fold quarantines a record whose `generation` differs from the current generation root **regardless of the record's `ts`**: an HLC cutoff cannot implement quarantine, because a still-offline actor's edit of a prior-generation record arrives with an arbitrarily LATER `ts` than the re-add — the stamp decides, not the clock. A `decisionKey`-targeted note belongs to the book named inside its §5.2 identity-key string (`checkId|bookId|chapter|verse|occurrence` — the fold parses `bookId` out of the key), so such notes quarantine exactly like verse-targeted ones; they carry `generation` like every note. A quarantined record **does not project**: it is retained and reported for review (`prior-generation`) — quarantine, not resurrection, not deletion (the D36 posture). **Omission is malformed, never a bypass:** the fold MUST refuse an `align.verse.set`, `check.decision.set`, or `note.add` event without `generation` — with exactly two exemptions, both identifiable at read time: a seed-sourced event (`seed` present, §8.8) and an event read from a legacy read-compat stream (§8.1), which the READER marks (`legacy` — a reader-attached field, never written; a sealed segment whose events carry it is invalid). Only those exempt events use the lineage/`ts` fallback: a structural ancestor outside the current chain, or no ancestor and a `ts` that does not postdate the generation root, quarantines (best effort only). `generation` is fold bookkeeping: it MUST NOT appear in any projected §5.1/§5.2 record or derived file. Current-generation records are untouched by the rule.

**The structural-lineage rule (normative — the #65 ruling).** Every subordinate post-image produced by `text.structure.apply` has the structural event's `ts` as its head identity. Subsequent events use that `ts` as their `base` and inherit that structural branch. **Descendants project only with their selected structural ancestor; descendants of an unselected structural branch remain retained for review** — a losing branch's moves and edits never leak into the winner's projection (exclusion is by ancestry, not by guesswork). Structural chains are ordinary head lineage: a second `text.structure.apply` bases on the first. Note dispositions identify notes by their originating event `ts` (the grow-only set's identity is the event, not a key).

**Removal semantics per surface (normative — JSON `null` is not absence).**
- **Decisions are never deleted** (D36): there is no removal form for `check.decision.set`. An unwanted decision is written back with `invalidated: true` and `status: "invalid"` — the full record is retained.
- **Alignment removal** is an explicit empty-state payload: `align.verse.set` with `alignments: []`, `wordBank: []`, and the current `targetVerseMd5` — a defined record, never absence and never `null`.
- **Settings and project-metadata removal** use the unset form `{path, removed: true}`, which folds to absence in the projected document.
- **Pin removal** uses `{slot, removed: true}` within the §5.3 slot grammar.
- **Verse and book removal** are structural: `text.structure.apply` and `book.remove`.

**The flavor boundary (normative).** The `v: 1` vocabulary is **textTranslation-shaped**. Other content flavors (textStories/OBS) extend the vocabulary by a version bump per §9 — `v: 1` writers need no rework when OBS arrives.

**Unjournaled ingredient classes (normative).** `ingredients/audio/` (§2) — and any future registered-but-unjournaled ingredient class — is canonical on disk but outside the `v: 1` vocabulary. Such files are **tolerated**: they are never counted as out-of-band divergence (§8.8), and checkpoints never regenerate or delete them (§8.7 — checkpoint regeneration touches only journal-derived files).

**INVARIANT I-4: NFC on write.** Writers MUST normalize all text they journal — verse content, skeletons, note text, decision strings — to Unicode NFC before they hash or write (matching `meta.normalization` in §3). Rationale: NFC and NFD bytes of *visually identical* text hash differently. That difference would manufacture phantom forks and false alignment invalidations. This matters most for non-Latin scripts (OPEN-QUESTIONS #19). The fold does not re-normalize — normalization is a write-side duty.

**Text vs. plain text (normative).** `text.verse.set.text` carries the verse's **full content slot** (§8.4 bytes — including trailing `\p`, `\s5`, `\q*`, inline footnotes, and any imported milestones), so structure survives verse edits. All *validity* hashing — `align.verse.set.targetVerseMd5`, selections revalidation — uses the **§5.1 plain-text extraction** of that content (I-3), never the raw bytes. The §5.1 extraction is the fold's ONLY validity hash: an implementation MUST NOT accept or substitute an alternative hash function. (`textMd5` and `skeletonMd5` were removed from `v: 1` in the 1.8 change set — they added no identity beyond `ts`/`base`; `targetVerseMd5`, which carries I-3, is a different field and stays.) Consequence (J16): a structure-only edit (a moved paragraph break, a stripped imported `\ts\*`) does not invalidate the verse's alignments or checks; an edit to words does.

### 8.6 The fold (normative algorithm)

Input: the union of all actors' journal events (all sealed segments, plus all read-compat `<seq>` files). Algorithm:

1. Validate and de-duplicate by `ts` (identical events may arrive via multiple copies — J13). Refuse: unknown `v`, unrecognized `op`, an `actor` that differs from the `ts` actor (§8.3 actor binding), two different events sharing one `ts`.
2. Sort by `ts` (plain string compare; total order per §8.2).
3. For each event in order, update its key's state:
   - **grow-only** ops accumulate. `project.vrs.set` follows its own first-value rule (§8.5).
   - **LWW** ops: if the event's `base` equals the `ts` of one live head, it **advances that branch** (it replaces exactly that head — a continuing edit on a forked key advances its own branch without resolving the fork). If it `supersedes` all current live heads, it resolves the key to itself. If neither, but a live head carries the **same actor**, the event replaces that actor's head(s) linearly (§8.3: same-actor events are totally ordered by `ts` and never fork). Otherwise it *joins* the live-head set as a fork; this includes a `base` that references an event not in the union (partial sync).
   - **`book.add`** additionally creates the skeleton head and one verse head per slot, each identified by the `book.add` `ts` (§8.5 multi-key rule).
   - **`text.structure.apply`** first checks applicability (§8.5): every referenced source `ts` present and live → apply (new skeleton head; post-image heads per transition, identified by the event's `ts`; dispositions applied; consumed source heads are shadowed on this branch). Missing reference → report `incomplete`; stale reference → report `conflicted`; either way the event does not become a head and the pre-operation state projects unchanged.
   - **Fork bookkeeping:** a key with >1 live heads *on the selected structural branch* is forked. If all such heads carry byte-identical payloads, the fold auto-merges them (highest `ts` becomes the single head; no review item — identical outcomes need no human). Otherwise the fork is surfaced in the fold output's `forks[]`, and the projection uses the highest-`ts` head **flagged provisional** — visible, never silent.
4. Project: per book, select the winning skeleton head; its structural ancestry (the chain of `book.add`/`text.structure.apply` events it descends from) is the **selected structural branch**. A head whose structural ancestor is outside that chain does not project — it is reported in `retained[]` for review (the §8.5 lineage rule). Recompose each existing book (skeleton + verse map, §8.4) — a skeleton slot with no live verse event projects as the untranslated stub (`___`, §4.1 convention); emit decision/alignment/settings structures (§5 shapes); project the folded pins as the §5.3 document and the vrs register as §4.3 bytes; reconstruct `scope` from folded `book.add`/`book.remove` state (`type.flavorType.currentScope`, §3 rule 4); apply the `project.meta.set` overlay; report `forks[]`, `retained[]`, rejected `project.vrs.set` events, incomplete/conflicted structural actions, and `invalid[]` for every alignment whose `targetVerseMd5` no longer matches the **§5.1 plain-text extraction** of the folded verse content (I-3; see §8.5 "Text vs. plain text" — the only hash). An alignment whose verse key has **no slot in the current skeleton** (the verse was removed or renumbered) is **orphaned** and reported in `invalid[]` regardless of its hash — the backstop for a dependent record that a structural action did not disposition.

**Determinism invariant (J3, property-tested):** the fold is a pure function of the event *set* — `fold(events) ≡ fold(any permutation/partition/duplication of events)`. Incremental or cached folds MAY exist but MUST equal the full fold.

### 8.7 Checkpoints, derived files, and the merge rule

A **checkpoint** (session close, book done, pre-sync — W-4) is this sequence: fold → write **all** derived files — `<BOOK>.usfm` recomposed; §5.1 alignment and §5.2 decision sidecar mirrors for Phase-1 readers; `resources.json` from the folded pin state (§5.3 shape, the deterministic projection of §8.5); `settings.json` from the folded settings state (§5.4 shape); `vrs.json` from the folded `project.vrs.set` register (§4.3, verbatim bytes) — → regenerate `metadata.json` ingredients (rescan; per-ingredient extras carry forward) → reconstruct `type.flavorType.currentScope` from the folded `book.add`/`book.remove` scope state (§3 rule 4) → apply the `project.meta.set` overlay (a removed path DELETES from the document) → `add-and-commit`. The §5.2 file-level `resource` resolution record and the disposable `summary` are derive-time state (D30/D36): the checkpoint recomputes them against the folded pins; they are not journal events. **The checkpoint's inputs are MANDATORY:** an implementation MUST refuse (fail loudly) rather than emit an incomplete derived set — a regeneration with no base `metadata.json` document, or a §5.2 decision file without its (tool, book) resolution record, is a defect, never a silently smaller checkpoint. That list is exhaustive: **every shared non-journal file is either regenerable from the fold or a tolerated unjournaled ingredient class** (§8.5 — `ingredients/audio/` and future registered-but-unjournaled classes, which checkpoint regeneration MUST NOT touch, regenerate, or delete). That property is what makes the merge rule below safe.

**Sync and integration — two local histories, one DCS project.** [Pankosmia scratch model VERIFIED — `docs/evidence/pankosmia-sync-model-2026-07-08.md`; topology and delayed-receive lifecycle VERIFIED in the reference suite — J19; app build and named-branch server capability pending]

Each device maintains two local git histories for the same logical project:

- **Working projection (`W`)** — the ordinary, fully conforming Scripture Burrito the UI opens. Checkpoints perform the full fold → derived-file regeneration → `add-and-commit` sequence above. Its commits are local recovery points, not submission commits. After collaboration begins, this repo is rebuildable from the journal union.
- **Actor publication history (`P`)** — a persistent local copy on branch `actor-<actorId>`, forked from the collaboration base. A commit on `P` MUST change only `ingredients/checking/journal/<actorId>/...`. It MUST NOT rescan metadata and MUST NOT regenerate or copy any derived file. The app appends the actor's own stream in `P` first, then mirrors those exact bytes into `W`. At checkpoint the app verifies `P`'s `git status` paths before `add-and-commit`, then checkpoints `W`. On open, if `P`'s own stream and `W` differ, `P` wins. J19 additionally verifies the resulting commit diff.

**Send without receive.** Send pushes only the current `actor-<actorId>` branch from `P`. Nobody else writes that branch. A translator may push A1, remain offline while main accepts B1, append A2 to the same actor stream, and push A2 as a fast-forward of the actor branch. A download of main is not a precondition. A working-projection branch MUST NOT be pushed as a contribution: J19 proves that its regenerated USFM/metadata conflict after main advances.

**Integrate in disposable scratch.** Start from current integration `main`/downloaded. Copy it to `_local_/_updates_/...`. Fetch the incoming actor branch. Merge that **explicitly named branch** in scratch. A valid app-produced publication branch changes only one disjoint actor directory, so the merge is clean. Then rescan in scratch (to discover and register newly arrived journal files) and compare scratch against pre-merge main: every non-journal byte and every other actor's journal byte MUST be unchanged, and inside the incoming actor's own directory intake is **whitelist-only** — the only additions or changes a contribution may carry are (a) NEW sealed action segments that pass the §8.1 container validation, carry only that actor's events, and are named by their first event's `ts`, and (b) an `actor.json` whose shape validates and whose `actorId` matches the directory. Everything else is rejected: modification or deletion of any accepted file (segments included), any new or changed legacy `.jsonl` bytes (read-compat streams are frozen at intake — `v: 1` writers publish only sealed segments), and any file outside the whitelisted shapes. Only after those checks pass may the app fold the complete union, regenerate every shared derived file, commit, and fast-forward integration `main`. Any dirty tree, unexpected changed path, merge conflict, invalid journal, failed fold, or failed regeneration deletes/quarantines scratch and leaves integration `main` untouched. `.gitattributes merge=ours` is not a safety mechanism and MUST NOT be relied on. J20 proves the rejection cases and the unchanged-main invariant.

**Receive by rebuild-and-swap, never by a merge into `W`.** Before receive, commit the complete own-actor stream in `P`. Build a fresh scratch from downloaded/current `main`. Merge the explicitly named local actor branch from `P`. Rescan, fold, regenerate, and verify that every event in `P` is present byte-identically in the result. Keep the old `W` untouched until the replacement opens and validates. Then atomically switch the app's project pointer, and retain the old repo as recovery material until the next successful checkpoint. To pull or merge main directly into the divergent full-checkpoint history of `W` is forbidden (J19 counterexample).

This protocol needs a **deterministic branch-targeted integration**. That is now verified against the live server with **existing endpoints only** (transport rig, 2026-07-18 @ 0.17.0 — `docs/evidence/transport-rig-2026-07-18.md`; 10/10): each actor's publication history lives in a **single-branch publication repo**, which makes `pull-repo` deterministic (exactly one head to merge). Multi-branch `pull-repo` was measured **ordering-steered** through the HTTP API (it merged the same branch regardless of the source repo's HEAD) and MUST NOT be used for branch selection. Two verified caveats bind implementations: (1) after a *normal* `pull-repo` merge the scratch **working tree is untrustworthy** — merge-added files are absent, merge-modified files may be stale on disk, and a subsequent `add-and-commit` commits deletions. Thus the integrator MUST write the validated journal union explicitly (ingredient writes of the accepted bytes) before it regenerates and commits, and intake validation MUST read from the merge commit, never the worktree (PLATFORM-NOTES #21). (2) `add-and-commit` panics on a commitless repo — publication repos are always born with an initial commit (PLATFORM-NOTES #20). The J19 delayed-receive lifecycle and J20 zero-trust intake both pass endpoint-for-endpoint on this topology. `npm run validate:transport` is the standing acceptance suite.

Executable proof: harness 26–27 and J12 demonstrate why merging full checkpoints conflicts and why derived files are safe to regenerate only after journal union. J18 proves disjoint journal trees compose with Pankosmia's scratch idea. **J19** proves the A1 → B1/main advances → A2-without-receive → later receive lifecycle. **J20** proves that clean-merging but invalid contributions are rejected without a change to main.

### 8.8 Reconcile (out-of-band edits) and seeding (migration)

- **Out-of-band divergence detection covers EVERY derived shared file.** At open/integration, the committed bytes of each §8.7 derived file — `<BOOK>.usfm`, the §5.1/§5.2 sidecar mirrors, `resources.json`, `settings.json`, `vrs.json`, and the metadata overlay — are compared against the fold's projection. The enumeration starts from the fold's expected file set, never from what happens to be on disk: a projected file that is ABSENT on disk (deleted out-of-band) is divergence too. A difference is out-of-band: it is reconciled (seed events, below) or stopped for review — **never silently overwritten**. Unjournaled ingredient classes (§8.5 — `ingredients/audio/`, future registered-but-unjournaled classes) are never counted as divergence.
- **Out-of-band USFM edit** (another tool edited the committed file): reconcile decomposes the committed file (§8.4). If the slot set is unchanged, it emits `text.verse.set`/`text.skeleton.set` with `seed: {source: "out-of-band-usfm"}` and `base` = the current live head — a linear supersede (the file edit is "the latest edit"). If the slot set changed, reconcile MUST emit `text.structure.apply` (§8.5) — it CAN emit a self-contained event because the on-disk USFM supplies every destination text — with **conservative and COMPLETE dispositions**: identity-where-possible mapping, and for every live alignment, decision, and verse-targeted note on a removed key, `invalidate-retain`/`orphan-review` — never guessed re-keys (§8.5 requires the complete set; an incomplete event would not apply). If another device concurrently edited the same verse in its journal, the union produces a fork and the review queue surfaces it. An out-of-band edit can never silently destroy a journaled one (J8).
- **Seeding is universal (D50), and it covers every surface:** a project with state but no journal gets seed events on first open — books with their ACTUAL per-book scope (§3 rule 4), text, complete §5.1 alignment records (every field, `sourceVersion` and `invalid` included), decisions, resource pins, settings, project metadata, and versification. Creation uses `seed: {source: "creation"}`; Phase-1 migration uses `sidecar-migration`: every sidecar record becomes one seeded event. `modifiedTimestamp` maps into the `ts` physical part (counter `0000`, actor = the migrating install). `targetVerseMd5` carries over. Every seeded alignment, decision, and note stamps `generation` = the seed's own `book.add` `ts` for its book (§8.5 Book generations), so a seeded project starts with every record in the current generation. The fold of the seeded journal MUST reproduce the pre-migration state exactly — every derived file, byte-for-byte (J15). Ordinary events follow.

### 8.9 Conformance (journal suite)

`npm run validate:journal` in `conformance/` (reference implementation under `journal/`) executes J1–J30 per Appendix A: HLC ordering/ratchet/overflow; skeleton codec byte-identity; fold determinism under permutation (property-based); LWW; fork detection incl. identical-content auto-merge; supersedes resolution; I-3 staleness composition; out-of-band reconcile; three-device convergence; sneakernet ≡ merge; read-compat rotation and torn tail; end-to-end two-actor git merge with regeneration; de-duplication; unknown op/version refusal; Phase-1 sidecar seed migration; section-vs-verse machinery; definitions closure; Pankosmia scratch behavior (J18); the actor-publication lifecycle (J19); zero-trust intake rejection with unchanged main, incl. invalid incoming segments (J20); the structural action with all-or-nothing semantics (J21); structural lineage, fork isolation, and retention (J22); sealed action segments (J23); staged-intent republication (J24); the vrs register (J25); the pin golden projection (J26); removal semantics per surface (J27); actor binding and the same-actor linear rule (J28); self-contained `book.add` and scope reconstruction (J29); and unjournaled-ingredient tolerance with whole-surface divergence detection (J30). The reference implementation is the contract for the Phase 2 app's `foldEngine`/`syncEngine` ports (ARCHITECTURE §9).

## 9. Spec evolution

Bump a sidecar's `schemaVersion` only for a breaking payload change. Readers MUST reject unknown major versions with a clear message. Additive optional fields do not bump the version. This document is versioned in git alongside the code. A change to this document requires a harness update in the same change.

---

## Appendix A — Journal conformance test plan (§8 companion)

Folded from `docs/JOURNAL-TEST-PLAN.md` 2026-08-10 [decided — D44(a)]: §9 already binds
the spec, this plan, and the suite to change in the same change set, so they are one
document. Content unchanged except heading levels.

**Version:** 1.2 · 2026-08-14 · companion to BURRITO-SPEC 1.8 §8 (the D48 flip change set adds J21–J30 and re-scopes J11 to read-compat streams; version 1.1 · 2026-07-10 accompanied 1.3-draft).
**Suite:** `conformance/validate-journal.mjs` (reference implementation: `conformance/journal/*.mjs`). Run: `npm run validate:journal`. Property tests use `fast-check` with a **fixed seed** (reproducible) plus 200 runs per property.
**Rule (spec §9):** any change to BURRITO-SPEC §8 changes this plan and the suite in the same change.
**Scope note:** this suite proves the *format semantics* via the reference implementation. It does not exercise the Phase 2 app (journalStore/sync/review-queue UI — M4, gated on M2/M3). The reference implementation is the contract that the app's `foldEngine` ports (ARCHITECTURE §9).

### Coverage map — spec clause → tests

| ID | Spec | What is proven | Kind |
|---|---|---|---|
| J1 | §8.2 | HLC: string compare = temporal order (fixed-width); the counter increments within one ms and resets on advance; overflow past `ffff` bumps the physical ms; the receive-ratchet makes every new local `ts` > every `ts` seen | unit + property (ordering over random event streams) |
| J2 | §8.4 | Skeleton codec: `recompose(decompose(usfm))` is **byte-identical** for the sample corpus (TIT, JON), an aligned `\zaln`/`\w` fixture, a span-keyed (`\v 4-5`) fixture, and a structure-rich fixture (`\s5`, multi-paragraph verses, `\f` footnote); `U+0001` in source is rejected; verse map keys are strings incl. spans | golden + property (random verse-content mutations still recompose exactly) |
| J3 | §8.6 | Fold determinism: `fold(events)` ≡ `fold(shuffled)` ≡ `fold(union of partitions)` ≡ `fold(events + duplicates)` — deep-equal projections, forks, invalids | property |
| J4 | §8.5/§8.6 | LWW linear history: on one key, a later event with `base` = the prior head replaces it; state = latest by `ts`; this applies to verse, skeleton, decision, pin, project.meta | unit |
| J5 | §8.3/§8.6 | Fork detection: two actors, same key, same `base`, different payloads → both live, `forks[]` reports the key with both heads, the projection = the highest-`ts` head flagged provisional; **identical payloads auto-merge** (no fork entry — the OPEN-QUESTIONS #16 same-content case, now two distinct events by identity that merge deliberately, not accidentally) | unit |
| J6 | §8.3/§8.6 | Resolution: an event with `supersedes: [both heads]` empties the fork; a plain edit that continues one branch does NOT resolve it; superseded events remain in history (journals are append-only) | unit |
| J7 | §8.5 align + I-3 | Staleness composition: an align event is valid while `targetVerseMd5` matches the folded text; a later `text.verse.set` on that verse flips the alignment into `invalid[]`; a re-alignment against the new text clears it | unit |
| J8 | §8.8 | Out-of-band reconcile: hand-edit the projected USFM → reconcile emits seeded `text.*.set` with `base` = the live head → the fold equals the edited file (linear supersede); if another actor's journal edit on the same verse joins the union, a fork surfaces — the out-of-band edit never wins silently | scenario |
| J9 | §8.1/§8.6 | Three-device convergence: A and B edit disjoint verses offline; C integrates; all three folds are byte-identical, with zero forks | scenario |
| J10 | §8.1/§8.7 | Sneakernet ≡ merge: a union of journal *files by copy* and a union via git merge produce the same fold input and identical projections | scenario |
| J11 | §8.1 (read-compat) | Legacy-stream reading: events that span `00001`/`00002` fold as one stream; a torn final line is ignored; invalid JSON mid-file refuses with a clear message. `v: 1` writers do not produce this form; readers MUST accept it | unit |
| J12 | §8.7 | End-to-end git: two actors branch from a real burrito, checkpoint real journals, a naive merge conflicts on derived files → resolve-either-side + **regenerate-post-union from the real fold** → a two-parent commit; both journals are present; the regenerated USFM is identical no matter which side was taken; the ingredients table matches disk | scenario (extends harness checks 26–27) |
| J13 | §8.2/§8.6 | De-duplication by `ts`: the same journal file, contributed twice (copy scenarios), changes nothing | unit |
| J14 | §8.3 | Version policy: unknown `v` or unrecognized `op` → the fold refuses with a clear message (no crash, no silent skip) | unit |
| J15 | §8.8 | Seed migration, two layers: (a) `sample-burrito`'s real sidecars (decisions + alignments) → seeded events → the fold reproduces the §5-shape state exactly (decision records deep-equal; alignment payloads deep-equal; `targetVerseMd5` carried); (b) **full state on a PARTIAL-SCOPE fixture**: `fold(seed)` reproduces EVERY derived file byte-for-byte — actual per-book scope, pins, settings, project metadata, versification, and complete §5.1 alignment fields (`sourceVersion`, `invalid`); the fixture carries an `invalid: true` alignment AND an `invalidated: true` decision — they seed byte-exactly, fold correctly (I-3 reports the stale one), and pass through a structural action with retention intact | golden (real sample + partial-scope fixture) |
| J16 | §8.4a, §8.5 "Text vs. plain text", §8.3 `batch` | Drafting-by-section vs checking-by-verse. The target text carries no `\ts\*` (sections are presentation, derived from the source — §4.1/§8.4a); the tests prove the machinery around that: (a) *imported* files that carry `\ts\*` round-trip byte-exactly (also a J2 corpus fixture), and the milestones land in skeleton/preceding-verse content; (b) a structure-only edit (e.g. an edit that strips an imported milestone) does NOT invalidate the verse's alignment, while a word edit DOES (I-3 hashes the §5.1 plain-text extraction, not raw bytes); (c) a section save = per-verse events that share a `batch`; only the double-edited verse forks; the fork heads carry the `batch` id so the review queue can group per-verse forks into one section-level item | golden + unit |
| J17 | §8.5 `settings.set` / `project.meta.set` / `note.add`, §8.6 step 4, I-4 | Remaining-definitions closure: `settings.set` folds LWW-per-path, and the §5.4 state projects from the fold (no shared mutable settings file is left); `project.meta.set` on a reserved root (`format`/`ingredients`/`type`/`meta`) refuses with a clear message, while allowed paths fold; an alignment whose verse slot was removed from the skeleton is **orphaned** → `invalid[]` regardless of hash; the NFC≠NFD md5 demonstration that motivates I-4 (writers MUST normalize); both `note.add` target shapes (verse ref, decisionKey) accumulate grow-only | unit |

| J18 | §8.7 + `docs/evidence/pankosmia-sync-model-2026-07-08.md` | Integration with Pankosmia's transport (real git). Mirrors their `PullFromDownloaded` copy→scratch→`add_remote`→`pull-repo`→conflict-check choreography: over disjoint per-actor journals the scratch merge is clean (their conflict-abort never fires), and two translators' concurrent same-book edits converge with zero forks; the identical transport on a shared whole-file same-line edit **conflicts** — the case their model aborts on, which the journal removes | scenario (real git) |
| J19 | §8.7 publication topology | The exact delayed-receive lifecycle (real git): A publishes A1 from an actor branch whose commits touch only A's journal; B publishes, and main regenerates while A remains offline; A continues in a separate full working projection and publishes A2 without a receive of B; named-branch scratch integration preserves A2+B with no conflict. The counterexample proves that a merge of A's full working projection conflicts. Receive then rebuilds and validates a replacement from current main + A's publication history, and leaves the old working repo untouched until the swap. | scenario (real git) |
| J20 | §8.7 intake validation, §8.1 | Zero-trust contribution intake after a clean scratch merge: reject changes to any shared/non-journal path, edits to another actor's stream, and enforce the §8.7 **whitelist**: the only accepted additions/changes inside the incoming actor's directory are valid new sealed segments (container-validated, actor-bound, named by their first event `ts`) and a well-formed `actor.json`; everything else is rejected — modification of any accepted segment, any invalid incoming segment, ANY new or changed legacy JSONL bytes (frozen at intake), a malformed `actor.json`, and arbitrary files. Prove that the accepted main HEAD and the projection remain byte-identical, because all validation occurs in disposable scratch. | adversarial scenario (real git) |
| J21 | §8.5 `text.structure.apply` | The structural action, all-or-nothing: span create (`9,10 → 9-10`), span break, renumber; permutation determinism including partial arrival; a missing source reference reports `incomplete` and the pre-operation state projects unchanged; a stale source head (concurrent verse edit) reports `conflicted`, pre-operation state unchanged; malformed events (transition key not in the new skeleton; a destination slot without a transition; one source claimed twice; duplicate/conflicting dispositions for one record) refuse the fold; **dispositions must be complete** — omitting one for a live alignment, decision, or verse-targeted note on a mapped key makes the event `incomplete` (pre-op state retained); reconcile (§8.8) emits the complete conservative set for all three surfaces; INVALIDATED records are affected records too — omitting one refuses the event, a re-keyed invalidated record keeps its flags; a `decisionKey`-targeted note on a re-keyed decision needs a disposition and re-keys to the new identity (an invalidate-retain decision keeps its identity, so its notes need none); I-3 evaluates honestly on moved verses; **dispositions are constrained to the affected set (round 4)** — a disposition for an unrelated live record (alignment or note on an unmapped key) refuses the whole event and the record still projects | unit + property |
| J22 | §8.5 lineage rule | Structural lineage: post-images take the structural event's `ts` as head identity; sequential structure changes chain as ordinary head lineage; two concurrent structural actions fork on the skeleton key with **branch-local effects** (a losing branch's moves never leak); edits on both sides of a structural fork project only under their own ancestor, losing-branch descendants land in `retained[]`; notes are retained across a renumber (re-key disposition rewrites the target; an undispositioned note survives grow-only); a late-arriving alignment on a removed key (which no earlier structural event could disposition) falls to the §8.6 orphan backstop; `text.skeleton.set` is an ordinary chain link (**the round-5 simplification** — subsumes the round-4 stale-base refusal and the round-5 byte-loss finding): a null base refuses, an unknown base is pending until it arrives (event-SET determinism proven), a slot change vs the base refuses, a same-actor base older than the actor's own head refuses (no silent reversal of a `text.structure.apply`), a cross-actor same-base competitor forks explicitly with branch-coherent bytes, and the byte invariant holds — an accepted chain-linked edit leaves every verse projection byte-identical | unit |
| J23 | §8.1 sealed segments | The action-container contract: a valid segment round-trips; the filename is the first event's `ts` with `:` → `_` and `\|` → `,` and sorts in `ts` order; **filenames are legal on Windows AND under §2 (round 3)** — no reserved character (`< > : " / \\ \| ? *`), no reserved device name, no trailing dot/space, the §2 charset holds, and the escape is injective (every risky `ts` character round-trips write→read); a torn/checksum-failing segment is invisible **as a whole** (no partial action ever folds); the 4 MiB limit; multi-scope actions (`_project` + book events) in one segment fold correctly; segment events MUST carry the directory's actor. Writer immutability: byte-identical rewrite = idempotent accept, a different valid action at an existing path is rejected, an invalid file is recovered only via verified staged-intent republication; readers NEVER silently drop an invalid segment (the default surfaces it); **the action SHAPE binds too (round 4)** — empty events, mis-ordered or duplicated `ts`, and mixed actors are each invalid to readers AND refused by the writer's seal (one firing case per §8.1 MUST) | unit |
| J24 | §8.1 asymmetric validation | Staged-intent (outbox) republication: after a local torn segment, republishing the staged bytes produces a byte-identical segment and the fold equals the no-crash fold | unit |
| J25 | §8.5 `project.vrs.set`, §8.7 | The immutable first-value register: the first value binds; an identical repeat de-duplicates; a different second value is surfaced and never applied (regardless of actor/base); projection reproduces `ingredients/vrs.json` byte-exactly from the stored raw bytes | golden + unit |
| J26 | §8.5 `resource.pin.set`, §8.7 | The pin golden projection: pin events under the §5.3 slot grammar project to a byte-equivalent §5.3 `resources.json`; an out-of-grammar slot refuses the fold; `{slot, removed: true}` projects to absence | golden + unit |
| J27 | §8.5 removal semantics | Per surface: decisions are never deleted (no removal form; invalidate-and-retain keeps the record); alignment removal is the explicit empty-state payload, projected as a record, not absence; `settings.set`/`project.meta.set` `{path, removed: true}` fold to absence; byte-exact fold equality across a removal | unit |
| J28 | §8.3 actor binding, same-actor rule | The fold refuses an event whose `actor` differs from its `ts` actor; intake rejects a directory/actor mismatch; a same-actor event with a stale/absent `base` advances linearly and never forks against itself (the §8.3:334 rule the fold previously lacked) | unit |
| J29 | §8.5 `book.add`, §8.7 scope | Self-contained `book.add`: one event creates the slot topology and stub state; every produced head carries the `book.add` `ts` (multi-key rule); a checkpoint reconstructs `type.flavorType.currentScope` (§3 rule 4) from folded scope state, `[]` and range-array forms both. **Book generations:** remove + re-add quarantines prior-generation alignments/decisions/notes — retained and reported (`prior-generation`), never silently resurrected, never deleted; current-generation records are untouched. **Generations are CAUSAL (round 3):** the `generation` stamp decides, never the HLC — a still-offline actor's LATER-`ts` edit of a prior-generation record stays quarantined; a current-generation stamp projects; the stamp never leaks into projected records; universal seeding stamps the seed's own `book.add` `ts`; **omission is REFUSED (round 4)** — a v1 align/decision/note event without the stamp refuses the fold (all three ops), the fallback survives only for reader-marked legacy and seed-sourced events, and a sealed segment carrying the reader-reserved `legacy` field is invalid; **decisionKey-targeted notes quarantine too (round 3)** — the fold parses the `bookId` out of the §5.2 identity-key string, so a note with no `target.book` cannot slip the filter (field-less fallback AND stamped later-`ts` forms both quarantine; a current-generation one projects) | unit |
| J30 | §8.5 unjournaled classes, §8.7/§8.8 | The checkpoint regeneration set is EXHAUSTIVE (USFM, alignment + decision sidecars, resources, settings, metadata with reconstructed scope); divergence detection covers every derived shared file and enumerates from the fold's expected set — an out-of-band sidecar edit AND a deleted derived file are both detected, never silently repaired; `ingredients/audio/` files are tolerated: never divergence, never in the regeneration set; **checkpoint inputs are MANDATORY (round 4)** — `derivedProjections` THROWS on a missing base metadata document or a missing (tool, book) resolution record instead of returning an incomplete checkpoint; with complete inputs every decision file carries its §5.2 `resource` | unit |

### Acceptance

- All J1–J30 pass — `npm run validate:journal` exits 0, and the suite's own summary line is the authoritative count (it grows with each review round; historically: 59 at 1.7-draft, 137 at the initial 1.8 flip change set) — **and** the Phase 1 suite still passes untouched (`npm run validate`, 34/34 as of the 1.7-draft D36 carry-over change set [VERIFIED 2026-08-04]; 33/33 at the 1.6-draft D17/D30 change set; 31/31 at the 1.5-draft extraScripture change set; 30/30 at the 1.4-draft edits; 27/27 before that), **and** `npm run validate:all` runs both.
- A property failure prints the fast-check counterexample + seed. Any counterexample is a spec or implementation defect — file it against §8, and fix spec+suite together (§9).

### Out of scope (tracked elsewhere)

- Phase 2 app components: journalStore append/rotate under real I/O, the sync engine, the review-queue UI (BACKLOG M4; the TEST-PLAN of the guided build when M4 opens).
- Fold performance on multi-year journals (measure alongside OPEN-QUESTIONS #9's methodology when M4 opens).
- Multi-project/DCS end-to-end sync (BACKLOG E4.3 scenarios).
