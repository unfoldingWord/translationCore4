# Graphite shaping in the packaged app — proof (2026-08-14)

Evidence record for the second acceptance item of issue
[#32](https://github.com/unfoldingWord/translationCore4/issues/32) and
decision D20. Machine: macOS arm64 (Darwin 25.5.0).

## Verdict

**POSITIVE.** The packaged app (Electronite v37.1.0-graphite, artifact built
by `scripts/package-desktop.zsh` from `5f5d5aa`-era main) shapes the
Graphite-only font Awami Nastaliq correctly. A plain-Chromium negative
control with the SAME font, server, text, and probe renders unshaped —
so the probe discriminates, and the shaped result is attributable to
Graphite. D20 is satisfied end to end.

## Why Awami Nastaliq is the right probe

Awami Nastaliq is Graphite-ONLY: it has no OpenType shaping tables. The
platform's own CSS says so (`lib/webfonts/pankosmia-Awami_Nastaliq.css`
line 4: `/* Graphite Required! */`). An engine without Graphite still loads
the font file, but renders isolated, unjoined letterforms. An engine with
Graphite renders joined, diagonally stacked Nastaliq. The same font
therefore produces dramatically different, measurable renderings — a true
discriminator, not a font-fallback difference.

## Method (reproducible)

1. Launch the production artifact through its Electronite binary with a
   fresh `HOME` plus `--remote-debugging-port` (probe access only; the app
   otherwise runs as shipped and self-spawns its server, port 19119).
2. Via CDP ([`tools/graphite-probe.js`](tools/graphite-probe.js),
   `puppeteer-core.connect`; its header comments carry the full launch
   procedure), inject into the served `/clients/uw-tc4` page (test-only,
   nothing committed to `src/`):
   - `<link rel="stylesheet" href="/api/webfonts/pankosmia-Awami_Nastaliq.css">`
     — the platform's own webfont route (`launch.rs:306`).
   - A probe block: the Urdu text `نستعلیق تحریر خوش آمدید` at 48px in
     `'Pankosmia-Awami Nastaliq'`, and the same text in Arial beneath it.
   - Wait for `document.fonts.load(...)`; assert
     `document.fonts.check("48px 'Pankosmia-Awami Nastaliq'")` is true.
   - Measure `canvas 2d measureText` width and actual bounding-box
     ascent/descent; screenshot the probe block.
3. Negative control (diagnostic rule 2): navigate a plain Chromium
   (Playwright Chromium 151, no Graphite) to the SAME running server page
   and run the IDENTICAL probe.

## Measurements (same text, same font file, same server, 48px)

| Engine | fontLoaded | Awami width (px) | Awami ascent/descent (px) | Rendering |
|---|---|---|---|---|
| Packaged Electronite (Chrome/138.0.7204.35, Electron/37.1.0-graphite) | true | **390.06** | **86.34 / 16.34** | Joined, diagonally stacked Nastaliq (screenshot 1) |
| Plain Chromium 151 (Playwright, no Graphite) | true | **770.32** | 58.38 / 25.99 | Isolated, unjoined letterforms (screenshot 2) |
| Arial reference (both engines, identical) | — | 411.75 | 39.68 / 4.36 | baseline sanity check |

Discrimination: the same string in the same font is ~2× wider unshaped
(770 vs 390 px) and loses the tall stacking ascent (58 vs 86 px). The Arial
row is byte-identical across engines, confirming the probe itself is stable
and only the Awami shaping differs.

## Screenshots

1. `graphite-awami-electronite-2026-08-14.png` — packaged app: top line is
   fully joined Nastaliq with deep diagonal stacks; bottom line is the Arial
   reference.
2. `graphite-awami-chromium-negative-2026-08-14.png` — plain Chromium: the
   SAME Awami-styled line renders as disconnected isolated glyphs
   (ن س ت ع ل ی ق …); Arial reference identical to screenshot 1.

## Scope notes

- The probe was injected via CDP into the running page; no probe code ships
  in the client or the artifact.
- `fontLoaded: true` in BOTH engines rules out "font failed to load" as the
  explanation for the difference.
- This proves shaping in the packaged macOS arm64 artifact. Other OS
  artifacts (#44) inherit the same Electronite releases but are unmeasured.
