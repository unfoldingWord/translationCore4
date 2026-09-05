# The in-memory data contract of the word-aligner fork, read from its source (2026-09-05)

**Question:** what exact in-memory data shape does `@gabrielaillet/word-aligner-rcl@1.3.18`
require, and does tC4's alignment data meet it? Issue #13 (legacy: backlog item I2.2.2,
open question #7). The owner ruled on the issue on 2026-08-13: the record de-risks
suggestions one increment ahead of #1; tC4 builds its own suggesting-aligner component,
which talks to the fork's base aligner surface; record what gatewayEdit and Bible Editor
use (§4).

**Method:** a source read. The published package ships bundles and source maps only. The
fork's source files were extracted from the source map of the installed package. The
command, run from the repository root:

```
node -e '
const fs=require("fs"),path=require("path");
const m=JSON.parse(fs.readFileSync("node_modules/@gabrielaillet/word-aligner-rcl/dist/index.es.js.map","utf8"));
m.sources.forEach((s,i)=>{ if(!s.includes("node_modules")){ const p=path.join("fork-src",s.replace(/^\.\.\//,"")); fs.mkdirSync(path.dirname(p),{recursive:true}); fs.writeFileSync(p,m.sourcesContent[i]); } });'
```

Line numbers below are lines of those extracted files. `node_modules/@gabrielaillet/word-aligner-rcl/package.json`
says `"version": "1.3.18"`. The fork's repository is
https://github.com/gabrielaillet/word-aligner-rcl-pankosmia. The tag was read with
`gh api repos/gabrielaillet/word-aligner-rcl-pankosmia/git/ref/tags/v1.3.18 -q .object.sha`,
result `f0f43264027a7970395a3c897b863dd4e08eb863`. The tag's tree was not diffed against
the source map. tC4 files are read at `main` `4fb4588`. `wordmap-lexer` is read at the
installed 0.3.6; an npm tarball has no commit hash, so its identity is the lockfile
integrity `sha512-7yyNIW6E4ea5vgaqvgcXihjZlVrlEg4KUuHdkmSC3O73yyTZs8YUY7ipGpHI2zWwgErTwfWCLXZ49s8eJoVn8g==`
(`package-lock.json`, `node_modules/wordmap-lexer`).

[VERIFIED — `@gabrielaillet/word-aligner-rcl` 1.3.18 (tag v1.3.18 = f0f4326) via the
published source map; `wordmap-lexer` 0.3.6 (integrity above); tC4 `main` 4fb4588;
2026-09-05]

## 1. How tC4 uses the fork today: it does not

- The fork is a `devDependency` (`package.json:37`), not a dependency (`:21-31`).
- No file under `src/`, `test/` or `e2e/` imports it. `grep -rn "word-aligner-rcl"` over
  the repository, excluding `node_modules` and the lockfile, finds only `package.json:37`
  and `docs/ARCHITECTURE.md:145`. `git log -S'word-aligner-rcl' -- src` is empty: no
  source file ever imported it.
- `docs/ARCHITECTURE.md:145` (A-5, 2026-07-06): the check and alignment surfaces are
  design-native; the fork's UI is not embedded.
- tC4's alignment screen is `src/views/Align.jsx`. It reads the §5.1 record directly
  (`a.record.alignments`, `a.record.wordBank`, lines 325-326, 372-374, 404) and edits it
  through `src/data/align/edit.ts`.

The issue's opening sentence, "the alignment screen uses a forked component library",
described an earlier plan. The contract below is what tC4 must produce if its own
component adopts the fork's base aligner surface or its suggester interface.

## 2. The fork's in-memory contract

Three components: `WordAligner`, `SuggestingWordAligner`, `WordAlignmentTool`
(`README.md`, first paragraph). The two aligners share one data contract.

### 2.1 Required props

`src/components/WordAligner.jsx:624-640`:

| Prop | Type | Required |
|---|---|---|
| `contextId` | object | yes |
| `loadLexiconEntry` | function | yes |
| `showPopover` | function | yes |
| `sourceLanguage` | string | yes |
| `translate` | function | yes |
| `verseAlignments` | array of `AlignmentType` | yes |
| `targetWords` | array of `TargetWordBankType` | yes |
| `lexiconCache`, `onChange`, `sourceLanguageFont`, `sourceFontSizePercent`, `styles`, `targetLanguage` (object), `targetLanguageFont`, `targetFontSizePercent` | | no |

`SuggestingWordAligner` (`src/components/SuggestingWordAligner.jsx:1259-1281`) has the same
required set plus optional `suggester`, `asyncSuggester`, `hasRenderedSuggestions`
(default `true`), `suggestionsOnly`, `handleInfoClick`, `style`.

`WordAligner` only passes `contextId` back in `onChange` (`WordAligner.jsx:392`).
`WordAlignmentTool` reads `contextId.reference` (`src/components/WordAlignmentTool.jsx:225`).
`sourceLanguage === 'hbo'` selects Hebrew handling (`WordAligner.jsx:558`; `OT_ORIG_LANG`
in `src/common/constants.js`).

### 2.2 The word shapes

`src/components/WordAligner.jsx:236-260` (JSDoc typedefs):

```
TargetWordBankType  { index: number, occurrence: number, occurrences: number, text: string, disabled: boolean }
SourceWordType      { index: number, occurrence: number, occurrences: number, text: string, lemma: string, morph: string, strong: string }
AlignmentType       { sourceNgram: SourceWordType[], targetNgram: TargetWordType[] }
```

Rules the code applies to these shapes:

- **`text`, not `word`.** The converters rename `word` to `text` and delete `word`
  (`src/helpers/alignmentHelpers.js:167-169`, `174-176`, `192-194`). The reverse path
  writes `word: item.word || item.text` (`:283`, `:296`, `:300`).
- **`occurrence` and `occurrences` are numbers.** Strings are converted with `parseInt`
  on the way in (`alignmentHelpers.js:77-117`, applied at `:155-156`). Token identity is
  `text` + `occurrence` (`WordAligner.jsx:79-80`, `98-99`). The word-bank `disabled` flag
  is computed with `text` + `occurrence` + `occurrences` (`alignmentHelpers.js:246-248`).
- **`index` is the token position in the verse**, 0-based. For target words it is
  `wordmap-lexer` `Token.tokenPos` (`alignmentHelpers.js:132`, `:263`). For source words
  it is the position in the original-language word list (`:160-166`). The component sorts
  n-grams and alignment cards by it (`WordAligner.jsx:168-169`, `190-196`, `212`).
- **`targetWords` is the whole verse.** Every target token is present; `disabled` is
  `true` when an alignment holds the token (`alignmentHelpers.js:240-267`, `514-525`).
- **`alignmentCleanup`** removes alignments with no words on either side, sorts each
  n-gram and the cards by `index`, and rewrites `alignment.index` (`WordAligner.jsx:158-183`).
  Alignments therefore carry an `index` field.
- **Completeness** = every target word `disabled`, and no alignment with source words but
  no target words (`alignmentHelpers.js:534-554`).
- `onChange` receives `{ type, source, destination, verseAlignments, targetWords, contextId }`
  (`WordAligner.jsx:262-272`, `387-394`). `type` is one of five strings (`:15-19`).

### 2.3 The suggester interface (`SuggestingWordAligner`)

- Alignments carry `isSuggestion: boolean`; target words carry it too
  (`SuggestingWordAligner.jsx:424-438`, `1011`, `1032`). Rejecting a suggestion empties its
  `targetNgram` and clears the flag (`:927`, `:1103`, `:1148`).
- The suggester is called with `wordmap-lexer` `Token`s and `wordmap` `Alignment`/`Ngram`
  objects built from the in-memory shapes (imports `:10-11`). Signature:
  `(sourceTokens, targetTokens, maxSuggestions, manualAlignments) → Suggestion[]`
  (`README.md`, "Usage Difference SuggestingWordAligner over WordAligner").
- **Token positions.** `Token`'s constructor reads `position`, not `index`
  (`wordmap-lexer/dist/Token.js:20`), and defaults it to `0`. The fork builds
  `sourceWordObjects` and `targetWordObjects` with `new Token(t)` from words that carry
  `index` (`:481-482`, `:910-911`), then calls `updateTokenLocations` on both arrays
  (`:485-486`, `:913-914`). That function assigns `tokenPos` sequentially and recomputes
  `tokenOccurrence`/`tokenOccurrences` by exact `text` (`:210-237`). So the source and
  target token arrays reach the suggester with sequential positions. The `Token`s inside
  `manualAlignmentObjects` (`:483`, `:912`) are built the same way but are not passed to
  `updateTokenLocations`; their `position` stays `0`. [PROPOSED] Whether that affects
  wordMAP's use of the manual alignments is not measured here.
- Suggestions are matched back by the hash `text:occurrence:occurrences` (`:518`, `:537`,
  `:970`).

### 2.4 Tokenizer

The fork tokenizes target verses with `wordmap-lexer` `Lexer.tokenize`, which wraps
`string-punctuation-tokenizer` (`wordmap-lexer/dist/Lexer.js:4`, `:59-60`;
`alignmentHelpers.js:126`, `:517`). `wordmap-lexer` 0.3.6 pins
`string-punctuation-tokenizer` `2.0.0` (`node_modules/wordmap-lexer/package.json`), the
same version tC4 pins (`package.json:27`). The fork's own manifest lists
`string-punctuation-tokenizer` 2.2.0, but that copy is not the one `Lexer.tokenize` calls:

```
$ npm ls string-punctuation-tokenizer wordmap-lexer --all
+-- @gabrielaillet/word-aligner-rcl@1.3.18
| +-- string-punctuation-tokenizer@2.2.0
| +-- wordmap-lexer@0.3.6
| | `-- string-punctuation-tokenizer@2.0.0 deduped
+-- string-punctuation-tokenizer@2.0.0
```

Other fork dependencies (its `package.json`): `usfm-js` 3.4.3, `word-aligner` 1.0.2,
`word-aligner-lib` 1.0.1, `wordmap` ^0.6.0 (installed 0.6.2), `wordmap-lexer` ^0.3.6.

## 3. Where tC4's data meets the contract, and where it does not

tC4's stored shape is BURRITO-SPEC §5.1, typed in `src/data/align/zaln.ts:9-39`:

```
AlignedWord            { word: string, occurrence: number|string, occurrences: number|string, strong?, lemma?, morph?, [key]: unknown }
Alignment              { topWords: AlignedWord[], bottomWords: AlignedWord[] }
AlignmentVerseRecord   { alignments: Alignment[], wordBank: AlignedWord[], invalid: boolean, targetVerseMd5: string, sourceVersion: string }
```

| Contract point | tC4 today | Meets? |
|---|---|---|
| Alignment pairs of source and target words | `topWords`/`bottomWords` (`zaln.ts:21-24`) | Same data. The fork's names are `sourceNgram`/`targetNgram`; its converters do the rename (`alignmentHelpers.js:158`, `:180`, `:287`). |
| `text` field | `word` (`zaln.ts:15`) | Rename needed; the fork's converters do it. |
| `occurrence`, `occurrences` as numbers | `number \| string` in the type. Writers coerce with `Number()` at the store boundary (`occurrences.ts:13-17`; applied in `httpStore.ts:203-215`, used by `writeAlignments` `:486-491`). No integer check and no rejection of `NaN`. | Meets for the values the app writes. The fork would `parseInt` strings anyway. |
| `strong`, `lemma`, `morph` on source words | present on `AlignedWord` (`zaln.ts:10-12`) | Meets. |
| `index` on every word | not a named field of `AlignedWord`. The index signature (`zaln.ts:16-18`) lets extra keys through; nothing in tC4 writes one. | **Does not meet.** tC4 stores no token position. A bridge computes it from the verse's token order, as the fork's converters do (`alignmentHelpers.js:160-166`, `183-191`). |
| `targetWords` = all target tokens with `disabled` | `wordBank` = the unaligned target words only (`zaln.ts:29`; BURRITO-SPEC §5.1 line 164) | **Does not meet.** The fork's `targetWords` is the whole token set. tC4 holds it in two parts: `wordBank` (unaligned) and the `bottomWords` of `alignments` (aligned). A bridge tokenizes the verse and marks as `disabled` the tokens found in `bottomWords` (`alignmentHelpers.js:240-267`). |
| `alignment.index`, `isSuggestion` | absent | Fork-internal state. `alignmentCleanup` assigns `index`; `isSuggestion` is transient UI state. Not stored by tC4 and need not be. |
| Tokenization | regex on Unicode letter, mark and number runs (`edit.ts:21-24`); occurrence counted per exact token string (`:33`, `:41`) | **Not verified equal** to `string-punctuation-tokenizer` 2.0.0 as `wordmap-lexer` calls it (`Lexer.js:59-60`). Same library version on both sides, but tC4's `edit.ts` does not call it. If the two split a verse differently, `occurrence` counts differ and word identity with them. |
| `contextId` | tC4 has no aligner `contextId`. Its checks carry a `contextId` (`src/data/derive.ts:113`, `224`, `255`; `httpStore.ts:237-268`). | The fork only echoes it (`WordAligner.jsx:392`); `WordAlignmentTool` reads `.reference`. Trivial to supply. |
| `translate`, `loadLexiconEntry`, `showPopover` | `translate`: tC4 has an English-only catalog scaffold; the switch to platform i18n is future work (`src/i18n/index.js:1-4`). `loadLexiconEntry`: the lexicon layout is described in `docs/ARCHITECTURE.md:141`; a reader is not verified implemented. `showPopover`: none. | Callbacks to write. No stored-data mismatch. |

**Summary.** The word-level data is the same data under different field names.
BURRITO-SPEC §5.1 already states that the stored payload is exactly what `word-aligner`'s
`unmerge` produces (line 176); the fork's converters exist for that same payload. Two
things the fork requires are not held by tC4: a token `index` on every word, and the
whole-verse `targetWords` list with `disabled` flags. Both derive from the verse text plus
the record. The one unmeasured risk is tokenizer agreement (occurrence counts).

## 4. Reference integrations (the owner's findings, 2026-08-13)

Recorded by the owner on the issue
(https://github.com/unfoldingWord/translationCore4/issues/13#issuecomment-5285882599),
not re-read here [VERIFIED by the owner, 2026-08-13]:

- gatewayEdit (`unfoldingWord/gateway-edit` v2.4.13) pins `enhanced-word-aligner-rcl@1.4.8`,
  which wraps `SuggestingWordAligner` from `word-aligner-rcl` and generates suggestions
  with wordMAP plus `uw-wordmapbooster`, trained locally on the project's own completed
  alignments in a web worker. No global model.
- Bible Editor (`unfoldingWord/bible-editor` v0.0.1) has no aligner dependency.

Relation to the pinned fork, read here: the fork's `README.md` is titled
`word-aligner-rcl` and links the upstream `unfoldingWord/word-aligner-rcl` in its first
paragraph; the fork ships the same `SuggestingWordAligner` surface
(`src/components/SuggestingWordAligner.jsx` in the source map; §2.3). Its suggester
callback signature is the one `enhanced-word-aligner-rcl` fills with wordMAP (the fork's
`README.md` names `AbstractWordMapWrapper.predict` of `wordmapbooster` as the matching
signature). The owner's scope update of 2026-08-13 stands: tC4 builds its own
suggesting-aligner component; the engine question is issue #133.

## 5. Not measured here

- Whether the source map's `sourcesContent` equals the tree at tag `v1.3.18`.
- The effect of `position === 0` on the `Token`s inside `manualAlignmentObjects` (§2.3).
- Tokenizer agreement between `edit.ts` and `wordmap-lexer` on real drafts (§3).
- `WordAlignmentTool`'s further props (scripture panes, verse selector). tC4 does not
  plan to embed it (A-5).
- The gatewayEdit and Bible Editor facts in §4; they are the owner's reading.
