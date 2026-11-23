# App journey harness

This folder drives the Rust app through its screens and checks what a translator sees and
what is saved. The screenshot comparison with tC4 was retired on 2026-10-29
(`docs/rulings/2026-10-29-tc4-is-history.md`). Its capture tools and records were removed in #864.

| Path | Used by |
|---|---|
| `journeys/fixtures/` | The refused-open reply and the signed-in account, Home and saved-indicator DOM used by journeys, moved byte for byte from the retired galleries |
| `journeys/` | Browser tests and coverage checks; `scripts/gates.sh --step journeys` runs every journey with no skips |
| `env-rust.mjs`, `env-rust.test.mjs` | Journeys: start `tc4 serve` on fresh project and app-data folders, build a scenario, authenticate requests, abort other origins, control the fake Door43 and stop the app |
| `observe.mjs`, `observe.test.mjs` | The environment and journeys: request tracking, settling and DOM observations; environment tests also exercise capture failure reporting |
| `screens.mjs` | The environment and journeys: the two fixture project repo paths |
| `state.mjs`, `state.test.mjs`, `state.sha256.json` | Build scenarios from the checked-in fixtures and verify their bytes; the app also reads the digests |
| `units.json` | The tc-api golden tests and tc-app app-data tests: which implementation units have landed |

## Run

From the repository root:

```sh
scripts/gates.sh --step node       # Node checks; browser tests skip without builds
scripts/gates.sh --step journeys   # build app, UI and fake Door43; run browser journeys
```

Playwright is installed by `npm ci` in `parity/tc4-baseline`, or supplied through
`PLAYWRIGHT_MODULE`. The journey command needs its Chromium installed. To run an individual
journey against existing builds, set `TC4_BIN`, `TC4_UI`, `TC4_UI_HOOKS` and `TC4_DOOR43_FAKE`
as described in `journeys/kit.mjs`.

The environment runs on the store by default. Door43 stays local: journeys that need it use
`withApp(body, { door43: true })` and the fake's control port. Without the fake, the app points
at a port with no listener. The coverage map and its tests link the journeys to
`docs/JOURNEYS.md` and the tC4 reference in `../tc4-baseline/manifest.json`.

The removed screens and capture tools remain in git at
`b6c5df68aa4f31b3e4357d46eb2095f749332a72` (the parent of this cleanup).
