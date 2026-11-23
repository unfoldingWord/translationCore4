# Journey fixtures and mock server

This folder supplies the app's fixture backend, the fake Door43 and the browser journeys.
The screenshot comparison was retired on 2026-10-29
(`docs/rulings/2026-10-29-tc4-is-history.md`). #864 removes its captures and capture entry point.

| Path | Used by |
|---|---|
| `fixtures/build-state.mjs` | `parity/app/state.mjs`: builds scenario projects, installed resources and fake Door43 state |
| `fixtures/vendor/` | The state builder and app fixture backend: resource bytes, provenance in `SOURCES.json`, and the pinned vendor builder |
| `mock-server/server.mjs`, `mock-server/server.test.mjs` | Node check: a local mock of the Pankosmia API over the fixture state |
| `mock-server/fake-door43.mjs` | Journeys, the app driver environment, and the Rust fake's binary contract test: fake account and repository replies |
| `manifest.json` | The journey coverage check: identity of the tC4 reference commit |
| `package.json`, `package-lock.json` | Pinned fixture dependencies and Playwright for the journeys and shell e2e builds |

## Run

```sh
cd parity/tc4-baseline
npm ci
npm run check
```

The app's scenarios use the repository's own fixture copies, with no tC4 checkout:

```sh
node parity/app/state.mjs --scenario sample --out target/sample-state
```

Run this from the repository root. The other scenarios are `en-pins` and `shared`.
`parity/app/state.sha256.json` checks their bytes. The fixture backend finds the same files
by digest in `fixtures/tc4`, `fixtures/parity-state` and `fixtures/vendor` here.
`fixtures/build-state.mjs` can also read a tC4 checkout with `--tc4`; its default output is
`.state/<scenario>`. `npm run serve` starts the local mock server over that state.
`npm run vendor` regenerates the resource subset from the pinned sources and checksums in
`fixtures/vendor/make-vendor.mjs`; it downloads those sources.

The project fixtures pin resources that this small harness does not fully supply. The state
builder records substitutes and original hashes in its generated `provenance.json`; the vendor
sources and their versions are recorded in `fixtures/vendor/SOURCES.json`.

The reference is tC4 `d25b7871904228a342c0d80280136d8636833653` (4.0.0-rc.2).
The recorded screens, DOM, behavior recordings and earlier baselines remain reachable at
`b6c5df68aa4f31b3e4357d46eb2095f749332a72`, the last commit before #864's cleanup.
For example: `git show b6c5df68:parity/tc4-baseline/screens/home.png`.
