# Risk ledger — translationCore 4

Other documents cite this file as "Ledger #n". The numbering is stable — do not renumber.
Published 2026-08-07 from the project's risk ledger. Add a new risk as a new row; do not delete a row —
mark a retired risk in its Mitigation column.

| # | Risk | Mitigation |
|---|---|---|
| 1 | Upstream release cadence against the Increment-1 pin (0.18.5 git rev, D27 update) | Examine the pin again when Increment 1 closes. Run the transport and round-trip suites at the release that is current then (D27). Return to a crates.io `=` pin when 0.18.5+ publishes |
| 2 | Two writers on one book file in Phase 1 | Single app, single user in Phase 1. Load-time revalidation self-heals. Phase 2 solves it structurally |
| 3 | Load-time derivation cost on large books | Measure first (OPEN-QUESTIONS #9). An optional disposable cache keyed by content hashes — never a second source of truth |
| 4 | Phase 2 scope creep | Phase gate. Option to pilot journaling on checking data before drafting |
| 5 | A share-born `main` (one actor's working history, D79 point 12) is not proven equivalent to an integrate-born team main | The sync plan's X8 scenario runs the combined case before any sync feature ships (S1). If it fails, the first integrate rebuilds `main` from the share history as if it were a publication; no segment is lost because every segment is present |
| 6 | Two devices before team sync exists: a second device clones the shared `main`, drafts, and the next share from either device is not a fast-forward | The share refuses with `share.non-fast-forward`; the message says team sync is coming and local work is safe; never a force push (#362) |
| 7 | Repository name collision on the user's Door43 account, including tC3-era repositories | The create step runs first and refuses with `share.name-exists` before any push; the user picks another name (#362) |
| 8 | Door43 tooling (Door43 Preview, the catalogue) reading tC4 repositories with `checking/` sidecars and the journal | Low impact on the evidence of 2026-09-22 (Door43 Preview renders the USFM and ignores unknown ingredients); unverified against the journal paths; record in the J11 definition and re-check at the first pilot share |
| 9 | The platform's https push panics inside the credential callback when the username or the token is missing, instead of answering 400 [VERIFIED — pankosmia-web 0.18.5 (99fd9be), `push.rs:83-86`, 2026-09-22] | The app validates both fields before the call (#362); the finding is routed to upstream through the owner |
