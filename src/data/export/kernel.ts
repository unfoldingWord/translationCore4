// The export kernel (issue #375, D79, docs/ARCHITECTURE.md §7): the one layer
// every export sits on. A producer is a pure function from project data to one
// file; the kernel owns everything around it — the D9 checkpoint before the
// export, the browser download, and the Report. So a producer (#19, #359, #20,
// #360) touches no plumbing and no shared view.
//
// A file leaves only as a browser download: the renderer has no file-system
// access, and Electron routes a download to the operating-system save dialog
// [VERIFIED — scripts/desktop-main.cjs, 2026-09-22].
import type { BurritoStore, ProjectSummary } from '../burritoStore';
import { checkpointMessage } from '../checkpoint';
import { Refusal, failedReport, okReport, type Report } from '../journal/runtime';

/** The page-setup choices of the Community Checking preview, for the PDF producer (#20). */
export type PageSetup = Record<string, unknown>;

export type ExportProducer = {
  id: 'usfm-aligned' | 'usfm-plain' | 'burrito-zip' | 'pdf' | 'obs-markdown';
  label: string; // menu text, from i18n
  appliesTo: (project: ProjectSummary) => boolean; // Bible, OBS, or both
  produce: (input: ExportInput) => Promise<ExportFile>; // pure: data in, bytes out
};
export type ExportInput = { store: BurritoStore; project: ProjectSummary; book?: string; pageSetup?: PageSetup };
export type ExportFile = { bytes: Uint8Array; filename: string; mime: string };

/** The facts of an ok export Report: which producer, the file name, its size in bytes. */
export type ExportFacts = { producer: ExportProducer['id']; filename: string; bytes: number };

/** The one file-name form of every export: `<subject>-<YYYY-MM-DD>.<ext>`, on
 * the translator's local date. */
export function exportFilename(subject: string, ext: string, now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${subject}-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.${ext}`;
}

/** Hand `file` to the browser as a download (an anchor click). The only place
 * the app makes a Blob URL. */
export function deliverFile(file: ExportFile): void {
  const url = URL.createObjectURL(new Blob([file.bytes as BlobPart], { type: file.mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = file.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // The click has started the download; the URL is released after this task.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Checkpoint when the project is dirty (D9), produce, deliver. A failure
 * delivers nothing and returns a failed Report: `export.checkpoint-failed` when
 * the checkpoint failed, else `export.read-failed`. */
export async function runExport(producer: ExportProducer, input: ExportInput): Promise<Report> {
  const startedAt = new Date().toISOString();
  const fail = (code: 'export.checkpoint-failed' | 'export.read-failed', error: unknown): Report =>
    failedReport('export', startedAt, new Date().toISOString(), new Refusal(code, String((error as Error)?.message ?? error)), {
      producer: producer.id,
    });
  try {
    // commitPending commits only when the repository has pending changes: a
    // clean project makes no checkpoint.
    await input.store.commitPending((changes) => checkpointMessage('before export', changes));
  } catch (error) {
    return fail('export.checkpoint-failed', error);
  }
  let file: ExportFile;
  try {
    file = await producer.produce(input);
    deliverFile(file);
  } catch (error) {
    return fail('export.read-failed', error);
  }
  const facts: ExportFacts = { producer: producer.id, filename: file.filename, bytes: file.bytes.byteLength };
  return okReport('export', startedAt, new Date().toISOString(), facts);
}
