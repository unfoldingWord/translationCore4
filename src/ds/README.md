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
  no hover, press or focus state rendered [VERIFIED — Playwright computed-style
  hover probe on the rig-served build: Button, BookTile and the app's `data-i`
  elements did not change on hover with the package as shipped; on `main`
  21e7348 all did; 2026-09-04]. The retired `interactions.css` carried the same
  flags for the same reason. The `choice` hover rule excludes selected surfaces
  (`aria-checked`, `aria-pressed`, `data-selected`), as the old rule did: with
  the flags, the package's selected-hover tint would repaint a solid-filled
  selected chip pale under white text.
- `primitives/Surface`: `disabled` reaches the DOM — a native `disabled` on a
  button, `aria-disabled` otherwise — so a disabled `OptionCard` is not
  focusable and is announced as disabled, as the old `<button disabled>` was.
- `OptionCard`: `trailing` is not `aria-hidden`; the app puts an "Always
  included" badge and installed counts there, which are part of the row's
  accessible name.
- `tokens/fonts.css`: the Google Fonts `@import` is removed. The app works
  offline, so Mulish, Charis SIL, Noto Serif, Noto Serif Hebrew and Amiri are
  `@font-face` rules over `.woff2` files in `assets/fonts/`, with their OFL
  licence texts (#3). Noto Nastaliq Urdu is not fetched.
- `primitives/Layer`: new `scrimProps`, spread onto the scrim element, so a
  dialog's extra props (test ids) land on the scrim as they did before.
- `primitives/Layer` (#446): a press on a scrim closes that scrim's layer
  only when no layer that closes on an outside press is open inside it — the
  same innermost rule as Escape. That press is cancelled, so the focus stays
  where it is. Before, a press on a dialog's scrim with a dropdown open closed
  the dropdown and the dialog.
- `primitives/Layer` (#214): the scrim, or the panel of an anchored layer
  (it has no scrim), carries `data-layer-placement`. On
  macOS the desktop window has no title bar, and `src/ui.css` uses this
  attribute: a layer does not move the window, and a full-height side panel
  starts below the header, clear of the window controls.
- `Modal`: `open` defaults to true (the app mounts a modal only while it is
  open); new `closeLabel` (i18n for the ✕ button); `zIndex` is accepted for
  the old call sites and ignored (Layer stacks by nesting depth, then DOM
  order); rest props go to the scrim via `scrimProps`.
- `Drawer`: `open` defaults to true; rest props go to the scrim via
  `scrimProps`.
- `AppHeader`: new `switchTitle` (i18n for the project chip tooltip).
- `AppHeader`: three columns, the two side ones equal, so `center` stays in the
  center of the bar; a project name that does not fit is cut with an ellipsis
  (issue #599).
- `TextField` / `Select`: the `id` prop goes to the `Field`, so the label's
  `htmlFor` reaches the control (accessibility + `getByLabel` tests).
- `Select`: rewritten as a select-only combobox (issue #446, owner decisions
  2026-09-27) — a 36px combobox button that opens a listbox in an anchored
  `Layer` popover, in place of the native `<select>`, which cannot hold the
  approved panel (a search field inside the list, sticky group headers,
  multi-column rows). The name and core props are unchanged; an option object
  may carry `disabled`, `code`, `meta`, `badge` and `group`; lists of 10 or
  more options open with a search field (`searchPlaceholder`,
  `noMatchesLabel`); `onChange` still receives `{ target: { value } }`.
- `OptionCard`: new `recommendedLabel` (i18n for the Recommended badge).
- `SuggestField`: new (issue #492) — a text field with a list of suggestions
  under it, for the Language name field of New Bible and New Open Bible
  Stories. The typed text is the value; a suggestion is an offer, and
  `onChoose` tells the caller which one was taken. It draws its list with the
  `Select`'s `Layer` popover and `Row` (now exported from `Select.jsx`), so the
  two lists look the same. The `Row`'s `meta` text now shrinks with an
  ellipsis before the label does.
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
