// 为发布产物生成 SHA-256 校验文件。
//
// 安装包既没有 Apple 开发者签名，也没有 Windows 代码签名，用户没法用系统自带的
// 签名机制确认下载来源。所以分发时必须同时给出校验值：用户下载后核对哈希，就能
// 确认文件没有被篡改或在传输中损坏。
//
// 用法：node scripts/checksum-installers.mjs <目录> [<目录> ...]
// 对每个目录下的 .exe / .dmg 生成同名的 <文件名>.sha256。

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const installers = [];

for (const directory of process.argv.slice(2)) {
  const absoluteDirectory = resolve(directory);
  let entries;
  try {
    entries = readdirSync(absoluteDirectory);
  } catch {
    console.error(`跳过不存在的目录：${absoluteDirectory}`);
    continue;
  }
  for (const entry of entries) {
    if (!/\.(exe|dmg)$/i.test(entry)) continue;
    const path = join(absoluteDirectory, entry);
    if (statSync(path).isFile()) installers.push(path);
  }
}

if (installers.length === 0) {
  console.error("没有找到任何 .exe / .dmg 产物，无法生成校验文件。");
  process.exit(1);
}

for (const installer of installers) {
  const digest = createHash("sha256")
    .update(readFileSync(installer))
    .digest("hex");
  // 两个空格分隔文件名，与 `sha256sum -c` / `shasum -a 256 -c` 的格式一致。
  writeFileSync(
    `${installer}.sha256`,
    `${digest}  ${basename(installer)}\n`,
    "utf8",
  );
  console.log(`${digest}  ${basename(installer)}`);
}
