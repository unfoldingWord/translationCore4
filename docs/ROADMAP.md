# tC4 Roadmap — the path to 4.0.0 (October 16, 2026)

This is the plan of record for translationCore 4's first release. The board's
milestones carry the live work state; this page tells the story in one read.
Ratified by the project owner 2026-08-12 (decisions D42, D46, D47); Increment 7 inserted
and rows 8 and 9 renumbered 2026-09-15 (decision D74).

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
| **3 — Data foundations & journal** | Versification mapping, version stamps, coverage records; CI format guardians; ratify the journal design and ship write-only journaling. Also started immediately (owner ruling 2026-08-13): the CI packaging pipeline (#57), single-instance behavior (#4), and the Electronite/Graphite confirmation (#32) — packaging surprises must surface now, not in the release week | Aug 29 | #33 (#15 #16 #28), #17, #47, #22, #52, #57, #4, #32 |
| **4 — Open, resume, share** | Multi-project work, resume with fresh proof, first share, platform integration; the pilot program starts at this close (#58), and #13 de-risks Increment 6's suggestions one increment ahead | Sep 5 | #39, #7, #8, #13, #58 |
| **5 — Drafting for real** | Section drafting on the design's flow, verse spans (D70), formatting UX, async save for aligning and checking, the English suite in the artifact, the Windows build; ships J2 revised and J16 | Sep 18 | #141, #63, #54, #100, #163, #181, #197, #207 |
| **6 — Suggestions & resources** | Alignment suggestions learned from the project's own alignments (off by default, propose-only, D72), check comments and bookmarks, the help-resource upgrade flow, the guided fix screen, the fold in a worker; ships J12 and the revised J5 and J4 | Oct 2 | #261 (#262: #255, #134, #213, #1; #50; #40: #256, #257; #9; #94; #260) |
| **7 — Open Bible Stories** | A second kind of project (D66, D74): the OBS format section and harness first (#147), then the story store and journal vocabulary v2, OBS resources and the bundled picture pack, and the screens; ships J20 create, J21 translate frame by frame, J25 understand, J22 check. Inserted 2026-09-15 after Increment 6 closed 17 days early | Sep 25 | #64 (#147, #286, #288, #287, #289, #290, #291, #292, #293) |
| **8 — Publish & import** | Aligned USFM export and the print-ready PDF (owner ruling 2026-09-06: #20 moved here from Post-4.0), with the OBS export J23 on the same PDF path; the fixture-heavy importers: tC3 zip, x-tcore migration, raw USFM, Scripture Burrito, damaged projects; the first share (#120, after #156); verse renumbering and the re-key rules (D70); book introductions. Tags rc.1 | Oct 9 | #19, #20, #21, #14, #195, #196, #41, #2, #120, #156, #55 |
| **9 — Ship** | Installers, smoke test, rollback plan, witnessed offline run, local fonts, keyboard basics | Oct 15, **Oct 16 → v4.0.0** | #44, #45, #46, #43, #3, #32, #42 |

## Who October 16 is for — the pilot posture

**v4.0.0 is a pilot release** [owner ruling 2026-08-13]: selected external users plus
all internal users. Pilots do not bring real project data on day one, but soon after —
which is why the importers and the format work are fixture-proven before any real data
arrives. Testers receive a build and a one-page focus list at every milestone close,
starting with alpha.4 on September 5; the schedule lives in #58. 4.0.0 includes Open Bible
Stories drafting, understanding and checking (D74); OBS export and Door43 send do not. Broad adoption is the
4.0.x/4.1 story, after the pilot proves the journeys.

## Deliberately after 4.0.0

Safe by the data-accrual test, and said out loud so nobody assumes otherwise:
the RTL rendering proof (#29), the full screen-reader pass,
i18n key audit (#12), auto-merge of concurrent edits (#27), OBS layouts (#11), OBS audio
(#294), Door43 send for OBS (J24), and the
whole Phase 2 team-collaboration app (#23–#26). **4.0.0 is a single-translator
release.** Team sync arrives in Phase 2, folding the journal 4.0.0 has been
writing all along. The sync plan is `docs/plans/TEAM-SYNC-PLAN.md` (epic #24). It
starts after the legibility increment in `docs/plans/LEGIBILITY.md` closes (D67).

## Standing rules that bind the plan

- Reuse before build: for the journal, versification, and fonts, what pankosmia
  and the Proskomma ecosystem already provide is checked and used first (owner
  directive 2026-08-12; recorded on the issues).
- An increment moves at least one user journey (`Jn`, `docs/JOURNEYS.md`) to shipped,
  not a screen; nothing is done without pasted test evidence; each close tags a
  pre-release. Only a person has a journey; an increment is a development unit (D69).
- The format specification and its conformance harness change in the same change
  set (BURRITO-SPEC §9), and from Increment 3 the harness runs in CI.
