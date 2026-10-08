// #378: the Feedback dialog's attachment. The dialog shows this text, and the
// desktop bridge sends exactly this text (scripts/desktop-feedback.cjs).
import type { Report } from './journal/runtime';
import type { OpsEntry } from './journal/opsLog';

/** tC3's three categories; the subject is `tC: <category>` (FeedbackHelpers.js). */
export const CATEGORIES = ['General Feedback', 'Content and Resources Feedback', 'Bug Report'] as const;

/** The Report of the refused operation when it has one; else the last closed
 * entry of the ops log; else none (owner ruling 3 of 2026-10-06). */
export function reportToAttach(failed: Report | null, entries: OpsEntry[]): Report | null {
  if (failed) return failed;
  return entries.filter((e) => e.report).at(-1)?.report ?? null;
}

/** Which refusal a report was opened for: its code and the banner's diagnosis. */
export const refusalKey = (help: { code: string; text: string }): string => `${help.code}\n${help.text}`;

/** Whether "Ask for help" reopens the kept report instead of replacing it: an
 * unsent report of the SAME refusal is kept (Cancel keeps the message); a
 * different refusal replaces it (Interruptions, owner 2026-10-08); a sent
 * report was cleared, so a new one starts. */
export const keepsReport = (
  fb: { refusal?: string; result?: string | null } | null,
  help: { code: string; text: string },
): boolean => !!fb && fb.result !== 'sent' && fb.refusal === refusalKey(help);

/** The version line, then the Report labelled with its operation name and time. */
export const attachmentText = (versionLine: string, report: Report | null): string =>
  report
    ? `${versionLine}\nReport: ${report.op}, ${report.endedAt}\n${JSON.stringify(report, null, 2)}\n`
    : `${versionLine}\nno Report\n`;
