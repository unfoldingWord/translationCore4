import baseConfig from './eslint.config.js';

export default [
  ...baseConfig,
  {
    files: ['src/**/*.{js,jsx,ts,tsx}'],
    rules: {
      complexity: ['error', { max: 15 }],
    },
  },
];
