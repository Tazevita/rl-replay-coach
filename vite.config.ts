import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import { composeReplayApi } from "./src/server/composition";

export default defineConfig(({ command, mode }) => {
  const environment = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
  const browserSupabaseUrl = environment.VITE_SUPABASE_URL?.trim() || environment.SUPABASE_URL?.trim();
  const browserSupabaseKey = environment.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || environment.SUPABASE_PUBLISHABLE_KEY?.trim();
  return {
    plugins: [react(), ...(command === "serve" ? [composeReplayApi(undefined, environment)] : [])],
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(browserSupabaseUrl),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(browserSupabaseKey),
      "import.meta.env.VITE_SIGNUPS_ENABLED": JSON.stringify(environment.VITE_SIGNUPS_ENABLED?.trim() || "false"),
      "import.meta.env.VITE_TEST_MODE": JSON.stringify(environment.TEST_MODE?.trim() || "false"),
      "import.meta.env.VITE_TEST_USER_EMAIL": JSON.stringify(environment.TEST_USER_EMAIL?.trim() || "local@test.invalid"),
    },
    test: {
      exclude: ["tests/browser/**", "node_modules/**"],
    },
  };
});
