import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = resolve(repositoryRoot, "apps/web/src");
const entry = resolve(sourceRoot, "main.tsx");
const forbiddenFiles = new Set(
  [
    "lib/api/http.ts",
    "data/httpDataAdapter.ts",
    "features/auth/authApi.ts",
    "features/auth/authStore.ts",
  ].map((path) => resolve(sourceRoot, path)),
);
const importPattern =
  /(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
// Bare specifiers that would smuggle an HTTP client into the local bundle.
const httpClientPattern = /^(axios|undici|node-fetch|got|ky|superagent)(\/|$)/;
// fetch reachable in a value/call position: direct call, alias assignment
// (`const g = fetch`), or member access (`window.fetch`, `globalThis.fetch`).
// `\b` keeps refetch()/useRefetch-style names out of the match.
const fetchUsagePattern = /\bfetch\s*\(|=\s*fetch\b|\.\s*fetch\b/;
// Browser transports that bypass the fetch hook entirely.
const browserTransportPattern = /\b(XMLHttpRequest|WebSocket|EventSource)\b/;
// A dynamic import() must name a single/double-quoted string-literal module
// specifier. Anything else (variable, expression, or template literal — the
// latter can interpolate and is invisible to importPattern) is computed and
// can hide the target from this scan, so it fails the gate.
const computedImportPattern = /\bimport\s*\(\s*(?!['"])/;

function resolveModule(fromFile, specifier) {
  if (!specifier.startsWith(".")) return null;
  const candidate = resolve(dirname(fromFile), specifier);
  const candidates = extname(candidate)
    ? [candidate]
    : [
        candidate,
        `${candidate}.ts`,
        `${candidate}.tsx`,
        `${candidate}.js`,
        `${candidate}.jsx`,
        resolve(candidate, "index.ts"),
        resolve(candidate, "index.tsx"),
      ];
  return candidates.find((path) => existsSync(path)) ?? null;
}

const visited = new Set();
const failures = [];
const stack = [entry];
while (stack.length > 0) {
  const file = stack.pop();
  if (!file || visited.has(file)) continue;
  visited.add(file);
  if (forbiddenFiles.has(file)) {
    failures.push(
      `forbidden runtime module: ${relative(repositoryRoot, file)}`,
    );
    continue;
  }
  const source = readFileSync(file, "utf8");
  if (fetchUsagePattern.test(source)) {
    failures.push(
      `fetch transport usage (call, alias, or member access): ${relative(repositoryRoot, file)}`,
    );
  }
  if (browserTransportPattern.test(source)) {
    failures.push(
      `browser HTTP/stream transport (XMLHttpRequest/WebSocket/EventSource): ${relative(repositoryRoot, file)}`,
    );
  }
  if (computedImportPattern.test(source)) {
    failures.push(
      `computed dynamic import() with non-literal specifier: ${relative(repositoryRoot, file)}`,
    );
  }
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1] ?? match[2];
    if (httpClientPattern.test(specifier)) {
      failures.push(
        `forbidden HTTP client dependency "${specifier}" — the local desktop runtime must go through the SQLite data adapter: ${relative(repositoryRoot, file)}`,
      );
      continue;
    }
    const dependency = resolveModule(file, specifier);
    if (dependency && dependency.startsWith(sourceRoot)) stack.push(dependency);
  }
}

if (failures.length > 0) {
  console.error("Local desktop runtime must not include HTTP/Auth transport:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `local-runtime-ok (${visited.size} reachable source modules, no HTTP transport)`,
);
