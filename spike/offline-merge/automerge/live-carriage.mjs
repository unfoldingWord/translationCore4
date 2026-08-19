import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { appendAction, appendActionChange, bundleChanges, canonical, createActor, createProject, sha256 } from './model.mjs';
import { makeClock } from '../../../conformance/journal/hlc.mjs';

const API = process.env.RIG_API || 'http://127.0.0.1:19998/api';
const REPOS = process.env.RIG_REPOS || path.resolve(new URL('../../../../dev-env/state/work/repos', import.meta.url).pathname);
const SRC = '_local_/_local_/sample_burrito';
const PROJECT = '_local_/_local_/automerge_carriage';
const REIMPORT = '_local_/_sideloaded_/automerge_carriage_reimport';
const dirOf = (repo) => path.join(REPOS, ...repo.split('/'));
const request = async (route, options = {}) => {
  const response = await fetch(`${API}${route}`, options);
  return response;
};
const postJson = (route, body) => request(route, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
});
const writeIngredient = (ipath, payload) => postJson(`/burrito/ingredient/raw/${PROJECT}?ipath=${encodeURIComponent(ipath)}&update_ingredients&no_bak`, { payload });
const readIngredient = async (repo, ipath) => {
  const response = await request(`/burrito/ingredient/raw/${repo}?ipath=${encodeURIComponent(ipath)}`);
  return { status: response.status, text: await response.text() };
};

for (const repo of [PROJECT, REIMPORT]) fs.rmSync(dirOf(repo), { recursive: true, force: true });
try {
  const versionResponse = await request('/version');
  assert.equal(versionResponse.status, 200);
  const rigVersion = await versionResponse.json();
  const copied = await postJson(`/git/copy/${SRC}?target_path=${encodeURIComponent(PROJECT)}`);
  assert.equal(copied.status, 200);

  const actor = createActor('live-actor');
  const project = createProject('tc4-live-carriage', actor);
  const added = appendAction(project.doc, [{
    v: 1, op: 'settings.set', actor: actor.manifest.actorId,
    ts: '2026-08-19T12:00:00.000Z|0000|live-actor', base: null, path: 'ui.liveCarriage', value: true,
  }], actor);
  let packedDoc = added.doc;
  let now = Date.parse('2026-08-19T12:00:01.000Z');
  const clock = makeClock(actor.manifest.actorId, () => now);
  const packedChanges = [];
  for (let i = 0; i < 3500; i++) {
    now += 1;
    const packed = appendActionChange(packedDoc, [{
      v: 1, op: 'settings.set', actor: actor.manifest.actorId, ts: clock.issue(), base: null,
      path: `transportProbe.k${i}`, value: i,
    }], actor);
    packedDoc = packed.doc; packedChanges.push(packed.change);
  }
  const largeBundle = bundleChanges(String(packedDoc.projectId), actor, packedChanges);
  assert.ok(Buffer.byteLength(largeBundle) > 2 * 1024 * 1024 && Buffer.byteLength(largeBundle) < 4 * 1024 * 1024);
  const files = new Map([
    ['checking/journal/automerge/root.bundle.json', project.rootBundle],
    [`checking/journal/automerge/actors/${actor.manifest.actorId}.json`, canonical(actor.manifest)],
    [`checking/journal/automerge/segments/${actor.manifest.actorId}/${sha256(added.bundle)}.bundle.json`, added.bundle],
    [`checking/journal/automerge/segments/${actor.manifest.actorId}/${sha256(largeBundle)}.bundle.json`, largeBundle],
  ]);
  for (const [ipath, bytes] of files) assert.equal((await writeIngredient(ipath, bytes)).status, 200);
  assert.equal((await postJson(`/burrito/metadata/remake-ingredients/${PROJECT}`)).status, 200);
  assert.equal((await postJson(`/git/add-and-commit/${PROJECT}`, { commit_message: 'Automerge carriage proof' })).status, 200);
  for (const [ipath, bytes] of files) {
    const got = await readIngredient(PROJECT, ipath);
    assert.equal(got.status, 200); assert.equal(got.text, bytes);
  }

  const exported = await request(`/burrito/zipped/${PROJECT}`);
  assert.equal(exported.status, 200);
  const zip = await exported.arrayBuffer();
  const form = new FormData();
  form.append('file', new Blob([zip], { type: 'application/zip' }), 'automerge-carriage.zip');
  const imported = await request(`/burrito/zipped/${REIMPORT}`, { method: 'POST', body: form });
  assert.equal(imported.status, 200, await imported.text());
  for (const [ipath, bytes] of files) {
    const got = await readIngredient(REIMPORT, ipath);
    assert.equal(got.status, 200); assert.equal(got.text, bytes);
  }
  console.log(JSON.stringify({ status: 'PASS', rigVersion, files: files.size, largestBundleBytes: Buffer.byteLength(largeBundle), exportedZipBytes: zip.byteLength, routes: ['ingredient/raw', 'metadata/remake-ingredients', 'git/add-and-commit', 'burrito/zipped export', 'burrito/zipped import'] }));
} finally {
  for (const repo of [PROJECT, REIMPORT]) fs.rmSync(dirOf(repo), { recursive: true, force: true });
}
