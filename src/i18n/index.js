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

export function t(key, vars) {
  let s = catalogs[current][key] ?? catalogs.en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  }
  return s;
}
