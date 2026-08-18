# Dependency Lock

启动日期：2026-08-16。所有版本均在初始化时核验为稳定发布；升级高风险依赖必须更新本文件并补充 ADR/回归证据。

| Component         |               Exact version | License                          | Upgrade policy                               |
| ----------------- | --------------------------: | -------------------------------- | -------------------------------------------- |
| Node.js           | 26.4.0 (developer baseline) | MIT                              | 保持受支持版本；CI 最低 24.15                |
| pnpm              |                     11.19.0 | MIT                              | 提交 `pnpm-lock.yaml`                        |
| React / React DOM |                      19.2.8 | MIT                              | 小版本经回归升级                             |
| Vite              |                       8.2.1 | MIT                              | 大版本需构建与 Tauri smoke                   |
| TypeScript        |                       6.0.3 | Apache-2.0                       | 暂不升 7；typescript-eslint 8.67 要求 `<6.1` |
| Ant Design        |                       6.6.0 | MIT                              | 检查可访问性与主题回归                       |
| Ant Design Icons  |                       6.3.2 | MIT                              | 与 Ant Design 同批升级                       |
| TanStack Query    |                     5.101.4 | MIT                              | 乐观更新契约回归                             |
| React Router      |                      7.18.2 | MIT                              | 路由恢复/深链回归                            |
| Vitest            |                      4.1.10 | MIT                              | 与 Vite 兼容升级                             |
| Tauri CLI         |                      2.11.4 | Apache-2.0 / MIT                 | 大版本禁止自动合并                           |
| Tauri Rust crate  |                      2.11.5 | Apache-2.0 / MIT                 | 与 CLI/API 同批复核                          |
| Tauri build crate |                       2.6.3 | Apache-2.0 / MIT                 | crates.io 当前稳定 build helper              |
| Rust              | 1.96.1 (developer baseline) | Apache-2.0 / MIT                 | stable toolchain                             |
| Java              |                      21 LTS | GPL-2.0 with Classpath Exception | 后端编译基线                                 |
| Spring Boot       |                       4.1.0 | Apache-2.0                       | 大版本需 ADR 与兼容验证                      |
| Spring Modulith   |                       2.1.0 | Apache-2.0                       | 与 Boot 4.1.0 精确配对                       |
| PostgreSQL        |                        18.x | PostgreSQL License               | 锁当前安全小版本                             |
| Gradle            |                       9.7.0 | Apache-2.0                       | 通过 wrapper 固定                            |
| Testcontainers    |                      1.21.4 | MIT                              | PostgreSQL 集成测试；必须使用真实容器        |

依赖来源：npm registry、Maven Central、Spring Initializr metadata、Gradle version service 与本机 Tauri info。完整第三方 NOTICE/SBOM 在 Operationalization 阶段生成。
