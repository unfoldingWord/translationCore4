# Evidence: the versification format, and which frame each resource speaks — 2026-08-24

**Why this file exists.** Epic #33 (issues #15/#16) needs to map references between
versification schemes. Before building, we established three things by measurement: which
format the data actually uses, which frame each resource is in, and what the platform does
with versification today. Several earlier assumptions — including two in our own
specification — turned out to be wrong. This record supersedes the affected claims.

**Method.** Source reads of the platform server and its client packages; schema reads of the
versification specification the format derives from; and reference-level sweeps over published
resources and sample burritos on `git.door43.org`. Every count below is reproducible with the
scripts named at the end.

---

## 1. The format is a fork of the Copenhagen Alliance specification

The versification data the platform ships and copies into projects is the Copenhagen Alliance
format with **one extension**.

- The **upstream** specification declares `mappedVerses` values as a *single* `bcvRange`:
  `"additionalProperties": {"$ref": "#/definitions/bcvRange"}` — one source range maps to one
  target range.
- The **forked** format additionally permits an **array** of `bcvRange` as the value — one
  source range mapping to *many* targets. This is a many-to-many case the upstream format
  cannot express.

The client-side versification toolkit implements the fork: its pre-succinct builder accepts
either a string or an array, and its reverse-mapping function is written for the array form.
Burritos produced with the platform's own tooling also use the fork. **tC4 targets the fork**,
which aligns it with both the toolkit and the published burritos.

**No shipped data exercises the extension yet.** All six bundled schemes (`eng`, `lxx`, `org`,
`rsc`, `rso`, `vul`) and both sample burritos carrying a versification ingredient are 100%
string-valued: zero array-valued entries, zero multi-target entries.

**Consequences for readers:**

1. **Accept both value forms**, string and array. The bundled data ships strings; the format
   permits arrays. (This is the same shape of rule the format specification already applies to
   TWLink forms in §5.3.)
2. **Normalize to the array form once**, at the single load point, before any call into the
   toolkit. The reverse-mapping function iterates the value: given a string it iterates the
   *characters* and returns a silently corrupt table keyed `"0"`, `"1"`, `"2"`, … with no
   exception raised. The forward direction hides this, so a normalization bug is invisible until
   the reverse direction runs — which is the main derive path.
3. **Handle a multi-target result**, though no current data produces one. The mapping function
   returns `[bookCode, [[chapter, verse], …]]` and the inner array may hold more than one entry
   under the fork.

The toolkit can also parse the classic `.vrs` **text** format. tC4 does not need this — the
platform supplies JSON — but it is the available path if a burrito ever carries versification as
plain text, which is what the ratified Scripture Burrito example shows.

## 2. Mapping pivots on `org`, and it is lossy

Every scheme's `mappedVerses` maps that scheme's references **into `org`**. `org` itself carries
only 8 entries, all outside the 66-book canon. So a scheme-to-scheme map is a two-hop compose:
forward through the source scheme, then backward through the target scheme.

Mapping every `eng` reference in the 66-book canon into each project scheme produces two failure
modes that matter, because a mapped reference becomes both the §5.2 identity key and the §8.5
journal register key — written once, never re-derived:

| project scheme | eng refs | identity collisions | land outside the scheme |
|---|---|---|---|
| `eng` (composed, not short-circuited) | 31,104 | 3 | 0 |
| `rsc` | 31,104 | 8 | 5 |
| `rso` | 31,104 | 11 | 8 |
| `vul` | 31,104 | 28 | 171 |
| `lxx` | 31,104 | 81 | 57 |

- **Reference collision** — two distinct source references land on one target reference.
  Example: `eng NEH 7:68` and `NEH 7:69` both map to `NEH 7:69`.

  **Corrected scope of this finding.** An earlier draft of this record called these "identity
  collisions" and claimed two checks would share one §5.2 identity key. That is wrong. The
  identity key is `(checkId, bookId, chapter, verse, occurrence)`, and the TSV `ID` column is
  unique within a book — verified 196/196, 188/188 and 206/206 distinct IDs across the
  `en_tn` JON/TIT and `en_twl` TIT fixtures — so two distinct rows always keep distinct keys
  no matter where they map. The real consequence is narrower: two checks that sat on different
  verses now sit on the same verse, which adds ambiguity to the **D17 cross-language re-attach
  fallback** key (reference + original-language quote + occurrence). §5.2 already declares that
  key non-unique, tiebreaks on `groupId`, and leaves a still-ambiguous match **unplaced** rather
  than guessing. So no new mechanism is needed for this case; the existing rule covers it.
- **Outside the scheme** — the result does not exist in the project. Two shapes: **verse 0**
  (the mapping arithmetic can go below 1, e.g. `eng PSA 116:10` → `rsc PSA 115:0`), and a verse
  or chapter the scheme does not have (`eng ACT 19:41` → `rsc ACT 19:41`, but `rsc` ACT 19 ends
  at 40; `eng EST 1:1` → `vul EST 1:1`, and `vul` has no EST chapter 1).

Verse spans add a third: mapping a span endpoint-by-endpoint can split it across chapters. There
are 14 (`rsc`), 15 (`rso`), 22 (`vul`) and 48 (`lxx`) points inside an `eng` chapter where
consecutive verses map to different target chapters, and **0** for `eng`. One case maps
*backwards* — `eng PSA 16:10-11` → `vul PSA 16:10` and `PSA 15:10` — so mapped endpoints cannot
be assumed to be in order.

**A mapping result must therefore be validated against the target scheme's own `maxVerses`
before it becomes an identity.** Anything below verse 1, past a chapter's maximum, in a missing
chapter, ambiguous, or split across chapters is *unplaceable*: dropped with a recorded reason,
never journaled.

## 3. Composing unconditionally would regress the default project

The `eng` row above is the composed path. `eng → org → eng` loses 3 verses that unmapped code
handles correctly today. Since the entire resource suite is `eng` (§4) and `eng` is the default
scheme, **the mapper must return the reference unchanged when source and target frames are the
same scheme**. That is not an optimization; it is what prevents a regression of the only
configuration currently proven, and it confines the risky path to projects that deliberately
chose another scheme.

## 4. Every resource in the suite is in the `eng` frame

Measured by testing whether each reference *can exist* in each scheme. A reference that cannot
exist in a frame is positive proof the resource is not in that frame. **Absence proves nothing** —
a resource may simply have no note or verse there — so only positive contradiction counts.

**Helps (translation notes), by verse reference:**

| resource | books | refs | impossible in eng | org | rsc | rso | vul | lxx |
|---|---|---|---|---|---|---|---|---|
| Arabic tN | 66 | 95,875 | **0** | 320 | 1,501 | 1,501 | 2,578 | 6,048 |
| English tN | 56 | 84,375 | **0** | 295 | 2,265 | 2,265 | 3,306 | 5,503 |
| Russian tN | 17 | 9,629 | **0** | 41 | 3 | 3 | 991 | 2,782 |
| Hindi tN | 1 | 3,489 | **0** | 0 | 0 | 0 | 6 | 0 |
| Spanish (es-419) tN | 4 | 712 | **0** | 3 | 3 | 3 | 3 | 3 |

**Helps (translation words links):** English TWL, 48 books, 58,064 refs — **0** impossible in
`eng`. Spanish TWL, 4 books, 770 refs — **0**.

**Single-verse discriminator.** `JON` separates `eng` from every other scheme: `eng` JON 1 has 17
verses, and `org`/`rsc`/`rso`/`vul`/`lxx` all end chapter 1 at verse 16. Of the 22 published
translation-notes resources in the catalog, the 12 that ship Jonah **all** reference `JON 1:17`
and none reference `JON 2:11`. That includes the Russian sets, whose gateway content is `eng`
even though Russian Bible traditions use `rsc`/`rso`.

**Original-language texts are also `eng` — this corrects an earlier assumption.** The Hebrew
text: 929 chapters, **0** exceed `eng`, 38 exceed `org`. The Greek text: 260 chapters, **0**
exceed `eng`. The decisive case is Hebrew PSA 3 ending at verse **8**; in `org` the superscription
is verse 1 and the chapter has 9. The suite is re-versified to `eng` throughout, consistent with
being aligned to the English literal text.

**So the derive path maps from exactly one frame, `eng`** — not two, as first assumed.

## 5. Non-`eng` frames occur in user-selected source texts

Source texts are genuinely mixed. Measured across published Russian scripture:

| resource | books | chapters | exceeds eng | exceeds rsc | PSA 3 last v | JON 1 last v | frame |
|---|---|---|---|---|---|---|---|
| Synodal-family aligned Bible | 66 | 1,189 | **89** | **0** | **9** | **16** | **`rsc`** |
| gateway literal (open) | 26 | 241 | 0 | 2 | — | 17 | `eng` |
| gateway literal (other) | 31 | 359 | 0 | 5 | — | 17 | `eng` |
| older gateway bible | 27 | 260 | 0 | 2 | — | — | `eng` |

A 66-book Synodal-tradition Bible published in the catalog fits `rsc` exactly and contradicts
`eng` in 89 chapters. Nothing prevents a user pinning it as an `extraScripture` source text.

**This is a different class of problem from §4.** `extraScripture` fills source panes only. It
never derives a check list, so it produces no identity key and nothing incorrect can reach the
journal. Mapping a source pane is a *lookup*, not an identity operation.

## 6. What the platform does with versification today

[VERIFIED — pankosmia-web 0.18.7 (c43c40d, 2026-08-11), read 2026-08-24: `src/endpoints/git2/new_text_translation.rs`, `new_scripture_book.rs`, `new_bcv_resource.rs`, `new_audio_translation.rs`, `new_translation_plan_resource.rs`, `src/endpoints/content_utils2/versification.rs`, `list_versifications.rs`, `src/utils/bcv_ref.rs`]

From the server source:

1. Takes the scheme **name** as a creation parameter on the text-translation, bcv, audio and
   translation-plan endpoints.
2. Uses that name for exactly one purpose — building a path to a bundled scheme template.
3. Copies that file verbatim to the project's `ingredients/vrs.json`.
4. Registers the ingredient with `checksum`, `mimeType` and `size` — **and no `role`**.
5. Reads `maxVerses` to scaffold chapter/verse USFM when asked to add a book.
6. **Discards the name.** It is never persisted; it only built the path at step 2.
7. Builds the canonical book-code list from `eng`'s `maxVerses`, regardless of the project's
   scheme.
8. Serves scheme data by name over HTTP.
9. **Never maps.** `maxVerses` is the only key any server code reads. No reader of
   `mappedVerses` and no call of the mapping function exists in the platform repos we mirror
   [VERIFIED — grep of pankosmia-web 0.18.7 (c43c40d, 2026-08-11) and core-client-rcl
   (ffbe964, 2026-07-31), run 2026-08-24: zero hits]. Repos outside those mirrors were not
   read; re-check on platform upgrades.

**In one line: versification is a template selector and a verse-count table.** The data is copied
in, books are scaffolded from `maxVerses`, and the scheme's name is thrown away.

Two consequences:

- **The name is unrecoverable from the project alone**, so tC4 must record it itself.
- **The mapping table in a project's `ingredients/vrs.json` has no upstream consumer.** tC4 would
  be its only reader, so tC4 should not treat that copy as the authority for mapping data — it
  reads the named scheme from the server and falls back to the project copy only when offline.

## 7. What published burritos actually contain

Five sample burritos on `git.door43.org/BurritoTruck`, read live:

| burrito | ingredients | versification ingredient | roles used |
|---|---|---|---|
| Septuagint | 51 | `ingredients/vrs.json`, 8,873 B | **none** |
| French simplified literal | 37 | `ingredients/vrs.json`, 14,696 B | **none** |
| Berean (aligned) | 67 | **absent** | **none** |
| Arabic Van Dyck | 66 | **absent** | **none** |
| Burmese common language | 66 | **absent** | **none** |

1. **The scheme data is standard, only re-serialized.** Canonicalized and hashed, the Septuagint
   burrito's file is exactly `org` and the French one exactly `eng`, matching the bundled files
   as *data*. Only serialization differs — keys alphabetical instead of the bundled order,
   different whitespace.
2. **Therefore fingerprinting must normalize.** A byte-level comparison identifies neither file
   despite both being standard schemes. Parse, sort keys, canonically serialize, then hash.
3. **No ingredient in any of the five carries a role of any kind** — not the format's own
   `versification` role, not `text`, and not our custom `x-versification`.
4. **The versification ingredient is optional in practice and its absence carries no
   information.** One burrito includes it *and* is `eng`; three omit it. Absence cannot be read
   as "this project is `eng`" — the frame is simply unknown.
5. **The filename is `ingredients/vrs.json`**, matching what the server writes.

## 8. Two claims in our own specification that this record corrects

- **§5.2, "the mapping mechanism is Proskomma's versification toolkit, shipped client-side in the
  platform."** Half right. The toolkit *is* shipped in two platform clients, which take the full
  engine as a dependency. But it is not on tC4's dependency path: the shared component library
  carries no such dependency, nor does the library it depends on, nor does tC4. tC4 must take the
  dependency directly. "tC4 does not build a mapper" remains correct.
- **§4.3, `role: x-versification`.** Nothing writes this role. The server writes no role (§6.4),
  tC4's product code writes none, all four local development projects have no role on that
  ingredient, and no published burrito uses roles at all (§7.3). Only our conformance harness
  emits and then requires it, so that check validates its own generator. The requirement should
  be dropped and the check reduced to "the ingredient exists and is scheme-shaped".

## 9. Open item

**Nothing in the format records which scheme a project uses.** Not the flavor block, not the
ingredient entry, not the scheme file itself. The upstream specification does define a `basedOn`
property, but it is unpopulated everywhere — including in the upstream project's own standard
mappings and its custom-mapping sample — and its meaning is "derived from", not "is". So a
project's scheme name has no standard home today.

tC4 therefore records it in its own sidecar and resolves it through a single accessor with a
source ladder, so that a standard home can take over later without changing any caller. Tracked
as a `question` issue.

---

## Reproducing

- `evidence/e33-mapped-verses-form.py` — §1, which value form real data uses.
- `evidence/e33-helps-frame-mapping-probe.mjs` — §2, the collision and out-of-range table.
- `evidence/e33-versification-roundtrip-probe.mjs` — §2, round-trip loss per scheme.
- `evidence/e33-frame-sweep-tsv.py`, `evidence/e33-frame-sweep-usfm.py` — §4 and §5.
- `evidence/e33-tn-loss-sweep.mts` — the addendum's per-scheme loss counts
  (run: `npx -y tsx docs/evidence/e33-tn-loss-sweep.mts`).

The bundled scheme files were confirmed byte-identical to the upstream specification's standard
mappings, unchanged upstream since 2025-06-18, so these measurements hold against current data.

---

## Appendix: the lazy mapping chunk, measured

The mapping engine is a direct dependency (`proskomma-core@0.11.3`) loaded by a
**dynamic import** in `src/data/mapReference.ts`, so it is code-split out of the main
bundle. Measured with `vite build` (Vite 6.4.3):

| build | main bundle | proskomma chunk |
|---|---|---|
| mapper unreferenced | 933.54 kB (gzip 307.77 kB) | none emitted |
| mapper referenced | 937.32 kB (gzip 309.42 kB) | **1,042.79 kB (gzip 268.47 kB)** |

So the engine lands in its own chunk rather than the main bundle: the main bundle grows
by ~4 kB, and the 268 kB gzipped chunk is fetched only when a project actually needs a
frame conversion. Because the whole resource suite is `eng` and `eng` is the default
project scheme, the same-frame short-circuit returns *before* the dynamic import — so a
default project never downloads the engine at all.

Adding the dependency introduced **no new vulnerabilities**: `npm audit` reports 12
(6 low, 4 moderate, 2 high) both before and after, all from pre-existing transitive
dependencies. The three behaviourally-pinned versions are unchanged: `usfm-js@3.4.3`,
`word-aligner@1.0.3`, `word-aligner-lib@1.0.1`.

---

## Addendum (2026-08-25): en_tn@v90 loss sweep

The §5.2 "Known losses" numbers in `BURRITO-SPEC.md` come from this sweep.
`evidence/e33-tn-loss-sweep.mts` reads every `tn_*.tsv` of
`git.door43.org/unfoldingWord/en_tn` at tag `v90` and maps each verse-shaped row
with the client's own `mapReference` (`src/data/mapReference.ts`), against the
committed scheme fixtures in `test/fixtures/vrs/`. A row counts as a loss when
`mapReference` refuses it (`ok: false`) — the exact decision the derive pipeline
makes. Rows whose reference is not verse-shaped (`front:intro`, `1:intro`) are
the scheme-independent D60 drop and are excluded from the per-scheme counts.

Output, run 2026-08-25:

```
en_tn@v90: 56 book TSVs
85148 rows total; 990 non-verse (front/intro, D60); 84158 verse-shaped rows swept per scheme

eng: loses 0 of 84158 rows across 0 distinct references
rsc: loses 8 of 84158 rows across 3 distinct references
    PSA 116:10 (verse-zero) × 3
    PSA 147:12 (verse-zero) × 3
    REV 12:18 (past-chapter-end) × 2
rso: loses 13 of 84158 rows across 4 distinct references
    PSA 87:1 (ambiguous) × 5
    PSA 116:10 (verse-zero) × 3
    PSA 147:12 (verse-zero) × 3
    REV 12:18 (past-chapter-end) × 2
lxx: loses 81 of 84158 rows across 40 distinct references
vul: loses 1067 of 84158 rows across 170 distinct references (dominated by
    Esther: the vul scheme lacks the chapters the eng rows name)
```

This corrects the earlier, uncommitted sweep figures (7/12/57/845 over 76,920
rows), which no committed script reproduced. The distinct references for `rsc`
and `rso` are unchanged; the counts differ because this sweep counts rows, at
tag `v90`, with the shipped mapper.
