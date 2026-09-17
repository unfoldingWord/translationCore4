import { SaveScheduler } from './saveScheduler';

export type StoryUnit =
  | { kind: 'title'; story: number }
  | { kind: 'frame'; story: number; frame: number }
  | { kind: 'ref'; story: number };

export const storyUnitKey = (unit: StoryUnit): string => {
  if (unit.kind === 'title') return `story|${unit.story}|title`;
  if (unit.kind === 'ref') return `story|${unit.story}|ref`;
  return `story|${unit.story}|frame|${unit.frame}`;
};

/** Match the journal writer's boundary normalization without importing a
 * Node-facing implementation into the browser view. */
export const normalizeStoryUnit = (unit: StoryUnit, text: string): string => {
  const nfc = String(text).normalize('NFC').replace(/\r/g, '');
  if (unit.kind === 'frame') {
    return nfc.split('\n').filter((line) => line.trim() !== '').join('\n');
  }
  return nfc.trim();
};

export interface StorySchedulerOptions {
  write: (unit: StoryUnit, text: string) => Promise<void>;
  debounceMs?: number;
  clock?: ConstructorParameters<typeof SaveScheduler>[0]['clock'];
}

/** SaveScheduler's whole-book buffer is also a good unit buffer. This adapter
 * gives each title/frame/reference its own key while retaining the established
 * debounce, drain, retry and retained-failure guarantees. */
export class StoryScheduler {
  private readonly targets = new Map<string, StoryUnit>();
  private readonly scheduler: SaveScheduler;

  constructor(options: StorySchedulerOptions) {
    this.scheduler = new SaveScheduler({
      debounceMs: options.debounceMs,
      clock: options.clock,
      splice: (_raw, _chapter, _verse, next) => next,
      writeBook: async (key, text) => {
        const unit = this.targets.get(key);
        if (!unit) throw new Error(`StoryScheduler: unknown unit ${key}`);
        const normalized = normalizeStoryUnit(unit, text);
        await options.write(unit, normalized);
        return normalized;
      },
    });
  }

  seed(unit: StoryUnit, text: string): void {
    const key = storyUnitKey(unit);
    this.targets.set(key, unit);
    this.scheduler.seedIfAbsent(key, text);
  }

  markDirty(unit: StoryUnit, text: string): void {
    const key = storyUnitKey(unit);
    if (!this.targets.has(key)) this.targets.set(key, unit);
    this.scheduler.seedIfAbsent(key, text);
    this.scheduler.markDirty(key, '', '', text);
  }

  value(unit: StoryUnit): string | null {
    return this.scheduler.bookText(storyUnitKey(unit));
  }

  isDirty(unit: StoryUnit): boolean {
    return this.scheduler.isDirty(storyUnitKey(unit));
  }

  flushOnBlur(): Promise<void> { return this.scheduler.flushOnBlur(); }
  drain(): Promise<boolean> { return this.scheduler.drain(); }
  retry(): Promise<void> { return this.scheduler.retry(); }
  dispose(): void { this.scheduler.dispose(); }
  getState(): ReturnType<SaveScheduler['getState']> { return this.scheduler.getState(); }
  getFailure(): ReturnType<SaveScheduler['getFailure']> { return this.scheduler.getFailure(); }
  subscribe(listener: Parameters<SaveScheduler['subscribe']>[0]): () => void { return this.scheduler.subscribe(listener); }
}
