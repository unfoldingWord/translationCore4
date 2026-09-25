// #9 — the guided fix screen's two pure pieces: the sideload gate (a file is
// installed only when it declares the pinned commit, D58/D23b) and the re-pin
// offer (move the slots pinning the missing identity onto an installed one;
// the same offer shape the #256 upgrade flow confirms and journals).
import { describe, expect, it } from 'vitest';
import { verifySideload } from '../src/data/resourceFetch';
import { repinOffer } from '../src/data/upgrade';
import type { LanguageSet, ResourcePin, ResourcesFile } from '../src/data/burritoStore';

const sha = (c: string) => c.repeat(40);
const pin = (repo: string, version: string | undefined, s: string, flavor = 'parascriptural/x-bcvnotes'): ResourcePin => ({
  repoPath: `git.door43.org/unfoldingWord/${repo}`,
  ...(version ? { version } : {}),
  sha: sha(s),
  flavor,
});
const files = { 'metadata.json': new Uint8Array(), 'ingredients/TIT.tsv': new Uint8Array() };

describe('verifySideload — the file must declare the pinned commit', () => {
  const pinned = pin('en_tn', 'v90', 'e');

  it('accepts an export whose declared revision is the pinned sha', () => {
    expect(() => verifySideload(pinned, { files, revision: sha('e') })).not.toThrow();
  });

  it('refuses another commit of the same repo, naming both, and refuses a file with no revision', () => {
    expect(() => verifySideload(pinned, { files, revision: sha('a') })).toThrow(/aaaaaaaaaaaa…, but the project pins eeeeeeeeeeee… \(v90\) — not installed/);
    expect(() => verifySideload(pinned, { files, revision: null })).toThrow(/declares no revision/);
  });

  it('a pin without a sha is satisfiable by no file (D59)', () => {
    expect(() => verifySideload({ repoPath: pinned.repoPath, flavor: pinned.flavor }, { files, revision: sha('e') })).toThrow(/pinned without a commit/);
  });
});

describe('repinOffer — move the slots that pin the missing identity onto the installed one', () => {
  const missing = pin('en_tw', 'v90', 'm', 'parascriptural/x-bcvarticles');
  const installed = pin('en_tw', 'v89', 'i', 'parascriptural/x-bcvarticles');
  const set: LanguageSet = {
    gatewayLanguage: { languageId: 'en', owner: 'unfoldingWord' },
    translationNotes: pin('en_tn', 'v89', 'n'),
    translationWordsLinks: missing,
    translationWords: missing,
    translationAcademy: pin('en_ta', 'v89', 't', 'peripheral/x-peripheralArticles'),
  };
  const resources = { schemaVersion: 2, languageSets: { primary: set, fallback: set }, resources: {} } as unknown as ResourcesFile;

  it('an installed copy identified without a tag carries no version label (the §5.3 grammar refuses an empty one)', () => {
    const offer = repinOffer(resources, 'primary', missing, pin('en_tw', undefined, 'i', ''));
    expect(offer.upgrades[0].to).toEqual({ repoPath: missing.repoPath, sha: sha('i'), flavor: 'parascriptural/x-bcvarticles' });
  });

  it('is empty when the rung does not pin that identity', () => {
    expect(repinOffer(resources, 'primary', pin('en_tw', 'v88', 'x'), installed).upgrades).toEqual([]);
    expect(repinOffer({ ...resources, languageSets: { primary: set } } as never, 'fallback', missing, installed).upgrades).toEqual([]);
  });
});
