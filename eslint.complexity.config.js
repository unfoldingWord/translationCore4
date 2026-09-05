import baseConfig from './eslint.config.js';

export default [
  ...baseConfig,
  // src/ds/ is the vendored design system, synced from the design master and
  // not written here (src/ds/README.md); its primitives exceed the limit by
  // design. The app's own code stays under the rule.
  { ignores: ['src/ds/**'] },
  {
    files: ['src/**/*.{js,jsx,ts,tsx}'],
    rules: {
      complexity: ['error', { max: 15 }],
    },
  },
];
