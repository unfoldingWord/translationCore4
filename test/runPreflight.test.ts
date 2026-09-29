// #481: after a gateway change, commitGatewayChange's runPreflight and the
// Check picker's effect overlap. The older run read the old pins; when it
// finished last it overwrote the newer preflight, and the picker counted the
// old language's list.
import { describe, expect, it, vi } from 'vitest';
import {
  __performRunPreflightForTests as performRunPreflight,
  __reducerForTests as reducer,
} from '../src/state.jsx';
import { pinKey } from '../src/data/resolve';
import type { ResourcePin, ResourcesFile } from '../src/data/burritoStore';

const pin = (repo: string): ResourcePin => ({
  repoPath: `git.door43.org/${repo}`,
  version: 'v1',
  sha: repo.padEnd(40, '0').slice(0, 40),
  flavor: 'parascriptural/x-bcvnotes',
});

const set = (lang: string, org: string) => ({
  gatewayLanguage: { languageId: lang, owner: org },
  translationNotes: pin(`${org}/${lang}_tn`),
  translationWordsLinks: pin(`${org}/${lang}_twl`),
  translationWords: pin(`${org}/${lang}_tw`),
  translationAcademy: pin(`${org}/${lang}_ta`),
});

const EN = set('en', 'unfoldingWord');
const ES = set('es-419', 'Es-419_gl');
const ENGLISH: ResourcesFile = { schemaVersion: 2, languageSets: { primary: EN, fallback: EN }, resources: {} };
const SPANISH: ResourcesFile = { schemaVersion: 2, languageSets: { primary: ES, fallback: EN }, resources: {} };
const coverage = Object.fromEntries(
  [EN, ES].flatMap((s) => [s.translationNotes, s.translationWordsLinks]).map((p) => [pinKey(p), ['TIT']]),
);

const stateWith = (projectPins: ResourcesFile) => ({
  project: { repoPath: '_local_/_local_/p', flavor: 'textTranslation' },
  book: 'TIT',
  netEnabled: true,
  projectPins,
});

/** resolutionContext calls that the test settles one by one, in any order. */
function heldResolution() {
  const pending: Array<(cov: typeof coverage) => void> = [];
  const resolutionContext = vi.fn(
    () => new Promise((resolve) => {
      pending.push((cov) => resolve({ installed: {}, coverage: cov, resolutionError: null }));
    }),
  );
  return { resolutionContext, settle: (i: number, cov = coverage) => pending[i](cov) };
}

function harness(projectPins: ResourcesFile) {
  const stateRef = { current: stateWith(projectPins) as Record<string, unknown> };
  let state: Record<string, unknown> = {};
  const dispatch = (action: unknown) => { state = reducer(state, action as never); };
  const held = heldResolution();
  const run = () => performRunPreflight({ stateRef, dispatch, actions: { resolutionContext: held.resolutionContext } });
  const tnRepo = () =>
    (state.preflight as Record<string, { resolution: { pin: ResourcePin } }>).translationNotes.resolution.pin.repoPath;
  return { stateRef, run, settle: held.settle, tnRepo };
}

describe('#481 runPreflight — the newest pins win', () => {
  it('an older run that finishes last does not overwrite the newer preflight', async () => {
    const h = harness(ENGLISH);
    const older = h.run(); // commitGatewayChange: no render yet, old pins
    h.stateRef.current = stateWith(SPANISH); // the render after the change
    const newer = h.run(); // the Check picker effect: new pins
    h.settle(1);
    await newer;
    h.settle(0);
    await older;
    expect(h.tnRepo()).toBe(ES.translationNotes.repoPath);
  });

  it('an older run´s resolution context does not land over a newer one', async () => {
    // Only the seq guard holds here: both runs read the Spanish pins after
    // the await, but the older run's context predates the Spanish coverage.
    const h = harness(SPANISH);
    const older = h.run();
    const newer = h.run();
    h.settle(1);
    await newer;
    const englishOnly = Object.fromEntries(Object.entries(coverage).filter(([k]) => k.includes('/en_')));
    h.settle(0, englishOnly);
    await older;
    expect(h.tnRepo()).toBe(ES.translationNotes.repoPath);
  });

  it('builds the preflight from the pins at the end of the await, not at the start', async () => {
    const h = harness(ENGLISH);
    const run = h.run();
    h.stateRef.current = stateWith(SPANISH);
    h.settle(0);
    await run;
    expect(h.tnRepo()).toBe(ES.translationNotes.repoPath);
  });
});
