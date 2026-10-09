// The language registry, without the catalogs, so a Node test (the Playwright journey)
// can import it without a JSON loader (#622).
/** The installed catalogs, in picker order, each with its own native name
 * [decided 2026-10-02 — owner interview, #522; #622]. The picker offers exactly these. */
export const LOCALES = Object.freeze([
  { id: 'en', label: 'English' },
  { id: 'es-419', label: 'Español (Latinoamérica)' },
  { id: 'fr', label: 'Français' },
  { id: 'hi', label: 'हिन्दी' },
  { id: 'pt-BR', label: 'Português (Brasil)' },
  { id: 'id', label: 'Bahasa Indonesia' },
  { id: 'uk', label: 'Українська' },
  { id: 'ru', label: 'Русский' },
  { id: 'vi', label: 'Tiếng Việt' },
]);
