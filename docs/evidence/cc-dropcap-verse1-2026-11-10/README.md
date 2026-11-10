# Verse 1 beside a drop cap (#992), 2026-11-10

The Community Checking preview of the sample Titus (chapter 1, verses 1 to 5 drafted) and the
print page the PDF prints, captured headless by Playwright from `tc4 serve` built at this
branch, with the same steps as `parity/app/journeys/community-checking.test.mjs`.

| File | Page setup | What it shows |
|---|---|---|
| `1-preview-drop-cap.png` | default: drop-cap chapters on, verse numbers on | the drop cap 1, then "Pablo…" with no verse number; verses 2 to 5 and the undrafted 6 to 16 keep theirs |
| `2-pdf-print-page.png` | default | the PDF's print page (`/print/{job}`) as the shell prints it: the same numbers as the preview |
| `3-preview-heading.png` | drop-cap chapters off | "Chapter 1", then verse 1 with its number |
| `4-preview-numbers-off.png` | drop caps on, verse numbers off | no drafted verse has a number; the undrafted verses keep theirs; verse 1 has none |
