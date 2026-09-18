#!/usr/bin/env node
//
// 校验版本号在仓库里保持一致，并在打标签时确认标签和版本号对得上。
//
// 版本号在仓库里重复了 7 处：根 package.json、apps/*/package.json、
// packages/*/package.json、tauri.conf.json、Cargo.toml。安装包的文件名取自
// tauri.conf.json —— DMG 由 apps/desktop/scripts/build-macos-dmg.sh 读它，
// NSIS 由 Tauri 自己读它。所以标签一旦和它不一致，就会打出一个叫
// 助教工作台_0.1.0_aarch64.dmg 的包，却挂到 v0.2.0 的 Release 上：用户下到的
// 安装包和 Release 声称的版本对不上，而且从文件名上看不出问题。
//
// 用法：
//   node scripts/check-versions.mjs
//     只查仓库内部一致性。
//   node scripts/check-versions.mjs --expect-tag v0.2.0
//     再确认版本号等于 v0.2.0（去掉前缀 v）。标签不存在时不做这一步。
//
// 退出码：0 全部一致；1 有不一致。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// 基准：安装包文件名用的就是这个版本。
const CANONICAL_FILE = "apps/desktop/src-tauri/tauri.conf.json";

function readJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relative), "utf8"));
}

function readCargoVersion(relative) {
  const text = fs.readFileSync(path.join(ROOT, relative), "utf8");
  // 只取 [package] 里的那个 version。rust-version 这类键因为锚定了行首而不会被误匹配。
  const match = text.match(/^version\s*=\s*"([^"]+)"/m);
  if (!match) throw new Error(`没能在 ${relative} 里找到 version`);
  return match[1];
}

function listDirs(relative) {
  const dir = path.join(ROOT, relative);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${relative}/${entry.name}`)
    .filter((sub) => fs.existsSync(path.join(ROOT, sub, "package.json")));
}

const expected = readJson(CANONICAL_FILE).version;
if (!expected) throw new Error(`${CANONICAL_FILE} 里没有 version`);

// 必须跟着走的：根、apps 下的每个包、以及定义安装包的两份配置。
const enforced = [
  { file: "package.json", version: readJson("package.json").version },
  ...listDirs("apps").map((dir) => ({
    file: `${dir}/package.json`,
    version: readJson(`${dir}/package.json`).version,
  })),
  { file: CANONICAL_FILE, version: expected },
  {
    file: "apps/desktop/src-tauri/Cargo.toml",
    version: readCargoVersion("apps/desktop/src-tauri/Cargo.toml"),
  },
];

// 只报告、不拦截：packages/* 是内部库，允许各自独立演进。
const informational = listDirs("packages").map((dir) => ({
  file: `${dir}/package.json`,
  version: readJson(`${dir}/package.json`).version,
}));

const problems = [];

console.log(`基准版本（取自 ${CANONICAL_FILE}）：${expected}`);
console.log();
console.log("必须一致：");
for (const { file, version } of enforced) {
  const ok = version === expected;
  console.log(`  ${ok ? "[ok]" : "[不一致]"} ${version.padEnd(10)} ${file}`);
  if (!ok) problems.push(`${file} 是 ${version}，但基准是 ${expected}`);
}

if (informational.length) {
  console.log();
  console.log("仅供参考（内部库，允许独立版本）：");
  for (const { file, version } of informational) {
    console.log(
      `  ${version === expected ? " " : "~"} ${version.padEnd(10)} ${file}`,
    );
  }
}

// --expect-tag：标签形如 v0.2.0，配置文件里写的是 0.2.0。
const tagIndex = process.argv.indexOf("--expect-tag");
if (tagIndex !== -1) {
  const tag = process.argv[tagIndex + 1];
  if (!tag) {
    console.error("\n错误：--expect-tag 后面要跟标签名。");
    process.exit(1);
  }
  const fromTag = tag.replace(/^v/, "");
  console.log();
  console.log(`标签校验：${tag} -> ${fromTag}`);
  if (fromTag !== expected) {
    problems.push(
      `标签 ${tag} 对应版本 ${fromTag}，但仓库里的版本是 ${expected}。` +
        `安装包文件名取自 ${CANONICAL_FILE}，现在打出来的包会叫 ..._${expected}_...，` +
        `却挂到 ${tag} 这个 Release 上。先把版本号改成 ${fromTag} 再打标签。`,
    );
  }
}

console.log();
if (problems.length) {
  console.error(`版本校验未通过，${problems.length} 项：`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log("版本号一致。");
