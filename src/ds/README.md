# Vendored design system

This directory is a vendored copy of the **translationCore 4 Design System**.
The design master is the Claude Design project linked from epic #104
(https://claude.ai/design/p/fa258506-1fcd-4fc8-b63d-b10b1eac51b3). Design
changes are made there first and synced here — do not restyle components in
place. The app imports components from `src/ds/index.js` and the token
stylesheet from `src/ds/styles.css`, and does not edit either ad hoc.

Vendored at 2026-08-27 from the local working copy
(`translationCore 4 Design System/`, synced from the design project the same
day). Included: `tokens/`, `styles.css`, every `components/**/*.jsx`, and the
two Awami Nastaliq weights scripture uses. Excluded: specimen cards, prompt
files, `.d.ts` type surface, guidelines, templates.

Local changes (to sync back to the design master):

- `tokens/fonts.css`: the Google Fonts `@import` is replaced by the `<link>`
  in `index.html` (the app's existing pattern), so the fetch starts before the
  CSS bundle parses.
- `Modal`: new `closeLabel` (i18n for the ✕ button), `zIndex` (a confirmation
  stacking over another modal), and rest-prop passthrough to the scrim (test
  ids).
- `AppHeader`: new `switchTitle` (i18n for the project chip tooltip).
- `TextField` / `Select`: new `id` prop wired to `htmlFor` so the label
  reaches the control (accessibility + `getByLabel` tests).
- `OptionCard`: new `recommendedLabel` (i18n for the Recommended badge).
- `tokens/colors.css`: new `--tc-invalid-inverse` (#FF8B8B) — error text/dot
  on the Ocean header, where `--tc-invalid` fails contrast.

The directory boundary is deliberate: when a second consumer appears, this
tree becomes its own repository/package (`git mv`, not a refactor).
