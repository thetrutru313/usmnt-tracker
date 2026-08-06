import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  // ── Ignore generated / compiled output ───────────────────────────────────
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "lib/api-client/src/generated/**",
      "artifacts/api-server/src/generated/**",
    ],
  },

  // ── TypeScript-aware base rules ───────────────────────────────────────────
  ...tseslint.configs.recommended,

  // ── Project-wide overrides ────────────────────────────────────────────────
  {
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      // Downgrade to "warn" so existing inline disable-comments remain valid
      // while new violations are still surfaced.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-namespace": "warn",

      // React hooks rules (applies to all files; harmless on non-React code)
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",

      // Allow intentionally-unused parameters/variables when prefixed with _
      // (e.g. tagged-template mock helpers, destructured-but-ignored fields).
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          varsIgnorePattern: "^_",
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          // Vars that are imported for their type but appear as values —
          // flag them only as warnings so `import type` can be adopted gradually.
          ignoreRestSiblings: true,
        },
      ],
    },
  },
);
