# Local development runbook

## 依赖

Node/pnpm、Java 21、Rust stable、Windows WebView2/Build Tools 和 Docker Compose 是不同门禁。缺少任一项时，脚本必须明确失败；不要通过假数据或自动生成 secret 绕过门禁。

## 启动

```powershell
Copy-Item .env.example .env
$env:ASSISTANT_DB_PASSWORD = Read-Host 'Local DB password'
pnpm install --frozen-lockfile
pnpm dev
```

为本地登录账号设置 `ASSISTANT_AUTH_PASSWORD_HASH`（BCrypt）后再启动 API。密码 hash 只放在未跟踪的 `.env` 或进程环境，不能提交到仓库；空 hash 会拒绝所有登录。

`pnpm dev` 先等待 PostgreSQL health check，再启动 API 与 Web。仅验证前端可使用 `pnpm dev:web`；Tauri 使用 `pnpm dev:desktop`。

## 排查顺序

1. `docker compose -f infra/compose/compose.yaml ps` 检查数据库健康状态。
2. 访问 `http://127.0.0.1:8080/actuator/health` 检查 API liveness/readiness。
3. 打开 Web 的 Foundation 页面，查看真实 `/api/v1/context` 响应或 requestId 错误。
4. API 启动失败时确认 Java 21、`ASSISTANT_DB_PASSWORD`、组织配置和 Flyway 日志。

## 数据重置

重置脚本尚未开放为默认命令。实现时必须要求显式确认、限定 compose project，并在执行前打印解析后的目标卷；禁止对生产目录使用递归删除。
