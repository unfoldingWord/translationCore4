// #288 / D75 — OBS set completeness, collection resolution, and image order.
import { describe, expect, it } from 'vitest';
import { isCompleteBibleLanguageSet, isCompleteObsLanguageSet } from '../src/data/burritoStore';
import type { LanguageSet, ResourcesFile, ResourcePin } from '../src/data/burritoStore';
import { languageSetFromInstalled } from '../src/data/installed';
import { EN_HELPS, EN_OBS_IMAGES, INSTALLED_SUITE } from '../src/data/installedSuite';
import { obsImageFileName, resolveObsImage } from '../src/data/obsImages';
import { resolveObsSetSlot } from '../src/data/resolve';
import { reposOfSet } from '../src/data/upgrade';

const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');
const fixture = fs.readFileSync(path.resolve(process.cwd(), 'conformance/fixtures/text_stories/ingredients/content/01.md'), 'utf8');
const imageLine = fixture.split('\n').find((line) => line.startsWith('![')) ?? '';
const fileName = obsImageFileName(imageLine) ?? '';
const resources = INSTALLED_SUITE as unknown as ResourcesFile;

describe('#288 — OBS resources', () => {
  it('negative control: a non-image line never resolves', () => {
    expect(obsImageFileName('not an image')).toBeNull();
    expect(resolveObsImage('not an image', resources, {}, [], { pin: EN_OBS_IMAGES, images: {} }).source).toBe('missing');
  });

  it('applies distinct Bible and OBS completeness rules', () => {
    expect(isCompleteBibleLanguageSet(EN_HELPS)).toBe(true);
    expect(isCompleteObsLanguageSet(EN_HELPS)).toBe(true);
    const obsOnly = { ...EN_HELPS, translationNotes: undefined, translationWordsLinks: undefined };
    expect(isCompleteBibleLanguageSet(obsOnly)).toBe(false);
    expect(isCompleteObsLanguageSet(obsOnly)).toBe(true);
  });

  it('builds a complete OBS set without installed Bible-only members', () => {
    const installed = Object.fromEntries(
      Object.entries(EN_HELPS)
        .filter(([slot, value]) => slot !== 'gatewayLanguage' && slot !== 'translationNotes' && slot !== 'translationWordsLinks' && typeof value === 'object' && 'repoPath' in value)
        .map(([slot, value]) => [slot, value]),
    );
    const gateway = { id: 'en', org: 'unfoldingWord' };
    const obsSet = languageSetFromInstalled(installed as never, gateway, 'obs');
    expect(obsSet).not.toBeNull();
    expect(obsSet?.translationNotes).toBeUndefined();
    expect(obsSet?.translationWordsLinks).toBeUndefined();
    expect(languageSetFromInstalled(installed as never, gateway, 'bible')).toBeNull();
  });

  it('resolves OBS collections by primary then fallback without Bible coverage', () => {
    const primary = { ...EN_HELPS, obs: undefined } as unknown as LanguageSet;
    const r = resolveObsSetSlot({ ...resources, languageSets: { primary, fallback: EN_HELPS } } as ResourcesFile, 'obs');
    expect(r.rung).toBe('fallback');
    expect(r.pin).toEqual(EN_HELPS.obs);
    expect(r.usedFallback).toBe(true);
  });

  it('resolves images project → primary pin → fallback pin → bundled default and never changes the line', () => {
    expect(fileName).not.toBe('');
    const override = EN_OBS_IMAGES as ResourcePin;
    const pinned = {
      ...resources,
      languageSets: {
        primary: { ...resources.languageSets.primary, 'obs-images': override },
        fallback: { ...resources.languageSets.fallback, 'obs-images': override },
      },
    } as ResourcesFile;
    const pack = { pin: override, images: { [fileName]: 'local://override' } };
    const bundled = { pin: override, images: { [fileName]: 'local://default' } };

    expect(resolveObsImage(imageLine, pinned, { [fileName]: { uri: `local://${fileName}`, role: 'x-obsimages' } }, [pack], bundled).source).toBe('project');
    const fromPin = resolveObsImage(imageLine, pinned, {}, [pack], bundled);
    expect(fromPin).toMatchObject({ source: 'pin', rung: 'primary', uri: 'local://override' });
    expect(resolveObsImage(imageLine, resources, {}, [], bundled).source).toBe('default');
    expect(imageLine).toBe(fixture.split('\n').find((line) => line.startsWith('![')));
  });

  it('includes OBS text and image pins in atomic set upgrade discovery', () => {
    const repos = reposOfSet(EN_HELPS).map((repo) => repo.repoPath);
    expect(repos).toContain(EN_HELPS.obs?.repoPath);
    expect(repos).toContain(EN_HELPS['obs-tn']?.repoPath);
    expect(repos).toContain(EN_HELPS['obs-twl']?.repoPath);
  });
});
