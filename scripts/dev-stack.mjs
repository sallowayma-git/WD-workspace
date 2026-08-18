import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const children = new Set();
const composeFile = resolve(repositoryRoot, "infra", "compose", "compose.yaml");

if (typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(resolve(repositoryRoot, ".env"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function hasCommand(command, args = ["--version"]) {
  return (
    spawnSync(command, args, {
      stdio: "ignore",
      shell: process.platform === "win32",
    }).status === 0
  );
}

function run(command, args, cwd = repositoryRoot, env = process.env) {
  const useWindowsCommandHost =
    process.platform === "win32" && command === "pnpm";
  const executable = useWindowsCommandHost
    ? (process.env.ComSpec ?? "cmd.exe")
    : command;
  const commandArgs = useWindowsCommandHost
    ? ["/d", "/s", "/c", "pnpm", ...args]
    : args;
  const child = spawn(executable, commandArgs, {
    cwd,
    env,
    stdio: "inherit",
    shell: false,
  });
  children.add(child);
  child.on("exit", (code) => {
    children.delete(child);
    if (code && code !== 0) shutdown(code);
  });
  return child;
}

function shutdown(code = 0) {
  for (const child of children) child.kill("SIGTERM");
  process.exit(code);
}

process.on("SIGINT", () => shutdown(130));
process.on("SIGTERM", () => shutdown(143));

const useDevProfile = process.env.ASSISTANT_SKIP_INFRA === "1";

if (!useDevProfile) {
  if (!hasCommand("docker", ["compose", "version"])) {
    console.error(
      "Docker Compose is required for the full stack. Set ASSISTANT_SKIP_INFRA=1 only when using an existing PostgreSQL instance.",
    );
    process.exit(1);
  }
  const compose = spawnSync(
    "docker",
    ["compose", "-f", composeFile, "up", "-d", "--wait", "postgres"],
    {
      cwd: repositoryRoot,
      env: process.env,
      stdio: "inherit",
      shell: process.platform === "win32",
    },
  );
  if (compose.status !== 0) process.exit(compose.status ?? 1);
}

run(process.execPath, [
  resolve(repositoryRoot, "scripts", "gradle.mjs"),
  "bootRun",
], repositoryRoot, {
  ...process.env,
  ...(useDevProfile ? { SPRING_PROFILES_ACTIVE: "dev" } : {}),
});
run("pnpm", [
  "--dir",
  resolve(repositoryRoot, "apps", "web"),
  "dev",
  "--host",
  "127.0.0.1",
], repositoryRoot, {
  ...process.env,
  VITE_AUTH_DISABLED: useDevProfile ? "true" : "false",
});
