# tC4 Project Format Specification (BURRITO-SPEC)

**Version:** 1.9 · 2026-08-24 (1.9: the sha is a pin's identity — §5.3 pin and extraScripture entries require `sha` with `version` an OPTIONAL display label, §5.2 resolution records match by (repoPath + sha) (D58, completed by D59); R-8.8.2 amended: universal seeding is content-exact with record order as byte form, and a sidecar the checkpoint projection cannot represent (an unknown top-level field, or co-present §5.2 records on one identity key) MUST refuse the seed (D56); conformance suite → 35 checks, Stage-1 30, journal suite → 336. History: 1.8 2026-08-18: §8 write format + fold invariants ratified per D55 — sealed action segments replace the NDJSON stream form (D50), structural action + book generations added (#65/D48), base:null semantics (D53), prefix-collision rule (D54), textMd5/skeletonMd5 removed (D48), sync operations status-marked [PROPOSED]; rule ids [R-…] added with coverage enforced by conformance/normative/check.mjs. History: 1.7-draft 2026-08-04: Version 1.3 corrected the transport topology; J19–J20; journal suite → 59 checks. Version 1.4 encodes STATE decisions D25–D28: `ingredients/vrs.json` and the versification frame rule (§4.3, §5.2); scope range arrays, scope-filtered derivation, and partial-book legality (§3, §4.1, §4.2); stage rules S-1/S-2 made permanent — x-roles are non-durable by design and the client re-asserts them (§5.3, §6, §7); conformance suite → 30 checks. Version 1.5 promotes `extraScripture` gateway source pins to normative (§5.3 — D10/OPEN-QUESTIONS #13); conformance suite → 31 checks, Stage-1 27. Version 1.6 lands the D17/D30 two-language-set pin schema — §5.3 `schemaVersion` 2 with `languageSets.primary/fallback` (tn+twl+tw+tA each), the (tool, book) resolution record + cross-language re-attach rule in §5.2 (OPEN-QUESTIONS #28); conformance suite → 33 checks, Stage-1 29. Version 1.7 adds the carry-over rule (§5.2 — D36, 2026-08-04): the resource is the primary key, and a decision that neither re-attach pass can place is invalidated and retained, not queued for review; conformance suite → 34 checks, Stage-1 30.)
**Status:** Normative for Phase 1. §8's write format and fold invariants (§8.1–§8.6, §8.7's checkpoint/derived-file half, §8.8) are **NORMATIVE** [decided 2026-08-18 — D55, closing OPEN-QUESTIONS #10/#16]. The sync operations (§8.7's marked block) remain [PROPOSED]; their ratification is Phase 2. All of §8 is tested with executable checks, including the transport end-to-end against the live server (OPEN-QUESTIONS #23 closed 2026-07-18).
**Audience:** implementers (human or AI). If you are new, read PLATFORM-NOTES.md first.
**Conformance language:** MUST / MUST NOT / SHOULD / MAY per RFC 2119.
**Reference implementation:** `conformance/sample-burrito/` (a conforming project) and `conformance/` (the Phase-1 suite plus the journal suite — each suite’s own summary line is the authoritative check count [VERIFIED 2026-08-18 at the 1.8 ratification change set: 35/35 + journal green; historically 34/34 + journal 59/59 at the Increment-2 close, 2026-08-07]). Both live in `conformance/` in this repository (published per issue #47, D48). If this document and the harness disagree, the harness is wrong. The harness MUST be fixed to match this document. Then this document's version bumps.

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
      journal/<actorId>/segments/<encoded-ts>.action.json   role x-journal — sealed action segments, the ONLY stream form (§8.1)
      journal/<actorId>/actor.json                           role x-journal — actor record (§8.1)
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

### 4.3 `ingredients/vrs.json`

The versification scheme of the project. The platform writes this file at project creation
(`new_text_translation.rs` [VERIFIED — pankosmia-web 0.18.5 (99fd9be, 2026-07-30); the
mechanism is unchanged 0.16.18→0.18.5]). Rules:

- The file holds the **full chosen scheme** in the platform's vrs-to-JSON shape: `maxVerses`,
  `mappedVerses`, `excludedVerses`, `partialVerses`. The platform ships six schemes
  (`eng, lxx, org, rsc, rso, vul`) and serves them at `GET /content-utils/versification[s]`
  (evidence: `docs/evidence/pankosmia-versification-2026-07-30.md`).
- **The ingredient carries NO `role`** [corrected 2026-08-24 — issue #15]. An earlier version
  of this section required `role: "x-versification"`. Nothing writes it: the platform's
  creation endpoints register the ingredient with `checksum`, `mimeType` and `size` only, tC4's
  own writer sets no role, and no published burrito uses ingredient roles at all (five sampled
  on `git.door43.org/BurritoTruck` — none carry a role of any kind, on any ingredient). The
  requirement described nothing real, so it is withdrawn; the harness now checks that the
  ingredient is present and scheme-shaped. Evidence:
  `docs/evidence/versification-format-and-frames-2026-08-24.md` §6–§7.
- New projects default to **`eng`**. The user MAY select a different scheme at creation
  [decided 2026-07-30 — OPEN-QUESTIONS #26]. The scheme is fixed for the life of the project.
- `maxVerses` MUST cover every book in `currentScope` (harness check: versification).
- **The scheme's NAME is not recorded in the burrito.** The platform takes the name as a
  creation parameter, uses it only to select a template file, and discards it. So a reader
  cannot learn the scheme from `metadata.json` or from this file's own contents. tC4 resolves
  the name through a source ladder — the §8.5 `project.vrs.set` register first (which carries
  the name tC4 passed at creation), then a **normalized** fingerprint of this file against the
  served schemes, then `unknown`. The fingerprint MUST compare canonical form, not bytes:
  published burritos re-serialize the same scheme with different key order and whitespace.
  A project whose scheme cannot be established is `unknown` and MUST NOT be treated as `eng`;
  absence of this ingredient carries no information either (three of five sampled burritos omit
  it, and one that includes it is `eng`).
- **`mappedVerses` maps this scheme's references INTO `org`.** `org` is therefore the pivot for
  any scheme-to-scheme conversion: forward through the source scheme's table, then backward
  through the target's. The client builds the reverse table itself; no file stores it.
- **`mappedVerses` values MAY be a single range string or an ARRAY of range strings.** The
  array form expresses a one-to-many mapping. Readers MUST accept both (cf. the two TWLink
  forms in §5.3). Every shipped scheme is currently string-valued.
- The client MUST NOT edit this file after creation. Conversion between frames is a client
  concern — see §5.2 for the frame rule. The server never maps a reference; `maxVerses` is the
  only key any platform code reads [VERIFIED — pankosmia-web 0.18.7 (c43c40d, 2026-08-11),
  read 2026-08-24; `evidence/versification-format-and-frames-2026-08-24.md` §6].
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
  "resource": {"repoPath": "git.door43.org/es-419_gl/es-419_twl", "version": "v18", "sha": "c2d9547ec95e40c2ba085c597b127c94733feb8a", "languageSet": "primary"},   // the (tool, book) resolution record — §5.3 (identity = repoPath + sha, D58)
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
- **Versification frame rule** [decided 2026-07-29 — D24(c); implemented and amended
  2026-08-24 — issue #15]: `reference.chapter` and `reference.verse` — here, in check items,
  and in every stored ref — are in the **project's chosen versification** (§4.3). Resource
  references map INTO the project frame **at derive time**, before scope filtering, before
  merge, and before anything is written.

  - **One source frame.** Every unfoldingWord resource that feeds a check list is in the
    **`eng`** frame — the helps TSVs *and* the original-language texts. Measured over 194,080
    tN references across eight gateway languages, 58,834 TWL references, and 1,189
    original-language chapters: zero references contradict `eng` [VERIFIED — sweep run
    2026-08-24; scripts and per-resource tables in
    `evidence/versification-format-and-frames-2026-08-24.md` §§2–4 and
    `evidence/e33-frame-sweep-tsv.py` / `e33-frame-sweep-usfm.py`]. (`hbo_uhb` PSA 3 ends at
    verse 8, where `org` would number the superscription and have 9.) An earlier draft of this
    rule assumed helps were `eng` and original-language texts were `org`; that was wrong.
  - **Same frame ⇒ no conversion.** When the resource frame equals the project frame the
    reference passes through **unchanged**. This is normative, not an optimization: composing
    `eng → org → eng` loses 3 verses of the 66-book canon that an unmapped reference gets
    right, so an `eng` project — the default, and the frame of the whole resource suite — MUST
    NOT be mapped. Pass-through is also UNVALIDATED [decided 2026-08-24 — D60]: the reference
    keeps the resource's own form (`front` chapters, comma lists, letter verses — real en_tn
    rows carry all three), because a same-frame project computes nothing that needs numbers.
    Only a genuine cross-frame conversion rejects such forms as `malformed-reference`; journal
    identity safety stays at the §8.5 grammar.
  - **The mechanism** is Proskomma's versification toolkit (`mapVerse` and the succinct
    mapping functions). tC4 does not build a mapper; it takes `proskomma-core` as a direct
    dependency and loads it **lazily**, so a project that needs no conversion never fetches it
    [decided 2026-08-24]. The toolkit is present in two platform clients but NOT on tC4's
    dependency path, so tC4 depends on it directly — an earlier version of this sentence said
    it was "shipped client-side in the platform", which is true of those clients and not of
    tC4.
  - **Write once.** A mapped reference is produced at derive time and never re-derived from a
    stored reference: it is both the §5.2 identity key and the §8.5 journal register key, and
    the journal is append-only. Where the runtime needs the reference in another frame — the
    aligner reading the original-language verse behind a project-frame draft reference — that
    is a **lookup**, and its result MUST NOT be written into any key. §5.1 alignment records
    stay keyed in the project frame.
  - **Unplaceable references are dropped, never guessed.** A mapping result MUST be validated
    against the target scheme's own `maxVerses` before it becomes an identity. A result below
    verse 1, past a chapter's last verse, in a chapter the scheme lacks, split across chapters,
    or ambiguous is **unplaceable**: the check is omitted from the list with a recorded reason,
    and MUST NOT be journaled. An unplaceable check leaves the progress **denominator** as well
    as the list, so a project can still reach 100% — it is not work the translator declined, it
    is work that does not exist in this numbering. A reader MUST surface the count; silently
    shrinking the denominator is not permitted.
  - **Fan-out becomes a span when contiguous** [decided 2026-08-24]. The reverse mapping is
    one-to-many where two source verses collapse onto one pivot verse. When the resulting
    target verses form one unbroken run they are written as the span (`"67-68"`); a gapped
    fan-out stays unplaceable, because a span would claim the verses in the gap.
  - **Known losses, for reference.** Against `en_tn@v90` (84,158 verse-shaped check rows in
    56 books; 990 `front`/`intro` rows are the scheme-independent D60 drop and are excluded):
    `rsc` loses 8 rows (PSA 116:10, PSA 147:12, REV 12:18), `rso` loses 13 (those plus
    PSA 87:1), `lxx` 81, `vul` 1,067 — the last dominated by Esther's differing chapter
    structure. An `eng` project loses none and maps nothing [VERIFIED — sweep run 2026-08-25
    with `evidence/e33-tn-loss-sweep.mts` (committed; it calls the client's own
    `mapReference`); output in `evidence/versification-format-and-frames-2026-08-24.md`,
    "Addendum (2026-08-25)"].
  - **Scheme names are open.** The set of schemes is whatever the platform serves
    (`GET /content-utils/versifications`), not a fixed list. A reader MUST NOT reject a scheme
    for being unfamiliar; an unrecognised name resolves through §4.3's ladder like any other.
- Only *touched* checks are stored. An item with no stored decision is "unchecked". That is the representation of not-done.
- **Identity key (normative, for merge/upsert):** `(contextId.checkId, reference.bookId, reference.chapter, reference.verse, contextId.occurrence)`, with `quoteString` as a verification field. Writers SHOULD reject a key match whose quoteString differs — that difference means the resource changed; treat the record as unmatched. tN `quote` word-arrays MUST be preserved as arrays. **Chapter and verse compare as strings** (`String(...)` both sides): a single verse is its decimal string; a span verse is the exact span string (`"9-10"`). Never `Number()`-coerce (harness check 24). `reference.verse` itself stays a JSON number for single verses (tC3 convention) and is the span string for spans.
- `selections` semantics: `false` = none; `[]` is not used — empty coerces to `false` (RCL convention, verified). "Done" = `selections !== false || nothingToSelect === true`.
- **`status`** (OPTIONAL, additive — decision D2, 2026-07-06): explicit triage state, one of `"valid" | "invalid" | "todo"`. When `status` is absent, readers derive it: `invalidated` ⇒ `invalid`; done (rule above) ⇒ `valid`; else `todo`. A writer that sets `invalidated: true` MUST NOT leave `status: "valid"` in place. The field is additive-optional, so `schemaVersion` stays 1 (§9). Harness check 25.
- `verseEdits`/`invalidated` carry the re-review state that tC3 kept in timestamped marker files; the marker files are retired.
- **Resolution record** [decided 2026-07-12/2026-07-30 — D17/D30; landed 2026-07-31; identity re-based on sha 2026-08-22 — D58]: `resource` records the repo the book's check list derived from — tN: the set's `translationNotes` pin; tW: the set's `translationWordsLinks` pin. It MUST equal exactly one rung's pin in §5.3 `languageSets` (repoPath + sha; `version` rides along as the display label). The OPTIONAL additive `languageSet` field (`"primary" | "fallback"`) names that rung; when present it MUST agree with the pin match. A change to a book's resolution is a warned update, never silent. Harness check: `resolution: §5.2 files record the resolved (tool, book) resource...`.
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
      "translationNotes":      {"repoPath": "git.door43.org/unfoldingWord/en_tn",  "version": "v86", "sha": "c354b8ae66a23c485bf6f38fd35bd8f7ef81e4e5", "flavor": "parascriptural/x-bcvnotes"},
      "translationWordsLinks": {"repoPath": "git.door43.org/unfoldingWord/en_twl", "version": "v86", "sha": "570e76d0024c847689e48a20e2ac1a1d2c6eb6e3", "flavor": "parascriptural/x-bcvarticles"},
      "translationWords":      {"repoPath": "git.door43.org/unfoldingWord/en_tw",  "version": "v87", "sha": "eaeb7bfefcf84132d0cbcbed185f3ea2be3d86dd", "flavor": "parascriptural/x-bcvarticles"},
      "translationAcademy":    {"repoPath": "git.door43.org/unfoldingWord/en_ta",  "version": "v86", "sha": "c7caddfb474efd713f36b35a3ffc927866c7b180", "flavor": "peripheral/x-peripheralArticles"}
    }
  },
  "resources": {                        // language-set-independent pins
    "originalLanguage": {
      "nt": {"repoPath": "git.door43.org/unfoldingWord/el-x-koine_ugnt", "version": "v0.34", "sha": "fc95b2b8aad08bb65ab54628ab685413a1139e97", "flavor": "scripture/textTranslation"},
      "ot": {"repoPath": "git.door43.org/unfoldingWord/hbo_uhb", "version": "v2.1.30", "sha": "106a441a788d9465846cd427538ea80b8cec6770", "flavor": "scripture/textTranslation"}
    },
    "lexicon": {
      "nt": {"repoPath": "git.door43.org/unfoldingWord/en_ugl", "version": "v0.5", "sha": "8fa6eb60c0fe7afa61a80264c7326d63db5f1e70", "flavor": "peripheral/x-lexicon"},
      "ot": {"repoPath": "git.door43.org/unfoldingWord/en_uhl", "sha": "db0098f3582814066f1a69c0aa2743a3ad0e8c81", "flavor": "peripheral/x-lexicon"}
    }
  },
  "extraScripture": [
    {"id": "ult", "repoPath": "git.door43.org/unfoldingWord/en_ult", "version": "v89", "sha": "84c73ba00fc8a95a9033f9efb14bb905a2a52ee4", "flavor": "scripture/textTranslation"},
    {"id": "ust", "repoPath": "git.door43.org/unfoldingWord/en_ust", "version": "v89", "sha": "37ec223166bbd73fb55abc7840be8310c0fee7f2", "flavor": "scripture/textTranslation"}
  ]
}
```

- This file replaces the per-book `version_manager.json` that the current checks client writes. **The `sha` field is the pin's IDENTITY** [decided 2026-08-22 — D58]: every repo pin entry MUST carry `sha` (40 lowercase hex — the pinned commit, from the export's own `metadata.json` `identification.primary.<authority>[...].revision`). A release tag is not enforced upstream — anyone can name a tag anything — so `version` is an OPTIONAL display label (non-empty when present, shown to the user for reference, never compared as identity). The fetch path for SB-form resources is the DCS sb-zip export [decided 2026-07-25 — OPEN-QUESTIONS #24]: the import requests `/sb/<tag>.zip` by tag (fetching still speaks the tag language) and verifies the export's commit SHA against the pin ([VERIFIED — `evidence/sb-zip-zaln-2026-07-25.md`]: the export preserves `\zaln` byte-identically).
- **Two language sets** [decided 2026-07-12 — D17; landed in this schema 2026-07-31 — OPEN-QUESTIONS #28]: `languageSets` MUST contain exactly the keys `primary` and `fallback`. Each set pins a coherent helps suite at explicit commits (D58): `translationNotes` (tn), `translationWordsLinks` (twl — the per-book TSV that check lists derive from, §4.2; its book coverage defines tW coverage), `translationWords` (tw articles), `translationAcademy` (tA). `fallback.gatewayLanguage.languageId` MUST be `"en"` — the suite that ships with the install. The twl slot is required for deterministic derivation and coverage resolution (spec-editor derivation from D17's "resolved per (tool, book) by coverage" + §4.2; the tn/tw/tA set list is D17 verbatim). Upstream models it the same way: the uW developer guide treats TWL as a first-class per-book helps resource — a sibling of tN, with tW as the dictionary "Referenced by TWL" — and every RC manifest `relation` array lists `<lang>/twl` separately from `<lang>/tw` [VERIFIED — `uW-Tools-Collab/docs/2-unfoldingword-developer-guide.mdx` §8 + ecosystem tree, read 2026-07-31]. Note: the pins record **provenance per tool input**, not a two-repo requirement. Both slots MAY name the same repo at the same version — and for tW they normally DO. **Fetch path** [decided 2026-08-03 — D34, amending D32]: for the tW tool a project pins and fetches **`<lang>_tw` only**. That repo's DCS sb-zip export already carries both halves — the per-book TWL link TSVs and the `payload/` articles — so `translationWordsLinks` and `translationWords` name the same repo; `<lang>_twl` is not fetched. [VERIFIED 2026-08-03 — `unfoldingWord/en_tw` `/sb/v87.zip` = 66 TWL TSVs + 954 articles; `es-419_gl/es-419_tw` `/sb/v37.zip` = 66 TSVs + 1056 articles; `docs/evidence/tw-twl-sbzip-combined-2026-08-03.md`.] tC4 never combines resources itself (D32 unchanged); the combining is DCS `go-rc2sb`'s. **Readers MUST accept both TWLink forms.** Every DCS **sb-zip export** rewrites links to the repo-relative form (`./payload/kt/son.md`) — measured on both `en_tw` v87 and `en_twl` v86, 100% of rows [VERIFIED 2026-08-03]. The `rc://*/tw/dict/bible/kt/god` form appears in the **RC source branches** (which tC4 does not fetch) and in **tC3-era stored decisions**, so readers still meet it. In both forms the article slug is the last path segment (drop any `.md`) and the tW category is the segment before it. The twl `flavor` value is what the DCS sb-zip export declares [VERIFIED — en_twl v86 export metadata, 2026-07-31: `parascriptural/x-bcvarticles`; `docs/evidence/es419-suite-pins-2026-07-31.md`].
- **Resolution** [decided 2026-07-30 — D30, constraints (1)–(3)]: the resolution unit is **(tool, book)**. A book's check list derives from ONE resource at ONE version. Per-check language mixing inside a book never occurs. The automatic ladder is exactly two rungs: `primary` → `fallback`, by book coverage of the pinned version. Any other language is an explicit whole-project gateway-language change (warned re-derive; no per-book language picker). The project's pins bind **every** opener — a personal language preference never changes the project's resources. The resolved rung is recorded per (tool, book) in the §5.2 decision file (`resource` field); a book's resolution change is a warned update, never silent.
- **Missing pinned version** [decided 2026-07-30 — D30, constraints (4)–(5)]: online → the app fetches it (sb-zip + SHA, OPEN-QUESTIONS #24), never a warn-toward-invalidation dialog. Offline → that (tool, book)'s checking is **unavailable as a first-class state**, not an error; drafting, other books, and other tools continue. The user MAY explicitly re-pin to a locally available version — warned, with re-derive and carry-over (§5.2 D36: unplaceable decisions are invalidated, not queued) — but the app never forces it.
- **Per-pin book coverage** [decided 2026-08-07 — D41; implemented 2026-08-24 — issue #16]: every repo pin MAY carry `books`, the uppercase book codes that exact commit contains. The field is **OPTIONAL and additive**, so `schemaVersion` stays 2 (§9).

  - **Recorded at pin time**, while the resource is local and its real contents can be read. Because a pin's identity is `repoPath` + `sha` (D58) and that content can never change, a recorded list is a **fact about that commit**, not a cache: it does not go stale, and a reader MUST NOT shrink or replace one. A reader MAY **widen** a record with books a local read of the **same** `repoPath` + `sha` proves present [decided 2026-08-24 — D61]: a record captured from a partial copy (a single-book sideload, an interrupted install) is incomplete, and each added book is a fact about the same commit. Widening MUST only add book codes; it MUST NOT remove any.
  - **Why it exists.** Without it, coverage can only be derived from what is installed, so "this resource does not contain this book" and "this resource is not downloaded yet" are indistinguishable, and both resolve down the ladder to English. Recorded coverage separates them, which makes these three states distinct for a (tool, book):
    - coverage recorded and it **includes** the book → resolve to that pin. Not local ⇒ **fetch** (online) or **unavailable** (offline). The user is never silently moved to another language.
    - coverage recorded and it **excludes** the book → fall back to the next rung. This is plainly correct and MUST NOT be warned: nothing is being substituted.
    - **no** coverage recorded and the resource is not local → genuinely unknown. Open the fallback and **warn**, naming the pinned resource that is missing.
  - **Precedence.** A pin's own `books` outranks any locally-derived coverage, because it remains true when the resource is absent. A recorded **empty** array is NOT a record — it cannot be told apart from a failed capture — and MUST fall through to the local scan.
  - **Backfill** [decided 2026-08-24 — owner ruling]: on project open, a reader SHOULD record coverage for any pin that lacks it **and whose resource is local**, which converts a project pinned before this rule once. The same pass SHOULD widen an incomplete record from a sha-exact local read (rule above), so a record captured from a partial copy heals once the full resource is present. A pin whose resource is absent MUST be left alone; inventing coverage for it would defeat the distinction above. The backfill MUST be idempotent and MUST run under the same compare-and-swap as any other write to this file.
  - The warned fallback is therefore a **migration path**, not a steady state: after one open with the resource present, it stops firing for that pin.
- **schemaVersion 2** is a breaking change from the single-set shape (§9: readers MUST reject unknown major versions with a clear message). A `schemaVersion: 1` file (the Increment-1 writer's shape) migrates mechanically: its `gatewayLanguage` + `resources.translationWords/translationNotes/translationAcademy` become the `fallback` set (they pin the installed English suite), `primary` is initialized equal to `fallback` until the user picks a gateway language, a `translationWordsLinks` pin is added, and `originalLanguage`/`lexicon`/`extraScripture` carry over unchanged. Updating the product writer to schemaVersion 2 is the first Increment-2 resource task (it still writes the v1 shape; journey j01 asserts that as the Increment-1 shape, not as this section's shape).
- Deterministic derivation (§4.2) depends on these pins: same pins ⇒ same check lists ⇒ saved decisions always re-attach. An intentional resource upgrade re-derives. Unmatched decisions are invalidated and retained (§5.2 D36); they never silently persist as progress.
- **Stage rule S-1 (permanent** [decided 2026-07-30 — D28]**):** this file is **authoritative**, and `metadata.json.relationships` is a mirror. Upstream models `role` and `relationships` ([VERIFIED — pankosmia-web 0.18.5 (99fd9be, 2026-07-30): `structs.rs`]), and at ≥0.18.5 the `relationships` mirror **survives** regeneration in practice [VERIFIED — `evidence/rig-rebaseline-0.18.5-2026-07-30.md`; dropped at ≤0.18.3]. Authority does not move: durability is re-measured at each pin change, and the client-owned file stays the source of truth. The earlier plan — that `relationships` becomes authoritative and this file retires — is withdrawn. Do not ask upstream for more.
- **Watch — Pankosmia roadmap #160** (OPEN-QUESTIONS #20): the platform builds a native "essential/recommended resources per project" + burrito-linking mechanism (with metadata-schema changes). When that mechanism lands, the resource-pin home may become that native mechanism, not this sidecar and not a hand-rolled `relationships` block. Align to it; do not diverge. [PROPOSED — watch; 0/50 epic opened 2026-07-09]
- **`extraScripture` (normative):** a drafting project SHOULD pin its gateway source texts in an `extraScripture` array. Each entry is `{id, repoPath, sha, flavor}` plus the OPTIONAL `version` display label — the same grammar and semantics as the main pins (D58: `sha` required, 40 lowercase hex, verified at import). `id` is a short slug for the pane (`"ult"`, `"ust"`); ids MUST be unique in the array. `flavor` is the SB flavor of the pinned source (`scripture/textTranslation`). Readers use `extraScripture` to fill the source panes. Absence is legal: a project without source panes omits the array. [decided 2026-07-06 — D10/OPEN-QUESTIONS #13; promoted to normative 2026-07-30 in the Increment-1 change set (checklist C1b.1)]

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

A project is conforming when `conformance/`'s checks pass against it. The suite has **35 checks in three groups** (the suite's own summary line is the authoritative count):

- **Stage-1 — path-authoritative conformance (30 checks).** Schema validity; ingredient integrity; versification (`vrs.json` presence, shape, scope coverage, role); scope grammar (whole-book `[]` + range arrays, with negative controls); targetBible derivability; alignment round-trip + staleness guard; selections validity + invalidation firing; decision-shape completeness incl. the additive `status` field; derive+merge progress reconstruction; scope-filtered derivation with the in-scope progress denominator; cross-language re-attach with groupId tiebreak + irreducible ambiguity left unplaced (D17); carry-over invalidation of unplaceable decisions (D36); multi-book scope; two-language-set pin completeness (D17/D30 §5.3 shape); (tool, book) resolution records + the two-rung coverage ladder; extraScripture source pins (§5.3 entry shape, unique ids, `sha` grammar); zaln export; verse-span key semantics. These checks pass on today's pankosmia-web unmodified.
- **Stage-2 — role/relationships durability (2 checks).** Role-tagged ingredients and native SB `relationships`. The sample carries both, schema-valid. A server metadata regeneration still drops the `x-` **roles** — the scan rebuilds the table from disk, and roles are not derivable from bytes — the **accepted condition** [decided 2026-07-30 — D28], not a pending upstream fix. `relationships` **survives** regeneration at ≥0.18.5 [VERIFIED — `evidence/rig-rebaseline-0.18.5-2026-07-30.md`; it was dropped at ≤0.18.3]. So a server-rescanned copy scores Stage-2 **1/2** at the current pin (the pristine sample scores 2/2). Stage 1 treats paths as authoritative (S-2, permanent), and the client re-asserts its roles after each regeneration (§6 W-2).
- **Phase-2 — journal-merge design (3 checks).** The two-actor `metadata.json` merge conflict and the §8.7 derived-file rule that resolves it, exercised in a disposable git repo; plus a guard that the fixture journals are the §8.1 sealed-segment stream form the implementation defines.

The **journal conformance suite** (§8.9; J1–J32 per Appendix A — the suite’s own summary line is the authoritative check count) validates the full §8 semantics, the publication topology, and the intake rejection rules separately: `npm run validate:journal`. Both suites: `npm run validate:all`.

Run: `npm install && npm run validate` (`.npmrc` handles the required `legacy-peer-deps`).

## 8. The event journal (write format + fold invariants NORMATIVE — ratified per D55, 2026-08-18; sync operations remain [PROPOSED], §8.7)

The journal exists so that a translator's work is never lost, and never lost silently. Every change to project data is recorded permanently — who, what, when — in a form that lets offline devices and, later, teams combine work without a server, with genuine conflicts surfaced to a person instead of silently resolved. The **write format** (§8.1–§8.5) is normative because journal bytes are permanent: what a device writes today must still fold correctly years from now. The **fold invariants** (§8.6) are normative because they are the executable proof that the write format captures enough: a format nobody has folded is unverified. The **sync operations** (the marked block in §8.7) are [PROPOSED]: they consume journal bytes and never change what §8.1–§8.6 define, so a defect there surfaces at sync time with the data intact on both sides — recoverable in a way a bad byte format never is.

Coverage discipline (D55): every rule below that carries an `[R-…]` id is claimed by a live check in the journal conformance suite, in the check's own name (`[covers R-8.1.3]`), and `node conformance/normative/check.mjs` fails when a claimed rule loses its check or a rule loses its claim. The suite's own summary line is the authoritative check count.

When the journal is active, journals are canonical. `<BOOK>.usfm`, the checking sidecars (§5.1–5.2 shapes), and `metadata.json`'s `ingredients` table become **derived, committed** artifacts: checkpoints regenerate them from the fold (§8.7), so the repo remains a normal Scripture Burrito for every other tool. Everything in §§3–5 remains valid for reading.

### 8.1 Files and actors: immutable sealed action segments

- Journals live under `ingredients/checking/journal/<actorId>/`: an `actor.json`, and one file per action under `segments/`. [R-8.1.1] A segment file is one JSON document `{"container": 1, "body": "<string>", "sha256": "<hex>"}` — `body` is the action JSON serialized exactly once as a string, and `sha256` is computed over the UTF-8 bytes of that exact body string. The body parses to `{"events": [event, …]}`: one action, in `ts` order, all carrying the directory's actor. [R-8.1.2] The filename is the first event's `ts` with `:` → `_` and `|` → `,`, suffixed `.action.json`; the encoding round-trips and sorts in `ts` order. [R-8.1.3] Multi-scope actions are allowed: one segment MAY carry `_project`-scope and book-scope events together (one action, one file).
- **The write model (D50). [R-8.1.4]** Every store mutation — single-event included — publishes as one **new** immutable, checksum-sealed segment file. Writers MUST NOT append to or rewrite any journal file. [R-8.1.5] A byte-identical rewrite of an accepted segment is an idempotent accept; a *different* action at an accepted path is rejected, and the accepted bytes stay untouched.
- **Parse/checksum validity IS the commit marker (D50). [R-8.1.6]** A segment that fails the parse-and-checksum chain is invisible **as a whole**: no partial action ever folds. [R-8.1.7] Readers MUST NOT silently drop an invalid segment — the default surfaces it. [R-8.1.8] Recovery is republication of the same bytes from the writer's durable staged intent (its outbox), never an in-place repair. (posture declaration, D50 — not a checkable rule: process-crash atomicity is guaranteed; power-loss durability is detected but not guaranteed.)
- [R-8.1.9] **Size limit:** 4 MiB per segment file. Writers refuse to seal an oversize action; readers MUST treat an oversize segment as invalid.
- [R-8.1.10] **One stream form.** Sealed action segments are the ONLY journal stream form. Readers MUST NOT accept any other form; intake rejects `.jsonl` files like any non-whitelisted file.
- [R-8.1.11] `<actorId>` = stable slug, `[a-z0-9-]{4,32}` (MUST NOT contain `|`). [R-8.1.12] A device MUST only ever write under its own `<actorId>`, and every event in a segment MUST carry the directory's actor. [R-8.1.13] `actor.json` records `{schemaVersion: 1, actorId, displayName, device, createdAt}`; `actorId` MUST match the directory; `createdAt` is a fixed-width ISO-8601 UTC instant; `displayName`/`device` are OPTIONAL and user-controlled (a pseudonym is fine — PRD FR-33). (D53, app rule — binds the application, not the stored format; no conformance case can assert it) **Actor identity is scoped per project (D53):** one installation working in two projects holds two actor identities, each derived from its installation secret (D50), never a hardware fingerprint. Without this, merging two of one's own projects reads as one actor's linear history and silently discards work (§8.6).
- [R-8.1.15] **Journals are permanent history.** There is no compaction, rewriting, or pruning in `v: 1`. The fold's correctness depends on the full event set, and git history keeps it anyway.
- Journal files register as ordinary ingredients on rescan (paths authoritative, role `x-journal` per §2).
- [R-8.1.16] **The disjoint-writer layout is the merge guarantee for the journals.** No two devices write the same file, so combining copies never conflicts *in the journals*. Shared derived files are covered by §8.7 instead.

### 8.2 Time and event identity (HLC)

- [R-8.2.1] `ts` is a hybrid logical clock string: `<ISO-8601 UTC, fixed-width ms, 'Z'>|<4-hex lowercase counter>|<actorId>` (e.g. `2026-07-07T14:03:22.113Z|0007|maria-x1`). Fixed-width fields make plain string comparison the total order, and the physical part MUST be a real calendar instant.
- [R-8.2.2] Issue rule: if physical now > last physical, the counter resets to `0000`; otherwise the counter increments. [R-8.2.3] Counter overflow past `ffff` bumps the physical part by 1 ms and resets the counter. [R-8.2.4] When a device receives any event (import, merge, project open), it MUST ratchet the local clock to at least the maximum `ts` seen.
- [R-8.2.5] **Event identity is `ts`.** It is unique by construction: an actor writes only its own journal (§8.1) and the counter breaks same-millisecond ties. The union of journals de-duplicates by `ts`. There is no separate content-hash id: two events with identical payloads are still distinct events.

### 8.3 Event envelope

```jsonc
{"v": 1, "op": "text.verse.set", "actor": "maria-x1",
 "ts": "2026-07-07T14:03:22.113Z|0007|maria-x1",
 "base": "<ts of the event whose state this op observed, or null>",
 "generation": "<ts of the book.add generation this record belongs to>",  // REQUIRED on content ops (§8.5)
 "supersedes": ["<ts>", "..."],        // OPTIONAL — fork resolution only
 "batch": "<ts>",                      // OPTIONAL — groups events of one user action (§8.4a)
 "seed": {"source": "creation|sidecar-migration|out-of-band-usfm|tc3-import", "batch": "<ts>"},  // OPTIONAL
 /* ...op-specific fields (§8.5) */ }
```

- [R-8.3.1] `base` — per target key: the `ts` of the previous live event on that key that this op observed. [R-8.3.2] Two live events on one key with the same `base` from **different actors** = a **fork**. [R-8.3.3] Same-actor events are totally ordered by `ts` and never fork. [R-8.3.4] **`base: null` asserts "no prior state I know of", not "no prior state exists" (D53).** How the fold resolves a rootless event that meets existing state is defined in §8.6; it is never a whole-fold refusal.
- [R-8.3.5] `supersedes` — a resolution event names the head(s) it replaces; it MUST NOT name the event's own `ts`. [R-8.3.6] **`supersedes` is conserved and bounded:** an erased head MUST be reported (`retained[]`, reason `superseded`), and a `supersedes` MUST NOT erase a head outside its own structural ancestry — the fold refuses such an erasure, keeps the head live, and reports the attempt.
- [R-8.3.7] `batch` — the `ts` of the first event of the same user action; readers MAY group by it; `batch` never affects fold state.
- [R-8.3.8] `seed` — marks migrated/imported data; in every other respect a seeded event is an ordinary event (there is no separate `seed.import` op), and seeded events are NOT exempt from any rule in this section.
- [R-8.3.9] Version policy (mirrors §9): an event with unknown `v` or unrecognized `op` MUST cause the fold to refuse with a clear message; additive OPTIONAL fields do not bump `v` and MUST be tolerated by readers, and an additive-optional field never manufactures a fork.

### 8.4 The book decomposition: skeleton + verse slots

The journal must be able to regenerate the *entire* USFM file byte-exactly. [R-8.4.1] The book decomposes into exactly two kinds of state: **verse content** — for each verse key, every byte after the `\v <key> ` marker up to the next `\v ` or `\c ` marker (or end of file), including inline markup and the inter-verse paragraph markers that follow the verse; and **the skeleton** — everything else, with each verse's content replaced by a slot. [R-8.4.2] Recomposition MUST be byte-identical for any input: `recompose(decompose(usfm)) === usfm`, property-tested over aligned, exotic, span-keyed and `\ts\*`-chunked corpora. [R-8.4.3] The slot delimiter is `U+0001`, reserved: source files containing `U+0001` MUST be rejected, and journaled verse content that itself carries a `\v ` or `\c ` marker or `U+0001` MUST be refused everywhere it can appear — otherwise bytes fall outside the validity hash and the file re-partitions for other tools. [R-8.4.4] Verse keys are strings and MAY be spans (`"4-5"`), with the §5.2 span identity rules; every slot key a skeleton derives — at `book.add`, `text.skeleton.set` and `text.structure.apply` alike — MUST satisfy the slot-key grammar `<chapter>:<verse>` or `<chapter>:<v>-<v>`, and duplicate slots are refused. A consequence stated plainly: adding or removing a paragraph break between verses is an edit to the *preceding verse's* content; renumbering, adding or removing verses or chapters is a structural change (§8.5 `text.structure.apply`).

#### 8.4a Drafting by section vs checking by verse (translator's sections)

- **Sections are presentation only, and they are not stored in the target text** (clarified by the project owner, 2026-07-07). The drafting UI derives its section grouping at load from the pinned *source* text's `\ts\*` milestones. The fallback ladder when the source has none: `\p` paragraphs, then per-verse. The ladder's rung ORDER is `[PROPOSED — validated live in tc4-POC-2, 2026-07-16: docs/evidence/tc4-poc2-learnings-2026-07-16.md]`; it is a drafting-UI choice, binds no stored byte, and no conformance case can assert it. The drafting UI never writes `\ts\*` into the target draft (§4.1); it is a drafting-UI statement that binds no stored byte on the import path — an imported file's `\ts\*` MUST round-trip per R-8.4.2, so no check can refuse it. [R-8.4.5] There is no section object in the format and no section op in the vocabulary.
- [R-8.4.6] A section save decomposes into one `text.verse.set` per *changed* verse; all share a `batch` (§8.3). The journal's conflict unit stays the verse, so two people who draft different verses of one section never conflict.

### 8.5 Operation vocabulary (complete)

| op | scope / key | payload (beyond envelope) | fold rule |
|---|---|---|---|
| `text.verse.set` | (book, chapter, verseKey) | `{book, chapter, verse, text}` | LWW register with fork detection; carries `generation` |
| `text.skeleton.set` | book | `{book, skeleton}` | structural chain link, slot-preserving only (see the chain rule and R-8.5.14 below) |
| `book.add` | book | `{book, scope, skeleton, initialVerses}` | self-contained creation: one event creates the slot topology and stub state; carries `scope` (`[]` or range array, §3 rule 4) so a checkpoint reconstructs `currentScope` |
| `book.remove` | book | `{book}` | structural chain link; a removed book projects NO content (§8.6) |
| `text.structure.apply` | book | `{book, skeleton, transitions, dispositions}` | the atomic structural action (#65): span create/break, renumber — see the structural rules below |
| `align.verse.set` | (book, chapter, verseKey) | `{book, chapter, verse, alignments, wordBank, targetVerseMd5}` (§5.1 shapes, I-2 integers) | LWW; **valid only while `targetVerseMd5` = md5 of the §5.1 plain-text extraction of the folded verse text (I-3)**; carries `generation` |
| `check.decision.set` | §5.2 identity key | `{toolId, decision}` (full §5.2 record incl. `status`) | LWW with fork detection; carries `generation` |
| `note.add` | — (grow-only) | `{target, text}`; `target` is exactly one of `{book, chapter, verse}` or `{decisionKey}` (the **toolId-prefixed** §5.2 decision key) | grow-only; notes are permanent in `v: 1` — no delete/edit op; they project into fold output only; carries `generation` |
| `resource.pin.set` | pin slot | `{slot, entry}` (§5.3 entry shape; slot under the §5.3 slot grammar) | LWW with fork detection; `{slot, removed: true}` projects to absence |
| `project.vrs.set` | project | `{vrs}` (§4.3 bytes, verbatim) | immutable first-value register: the first value binds; an identical repeat de-duplicates; a different second value is surfaced and never applied |
| `project.meta.set` | JSON path | `{path, value}`; dot-separated object keys | LWW per path, applied as an overlay after metadata regeneration (§8.7). **MUST NOT target the derived/fixed roots `format`, `ingredients`, `type`, `meta`** — the fold refuses such events |
| `settings.set` | settings path | `{path, value}` (dot-separated path into the §5.4 document) | LWW per path with fork detection — `settings.json` becomes a derived mirror at checkpoints |

[R-8.5.1] There are no other ops in `v: 1`; new ops bump `v` (§9). Journal `v: 1` vocabulary is textTranslation-shaped; other flavors extend by version bump, and `v: 1` writers are unaffected.

- [R-8.5.2] **The structural chain-link rule (one rule, one op class).** `book.add` (non-root), `book.remove`, `text.skeleton.set` and `text.structure.apply` each carry `base` naming their structural predecessor on that book. An unknown `base` PENDS (the event and its descendants wait, verse bytes untouched, until the ancestor arrives); a `base` naming a non-structural event or another book's structure REFUSES; and pending propagates transitively across the whole op class. [R-8.5.3] **Rootless-on-existing (D53):** a `base: null` structural event that meets a book that already exists CONVERGES with the existing creation when its payload (the event minus `actor` and `ts`) is identical, and FORKS — surfaced for review, neither side silently winning — when it differs. A rootless `book.remove`, `text.skeleton.set` or `text.structure.apply` on an existing book refuses to act and is retained and reported (`rootless-structural`) — the whole rootless-structural class is ONE rule, and no op is exempt. Nothing in this rule ever refuses the whole fold.
- [R-8.5.14] **`text.skeleton.set` is slot-preserving only.** The fold MUST refuse a slot-set, key, or ordering change relative to its base — `text.structure.apply` is the only slot-changing op — and MUST refuse a `base` the SAME actor's own skeleton head has already advanced past (a writer defect: a skeleton edit cannot silently reverse an accepted structural action). The same-actor stale-base refusal is ONE rule for both skeleton-chain ops. The byte invariant: an accepted slot-preserving edit leaves every current verse projection byte-identical. Cross-actor same-base competitors fork (§8.3), and an unknown base is pending until it arrives (R-8.5.2).
- [R-8.5.15] **A rootless content write on a live key is a writer DEFECT.** `text.verse.set` MUST NOT be rootless on a live key: a slot's verse head exists from the `book.add` that created the slot, so the `base: null` claim is false. The fold does NOT make such a write a head: it is retained and reported (`rootless-base`) — never a linear advance, never projecting (under any branch), never advancing a branch. (`align.verse.set` and `check.decision.set` MAY be rootless — a first write on those keys is ordinary, anchored by the mandatory `generation` stamp, so two genuine concurrent first writes still fork; pins, project metadata and settings carry no structural ancestry at all, so a rootless write on those registers is always ordinary.)
- [R-8.5.4] **`text.structure.apply` is all-or-nothing.** The action carries the new skeleton, the old-key → new-key `transitions`, and `dispositions` for every affected live record — alignments, decisions, verse-targeted and decision-targeted notes, and verse TEXT on mapped keys. A missing source, stale source head, or incomplete disposition set makes the whole event `incomplete`/`conflicted`: the pre-operation state projects unchanged, and the event is reported. [R-8.5.18] **Transitions map EVERY destination.** `transitions` maps every destination slot key of the new skeleton to `{text, sources}`: its required final text (merge/split content is stated, never inferred) and `sources` = immutable references to every affected live source head. A transition key missing from the new skeleton, a destination slot without a transition or stated text, or one source head claimed by two transitions is malformed and refuses the fold. [R-8.5.16] **Dispositions are CONSTRAINED to the computed affected set:** a disposition referencing a record outside that set MUST refuse the whole event (all-or-nothing) — without this bound, a structural action mapping one verse could carry a disposition that consumes any unrelated live record in the book. [R-8.5.5] Disposition forms are `re-key`, `replace` (the `post` MUST be a complete, schema-valid record of its surface — §5.1 for alignments, §5.2 for decisions — whose identity is consistent with the disposition's target), `invalidate-retain`, and `orphan-review`; a disposition whose `action` or `surface` is outside those enums refuses the whole event. A `re-key` destination is a §8.4 SLOT KEY, not a number: the fold takes the number form only when it round-trips exactly (`String(Number(x)) === x`), so a destination like `1:02` keeps its string form and the record keeps naming the slot that exists. A disposition MUST NOT change a record's `generation` — conservative handling is never a re-stamp, so a quarantined record can never resurrect through one. [R-8.5.12] **A re-key destination is bound to the record's target KIND:** a verse-keyed record (alignment, decision, verse-targeted note) re-keys to a slot key of the new skeleton; a `decisionKey`-targeted note re-keys to the **toolId-prefixed** §5.2 decision key of its re-keyed decision, never to a bare five-part identity key and never to a verse slot. The two grammars are disjoint, and ONE shared predicate states the rule, applied at the fold, so the schema and the fold cannot drift. [R-8.5.17] **`replace` is NOT a note disposition** (notes are grow-only in `v: 1`; replacement contradicts their model), and **`re-key` and `replace` are not text-surface actions** — the transitions already state where content goes, so a live text head's dispositions are `invalidate-retain` or `orphan-review` only.
- [R-8.5.6] **Book generations (causal, no timestamp fallback).** Every `align.verse.set`, `check.decision.set`, `note.add` and `text.verse.set` carries `generation` = the `ts` of the `book.add` generation it belongs to; omitting it refuses the fold, seeded events included. After a `book.remove` + re-add, prior-generation records are retained and reported (`prior-generation`) — never silently resurrected, never deleted — and the stamp decides, never the HLC.
- [R-8.5.7] **Prefix-related dotted paths conflict (D54).** `settings.set` and `project.meta.set` key one register per path; two paths where one is a prefix of the other (`ui.pane`, `ui.pane.width`) write the same place. The later `ts` takes the projection; the earlier path is retained and reported (`prefix-collision`); the loss is never silent. [R-8.5.8] A dotted path with an empty or prototype-chain segment is refused, and the setters traverse with own-property checks only.
- [R-8.5.9] **INVARIANT I-4: NFC on write — content is NORMALIZED.** Writers MUST normalize all CONTENT text they journal — verse content, initial verse content, structural destination text, skeletons, note text, and settings/metadata string values — to Unicode NFC before they hash or write (matching `meta.normalization`, §3). The fold does not re-normalize: normalization is a write-side duty, discharged at the one write chokepoint (the seal), and a writer that seals MUST re-validate the normalized action, so what is written is exactly what a reader will validate. [R-8.5.13] **Identity is REFUSED, never rewritten.** A writer MUST NOT silently transform an identity-bearing value: the §5.2 identity components and the verification fields beside them (`quote`, `quoteString`, `groupId`), the `toolId`, a note's `decisionKey` or verse target, a `book` code, a `resource.pin.set` slot, a dotted `path`, the `project.vrs.set` frame name, and every object KEY at every depth MUST be refused — at seal AND at fold — when they are not already NFC. Normalizing an identity component can silently collide two records — a **silent identity split**: two decision records whose identity keys PRINT IDENTICALLY, differ in bytes, and produce no fork, no retained entry, and no way to see the split.
- [R-8.5.10] **Text vs. plain text.** `text.verse.set.text` carries the verse's full content slot (§8.4 bytes). All *validity* hashing — `align.verse.set.targetVerseMd5`, selections revalidation — uses the **§5.1 plain-text extraction** of that content (I-3), never the raw bytes, and the extraction REFUSES content it cannot cover rather than hashing part of it. There is no other validity hash in `v: 1` (D48: `textMd5`/`skeletonMd5` are removed).
- [R-8.5.11] **Removal semantics per surface (JSON `null` is not absence).** Decisions are never deleted (invalidate-and-retain keeps the record); alignment removal is the explicit empty-state payload, projected as a record, not absence; `settings.set`/`project.meta.set` `{path, removed: true}` fold to absence, while `value: null` stores `null`.
- [R-8.5.19] **`project.vrs.set` is creation/seed only, enforceably.** The event MUST carry `seed` with `source` ∈ `creation | sidecar-migration | tc3-import`; `out-of-band-usfm` is a TEXT reconcile source and never seeds a versification frame. Without this rule, only the first-value register stands between an ordinary later event and a silent frame replacement.

### 8.6 The fold (normative algorithm — the invariants below are the executable proof of §8.1–§8.5)

Input: the union of all actors' accepted segments. Algorithm: de-duplicate by `ts`; sort by `ts` (plain string compare); for each event in order update its key's state — grow-only ops accumulate; LWW ops advance their branch when `base` equals a live head's `ts`, resolve the key when they supersede all live heads, advance the same actor's head linearly when no live head matches `base` but a live head carries the event's own actor (same-actor events never fork — R-8.3.3's mechanism), and otherwise join as a fork — except that a rootless content write on a live key is a writer defect and never joins: it is retained and reported (`rootless-base`, R-8.5.15), and a rootless structural op on an existing book refuses to act (R-8.5.3); then project (§8.4 recomposition, §5 structures, the `project.meta.set` overlay) and report.

- [R-8.6.1] **DETERMINISM.** The fold is a pure function of the event *set*: `fold(events) ≡ fold(any permutation, duplication, or partition-then-union of events)`, and a partial union never projects a `ts` it does not contain. Incremental or cached folds MAY exist but MUST equal the full fold.
- [R-8.6.2] **CONSERVATION — the format's whole promise.** Every written record in the union MUST end in an observable state: projected, or reported in `retained[]`, `invalid[]`, `pendingStructural[]`, `forks[]` or `autoMerged[]` (an auto-merged identical twin's observable state is the projected identical head — R-8.6.4), or superseded by a traceable successor. A record in none of those is silent data loss and is a defect, not a design choice. This binds ALL four record surfaces — verse text included — under every rule in this section: absent books, generations, structural actions, forks.
- [R-8.6.3] **EXCLUSIVITY.** A record is never PROJECTED and RETAINED at once: retained means held for review, not in the projection.
- [R-8.6.4] **Fork handling.** A key with more than one live head is forked. If all live heads carry byte-identical payloads the fold auto-merges them (identical outcomes need no human); otherwise the fork is surfaced in `forks[]` and the projection uses the highest-`ts` head **flagged provisional** — visible, never silent. Fork identity is the op's payload; an additive-optional envelope field never manufactures a fork. An auto-merge is ACCOUNTED, not silent: the identical heads collapse to ONE projected record, and the fold MUST report each collapse in `autoMerged[]` — the key, the full head `ts` set, and the winning `ts` — so a losing twin's observable state IS the projected identical head (R-8.6.2). A CONVERGED rootless creation (R-8.5.3) is reported the same way — one `book|<BOOK>` entry with the canonical root as `winner` — and that action-level entry accounts for the WHOLE aliased action, because none of its per-key projections (skeleton or slot heads) was ever created.
- [R-8.6.5] **Absent books project nothing.** A book that was removed, or whose `book.add` has not arrived, projects NO content: its verse text, alignments, decisions AND notes are reported in `retained[]` (`absent-book`), with the generation quarantine intact.
- [R-8.6.6] **Orphan backstops.** An alignment whose verse key has no slot in the current skeleton is orphaned and reported in `invalid[]` regardless of its hash; a live text head on a slotless key is reported in `retained[]` (`orphaned-text`); a note dispositioned `orphan-review` is retained, not projected.
- [R-8.6.7] A skeleton slot with no live verse event projects as the untranslated stub (`___`, §4.1); stubs and projections carry no `generation` stamp — the stamp never leaks into projected records or derived files.
- [R-8.6.8] **Structural-branch selection.** Projection is per book: select the winning skeleton head; its structural ancestry — the chain of `book.add`/`text.skeleton.set`/`text.structure.apply` events it descends from — is the **selected structural branch**. A head whose structural ancestor is outside that chain does not project: it is retained and reported (`unselected-structural-branch`). A losing branch's moves and edits never leak into the winner's projection — exclusion is by ancestry, not by guesswork.
- [R-8.6.9] **The `retained[]` reason vocabulary is closed.** An implementation MUST use exactly these reasons: `superseded`, `prior-generation`, `absent-book`, `orphaned-text`, `prefix-collision`, `rootless-base`, `rootless-structural`, `no-structural-ancestor`, `unselected-structural-branch` — plus, for a record retained by a structural disposition, the disposition's own retention action (`invalidate-retain` | `orphan-review`). No other reason exists in `v: 1`.
- Fork resolution travels: a resolution is an event (`supersedes`, §8.3), so once it reaches a device the fold applies it — nobody re-resolves another's resolved conflict, and two independent conflicting resolutions surface again as an ordinary fork rather than one silently winning (D53).

### 8.7 Checkpoints, derived files — and sync (sync is [PROPOSED])

A **checkpoint** (session close, book done, pre-sync) is: fold → write **all** derived files → regenerate `metadata.json` ingredients → reconstruct `type.flavorType.currentScope` → apply the `project.meta.set` overlay → commit. Its rules:

- [R-8.7.1] **The regeneration set is COMPLETE.** A checkpoint writes every journal-derived shared file from the fold: `<BOOK>.usfm` recomposed; the §5.1 alignment and §5.2 decision sidecar mirrors; `resources.json` from the folded pins (§5.3); `settings.json` from the folded settings (§5.4); `vrs.json` from the folded `project.vrs.set` register (§4.3, verbatim bytes); and `metadata.json`. That list is exhaustive: **every shared non-journal file is either regenerable from the fold or a tolerated unjournaled ingredient class** (`ingredients/audio/`).
- [R-8.7.2] The regenerated `metadata.json` MUST reconstruct `type.flavorType.currentScope` from folded `book.add`/`book.remove` state (§3 rule 4), then apply the `project.meta.set` overlay (§8.5).
- [R-8.7.3] **A tolerated unjournaled ingredient class is never touched.** Checkpoint regeneration MUST NOT touch, regenerate, or delete files under `ingredients/audio/`, and they are never divergence.
- [R-8.7.4] **The checkpoint's inputs are MANDATORY:** an implementation MUST refuse — fail loudly — rather than emit an incomplete derived set (no base `metadata.json`, a missing (tool, book) resolution record, or a fold with a book but no versification frame).
- [R-8.7.5] **Divergence detection enumerates from the fold's expected set:** an out-of-band edit or deletion of any derived shared file is detected, never silently repaired — enumeration starts from the projected set, so a derived file deleted out of band is divergence too.
- [R-8.7.6] **The checkpoint trusts no derived key:** every projected `ipath` MUST resolve strictly inside the destination root and satisfy §2, checked by the checkpoint itself, independently of schema validation.
- (D55, app rule — commit ordering binds the application's git calls (§6 W-4), not the stored format; no conformance case can assert it) The checkpoint commits only after the full sequence above completes — never a partial derived set.

**Sync and integration [PROPOSED — Phase 2 operations; ratification tracked on the Phase 2 epics].** The operational protocol — the two-local-histories topology (working projection + per-actor publication branch), send-without-receive, zero-trust intake in disposable scratch, and receive by rebuild-and-swap — is fully specified by the reference suite (J18–J20, in-process scenarios against real git repositories; the live-platform proof is `npm run validate:transport`, run endpoint-for-endpoint against the rig) and by the prior draft of this section (commit 74b7270), and it is deliberately NOT normative today. These operations consume accepted journal bytes and never change what §8.1–§8.6 define, so a defect or a later redesign here cannot invalidate stored data. Two platform caveats bind any implementation meanwhile (PLATFORM-NOTES #20/#21): intake validation reads from the merge commit, never the post-merge worktree; publication repos are born with an initial commit.

### 8.8 Reconcile (out-of-band edits) and seeding (migration)

- [R-8.8.1] **Out-of-band USFM edit** (another tool edited the committed file): detected at open when committed bytes ≠ the fold's projection. Reconcile decomposes the committed file (§8.4). If the slot set is unchanged, it emits `text.verse.set`/`text.skeleton.set` per differing verse/skeleton with `seed: {source: "out-of-band-usfm"}` and `base` = the current **live** head — a linear supersede. When the out-of-band edit CHANGES the slot set, reconcile MUST emit `text.structure.apply` (§8.5) with **conservative and COMPLETE dispositions** — identity-where-possible mapping, and for every live verse text head, alignment, decision, and verse-targeted note on a removed key, `invalidate-retain`/`orphan-review`, never guessed re-keys — never a slot-dropping `text.skeleton.set`. Reconcile MUST build those dispositions from the fold's **LIVE HEAD sets**, not from its PROJECTED records: live heads include quarantined (prior-generation) and losing-fork heads the projection does not show, and reading the projection instead makes reconcile emit an event the fold refuses as `incomplete` — deterministically, forever. One set, read by both sides — so the event reconcile emits is one the fold accepts. An out-of-band edit can never silently destroy a journaled one: a concurrent journaled edit of the same verse produces an ordinary fork.
- [R-8.8.2] **Seeding is universal and all-or-nothing (D50).** Every project is seeded on first open of an unjournaled project: every sidecar record becomes one seeded event, `modifiedTimestamp` maps into the `ts` physical part (counter `0000`, actor = the seeding install), `targetVerseMd5` carries over, and the fold of the seeded journal MUST reproduce the pre-seed state exactly. "Exactly" is content-level for sidecars: USFM and vrs bytes MUST match byte-for-byte, and each sidecar's RECORDS must match — record ORDER inside a sidecar array is byte form, which convergence rewrites to the checkpoint projection immediately after seeding. A sidecar whose content the checkpoint projection cannot represent (an unknown top-level field, or co-present records on one §5.2 identity key) MUST refuse the seed rather than drop content silently. [R-8.8.3] Seeding is deterministic modulo actor, and combined with the rootless convergence rule (§8.5, D53) two devices that independently seed the same source CONVERGE instead of conflicting — the format is self-healing across channels that strip the journal.
- (D53, app rule — binds the application, not the stored format; no conformance case can assert it) **Joining is not merging (D53).** A user who joins an ongoing project does NOT thereby combine their own existing project with it. Merging two projects is an explicit human act; the system MUST NOT infer it, or propose it, from a matching language, book, content or name. In `v: 1` no operation combines two projects' journals — the §8.5 vocabulary is exhaustive (R-8.5.1).

### 8.9 Conformance (journal suite)

`npm run validate:journal` in `conformance/` (reference implementation under `journal/`) executes the journal suite per Appendix A — the suite's own summary line is the authoritative check count. `npm run validate:all` runs it with the Phase 1 suite. Coverage of this section's `[R-…]` rules is enforced by `node conformance/normative/check.mjs` (D55): every rule id is claimed inside a live check's name, and the gate fails on any uncovered rule, any stale claim, and any duplicate id. The gate tracks ids, not text: a reworded rule keeps its id and its claim, and the rewording is visible in the spec diff itself. Per-statement mutation hardening — the proof that each check fails when its rule is violated — remains open (D55 residuals). The reference implementation is the contract for the app's `foldEngine` port (ARCHITECTURE §9). If this section and the harness disagree, this section wins and the harness must be corrected (§9).

## 9. Spec evolution

Bump a sidecar's `schemaVersion` only for a breaking payload change. Readers MUST reject unknown major versions with a clear message. Additive optional fields do not bump the version. This document is versioned in git alongside the code. A change to this document requires a harness update in the same change.

---

## Appendix A — Journal conformance test plan (§8 companion)

**Version:** 2.0 · 2026-08-18 · companion to BURRITO-SPEC 1.8 §8. (2.0 replaces the 1.x hand-maintained coverage table: coverage of §8's `[R-…]` rules is now MACHINE-CHECKED — each rule id is claimed inside a live check's name as `[covers R-…]`, and `node conformance/normative/check.mjs` fails on any uncovered rule, stale claim, or duplicate id. The gate tracks ids, not text: a rewording keeps its claim and is visible in the spec diff; per-statement mutation hardening remains open (D55 residuals). This appendix is an index, not a second source of truth.)
**Suite:** `conformance/validate-journal.mjs` (reference implementation: `conformance/journal/*.mjs`). Run: `npm run validate:journal`. Property tests use `fast-check` with a fixed seed (reproducible) and 200 runs per property. The suite's own summary line is the authoritative check count.
**Rule (spec §9):** any change to BURRITO-SPEC §8 changes the suite in the same change set.

### Check-group index

J1 HLC ordering/ratchet/overflow · J2 skeleton codec byte-identity · J3 fold determinism (property) · J4 LWW linear history · J5 fork detection + identical-payload auto-merge · J6 supersedes resolution · J7 I-3 staleness composition · J8 out-of-band reconcile · J9 three-device convergence · J10 sneakernet ≡ merge · J11 RETIRED (tested the deleted NDJSON stream form; the id is not reassigned — D44) · J12 end-to-end two-actor git regeneration · J13 de-duplication by ts · J14 schema totality + version policy · J15 Phase-1 sidecar seed migration · J16 section-vs-verse machinery · J17 definitions closure · J18 Pankosmia transport scratch behavior · J19 actor-publication lifecycle · J20 zero-trust intake rejection · J21 the structural action (all-or-nothing, dispositions) · J22 structural lineage + pending propagation · J23 sealed action segments (container, filenames, immutability, containment) · J24 staged-intent republication · J25 vrs first-value register · J26 pin golden projection · J27 removal semantics per surface · J28 actor binding + same-actor rule · J29 book generations (causal quarantine) · J30 checkpoint regeneration set + divergence · J31 value grammars, two independent layers · J32 base semantics, conservation + exclusivity (property)

### Acceptance

- `npm run validate:journal` exits 0 — the suite's own summary line is the authoritative count — **and** the Phase 1 suite still passes (`npm run validate`), **and** `npm run validate:all` runs both, **and** `node conformance/normative/check.mjs` exits 0 (every `[R-…]` rule claimed by a live check).
- A property failure prints the fast-check counterexample + seed. Any counterexample is a spec or implementation defect — file it against §8, and fix spec+suite together (§9).

### Out of scope (tracked elsewhere)

- Phase 2 app components: the journal store under real I/O, the sync engine, the review-queue UI.
- Fold performance on multi-year journals (issue #80).
- Multi-project/DCS end-to-end sync (Phase 2 epics).
