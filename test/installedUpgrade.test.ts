// #528 failure inventory: arbitrary first revision becomes a new-project
// default; suffix becomes the repo name; existing exact pins change identity.
import { expect, test } from 'vitest';
import { gatewayBiblesFromInstalled, languageSetFromInstalled, installedPathFor, discoverOnDisk } from '../src/data/installed';
import { INSTALLED_SUITE } from '../src/data/installedSuite';
import oldNotes from './fixtures/resources/en_tn@v86/metadata.json';
import oldBible from './fixtures/resources/en_ult@v89/metadata.json';
import type { InstalledMap } from '../src/data/installed';
import type { ResourcePin } from '../src/data/burritoStore';

const notes = INSTALLED_SUITE.languageSets.fallback.translationNotes;
const bible = INSTALLED_SUITE.extraScripture[0];
const oldTn: ResourcePin = { ...notes, version: 'v86', sha: Object.values(oldNotes.identification.primary.dcs)[0].revision };
const oldUlt: ResourcePin = { ...bible, version: 'v89', sha: Object.values(oldBible.identification.primary.dcs)[0].revision };
for (const reversed of [false, true]) {
  test(`bundled defaults and exact old pins survive ${reversed ? 'new' : 'old'}-first ordering`, () => {
    const pins = [oldTn, oldUlt, ...Object.values(INSTALLED_SUITE.languageSets.fallback).filter((p) => 'repoPath' in p), ...INSTALLED_SUITE.extraScripture];
    const entries = pins.map((p) => [`_local_/_sideloaded_/${p.repoPath.split('/').slice(-2).join('--').toLowerCase()}--${p.sha}`, p] as const);
    const installed: InstalledMap = Object.fromEntries(reversed ? entries.reverse() : entries);
    const gateway = { id: 'en', org: 'unfoldingWord' };
    expect(languageSetFromInstalled(installed, gateway)?.translationNotes.sha).toBe(notes.sha);
    expect(gatewayBiblesFromInstalled(installed, gateway).literal?.sha).toBe(bible.sha);
    expect(installedPathFor(installed, oldTn)).toContain(oldTn.sha);
    expect(installedPathFor(installed, oldUlt)).toContain(oldUlt.sha);
  });
}

test('metadata discovery identifies an unrecorded full-SHA resource folder', async () => {
  const local = `_local_/_sideloaded_/unfoldingword--en_tn--${oldTn.sha}`;
  const found = await discoverOnDisk({ getMetadataRaw: async () => oldNotes } as never, { [local]: {} } as never, {});
  expect(found[local].repoPath.toLowerCase()).toBe(oldTn.repoPath.toLowerCase());
  expect(found[local].sha).toBe(oldTn.sha);
});
