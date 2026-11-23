# Design-system gallery

The Rust gallery renders `gallery-spec.json` with tC4's design-system components, CSS, fonts
and images. The `wasm-ui-gallery` gate compiles it. The screenshot comparison was retired on
2026-10-29 (`docs/rulings/2026-10-29-tc4-is-history.md`); #864 removes the capture scripts,
pixel and DOM diff tools, and their recorded output.

| Path | Used by |
|---|---|
| `gallery-spec.json` | `crates/tc-ui/build-gallery.sh` and the Rust gallery: cases, props, frames, languages and interaction protocol |
| `cases/`, `build-spec.mjs` | Generate and validate the spec from the reference tC4 checkout |
| `src/`, `index.html`, `vite.config.mjs` | Build the React gallery used by the behavior check |
| `scenarios.mjs` | Keyboard and mouse sequences compared on both galleries; the document claims check also reads their names |
| `protocol.mjs` | The behavior check: local static servers, Chromium, DOM observations and node identity |
| `package.json`, `package-lock.json` | Gallery build and behavior dependencies; the app's smoke, prepare-smoke and no-loss tools also resolve Playwright here |

## Build and browse

From the repository root:

```sh
crates/tc-ui/build-gallery.sh             # target/tc-ui-gallery
crates/tc-ui/build-gallery.sh --release
```

The build needs the `wasm32-unknown-unknown` Rust target and the wasm-bindgen CLI version
pinned by tc-ui. Serve the output with a local static server. `?case=Button/primary-md&auto=1`
mounts one case; the index lists all cases.

The React gallery uses a reference tC4 checkout through `TC4_ROOT` (see `vite.config.mjs`):

```sh
cd parity/ds-gallery
npm ci
npm run build       # regenerate spec, then build the React gallery into dist/
npm run dev         # browse the React gallery
node scenarios.mjs  # compare behavior; needs dist/ and target/tc-ui-gallery/
```

`node scenarios.mjs --only menu-keys` runs one sequence. The check compares DOM, focus, scroll
lock and node identity after each action. It fails on differences or page errors and writes
`scenario-report.json` (ignored, regenerated output). It needs Playwright's Chromium installed.

Removed screenshots and comparison records remain in git at
`b6c5df68aa4f31b3e4357d46eb2095f749332a72`.
