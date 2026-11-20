// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// One door per concern (LLD §2): SDKs may only be imported inside their service folder.
const ONE_DOOR = {
  paths: [
    { name: '@anthropic-ai/sdk', message: 'Only apps/server/src/services/llm-gateway may call Anthropic.' },
  ],
  patterns: [
    { group: ['@aws-sdk/*'], message: 'Only apps/server/src/services/storage may touch object storage.' },
  ],
};

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/.turbo/**', '**/coverage/**', 'infra/**', 'packages/db/src/schema/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2023, sourceType: 'module' },
    rules: {
      'no-restricted-imports': ['error', ONE_DOOR],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['apps/server/src/services/llm-gateway/**', 'apps/server/test/gateway.test.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: ONE_DOOR.patterns }] },
  },
  {
    files: ['apps/server/src/services/storage/**'],
    rules: { 'no-restricted-imports': ['error', { paths: ONE_DOOR.paths }] },
  },
);
