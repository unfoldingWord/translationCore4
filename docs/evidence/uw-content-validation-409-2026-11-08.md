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
`run.mjs` calls `checkUSFMText` with a `getFile` that serves the UGNT from a local file and
refuses every other fetch, and with a memory map in place of localforage, which the package
needs and node lacks. No network was used during a run.

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

## Result: the export passes

`result-door43.txt`: the validator as published, with the UGNT served from Door43's own
`57-TIT.usfm` at tag v0.34 (`57-TIT-door43-v0.34.usfm`, sha256
`a6998ae161efe5fb246c621b0851f330dc3eaa3967f88d87aa056b4ad4c5e277`), the release tC4 pins.

| File | Alignment and `x-ref` notices |
|---|---|
| `span-export.usfm` | **0** |
| `ctl-a-order.usfm` | 825, 819 |
| `ctl-b-chapter.usfm` | 795 |
| `ctl-c-verse.usfm` | 602 (2 occurrences of Θεοῦ in 1:1, not 1) |
| `ctl-d-no-xref.usfm` | 602 on three milestones: "THIS TEXT NEEDS RE-ALIGNING" |

Each control reports exactly the notice expected and nothing else about alignment. The
remaining 29 notices on the export are about the fragment, not the alignment: verses 1:4-16
missing (the test exports one span), a recommended `\ide` line, and two "Missing expected USFM
line" notices.

## A validator bug found on the way

The first run (`result.txt`) served the UGNT from this repository's
`fixtures/align/el-x-koine_ugnt-TIT.usfm` instead. That file is tC3's bundle written back to
USFM by usfm-js, which puts a verse's first word on the `\v` line
(`\v 2 \w ἐπ’|lemma="ἐπί" …`); Door43's file puts `\v 2` on a line of its own. With it, every
file, the correct export included, got "found 0 occurrences of 'δὲ'" and "… of 'Θεοῦ'" for the
words of 1:3 (notices 602 and 803).

The cause is in the validator's walk of the original-language chapter
(`src/core/usfm-text-check.js` line 1198 on `master`, `getOriginalWordLists`):

```js
const thisV = bookLine.slice(3);
const intV = Number(thisV);
if (intV > intV2) break;
```

With text after the verse number, `thisV` is the whole rest of the line, `intV` is `NaN`, no
later verse of the span ever matches an `x-ref`, and the walk runs to the end of the chapter.
USFM allows text on the `\v` line, so this is a robustness fault in the validator, filed as
unfoldingWord/uw-content-validation#299 with a fix. It does not affect the validator's normal
use, which fetches Door43's files. `result-patched.txt` is the fixture run again with that one
line changed to `bookLine.slice(3).split(' ')[0]`: the same results as the Door43 run.

## What this shows, and what it does not

- The export's `x-ref` is where the validator wants it (seventh, after `x-content`), in `C:V`
  form, in the span's chapter, and each word's count is right within the verse it names.
- `ctl-d-no-xref.usfm` shows that without `x-ref` the validator would mark the app's old
  span-wide output as needing re-alignment.
- One fragment of one book was checked, with one word in two verses (δὲ) and one word twice in
  one verse (Θεοῦ).

## Reproduce

```sh
mkdir ucv && cd ucv && npm install uw-content-validation@3.2.2 @babel/runtime@7.26.10
cd .. && E=docs/evidence/uw-content-validation-409-2026-11-08
node $E/run.mjs ucv/node_modules $E/span-export.usfm span-export $E/57-TIT-door43-v0.34.usfm
```

Without the last argument the script serves this repository's fixture, which shows the
validator bug. The script's first line says which file was served and whether the installed
validator's walk is patched.
