// SaveScheduler — the autosave pipeline (arch §7.3, FR-6/FR-32; checklist
// C1a.4/C1a.5). The dirty-verse buffer flushes on verse blur OR idle debounce
// (default 2000 ms). The save indicator binds to the ACTUAL write promise
// (PRD §7) — never optimistic. Writes are per-book whole-file: the write fn
// receives the spliced whole-book string. The splice function is injected so
// this module stays pure and testable; `.bak`/no_bak semantics (W-3, platform note
// #8) belong to the store behind `writeBook`, not here.

export type SaveState = 'saved' | 'saving' | 'dirty' | 'error';

export type SpliceFn = (
  rawBook: string,
  chapter: string | number,
  verseKey: string,
  newBody: string,
) => string;

/** Writes one key's snapshot. MAY return a replacement string (round 24):
 * a writer that REFUSES a snapshot (e.g. the note writer refusing an empty
 * value, G1) reports the value that is actually durable instead — the
 * scheduler adopts it as `persisted`, and as `current` too when nothing newer
 * was staged meanwhile, so the buffer never claims a refused snapshot was
 * saved. A void return means the snapshot itself was persisted. */
export type WriteBookFn = (book: string, usfm: string) => Promise<void | string>;

/** The retained payload of a failed write (FR-32: keep the buffer, offer retry). */
export interface SaveFailure {
  book: string;
  /** The exact whole-book string whose write failed. */
  usfm: string;
  error: unknown;
}

export interface Clock {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

export interface SaveSchedulerOptions {
  writeBook: WriteBookFn;
  splice: SpliceFn;
  /** Idle debounce before an autosave flush. Default 2000 ms (arch §7.3). */
  debounceMs?: number;
  /** Injectable for tests; defaults to the global timers. */
  clock?: Clock;
}

const defaultClock: Clock = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as Parameters<typeof clearTimeout>[0]),
};

export class SaveScheduler {
  private readonly writeBook: WriteBookFn;
  private readonly splice: SpliceFn;
  private readonly debounceMs: number;
  private readonly clock: Clock;

  /** Current in-memory text per book, edits applied (the dirty buffer). */
  private readonly current = new Map<string, string>();
  /** Last text known written (or loaded) per book. dirty ⇔ current ≠ persisted. */
  private readonly persisted = new Map<string, string>();

  private timer: unknown = null;
  private chain: Promise<void> = Promise.resolve();
  private writing = 0;
  private failure: SaveFailure | null = null;
  private readonly listeners = new Set<(state: SaveState) => void>();
  private lastNotified: SaveState | null = null;

  constructor(options: SaveSchedulerOptions) {
    this.writeBook = options.writeBook;
    this.splice = options.splice;
    this.debounceMs = options.debounceMs ?? 2000;
    this.clock = options.clock ?? defaultClock;
  }

  /** Seed a book's raw text (from the store read). Resets its dirty state.
   *
   * Guard (review findings B3/M1, 2026-07-30): loading over unsaved work is
   * how stale bytes resurrect — a re-read of pre-write disk bytes followed by
   * loadBook makes the scheduler see the OLD text as dirty and write it over
   * the newer save; loading over a retained failure silently discards the
   * user's failed edits. Callers must drain() first; this throws rather than
   * lose text. */
  loadBook(book: string, rawBook: string): void {
    if (this.failure) {
      throw new Error(
        `SaveScheduler: refusing to load "${book}" over a retained failed write for "${this.failure.book}" — retry or resolve first`,
      );
    }
    if (this.writing > 0 || this.dirtyBooks().length > 0) {
      throw new Error(
        `SaveScheduler: refusing to load "${book}" over unsaved work (drain() first)`,
      );
    }
    this.current.set(book, rawBook);
    this.persisted.set(book, rawBook);
    this.notify();
  }

  /** Bring the scheduler to rest: flush dirty work (retrying a retained
   * failure once) and await the whole write chain. Resolves true when
   * everything is on disk; false when a failure remains (FR-32: the buffer is
   * retained, the error stays visible — callers must not navigate away from
   * it silently). */
  async drain(): Promise<boolean> {
    if (this.failure) {
      await this.retry();
    } else {
      await this.flush();
    }
    return this.failure === null && this.dirtyBooks().length === 0;
  }

  /** Detach every listener and cancel the pending debounce (project switch —
   * review finding M6: a replaced scheduler must not keep dispatching into
   * the new project's indicator). In-flight writes still settle. */
  dispose(): void {
    if (this.timer !== null) {
      this.clock.clearTimeout(this.timer);
      this.timer = null;
    }
    this.listeners.clear();
  }

  /** Current in-memory whole-book text (edits applied), or null if not loaded. */
  bookText(book: string): string | null {
    return this.current.get(book) ?? null;
  }

  /** Seed a key only when it is ABSENT — never touches existing state, so the
   * unsaved-work hazard loadBook's B3/M1 guard exists for cannot arise, and
   * seeding one key while another is dirty is safe. The comprehension-note
   * scheduler seeds each target lazily on its first edit (D65): the stored
   * note becomes `persisted`, so a revert-to-stored compares clean. */
  seedIfAbsent(book: string, rawBook: string): void {
    if (this.current.has(book)) return;
    this.current.set(book, rawBook);
    this.persisted.set(book, rawBook);
  }

  /** Record one verse edit. Applies the splice to the in-memory text at once
   * (the splice engine stays the only mutation path) and arms the debounce.
   * Throws if the book was never loaded, and propagates the splice engine's
   * VerseNotFoundError for a verse the book does not contain. */
  markDirty(book: string, chapter: string | number, verseKey: string, newBody: string): void {
    const raw = this.current.get(book);
    if (raw === undefined) throw new Error(`SaveScheduler: book not loaded: ${book}`);
    this.current.set(book, this.splice(raw, chapter, verseKey, newBody));
    this.armDebounce();
    this.notify();
  }

  /** Explicit flush (verse blur). Cancels the debounce; resolves when the
   * write settles. Never rejects — a failure surfaces as state 'error'. */
  flushOnBlur(): Promise<void> {
    return this.flush();
  }

  /** Re-attempt after a failed write. Clears the failure, then flushes the
   * retained dirty buffer (which still holds the failed edits, plus any made
   * since). */
  retry(): Promise<void> {
    this.failure = null;
    return this.flush();
  }

  getState(): SaveState {
    if (this.writing > 0) return 'saving';
    if (this.failure) return 'error';
    if (this.dirtyBooks().length > 0) return 'dirty';
    return 'saved';
  }

  /** The failed payload, retained until retry() (FR-32). */
  getFailure(): SaveFailure | null {
    return this.failure;
  }

  /** Subscribe the save indicator. Calls back immediately with the current
   * state, then on every state transition. Returns an unsubscribe fn. */
  subscribe(listener: (state: SaveState) => void): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private dirtyBooks(): string[] {
    const books: string[] = [];
    for (const [book, text] of this.current) {
      if (this.persisted.get(book) !== text) books.push(book);
    }
    return books;
  }

  private armDebounce(): void {
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = this.clock.setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.debounceMs);
  }

  private flush(): Promise<void> {
    if (this.timer !== null) {
      this.clock.clearTimeout(this.timer);
      this.timer = null;
    }
    // Serialize flushes: a flush requested while a write is in flight runs
    // after it, against the then-current buffer.
    this.chain = this.chain.then(() => this.writeDirty());
    return this.chain;
  }

  private async writeDirty(): Promise<void> {
    // After a failure the scheduler holds state 'error' and does not write
    // again on its own — retry() is the only way out (FR-32: the error stays
    // visible; autosave must not hammer a failing store).
    if (this.failure) return;
    const books = this.dirtyBooks();
    if (books.length === 0) {
      this.notify();
      return;
    }
    this.writing += 1;
    this.notify(); // 'saving' — held until the actual write promise settles
    try {
      for (const book of books) {
        const snapshot = this.current.get(book) as string;
        try {
          const replacement = await this.writeBook(book, snapshot);
          if (typeof replacement === 'string' && replacement !== snapshot) {
            // Round 24: the writer REFUSED this snapshot and reported the
            // durable value instead. Recording the refused snapshot as
            // persisted would make the buffer claim 'saved' while disagreeing
            // with the store (a blank box over a durable note, and a
            // duplicate append on retype). Adopt the durable value — and as
            // `current` too, unless something newer was staged meanwhile.
            this.persisted.set(book, replacement);
            if (this.current.get(book) === snapshot) this.current.set(book, replacement);
          } else {
            // Edits made during the write keep the book dirty (current moved on).
            this.persisted.set(book, snapshot);
          }
        } catch (error) {
          this.failure = { book, usfm: snapshot, error };
          break;
        }
      }
    } finally {
      this.writing -= 1;
      this.notify();
    }
  }

  private notify(): void {
    const state = this.getState();
    if (state === this.lastNotified) return;
    this.lastNotified = state;
    for (const listener of this.listeners) listener(state);
  }
}
