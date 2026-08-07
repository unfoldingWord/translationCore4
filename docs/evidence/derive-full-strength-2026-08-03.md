# Evidence: derive at full strength (OPEN-QUESTIONS #15) + the tc-checking-tool-rcl headless verdict (#14)

**Date:** 2026-08-03 · **Where:** `translationCore4` branch `guided/derive-full-strength`
(uncommitted at write time). Suite: `test/derive-full-strength.test.ts` — **20 passed**;
whole product suite **135 passed** (115 before this work).

## What was proven (all on REAL published resources)

Fixtures: whole-Titus slices of `en_tn` v86, `en_twl` v86, `es-419_tn` v66 + the `en_ta`
v86 translate toc and one full article — vendored from the pinned sb-zip exports with
their unmodified `metadata.json` (provenance table: `translationCore4/test/fixtures/
resources/README.md`; SHAs match the project pins, asserted by the suite).

- **Versioned TSV parsing (§4.2):** the header row is the contract; a mutated header or a
  cross-fed file (TWL into the tN parser) throws instead of guess-parsing.
- **en_twl v86 TIT:** 188 items; TWLink categories kt 111 / other 71 / names 6.
- **en_tn v86 TIT (7-column):** 206 rows → **157 items** (49 rows without a
  SupportReference are plain notes, never checks — tC3 semantics). Category distribution
  through the tC3 map: grammar 71, figures 53, culture 26, other 6, discourse 1. The map
  predates 4 tA slugs in v86 (figs-yousingular ×3, grammar-connect-words-phrases,
  writing-pronouns, translate-blessing) — they default to "other", proving the fallback.
- **tN quotes:** word-occurrence arrays (§5.2); "&" (12 discontinuous quotes among
  derivable rows) is a separator, never a word; repeated words get ordinal occurrences
  (no Set-dedup — the reference client's `creatWordList` dedups; ours must not).
- **tA linkage:** all 28 derived groupIds exist in the en_ta v86 translate toc (28/28).
- **Cross-language re-attach (D17) on real en→es data:** 89 of 157 decisions re-attach by
  direct checkId; every remaining decision either re-attaches uniquely by
  (ref + orig quote + occurrence) with the groupId tiebreak, or goes to review — never
  guessed. Duplicate fallback keys are REAL: 10 inside en_tn TIT alone.
- **Real-data bug caught:** some TWLink values end in `.md` (`.../names/paul.md`); the
  groupId slug must strip it (the reference client does). Fixed in `deriveTwlItems`.

## OPEN-QUESTIONS #14 verdict: tc-checking-tool-rcl is NOT a headless runtime dependency

[VERIFIED — scratch install, 2026-08-03] `tc-checking-tool-rcl@0.9.145` (npm) fails at
`require()` in Node: the webpack bundle computes `publicPath` from
`document.currentScript` at module scope ("Automatic publicPath is not supported in this
browser"); with a minimal document shim it fails deeper on further browser expectations.
The `twlTsvToGroupData`/`tsvObjectsToGroupData` helpers exist inside the bundle but are
unreachable headless. → **Contract/parity reference only. AD-2 confirmed; the "import RCL
headless as a shortcut" alternative is dead.**

Useful side-finding: its dependency `uw-tsv-parser@1.0.3` (unfoldingWord's low-level TSV
parser) DOES import clean in Node (`tsvStringToTable` with error reporting). Not adopted —
`derive/` keeps zero new runtime deps; the suite proves split-based parsing reproduces the
real counts. If a future resource ever needs quoted-cell TSV semantics, `uw-tsv-parser` is
the ready headless option.
