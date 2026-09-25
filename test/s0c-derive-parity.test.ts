// S-0c (C0.4, TEST-PLAN §2.3) — the scope-range and span-key rules of
// src/data/derive.ts, on the inputs of sample-burrito-validation/validate.mjs
// section 7. They use no fixture, so they run in every checkout.
import { describe, expect, it } from 'vitest';
import { deriveTwlItems, mergeKey, refInScope } from '../src/data/derive';

describe('S-0c — derive scope and span-key rules (harness section 7 inputs)', () => {
  it('refInScope: harness range fixtures + negative controls', () => {
    expect(refInScope(['1:1-2:5'], 2, 5)).toBe(true);
    expect(refInScope(['1:1-2:5'], 2, 6)).toBe(false);
    expect(refInScope(['3'], 3, 15)).toBe(true);
    expect(refInScope(['3'], 2, 1)).toBe(false);
  });

  it('span discipline: a "9-10" verse reference is never Number()-coerced in items or keys (§5.2)', () => {
    const spanTwl = [
      'Reference\tID\tTags\tOrigWords\tOccurrence\tTWLink',
      '2:9-10\ts1p2\tkeyterm\tיְהוָה\t1\trc://*/tw/dict/bible/kt/yahweh',
    ].join('\n');
    const [item] = deriveTwlItems(spanTwl, 'jon');
    expect(item.contextId.reference.verse).toBe('9-10');
    const key = mergeKey(item.contextId);
    expect(key).toContain('|9-10|');
    expect(key).not.toContain('NaN');
  });
});
