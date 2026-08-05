// Single place that encodes the CJS interop quirks of the retained tC3 logic
// libraries (exact pinned versions per ARCHITECTURE.md; harness validate.mjs uses
// `require('word-aligner').default` — the same normalization, done once here).
import usfmjsModule from 'usfm-js';
import wordAlignerModule from 'word-aligner';
import { AlignmentHelpers, UsfmFileConversionHelpers, selectionsHelpers } from 'word-aligner-lib';

type WordAligner = (typeof wordAlignerModule)['default'];

// Vite/Vitest CJS interop may hand us the module namespace or its default.
const wa = wordAlignerModule as unknown as WordAligner & { default?: WordAligner };
export const wordaligner: WordAligner = wa.default ?? wa;

export const usfmjs = usfmjsModule;
export { AlignmentHelpers, UsfmFileConversionHelpers, selectionsHelpers };
