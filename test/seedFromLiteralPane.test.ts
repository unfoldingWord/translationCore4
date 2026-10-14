// #704 (/ra finding): a book added to a project seeds from the gateway's LITERAL
// Bible (#574), read by its pane id. After a gateway change that replaces only
// the literal pane, the saved order is `[ust, glt]` (BSOJ publishes no
// simplified Bible), so the first pane is the English UST, not the literal one.
import { describe, expect, it } from 'vitest';
import { __seedInitialUsfmForTests as seedInitialUsfm } from '../src/state.jsx';
import { INSTALLED_SUITE } from '../src/data/installedSuite';

const EN_UST = INSTALLED_SUITE.extraScripture[1];
// BSOJ's Arabic Van Dyck Bible at the release cached for the rig (its export's metadata.json).
const AR_AVD = { id: 'glt', repoPath: 'git.door43.org/BSOJ/ar_avd', version: 'v6.9', sha: '3ba2e7f1d2fb3c5b9c9682dcc20d09b6f3770c06', flavor: 'scripture/textTranslation' };

describe('#704: Add a book seeds from the literal pane, whatever the saved order', () => {
  it('a BSOJ project ([ust, glt]) seeds from ar_avd, not from the English UST', async () => {
    const read: string[] = [];
    const store = {
      readResources: async () => ({ extraScripture: [EN_UST, AR_AVD] }),
      readSourceBook: async (repo: string) => {
        read.push(repo);
        throw Object.assign(new Error('not found'), { isNotFound: true });
      },
    };
    await seedInitialUsfm({ store, code: 'PHM', projName: 'p' });
    expect(read).toHaveLength(1);
    expect(read[0].toLowerCase()).toContain('ar_avd');
  });
});
