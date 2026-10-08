import js from "@eslint/js";
import globals from "globals";
export default [
  { ignores: ["vendor/**", "fixtures/**", "node_modules/**"] },
  js.configs.recommended,
  {
    files: ["**/*.mjs", "**/*.cjs"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      "no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
];
