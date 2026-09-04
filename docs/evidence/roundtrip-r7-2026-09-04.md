# Round-trip R7 reads its count from the Phase-1 summary — verified live (2026-09-04)

**Question:** does check R7 of the round-trip suite hold on a reseeded rig when it takes
the expected Stage-1 count from the Phase-1 suite's own summary line instead of a constant?

**Method:** `cd conformance && RIG_REPOS=<rig repos> node validate-roundtrip.mjs` against
the dev-env rig, pankosmia-web 0.18.5 (pinned rev `99fd9bea8a9f3d14ac6a61f8e2213f1c5d42ed2a`,
`dev-env/server/Cargo.toml`), on 2026-09-04, at working tree of `main` 4490820 plus the
L-1 change set (issue #154). The rig was stopped, reseeded with `dev-env/scripts/seed.zsh`,
and started before the run. R7 runs `validate.mjs` twice: once on the harness's own
`conformance/sample-burrito` (the authoritative count) and once on the server-touched copy
`_local_/_local_/rt_burrito`, and requires the same Stage-1 count with 0 failed.

**Result:**

```
  harness on own sample          → Stage-1 (path-authoritative — holds on today's pankosmia-web): 35 passed, 0 failed
  harness on server-touched copy → Stage-1 (path-authoritative — holds on today's pankosmia-web): 35 passed, 0 failed | Stage-2 (role/relationships durability — x-roles non-durable by design, D28; client re-asserts after remake): 1 passed, 1 failed
PASS  R7: Stage-1 conformance (35 checks, the Phase-1 suite's own count) holds on the server-touched copy — the format survives today's server at the level the spec claims
Round-trip suite: 12 passed, 0 failed (server http://127.0.0.1:19998/api)
```

The Stage-2 failure on the server-touched copy is the designed, non-durable role table
(D28); it is not part of R7.

## The false failure this run also explains

Before the reseed, the same suite reported `Round-trip suite: 11 passed, 1 failed`: R7 saw
`Stage-1 ...: 33 passed, 2 failed` on the server-touched copy. The two Stage-1 failures
were:

- `SB schema: metadata.json valid against Pankosmia bundled schema` — an ingredient key
  `/MOVED.md` fails the SB path pattern.
- `ingredients: metadata lists exactly the on-disk files`.

Cause: the rig's seed script on this machine (`dev-env/scripts/seed.zsh` of the
maintainer workspace, not this repository) copied the workspace's frozen mirror of the
sample project, which carries `MOVED.md` (the D43 pointer stub), `.ignore`, and a
`graft/` index directory. The server's ingredient rescan (`update_ingredients` on the
first write) listed `/MOVED.md` and `/graft/INDEX.md` as ingredients of the copy. The
repository's own `dev-env/scripts/seed.zsh` copies `conformance/sample-burrito` and does
not have this defect. The workspace script was repointed to the harness sample on
2026-09-04. This is the same class as the "three false failures on a rig that was not
reseeded" that `docs/plans/LEGIBILITY.md` 1.2 records against 60be039: a seed that is not
the harness sample, not a server or format change.

## Limits

- One machine (macOS, Node v22.14.0), one rig, one run after the reseed.
- Not tested: a rig seeded by the repository's own `dev-env/scripts/seed.zsh` (that
  script was not run here; the running rig is the workspace one).
- `npm run prove` leaves the rig non-pristine after the rig suites run (the suites create
  `rt_burrito`, `rig_*`, and journey projects). A second `prove` refuses the rig suites by
  name until the rig is reseeded. This is the designed behavior of #154, not a defect.
