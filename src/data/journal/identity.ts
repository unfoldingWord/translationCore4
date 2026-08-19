// Installation secret + per-project actor identity — BURRITO-SPEC §8.1 (R-8.1.11),
// D50 (actor ownership binds to an installation secret, never a hardware
// fingerprint), D53(c) (actor identity is scoped PER PROJECT).
//
// The installation secret is 32 random bytes, hex-encoded, minted once and kept in
// installation-local storage (IndexedDB — never a project file, never committed,
// never logged). It does not leave this module: callers get derived actor ids only.
//
// THE DERIVATION IS THE D50 BINDING. actorId = 'a' + first 15 hex chars of
// HMAC-SHA-256(secret, repoPath). The device proves ownership of an actor stream by
// RECOMPUTING the id from its secret — there is no separate binding-hash field in
// actor.json, so the R-8.1.13 schema stays closed. The HMAC is one-way: the id
// reveals nothing of the secret.
//
// repoPath is the PROJECT KEY (D53c): reopening the same path derives the same id;
// a copied or re-imported project (a different path) derives a DIFFERENT id. That
// is the point — one installation working in two projects holds two actor
// identities, so merging two of one's own projects reads as two actors (a visible
// fork), never as one actor's linear history silently discarding one side (§8.6).

/** Installation-local key/value storage, injected so tests use a Map-backed fake.
 * The outbox (journalStore.ts) shares this store: `keys` scans staged intents by
 * prefix and `delete` clears one after a confirmed accept. */
export interface KvStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  /** ATOMIC get-or-create: store `value` only when `key` is absent, and return
   * the value that is stored afterwards — the WINNER. Competing callers all get
   * the same answer, so a get-or-create is never a read-check-write across two
   * transactions (review finding F1, 2026-08-19: that race split the
   * installation's identity). An implementation MUST decide and write inside ONE
   * serialized unit. */
  setIfAbsent(key: string, value: string): Promise<string>;
  /** All stored keys that start with `prefix`, in no guaranteed order. */
  keys(prefix: string): Promise<string[]>;
  delete(key: string): Promise<void>;
}

const DB_NAME = 'tc4-installation';
const STORE_NAME = 'kv';

const kvStores = new Map<string, KvStore>();

/** Browser KvStore over IndexedDB (object store 'kv' of `dbName`, default
 * 'tc4-installation'). No npm dependency: the raw IDB API is small enough to
 * wrap here.
 *
 * MEMOIZED per database name (review finding F1): every caller in this process
 * shares ONE store object, so the in-process work of one database is never
 * split over two independent objects. */
export const idbKvStore = (dbName: string = DB_NAME): KvStore => {
  const memoized = kvStores.get(dbName);
  if (memoized) return memoized;
  const store = makeIdbKvStore(dbName);
  kvStores.set(dbName, store);
  return store;
};

const makeIdbKvStore = (dbName: string): KvStore => {
  let dbPromise: Promise<IDBDatabase> | null = null;
  const db = (): Promise<IDBDatabase> => {
    dbPromise ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE_NAME);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error(`indexedDB.open(${dbName}) failed`));
    });
    return dbPromise;
  };
  const op = async <T>(
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> => {
    const database = await db();
    return new Promise<T>((resolve, reject) => {
      const request = fn(database.transaction(STORE_NAME, mode).objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
    });
  };
  return {
    // ONE readwrite transaction decides and writes: IndexedDB serializes
    // overlapping readwrite transactions on the same object store, so a
    // competing minter either reads the stored value or waits for this one to
    // commit — it can never observe "absent" and write a second value (F1).
    setIfAbsent: (key, value) =>
      db().then(
        (database) =>
          new Promise<string>((resolve, reject) => {
            const transaction = database.transaction(STORE_NAME, 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const read = store.get(key);
            const fail = (error: unknown): void =>
              reject(error instanceof Error ? error : new Error('IndexedDB request failed'));
            transaction.onabort = () => fail(transaction.error);
            read.onerror = () => fail(read.error);
            read.onsuccess = () => {
              const found: unknown = read.result;
              if (typeof found === 'string') {
                resolve(found);
                return;
              }
              const write = store.put(value, key);
              write.onerror = () => fail(write.error);
              write.onsuccess = () => resolve(value);
            };
          }),
      ),
    get: (key) =>
      op<unknown>('readonly', (store) => store.get(key)).then((value) =>
        typeof value === 'string' ? value : undefined,
      ),
    set: (key, value) => op('readwrite', (store) => store.put(value, key)).then(() => undefined),
    keys: (prefix) =>
      op<IDBValidKey[]>('readonly', (store) =>
        // '￿' sorts after every code unit a key may carry — the standard
        // IDB prefix-range idiom.
        store.getAllKeys(IDBKeyRange.bound(prefix, `${prefix}￿`)),
      ).then((found) => found.map(String)),
    delete: (key) => op('readwrite', (store) => store.delete(key)).then(() => undefined),
  };
};

const SECRET_KEY = 'installation-secret';

const toHex = (bytes: Uint8Array): string =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');

/** Get-or-create the installation secret: 32 bytes via crypto.getRandomValues,
 * hex-encoded, stored once. Module-internal — callers derive actor ids only.
 *
 * The mint goes through `setIfAbsent`, which decides and writes in ONE
 * serialized unit, so two concurrent first-run callers settle on ONE secret and
 * therefore ONE actor id per project. An earlier version memoized the
 * get-or-create per KvStore object and claimed that made it in-process safe; it
 * did not — `idbKvStore()` returned a NEW object per call, so two callers held
 * two memos over one database and minted two secrets (review finding F1). The
 * fresh random bytes of a losing minter are simply dropped. */
const getInstallationSecret = async (kv: KvStore): Promise<string> => {
  const existing = await kv.get(SECRET_KEY);
  if (existing !== undefined) return existing;
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return kv.setIfAbsent(SECRET_KEY, toHex(bytes));
};

/** The §8.1 actor-slug grammar the derived id must satisfy (R-8.1.11). Stated
 * here for the derivation's own postcondition check; the one authoritative copy
 * is conformance/journal/grammar.mjs ACTOR_RE. */
const ACTOR_SLUG_RE = /^[a-z0-9-]{4,32}$/;

/** Derive the per-project actor id: 'a' + the first 15 hex chars of
 * HMAC-SHA-256(key: secret, message: repoPath). 16 chars total, starts with a
 * letter, well inside the §8.1 slug grammar. Deterministic (same secret + same
 * repoPath = same id), project-scoped (different repoPath = different id, D53c),
 * and one-way (HMAC — the id exposes nothing of the secret). */
export const deriveActorId = async (secret: string, repoPath: string): Promise<string> => {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(repoPath)));
  const actorId = `a${toHex(mac).slice(0, 15)}`;
  if (!ACTOR_SLUG_RE.test(actorId)) {
    // Unreachable by construction ('a' + 15 hex chars); kept as a postcondition
    // so a future edit cannot silently emit a non-slug into directory names.
    throw new Error(`derived actor id ${JSON.stringify(actorId)} is not an §8.1 slug`);
  }
  return actorId;
};

/** The actor id this installation holds for one project (D53c). The secret is
 * created on first use and never returned. */
export const actorIdFor = async (kv: KvStore, repoPath: string): Promise<string> =>
  deriveActorId(await getInstallationSecret(kv), repoPath);
