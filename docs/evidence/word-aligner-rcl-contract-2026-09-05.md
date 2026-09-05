# The in-memory data contract of the word-aligner fork, read from its source (2026-09-05)

**Question:** what exact in-memory data shape does `@gabrielaillet/word-aligner-rcl@1.3.18`
require, and does tC4's alignment data meet it? Issue #13 (legacy: backlog item I2.2.2,
open question #7). Owner rulings 2026-08-13 on the issue: record it to de-risk suggestions
one increment ahead of #1; tC4 builds its own suggesting-aligner component that talks to
the fork's base aligner surface, so the record matters more, not less.

**Method:** source read. The published package ships only bundles (`dist/index.es.js`,
`dist/index.cjs.js`) plus source maps with `sourcesContent`. The fork's source was
extracted from `dist/index.es.js.map` of the installed package (`node_modules/@gabrielaillet/word-aligner-rcl`,
`package.json` `"version": "1.3.18"`). Line numbers below are lines of those source files.
The fork's repository is https://github.com/gabrielaillet/word-aligner-rcl-pankosmia; tag
`v1.3.18` is commit `f0f4326` (`gh api .../git/ref/tags/v1.3.18`, 2026-09-05; the tag
was read, its tree was not diffed against the source map). tC4 files are read at `main`
`4fb4588`.

[VERIFIED — `@gabrielaillet/word-aligner-rcl` 1.3.18 (tag v1.3.18 = f0f4326) via the
published source map; `wordmap-lexer` 0.3.6 `dist/Token.js`; tC4 `main` 4fb4588;
2026-09-05]

## 1. How tC4 uses the fork today: it does not

- The fork is a `devDependency` (`package.json:37`), not a dependency (`:21-31`).
- No file under `src/`, `test/` or `e2e/` imports it (`grep -rn "word-aligner-rcl"` over
  the repository excluding `node_modules` and the lockfile finds only `package.json:37`
  and `docs/ARCHITECTURE.md:145`). `git log -S'word-aligner-rcl' -- src` is empty: no
  source file ever imported it.
- `docs/ARCHITECTURE.md:145` (A-5, 2026-07-06): the check and alignment surfaces are
  design-native; the fork's UI is not embedded.
- tC4's alignment screen is `src/views/Align.jsx`; it reads the §5.1 record directly
  (`a.record.alignments`, `a.record.wordBank`, lines 325-326, 372-374, 404) and edits it
  through `src/data/align/edit.ts`.

So the issue's opening sentence, "the alignment screen uses a forked component library",
described an earlier plan. The contract below is what tC4 would have to produce if its own
component adopted the fork's base aligner surface or its suggester interface (owner
ruling 2026-08-13, above).

## 2. The fork's in-memory contract

Three components: `WordAligner`, `SuggestingWordAligner`, `WordAlignmentTool`
(`README.md`). The two aligners share one data contract.

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

`contextId` is read as `contextId.reference` by `WordAlignmentTool`
(`src/components/WordAlignmentTool.jsx:225`); `WordAligner` itself only passes it back in
`onChange` (`WordAligner.jsx:392`). `sourceLanguage === 'hbo'` selects Hebrew handling
(`WordAligner.jsx:558`; `OT_ORIG_LANG` in `src/common/constants.js`).

### 2.2 The word shapes

`src/components/WordAligner.jsx:236-260` (JSDoc typedefs):

```
TargetWordBankType  { index: number, occurrence: number, occurrences: number, text: string, disabled: boolean }
SourceWordType      { index: number, occurrence: number, occurrences: number, text: string, lemma: string, morph: string, strong: string }
AlignmentType       { sourceNgram: SourceWordType[], targetNgram: TargetWordType[] }
```

Rules the code applies to these shapes:

- **`text`, not `word`.** The converters rename `word` to `text` and delete `word`
  (`src/helpers/alignmentHelpers.js:167-169`, `174-176`, `192-194`); the reverse path
  writes `word: item.word || item.text` (`:283`, `:296`, `:300`).
- **`occurrence` and `occurrences` are numbers.** Strings are converted with `parseInt`
  on the way in (`alignmentHelpers.js:77-117`, applied at `:155-156`). Token identity is
  `text` + `occurrence` (`WordAligner.jsx:79-80`, `98-99`); the word-bank `disabled`
  flag is computed with `text` + `occurrence` + `occurrences` (`alignmentHelpers.js:246-248`).
- **`index` is the token position in the verse**, 0-based, from `wordmap-lexer`
  `Token.tokenPos` (`alignmentHelpers.js:132`, `:263`) for target words, and the position
  in the original-language word list for source words (`:160-166`). It is required: the
  component sorts n-grams and alignment cards by it (`WordAligner.jsx:168-169`, `190-196`,
  `212`).
- **`targetWords` is the whole verse**, every target token with `disabled: true` when an
  alignment already holds it (`alignmentHelpers.js:240-267`); it is not the list of
  unaligned words.
- **`alignmentCleanup`** removes alignments with no words on either side, sorts each
  n-gram and the cards by `index`, and rewrites `alignment.index` (`WordAligner.jsx:158-183`).
  Alignments therefore carry an `index` field too.
- **Completeness** = every target word `disabled` and no alignment with source words but
  no target words (`alignmentHelpers.js:534-554`).
- `onChange` receives `{ type, source, destination, verseAlignments, targetWords, contextId }`
  (`WordAligner.jsx:262-272`, `387-394`). `type` is one of five strings (`:15-19`).

### 2.3 The suggester interface (`SuggestingWordAligner`)

- Alignments carry `isSuggestion: boolean`; target words carry it too
  (`SuggestingWordAligner.jsx:424-438`, `1011`, `1032`). Rejecting a suggestion empties its
  `targetNgram` and clears the flag (`:927`, `:1103`, `:1148`).
- The suggester is called with `wordmap-lexer` `Token`s and `wordmap` `Alignment`/`Ngram`
  objects built from the in-memory shapes: `new Token(t)` over every `sourceNgram` word
  and every target word, `new Alignment(new Ngram(...), new Ngram(...))` over the
  non-suggestion alignments (`:481-483`, `:910-912`, imports `:10-11`). Signature:
  `(sourceTokens, targetTokens, maxSuggestions, manualAlignments) → Suggestion[]`
  (`README.md`, "Usage Difference SuggestingWordAligner over WordAligner").
- **Observation:** `Token`'s constructor reads `position`, not `index`
  (`wordmap-lexer/dist/Token.js:20`), and defaults it to `0`. The fork passes its word
  objects, which carry `index`, so every `Token` the suggester receives has
  `position === 0`. Whether this changes wordMAP's predictions is not measured here
  [PROPOSED: check before relying on position-aware scoring].
- Suggestions are matched back by the hash `text:occurrence:occurrences` (`:518`, `:537`,
  `:970`).

### 2.4 Tokenizer

The fork tokenizes target verses with `wordmap-lexer` `Lexer.tokenize`, which wraps
`string-punctuation-tokenizer` (`wordmap-lexer/dist/Lexer.js:4`, `:59-60`;
`alignmentHelpers.js:126`, `:517`). Fork dependency: `string-punctuation-tokenizer` 2.2.0,
`usfm-js` 3.4.3, `word-aligner` 1.0.2, `word-aligner-lib` 1.0.1, `wordmap` ^0.6.0,
`wordmap-lexer` ^0.3.6 (`node_modules/@gabrielaillet/word-aligner-rcl/package.json`).

## 3. Where tC4's data meets the contract, and where it does not

tC4's stored shape is BURRITO-SPEC §5.1, typed in `src/data/align/zaln.ts:9-39`:

```
AlignedWord            { word: string, occurrence: number|string, occurrences: number|string, strong?, lemma?, morph? }
Alignment              { topWords: AlignedWord[], bottomWords: AlignedWord[] }
AlignmentVerseRecord   { alignments: Alignment[], wordBank: AlignedWord[], invalid: boolean, sourceVersion: string, ... }
```

| Contract point | tC4 today | Meets? |
|---|---|---|
| Alignment pairs of source and target words | `topWords`/`bottomWords` (`zaln.ts:21-24`) | Same data; the fork's names are `sourceNgram`/`targetNgram`. The fork's own converters do this rename (`alignmentHelpers.js:158`, `:180`, `:287`). |
| `text` field | `word` (`zaln.ts:15`) | Rename needed; the fork's converters do it. |
| `occurrence`, `occurrences` as numbers | `number \| string` in the type; integers enforced at the store boundary (I-2, `edit.ts:9-12`, `occurrences.ts:16`) | Meets at the boundary. The type still admits strings; the fork would coerce them. |
| `strong`, `lemma`, `morph` on source words | present on `AlignedWord` (`zaln.ts:10-12`) | Meets. |
| `index` on every word | not a named field of `AlignedWord`; the index signature (`zaln.ts:16-18`) lets extra keys pass through, and nothing in tC4 writes one | **Does not meet.** tC4 stores no token position. A bridge must compute it from the verse's token order, as the fork's converters do (`alignmentHelpers.js:160-166`, `183-191`). |
| `targetWords` = all target tokens with `disabled` | `wordBank` = unaligned target words only (`zaln.ts:29`, BURRITO-SPEC §5.1 line 164) | **Does not meet.** The two are complements; a bridge builds `targetWords` from the tokenized verse and marks the words that appear in `bottomWords` as disabled (`alignmentHelpers.js:240-267`). |
| `alignment.index`, `isSuggestion` | absent | Fork-internal state; `alignmentCleanup` assigns `index`; `isSuggestion` is transient UI state. Not stored by tC4 and need not be. |
| Tokenization | regex on Unicode letter/mark/number runs (`edit.ts:21-24`), occurrence counted per exact token string (`:33`, `:41`) | **Not verified equal** to `string-punctuation-tokenizer` as `wordmap-lexer` calls it (`Lexer.js:59-60`). Two tokenizers can disagree on apostrophes, hyphens, and case, which changes `occurrence` counts and so word identity. tC4 pins `string-punctuation-tokenizer` 2.0.0 (`package.json:27`); the fork uses 2.2.0. |
| `contextId` | tC4 has no such object | The fork only echoes it (`WordAligner.jsx:392`); `WordAlignmentTool` reads `.reference`. Trivial to supply. |
| `translate`, `loadLexiconEntry`, `showPopover` | tC4 has platform i18n (issue #12) and lexicon reads (`docs/ARCHITECTURE.md` §3, `en_ugl`/`en_uhl`) | Callbacks to write; no data mismatch. |

**Summary.** The word-level data is the same data under different field names, and
BURRITO-SPEC §5.1 already states that the stored payload is exactly what `word-aligner`'s
`unmerge` produces (line 176); the fork's converters exist for that same payload. Two
things tC4 does not hold are required by the fork: a token `index` on every word, and the
full-verse `targetWords` list with `disabled` flags. Both derive from the verse text plus
the record. The one unmeasured risk is tokenizer agreement (occurrence counts).

## 4. Not measured here

- Whether the source map's `sourcesContent` equals the tree at tag `v1.3.18` (the tag was
  read, not diffed).
- The effect of `position === 0` on every suggester `Token` (§2.3).
- Tokenizer agreement between `edit.ts` and `wordmap-lexer` on real drafts (§3).
- `WordAlignmentTool`'s further props (scripture panes, verse selector); tC4 does not plan
  to embed it (A-5).
