// #378: the desktop help-desk bridge (`tc4Desktop.feedback.send`), faked for the journeys.
import type { BrowserContext } from '@playwright/test';

export interface Answer { ok: boolean; status?: number; reason?: string }

/** The desktop help-desk bridge, faked: each call is recorded, and answered from
 * `answers` in order after `delayMs`. Install before the page loads. */
export async function fakeFeedbackBridge(context: BrowserContext, answers: Answer[], delayMs = 400) {
  const calls: Array<Record<string, string>> = [];
  await context.exposeFunction('__tc4Feedback', async (payload: Record<string, string>) => {
    calls.push(payload);
    await new Promise((r) => setTimeout(r, delayMs));
    return answers[calls.length - 1] ?? { ok: false, reason: 'refused' };
  });
  await context.addInitScript(() => {
    const w = window as unknown as { __tc4Feedback: (p: unknown) => Promise<unknown>; tc4Desktop: unknown };
    w.tc4Desktop = { feedback: { send: (payload: unknown) => w.__tc4Feedback(payload) } };
  });
  return calls;
}
