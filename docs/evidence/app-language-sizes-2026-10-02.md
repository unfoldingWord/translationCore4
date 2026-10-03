# App language catalog compression — 2026-10-02

[VERIFIED — executed source-byte compression experiment, 2026-10-02]
Method: Python 3 `zipfile.ZipFile`, ZIP DEFLATE, compression level 9. Each archive
member uses the original JSON bytes and its filename without parent directories.
Read tC3 release files with `git ls-tree -r --name-only <revision> src/locale`
and `git show <revision>:<path>`, selecting paths ending in `.json`. Include
English. Compress each file separately and then all files into one ZIP in memory.
Read tC4's English JSON from the checkout. No application was run or changed.

Source snapshots:

- tC3 3.7.0: `c16e207818a2b4869a06ab14fde9249484256361`, commit date 2026-01-08.
  [Release-source catalogs](https://github.com/unfoldingWord/translationCore/tree/c16e207818a2b4869a06ab14fde9249484256361/src/locale).
- tC4 4.0.0-rc.1: `e50e70147bb06e3991f5981a16c971888a6b2872`, commit date 2026-10-02.
  [English catalog](https://github.com/unfoldingWord/translationCore4/blob/e50e70147bb06e3991f5981a16c971888a6b2872/src/i18n/en.json).

| Measured payload | Original bytes | ZIP bytes |
| --- | ---: | ---: |
| All 25 tC3 catalog files, including English | 1,183,652 | 294,948 |
| tC4 English catalog | 54,536 | 14,609 |

Individual tC3 catalog ZIPs range from 9,833 to 13,751 bytes. Selected examples:

| Catalog | Original bytes | ZIP bytes |
| --- | ---: | ---: |
| Ukrainian | 47,674 | 12,818 |
| Russian | 48,977 | 12,801 |
| Brazilian Portuguese | 35,449 | 11,228 |
| Spanish | 35,967 | 11,259 |
| Indonesian | 33,979 | 10,593 |
| French | 36,542 | 11,167 |

Limits: these are JSON-only ZIP measurements. They exclude fonts, Scripture
resources, separate checking tools, provenance manifests, application code and
installer overhead. tC3 catalogs have incomplete translations, documented in
[the coverage audit](app-language-prior-art-2026-10-02.md); their compressed size
does not predict complete tC4 translations. Vite output and the desktop installer
can compress differently. No shipped installer was inspected.

[decided 2026-10-02 — owner follow-up] Localization languages are installed
locally. [PROPOSED] Ship every approved catalog in the local installation and
measure final compressed and installed catalog sizes at release. The language
picker requires no download or zip-import workflow.
