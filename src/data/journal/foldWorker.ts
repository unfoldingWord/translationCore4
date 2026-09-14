// foldWorker.ts — the §8.6 fold, off the main thread (issue #94).
//
// Holds the mirror of one store's event set and folds it on request. Messages
// are handled in arrival order, so a reply is the fold of the mirror as the
// store described it in that request. The fold's own refusal (a corrupt or
// malformed union) travels back as `error`, never as a dead worker.
import type { JournalEvent } from './seal';
import { fold } from './runtime';
import type { FoldReply, FoldRequest } from './foldRunner';

let events: JournalEvent[] = [];

const scope = self as unknown as { onmessage: ((event: { data: FoldRequest }) => void) | null; postMessage(reply: FoldReply): void };

scope.onmessage = ({ data }) => {
  if ('events' in data) events = data.events;
  else events.push(...data.append);
  try {
    scope.postMessage({ id: data.id, result: fold(events) });
  } catch (error) {
    scope.postMessage({ id: data.id, error: String((error as Error)?.message ?? error) });
  }
};
