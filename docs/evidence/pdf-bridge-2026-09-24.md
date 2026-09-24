# PDF bridge — mechanism choice and packaged-app check, 2026-09-24

Issue: [#20](https://github.com/unfoldingWord/translationCore4/issues/20), task 1 and the
right-to-left visual check. Branch `issue-20-pdf-export`, base `main` 04dc048.

> **Note (same date, later measurement).** After sections 2 and 4 were measured, the owner
> ruled that the PDF and the preview leave out a chapter with no drafted verse. Section 5
> holds the measurements under that rule. The Titus counts in sections 2 and 4 are of the
> earlier document, which printed all three chapters. They stay here unchanged.

## 1. Task 1: which route makes the PDF bytes

Date: 2026-09-24. Runtime: Electronite v37.1.0-graphite (Electron 37.1.0, Chrome
138.0.7204.35), the wrapper of the installed `translationCore4.app` 4.0.0-alpha.7. The probe
ran on the bare runtime (`dist-desktop/electronite/Electron.app`), because the installed binary
ignores a path argument and starts its own entry. Method: one hidden `BrowserWindow`, one
two-column test document with a drop cap per chapter, `loadFile`, then
`webContents.printToPDF({ preferCSSPageSize: true, printBackground: true })`.

| Case | Pages | MediaBox (pt) | Time |
|---|---|---|---|
| A4, line height 1.4 | 3 | 0 0 594.95996 841.91998 | 176 ms |
| A4, line height 2.8 | 5 | 0 0 594.95996 841.91998 | 133 ms |
| Letter, line height 1.4 | 3 | 0 0 612 792 | 122 ms |
| A4, pointed Hebrew, `dir="rtl"` | 2 | 0 0 594.95996 841.91998 | 163 ms |

Result:

- `printToPDF` returns the bytes directly. No dialog opens.
- CSS `@page { size }` sets the paper when `preferCSSPageSize` is true.
- The browser route (`window.print()`) makes a file only through the print dialog. So it cannot
  meet the #20 criterion "no print-dialog page".

**Choice:** a bridge. The owner approved it on 2026-09-24, in the session that built #20:
`ipcMain.handle('export:pdf', html)` writes a temporary HTML file, loads it with `loadFile` in
a hidden window, calls `printToPDF({ preferCSSPageSize: true })`, returns the bytes, and deletes
the file. The preload exposes one function, `tc4Desktop.printPdf`.

The route agrees with three open-source Electron applications (source read through the GitHub
API, 2026-09-24):

| Project | File @ commit (date) | Route |
|---|---|---|
| Joplin | `packages/app-desktop/InteropServiceHelper.ts` @ 6faefb8 (2026-06-07) | temporary HTML file, a separate window (hidden except on Linux), `printToPDF({ preferCSSPageSize: true, generateTaggedPDF: true })` |
| MarkText | `packages/desktop/src/main/menu/actions/file.ts` @ c1ff221 (2026-09-23) | the renderer asks over `ipcMain`; main calls `printToPDF` on the sender's window |
| Zettlr | `source/app/service-providers/commands/exporter/pdf-exporter.ts` @ 7e4e6c8 (2024-03-13) | temporary HTML file, `loadFile` in a `show: false` window, `printToPDF({ pageSize: 'A4' })` |

The bridge uses a temporary file, not a `data:` URL, because Chromium limits a `data:` URL to
2 MB and the print document of a long book can be larger.

## 2. The bridge in the packaged app

Date: 2026-09-24. Method: an APFS clone of `/Applications/translationCore4.app` (4.0.0-alpha.7,
installed 2026-09-18) with four parts replaced from the branch: `app/tc4-main.js` ←
`scripts/desktop-main.cjs`, `app/preload.js` ← `scripts/preload.cjs`, `app/tc4-bootstrap.cjs`
← `scripts/desktop-bootstrap.cjs`, `lib/clients/uw-tc4/build` ← `npm run build`. The alpha.7
server and resources were not changed. The app ran with a scratch `HOME` and
`--remote-debugging-port=9339`. Playwright connected over CDP to the app window
(`http://127.0.0.1:19120/clients/uw-tc4`) and called `window.tc4Desktop.printPdf` with print
documents from `printDocument` (`src/data/export/pdf.ts`). The Titus text is the rig's seeded
`sample_burrito` `ingredients/TIT.usfm`.

The renderer surface: `tc4Desktop.printPdf` is a function; `electronAPI` has one key,
`setCanClose`; the template's `window.api` is `undefined`.

| Document | Returned type | Bytes | Pages | MediaBox (pt) | Time |
|---|---|---|---|---|---|
| Titus, A4, 1 column, Single | Uint8Array | 40224 | 1 | 0 0 594.95996 841.91998 | 346 ms |
| Titus, A4, 1 column, Double | Uint8Array | 40986 | 2 | 0 0 594.95996 841.91998 | 228 ms |
| Titus, Letter, 2 columns, Single | Uint8Array | 40855 | 2 | 0 0 612 792 | 252 ms |
| Right-to-left sample, A4, 2 columns | Uint8Array | 49681 | 2 | 0 0 594.95996 841.91998 | 249 ms |

After the four prints, no `tc4-pdf-*` directory stayed in the temporary directory.

## 3. Right-to-left visual check

The right-to-left sample is a generated book: `\id GEN`, 3 chapters of 20 verses, each verse
the pointed Hebrew of Genesis 1:1, verse 5 of each chapter undrafted, `dir="rtl"`, 2 columns,
drop caps on. Page 1 of the packaged-app PDF is
[`pdf-rtl-sample-2026-09-24.png`](pdf-rtl-sample-2026-09-24.png).

Observed on page 1: the first column is at the right and the second at the left; each drop cap
is at the right of its chapter; the verse numbers stand at the right of their verses; the
vowel points sit on their letters; the undrafted verse states `[ verse not yet drafted ]`.
The end-to-end right-to-left journey is #29, not this record.

## 4. The journey

`npx playwright test e2e/j07-publish.spec.ts -g "PDF"` passed on the dev client
(`vite` :5199 from the branch) and the workspace rig (pankosmia-web 0.18.5). The journey
installs a test double of the bridge that prints with Playwright's `page.pdf()`. It got the
same counts as the packaged app: Titus A4 Single 1 page, Double 2 pages, Letter MediaBox
`0 0 612 792`.

## 5. Under the drafted-chapters rule (same date, later)

Rule (owner, 2026-09-24): the PDF and the preview show each chapter with at least one drafted
verse. A chapter with no drafted verse is left out. Inside a shown chapter, an undrafted verse
states `[ verse not yet drafted ]`. A book with no drafted verse refuses the export with
`export.nothing-drafted`. Code: `printedChapters` in `src/data/bookModel.js`.

Packaged app: the same method as section 2, with a new client build and new print documents.
"Drafted Titus" is the sample `TIT.usfm` with every undrafted verse given the text of 1:1.

| Document | Returned type | Bytes | Pages | MediaBox (pt) | Time |
|---|---|---|---|---|---|
| Seeded Titus, A4, 1 column, Single | Uint8Array | 39010 | 1 | 0 0 594.95996 841.91998 | 309 ms |
| Drafted Titus, A4, 1 column, Single | Uint8Array | 34392 | 2 | 0 0 594.95996 841.91998 | 241 ms |
| Drafted Titus, A4, 1 column, Double | Uint8Array | 36552 | 4 | 0 0 594.95996 841.91998 | 225 ms |
| Drafted Titus, Letter, 2 columns, Single | Uint8Array | 33875 | 3 | 0 0 612 792 | 217 ms |
| Right-to-left sample, A4, 2 columns | Uint8Array | 49681 | 2 | 0 0 594.95996 841.91998 | 242 ms |

No `tc4-pdf-*` directory stayed after the prints. The seeded Titus page is
[`pdf-seeded-titus-2026-09-24.png`](pdf-seeded-titus-2026-09-24.png): chapter 1 only, verses
1–5 drafted, verses 6–16 stated as not yet drafted; chapters 2 and 3 are not printed.

Journey: `npx playwright test e2e/j07-publish.spec.ts` passed 5 of 5, twice. The PDF blocks
found that the seeded Titus document holds 1 chapter and gives 1 page. The journey-made drafted
Titus holds 3 chapters and gives 2 pages at Single, more at Double, and MediaBox `0 0 612 792`
at Letter.

## Limits

- The download step in the packaged app (Electron's save dialog) was not driven. The kernel's
  `deliverFile` is unchanged by #20.
- The export-menu click was driven only on the dev client with the test double, not in the
  packaged app. The packaged app had an empty production store, so no book was open there.
- Fonts: the print document loads no web font. These PDFs used the fonts installed on this Mac
  (macOS, 2026-09-24). A machine with other fonts can get another page count.
- Only macOS arm64 was measured. Windows and Linux were not measured.
