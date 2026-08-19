import * as A from '@automerge/automerge';
import crypto from 'node:crypto';
import { sealAction } from '../../../conformance/journal/files.mjs';
import { validateAction } from '../../../conformance/journal/schema.mjs';
import { fold } from '../../../conformance/journal/fold.mjs';

export const FORMAT_VERSION = 1;
export const MAX_BUNDLE_BYTES = 4 * 1024 * 1024;
const ALLOWED_ROOT_KEYS = ['actions', 'projectId', 'schemaVersion'];

export const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

export const canonical = (value, depth = 0) => {
  if (depth > 64) throw new Error('value exceeds canonicalization depth limit');
  if (Array.isArray(value)) return `[${value.map((v) => canonical(v, depth + 1)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key], depth + 1)}`).join(',')}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error('value is not JSON-serializable');
  return encoded;
};

const actorIdFromPublicKey = (publicKey) => {
  const der = crypto.createPublicKey(publicKey).export({ type: 'spki', format: 'der' });
  return sha256(der).slice(0, 32);
};

export const createActor = (actorId, createdAt = '2026-08-19T00:00:00.000Z') => {
  if (!/^[a-z0-9-]{4,32}$/.test(actorId)) throw new Error('invalid actor slug');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const manifest = {
    schemaVersion: FORMAT_VERSION,
    actorId,
    automergeActorId: actorIdFromPublicKey(publicPem),
    publicKey: publicPem,
    createdAt,
  };
  return { manifest, privateKey: privatePem };
};

const signedEnvelope = (payload, privateKey) => {
  const payloadText = canonical(payload);
  const envelope = {
    container: FORMAT_VERSION,
    payload: payloadText,
    sha256: sha256(payloadText),
    signature: crypto.sign(null, Buffer.from(payloadText), privateKey).toString('base64'),
  };
  return canonical(envelope);
};

const parseCanonicalJson = (raw, label) => {
  if (typeof raw !== 'string') throw new Error(`${label} is not text`);
  if (Buffer.byteLength(raw) > MAX_BUNDLE_BYTES) throw new Error(`${label} exceeds ${MAX_BUNDLE_BYTES} bytes`);
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error(`${label} is not JSON`); }
  if (canonical(parsed) !== raw) throw new Error(`${label} is not canonically encoded`);
  return parsed;
};

const decodeBase64 = (value, label) => {
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))
    throw new Error(`${label} is not canonical base64`);
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) throw new Error(`${label} is not canonical base64`);
  return bytes;
};

export const verifyEnvelope = (raw, publicKey) => {
  const outer = parseCanonicalJson(raw, 'envelope');
  if (outer.container !== FORMAT_VERSION || typeof outer.payload !== 'string' ||
      typeof outer.sha256 !== 'string' || typeof outer.signature !== 'string' ||
      Object.keys(outer).sort().join(',') !== 'container,payload,sha256,signature') {
    throw new Error('invalid envelope shape');
  }
  if (sha256(outer.payload) !== outer.sha256) throw new Error('envelope checksum mismatch');
  const ok = crypto.verify(null, Buffer.from(outer.payload), publicKey, decodeBase64(outer.signature, 'signature'));
  if (!ok) throw new Error('envelope signature mismatch');
  return parseCanonicalJson(outer.payload, 'payload');
};

export const createProject = (projectId, creator) => {
  if (!/^[A-Za-z0-9._-]{8,80}$/.test(projectId)) throw new Error('invalid project id');
  let doc = A.init({ actor: creator.manifest.automergeActorId });
  doc = A.change(doc, { message: 'tC4 Automerge root', time: 0 }, (draft) => {
    draft.schemaVersion = FORMAT_VERSION;
    draft.projectId = new A.ImmutableString(projectId);
    draft.actions = {};
  });
  validateDocument(doc, { projectId });
  const bytes = A.save(doc);
  const payload = {
    schemaVersion: FORMAT_VERSION,
    kind: 'root',
    projectId,
    creator: creator.manifest,
    bytes: Buffer.from(bytes).toString('base64'),
    bytesSha256: sha256(bytes),
  };
  return { doc, rootBundle: signedEnvelope(payload, creator.privateKey) };
};

export const loadProject = (rootBundle) => {
  const outer = parseCanonicalJson(rootBundle, 'root envelope');
  const unsignedPayload = parseCanonicalJson(outer.payload, 'root payload');
  const creator = unsignedPayload.creator;
  if (!creator || actorIdFromPublicKey(creator.publicKey) !== creator.automergeActorId)
    throw new Error('root creator key does not match its Automerge actor id');
  const payload = verifyEnvelope(rootBundle, creator.publicKey);
  if (payload.kind !== 'root' || payload.schemaVersion !== FORMAT_VERSION) throw new Error('unsupported root payload');
  const bytes = decodeBase64(payload.bytes, 'root bytes');
  if (sha256(bytes) !== payload.bytesSha256) throw new Error('root document checksum mismatch');
  const doc = A.load(bytes);
  validateDocument(doc, { projectId: payload.projectId });
  return { doc, projectId: payload.projectId, creator: payload.creator };
};

const actionBody = (events) => JSON.parse(sealAction(events)).body;

export const appendActionChange = (doc, events, actor) => {
  if (A.getActorId(doc) !== actor.manifest.automergeActorId)
    doc = A.clone(doc, { actor: actor.manifest.automergeActorId });
  const body = actionBody(events);
  const parsed = JSON.parse(body);
  if (parsed.events.some((event) => event.actor !== actor.manifest.actorId))
    throw new Error('action actor does not match signing actor');
  const key = sha256(body);
  if (doc.actions[key] !== undefined) throw new Error('action is already present');
  const beforeHeads = A.getHeads(doc);
  const time = Math.floor(Date.parse(parsed.events[0].ts.slice(0, 24)) / 1000);
  const next = A.change(doc, { message: `tC4 action ${key}`, time }, (draft) => {
    if (draft.actions[key] !== undefined) return;
    draft.actions[key] = new A.ImmutableString(body);
  });
  const afterHeads = A.getHeads(next);
  if (beforeHeads.length === afterHeads.length && beforeHeads.every((head) => afterHeads.includes(head)))
    throw new Error('action produced no Automerge change');
  const change = A.getLastLocalChange(next);
  if (!change) throw new Error('action produced no local Automerge change');
  const decoded = A.decodeChange(change);
  if (decoded.actor !== actor.manifest.automergeActorId) throw new Error('Automerge actor does not match signer key');
  return { doc: next, change, actionKey: key, changeHash: decoded.hash, createdAt: parsed.events[0].ts.slice(0, 24) };
};

export const appendAction = (doc, events, actor) => {
  const added = appendActionChange(doc, events, actor);
  return { ...added, bundle: bundleChanges(String(added.doc.projectId), actor, [added.change], added.createdAt) };
};

// Production batching accepts only changes emitted locally for the signing Automerge actor.
// Intake still validates every operation and tC4 action independently; this is packaging,
// not a substitute for the hostile-input boundary in applyBundle.
export const bundleChanges = (projectId, actor, changes, createdAt = '2026-08-19T00:00:00.000Z') => {
  if (!Array.isArray(changes) || changes.length === 0) throw new Error('a bundle must contain changes');
  const payload = {
    schemaVersion: FORMAT_VERSION,
    kind: 'changes',
    projectId,
    actorId: actor.manifest.actorId,
    createdAt,
    changes: changes.map((change) => {
      const decoded = A.decodeChange(change);
      if (decoded.actor !== actor.manifest.automergeActorId) throw new Error('cannot sign another Automerge actor\'s change');
      return { hash: decoded.hash, sha256: sha256(change), bytes: Buffer.from(change).toString('base64') };
    }),
  };
  const bundle = signedEnvelope(payload, actor.privateKey);
  if (Buffer.byteLength(bundle) > MAX_BUNDLE_BYTES) throw new Error(`bundle exceeds ${MAX_BUNDLE_BYTES} bytes`);
  return bundle;
};

// The adversarial proof deliberately feeds same-actor changes with forbidden operations
// through the normal signer to prove that intake, rather than a friendly writer, rejects them.
export const unsafeBundleForProof = bundleChanges;

const bodyFromDecodedChange = (doc, decoded) => {
  if (decoded.ops.length !== 1) throw new Error('a tC4 change must contain exactly one operation');
  const op = decoded.ops[0];
  const actionsObjectId = A.getObjectId(doc.actions);
  if (op.action !== 'set' || op.obj !== actionsObjectId || typeof op.key !== 'string' ||
      typeof op.value !== 'string' || (op.pred?.length ?? 0) !== 0) {
    throw new Error('change is not an append-only immutable action insertion');
  }
  if (sha256(op.value) !== op.key) throw new Error('action key does not match action body');
  let parsed;
  try { parsed = JSON.parse(op.value); } catch { throw new Error('action body is not JSON'); }
  const validation = validateAction(parsed.events);
  if (validation) throw new Error(`invalid tC4 action: ${validation}`);
  return { key: op.key, body: op.value, events: parsed.events };
};

export const validateDocument = (doc, { projectId, previous = null } = {}) => {
  if (!A.isAutomerge(doc)) throw new Error('not an Automerge document');
  if (doc.schemaVersion !== FORMAT_VERSION || String(doc.projectId) !== projectId)
    throw new Error('document identity changed');
  if (Object.keys(doc).sort().join(',') !== ALLOWED_ROOT_KEYS.join(',')) throw new Error('unexpected root field');
  if (!doc.actions || typeof doc.actions !== 'object' || !A.getObjectId(doc.actions)) throw new Error('actions map is missing');
  for (const key of ALLOWED_ROOT_KEYS) if (A.getConflicts(doc, key)) throw new Error(`root conflict at ${key}`);
  if (previous) {
    for (const [key, value] of Object.entries(previous.actions)) {
      if (!(key in doc.actions) || String(doc.actions[key]) !== String(value)) throw new Error(`accepted action ${key} changed or disappeared`);
    }
  }
  for (const [key, value] of Object.entries(doc.actions)) {
    if (A.getConflicts(doc.actions, key)) throw new Error(`action conflict at ${key}`);
    if (!A.isImmutableString(value)) throw new Error(`action ${key} is not an immutable string`);
    const body = String(value);
    if (sha256(body) !== key) throw new Error(`action ${key} has a mismatched body hash`);
    let parsed;
    try { parsed = JSON.parse(body); } catch { throw new Error(`action ${key} body is not JSON`); }
    const validation = validateAction(parsed.events);
    if (validation) throw new Error(`action ${key} is invalid: ${validation}`);
  }
  fold(extractEvents(doc));
  return true;
};

export const inspectBundle = (raw, actors) => {
  const outer = parseCanonicalJson(raw, 'change envelope');
  const unsigned = parseCanonicalJson(outer.payload, 'change payload');
  const actor = actors.get(unsigned.actorId);
  if (!actor) throw new Error(`unknown actor ${unsigned.actorId}`);
  if (actorIdFromPublicKey(actor.publicKey) !== actor.automergeActorId) throw new Error('pinned actor key mismatch');
  const payload = verifyEnvelope(raw, actor.publicKey);
  if (payload.schemaVersion !== FORMAT_VERSION || payload.kind !== 'changes' || !Array.isArray(payload.changes) || payload.changes.length === 0)
    throw new Error('unsupported change payload');
  return { payload, actor };
};

export const applyBundle = (accepted, raw, actors) => {
  const acceptedBytes = A.save(accepted);
  try {
    const { payload, actor } = inspectBundle(raw, actors);
    if (payload.projectId !== String(accepted.projectId)) throw new Error('bundle belongs to another project');
    const changes = payload.changes.map((entry) => {
      const bytes = Uint8Array.from(decodeBase64(entry.bytes, 'change bytes'));
      if (sha256(bytes) !== entry.sha256) throw new Error('change checksum mismatch');
      const decoded = A.decodeChange(bytes);
      if (decoded.hash !== entry.hash) throw new Error('declared change hash mismatch');
      if (decoded.actor !== actor.automergeActorId) throw new Error('change actor does not match pinned signer');
      const action = bodyFromDecodedChange(accepted, decoded);
      if (action.events.some((event) => event.actor !== payload.actorId)) throw new Error('event actor does not match signer');
      return bytes;
    });
    const decodedHashes = changes.map((change) => A.decodeChange(change).hash);
    const candidate = A.applyChanges(A.clone(accepted), changes)[0];
    const missing = decodedHashes.filter((hash) => !A.hasHeads(candidate, [hash]));
    if (missing.length) return { status: 'pending', accepted, missing };
    validateDocument(candidate, { projectId: payload.projectId, previous: accepted });
    return { status: A.getHeads(candidate).every((head) => A.getHeads(accepted).includes(head)) ? 'duplicate' : 'accepted', accepted: candidate, missing: [] };
  } catch (error) {
    if (!Buffer.from(A.save(accepted)).equals(Buffer.from(acceptedBytes))) throw new Error('accepted document mutated during rejected intake');
    return { status: 'rejected', accepted, reason: error.message };
  }
};

export const extractEvents = (doc) => Object.entries(doc.actions)
  .sort(([a], [b]) => a.localeCompare(b))
  .flatMap(([, body]) => JSON.parse(String(body)).events);

export const historyView = (doc) => extractEvents(doc)
  .map((event) => ({ actor: event.actor, when: event.ts.slice(0, 24), operation: event.op, event }))
  .sort((a, b) => a.event.ts.localeCompare(b.event.ts));

export const replayBundles = (rootBundle, bundles, actors) => {
  let { doc } = loadProject(rootBundle);
  let pending = [...bundles];
  let progress = true;
  const rejected = [];
  while (pending.length && progress) {
    progress = false;
    const next = [];
    for (const bundle of pending) {
      const result = applyBundle(doc, bundle, actors);
      if (result.status === 'accepted' || result.status === 'duplicate') {
        doc = result.accepted;
        progress = progress || result.status === 'accepted';
      } else if (result.status === 'rejected') rejected.push(result.reason);
      else next.push(bundle);
    }
    pending = next;
  }
  return { doc, pending, rejected };
};

export const bundleInfo = (raw, actors) => inspectBundle(raw, actors).payload;
