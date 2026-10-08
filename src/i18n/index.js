// i18n (checklist C1a.8; TEST-PLAN "no hardcoded EN literals in views").
// The lookup shape is flat keys with literal dotted IDs and `{name}` placeholders,
// so a later switch to platform i18n (/api/i18n, pankosmia i18nContext) is a
// resolver swap, not a call-site rewrite.
//
// #522: four catalogs ship with the app, and the active one is a small external
// store. `setLocale` notifies its listeners, and `useLocale` subscribes a React
// tree to it, so a preview and a rollback refresh every visible string without
// a reload, a remount or a locale-based key. `t(key, vars, fallback)` stays for
// every caller, React or not.
import { useSyncExternalStore } from 'react';
import en from './en.json';
import es419 from './es-419.json';
import fr from './fr.json';
import hi from './hi.json';

/** The installed catalogs, in picker order, each with its own native name
 * [decided 2026-10-02 — owner interview, #522]. The picker offers exactly these. */
export const LOCALES = Object.freeze([
  { id: 'en', label: 'English' },
  { id: 'es-419', label: 'Español (Latinoamérica)' },
  { id: 'fr', label: 'Français' },
  { id: 'hi', label: 'हिन्दी' },
]);
export const DEFAULT_LOCALE = 'en';

const catalogs = { en, 'es-419': es419, fr, hi };
let current = DEFAULT_LOCALE;
const listeners = new Set();
// The document's lang is the displayed locale from the first paint (index.html
// says `en` too, for a page that never loads this module).
if (typeof document !== 'undefined') document.documentElement.lang = current;

/** True for an id the app can show. A saved value that is not one of these is
 * treated as absent (English). */
export const isLocale = (id) => typeof id === 'string' && Object.prototype.hasOwnProperty.call(catalogs, id);

export function getLocale() {
  return current;
}

/** Make `locale` the active catalog and tell every subscriber. An unknown id
 * changes nothing. The document's `lang` follows, so the browser picks a face
 * for the script (Devanagari has no bundled face: --font-ui falls back to the
 * system's). */
export function setLocale(locale) {
  if (!isLocale(locale) || locale === current) return;
  current = locale;
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
  for (const fn of listeners) fn(locale);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The active locale, as React state: the component renders again on each change. */
export function useLocale() {
  return useSyncExternalStore(subscribe, getLocale, getLocale);
}

// Missing keys are not silent (issue #12): the resolver warns once per key, so a
// checking session's console shows every gap and a journey test can assert none.
// The fallback stays the key itself — the UI degrades, it does not crash.
const warned = new Set();

export function t(key, vars, fallback) {
  // #522: a target entry that is missing or not a string falls back to English
  // per key; the missing-key diagnostic below is for English too.
  const own = catalogs[current][key];
  let s = typeof own === 'string' && own !== '' ? own : catalogs.en[key];
  if (s === undefined) {
    // Round 37: dynamic keys (a project's own source-pane ids) may have no
    // catalog entry — an explicit fallback renders instead of the raw key.
    if (fallback !== undefined) return fallback;
    if (!warned.has(key)) {
      warned.add(key);
      console.warn(`[i18n] missing key: ${key}`);
    }
    s = key;
  }
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  }
  return s;
}

/** Test seam (#522): the catalog objects, so a test can remove one target entry
 * and prove the English fallback. Not for the app. */
export const _catalogs = catalogs;
