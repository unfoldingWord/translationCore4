// i18n scaffold (checklist C1a.8; TEST-PLAN "no hardcoded EN literals in views").
// Increment 1 ships the English catalog only. The lookup shape is flat keys so a
// later switch to platform i18n (/api/i18n, pankosmia i18nContext) is a resolver
// swap, not a call-site rewrite.
import en from './en.json';

const catalogs = { en };
let current = 'en';

export function setLocale(locale) {
  if (catalogs[locale]) current = locale;
}

// Missing keys are not silent (issue #12): the resolver warns once per key, so a
// checking session's console shows every gap and a journey test can assert none.
// The fallback stays the key itself — the UI degrades, it does not crash.
const warned = new Set();

export function t(key, vars, fallback) {
  let s = catalogs[current][key] ?? catalogs.en[key];
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
