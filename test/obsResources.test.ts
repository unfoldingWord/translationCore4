// #288 / D75 — OBS set completeness, collection resolution, and image order.
import { describe, expect, it } from 'vitest';
import { isCompleteBibleLanguageSet, isCompleteObsLanguageSet } from '../src/data/burritoStore';
import type { LanguageSet, ResourcesFile, ResourcePin } from '../src/data/burritoStore';
import { installedPathFor, languageSetFromInstalled } from '../src/data/installed';
import { EN_HELPS, EN_OBS_IMAGES, INSTALLED_SUITE } from '../src/data/installedSuite';
import { obsImageFileName, obsImagePackFromMetadata, resolveObsImage } from '../src/data/obsImages';
import { preflightObsTool, resolveObsSetSlot } from '../src/data/resolve';
import { obsFrameSetMismatch } from '../src/data/obsFrameSet';
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

  it('preflights fallback separately from a missing exact primary pin, online and offline', () => {
    const primary: Partial<LanguageSet> = { ...EN_HELPS, gatewayLanguage: { languageId: 'es-419', owner: 'es-419_gl' } };
    delete primary['obs-tn'];
    const fallbackResources = { ...resources, languageSets: { primary, fallback: EN_HELPS } } as ResourcesFile;
    const fallback = preflightObsTool(fallbackResources, 'translationNotes', {
      isLocal: (pin) => pin.sha === EN_HELPS['obs-tn']?.sha, online: false,
    });
    expect(fallback).toMatchObject({ state: 'ready', sourceLanguage: 'en', resolution: { rung: 'fallback' } });

    const pinnedPrimary = { ...fallbackResources, languageSets: {
      ...fallbackResources.languageSets,
      primary: { ...primary, 'obs-tn': { ...EN_HELPS['obs-tn'], sha: 'a'.repeat(40) } },
    } } as ResourcesFile;
    expect(preflightObsTool(pinnedPrimary, 'translationNotes', { isLocal: () => false, online: false }))
      .toMatchObject({ state: 'unavailable', sourceLanguage: 'es-419', needs: null });
    expect(preflightObsTool(pinnedPrimary, 'translationNotes', { isLocal: () => false, online: true }))
      .toMatchObject({ state: 'fetch', sourceLanguage: 'es-419', needs: { sha: 'a'.repeat(40) } });
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

  it('matches project ingredients whose binary URL carries the filename in ipath', () => {
    const uri = `https://rig.test/api/burrito/ingredient/bytes/_local_/_local_/project?ipath=360px/${encodeURIComponent(fileName)}`;
    const result = resolveObsImage(imageLine, resources, {
      [`ingredients/360px/${fileName}`]: { uri, role: 'x-obsimages' },
    }, [], { pin: EN_OBS_IMAGES, images: {} });
    expect(result).toMatchObject({ source: 'project', uri });
  });

  it('falls through corrupt and ambiguous candidates and rejects a same-repo wrong SHA', () => {
    const wanted = { ...EN_OBS_IMAGES, sha: '1'.repeat(40) };
    const pinned = { ...resources, languageSets: {
      ...resources.languageSets,
      primary: { ...resources.languageSets.primary, 'obs-images': wanted },
    } } as ResourcesFile;
    const wrongSha = { pin: EN_OBS_IMAGES, images: { [fileName]: 'local://wrong-sha.jpg' } };
    const ambiguous = { pin: wanted, images: { [fileName]: ['local://one.jpg', 'local://two.jpg'] } };
    const corrupt = { pin: wanted, images: { [fileName]: { uri: 'local://bad.jpg', decodable: false } } };
    const bundled = { pin: EN_OBS_IMAGES, images: { [fileName]: 'local://default.jpg' } };
    expect(resolveObsImage(imageLine, pinned, {}, [wrongSha, ambiguous], bundled).source).toBe('default');
    expect(resolveObsImage(imageLine, pinned, {}, [corrupt], bundled).source).toBe('default');
    expect(resolveObsImage(imageLine, pinned, {
      a: { uri: `local://a/${fileName}`, role: 'x-obsimages' },
      b: { uri: `local://b/${fileName}`, role: 'x-obsimages' },
    }, [], bundled).source).toBe('default');
  });

  it('maps the real source filename through metadata paths stably, independent of entry order', () => {
    const ingredients = {
      'ingredients/360px/obs-en-01-02.jpg': { mimeType: 'text/markdown' },
      [`ingredients/360px/${fileName}`]: { mimeType: 'text/markdown' },
    };
    const a = obsImagePackFromMetadata(EN_OBS_IMAGES, { ingredients }, (ipath) => `local://${ipath}`);
    const b = obsImagePackFromMetadata(EN_OBS_IMAGES, { ingredients: Object.fromEntries(Object.entries(ingredients).reverse()) }, (ipath) => `local://${ipath}`);
    expect(a).toEqual(b);
    expect(resolveObsImage(imageLine, resources, {}, [], a)).toMatchObject({
      source: 'default', uri: `local://360px/${fileName}`,
    });
    expect(imageLine).toBe(fixture.split('\n').find((line) => line.startsWith('![')));
  });

  it('refuses structural frame-set changes but permits changed source text', () => {
    const story = (number: number, frames: number, text = 'x') => ({
      number, title: text, ref: null,
      frames: Array.from({ length: frames }, (_, i) => ({ image: `![x](obs-${number}-${i}.jpg)`, text })),
    });
    expect(obsFrameSetMismatch([story(1, 2, 'old')], [story(1, 2, 'new')])).toBeNull();
    expect(obsFrameSetMismatch([story(1, 2)], [story(1, 3)])).toMatch(/story 1 has 3 source frames/);
    expect(obsFrameSetMismatch([story(1, 2)], [story(2, 2)])).toMatch(/does not match/);
  });

  it('includes OBS text and image pins in atomic set upgrade discovery', () => {
    const repos = reposOfSet(EN_HELPS).map((repo) => repo.repoPath);
    expect(repos).toContain(EN_HELPS.obs?.repoPath);
    expect(repos).toContain(EN_HELPS['obs-tn']?.repoPath);
    expect(repos).toContain(EN_HELPS['obs-twl']?.repoPath);
  });

  it('reuses one exact install when primary and fallback pin the same image pack', () => {
    const local = '_local_/_sideloaded_/uw--obs_images_360--7146d5b504f6';
    const installed = { [local]: EN_OBS_IMAGES };
    expect(installedPathFor(installed, EN_OBS_IMAGES)).toBe(local);
    expect(installedPathFor(installed, { ...EN_OBS_IMAGES, sha: '0'.repeat(40) })).toBeNull();
  });
});
