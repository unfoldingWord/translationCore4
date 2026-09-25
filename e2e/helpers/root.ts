// The repository root, for the journeys and for the Vitest suites that import the
// journey helpers (#396). The builtins come from the runtime, not from `import
// 'node:…'`: under Vitest, vite-plugin-node-polyfills turns node:url into a proxy
// that crashes and node:path into a POSIX-only mock (CONTRIBUTING.md, "Write a
// test that reads files").
const path = process.getBuiltinModule('node:path');
const { fileURLToPath } = process.getBuiltinModule('node:url');

// e2e/helpers/root.ts: two parents reach the repository root.
export const TC4_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
