/**
 * Page setup is presentation input shared by the preview and export layers.
 * Keep choices semantic so a print renderer can resolve them for its own
 * typography instead of receiving screen CSS values.
 */
export type PageSpacing = 'single' | 'double';
/** A4 is 595 × 842 pt, US Letter 612 × 792 pt; the print renderer owns the dimensions. */
export type PaperSize = 'a4' | 'letter';
/** An OBS picture sits above its frame text or the text wraps it (#11 builds the row). */
export type ObsLayout = 'above' | 'wrapped';

export type PageSetup = Readonly<{
  columns: 1 | 2;
  dropCapChapters: boolean;
  verseNumbers: boolean;
  spacing: PageSpacing;
  paper: PaperSize;
  pictures: boolean;
  obsLayout: ObsLayout;
}>;

export const DEFAULT_PAGE_SETUP = Object.freeze({
  columns: 1,
  dropCapChapters: true,
  verseNumbers: true,
  spacing: 'single',
  paper: 'a4',
  pictures: true,
  obsLayout: 'above',
}) satisfies PageSetup;

/** Export renderers use this semantic multiplier with their own typography. */
export const PAGE_SPACING_FACTOR: Readonly<Record<PageSpacing, 1 | 2>> = Object.freeze({
  single: 1,
  double: 2,
});
