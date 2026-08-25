// Regression tests for the epic #33 adversarial review (2026-08-24).
//
// Each case reproduces a defect the review found in code that was already green
// across 570 tests — the suites covered the paths the implementer was thinking
// about, not these. Written to FAIL against the pre-fix code.
import { describe, expect, it } from 'vitest';
import { mapReference } from '../src/data/mapReference';
import { forgetProjectFrames, resolveProjectFrame } from '../src/data/projectFrame';
import {
  isValidMaxVerses,
  unplaceableReason,
  verseExists,
  type SchemeDoc,
  type SchemeName,
} from '../src/data/versification';

const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');
const load = (n: string): SchemeDoc =>
  JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), `test/fixtures/vrs/${n}.json`), 'utf8'),
  ) as SchemeDoc;
const eng = load('eng');
const lxx = load('lxx');

describe('R-E33-1 — a recorded scheme name that cannot be served must not lose the book', () => {
  // FOUND: rung 1 accepted any non-placeholder name without confirming a scheme
  // document could be obtained, short-circuiting past the fingerprint rung. The
  // result was {name, source:'recorded', schemes:{}}, which makes mapReference
  // return unknown-frame for EVERY reference — the whole book's checks dropped,
  // while the register's own bytes would have fingerprinted correctly.
  it('falls through to the fingerprint when the recorded name cannot be fetched', async () => {
    forgetProjectFrames();
    const frame = await resolveProjectFrame('repo/unserveable', {
      store: {
        readVersification: async () => ({ name: 'typo-scheme', bytes: JSON.stringify(lxx) }),
      },
      api: {
        getVersification: async (name: string) => {
          if (name === 'typo-scheme') throw new Error('404');
          return name === 'lxx' ? lxx : eng;
        },
        getVersifications: async () => ['eng', 'lxx'],
      },
    } as never);

    // The bytes ARE lxx, so the honest answer is lxx by fingerprint.
    expect(frame.name).toBe('lxx');
    expect(frame.source).toBe('fingerprint');
    // And a conversion must actually be possible.
    expect(frame.schemes.eng).toBeTruthy();
    expect(frame.schemes.lxx).toBeTruthy();
  });

  it('a resolvable recorded name still wins on rung 1', async () => {
    forgetProjectFrames();
    const frame = await resolveProjectFrame('repo/good', {
      store: { readVersification: async () => ({ name: 'lxx', bytes: '{}' }) },
      api: {
        getVersification: async (name: string) => (name === 'lxx' ? lxx : eng),
        getVersifications: async () => ['eng', 'lxx'],
      },
    } as never);
    expect(frame).toMatchObject({ name: 'lxx', source: 'recorded' });
    expect(frame.schemes.lxx).toBeTruthy();
  });

  it('an eng project still costs no scheme fetch at all', async () => {
    forgetProjectFrames();
    let fetches = 0;
    const frame = await resolveProjectFrame('repo/eng', {
      store: { readVersification: async () => ({ name: 'eng', bytes: '{}' }) },
      api: {
        getVersification: async () => {
          fetches += 1;
          return eng;
        },
        getVersifications: async () => ['eng', 'lxx'],
      },
    } as never);
    expect(frame).toMatchObject({ name: 'eng', source: 'recorded' });
    expect(fetches).toBe(0); // the short-circuit needs no document
  });
});

describe('R-E33-2 — unplaceableReason and verseExists must never disagree', () => {
  // FOUND: chapters[chapter - 1] indexes with NaN for a non-numeric chapter,
  // yielding undefined, and `verse > Number(undefined)` is false — so the guard
  // silently passed. verseExists rejected the same input. Since
  // unplaceableReason is the one that gates journaling, a check row with a
  // non-numeric chapter could be journaled with chapter 'front'.
  const cases: Array<[string, unknown, unknown]> = [
    ['non-numeric chapter', 'front', 1],
    ['fractional chapter', 1.5, 1],
    ['fractional verse', 1, 1.5],
    ['NaN chapter', Number.NaN, 1],
    ['NaN verse', 1, Number.NaN],
    ['negative chapter', -1, 1],
    ['non-numeric verse', 1, 'intro'],
  ];

  it.each(cases)('rejects a %s', (_label, chapter, verse) => {
    expect(unplaceableReason(eng, 'JHN', chapter as number, verse as number)).not.toBeNull();
    expect(verseExists(eng, 'JHN', chapter as number, verse as number)).toBe(false);
  });

  it('the two agree on every real verse of a book', () => {
    const chapters = eng.maxVerses.JHN;
    for (let c = 1; c <= chapters.length; c += 1) {
      for (let v = 1; v <= Number(chapters[c - 1]); v += 1) {
        expect(verseExists(eng, 'JHN', c, v)).toBe(unplaceableReason(eng, 'JHN', c, v) === null);
      }
    }
  });

  it('a non-numeric chapter cannot reach a mapped reference', async () => {
    const out = await mapReference({
      from: 'eng',
      to: 'lxx',
      book: 'JHN',
      chapter: 'front' as unknown as number,
      verse: 1,
      schemes: { eng, lxx },
    });
    expect(out.ok).toBe(false);
  });
});

describe('R-E33-3 — the frame cache must not outlive the project at a path', () => {
  // FOUND: forgetProjectFrames was exported and never called, and the cache is
  // keyed by repoPath only — which is not unique across a delete-and-recreate
  // within one session.
  it('a recreated project at the same path resolves to its own scheme', async () => {
    forgetProjectFrames();
    const deps = (name: SchemeName) =>
      ({
        store: { readVersification: async () => ({ name, bytes: '{}' }) },
        api: {
          getVersification: async (n: string) => (n === 'lxx' ? lxx : eng),
          getVersifications: async () => ['eng', 'lxx'],
        },
      }) as never;

    const first = await resolveProjectFrame('repo/reused', deps('eng'));
    expect(first.name).toBe('eng');

    // The project is deleted and a new one is created at the same path.
    forgetProjectFrames();
    const second = await resolveProjectFrame('repo/reused', deps('lxx'));
    expect(second.name).toBe('lxx');
  });
});

describe('R-E33-4 — a malformed reference is not an unknown frame', () => {
  // FOUND: a verse that fails to parse was reported as 'unknown-frame', which
  // points diagnosis at the project's versification setup when the real fault is
  // one bad resource row. The dropped-checks note groups by reason, so the user
  // was told the wrong thing.
  it('reports a malformed verse distinctly from an unresolved frame', async () => {
    const malformed = await mapReference({
      from: 'eng',
      to: 'lxx',
      book: 'JHN',
      chapter: 1,
      verse: '1a',
      schemes: { eng, lxx },
    });
    expect(malformed).toEqual({ ok: false, reason: 'malformed-reference' });

    const unknownFrame = await mapReference({
      from: 'eng',
      to: null,
      book: 'JHN',
      chapter: 1,
      verse: 1,
      schemes: { eng, lxx },
    });
    expect(unknownFrame).toEqual({ ok: false, reason: 'unknown-frame' });
  });
});

describe('R-E33-5 (amended) — malformed references are a CROSS-FRAME verdict only', () => {
  // The original R-E33-5 fix validated before the same-frame short-circuit.
  // That dropped real resource rows the pre-#33 pipeline derived and journaled
  // (measured on en_tn v89: 110 PSA `N:front` superscriptions, comma lists,
  // letter forms) and orphaned their stored decisions. The same-frame path
  // needs no mapping arithmetic, so it passes the reference through untouched;
  // only a genuine cross-frame conversion rejects what it cannot compute.
  it('cross-frame rejects a non-integer chapter as malformed', async () => {
    const out = await mapReference({
      from: 'eng',
      to: 'lxx',
      book: 'JHN',
      chapter: 'front' as unknown as number,
      verse: 1,
      schemes: { eng, lxx },
    });
    expect(out).toEqual({ ok: false, reason: 'malformed-reference' });
  });

  it('a valid integer chapter still passes the eng short-circuit untouched', async () => {
    const out = await mapReference({
      from: 'eng',
      to: 'eng',
      book: 'JHN',
      chapter: 1,
      verse: '1-3',
      schemes: { eng },
    });
    expect(out).toEqual({
      ok: true,
      reference: { book: 'JHN', chapter: 1, verse: '1-3' },
      mapped: false,
    });
  });

  it.each([
    ['front chapter (PSA superscription)', 'front', 1],
    ['comma-list verse', 1, '1,3,8'],
    ['letter-suffixed verse', 1, '1a'],
  ])('same-frame passes a real-world %s through unchanged', async (_label, chapter, verse) => {
    const out = await mapReference({
      from: 'eng',
      to: 'eng',
      book: 'PSA',
      chapter: chapter as number,
      verse,
      schemes: { eng },
    });
    expect(out).toEqual({
      ok: true,
      reference: { book: 'PSA', chapter: chapter as number, verse },
      mapped: false,
    });
  });

  it.each([
    ['zero chapter', 0, 1],
    ['negative chapter', -1, 1],
    ['unsafe chapter', Number.MAX_SAFE_INTEGER + 1, 1],
    ['zero verse', 1, 0],
    ['negative verse', 1, -1],
    ['unsafe verse', 1, Number.MAX_SAFE_INTEGER + 1],
    ['zero span endpoint', 1, '0-2'],
    ['reversed span', 1, '3-2'],
  ])('cross-frame rejects a %s before any mapping arithmetic', async (_label, chapter, verse) => {
    const out = await mapReference({
      from: 'eng',
      to: 'lxx',
      book: 'JHN',
      chapter: chapter as number,
      verse,
      schemes: { eng, lxx },
    });
    expect(out).toEqual({ ok: false, reason: 'malformed-reference' });
  });
});

describe('R-E33-6 — a known frame whose scheme data cannot be fetched is unavailable, not lost', () => {
  // FOUND (2nd review pass): offline, a recorded non-eng name resolved to
  // {name:null, source:'unknown'} and every reference dropped as "no verse in
  // this numbering" — false for a transient fetch failure, and the exact Russian
  // use case hitting a brief network outage. It must be a first-class UNAVAILABLE
  // state (D30.5): frame known, data not loaded, checks return when it loads.
  const offlineApi = {
    getVersification: async () => {
      throw new Error('offline');
    },
    getVersifications: async () => {
      throw new Error('offline');
    },
  };

  it('an rsc project offline is UNAVAILABLE (frame known), not unknown', async () => {
    forgetProjectFrames();
    const frame = await resolveProjectFrame('repo/rsc-offline', {
      store: { readVersification: async () => ({ name: 'rsc', bytes: '{}' }) },
      api: offlineApi,
    } as never);
    // The name is known — rsc is a scheme this build ships, so offline it is
    // trusted rather than treated as a typo.
    expect(frame.name).toBe('rsc');
    expect(frame.state).toBe('unavailable');
  });

  it('an eng project offline is READY — it needs no scheme data', async () => {
    forgetProjectFrames();
    const frame = await resolveProjectFrame('repo/eng-offline', {
      store: { readVersification: async () => ({ name: 'eng', bytes: '{}' }) },
      api: offlineApi,
    } as never);
    expect(frame).toMatchObject({ name: 'eng', state: 'ready' });
  });

  it('a foreign project with no recorded name and no fingerprint is UNKNOWN', async () => {
    forgetProjectFrames();
    const frame = await resolveProjectFrame('repo/foreign', {
      store: {
        readVersification: async () => ({
          name: 'unrecorded',
          bytes: '{"maxVerses":{"GEN":["99"]}}',
        }),
      },
      api: {
        getVersification: async (n: string) => (n === 'eng' ? eng : lxx),
        getVersifications: async () => ['eng', 'lxx'],
      },
    } as never);
    expect(frame.name).toBeNull();
    expect(frame.state).toBe('unknown');
  });

  it('an unavailable frame is retried, not cached as final', async () => {
    forgetProjectFrames();
    let online = false;
    const deps = {
      store: { readVersification: async () => ({ name: 'lxx', bytes: '{}' }) },
      api: {
        getVersification: async (n: string) => {
          if (!online) throw new Error('offline');
          return n === 'lxx' ? lxx : eng;
        },
        getVersifications: async () =>
          online ? ['eng', 'lxx'] : Promise.reject(new Error('offline')),
      },
    } as never;

    const first = await resolveProjectFrame('repo/reconnect', deps);
    expect(first.state).toBe('unavailable');

    // The user reconnects; opening the book again must now map, not serve the
    // cached unavailable frame.
    online = true;
    const second = await resolveProjectFrame('repo/reconnect', deps);
    expect(second.state).toBe('ready');
    expect(second.schemes.lxx).toBeTruthy();
    expect(second.schemes.eng).toBeTruthy();
  });

  it('an incomplete fingerprint is retried after candidate fetches recover', async () => {
    forgetProjectFrames();
    let online = false;
    const deps = {
      store: {
        readVersification: async () => ({ name: 'unrecorded', bytes: JSON.stringify(lxx) }),
      },
      api: {
        getVersification: async (n: string) => {
          if (!online) throw new Error('offline');
          return n === 'lxx' ? lxx : eng;
        },
        getVersifications: async () => ['eng', 'lxx'],
      },
    } as never;

    const first = await resolveProjectFrame('repo/fingerprint-reconnect', deps);
    expect(first).toMatchObject({ name: null, source: 'unknown', state: 'unavailable' });

    online = true;
    const second = await resolveProjectFrame('repo/fingerprint-reconnect', deps);
    expect(second).toMatchObject({ name: 'lxx', source: 'fingerprint', state: 'ready' });
  });

  it('no register is a conclusive unknown and needs no candidate fetch', async () => {
    forgetProjectFrames();
    let fetches = 0;
    const frame = await resolveProjectFrame('repo/no-register', {
      store: { readVersification: async () => null },
      api: {
        getVersification: async () => {
          fetches += 1;
          throw new Error('offline');
        },
        getVersifications: async () => ['eng', 'lxx'],
      },
    } as never);
    expect(frame).toMatchObject({ name: null, source: 'unknown', state: 'unknown' });
    expect(fetches).toBe(0);
  });

  it('a recorded name absent from a COMPLETE served list still falls through to fingerprint (R-E33-1 intact)', async () => {
    forgetProjectFrames();
    const frame = await resolveProjectFrame('repo/typo-online', {
      store: {
        readVersification: async () => ({ name: 'typo-scheme', bytes: JSON.stringify(lxx) }),
      },
      api: {
        getVersification: async (n: string) => {
          if (n === 'typo-scheme') throw new Error('404');
          return n === 'lxx' ? lxx : eng;
        },
        getVersifications: async () => ['eng', 'lxx'],
      },
    } as never);
    // Online, the served list is authoritative and does not include the typo, so
    // it is NOT trusted; the bytes fingerprint to lxx.
    expect(frame).toMatchObject({ name: 'lxx', source: 'fingerprint', state: 'ready' });
  });
});

describe('R-E33-7 — a frame that cannot map has an honest message, not the dropped-checks note', () => {
  // FOUND (3rd review pass): the check-open path special-cased only `unavailable`.
  // An `unknown` frame fell through to deriveForProject(to:null) and showed
  // "N checks have no verse in this project's — numbering" — the same misleading
  // message, with an em-dash for the null scheme. Both non-ready states now route
  // to their own designed empty state; this locks the i18n contract state.jsx
  // depends on (`check.empty.versification-${frame.state}`).
  it('both non-ready frame states have a titled, bodied empty message', () => {
    const en = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'src/i18n/en.json'), 'utf8'),
    ) as Record<string, string>;
    for (const state of ['unavailable', 'unknown']) {
      expect(en[`check.empty.versification-${state}.title`]).toBeTruthy();
      expect(en[`check.empty.versification-${state}.body`]).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// Regression tests for the PR #91 review (2026-08-25). Numbering continues the
// e33 review series; each case reproduces a finding from that review.
// ---------------------------------------------------------------------------

const stateSource = (): string =>
  fs.readFileSync(path.resolve(process.cwd(), 'src/state.jsx'), 'utf8');
const en = (): Record<string, string> =>
  JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'src/i18n/en.json'), 'utf8')) as Record<
    string,
    string
  >;

describe('PR91-2 — a frame-blocked gateway change names the real remedy, not coverage', () => {
  // FOUND: when the frame was not ready, every affected book went into
  // `blocked` with no reason, and the only UI string advised installing a
  // suite — advice that cannot unblock an offline user.
  it('previewGatewayChange stamps versification-blocked entries with a reason', () => {
    const preview = stateSource().slice(
      stateSource().indexOf('previewGatewayChange: async'),
      stateSource().indexOf('deriveItemsFor: async'),
    );
    expect(preview).toContain('reason: `versification-${frame.state}`');
  });

  it('both versification block reasons have their own gateway message', () => {
    for (const state of ['unavailable', 'unknown']) {
      expect(en()[`gateway.blocked-versification-${state}`]).toBeTruthy();
    }
    // The unavailable copy must point at reconnecting, not at installing.
    expect(en()['gateway.blocked-versification-unavailable']).toMatch(/[Rr]econnect/);
  });
});

describe('PR91-3 — a mapping outcome never reports the installed source text as missing', () => {
  // FOUND: openAlign passed a mapped SPAN verse ("9-10") into the exact-key
  // source lookup (which can never match single-verse-keyed UGNT/UHB), and
  // reused the 'missing' state — "download the source texts" — for both that
  // and the ok:false mapping refusal. R-E33-6 forbids blaming the text.
  it('openAlign routes span and refused mappings to no-counterpart, not missing', () => {
    const src = stateSource();
    const openAlign = src.slice(src.indexOf('openAlign:'), src.indexOf('startAligning:'));
    expect(openAlign).toContain("unavailable: 'no-counterpart'");
    expect(openAlign).toContain(".includes('-')");
    // Between the mapping call and the source lookup — the two mapping-outcome
    // refusals — 'missing' must not appear: the text IS installed there.
    const mappingOutcomes = openAlign.slice(
      openAlign.indexOf('mapReference'),
      openAlign.indexOf('verseObjectsFor'),
    );
    expect(mappingOutcomes).not.toContain("unavailable: 'missing'");
  });

  it('the no-counterpart state has a titled, bodied message', () => {
    expect(en()['align.unavailable.no-counterpart.title']).toBeTruthy();
    expect(en()['align.unavailable.no-counterpart.body']).toBeTruthy();
  });
});

describe('PR91-4 — deriveItemsFor refuses a not-ready frame instead of deriving eng-framed identities', () => {
  // FOUND: `frame.state === 'ready' ? frame.name : RESOURCE_FRAME` silently
  // derived eng-framed identities — the exact corruption R-E33-8 exists to
  // prevent — held off only by the caller's blocking. The invariant now lives
  // in the helper itself.
  it('the silent eng fallback is gone and the guard throws', () => {
    const src = stateSource();
    const derive = src.slice(
      src.indexOf('deriveItemsFor: async'),
      src.indexOf('askGatewayChange: async'),
    );
    expect(derive).not.toContain("frame.state === 'ready' ? frame.name : RESOURCE_FRAME");
    expect(derive).toContain('throw new Error');
    expect(derive).toContain('R-E33-8');
  });
});

describe('PR91-7 — a scheme doc with non-numeric maxVerses values is not a scheme', () => {
  // FOUND: `verse > Number(garbage)` is false for NaN, so a corrupt maxVerses
  // entry made verseExists pass for ANY verse in that chapter — and a landing
  // that passes is journaled permanently. Same NaN-silent-pass shape R-E33-2
  // fixed for the inputs; the values are now validated at the load point.
  it('fetchScheme-served garbage cannot become a ready frame', async () => {
    forgetProjectFrames();
    const corrupt = { ...lxx, maxVerses: { GEN: ['31', 'not-a-count'] } };
    const frame = await resolveProjectFrame('repo/corrupt-scheme', {
      store: {
        readVersification: async () => ({ name: 'lxx', bytes: JSON.stringify(corrupt) }),
      },
      api: {
        getVersification: async () => corrupt,
        getVersifications: async () => ['eng', 'lxx'],
      },
    } as never);
    expect(frame.state).not.toBe('ready');
  });

  it('isValidMaxVerses accepts every shipped scheme and rejects the garbage shapes', () => {
    for (const name of ['eng', 'lxx'] as const) {
      expect(isValidMaxVerses(load(name).maxVerses)).toBe(true);
    }
    expect(isValidMaxVerses({ GEN: ['31', 'oops'] })).toBe(false);
    expect(isValidMaxVerses({ GEN: '31' })).toBe(false);
    expect(isValidMaxVerses({ GEN: [31] })).toBe(false);
    expect(isValidMaxVerses(null)).toBe(false);
    expect(isValidMaxVerses(['31'])).toBe(false);
  });
});
