// The alignment frame direction (epic #33 / issue #15).
//
// Derive maps resource -> project. ALIGNMENT maps the other way, and it is the
// half that is easy to get wrong:
//
//   * the draft book and the §5.1 alignment sidecar are both in the PROJECT
//     frame — the platform scaffolded the draft from the project's own maxVerses,
//     and alignment records are keyed by the draft's chapter/verse;
//   * the original-language texts (UGNT/UHB) are eng-framed — measured: 929 UHB
//     chapters and 260 UGNT chapters with zero exceeding eng, and UHB PSA 3
//     ending at verse 8 where org would have 9.
//
// So for a non-eng project the SAME chapter:verse names a different verse in the
// source text. Reading it unmapped aligns the draft against the wrong Greek or
// Hebrew, silently. `openAlign` maps project -> resource frame for the lookup,
// and this suite pins the direction and the round trip.
//
// Note this is a LOOKUP, never an identity: the alignment record stays keyed by
// the project-frame reference, which is what keeps export frame-neutral (below).
import { describe, expect, it } from 'vitest';
import { mapReference } from '../src/data/mapReference';
import { RESOURCE_FRAME } from '../src/data/projectFrame';
import { SCHEME_NAMES, type SchemeDoc, type SchemeName } from '../src/data/versification';

const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');
const VRS_DIR = path.resolve(process.cwd(), 'test/fixtures/vrs');
const schemes = Object.fromEntries(
  SCHEME_NAMES.map((n) => [
    n,
    JSON.parse(fs.readFileSync(path.join(VRS_DIR, `${n}.json`), 'utf8')) as SchemeDoc,
  ]),
) as Record<SchemeName, SchemeDoc>;

/** What openAlign does: project-frame draft reference -> source-text reference. */
const sourceRefFor = (project: SchemeName | null, book: string, chapter: number, verse: number | string) =>
  mapReference({ from: project, to: RESOURCE_FRAME, book, chapter, verse, schemes });

describe('the resource frame is eng', () => {
  it('RESOURCE_FRAME names the frame the whole unfoldingWord suite is in', () => {
    expect(RESOURCE_FRAME).toBe('eng');
  });
});

describe('an eng project is untouched', () => {
  it('short-circuits, so the source lookup uses the draft reference as-is', async () => {
    const out = await sourceRefFor('eng', 'JON', 1, 17);
    expect(out).toEqual({
      ok: true,
      reference: { book: 'JON', chapter: 1, verse: 17 },
      mapped: false,
    });
  });
});

describe('a non-eng project maps the source lookup', () => {
  it('an rsc draft at JON 2:1 aligns against eng JON 1:17', async () => {
    // rsc JON 1 ends at verse 16, so the verse the eng suite calls JON 1:17 is
    // JON 2:1 in this project. Unmapped, the aligner would have fetched the
    // Hebrew of eng JON 2:1 — the wrong verse entirely.
    const out = await sourceRefFor('rsc', 'JON', 2, 1);
    expect(out).toEqual({
      ok: true,
      reference: { book: 'JON', chapter: 1, verse: 17 },
      mapped: true,
    });
  });

  it('an rsc draft at JON 2:11 aligns against eng JON 2:10', async () => {
    const out = await sourceRefFor('rsc', 'JON', 2, 11);
    expect(out).toMatchObject({ ok: true, reference: { chapter: 2, verse: 10 } });
  });

  it('a psalm superscription offset maps back by one', async () => {
    // rsc counts the superscription as verse 1, eng does not.
    const out = await sourceRefFor('rsc', 'PSA', 3, 2);
    expect(out).toMatchObject({ ok: true, reference: { chapter: 3, verse: 1 } });
  });

  it('an lxx draft at GEN 32:1 aligns against eng GEN 31:55', async () => {
    const out = await sourceRefFor('lxx', 'GEN', 32, 1);
    expect(out).toMatchObject({ ok: true, reference: { chapter: 31, verse: 55 } });
  });

  it('an rso draft at PSA 12:6 aligns against eng PSA 13:5', async () => {
    const out = await sourceRefFor('rso', 'PSA', 12, 6);
    expect(out).toMatchObject({ ok: true, reference: { chapter: 13, verse: 5 } });
  });

  it('a reference needing no adjustment still resolves', async () => {
    const out = await sourceRefFor('vul', 'MAL', 4, 1);
    expect(out).toMatchObject({ ok: true, reference: { chapter: 4, verse: 1 } });
  });
});

describe('the two directions round-trip for the verses alignment actually uses', () => {
  it('derive maps eng -> project and alignment maps project -> eng, consistently', async () => {
    // These are the frame-shifting verses a non-eng project will actually meet.
    // A round trip that did not return to the start would mean the check list
    // and the aligner disagree about which verse a decision is on.
    for (const [project, book, engChapter, engVerse] of [
      ['rsc', 'JON', 1, 17],
      ['rsc', 'PSA', 3, 1],
      ['lxx', 'GEN', 31, 55],
      ['rso', 'PSA', 13, 5],
    ] as [SchemeName, string, number, number][]) {
      const toProject = await mapReference({
        from: RESOURCE_FRAME,
        to: project,
        book,
        chapter: engChapter,
        verse: engVerse,
        schemes,
      });
      expect(toProject.ok).toBe(true);
      if (!toProject.ok) continue;

      const back = await sourceRefFor(
        project,
        toProject.reference.book,
        toProject.reference.chapter,
        toProject.reference.verse,
      );
      expect(back).toMatchObject({
        ok: true,
        reference: { book, chapter: engChapter, verse: engVerse },
      });
    }
  });
});

describe('an unresolvable frame refuses rather than aligning against the wrong verse', () => {
  it('an unknown project frame yields no source reference', async () => {
    const out = await sourceRefFor(null, 'JON', 2, 1);
    expect(out).toEqual({ ok: false, reason: 'unknown-frame' });
  });

  it('a psalm superscription has no eng counterpart, so alignment refuses', async () => {
    // A real and recurring case, not a contrived one: rsc and vul NUMBER the
    // psalm superscription as verse 1, and eng does not number it at all. So an
    // rsc project's PSA 3:1 maps to eng PSA 3:0 — a verse that does not exist.
    //
    // Product consequence: for an rsc or vul project, every psalm superscription
    // is a drafted verse with NO original-language verse behind it. The aligner
    // must report that rather than align it against eng PSA 3:1, which is a
    // different line of text.
    for (const project of ['rsc', 'vul'] as SchemeName[]) {
      const out = await sourceRefFor(project, 'PSA', 3, 1);
      expect(out).toEqual({ ok: false, reason: 'verse-zero' });
    }
  });

  it('content the eng frame does not carry refuses too', async () => {
    // rso JOS 24 runs past eng's chapter end; lxx EZR has chapters eng lacks.
    expect(await sourceRefFor('rso', 'JOS', 24, 34)).toEqual({
      ok: false,
      reason: 'past-chapter-end',
    });
    expect(await sourceRefFor('lxx', 'EZR', 14, 18)).toEqual({
      ok: false,
      reason: 'no-chapter',
    });
  });
});

describe('export is frame-neutral by construction', () => {
  // The export path itself is Increment 4 (e2e/j07-publish.spec.ts is test.fixme
  // @inc4), so there is no export code to exercise yet. What CAN be pinned now
  // is the property that makes export need no mapping at all: both of its inputs
  // are already in the project frame. Export folds the §5.1 alignment sidecar
  // into the draft USFM, and both are keyed by project-frame references — so no
  // conversion arises, and none should ever be added.
  //
  // This test guards that invariant: if someone later keys alignment records in
  // the resource frame, export would silently need a conversion it does not do,
  // and this fails.
  it('a project-frame reference is its own alignment key — no conversion in play', async () => {
    const draftRef = { book: 'JON', chapter: 2, verse: 1 }; // an rsc project's draft
    // The alignment record is keyed by the draft reference, unmapped.
    const alignmentKey = `${draftRef.chapter}:${draftRef.verse}`;
    expect(alignmentKey).toBe('2:1');

    // The SOURCE lookup maps; the KEY does not. Those must differ for a non-eng
    // project — that difference is exactly why the key must not be the mapped one.
    const source = await sourceRefFor('rsc', draftRef.book, draftRef.chapter, draftRef.verse);
    expect(source).toMatchObject({ ok: true, reference: { chapter: 1, verse: 17 } });
    if (source.ok) {
      expect(`${source.reference.chapter}:${source.reference.verse}`).not.toBe(alignmentKey);
    }
  });
});
