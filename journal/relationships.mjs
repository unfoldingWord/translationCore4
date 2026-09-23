// The `relationships` mirror (BURRITO-SPEC §3 rule 6, §5.3 stage rule S-1; issue #359):
// the pins of `checking/resources.json` expressed as Scripture Burrito relationships.
// `resources.json` stays authoritative; the mirror is DERIVED, here and only here. The
// Scripture Burrito export (src/data/export/burritoZip.ts) and the harness generator
// (conformance/generate.mjs) both call this function.
//
// One row per distinct repository, first occurrence wins, in this order: the original
// languages, the extra scripture, the primary set, the fallback set, then every other
// `resources` group (the lexicons). A row is
//   { relationType, flavor, id: 'dcs::<owner>/<repo>', revision: <pin version> }
// with `revision` absent when the pin has no version label (a sha-only pin, D58). The
// relationType comes from the pin flavor's type: `scripture` → `source`, `parascriptural`
// and `peripheral` unchanged. A pin of any other type (`gloss/textStories`, the OBS
// source text) has no relationship the bundled schema accepts — `source` allows only
// textTranslation and audioTranslation — so it has no row.
//
// This module is a LEAF (no imports), like grammar.mjs.

const RELATION_TYPE = { scripture: 'source', parascriptural: 'parascriptural', peripheral: 'peripheral' };

const isPin = (v) => v != null && typeof v === 'object' && typeof v.repoPath === 'string' && typeof v.flavor === 'string';

/** `resources.json` (§5.3 schemaVersion 2) → the `relationships` array. */
export function relationshipsFromPins(resources) {
  const { originalLanguage, ...otherGroups } = resources?.resources ?? {};
  const pins = [
    ...Object.values(originalLanguage ?? {}),
    ...(resources?.extraScripture ?? []),
    ...['primary', 'fallback'].flatMap((rung) => Object.values(resources?.languageSets?.[rung] ?? {})),
    ...Object.values(otherGroups).flatMap((group) => Object.values(group ?? {})),
  ].filter(isPin);
  const rows = [];
  const seen = new Set();
  for (const pin of pins) {
    const [type, flavor] = pin.flavor.split('/');
    const relationType = RELATION_TYPE[type];
    const id = `dcs::${pin.repoPath.split('/').slice(1).join('/')}`;
    if (!relationType || !flavor || seen.has(id)) continue;
    seen.add(id);
    rows.push({ relationType, flavor, id, ...(pin.version ? { revision: pin.version } : {}) });
  }
  return rows;
}
