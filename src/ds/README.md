# Vendored design system

This directory is a vendored copy of the **translationCore 4 Design System**.
The design master is the Claude Design project linked from epic #104
(https://claude.ai/design/p/fa258506-1fcd-4fc8-b63d-b10b1eac51b3). Design
changes are made there first and synced here — do not restyle components in
place. The app imports components from `src/ds/index.js` and the token
stylesheet from `src/ds/styles.css`, and does not edit either ad hoc.

First vendored 2026-08-27 (#109). Replaced 2026-09-04 with the new version of
the package (#171): its 38 components are thin shims over 13 primitives, and
`tokens/interactions.css` (the `data-tc` roles) is gone — `tokens/states.css`
(`data-i` roles) is the one interaction layer. Included: `tokens/`, `styles.css`,
every `components/**/*.jsx`, and the two Awami Nastaliq weights scripture uses
(`assets/fonts/`). Excluded: specimen cards (`*.card.html`), prompt files,
the `.d.ts` type surface, guidelines, templates, UI kits, uploads, thumbnails,
and the bundle, manifest and lint-rule files. The package's `readme.md`,
`MIGRATION.md` and `AUDIT.md` are owner-held and not in this repository.

Four names left with the package and are not in `index.js`: `Tabs` and
`SegmentedControl` (now `Switcher`, `indicator="underline"` / `"pill"`),
`Slider` (now `Field` + a native range input), and the old `Table` (the
primitive of the same name, new props). Every other old name still exists as a
shim and migrates when its file is next touched (`MIGRATION.md`).

Local changes (to sync back to the design master). Each is marked `tC4 local`
in the file:

- `tokens/states.css`: every `[data-i]` state declaration is `!important`. The
  primitives set their resting background, border and shadow inline, and an
  inline style beats a stylesheet rule that is not `!important`, so as shipped
  no hover, press or focus state rendered (verified 2026-09-04 with a
  computed-style probe: Button, BookTile and the app's `data-i` elements did
  not change on hover; on the previous version all did). The retired
  `interactions.css` carried the same flags for the same reason.
- `tokens/fonts.css`: the Google Fonts `@import` is replaced by the `<link>`
  in `index.html` (the app's existing pattern), so the fetch starts before the
  CSS bundle parses.
- `primitives/Layer`: new `scrimProps`, spread onto the scrim element, so a
  dialog's extra props (test ids) land on the scrim as they did before.
- `Modal`: `open` defaults to true (the app mounts a modal only while it is
  open); new `closeLabel` (i18n for the ✕ button); `zIndex` is accepted for
  the old call sites and ignored (Layer stacks by nesting depth, then DOM
  order); rest props go to the scrim via `scrimProps`.
- `Drawer`: `open` defaults to true; rest props go to the scrim via
  `scrimProps`.
- `AppHeader`: new `switchTitle` (i18n for the project chip tooltip).
- `TextField` / `Select`: the `id` prop goes to the `Field`, so the label's
  `htmlFor` reaches the control (accessibility + `getByLabel` tests).
- `Select`: an option object may carry `disabled`.
- `OptionCard`: new `recommendedLabel` (i18n for the Recommended badge).
- `HelpCard` (carried from #104/#106): a key word carries no verse label; a
  note with no quoted phrase prints no bare quotes; the body is a `div`, so
  rendered markdown blocks are not a `<p>` inside a `<p>`.
- `Callout`: the inner Text is a `display: contents` div, so a caller's flex
  layout on the callout (a sentence beside a button, `SourceTexts`) reaches the
  children as it did when they were the callout's direct children.
- `Divider`: the ignored `inverse` prop is destructured as `_inverse`, and
  `Menu` drops an unused `Stack` import — both for the repository's lint.

Dropped with this version: the local `--tc-invalid-inverse` token (#FF8B8B).
The package now ships `--tc-invalid-on-dark` (#F2938A) for the same purpose,
and the app uses that.

The directory boundary is deliberate: when a second consumer appears, this
tree becomes its own repository/package (`git mv`, not a refactor).
