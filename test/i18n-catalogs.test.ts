// #522 — the four installed UI catalogs, and the per-key English fallback.
//
// Ways this can fail, written before the code (AGENTS.md "How to test" 3):
//   1. a target catalog lacks a key that English has           → the app shows English for it, silently
//   2. a target catalog has a key that English does not        → dead text that no screen can show
//   3. a target entry is empty, or not a string                 → a blank label
//   4. a target entry drops, adds or renames a {placeholder}   → "{n}" on screen, or a number lost
//   5. a target entry copies the English sentence               → "translated" by name only
//   6. the registry and the catalogs disagree                   → a picker row with no catalog
//   7. a saved locale that is not installed is accepted         → a blank app
//   8. t() for a missing target entry does not fall back       → the raw key shows in that language
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, LOCALES, _catalogs, getLocale, isLocale, setLocale, t } from '../src/i18n/index.js';

const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');

const DIR = path.resolve(process.cwd(), 'src', 'i18n');
const read = (file: string): Record<string, unknown> => JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
const en = read('en.json') as Record<string, string>;
const TARGETS = ['es-419', 'fr', 'hi'] as const;
const targets = Object.fromEntries(TARGETS.map((id) => [id, read(`${id}.json`)])) as Record<(typeof TARGETS)[number], Record<string, unknown>>;

const placeholders = (s: string): string[] => [...s.matchAll(/\{[A-Za-z0-9_]+\}/g)].map((m) => m[0]).sort();

/** English entries a target may legitimately equal: product names, codes, symbols,
 * numbers, and a single word (a cognate such as "Format" or "Section", with its
 * placeholders). A sentence of two or more words is not on this list. */
const SHARED = (value: string): boolean => {
  const words = value.replace(/\{[A-Za-z0-9_]+\}/g, ' ').match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.length <= 1
    || /^(translationCore ?4?|Scripture Burrito( \(\.zip\))?|Open Bible Stories|unfoldingWord (Literal|Simplified) Text)$/.test(value.trim());
};

describe('#522 — the installed UI catalogs', () => {
  afterEach(() => setLocale(DEFAULT_LOCALE));

  it('the registry names exactly the four decided locales, each with a catalog', () => {
    expect(LOCALES.map((l) => l.id)).toEqual(['en', 'es-419', 'fr', 'hi']);
    expect(LOCALES.map((l) => l.label)).toEqual(['English', 'Español (Latinoamérica)', 'Français', 'हिन्दी']);
    for (const { id } of LOCALES) expect(isLocale(id), id).toBe(true);
    expect(Object.keys(_catalogs).sort()).toEqual([...LOCALES.map((l) => l.id)].sort());
  });

  for (const id of TARGETS) {
    describe(id, () => {
      const target = targets[id];
      it('covers every English key, and no other', () => {
        const enKeys = Object.keys(en);
        const missing = enKeys.filter((k) => !(k in target));
        const extra = Object.keys(target).filter((k) => !(k in en));
        expect(missing, `${id} lacks: ${missing.join(', ')}`).toEqual([]);
        expect(extra, `${id} has keys English lacks: ${extra.join(', ')}`).toEqual([]);
      });
      it('every entry is a nonempty string', () => {
        const bad = Object.entries(target).filter(([, v]) => typeof v !== 'string' || v.trim() === '');
        expect(bad.map(([k]) => k), `${id} empty or non-string`).toEqual([]);
      });
      it('every entry keeps the placeholders of its English source, by name and count', () => {
        const bad = Object.keys(en).filter((k) => typeof target[k] === 'string' && placeholders(target[k] as string).join() !== placeholders(en[k]).join());
        expect(bad, `${id} placeholder mismatch in: ${bad.join(', ')}`).toEqual([]);
      });
      it('does not pass an English sentence off as translated', () => {
        const copied = Object.keys(en).filter((k) => target[k] === en[k] && !SHARED(en[k]));
        expect(copied, `${id} equals English in: ${copied.join(', ')}`).toEqual([]);
      });
    });
  }

  it('a locale id that is not installed is refused, and the active locale stays', () => {
    setLocale('es-419');
    for (const bad of ['es', 'de', '', null, undefined, 42, 'EN', 'hi-IN', '__proto__', 'toString']) {
      setLocale(bad as string);
      expect(getLocale(), String(bad)).toBe('es-419');
      expect(isLocale(bad as string), String(bad)).toBe(false);
    }
  });

  it('t() reads the active catalog, and a selection shows at once', () => {
    expect(t('account.language')).toBe(en['account.language']);
    setLocale('fr');
    expect(t('account.language')).toBe(targets.fr['account.language']);
    expect(t('account.language')).not.toBe(en['account.language']);
    setLocale('hi');
    expect(t('account.language')).toBe(targets.hi['account.language']);
  });

  it('t() falls back to English per key when a target entry is absent or empty (a controlled gap)', () => {
    const live = _catalogs['es-419'] as Record<string, string>;
    const key = 'common.close';
    const kept = live[key];
    try {
      setLocale('es-419');
      delete live[key];
      expect(t(key)).toBe(en[key]);
      live[key] = '';
      expect(t(key)).toBe(en[key]);
      // Another key is still Spanish: the fallback is per key, not per catalog.
      expect(t('account.language')).toBe(targets['es-419']['account.language']);
    } finally {
      live[key] = kept;
    }
  });
});
