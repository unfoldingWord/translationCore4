// #378: which Report the Feedback attachment holds (owner ruling 3 of
// 2026-10-06). Failure modes R4 and R5 of the pull request, written before the
// code; the @feedback journey proves the refused operation's own Report.
import { describe, expect, it } from 'vitest';
import { attachmentText, keepsReport, refusalKey, reportToAttach } from '../src/data/feedback';
import type { OpsEntry } from '../src/data/journal/opsLog';
import type { Report } from '../src/data/journal/runtime';

const report = (op: Report['op'], endedAt: string, ok = true): Report =>
  ({ op, ok, facts: {}, startedAt: endedAt, endedAt }) as Report;
const entry = (id: string, closed: Report | undefined): OpsEntry =>
  ({ id, op: closed?.op ?? 'open', startedAt: '2026-10-08T10:00:00.000Z', facts: {}, ...(closed ? { report: closed } : {}) });

describe('the Feedback attachment (#378)', () => {
  const failed = report('checkpoint', '2026-10-08T12:00:00.000Z', false);
  const older = report('open', '2026-10-08T10:00:00.000Z');
  const newer = report('export', '2026-10-08T11:00:00.000Z');

  it("holds the refused operation's own Report when it has one", () => {
    expect(reportToAttach(failed, [entry('a', older), entry('b', newer)])).toBe(failed);
  });

  it('R4: without one, holds the last CLOSED entry of the ops log, with its operation name and time', () => {
    const picked = reportToAttach(null, [entry('a', older), entry('b', newer), entry('c', undefined)]);
    expect(picked).toBe(newer);
    expect(attachmentText('translationCore 4.0.1 (abc1234) · MacIntel', picked).split('\n').slice(0, 2))
      .toEqual(['translationCore 4.0.1 (abc1234) · MacIntel', 'Report: export, 2026-10-08T11:00:00.000Z']);
  });

  it('R5: with no closed entry, says "no Report"', () => {
    for (const entries of [[], [entry('c', undefined)]]) {
      expect(attachmentText('v · os', reportToAttach(null, entries))).toBe('v · os\nno Report\n');
    }
  });
});

describe('Ask for help with a kept report (#378, Interruptions of 2026-10-08)', () => {
  const help = { code: 'open.unexplained-divergence', text: 'The project changed outside the app.' };
  const kept = { refusal: refusalKey(help), result: null };

  it('the same refusal reopens the kept, unsent report (Cancel keeps the message)', () => {
    expect(keepsReport(kept, help)).toBe(true);
    expect(keepsReport({ ...kept, result: 'timeout' }, help)).toBe(true);
  });

  it('a different refusal, a sent report, or no report starts a new one', () => {
    expect(keepsReport(kept, { ...help, code: 'checkpoint.scope-mismatch' })).toBe(false);
    expect(keepsReport(kept, { ...help, text: 'Another diagnosis.' })).toBe(false);
    expect(keepsReport({ ...kept, result: 'sent' }, help)).toBe(false);
    expect(keepsReport(null, help)).toBe(false);
  });
});
