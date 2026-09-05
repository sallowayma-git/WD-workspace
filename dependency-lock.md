# Dependency Lock

启动日期：2026-08-16。所有版本均在初始化时核验为稳定发布；升级高风险依赖必须更新本文件并补充 ADR/回归证据。

| Component         |               Exact version | License          | Upgrade policy                               |
| ----------------- | --------------------------: | ---------------- | -------------------------------------------- |
| Node.js           | 26.4.0 (developer baseline) | MIT              | 保持受支持版本；CI 最低 24.15                |
| pnpm              |                     11.19.0 | MIT              | 提交 `pnpm-lock.yaml`                        |
| React / React DOM |                      19.2.8 | MIT              | 小版本经回归升级                             |
| Vite              |                       8.2.1 | MIT              | 大版本需构建与 Tauri smoke                   |
| TypeScript        |                       6.0.3 | Apache-2.0       | 暂不升 7；typescript-eslint 8.67 要求 `<6.1` |
| Ant Design        |                       6.6.0 | MIT              | 检查可访问性与主题回归                       |
| Ant Design Icons  |                       6.3.2 | MIT              | 与 Ant Design 同批升级                       |
| TanStack Query    |                     5.101.4 | MIT              | 乐观更新契约回归                             |
| React Router      |                      7.18.2 | MIT              | 路由恢复/深链回归                            |
| Vitest            |                      4.1.10 | MIT              | 与 Vite 兼容升级                             |
| Tauri CLI         |                      2.11.4 | Apache-2.0 / MIT | 大版本禁止自动合并                           |
| Tauri Rust crate  |                      2.11.5 | Apache-2.0 / MIT | 与 CLI/API 同批复核                          |
| Tauri build crate |                       2.6.3 | Apache-2.0 / MIT | crates.io 当前稳定 build helper              |
| Tauri SQL plugin  |                       2.4.0 | Apache-2.0 / MIT | 与桌面 SQLite migration 同批升级             |
| SQLx              |                       0.8.6 | Apache-2.0 / MIT | 本地事务命令，保持精确锁定                   |
| sql.js            |                      1.13.0 | MIT              | 仅开发/测试壳内存 SQLite                     |
| SheetJS xlsx      |                      0.18.5 | Apache-2.0       | 本地模板导入                                 |
| Rust              | 1.96.1 (developer baseline) | Apache-2.0 / MIT | stable toolchain                             |

依赖来源：npm registry、crates.io 与本机 Tauri info。
