// invalidate.ts — the one §5.2 rule for invalidate-and-retain (D36), shared by
// the carry-over and the journal write. (The draft revalidation keeps its own
// write, which sets "invalid" over a "todo", and marks `userInvalid` the same
// way.) No imports, so the journal store can use it without the derive module.

/** §5.2 (#580, D94): mark a decision invalidated and retained. Invalidation
 * MUST NOT leave `status: "valid"`; a `"todo"` the user set stands. A record
 * that is not yet invalidated and holds `status: "invalid"` holds the USER's
 * Invalid, so it is marked `userInvalid: true`: when the record re-attaches,
 * that status stays (mergeAndReattach), while an Invalid the invalidation
 * set clears. A record already invalidated keeps the mark it has. */
export const invalidateDecision = <T extends { invalidated?: unknown; status?: unknown; userInvalid?: unknown }>(
  d: T,
): T & { invalidated: true; status: 'todo' | 'invalid' } => ({
  ...d,
  invalidated: true,
  status: d.status === 'todo' ? 'todo' : 'invalid',
  ...(d.invalidated !== true && d.status === 'invalid' ? { userInvalid: true } : {}),
});
