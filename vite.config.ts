import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const projectRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  appType: "mpa",
  build: {
    rollupOptions: {
      input: {
        homepage: resolve(projectRoot, "index.html"),
        incomeForecast: resolve(projectRoot, "projects/income-forecast/index.html"),
        incomeForecastResetPassword: resolve(
          projectRoot,
          "projects/income-forecast/reset-password/index.html",
        ),
        incomeForecastAdmin: resolve(
          projectRoot,
          "projects/income-forecast/admin/index.html",
        ),
      },
    },
  },
});
