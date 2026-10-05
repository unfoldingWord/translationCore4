// #516 — the hand-over of a trained model between the two suggestion workers.
//
// Training runs in its own worker (suggestTrainWorker.ts), so the worker that
// answers Suggest (suggestWorker.ts) is never busy with it. The trained model
// crosses as plain data (packModel → postMessage → unpackModel).
//
// The ways this can fail, written before the code:
//   1. The rebuilt model predicts differently from the model that was trained.
//   2. The packed model does not survive the structured clone of postMessage.
//   3. A memory-only model (no booster) does not survive the hand-over.
//   4. Suggest waits for a training that runs at the same time.
// Cases 1-3 are checked in-process. Case 4 runs the two real worker files in
// two real threads with the unmocked engine.
import { describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { packModel, predictLinks, trainModel, unpackModel } from '../src/data/align/suggestEngine';
import { versesOfBook } from './helpers/ult-corpus';

const fs = process.getBuiltinModule('node:fs');
const os = process.getBuiltinModule('node:os');
const path = process.getBuiltinModule('node:path');
const { Worker } = process.getBuiltinModule('node:worker_threads');

const TITUS = versesOfBook('TIT', fs.readFileSync(path.resolve(process.cwd(), 'test/fixtures/en_ult/TIT.usfm'), 'utf8'));
const ask = (v: (typeof TITUS)[number]) => ({ source: v.source, target: v.target, manual: [] });

describe('#516 hand-over — a model rebuilt from its packed form answers like the model that was trained', () => {
  it('boosted model: same predictions after pack, structured clone and unpack', async () => {
    const corpus = TITUS.slice(0, 8);
    const trained = await trainModel('nt', corpus);
    expect(trained.boosted).toBeGreaterThan(0);
    const rebuilt = unpackModel(structuredClone(packModel(trained)), corpus);
    expect(rebuilt.verses).toBe(trained.verses);
    for (const probe of TITUS.slice(12, 18)) {
      const expected = predictLinks(trained, ask(probe));
      expect(expected.length).toBeGreaterThan(0);
      expect(predictLinks(rebuilt, ask(probe))).toEqual(expected);
    }
  }, 120_000);

  it('memory-only model: same predictions after the hand-over', async () => {
    const corpus = TITUS.slice(0, 3);
    const trained = await trainModel('nt', corpus);
    expect(trained.boosted).toBe(0);
    const rebuilt = unpackModel(structuredClone(packModel(trained)), corpus);
    const probe = TITUS[5];
    expect(predictLinks(rebuilt, ask(probe))).toEqual(predictLinks(trained, ask(probe)));
  });
});

/** One of the two worker files, bundled and started in a real thread. The
 * banner gives the file the `postMessage` a Web Worker has; the footer feeds
 * it the thread's messages. */
async function startWorker(entry: string, dir: string) {
  const outfile = path.join(dir, `${path.basename(entry, '.ts')}.cjs`);
  await build({
    entryPoints: [path.resolve(process.cwd(), entry)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
    banner: { js: "const { parentPort } = require('node:worker_threads'); globalThis.postMessage = (m) => parentPort.postMessage(m);" },
    footer: { js: 'parentPort.on("message", (data) => globalThis.onmessage({ data }));' },
  });
  return new Worker(outfile);
}

describe('#516 two workers — Suggest is answered while a real training runs', () => {
  it('the answering worker replies before the training worker finishes its fit', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc4-suggest-workers-'));
    const answering = await startWorker('src/data/align/suggestWorker.ts', dir);
    const training = await startWorker('src/data/align/suggestTrainWorker.ts', dir);
    try {
      const order: string[] = [];
      const next = (w: InstanceType<typeof Worker>, type: string) =>
        new Promise<Record<string, unknown>>((resolve, reject) => {
          const on = (m: Record<string, unknown>) => {
            if (m.type === 'error') reject(new Error(String(m.message)));
            if (m.type !== type) return;
            w.off('message', on);
            order.push(type);
            resolve(m);
          };
          w.on('message', on);
        });

      // The standing model: three saved verses, memory-only.
      for (const [i, verse] of TITUS.slice(0, 3).entries()) {
        const appended = next(answering, 'appended');
        answering.postMessage({ type: 'append', id: i + 1, testament: 'nt', verse });
        await appended;
      }
      order.length = 0;

      // A real, unmocked training starts in its own thread…
      const corpus = TITUS.slice(0, 14);
      const fitted = next(training, 'fitted');
      training.postMessage({ type: 'train', id: 10, testament: 'nt', verses: corpus });
      // …and Suggest is asked while it runs.
      const suggestions = next(answering, 'suggestions');
      answering.postMessage({ type: 'suggest', id: 11, testament: 'nt', input: ask(TITUS[1]), ref: '1:2', session: 1 });
      expect(((await suggestions).links as unknown[]).length).toBeGreaterThan(0);
      const model = (await fitted).model;
      expect(order).toEqual(['suggestions', 'fitted']); // answered by the standing model, before the fit ended

      // The fitted model then replaces the standing one and answers.
      const trained = next(answering, 'trained');
      answering.postMessage({ type: 'load', id: 10, testament: 'nt', model, verses: corpus });
      expect(await trained).toMatchObject({ verses: 14, boosted: true });
      const after = next(answering, 'suggestions');
      answering.postMessage({ type: 'suggest', id: 12, testament: 'nt', input: ask(TITUS[35]), ref: '3:5', session: 1 });
      expect(((await after).links as unknown[]).length).toBeGreaterThan(0);
    } finally {
      await answering.terminate();
      await training.terminate();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 300_000);
});
