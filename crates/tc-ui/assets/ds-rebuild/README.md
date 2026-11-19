# Rebuild-only design system additions

The design system in `../ds` is tC4's, byte for byte (`crates/tc-ui/vendored-from-tc4.txt`).
What only the rebuild adds to it lives here, and `crates/tc-ui/app/index.html` links it after
`ds/styles.css`, so a token set here replaces tC4's.

- `devanagari.css` registers Noto Sans Devanagari and puts it in `--font-ui` (#613).
- `reading-layout.css` stacks the existing book/story, passage and helps panels when they
  cannot fit beside one another, and puts the mode switch on a second header row (#993).
  The shared reading styles and AppHeader expose its custom properties; wide windows keep
  their original layout. A dragged helps width is bounded by the available width and returns
  when the window grows.
- `fonts/` holds its face and its OFL text. `scripts/release/notices.mjs` copies every
  `OFL-*.txt` here into `THIRD-PARTY-NOTICES.txt`.

`crates/tc-ui/tests/vendored_assets.rs` allows this folder beside the vendored files.
