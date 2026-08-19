# Automerge offline-collaboration proof (2026-08-19)

## Decision

**Safety proof: PASS. Adoption-value test: FAIL. Burrito carriage: PASS.**

Automerge 3.4.1 can be made trustworthy for tC4, including refusal of a hostile
contribution, but only in a narrow architecture: Automerge holds an append-only causal set
of already-validated tC4 action bodies. It does not merge USFM or verse text and does not
hold mutable nested project state. Signed, checksummed, immutable tC4 envelopes remain the
durable source of truth; an `A.save` snapshot is only a rebuildable cache.

That architecture does not earn its overhead. It retains the existing action schema,
grammar, fold engine, USFM codec, translation rules, review lists, and sealed storage rules;
then adds 415 lines of proof-quality production-path adapter/storage/fallback code, a signing
key lifecycle, a large WASM dependency, and poor long-history writer performance. The
recommendation is therefore **keep the custom journal**. This supports pull request 86's
outcome, but it corrects the rationale that Automerge cannot refuse a bad contribution.

This record reports what was measured on 2026-08-19. It does not claim that the dependency,
the platform, or performance is unchanged after that date.

## Versions and method

- Repository branch: `d52-retention`, pull request 86
- Node.js: 22.14.0
- `@automerge/automerge`: 3.4.1
- compatibility reads: 2.2.9 and 3.0.0
- Vite: 6.4.3; `vite-plugin-wasm`: 3.6.0
- fast-check: 4.8.0; Playwright: 1.61.1
- live local tC4 rig: Pankosmia Web package 0.18.5, product `tC4 dev rig` 0.1.0
- proof location: `spike/offline-merge/automerge/`

The proof reused the current `conformance/journal` validator, fold engine, HLC, USFM
skeleton codec, reconciliation seed, and real sample Burrito. It did not modify them.

## Architecture that passed

1. A root Automerge document contains only `schemaVersion`, `projectId`, and an `actions`
   map. Each key is SHA-256 of a sealed tC4 action body; each value is an Automerge
   `ImmutableString`.
2. A contribution may add only one immutable action value per Automerge change. Deletes,
   overwrites, unexpected root fields, predecessor overwrites, actor mismatches, and nested
   mutation are refused.
3. An Ed25519 actor manifest binds the tC4 actor identifier, signing public key, and
   Automerge actor identifier. Canonical JSON envelopes carry an exact checksum, signature,
   change hash, and canonical Base64. The envelope is limited to 4 MiB.
4. Intake verifies the envelope and every decoded Automerge operation, applies all changes
   to a clone, validates the resulting document, and runs the complete tC4 fold. Only the
   validated clone becomes accepted state. Pending ancestry and invalid causal closures are
   retained for retry or review; the accepted document is unchanged.
5. Durable state is the immutable root, actor manifests, and grouped signed change bundles.
   No `automerge-repo` storage defaults or compaction are used. `A.save` is not canonical:
   equivalent delivery histories can produce different cache bytes even when their change
   sets and folded tC4 state are identical.

This shape matters. The negative controls reproduced both unsafe models rejected by the
user need: concurrent whole-verse Automerge text rewrites produced the novel string
`MaryRut rewrot thedewhlendventse rewrote it.` without a conflict, and deleting a nested
verse while another peer edited it hid the edit from the current projection without a
conflict. The historical view could recover it, but a user must never need forensic recovery
to discover that years of checked work disappeared. Both models are forbidden.

## Requirement matrix

| User requirement | Verdict | Executed evidence |
|---|---|---|
| No silent content loss | PASS | Concurrent whole-verse candidates were both retained and surfaced as a fork; the travelling resolution retained all four actions. |
| Send, keep working offline, send again | PASS | The second bundle arrived first, remained pending, then applied after its ancestor; duplicate delivery was harmless. |
| Exact project rebuild | PASS | Eight real sample events crossed Automerge; TIT and JON USFM were byte-identical and alignment/decision records matched. The untouched conformance suite also passed. |
| Refuse hostile or invalid contribution | PASS, with tC4 adapter | A bad ancestor plus an honest dependent change was rejected as one causal closure; accepted `A.save` bytes were unchanged. Delete, overwrite, hidden-field, foreign-actor, bad-signature, and oversize attacks were rejected. |
| Human-readable who/what/when | PASS, from tC4 actions | The view uses the actor, operation, and HLC timestamp already stored by tC4, not Automerge internals. |
| Same result in any order, parts, or twice | PASS | 200 deterministic fast-check delivery permutations/duplicate sets converged to the same Automerge change set and identical tC4 fold. |
| Permanent full history | PASS, with custom immutable store | Three immutable bundles replayed; deletion and byte rewriting were detected. Simulated crashes after staging and after canonical write recovered exactly once. No Automerge compaction path is used. |
| Corruption boundary | PASS, with external seal | All 8,640 one-bit envelope mutations, 1,080 truncations, and appended garbage were rejected. Negative control: raw `applyChanges` accepted 77 of 1,040 bit flips into unexpected state. |
| Packaged desktop build | PASS, with cost | Vite built the WASM target using `vite-plugin-wasm` and `target: esnext`. Twenty fresh headless-Chrome contexts measured the cold-start cost below. |
| Reasonable Burrito carriage | PASS | In-process schema/ZIP/Git/text tests passed, followed by a live rig copy/commit/export/import test with a 2,512,429-byte signed bundle. |
| Unmergeable-journal fallback | PASS | Disjoint USFM verses auto-merged; same-verse alternatives and all three source files/hashes were retained; checking facts such as “Ruth has already been checked” can be carried separately. |

## Correctness run

Command:

```text
cd spike/offline-merge/automerge && npm run proof
```

Result:

```text
Automerge proof: 15 passed, 0 failed
```

Significant exact counts from that run:

```text
200 deterministic permutations/duplicate sets
8640 bit flips and 1080 truncations rejected
77/1040 raw Automerge mutations produced unexpected state (negative control)
8073-byte accepted document loaded by Automerge 2.2.9, 3.0.0 and 3.4.1
63308 raw artifact bytes; 14736 bytes added to the zipped sample Burrito
```

The existing contract was run unchanged:

```text
cd conformance && npm run validate:all
Phase 1/2/3 checks: pass
Journal: 336 passed, 0 failed
Normative coverage: 72/72

npm run verify
24 test files: 318 passed, 26 skipped
lint: pass; typecheck: pass; product build: pass
```

## Bad-contribution correction to the previous spike

The issue 77 closing comment and the earlier D52 text said a CRDT cannot refuse a bad
change after an honest peer has built on it. That is true if the bad change has already
become accepted shared state. It is not a proof that an incoming Automerge contribution
cannot be refused. D52 now records this correction.

The passing design treats each received causal closure as untrusted input. It applies the
closure to a disposable clone, validates every operation and every tC4 event, performs the
full fold, and commits nothing if any ancestor or descendant is invalid. The bad change and
dependent honest work remain quarantined together for review or recovery; accepted project
bytes do not change. This meets the user contract—work is accepted or reported, never
silently erased—and matches the intent of J20.

The cost is decisive: Automerge does not provide that boundary by itself. The project must
still own the external identity, signature, checksum, canonical encoding, append-only
operation policy, quarantine, full domain validation, and fallback path.

## Packaging and start-up cost

Command:

```text
npm run build
```

Vite 6.4.3 output:

```text
automerge_wasm_bg-CntZrugP.wasm   3571.26 kB raw   1128.42 kB gzip
fullfat_bundler-BcTfN-o9.js         93.43 kB raw     20.33 kB gzip
automerge-tEkxL2Fe.js                1.61 kB raw      0.92 kB gzip
```

Command:

```text
npm run startup
```

Twenty fresh browser contexts, cache disabled:

```json
{"runs":20,"baseline":{"wallMedianMs":525.0453749999997,"codeMedianMs":0.10000002384185791},"automerge":{"wallMedianMs":563.3067090000004,"codeMedianMs":35.10000002384186},"delta":{"wallMedianMs":38.261334000000716,"codeMedianMs":35}}
```

This is a headless Chromium engine measurement, not an installed Electronite application
boot. It establishes the dependency's browser initialization cost and build shape, not the
whole product's launch experience.

The proof creates fresh signing keys, so compressed ZIP byte counts can vary slightly from
run to run even though the uncompressed artifact size and behavior are stable.

Production dependency audit:

```text
npm audit --omit=dev --json
0 vulnerabilities
```

The full audit reported two moderate findings only under the deliberately installed
Automerge 2.2.9 compatibility alias and its old `uuid`; neither is a production dependency.

## Scale and archive overhead

The 50,000-edit test repeatedly edited 1,292 synthetic Isaiah verses. The production-shaped
Automerge path created one append-only change per tC4 action and transported groups of at
most 4,000 changes. Individual-file results are not acceptable and are included only as a
negative measurement; batching is mandatory.

Commands:

```text
ACTIONS=50000 INDIVIDUAL=0 COMPARE_CUSTOM=0 npm run bench
ACTIONS=50000 npm run bench:custom
```

| Measurement | Constrained Automerge | Current custom segments |
|---|---:|---:|
| Actions including seed | 50,001 | 50,001 |
| Author/seal time | 418,420.64 ms | 899.24 ms |
| Author/seal rate | 119.50 actions/s | 55,602 actions/s |
| Fold time | 325 ms | 246.18 ms |
| Receiver apply, grouped | 45,510 ms in 13 batches | not a separate CRDT step |
| Raw grouped envelopes | 46,952,687 bytes | 23,481,271 bytes |
| ZIP | 15,756,423 bytes | 18,905,925 bytes |
| Heap used at report | 173,996,416 bytes | 80,298,608 bytes |

The Automerge archive compressed better than the custom per-action JSON files, so Burrito
ZIP size is not a reason to reject it. The raw representation was about twice as large, but
the serious problem is operational: mutation of one long-lived document was superlinear,
taking 6 minutes 58 seconds for 50,000 edits, and validation of 13 received batches took
45.510 seconds. Sharding or rotating document generations could reduce that cost, but would
add lifecycle, cross-generation dependency, recovery, and history-view rules—the custom
machinery this replacement was meant to remove.

## Code deletion and value

Current `conformance/journal/*.mjs` is 2,688 lines on this branch. The minimal safe spike's
production-path files are 415 lines (`model.mjs` 289, `storage.mjs` 95, `fallback.mjs` 31),
excluding proof, benchmark, packaging, and live-test code. Those 415 lines call the existing
`sealAction`, `validateAction`, and `fold`; they do not replace the schema, grammar,
translation rules, USFM codec, or review behavior.

It might replace part of the 289-line current `files.mjs`, but a browser implementation
would still need WebCrypto key enrollment/revocation and IndexedDB or platform durable-write
semantics, none of which the Node proof implements. The evidence therefore does not support
a net deletion, much less a substantial one. Automerge's convergence is real, but tC4
already has executable convergence and domain-fold rules; the incremental benefit does not
justify the dependency and lifecycle cost.

## Burrito carriage

The durable artifacts are ordinary canonical JSON text under:

```text
ingredients/checking/journal/automerge/root.bundle.json
ingredients/checking/journal/automerge/actors/<actor>.json
ingredients/checking/journal/automerge/segments/<actor>/<sha256>.bundle.json
```

The live test ran against the local tC4 rig reporting Pankosmia Web 0.18.5. It copied the
sample Burrito, wrote four artifacts through `ingredient/raw`, rebuilt ingredient metadata,
committed them through the rig's Git route, exported the complete Burrito ZIP, imported it
under the required `_sideloaded_` source, and compared every artifact byte after import.

```json
{"status":"PASS","files":4,"largestBundleBytes":2512429,"exportedZipBytes":1942954,"routes":["ingredient/raw","metadata/remake-ingredients","git/add-and-commit","burrito/zipped export","burrito/zipped import"]}
```

This proves carriage through the tested local platform version and common project paths. It
does not claim every future transport, third-party Burrito implementation, or damaged
filesystem preserves unknown ingredients. The files are self-checking and signed, so a bad
transport is detected rather than silently accepted. Segment rotation below the existing
4 MiB limit is required.

## Previous objections accounted for

| Prior objection | Result |
|---|---|
| A contribution cannot be refused after a peer builds on it | The absolute claim is disproved for unaccepted intake. A whole incoming causal closure can be quarantined after validation on a clone. Already-accepted history remains immutable. |
| Automerge compaction loses history | The corrected PR 86 statement is right: `A.save` preserves complete change history; `automerge-repo` compaction rewrites storage. This proof avoids that storage layer and keeps immutable accepted bundles. |
| CRDT text can splice incompatible verse rewrites | Reproduced. Direct Automerge text is forbidden; whole tC4 action candidates are retained and the existing fold surfaces the fork. |
| Parent deletion can hide a nested concurrent edit | Reproduced. Mutable nested project state is forbidden. Actions are append-only top-level immutable values. |
| Raw binary corruption may apply without an error | Reproduced: 77/1,040 mutations produced unexpected state. Canonical signed envelopes rejected all exhaustive mutations of the test bundle. |
| History needs author and wall-clock time | Supplied by the retained tC4 action schema and pinned signer, not inferred from Automerge. |
| Missing dependencies, order, and duplicates | Pending/retry behavior and 200 property runs passed. |
| Exact J2/J15 rebuild behavior | Real TIT/JON sample rebuild and the untouched conformance suite passed. |
| Accepted bytes may not be rewritten | Signed contribution bundles are immutable; no compaction is used. `A.save` is a disposable cache. |
| Package size and start-up were not measured | Measured above. This closes the evidence gap named by issue 80 for the Automerge candidate, not for the current product generally. |
| The binary format may strand the project later | A simple document loaded across 2.2.9, 3.0.0, and 3.4.1; signed source bundles and USFM fallback reduce exit risk. This is a smoke test, not a lifetime compatibility guarantee. |
| AGPL blocks a closed-source tC4 app | Do not reuse this earlier survey error. This project is not closed-source; json-joy must be judged on capability and integration fit, not that premise. |
| Unmergeable journals could lose years of work | The fallback conserves the USFM sources and alternatives; structure conflicts retain all source files and hashes. Checking facts are explicitly carried separately rather than guessed. |

## High-level check of other candidates

Because Automerge passes safety but fails the value test, no second full implementation was
run. The issue 77 survey from 2026-08-17 remains directionally sufficient:

- Yjs/Yrs would require a parallel authored history and external sealed journal; default
  garbage collection conflicts with permanent history. It offers less fit than the safe
  Automerge action-set model.
- Loro's shallow-history/old-peer behavior and separate domain adapter leave the same
  permanent-history and custom-code problem. Do not cite its storage format as frozen; the
  previous investigation left that point unresolved.
- GunDB's last-write-wins behavior and RxDB's default conflict handler violate the no-silent-
  loss requirement.
- Server-dependent synchronization products do not satisfy independent offline peers who
  can send twice without receiving.
- Diamond Types, collabs, cr-sqlite, cola, Autobase, and json-joy did not present a stronger
  combination of scope, maturity, and domain fit in that survey. This proof supplies no new
  executed evidence for them.

There is no higher-priority candidate for a second proof. If the project revisits the
decision, the trigger should be a library or architecture that demonstrably removes the tC4
merge/storage code while retaining hostile-intake quarantine, permanent authored history,
and bounded long-history performance—not merely another general-purpose CRDT.

## Limits and remaining production risks

- The proof uses Node crypto and filesystem calls. Product code would need equivalent
  WebCrypto identity/key enrollment, recovery, revocation, and platform/IndexedDB durability.
- Actor enrollment is pinned in the test, but its human trust ceremony and lost-key UX are
  not designed. This is security-critical before production.
- Simulated crash points prove the write protocol's two boundaries; there was no real power
  loss, disk-full, torn-write, or filesystem fault injection.
- Cross-version loading covered one accepted document and three versions, not every data
  feature or future release.
- The 50,000-action corpus is synthetic and the timing is machine-specific. Its trend and
  order of magnitude are evidence; it is not a universal performance prediction.
- Startup used headless Chromium, not an installed Electronite build.
- The live carriage test proves the local rig version and tested routes, not a universal
  Pankosmia platform guarantee.
- Dependency audit and package health were checked on this date; no maintainer-bus-factor or
  independent security audit was performed.
