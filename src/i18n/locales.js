// The language registry, without the catalogs, so a Node test (the Playwright journey)
// can import it without a JSON loader (#622).
/** The installed catalogs, in picker order, each with its own native name and the
 * direction its interface reads in (#657)
 * [decided 2026-10-02 — owner interview, #522; #622; Arabic: #649]. The picker offers exactly these. */
export const LOCALES = Object.freeze([
  { id: 'en', label: 'English', dir: 'ltr' },
  { id: 'es-419', label: 'Español (Latinoamérica)', dir: 'ltr' },
  { id: 'fr', label: 'Français', dir: 'ltr' },
  { id: 'hi', label: 'हिन्दी', dir: 'ltr' },
  { id: 'pt-BR', label: 'Português (Brasil)', dir: 'ltr' },
  { id: 'id', label: 'Bahasa Indonesia', dir: 'ltr' },
  { id: 'uk', label: 'Українська', dir: 'ltr' },
  { id: 'ru', label: 'Русский', dir: 'ltr' },
  { id: 'vi', label: 'Tiếng Việt', dir: 'ltr' },
  { id: 'ar', label: 'العربية', dir: 'rtl' },
]);
