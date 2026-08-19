# Automerge offline-collaboration proof

Disposable proof for issue 77 and pull request 86. This is deliberately outside `src/` and
is not product code.

## Result

Automerge 3.4.1 can meet the collaboration safety contract only when it is used as an
append-only causal set of validated tC4 action bodies. It must not merge verse text directly
or hold mutable nested project state. Every contribution is carried in a canonical JSON
envelope with SHA-256, an Ed25519 signature, a pinned actor manifest, and a 4 MiB limit.
Incoming changes are trial-applied to a clone, structurally checked, fully folded with the
existing tC4 engine, and only then accepted.

The proof passes, but adoption is not recommended. The safe shape retains the existing
schema, grammar, fold, USFM codec, and review behavior; adds its own adapter, immutable
storage, and key lifecycle; adds a large WASM payload; and has poor long-history write
performance. See `../../../docs/evidence/automerge-proof-2026-08-19.md`.

## Commands

```sh
npm ci
npm run proof
npm run build
npm run startup
npm audit --omit=dev

ACTIONS=50000 INDIVIDUAL=0 COMPARE_CUSTOM=0 npm run bench
ACTIONS=50000 npm run bench:custom
```

The live carriage proof needs the tC4 development rig at `127.0.0.1:19998` and its
`sample_burrito` repository:

```sh
cd ../../../../dev-env
./scripts/run.zsh

cd ../translationCore4/spike/offline-merge/automerge
npm run live-carriage
```

`live-carriage.mjs` creates temporary repositories, exercises the raw ingredient, metadata,
Git, ZIP export, and ZIP import routes, verifies exact bytes, and removes the temporary
repositories in `finally`.

## Files

- `model.mjs`: constrained data model, signatures, intake validation, replay, and history
- `storage.mjs`: immutable segment store and simulated crash recovery
- `fallback.mjs`: loss-conserving USFM fallback for an unmergeable journal
- `proof.mjs`: requirement, adversarial, corruption, version, and transport proof
- `bench.mjs` / `custom-bench.mjs`: scale and comparison measurements
- `packaging/`: Vite/WASM packaging and cold-start measurement
- `live-carriage.mjs`: live Pankosmia/Burrito round trip

`unsafeBundleForProof` is intentionally limited to adversarial tests: it signs forbidden
same-actor operations so the intake boundary, not just the friendly writer, is exercised.
