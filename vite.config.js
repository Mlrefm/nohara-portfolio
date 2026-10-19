import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import adminDevPlugin from "./scripts/admin-dev.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, root, "");
  Object.assign(process.env, env);

  return {
    base: process.env.BASE_PATH || "/",
    server: {
      port: 5173,
    },
    plugins: [adminDevPlugin(root)],
    build: {
      rollupOptions: {
        input: {
          main: path.join(root, "index.html"),
          admin: path.join(root, "admin/index.html"),
        },
      },
    },
  };
});
