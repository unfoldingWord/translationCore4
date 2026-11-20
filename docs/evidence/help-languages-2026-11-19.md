# Help in the app's language (issue 1036): the build of the help, and the journey

What `crates/tc-ui/vendor-help.sh` copied, that two builds of the site give the same bytes, and
what the help journey showed on a built app. Run on macOS only. **Not run on Windows or Linux.**

- **Date:** 2026-11-19.
- **Machine:** macOS 26.5.1 (25F80), Apple silicon.
- **Source:** translationCore-Suite-website at `835fb965a322bc3800b61e95f4d2518010f3dd5a`, the
  merge of its pull request 11.
- **Tools:** Node v22.14.0, npm 11.5.2; `npm ci` installed Astro 5.18.2 and
  `@fontsource/noto-sans-arabic` and `@fontsource/noto-sans-devanagari` 5.3.0, as the site's
  `package-lock.json` pins them.

## Two builds give the same bytes

The site holds the help pages as sources, so `help-pages.txt` lists the git blob ids of built
files, which no `git ls-tree` of the site can confirm. Two builds were made on this machine, each
from its own fetch of the commit and its own `npm ci`:

1. `crates/tc-ui/vendor-help.sh` (its build is in `target/vendor-help`, which it removes).
2. By hand in another folder: `git fetch --depth 1 origin 835fb965…`, `npm ci`, `npm run build`.

Each of the 966 files under `crates/tc-ui/help` was compared, byte for byte, with the file of the
second build's `dist/` that it was copied from: 966 the same, none different, none missing. A
build with another Node or on another system was not tried.

## What was copied

- `help/`: the English help, 210 files (89 pages, the images, the help's own assets, the search
  index). The images, `features.json` and the search index are the bytes vendored before
  (#1031); the 89 pages and two scripts changed.
- `help/es`, `fr`, `hi`, `pt`, `id`, `ru`, `vi`, `ar`: 90 files each (89 pages and a search index).
- `help/site/assets/`: 36 files: `css/help-i18n.css`, `js/help-i18n.js`, `fonts/arabic.css`,
  `fonts/devanagari.css` and the 32 font files those two style sheets name.
- Not copied: the site's seven other help languages, its `/assets/js/locale.js`, its Avenir Next
  fonts (no help page loads them) and its four other font packs.
- The licence texts of the two font packages (`LICENSE` in each) are byte for byte the app's
  `OFL-NotoSansArabic.txt` and `OFL-NotoSansDevanagari.txt`, which `notices.mjs` already copies
  into THIRD-PARTY-NOTICES.txt.

## The translationcore.com addresses the pages name

`curl -sI https://translationcore.com<path>` answered 200 with no redirect for `/`, `/desktop/`,
`/es/`, `/fr/`, `/hi/`, `/pt/`, `/id/`, `/ru/`, `/vi/` and `/ar/` (2026-11-19).

## The address forms the pages hold

The server's rules read `href="/…"` and `src="/…"` in a page and `url(/…)` in a style sheet, and
cut the language menu and the `locale.js` tag by their exact opening text. The review of pull
request 1071 asked whether the vendored files hold a form these rules do not read. Two checks
answer it.

The first is `cargo test -p tc-server --test help_links`: it walks every `href`, `src`, `srcset`,
`action`, `url()` and search result of every page as served, and each one resolves in the app.

The second is a count over the 966 vendored files (801 pages, 4 style sheets, 12 scripts), one
regular expression for each form on the list below. Each expression was first run on a control
page and style sheet that hold the form, and counted it there. On the vendored files:

- Style sheets: 32 `url(/…)` as the rules read it, all in the two font style sheets. None in
  quotes, none after a space, no `@import`.
- Pages, none of these: a `srcset`, `action`, `poster`, `data`, `formaction` or `ping` that names
  an address from the root; an `href` or `src` in single quotes, without quotes, with a space
  beside the `=`, or not in lower case; a `base` element; a meta refresh; an inline `url(` from
  the root; an inline `@import`.
- Each of the 801 pages holds the menu's exact opening tag once and the class `help-lang` in no
  other tag, and holds the exact `locale.js` tag once and that file's name nowhere else.
- Search indexes: one `search-index.js` for each of the nine languages, and one
  `search-index.json` (English). Each holds 87 results, each a relative address.

A form that is not on this list was not counted.

## The scripts the pages run

- `assets/search.js` and `assets/page-toc.js`, as before #1036; they now take their words from
  the page and split words of any script.
- A `search-index.js` for each language (data).
- `site/assets/js/help-i18n.js`, 15 lines: it closes the language menu. The app serves each page
  without the menu, so it finds none and stops.
- One inline script in each page. In all 801 it is two assignments of JSON values
  (`__tcLocale`, `TC4_HELP_I18N`) and nothing else.

`search.js`, `page-toc.js` and `help-i18n.js` are the files that hold code. The text of none of
the three holds `fetch`, `XMLHttpRequest`, `sendBeacon`, `WebSocket`, `EventSource`, `parent`,
`postMessage`, `localStorage`, `sessionStorage` or `document.cookie`.

The review also asked whether a help script can reach the app's page. It can, and it could before
this change: the frame has no `sandbox` (`crates/tc-ui/src/views/help_panel.rs`), the server sends
its policy header with `index.html` only (`crates/tc-server/src/statics.rs` `index`), and the
help has the app's origin. That is so on `main` since #1031, with `search.js` and `page-toc.js`.
This change adds no limit and takes none away.

## The journey

`parity/app/journeys/help.test.mjs`, on `tc4` built with `--features test-hooks,fixture-backend`
and the UI of `crates/tc-ui/build-app.sh`, in Playwright's Chromium. The rig aborts every request
to another origin and lists it; each case below ends with that list empty.

| Case | Result |
|---|---|
| a to e, g to k (English, as before) | pass |
| f (modifier clicks) | fails at its Ctrl+click, the first of its four variants: the page never shows. With that one variant taken out, the case passes on this build. This branch does not change the case. The cause was not looked for here; pull request 1034 recorded the same failure on this Mac before this change. Found and fixed on 2026-11-20: see "Case f on macOS" below |
| l: Español, the help home, a search for "alinear", its first result, a shared image | pass |
| m: العربية, right to left, the Arabic face loaded from the app and first in the heading's font | pass |
| n: Українська and English show the English help | pass |
| o: after the app language changes, the next opening shows the new language | pass |
| p: app in English on a computer in Spanish; the help stays English | pass |

Control: cases l, n and p on a `tc4` built with `HELP_CUT` empty, with the site's `locale.js` put
beside the vendored files (cases m and o were not run in the control). Cases l and n failed (the
page showed the language menu: 17 nodes where 0 are wanted) and case p failed (the English help
home never showed in the time the case waits for it). With `HELP_CUT` empty,
`cargo test -p tc-server --test help_links` also failed, on the menu's links to the languages
that are not vendored (404).

Control for the byte list: with one byte of `help/es/index.html` changed,
`cargo test -p tc-ui --test help_pages` failed with "help/es/index.html is not the site's".

Run again on the branch with `main` at `c040cb7f` merged in (commit `87392095`), on a new build of
`tc4` and the UI: the help journey gave the same results (17 of 18 pass; case f stops at the same
place, "no section-getting-started shows after 60000 ms"), and
`parity/app/journeys/app-language.test.mjs`, which now takes `applyLanguage` from `kit.mjs`,
passed 16 of 16. The controls were not run again.

## Case f on macOS

Added on 2026-11-20, after the review of pull request 1072 asked why case f fails. Same machine,
Playwright 1.56.1, Chromium 141.0.7390.37.

- **The same failure on `main`.** `tc4` and the UI built from `main` at `13b3c27b`, with `main`'s
  journey file: 11 of 12 cases passed, and case f failed with the same words, "no
  section-getting-started shows after 60000 ms". On the pull request's head, `07ea9480`, 17 of 18
  passed, cases l to p among them, and case f failed the same way.
- **The cause.** The journeys' Chromium on this Mac turns a Control+left click into a
  context-menu click. A page with one link gave these events for the case's four clicks:
  Ctrl gave `mousedown` and `contextmenu` and no `click`; Shift and Meta gave `mousedown` and
  `click`; the middle button gave `mousedown` and `auxclick`. A plain click, the control, gave
  `mousedown` and `click`. So the Ctrl+click never opened the link.
- **On Linux the case passes.** CI's `journeys 2/2` job on `main` at `13b3c27b` printed `ok` for
  case f, in the merge queue's run (44652659921) and in the run on the push (44654809191).
- **The fix.** tC4's own spec holds a branch for this (`git show d25b7871:e2e/help.spec.ts`,
  case f): on macOS, after the Ctrl+click, no window opens and the frame stays on the help home.
  The journey here had no such branch. With it, the help journey passed 18 of 18 on this Mac, on
  `tc4` and the UI built from `07ea9480`. On Linux and Windows the case runs the statements it ran
  before.
- **Control.** With a plain click in place of the Ctrl+click, the case failed on this Mac with "no
  index.html shows after 60000 ms": the new branch fails when the link opens.

## Screenshots

In `docs/evidence/help-languages-2026-11-19/`, kept by the journey with `HELP_SHOTS`:

- `help-home-es-419.png`: the app in Español, the Spanish help home.
- `help-home-ar.png`: the app in العربية, the Arabic help home, right to left.
- `help-home-uk.png`: the app in Українська, the English help home.
- `help-search-es-419.png`: the results of a search for "alinear" in the Spanish help.
- `help-search-result-es-419.png`: the first of those results, open in the panel.
