// The `relationships` mirror (issue #359, BURRITO-SPEC §3 rule 6): the pins of
// `checking/resources.json` as Scripture Burrito relationships. The one
// implementation is journal/relationships.mjs, which the harness generator
// (conformance/generate.mjs) also calls; this module adds only its types.
import { relationshipsFromPins as relationshipsFromPinsRef } from '../../../journal/relationships.mjs';
import type { ResourcesFile } from '../burritoStore';

/** One Scripture Burrito relationship (the bundled `relationship.schema.json`). */
export interface Relationship {
  relationType: 'source' | 'parascriptural' | 'peripheral';
  flavor: string;
  id: string;
  revision?: string;
}

export const relationshipsFromPins = relationshipsFromPinsRef as (resources: ResourcesFile) => Relationship[];
