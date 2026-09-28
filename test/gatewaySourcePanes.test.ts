// #412 (owner Q3/Q5): a gateway change moves a Bible project's source panes to
// the package's Bibles, and a pane the package cannot fill shows the English one.
// Pins are real identities: the shipped English suite (installedSuite) and the
// es-419_gl releases cached for the rig (dev-env/resources-cache/helps-provenance.json).
import { describe, expect, it } from 'vitest';
import { sourcePanesForGateway, applyGatewayChange, gatewaysCoveringProject, pinnedGateway } from '../src/data/gatewayChange';
import { pinKey } from '../src/data/resolve';
import { gatewayBiblesFromInstalled, readInstalled } from '../src/data/installed';
import { INSTALLED_SUITE, EN_HELPS } from '../src/data/installedSuite';
import type { ResourcePin, ResourcesFile } from '../src/data/burritoStore';

const EN_ULT = INSTALLED_SUITE.extraScripture[0] as { id: string } & ResourcePin;
const EN_UST = INSTALLED_SUITE.extraScripture[1] as { id: string } & ResourcePin;
const ENGLISH = { literal: EN_ULT, simplified: EN_UST };
const ES_GLT: ResourcePin = { repoPath: 'git.door43.org/es-419_gl/es-419_glt', version: 'v42', sha: '3f9bf7e8806f2e310601d723eb201334fe3be1ab', flavor: 'scripture/textTranslation' };
const ES_GST: ResourcePin = { repoPath: 'git.door43.org/es-419_gl/es-419_gst', version: 'v40', sha: '608e2294aa56938592ef592b0fc391d6d6178b2f', flavor: 'scripture/textTranslation' };
const ES = { id: 'es-419', org: 'es-419_gl' };
const bare = ({ id, ...pin }: { id: string } & ResourcePin) => { void id; return pin; };

describe('gatewayBiblesFromInstalled', () => {
  it('finds a package’s literal and simplified Bibles by their full repository names, in the package’s org', () => {
    const installed = {
      '_local_/_sideloaded_/es-419_glt': ES_GLT,
      '_local_/_sideloaded_/es-419_gst': ES_GST,
      '_local_/_sideloaded_/en_ult': bare(EN_ULT),
    };
    expect(gatewayBiblesFromInstalled(installed, ES)).toEqual({ literal: ES_GLT, simplified: ES_GST });
    expect(gatewayBiblesFromInstalled(installed, { id: 'en', org: 'unfoldingWord' })).toEqual({ literal: bare(EN_ULT), simplified: undefined });
  });

  it('finds nothing for a package with no Bible installed, or a Bible of another org', () => {
    const elsewhere = { '_local_/_sideloaded_/es-419_glt': { ...ES_GLT, repoPath: 'git.door43.org/Idiomas-Puentes/es-419_glt' } };
    expect(gatewayBiblesFromInstalled({}, ES)).toEqual({ literal: undefined, simplified: undefined });
    expect(gatewayBiblesFromInstalled(elsewhere, ES)).toEqual({ literal: undefined, simplified: undefined });
  });
});

describe('sourcePanesForGateway', () => {
  const current = INSTALLED_SUITE.extraScripture as ResourcesFile['extraScripture'];

  it('moves both panes to the package’s Bibles, named by the repository suffix', () => {
    expect(sourcePanesForGateway(current, { literal: ES_GLT, simplified: ES_GST }, ENGLISH)).toEqual([
      { id: 'glt', ...ES_GLT },
      { id: 'gst', ...ES_GST },
    ]);
  });

  it('a package with no Bible: both panes show the English ULT and UST (Q5)', () => {
    const spanish = sourcePanesForGateway(current, { literal: ES_GLT, simplified: ES_GST }, ENGLISH);
    expect(sourcePanesForGateway(spanish, {}, ENGLISH)).toEqual([EN_ULT, EN_UST]);
  });

  it('a package with only a literal Bible: the simplified pane shows the English UST', () => {
    expect(sourcePanesForGateway(current, { literal: ES_GLT }, ENGLISH)).toEqual([{ id: 'glt', ...ES_GLT }, EN_UST]);
  });

  it('a pane that already pins the chosen repository keeps its pin', () => {
    const newer = [{ ...EN_ULT, version: 'v90', sha: 'a'.repeat(40) }, EN_UST];
    expect(sourcePanesForGateway(newer, { literal: bare(EN_ULT) }, ENGLISH)).toEqual(newer);
  });

  it('keeps entries that are not gateway panes, and adds no pane a project does not have', () => {
    const own = { id: 'kjv', repoPath: 'git.door43.org/someone/en_kjv', sha: 'b'.repeat(40), flavor: 'scripture/textTranslation' };
    expect(sourcePanesForGateway([EN_ULT, own], { literal: ES_GLT, simplified: ES_GST }, ENGLISH)).toEqual([{ id: 'glt', ...ES_GLT }, own]);
    expect(sourcePanesForGateway(undefined, { literal: ES_GLT }, ENGLISH)).toBeUndefined();
  });

  it('applyGatewayChange writes the panes when given and leaves the fallback set alone', () => {
    const primary = { ...EN_HELPS, gatewayLanguage: { languageId: 'es-419', owner: 'es-419_gl' } } as never;
    const panes = sourcePanesForGateway(current, { literal: ES_GLT, simplified: ES_GST }, ENGLISH);
    const next = applyGatewayChange(INSTALLED_SUITE as unknown as ResourcesFile, primary, panes);
    expect(next.extraScripture).toEqual(panes);
    expect(next.languageSets.fallback).toEqual(INSTALLED_SUITE.languageSets.fallback);
    expect(applyGatewayChange(INSTALLED_SUITE as unknown as ResourcesFile, primary).extraScripture).toEqual(INSTALLED_SUITE.extraScripture);
  });
});

describe('gatewaysCoveringProject (owner Q2)', () => {
  // The es-419_gl helps at their rig releases (helps-provenance.json).
  const esPin = (name: string, version: string, sha: string, flavor: string): ResourcePin =>
    ({ repoPath: `git.door43.org/es-419_gl/${name}`, version, sha, flavor });
  const ES_TN = esPin('es-419_tn', 'v66', '22f3d0c61e2ab4701cb869547de9c3c43da07208', 'parascriptural/x-bcvnotes');
  const ES_TW = esPin('es-419_tw', 'v37', '7586f4ff1f0483ea40a4a68e5e1f33158e08c208', 'parascriptural/x-bcvarticles');
  const ES_TA = esPin('es-419_ta', 'v4', '26606b578c37cc2c0ee09bb7b9a291860ff59444', 'peripheral/x-peripheralArticles');
  const installed = {
    '_local_/_sideloaded_/en_tn': EN_HELPS.translationNotes,
    '_local_/_sideloaded_/en_tw': EN_HELPS.translationWords,
    '_local_/_sideloaded_/en_ta': EN_HELPS.translationAcademy,
    '_local_/_sideloaded_/es-419_tn': ES_TN,
    '_local_/_sideloaded_/es-419_tw': ES_TW,
    '_local_/_sideloaded_/es-419_ta': ES_TA,
  } as never;
  const keys = (list: Array<{ key: string }>) => list.map((g) => g.key);

  it('lists a package that covers one of the project’s books, and not one that covers none', () => {
    const coverage = {
      [pinKey(EN_HELPS.translationNotes)]: ['TIT', 'PHM'],
      [pinKey(EN_HELPS.translationWords)]: ['TIT', 'PHM'],
      [pinKey(ES_TN)]: ['TIT'],
      [pinKey(ES_TW)]: ['TIT'],
    };
    expect(keys(gatewaysCoveringProject(installed, coverage, ['TIT', 'JON'], 'bible'))).toEqual(['en::unfoldingWord', 'es-419::es-419_gl']);
    expect(keys(gatewaysCoveringProject(installed, coverage, ['PHM'], 'bible'))).toEqual(['en::unfoldingWord']);
  });

  it('whole-collection coverage (§5.3 BIBLE) covers every book', () => {
    const coverage = { [pinKey(ES_TN)]: ['TIT'], [pinKey(ES_TW)]: ['BIBLE'] };
    expect(keys(gatewaysCoveringProject(installed, coverage, ['GEN'], 'bible'))).toContain('es-419::es-419_gl');
    expect(keys(gatewaysCoveringProject(installed, { [pinKey(ES_TN)]: ['TIT'], [pinKey(ES_TW)]: ['TIT'] }, ['GEN'], 'bible'))).not.toContain('es-419::es-419_gl');
  });

  it('the word links alone are coverage: a book the notes lack but the links carry lists the package', () => {
    const coverage = { [pinKey(ES_TN)]: ['TIT'], [pinKey(ES_TW)]: ['TIT', 'PHM'] };
    expect(keys(gatewaysCoveringProject(installed, coverage, ['PHM'], 'bible'))).toContain('es-419::es-419_gl');
  });

  it('never lists an incomplete package, and a project with no books lists every complete one', () => {
    const noTa = { ...(installed as Record<string, ResourcePin>) };
    delete noTa['_local_/_sideloaded_/es-419_ta'];
    expect(keys(gatewaysCoveringProject(noTa as never, {}, [], 'bible'))).toEqual(['en::unfoldingWord']);
    expect(keys(gatewaysCoveringProject(installed, {}, [], 'bible'))).toEqual(['en::unfoldingWord', 'es-419::es-419_gl']);
  });
});

describe('readInstalled: a torn read of the settings document (#412)', () => {
  const records = { installedResources: { '_local_/_sideloaded_/es-419_glt': ES_GLT } };
  const reader = (failures: unknown[]) => {
    let calls = 0;
    return {
      calls: () => calls,
      api: { getClientSettings: async () => { calls += 1; const f = failures.shift(); if (f) throw f; return records; } },
    };
  };

  it('reads again when the document is half written', async () => {
    const r = reader([new SyntaxError("Expected property name or '}' in JSON at position 28692")]);
    expect(await readInstalled(r.api as never, 'uw-tc4')).toEqual(records.installedResources);
    expect(r.calls()).toBe(2);
  });

  it('a read that stays torn, or any other failure, still propagates', async () => {
    const torn = () => new SyntaxError('Unexpected end of JSON input');
    await expect(readInstalled(reader([torn(), torn(), torn(), torn()]).api as never, 'uw-tc4')).rejects.toThrow(SyntaxError);
    const outage = reader([new Error('connection refused')]);
    await expect(readInstalled(outage.api as never, 'uw-tc4')).rejects.toThrow('connection refused');
    expect(outage.calls()).toBe(1);
  });
});

describe('pinnedGateway — the current package Project Settings shows (#412: from its pins)', () => {
  it('is the primary set’s gateway language when the project has pins', () => {
    const pins = { languageSets: { primary: { gatewayLanguage: { languageId: 'es-419', owner: 'es-419_gl' } } } } as unknown as ResourcesFile;
    expect(pinnedGateway(pins)).toEqual({ languageId: 'es-419', owner: 'es-419_gl' });
  });

  it('is none, never English, when the project has no pins or they are not read yet', () => {
    expect(pinnedGateway(null)).toBeNull();
    expect(pinnedGateway(undefined)).toBeNull();
    expect(pinnedGateway({ languageSets: {} } as unknown as ResourcesFile)).toBeNull();
  });
});
