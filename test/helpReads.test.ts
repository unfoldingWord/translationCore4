// Round 31 (2026-08-28 adversarial review): only a true NOT-FOUND means "the
// installed resource has nothing for this book". A transport, server, or
// parse failure must reach settleHelp's stated, retryable error state — the
// old blanket catch told the translator the content was ABSENT (D30
// violation) and stranded the tab with no retry.
import { describe, expect, it } from 'vitest';
import { __helpReadsForTests } from '../src/state.jsx';

const { readTextIngredient, loadSimplifiedHelp } = __helpReadsForTests;

const notFound = () => Object.assign(new Error('404'), { isNotFound: true });

describe('round 31 — readTextIngredient (the tN/tQ/twl TSV read)', () => {
  it('a NOT-FOUND reads as null (the missing state)', async () => {
    const api = { readIngredient: async () => { throw notFound(); } };
    expect(await readTextIngredient(api, 'repo', 'TIT.tsv')).toBeNull();
  });

  it('a transport failure PROPAGATES — never a false absence claim', async () => {
    const api = { readIngredient: async () => { throw new Error('socket hang up'); } };
    await expect(readTextIngredient(api, 'repo', 'TIT.tsv')).rejects.toThrow(/socket hang up/);
  });
});

describe('round 31 — loadSimplifiedHelp (the UST/GST read)', () => {
  const PIN = { repoPath: 'git.door43.org/unfoldingWord/en_ust', sha: 'a'.repeat(40), flavor: 'scripture/textTranslation' };
  const args = (readSourceBook: () => Promise<never>) => ({
    store: { readSourceBook },
    st: { projectPins: { languageSets: {} }, netEnabled: true },
    book: 'TIT',
    coverage: {},
    installed: { '_local_/_sideloaded_/unfoldingword--en_ust': PIN },
    sets: { primary: { simplifiedText: PIN } },
  });

  it('an absent book reads as missing', async () => {
    const slot = await loadSimplifiedHelp(args(async () => { throw notFound(); }) as never);
    expect(slot.state).toBe('missing');
  });

  it('a transport failure PROPAGATES to the stated error state', async () => {
    await expect(
      loadSimplifiedHelp(args(async () => { throw new Error('gateway timeout'); }) as never),
    ).rejects.toThrow(/gateway timeout/);
  });
});
