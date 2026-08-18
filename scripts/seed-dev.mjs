import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const password = process.env.ASSISTANT_SEED_DEV_PASSWORD;
if (!password || password.length < 12) {
  console.error(
    "ASSISTANT_SEED_DEV_PASSWORD must be set and at least 12 characters",
  );
  process.exit(2);
}

const root = resolve(import.meta.dirname, "..");
const result = spawnSync(
  process.execPath,
  [
    resolve(root, "scripts", "gradle.mjs"),
    "bootRun",
    "--args=--spring.profiles.active=dev --spring.main.web-application-type=none --assistant.seed-dev.enabled=true",
  ],
  {
    cwd: root,
    env: { ...process.env, ASSISTANT_SEED_DEV_PASSWORD: password },
    stdio: "inherit",
    shell: false,
  },
);
process.exit(result.status ?? 1);
