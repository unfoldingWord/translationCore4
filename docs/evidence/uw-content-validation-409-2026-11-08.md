# uw-content-validation on an exported verse span, 2026-11-08

#409 asks that uw-content-validation, run on the app's aligned USFM export of a verse span,
report no `x-ref` notice, and that the validator's version be recorded. This is that run. The
files it used and its raw output are in `uw-content-validation-409-2026-11-08/`.

## The file checked

`span-export.usfm` is the app's export of UGNT TIT 1:1-3 aligned as one span, written by the
tc-export test `a_span_names_each_source_words_verse_and_counts_it_there` on `main` at
`074d1db6` (after #945, #957 and #958). Its four `\zaln-s` milestones name each Greek word's own
verse and count it there:

```
x-occurrence="1" x-occurrences="1" x-content="Παῦλος" x-ref="1:1"
x-occurrence="1" x-occurrences="1" x-content="δὲ" x-ref="1:1"
x-occurrence="1" x-occurrences="1" x-content="δὲ" x-ref="1:3"
x-occurrence="1" x-occurrences="1" x-content="Θεοῦ" x-ref="1:3"
```

## The validator

uw-content-validation 3.2.2, the latest on npm (published 2026-06-22; the GitHub `master` of
unfoldingWord/uw-content-validation was last changed the same day). Node 22.14.0, macOS.
`run.mjs` calls `checkUSFMText` with a `getFile` that serves the UGNT from this repository's
`fixtures/align/el-x-koine_ugnt-TIT.usfm` and refuses every other fetch, and with a memory map in
place of localforage, which the package needs and node lacks. No network was used.

The check that matters here is `checkZALNAttributes`: it reads `x-ref`, requires it to be the
seventh attribute in `C:V` form in the same chapter, fetches the original-language chapter, and
counts `x-content` within the verse `x-ref` names (or across the whole span without `x-ref`).

## Controls

The export was run beside four copies of it, each with one thing made wrong, so that "no notice"
means the check ran and looked, not that it was skipped:

| File | What is wrong | Notice expected |
|---|---|---|
| `ctl-a-order.usfm` | `x-ref` before `x-content` (sixth attribute) | 825 "Unexpected sixth \zaln-s attribute", 819 "…seventh…" |
| `ctl-b-chapter.usfm` | `x-ref="2:1"` in chapter 1 | 795 "Aligned x-ref expected to be in the same chapter" |
| `ctl-c-verse.usfm` | Θεοῦ of 1:3 given `x-ref="1:1"` with `1/1` | 602 "occurrences … wrong": 1:1 holds Θεοῦ twice |
| `ctl-d-no-xref.usfm` | every `x-ref` removed, counts left per verse | 602 on each word the span holds more than once |

## Result as published: a validator bug, not an export fault

`result.txt`. Every file, the correct export included, gets "found 0 occurrences of 'δὲ'" and
"found 0 occurrences of 'Θεοῦ'" for the words of 1:3 (notices 602 and 803).

The cause is in the validator's walk of the original-language chapter
(`src/core/usfm-text-check.js` line 1198 on `master`, `getOriginalWordLists`):

```js
const thisV = bookLine.slice(3);
const intV = Number(thisV);
if (intV > intV2) break;
```

The UGNT puts a verse's first word on the `\v` line (`\v 2 \w ἐπ’|lemma="ἐπί" …`), so `thisV`
is the whole rest of the line, `intV` is `NaN`, no later verse of the span ever matches an
`x-ref`, and the walk runs to the end of the chapter. Any correct `x-ref` on the second or a
later verse of a span gets these notices from the published validator. The first verse is
counted correctly, which is why `ctl-c-verse.usfm` reports "found 2 occurrences of 'Θεοῦ'
instead of 1": the right notice. No issue about this exists on the validator's repository
(searched for `x-ref`, 2026-11-08).

## Result with the walk fixed

`result-patched.txt`. One line of the installed `dist/core/usfm-text-check.js` was changed:

```js
thisV = bookLine.slice(3).split(' ')[0];
```

With that, the export reports **no alignment or `x-ref` notice**, and each control reports exactly
the notice expected above and nothing else about alignment:

| File | Alignment and `x-ref` notices |
|---|---|
| `span-export.usfm` | 0 |
| `ctl-a-order.usfm` | 825, 819 |
| `ctl-b-chapter.usfm` | 795 |
| `ctl-c-verse.usfm` | 602 (2 occurrences of Θεοῦ in 1:1, not 1) |
| `ctl-d-no-xref.usfm` | 602 on three milestones: "THIS TEXT NEEDS RE-ALIGNING" |

The remaining 29 notices on the export are about the fragment, not the alignment: verses 1:4-16
missing (the test exports one span), a recommended `\ide` line, and two "Missing expected USFM
line" notices.

## What this shows, and what it does not

- The export's `x-ref` is where the validator wants it (seventh, after `x-content`), in `C:V`
  form, in the span's chapter, and each word's count is right within the verse it names.
- The published validator cannot confirm this for any word past a span's first verse until its
  walk is fixed; `ctl-d-no-xref.usfm` shows that without `x-ref` it would mark the app's old
  span-wide output as needing re-alignment.
- One fragment of one book was checked, with one word in two verses (δὲ) and one word twice in
  one verse (Θεοῦ). A span whose first word of a later verse is aligned was not checked; the
  patched walk does list that word (ἐπ’ of 1:2 is in the word list).

## Reproduce

```sh
mkdir ucv && cd ucv && npm install uw-content-validation@3.2.2 @babel/runtime@7.26.10
node docs/evidence/uw-content-validation-409-2026-11-08/run.mjs ucv/node_modules \
  docs/evidence/uw-content-validation-409-2026-11-08/span-export.usfm
```

The script's first line says whether the installed validator's walk is patched.
