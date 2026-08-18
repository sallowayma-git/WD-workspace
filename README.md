# 助教工作台

以学生为核心、以时间为横轴、以连续任务轨道为进度来源、以 Checklist 为执行入口、以自动顺延为减负机制的助教业务工作台。

## 当前阶段

项目正在执行 WBS Phase 0（Foundation）。已冻结的完成条件是 PRD AC-001~015、WBS 各阶段退出门禁，以及轨道、执行、顺延、减负四项最终业务证明。未进入阶段的页面会明确标注为未实现，不以静态占位冒充业务完成。

## 目录

```text
apps/web       React/Vite 浏览器 UI（同时供 Tauri 使用）
apps/desktop   Tauri 2 薄桌面壳
apps/api       Spring Boot/Spring Modulith API
packages       生成客户端、设计令牌和测试 fixture
infra          本地依赖、容器与监控定义
scripts        可复现的开发/校验入口
docs           ADR、API 与运行手册
DocsHarness    产品、架构与实施基线
```

## 前置依赖

- Node.js 24.15+ 与 pnpm 11.19
- Java 21（API）
- Rust stable、Windows WebView2/Build Tools（Tauri）
- Docker Compose（PostgreSQL 18 集成环境）

本机缺少的前置依赖会由脚本 fail-fast 并给出安装提示，不会静默改源码或使用生产 secret。

## 快速开始

```powershell
Copy-Item .env.example .env
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` 负责启动 PostgreSQL、API 和 Web。只开发前端可运行 `pnpm dev:web`；桌面开发使用 `pnpm dev:desktop`。

首次登录需要在未跟踪的 `.env` 中设置 `ASSISTANT_AUTH_PASSWORD_HASH`（BCrypt）。API 不接受明文密码配置，也不会自动生成生产 secret；没有 hash 时登录会明确返回 `INVALID_CREDENTIALS`。

## 校验

```powershell
pnpm check
pnpm build:web
pnpm build:api
pnpm build:desktop:no-bundle
```

完整数据库、模块、OpenAPI、E2E、许可证和三端构建门禁会在 CI 中执行。当前环境阻塞与已验证结果记录在 `progress.md`。

## 配置与安全

- 只把非敏感本地默认值写入 `.env.example`。
- 数据库密码、令牌密钥、签名证书和更新密钥不得提交。
- 浏览器只读取 `VITE_*` 非敏感变量。
- 桌面端不直接连接 PostgreSQL，业务状态以 API 为真值。
