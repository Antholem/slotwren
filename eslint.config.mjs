import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

// Import guardrails (CLAUDE.md, architecture rules 1–2).
const serverCode = {
  group: ["@/server/*", "**/server/*"],
  message: "Server-only code. Pass data in as props from a server component or action.",
};
const rawAdminDb = {
  // Broad on purpose: only the adminDb name is restricted.
  group: ["@/server/db/client", "**/client", "./client", "../client", "../../client"],
  importNames: ["adminDb"],
  message:
    "adminDb bypasses RLS. Build queries with adminQuery/tenantLookup from @/server/db/admin.",
};
const adminQueries = {
  group: ["@/server/db/admin", "**/db/admin", "./admin", "../admin", "../../admin"],
  message:
    "RLS-bypassing queries belong in src/server/db/queries/public or /system. Dashboard code uses withRls.",
};
const restrictImports = (...patterns) => ({
  "no-restricted-imports": ["error", { patterns }],
});

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  // Later blocks override earlier ones for the files they match.
  {
    // adminDb (RLS bypassed) only through the typed wrappers in db/admin.ts,
    // and those only from the public and system query folders.
    files: ["src/**/*.{ts,tsx}"],
    rules: restrictImports(rawAdminDb, adminQueries),
  },
  {
    files: ["src/server/db/queries/public/**/*.ts", "src/server/db/queries/system/**/*.ts"],
    rules: restrictImports(rawAdminDb),
  },
  {
    files: ["src/server/db/admin.ts"],
    rules: { "no-restricted-imports": "off" },
  },
  {
    // Tenant data never reaches client components: they may not import server code.
    files: ["src/components/**/*.tsx", "src/hooks/**/*.ts", "src/lib/**/*.ts"],
    rules: restrictImports(serverCode),
  },
  prettier,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "public/embed.js",
  ]),
]);

export default eslintConfig;
