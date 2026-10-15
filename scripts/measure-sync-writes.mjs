// D101 point 6 (#676): the cost of one apply write. Times N sequential writes, the
// request the sync apply makes for each file (ServerApi.writeIngredient: one POST
// per file, no ingredients update, no .bak). It writes N files into REPO, so run it
// only against a seeded rig, then reseed. Usage:
//   node scripts/measure-sync-writes.mjs [BASE] [N] [REPO]
// Result of 2026-10-14 (pankosmia-web 0.18.15, a83725b; rig on an Apple M2 Pro):
// three runs of 1000 writes of about 1 KB took 372 ms, 426 ms and 325 ms.
const BASE = process.argv[2] ?? 'http://127.0.0.1:19676/api';
const N = Number(process.argv[3] ?? 1000);
const REPO = process.argv[4] ?? '_local_/_local_/sample_burrito';
const payload = JSON.stringify({ container: 1, body: 'x'.repeat(900), sha256: '0'.repeat(64) }); // about a journal segment
const started = performance.now();
for (let i = 0; i < N; i += 1) {
  const ipath = `checking/journal/measure0001/segments/m${String(i).padStart(5, '0')}.action.json`;
  const r = await fetch(`${BASE}/burrito/ingredient/raw/${REPO}?ipath=${ipath}&no_bak`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payload }),
  });
  const body = await r.json();
  if (!body.is_good) throw new Error(`write ${i} failed: ${JSON.stringify(body)}`);
}
const ms = performance.now() - started;
console.log(JSON.stringify({ writes: N, bytesEach: payload.length, totalMs: Math.round(ms), perWriteMs: +(ms / N).toFixed(2), writesPerSecond: Math.round((N / ms) * 1000) }));
