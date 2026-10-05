// suggestEngine.ts — the wordMAP + uw-wordmapbooster engine behind alignment
// suggestions (#1, D72 point 3; #516, D93). Runs inside suggestWorker.ts;
// imported directly by the unit tests. gatewayEdit's `enhanced-word-aligner-rcl`
// is a reference to start from, not a design to copy (owner ruling 2026-09-24,
// #400; amends the 2026-08-13 "adopted as-is" ruling). From it we keep the
// model class and defaults [VERIFIED — enhanced-word-aligner-rcl 1.4.8
// dist/workers/utils/AlignmentTrainerUtils.js createTrainedWordAlignerModel;
// dist/common/constants.js; 2026-09-12]: `MorphJLBoostWordMap`, sourceNgramLength 3,
// targetNgramLength 5, train_steps 1000, `add_alignments_2`, one whole-verse
// suggestion (maxSuggestions 1), no confidence cut, training bounded by a
// complexity cap (100 000 for the NT model, 50 000 for the OT model).
// Where we differ (owner ruling 2026-10-02, #516, measured in
// docs/evidence/align-suggestions-growth-2026-10-02.md): every confirmed save
// appends its verse to the alignment memory (`appendVerse`), the booster
// retrains only on a budget, and before the booster can fit — fewer than
// MIN_BOOST_VERSES, or a corpus it rejects — plain wordMAP answers from the
// same memory (`predictLinks` falls back to `WordMap.predict`).
//
// One instance per testament: the alignment memory generalizes through the
// shared original-language text, and Hebrew memory cannot inform a Greek verse.
import { MorphJLBoostWordMap, updateTokenLocations } from 'uw-wordmapbooster';
import WordMap, { Alignment, Ngram } from 'wordmap';
import { Token } from 'wordmap-lexer';
import type { PositionLink, RawLink, SessionInput, Testament, TokenSeed, TrainingVerse } from './suggest';

export const MAX_COMPLEXITY: Record<Testament, number> = { nt: 100_000, ot: 50_000 };

const MODEL_OPTIONS = {
  forceOccurrenceOrder: false,
  nGramWarnings: false,
  sourceNgramLength: 3,
  targetNgramLength: 5,
  train_steps: 1000,
  verbose_training: false,
  warnings: false,
};

const tokens = (seeds: TokenSeed[]): Token[] => {
  const out = seeds.map((s) => new Token({ ...s }));
  updateTokenLocations(out);
  return out;
};

const alignment = (source: Token[], target: Token[], link: PositionLink): Alignment =>
  new Alignment(new Ngram(link.source.map((i) => source[i])), new Ngram(link.target.map((i) => target[i])));

/** gatewayEdit's complexity measure of one verse pair. */
const complexityOf = (v: TrainingVerse): number => v.source.length * v.target.length;

/**
 * Bound the corpus like gatewayEdit does: drop verses until the summed
 * complexity fits the cap. Deterministic (last verses first) so a run is
 * reproducible; the caller reports how many verses trained.
 */
export const boundCorpus = (verses: TrainingVerse[], cap: number): TrainingVerse[] => {
  let total = verses.reduce((n, v) => n + complexityOf(v), 0);
  const kept = [...verses];
  while (total > cap && kept.length > 1) total -= complexityOf(kept.pop() as TrainingVerse);
  return kept;
};

/** Below this many aligned verses the booster is not asked to fit at all —
 * gatewayEdit requires more than four, and the 2026-10-02 measurement shows
 * plain wordMAP memory answers from the first verse (#516). */
export const MIN_BOOST_VERSES = 5;

export interface TrainedModel {
  testament: Testament;
  /** Verses in the model's alignment memory (every confirmed verse, appended
   * ones included); 0 when the model knows nothing. */
  verses: number;
  /** The subset the booster was fitted on — the complexity cap's share; 0 for
   * a memory-only model (fewer than MIN_BOOST_VERSES, or `tooFew`). */
  boosted?: number;
  /** True when the corpus had aligned verses but the booster could not fit
   * them (too few for its correct/incorrect split) — the model then answers
   * from wordMAP memory alone. */
  tooFew?: boolean;
  model: MorphJLBoostWordMap;
}

const wordMapOf = (model: MorphJLBoostWordMap) =>
  (model as unknown as { wordMap: WordMap }).wordMap;

const appendToMemory = (model: MorphJLBoostWordMap, v: TrainingVerse) => {
  const s = tokens(v.source);
  const t = tokens(v.target);
  wordMapOf(model).appendAlignmentMemory(v.links.map((l) => alignment(s, t, l)));
};

/** A model that knows nothing yet — the worker's starting point when a save
 * arrives before any training ran (#516). */
export const emptyModel = (testament: Testament): TrainedModel => ({
  testament,
  verses: 0,
  boosted: 0,
  model: new MorphJLBoostWordMap(MODEL_OPTIONS),
});

/**
 * One confirmed save joins the model's alignment memory at once — wordMAP's
 * `appendAlignmentMemory`, the same call training makes for the verses the
 * complexity cap trims (#516; ~0.14 ms per verse per the 2026-10-02
 * measurement). The booster is untouched: a stale booster over a fresh memory
 * tracks a retrained one within noise up to ~2 500 verses.
 * `isNew` says whether the verse counts (a re-save of a verse already in
 * memory appends its current links — the engine stays current — but the old
 * links stay beside them until the next budgeted retrain rebuilds the memory,
 * and the verse is not counted twice).
 */
export const appendVerse = (trained: TrainedModel, verse: TrainingVerse, isNew = true): TrainedModel => {
  appendToMemory(trained.model, verse);
  return { ...trained, verses: trained.verses + (isNew ? 1 : 0) };
};

/**
 * Train one testament's model on the project's confirmed alignments.
 * With fewer than MIN_BOOST_VERSES the booster is not asked at all — the
 * model is memory-only and plain wordMAP answers (#516). From five verses up,
 * `add_alignments_2` (gatewayEdit's choice) boosts on the second half of the
 * verses over memory of the first; a corpus the booster still cannot fit
 * falls back to the same memory-only model instead of throwing.
 */
export const trainModel = async (testament: Testament, verses: TrainingVerse[]): Promise<TrainedModel> => {
  if (!verses.length) return { testament, verses: 0, model: new MorphJLBoostWordMap(MODEL_OPTIONS) };
  // Memory-only: every verse into the alignment memory, no booster fit.
  const memoryOnly = (tooFew?: boolean): TrainedModel => {
    const model = new MorphJLBoostWordMap(MODEL_OPTIONS);
    for (const v of verses) appendToMemory(model, v);
    return { testament, verses: verses.length, boosted: 0, ...(tooFew ? { tooFew } : {}), model };
  };
  if (verses.length < MIN_BOOST_VERSES) return memoryOnly();
  const kept = boundCorpus(verses, MAX_COMPLEXITY[testament]);
  const source: { [ref: string]: Token[] } = {};
  const target: { [ref: string]: Token[] } = {};
  const alignments: { [ref: string]: Alignment[] } = {};
  for (const v of kept) {
    source[v.ref] = tokens(v.source);
    target[v.ref] = tokens(v.target);
    alignments[v.ref] = v.links.map((l) => alignment(source[v.ref], target[v.ref], l));
  }
  const model = new MorphJLBoostWordMap(MODEL_OPTIONS);
  try {
    if (kept.length >= 2) await model.add_alignments_2(source, target, alignments);
    else await model.add_alignments_3(source, target, alignments);
  } catch {
    // The booster rejected the corpus (too few rows for its split) — a fresh
    // memory-only model on the SAME corpus answers instead; the partly-fed
    // model is discarded so nothing is counted twice.
    return memoryOnly(true);
  }
  // The verses the cap left out still count as what the translator confirmed:
  // they join the alignment memory (an index, no boosting), as gatewayEdit
  // does for its trimmed verses. Every confirmed alignment informs a
  // prediction; only the booster's fit is bounded.
  for (const v of verses.slice(kept.length)) appendToMemory(model, v);
  return { testament, verses: verses.length, boosted: kept.length, model };
};

/**
 * One whole-verse suggestion for the open verse, given the links already
 * placed as context. A boosted model predicts through the booster; a
 * memory-only model answers with plain `WordMap.predict` on the same memory
 * (#516) — the boosted path on an unfitted booster would throw [VERIFIED —
 * uw-wordmapbooster 1.0.5 model_score on a null jlboost_model]. A model with
 * nothing in memory proposes nothing.
 */
export const predictLinks = (trained: TrainedModel, input: SessionInput): RawLink[] => {
  if (!trained.verses) return [];
  const source = tokens(input.source);
  const target = tokens(input.target);
  const suggestions = trained.boosted
    ? trained.model.predict(source, target, 1, input.manual.map((l) => alignment(source, target, l)))
    : wordMapOf(trained.model).predict(source, target, 1);
  const out: RawLink[] = [];
  for (const s of suggestions) {
    for (const p of s.getPredictions()) {
      const a = p.alignment;
      out.push({
        source: a.sourceNgram.getTokens().map((t) => t.position),
        target: a.targetNgram.getTokens().map((t) => t.position),
        confidence: p.confidence,
      });
    }
  }
  return out;
};
