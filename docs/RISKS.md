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
