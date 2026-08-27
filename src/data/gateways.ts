// gateways.ts — the gateway languages a project can check against.
//
// WHY THIS LIST EXISTS AS CONFIG. pankosmia-web offers only per-org repo
// listing (`GET /gitea/remote-repos/<server>/<org>`) and per-user listing —
// there is no catalog-wide search endpoint [VERIFIED — pankosmia-web 0.18.5
// (99fd9be), `endpoints/gitea2/`: 6 routes, none of them a catalog]. So the app
// must know WHICH org to ask. This file is that "which org" config, and nothing
// more: every version, book list, and flavor the user sees is fetched live from
// the platform at open time — never read from here.
//
// PROVENANCE [VERIFIED 2026-08-03 — DCS catalog API, stage=prod]: each entry is
// a language+owner that publishes a COMPLETE checkable suite, i.e. released
// Translation Notes AND Translation Words AND Translation Academy under the
// same owner. That intersection returned 19 suites; the tag shown is the
// release current at that query and is recorded for freshness only.
// Regenerate with:
//   GET /api/v1/catalog/search?subject=TSV%20Translation%20Notes&stage=prod
//   (repeat for "Translation Words" and "Translation Academy"; intersect on
//    (language, owner))

export interface Gateway {
  /** BCP 47 language tag, as DCS reports it. */
  id: string;
  /** DCS organization that publishes this suite. */
  org: string;
  /** English name, for the secondary label. */
  name: string;
  /** The language's own name, shown first (rendered in `dir`). */
  autonym: string;
  dir: 'ltr' | 'rtl';
  /** Release tags current at the 2026-08-03 catalog query — a freshness note,
   * NOT a pin. Real pins come from the live catalog when the user downloads. */
  seen: { tn: string; tw: string; ta: string };
  /** Whether the owner also publishes a standalone TWL repo. Informational:
   * under D34 tC4 fetches `<lang>_tw`, whose export carries the links anyway. */
  hasTwl: boolean;
  /** Whether the owner publishes an aligned Bible (literal/simplified text). */
  hasBible: boolean;
  /** Whether the owner publishes a `<lang>_tq` questions repo (§5.3 1.10
   * optional slot, D64). [VERIFIED 2026-08-27 — DCS org repo lists + direct
   * repo probes per org.] */
  hasTq: boolean;
  /** Whether the owner publishes a simplified text repo — `en_ust` for
   * unfoldingWord, `<lang>_gst` elsewhere (same evidence run). */
  hasSimplified: boolean;
}

export const GATEWAYS: Gateway[] = [
  { id: 'en', org: 'unfoldingWord', name: 'English', autonym: 'English', dir: 'ltr', seen: { tn: 'v89', tw: 'v89', ta: 'v89' }, hasTwl: true, hasBible: true, hasTq: true, hasSimplified: true },
  { id: 'es-419', org: 'es-419_gl', name: 'Spanish (Latin American)', autonym: 'Español (Latinoamérica)', dir: 'ltr', seen: { tn: 'v66', tw: 'v37', ta: 'v4' }, hasTwl: true, hasBible: true, hasTq: true, hasSimplified: true },
  { id: 'fr', org: 'Xenizo', name: 'French', autonym: 'Français', dir: 'ltr', seen: { tn: 'v2.0', tw: 'v2.0', ta: 'v2.0' }, hasTwl: true, hasBible: false, hasTq: true, hasSimplified: false },
  { id: 'fr', org: 'MVHS', name: 'French', autonym: 'Français', dir: 'ltr', seen: { tn: 'v0.0.2', tw: 'v0.0.1', ta: 'v0.0.2' }, hasTwl: true, hasBible: true, hasTq: true, hasSimplified: true },
  { id: 'ru', org: 'ru_gl', name: 'Russian', autonym: 'Русский', dir: 'ltr', seen: { tn: 'v60.1', tw: 'v14.2', ta: 'v13.3' }, hasTwl: true, hasBible: true, hasTq: true, hasSimplified: false },
  { id: 'fa', org: 'fa_gl', name: 'Persian', autonym: 'فارسی', dir: 'rtl', seen: { tn: 'v9', tw: 'v9', ta: 'v7.8' }, hasTwl: true, hasBible: true, hasTq: true, hasSimplified: true },
  { id: 'ar', org: 'BSOJ', name: 'Arabic', autonym: 'العربية', dir: 'rtl', seen: { tn: 'v6.1', tw: 'v5', ta: 'v3' }, hasTwl: true, hasBible: true, hasTq: true, hasSimplified: true },
  { id: 'ar', org: 'ar_gt', name: 'Arabic', autonym: 'العربية', dir: 'rtl', seen: { tn: 'v3.2', tw: 'v3', ta: 'v3.3' }, hasTwl: false, hasBible: true, hasTq: false, hasSimplified: true },
  { id: 'id', org: 'bahtraku', name: 'Indonesian', autonym: 'Bahasa Indonesia', dir: 'ltr', seen: { tn: 'v25', tw: 'v26', ta: 'v30' }, hasTwl: true, hasBible: true, hasTq: true, hasSimplified: true },
  { id: 'hi', org: 'translationCore-Create-BCS', name: 'Hindi', autonym: 'हिन्दी', dir: 'ltr', seen: { tn: 'v9', tw: 'v8', ta: 'v7' }, hasTwl: true, hasBible: true, hasTq: true, hasSimplified: true },
  { id: 'bn', org: 'translationCore-Create-BCS', name: 'Bengali', autonym: 'বাংলা', dir: 'ltr', seen: { tn: 'v6', tw: 'v4', ta: 'v5.0' }, hasTwl: true, hasBible: true, hasTq: true, hasSimplified: true },
  { id: 'gu', org: 'translationCore-Create-BCS', name: 'Gujarati', autonym: 'ગુજરાતી', dir: 'ltr', seen: { tn: 'v6', tw: 'v4', ta: 'v4' }, hasTwl: true, hasBible: true, hasTq: true, hasSimplified: true },
  { id: 'kn', org: 'translationCore-Create-BCS', name: 'Kannada', autonym: 'ಕನ್ನಡ', dir: 'ltr', seen: { tn: 'v6', tw: 'v4', ta: 'v4' }, hasTwl: true, hasBible: true, hasTq: true, hasSimplified: true },
  { id: 'mr', org: 'translationCore-Create-BCS', name: 'Marathi', autonym: 'मराठी', dir: 'ltr', seen: { tn: 'v6', tw: 'v4', ta: 'v4' }, hasTwl: true, hasBible: true, hasTq: true, hasSimplified: true },
  { id: 'ne', org: 'translationCore-Create-BCS', name: 'Nepali', autonym: 'नेपाली', dir: 'ltr', seen: { tn: 'v7', tw: 'v5', ta: 'v5' }, hasTwl: true, hasBible: true, hasTq: true, hasSimplified: true },
  { id: 'or', org: 'translationCore-Create-BCS', name: 'Odia', autonym: 'ଓଡ଼ିଆ', dir: 'ltr', seen: { tn: 'v5', tw: 'v4', ta: 'v4' }, hasTwl: true, hasBible: true, hasTq: true, hasSimplified: true },
  { id: 'te', org: 'translationCore-Create-BCS', name: 'Telugu', autonym: 'తెలుగు', dir: 'ltr', seen: { tn: 'v6', tw: 'v4', ta: 'v4' }, hasTwl: true, hasBible: true, hasTq: true, hasSimplified: true },
  { id: 'ml', org: 'Door43-Catalog', name: 'Malayalam', autonym: 'മലയാളം', dir: 'ltr', seen: { tn: 'v14.2', tw: 'v8.2', ta: 'v10.3' }, hasTwl: false, hasBible: true, hasTq: true, hasSimplified: false },
  { id: 'ur-deva', org: 'Door43-Catalog', name: 'Urdu (Devanagari)', autonym: 'اردو', dir: 'rtl', seen: { tn: 'v14.1', tw: 'v8.3', ta: 'v10.1' }, hasTwl: false, hasBible: true, hasTq: true, hasSimplified: false },
];

/** The DCS host every gateway above is served from. The platform takes the
 * host as a path segment, so it stays data, not a hardcoded literal. */
export const DCS_HOST = 'git.door43.org';

/** A stable key for one gateway: language + owner (the same owner intersection
 * the catalog query used). Two owners may publish the same language. */
export const gatewayKey = (g: Gateway): string => `${g.id}::${g.org}`;

export const findGateway = (key: string): Gateway | undefined =>
  GATEWAYS.find((g) => gatewayKey(g) === key);

/** English is the suite that ships with the install — the fallback rung's
 * language (D30.2). Kept as a lookup so no view hardcodes 'en'. */
export const INSTALLED_GATEWAY = GATEWAYS.find((g) => g.id === 'en') as Gateway;

/** Which configured gateway org publishes a repo of this name?
 *
 * A helps repo is named `<languageId>_<suffix>` (`es-419_tn`), and a gateway
 * entry is (languageId, org) — so the repo name names the LANGUAGE, and the
 * org is what has to be resolved. Returns the org only when exactly one
 * configured gateway claims that language; `fr_tn` is published by both Xenizo
 * and MVHS, so it stays ambiguous and the caller must use other evidence.
 *
 * This exists because a DCS export's own metadata records the org name at
 * export time, which an org rename makes stale (PLATFORM-NOTES #30: es-419's exports
 * still say `Idiomas-Puentes`, an org that 404s today). The configured org is
 * the address the app pins by, so it wins where it is unambiguous. */
export const orgForRepoName = (repoName: string): string | null => {
  const match = repoName.match(/^(.+)_(tn|tw|twl|ta)$/);
  if (!match) return null;
  const orgs = [...new Set(GATEWAYS.filter((g) => g.id === match[1]).map((g) => g.org))];
  return orgs.length === 1 ? orgs[0] : null;
};
