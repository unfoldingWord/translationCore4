// suggestEngine.ts — the wordMAP + uw-wordmapbooster engine behind alignment
// suggestions (#1, D72 point 3). Runs inside suggestWorker.ts; imported
// directly by the unit tests. gatewayEdit's `enhanced-word-aligner-rcl` is the
// reference for HOW (owner ruling 2026-08-13): its model class, hyper-
// parameters and defaults are adopted as-is [VERIFIED — enhanced-word-aligner-rcl
// 1.4.8 dist/workers/utils/AlignmentTrainerUtils.js createTrainedWordAlignerModel;
// dist/common/constants.js; 2026-09-12]: `MorphJLBoostWordMap`, sourceNgramLength 3,
// targetNgramLength 5, train_steps 1000, `add_alignments_2`, one whole-verse
// suggestion (maxSuggestions 1), no confidence cut, training bounded by a
// complexity cap (100 000 for the NT model, 50 000 for the OT model).
//
// One instance per testament: the alignment memory generalizes through the
// shared original-language text, and Hebrew memory cannot inform a Greek verse.
import { MorphJLBoostWordMap, updateTokenLocations } from 'uw-wordmapbooster';
import { Alignment, Ngram } from 'wordmap';
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

export interface TrainedModel {
  testament: Testament;
  /** Verses the model learned from (all of them sit in its alignment memory);
   * 0 when it could not be trained. */
  verses: number;
  /** The subset the booster was fitted on — the complexity cap's share. */
  boosted?: number;
  /** True when the corpus had aligned verses but the booster could not fit
   * them (too few for its correct/incorrect split) — "align more first". */
  tooFew?: boolean;
  model: MorphJLBoostWordMap;
}

/**
 * Train one testament's model on the project's confirmed alignments.
 * `add_alignments_2` (gatewayEdit's choice) boosts on the second half of the
 * verses over memory of the first; with ONE aligned verse that half is empty
 * and the booster reads `xy_data[0]` of nothing [VERIFIED — uw-wordmapbooster
 * 1.0.5, JLBoost.train, on the rig's seeded project 2026-09-12]. One verse
 * therefore boosts over all of it (`add_alignments_3`), and a corpus the
 * booster still cannot fit reports `tooFew` instead of throwing.
 */
export const trainModel = async (testament: Testament, verses: TrainingVerse[]): Promise<TrainedModel> => {
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
  if (!kept.length) return { testament, verses: 0, model };
  try {
    if (kept.length >= 2) await model.add_alignments_2(source, target, alignments);
    else await model.add_alignments_3(source, target, alignments);
  } catch {
    return { testament, verses: 0, tooFew: true, model };
  }
  // The verses the cap left out still count as what the translator confirmed:
  // they join the alignment memory (an index, no boosting), as gatewayEdit
  // does for its trimmed verses. Every confirmed alignment informs a
  // prediction; only the booster's fit is bounded.
  const wordMap = (model as unknown as { wordMap: { appendAlignmentMemory: (a: Alignment | Alignment[]) => void } }).wordMap;
  for (const v of verses.slice(kept.length)) {
    const s = tokens(v.source);
    const t = tokens(v.target);
    wordMap.appendAlignmentMemory(v.links.map((l) => alignment(s, t, l)));
  }
  return { testament, verses: verses.length, boosted: kept.length, model };
};

/**
 * One whole-verse suggestion for the open verse, given the links already
 * placed as context. An untrained model has no boosted scorer and cannot
 * predict [VERIFIED — uw-wordmapbooster 1.0.5 model_score on a null
 * jlboost_model throws]; the caller never asks it (a project with no
 * alignments has no suggestions).
 */
export const predictLinks = (trained: TrainedModel, input: SessionInput): RawLink[] => {
  if (!trained.verses) return [];
  const source = tokens(input.source);
  const target = tokens(input.target);
  const manual = input.manual.map((l) => alignment(source, target, l));
  const suggestions = trained.model.predict(source, target, 1, manual);
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
