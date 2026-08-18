import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const apiDirectory = resolve(repositoryRoot, "apps", "api");
const wrapperJar = resolve(
  apiDirectory,
  "gradle",
  "wrapper",
  "gradle-wrapper.jar",
);

if (!existsSync(wrapperJar)) {
  console.error(
    "Gradle wrapper is missing. Run the Foundation bootstrap before starting the API.",
  );
  process.exit(1);
}

const localJavaHome = resolve(repositoryRoot, ".tooling", "jdk-21");
const environment = { ...process.env };
if (!environment.JAVA_HOME && existsSync(localJavaHome)) {
  environment.JAVA_HOME = localJavaHome;
  environment.PATH = `${resolve(localJavaHome, "bin")}${process.platform === "win32" ? ";" : ":"}${environment.PATH ?? ""}`;
}
const javaExecutable = environment.JAVA_HOME
  ? resolve(
      environment.JAVA_HOME,
      "bin",
      process.platform === "win32" ? "java.exe" : "java",
    )
  : "java";

const child = spawn(
  javaExecutable,
  [
    "-classpath",
    wrapperJar,
    "org.gradle.wrapper.GradleWrapperMain",
    ...process.argv.slice(2),
  ],
  {
    cwd: apiDirectory,
    env: environment,
    stdio: "inherit",
  },
);

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
