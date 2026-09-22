// Report and refusal helpers for every suite that drives a store operation
// (issue #156). Tests assert the CODE a refusal carries, never its message
// string, and read an open's facts from the store's last Report.
import { expect } from 'vitest';
import { REFUSAL_CODES, reportError, type RefusalCode, type RefusalError, type Report } from '../../src/data/journal/runtime';
import type { OpenFacts } from '../../src/data/journal/journalingStore';

/** Await a rejection carrying exactly `code`; return the refusal for further asserts. */
export async function expectRefusal(promise: Promise<unknown>, code: RefusalCode): Promise<RefusalError> {
  let refusal: unknown = null;
  let settled = false;
  try {
    await promise;
    settled = true;
  } catch (error) {
    refusal = error;
  }
  expect(settled, `expected the refusal ${code}, but the operation succeeded`).toBe(false);
  const error = refusal as Partial<RefusalError>;
  expect(error?.code, `expected the refusal ${code}; got ${String((error as Error)?.message ?? error)}`).toBe(code);
  expect(error.rule).toBe(REFUSAL_CODES[code]);
  return error as RefusalError;
}

/** The store's last Report, validated against the schema and checked for `op`. */
export function lastReportOf(store: { lastReport: Report | null }, op: Report['op']): Report {
  const report = store.lastReport;
  expect(report, 'the store emitted no Report').not.toBeNull();
  expect(reportError(report)).toBeNull();
  expect(report!.op).toBe(op);
  return report!;
}

/** The facts of the store's last open — which MUST be an ok open Report. */
export function openFacts(store: { lastReport: Report | null }): OpenFacts {
  const report = lastReportOf(store, 'open');
  expect(report.ok).toBe(true);
  return report.facts as OpenFacts;
}
