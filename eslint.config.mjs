import tseslint from 'typescript-eslint';
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next*/**',
      '**/node_modules/**',
      '**/public/pdfjs/**',
      '**/next-env.d.ts',
      '**/.local/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
