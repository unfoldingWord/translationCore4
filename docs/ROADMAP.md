# tC4 Roadmap — the path to 4.0.0 (October 16, 2026)

This is the plan of record for translationCore 4's first release. The board's
milestones carry the live work state; this page tells the story in one read.
Ratified by the project owner 2026-08-12 (decisions D42, D46, D47).

## What has shipped

Two increments are built, reviewed, and released as pre-releases:

- [v4.0.0-alpha.1](https://github.com/unfoldingWord/translationCore4/releases/tag/v4.0.0-alpha.1) —
  first public build: create a project, choose sources, draft beside them (journeys J1–J2).
- [v4.0.0-alpha.2](https://github.com/unfoldingWord/translationCore4/releases/tag/v4.0.0-alpha.2) —
  checking and alignment: get pinned resources, check a book, align verses (J3–J6, J13),
  closed after an independent adversarial review.

Both are early forms: drafting is verse-by-verse, alignment is manual. The plan
below grows them to release quality. One pre-release tags at each milestone close
(`4.0.0-alpha.N` → `-rc.N` → `4.0.0` — decision D46).

## The principle that orders this plan: data first (D47)

Anything that shapes the at-rest project format ranks by one test: **does
postponement accrue bad data?** Work that accrues lands first, before the feature
increments multiply what is being recorded. After 4.0.0, no format change lands
without a schema-version bump, a written migration, and old-data fixtures (D47).

That is why the plan starts with an infrastructure increment, and why the journal
ships its write side now: every 4.0.0 project carries complete per-action history
from day one, and the fold/sync features of Phase 2 later build on bytes that CI
has verified since August.

## The milestones

| Increment | Theme | Due | Key issues |
|---|---|---|---|
| **3 — Data foundations & journal** | Versification mapping, version stamps, coverage records; CI format guardians; ratify the journal design and ship write-only journaling | Aug 29 | #33 (#15 #16 #28), #17, #47, #22, #52 |
| **4 — Open, resume, share** | Multi-project work, resume with fresh proof, first share, platform integration | Sep 5 | #39, #4, #7, #8 |
| **5 — Drafting for real** | Section-primary drafting, formatting UX, book introductions | Sep 19 | #53, #54, #55 |
| **6 — Suggestions & resources** | Alignment suggestions (off by default, propose-only), comments and bookmarks, resource upgrade flow, guided fix | Oct 3 | #1, #13, #50, #40, #9 |
| **7 — Publish & import** | Aligned USFM export; the fixture-heavy importers: tC3 zip, x-tcore migration, damaged projects | Oct 10 | #19, #21, #14, #41, #2 |
| **8 — Ship** | Installers, smoke test, rollback plan, witnessed offline run, local fonts, keyboard basics | **Oct 16 → v4.0.0** | #44, #45, #46, #43, #3, #32, #42 |

## Deliberately after 4.0.0

Safe by the data-accrual test, and said out loud so nobody assumes otherwise:
print-ready PDF (#20), the RTL rendering proof (#29), the full screen-reader pass,
i18n key audit (#12), auto-merge of concurrent edits (#27), OBS layouts (#11),
verse move/span operations (format-touching — waits for D47's contract), and the
whole Phase 2 team-collaboration app (#23–#26). **4.0.0 is a single-translator
release.** Team sync arrives in Phase 2, folding the journal 4.0.0 has been
writing all along.

## Standing rules that bind the plan

- Reuse before build: for the journal, versification, and fonts, what pankosmia
  and the Proskomma ecosystem already provide is checked and used first (owner
  directive 2026-08-12; recorded on the issues).
- An increment completes a journey, not a screen; nothing is done without pasted
  test evidence; each close tags a pre-release.
- The format specification and its conformance harness change in the same change
  set (BURRITO-SPEC §9), and from Increment 3 the harness runs in CI.
