import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

/** Shared ESLint config. Consumers call `config({ tsconfigRootDir: import.meta.dirname })`. */
export function config({ tsconfigRootDir }: { tsconfigRootDir: string }) {
  return defineConfig(
    { ignores: ["**/dist/**", "**/src/generated/**", "**/node_modules/**", "**/.turbo/**", "**/.next/**", "**/coverage/**", "**/.vitepress/cache/**", "**/.vitepress/.temp/**"] },
    js.configs.recommended,
    ...tseslint.configs.strictTypeChecked,
    ...tseslint.configs.stylisticTypeChecked,
    {
      languageOptions: {
        globals: { ...globals.browser, ...globals.node },
        parserOptions: { projectService: true, tsconfigRootDir },
      },
      rules: {
        // Interfaces and type aliases: lowercase `t` + PascalCase (tSong, tClientOptions).
        // Classes PascalCase; methods and properties camelCase.
        "@typescript-eslint/naming-convention": [
          "error",
          { selector: "default", format: ["camelCase"], leadingUnderscore: "allow" },
          { selector: ["interface", "typeAlias"], prefix: ["t"], format: ["PascalCase"] },
          { selector: ["class", "enum", "enumMember", "typeParameter"], format: ["PascalCase"] },
          { selector: "variable", format: ["camelCase", "PascalCase", "UPPER_CASE"] },
          { selector: "function", format: ["camelCase", "PascalCase"] },
          { selector: "import", format: ["camelCase", "PascalCase"] },
          { selector: ["objectLiteralProperty", "typeProperty"], modifiers: ["requiresQuotes"], format: null },
        ],
        // The SDK never logs: a log line is where a token or a key ends up by accident. What a consumer needs to
        // know reaches them as an error or through a hook, and what they print is theirs to decide.
        "no-console": "error",
      },
    },
    // Tools and sample apps print by design.
    { files: ["codegen/**", "apps/**"], rules: { "no-console": "off" } },
    // A package of hooks is held to the two rules of hooks: where one may be called, and what an effect depends on.
    { files: ["integrations/react/**"], plugins: { "react-hooks": reactHooks }, rules: { "react-hooks/rules-of-hooks": "error", "react-hooks/exhaustive-deps": "error" } },
    { files: ["**/*.{js,mjs,cjs}"], ...tseslint.configs.disableTypeChecked },
  );
}
