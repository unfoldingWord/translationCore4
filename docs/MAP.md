# tC4 document and vocabulary map

**Status:** live index [decided 2026-09-06 — D69]. Rendered by GitHub. No HTML (D43).
Rule (D69): every file under `docs/` and every id prefix in use appears here. The `docs:gate`
check for this rule is a follow-up.

## Documents

| File | Answers | Wins over |
|---|---|---|
| `docs/BURRITO-SPEC.md` | the project format | everything, including the harness (§9) |
| `docs/DECISIONS.md` | product decisions `Dnn` | STATE.md and chat |
| `docs/JOURNEYS.md` | what a user does and what is on disk when done | e2e headers, epics |
| `docs/ROADMAP.md` | increments, due dates, key issues | e2e headers |
| `docs/VISION.md` | actors, commitments | — |
| `docs/ARCHITECTURE.md` | how the client is built | — |
| `docs/PLATFORM-NOTES.md` + `docs/evidence/` | what Pankosmia does, with freshness citations | memory |
| `docs/RISKS.md` | known risks `Ledger #n` | — |
| `docs/JOURNAL-TEST-PLAN.md` | journal checks `JC-n` | — |
| `docs/PACKAGING.md` | installers and CI packaging | — |
| `docs/LEGACY-IDS.md` | how to read old ids | — |
| `docs/plans/*.md` | one plan per epic | — |
| `CONTEXT.md` | vocabulary | any other definition |
| GitHub issues labelled `question` | open items | — |

## Identifier prefixes

| Prefix | Meaning | Resolves in |
|---|---|---|
| `Dnn` | decision | DECISIONS.md |
| `Jn` | user journey | JOURNEYS.md |
| `JC-n` | journal conformance check group | BURRITO-SPEC Appendix A |
| `R-x.y.z` | normative rule | BURRITO-SPEC |
| `§n` | BURRITO-SPEC section | BURRITO-SPEC |
| `FR-nn` | legacy PRD requirement | LEGACY-IDS |
| `E-Jn`, `Tn`, `M-n` | legacy test-plan ids | LEGACY-IDS |
| `OPEN-QUESTIONS #n`, `OQ#n` | legacy open question | LEGACY-IDS |
| `Mn`, `En.n`, `In.n.n` | legacy milestone, epic, work item | LEGACY-IDS |
| `Cn.n` | legacy checklist row | LEGACY-IDS |
| `INCREMENT-n`, `PHASE-n-SUMMARY` | legacy planning and verification documents | LEGACY-IDS |
| `@incN` | e2e test tag | `e2e/` |
| `#n` | GitHub issue or PR | github.com/unfoldingWord/translationCore4 |
| `Ledger #n` | risk | RISKS.md |
| `PLATFORM-NOTES #n` | platform observation | PLATFORM-NOTES.md |
| `4.0.0-alpha.N` | pre-release | GitHub Releases |

## Abbreviations

| Term | Meaning |
|---|---|
| tN, tW, tWL, tA, tQ | translationNotes, translationWords, translationWords Links, translationAcademy, translationQuestions |
| ULT, UST | unfoldingWord Literal Text, Simplified Text |
| OBS | Open Bible Stories |
| DCS | Door43 Content Service |
| SB | Scripture Burrito |
| USFM | Unified Standard Format Markers |
| RTL, LTR | right-to-left, left-to-right script |
| LWW | last-writer-wins |
| STE | ASD-STE100 Simplified Technical English |
