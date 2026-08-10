# Legacy reference IDs — how to read them

> **Frozen reference [decided 2026-08-10 — D44(b)].** The IDs this file decodes can no
> longer be assigned; nothing here needs maintenance. The file stays published because
> issue bodies link to it.

The documents in this directory, and the decision log especially, carry short reference
IDs from the project's pre-GitHub tracking files. The IDs were kept on purpose: they make
the historical record searchable. An issue migrated from a legacy item names its ID in
the issue body (issue titles stay plain language), so a search for `I1.2.4` still finds
the issue. This table decodes each ID class and says where the referenced item lives now.

| ID form | Example | What it is | Where it lives now |
|---|---|---|---|
| `Dnn` | D28, D40 | A recorded decision | `DECISIONS.md` — one section per decision |
| `Ledger #n` | Ledger #2 | A standing risk | `RISKS.md`, same numbering |
| `OPEN-QUESTIONS #n`, `OQ#n` | OPEN-QUESTIONS #17 | An open technical question | Historical register (maintainer workspace). Open items become issues labelled `question`, with the number named in the issue body. Closed items are quoted where they were closed — usually in `DECISIONS.md` or an evidence record |
| `Mn` / `En.n` / `In.n.n` | M2, E2.6, I1.2.4 | Legacy milestone / epic / work item from the old backlog file | Open items become GitHub issues with the legacy ID named in the body; delivered items are recorded in the migration reconciliation (maintainer workspace) |
| `Cn.n` | C2.13 | A row of the internal implementation checklist | Maintainer workspace (frozen derivation record). Open remainders become issues with the ID named in the body |
| `Tn` / `M-n` | T21, M-5 | A row of the internal test plan | Maintainer workspace. The public equivalent of the aggregate is `npm run verify` |
| `FR-nn` | FR-33 | A functional requirement of the internal PRD | Maintainer workspace. The behavior it requires is stated where cited |
| `Jn` / `@incN` | J5, @inc2 | A user journey / its test tag | Journey tests live in `e2e/` (`npm run test:e2e`) |
| `INCREMENT-n` / `PHASE-n-SUMMARY` / `STATE.md` | INCREMENT-2.md | Internal gated-build planning and verification documents | Maintainer workspace. Their decisions are in `DECISIONS.md`; their verification evidence is summarized in the increment close entries there |
| `sample-burrito/`, `sample-burrito-validation/` | harness check 23 | The conforming sample project and the executable conformance harness (34 checks + journal 59) | Maintainer workspace; publication is a tracked issue |
| `upstream/…`, `upstream-prs/…`, `scripts/upstream-freshness.zsh` | — | Read-only upstream mirrors and verification tooling | Maintainer workspace. See "Verifying a platform claim" in `PLATFORM-NOTES.md` |
| Rust/JS file names without a path | `structs.rs`, `post_raw_ingredient.rs` | Source files of `pankosmia-web` or its clients, read at the cited pin | Upstream repositories, at the version + hash + date the citation names |

Two reading rules:

1. **A citation is anchored to its date.** `[VERIFIED — pankosmia-web 0.18.5 (99fd9be,
   2026-07-30)]` states what was read and when — it makes no claim about today.
2. **If an ID does not resolve with this table, it is a defect.** Open an issue labelled
   `documentation` and quote the line.
