import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "supabase/**"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportDeclaration[source.value='lucide-react'] ImportNamespaceSpecifier",
          message:
            "Ikke importer hele lucide-react. Bruk navngitte importer eller getAppIcon/getLucideIcon fra @/lib/appIcons.",
        },
        {
          selector:
            "CallExpression[callee.property.name='slice'][callee.object.callee.property.name='toISOString'][arguments.0.value=0][arguments.1.value=10]",
          message:
            "Bruk osloTodayISO()/osloDateISO() fra @/lib/osloDate i stedet for toISOString().slice(0, 10).",
        },
      ],
    },
  },
);
