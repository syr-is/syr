import { fileURLToPath } from "node:url";
import prettier from "eslint-config-prettier";
import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import ts from "typescript-eslint";
import * as espreeModule from "espree";
const espree = espreeModule.default ?? espreeModule;

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig(
  { ignores: ["dist", "node_modules", "eslint.config.js"] },
  js.configs.recommended,
  ...ts.configs.recommended,
  prettier,
  {
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.eslint.json",
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      "no-undef": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  // Plain JS parser for scripts (no tsconfig project required)
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      parser: espree,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
  },
);
