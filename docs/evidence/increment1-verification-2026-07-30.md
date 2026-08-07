# Increment 1 — verification evidence (2026-07-30)

All commands executed on this machine against the live rig (`pankosmia_web` 0.18.5,
git rev `99fd9be`). The product repo is `translationCore4/`, branch `guided/increment-1`
(work uncommitted at capture time; checkpoint commits offered to the owner).

## 1. The primary proof line (INCREMENT-1.md)

`npm run journeys -- --grep @inc1` in the translationCore4 checkout:

```
✓ 1 j01 › create a project (name, language, direction, one book): a rejected region
      subtag surfaces as a designed error, then the corrected code yields a
      conforming repo on disk @inc1 @J1 (960ms)
✓ 2 j02 › open the seeded project, draft verse Titus 2:1, and the save is
      byte-strict with no auto-commit @inc1 @J2 (516ms)
✓ 3 j02 › source panes render beside the draft: ULT/UST tabs from pinned
      extraScripture (FR-10 — the orig pane is the alignment increment, D24a) (567ms)
✓ 4 j02 › idle debounce also saves — no blur — and the indicator binds to the
      actual write (FR-6/FR-32) (2.8s)
✓ 5 j02 › drafting an undrafted verse updates the progress display (FR-9) (478ms)
5 passed (7.0s)
```

The journeys run against the live rig (globalSetup reseeds it) and assert ON DISK:
the created repo's `metadata.json`, `.git`, `ingredients/vrs.json` (`maxVerses.TIT`),
`resources.json` pins (installed suite + extraScripture ULT/UST v89 with 40-hex SHAs),
the seeded book (3 chapters, `\v 1 ___` stubs, `\p` structure, zero `\ts`, zero
`\zaln`), checkpoint-commit count, byte-strict saves (every byte outside the edited
verse identical), and no auto-commits.

## 2. The rest of the battery

| Check | Result |
|---|---|
| Unit/property/integration tests (`npm test`) | 9 files, **104 passed** (incl. 33 integration tests against the live rig; indexer/splice property tests over sample + aligned en_ult/en_ust corpora; S-0a/b/c) |
| Lint (`npm run lint`) | clean |
| Typecheck (`npm run typecheck`) | clean |
| Build (`npm run build`) | ✓ (231.6 kB js) |
| Conformance harness (`npm run validate:all`) | **31 passed, 0 failed** (Stage-1 27, Stage-2 2, Phase-2 2) + **journal 59 passed** |
| Transport suite | **10 passed, 0 failed** (`pankosmia_web 0.18.5`) |
| Round-trip suite (fresh seed) | **12 passed, 0 failed**; inner harness on the server-touched copy: **Stage-1 27/27**, Stage-2 1/2 (the accepted split at 0.18.5 — D28/D27-update) |
| Dependency audit (P-2, both packages) | see §4 |

## 3. Landing client (OPEN-QUESTIONS #4 closure evidence)

`scripts/rig-install.zsh` registered the built client and set `product.json`
`homepage: "uw-tc4"` (register-first order — PLATFORM-NOTES #25). Boot verified:

```
GET /api/version → pkg 0.18.5 | homepage uw-tc4
GET /            → HTTP/1.1 303 See Other → location: /clients/uw-tc4
GET /clients/uw-tc4/ → the tC4 client HTML
```

Live browser session on the RIG-SERVED build (not the dev server): the landing URL
opens straight into the project list (0 clicks to work); opening the J1-created
project shows the ULT pane ("Paul, a servant of God and an apostle of Jesus
Christ…") beside the seeded stubs; typing a draft into verse 1 and leaving the verse
wrote it to disk:

```
$ grep 'borrador de prueba del rig' …/_local_/_local_/equipo_rig_tito/ingredients/TIT.usfm
\v 1 Pablo, siervo de Dios y apóstol de Jesucristo — borrador de prueba del rig.
```

The owner closes #4 (the remaining formality); the mechanism and the boot are proven.
Build-shape note: the served build uses the absolute base `/clients/uw-tc4/` — the
server's homepage redirect targets the slash-less path, where relative asset URLs
resolve wrongly (cf. PLATFORM-NOTES #18).

## 4. Dependency audit posture (P-2), stated honestly

`npm audit --audit-level=high` in `translationCore4`: **21 vulnerabilities (12 high)
remain after `npm audit fix`** — with this analysis:

- The high-severity mass is the `elliptic`/`crypto-browserify` chain inside
  `vite-plugin-node-polyfills` → `node-stdlib-browser`. These are browser polyfills
  of node's crypto that the plugin ships but the app never bundles: the BUILT
  artifact contains **zero** of that code (`grep -c 'elliptic|secp256k1' dist/assets/*.js → 0`;
  no `createHash`/`randomBytes` hits). The npm "fix" is a breaking downgrade of the
  polyfill plugin to 0.2.0, which the CJS tC3 libraries need at its current major —
  declined with this reason.
- `brace-expansion` (high) sits in the eslint/typescript-estree chain — dev-only,
  never shipped.
- The proven pairing (usfm-js 3.4.3 / word-aligner 1.0.3 / word-aligner-lib 1.0.1)
  is untouched (verified via package-lock after `npm audit fix`).
- `sample-burrito-validation` audit: unchanged posture from prior runs.

Follow-up (not blocking): replace `vite-plugin-node-polyfills` with a narrower
polyfill set, and vendor the Google-CDN fonts (offline requirement, FR-31) — both
queued for the next increment's chores.

## 5. Adversarial review

See the internal PHASE-1-SUMMARY §3 (maintainer workspace) — spec-vs-built and code review
by independent agents; security review n/a-with-reason (no auth, no secrets, no
untrusted input beyond the local platform; PRD marks content non-sensitive).
