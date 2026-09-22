// One Report shape and one refusal-code table — legibility step L-3 (issue #156;
// TEAM-SYNC-PLAN 1.2, 1.3). Every store operation (open, checkpoint, seed,
// reconcile, and the export / import / share kernels that follow) reports its
// outcome as ONE closed record, and every refusal it throws carries ONE code
// from ONE closed table. Tests assert codes, never message strings; the UI
// looks a code's recovery text up; the normative gate proves every code that
// names a rule names a LIVE rule (conformance/normative/check.mjs).
//
// Environment-agnostic on purpose (no Node builtins): the browser bundle, the
// vitest suites and the conformance gate import this same file.

// ---- the refusal-code table ---------------------------------------------------
// code -> the BURRITO-SPEC rule id the refusal enforces, or null for an app rule
// with no R-id (the gate lists those by name and does not fail on them). A code
// is bound to exactly one rule. The table is CLOSED: `new Refusal(code)` with a
// code outside it throws, and `reportError` rejects a Report that carries one.
export const REFUSAL_CODES = Object.freeze({
  // The open path (live today, thrown by JournalingStore.open).
  'segment.invalid': 'R-8.1.6', // a segment fails the parse-and-checksum chain
  'segment.misnamed': 'R-8.1.2', // a segment file is not named by its first ts
  'segment.foreign-actor': 'R-8.1.12', // a segment carries another actor's events
  'ledger.unreadable': null, // an intent-ledger record in the installation store does not parse
  'open.scope-unreadable': null, // the project scope cannot be read; a defaulted scope would journal a widened scope
  'open.unexplained-divergence': 'R-8.7.5', // derived state no journal prefix or §8.8 reconcile explains
  'seed.mismatch': 'R-8.8.2', // the candidate seed does not reproduce the pre-seed state
  'seed.publish-failed': 'R-8.8.2', // the seed's segments did not all publish
  // The checkpoint path (live today, thrown by JournalingStore.commit).
  'checkpoint.divergence': 'R-8.7.5', // a derived file was edited or deleted out of band
  'checkpoint.scope-mismatch': 'R-8.7.2', // the rescanned currentScope is not the fold's scope
  'checkpoint.incomplete-inputs': 'R-8.7.4', // a mandatory checkpoint input is missing
  'checkpoint.metadata-unwritable': null, // a project.meta.set overlay with no metadata write route (D28)
  // Reserved for the export kernel (#375).
  'export.read-failed': null,
  'export.checkpoint-failed': null,
  'export.unsupported-kind': null,
  // Reserved for the import shell (#361, #41).
  'import.damaged.truncated': null,
  'import.damaged.no-metadata': null,
  'import.damaged.checksum-mismatch': null,
  'import.damaged.usfm-parse': null,
  'import.damaged.no-manifest': null,
  'import.name-exists': null,
  'import.write-failed': null, // the Report states the rollback
  // Reserved for the share operation (#362, #203).
  'share.offline': null,
  'share.auth-failed': null,
  'share.name-exists': null,
  'share.create-rejected': null,
  'share.non-fast-forward': null,
  'share.push-failed': null,
});

export const isRefusalCode = (code) => typeof code === 'string' && Object.hasOwn(REFUSAL_CODES, code);

// ---- the Report shape --------------------------------------------------------
// { op, ok, code?, rule?, facts, startedAt, endedAt } — nothing else. `op` is one
// of the operations below; `facts` is the operation's own record (what open
// classified, what checkpoint wrote, ...); `startedAt`/`endedAt` are ISO-8601
// UTC. A failed Report MAY carry a code (a refusal) or none (any other error);
// its `rule` is the table's binding for that code and is absent for an app rule.
export const REPORT_OPS = Object.freeze(['open', 'checkpoint', 'seed', 'reconcile', 'export', 'import', 'share']);

const REPORT_KEYS = new Set(['op', 'ok', 'code', 'rule', 'facts', 'startedAt', 'endedAt']);
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isIso = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString() === v;

/** null when `report` is a well-formed Report, else the first problem as text. */
export const reportError = (report) => {
  if (!isObj(report)) return 'is not an object';
  for (const key of Object.keys(report)) if (!REPORT_KEYS.has(key)) return `carries the unknown field "${key}"`;
  if (!REPORT_OPS.includes(report.op)) return `op ${JSON.stringify(report.op)} is not one of ${REPORT_OPS.join(', ')}`;
  if (typeof report.ok !== 'boolean') return 'ok is not a boolean';
  if (report.ok && ('code' in report || 'rule' in report)) return 'an ok Report carries no code or rule';
  if ('code' in report && !isRefusalCode(report.code)) return `code ${JSON.stringify(report.code)} is not in the refusal-code table`;
  if ('rule' in report && !('code' in report)) return 'a rule without a code';
  if ('code' in report) {
    const bound = REFUSAL_CODES[report.code];
    if (bound === null && 'rule' in report) return `code ${report.code} is an app rule and carries no rule id`;
    if (bound !== null && report.rule !== bound) return `code ${report.code} is bound to ${bound}, not ${JSON.stringify(report.rule)}`;
  }
  if (!isObj(report.facts)) return 'facts is not an object';
  if (!isIso(report.startedAt)) return 'startedAt is not an ISO-8601 UTC timestamp';
  if (!isIso(report.endedAt)) return 'endedAt is not an ISO-8601 UTC timestamp';
  return null;
};

/** The one validation site every emitted Report passes through. */
export const assertReport = (report) => {
  const problem = reportError(report);
  if (problem) throw new Error(`malformed Report: ${problem}`);
  return report;
};

// ---- constructors --------------------------------------------------------------
export const okReport = (op, startedAt, endedAt, facts) => assertReport({ op, ok: true, facts, startedAt, endedAt });

/** The Report of an operation that threw `error`: a Refusal contributes its code
 * (and rule, when bound); any other error is a failure without a code. The thrown
 * message is kept under `facts.message` so the record stays diagnosable. */
export const failedReport = (op, startedAt, endedAt, error, facts = {}) => {
  const report = { op, ok: false, facts: { ...facts, message: String(error?.message ?? error) }, startedAt, endedAt };
  if (isRefusalCode(error?.code)) {
    report.code = error.code;
    if (REFUSAL_CODES[error.code] !== null) report.rule = REFUSAL_CODES[error.code];
  }
  return assertReport(report);
};

// ---- the thrown refusal ------------------------------------------------------
/** An operation's refusal: one code from the table, the human diagnosis as the
 * message, and the facts a reader needs (paths, hashes, mismatches). */
export class Refusal extends Error {
  constructor(code, message, facts = {}) {
    if (!isRefusalCode(code)) throw new Error(`unknown refusal code ${JSON.stringify(code)} — add it to REFUSAL_CODES (journal/report.mjs)`);
    super(message);
    this.name = 'Refusal';
    this.code = code;
    this.rule = REFUSAL_CODES[code];
    this.facts = facts;
  }
}

/** The refusal code an error carries, or null. Any surface that renders an
 * operation's failure reads the code here and looks its text up. */
export const refusalCodeOf = (error) => (isRefusalCode(error?.code) ? error.code : null);
