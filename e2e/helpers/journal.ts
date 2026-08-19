// Journey teardown: the fold-compare invariant against the LIVE rig (issue #62).
// After every journey that mutates a project, the project on disk must be a
// verified materialization of its journal — byte-for-byte, via the same
// verifier CI runs against fixture projects (src/data/journal/verify.ts).
import { expect } from '@playwright/test';
import { ServerApi } from '../../src/data/serverApi';
import {
  describeVerifierReport,
  verifyProjectAgainstJournal,
} from '../../src/data/journal/verify';

const RIG_API = 'http://127.0.0.1:19998/api';

/** Run the fold-compare verifier on every LOCAL project that carries a journal.
 * A project with derived files and NO journal is a pre-journal project the app
 * has not opened yet — it has nothing to verify (universal seeding journals it
 * on first open). Throws (fails the journey) on any broken invariant. */
export async function verifyAllJournaledProjects(): Promise<string[]> {
  const api = new ServerApi({ baseUrl: RIG_API });
  const summaries = await api.getSummaries('_local_/_local_');
  const verified: string[] = [];
  for (const repoPath of Object.keys(summaries)) {
    if (summaries[repoPath].flavor !== 'textTranslation') continue;
    const paths = await api.listPaths(repoPath);
    if (!paths.some((p) => /^checking\/journal\/[a-z0-9-]+\/segments\//.test(p))) continue;
    const report = await verifyProjectAgainstJournal(api, repoPath);
    expect(report.ok, describeVerifierReport(report)).toBe(true);
    verified.push(repoPath);
  }
  return verified;
}
