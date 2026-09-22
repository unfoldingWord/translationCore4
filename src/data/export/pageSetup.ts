/**
 * Page setup is presentation input shared by the preview and export layers.
 * Keep choices semantic so a print renderer can resolve them for its own
 * typography instead of receiving screen CSS values.
 */
export type PageSpacing = 'single' | 'double';

export type PageSetup = Readonly<{
  columns: 1 | 2;
  dropCapChapters: boolean;
  verseNumbers: boolean;
  spacing: PageSpacing;
}>;

export const DEFAULT_PAGE_SETUP = Object.freeze({
  columns: 1,
  dropCapChapters: true,
  verseNumbers: true,
  spacing: 'single',
}) satisfies PageSetup;

/** Export renderers use this semantic multiplier with their own typography. */
export const PAGE_SPACING_FACTOR: Readonly<Record<PageSpacing, 1 | 2>> = Object.freeze({
  single: 1,
  double: 2,
});
