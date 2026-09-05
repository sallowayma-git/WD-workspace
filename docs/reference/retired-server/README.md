# 已退役的服务器契约（历史存档）

这里的文件描述的是 **已经不存在** 的组件：Spring Boot API、PostgreSQL 数据库和密码登录。它们在 Flowclass 融合任务书的 F8 阶段被移除。

保留原因只有一条：这些契约是当年经过验证的业务规则边界，在 TypeScript parity 出现回归时可以作为对照。

## 不要按这里的内容操作

- 没有 `/api/v1` 服务器可以访问。
- 没有 `/auth/login`，产品不做登录，也没有 access/refresh token。
- 没有 organization/tenant 概念，本地是单工作区。

当前产品形态与开发方式见 `README.md` 与 `docs/runbooks/local-development.md`。

## 文件

| 文件                      | 原用途                                      | 现状                                                                           |
| ------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------ |
| `openapi-foundation.yaml` | Foundation 模块的 HTTP 契约（context/auth） | 契约的业务字段已被 `apps/web/src/data/DataAdapter.ts` 取代；auth 部分整体 DROP |

Java 实现本身已从工作树删除，可通过 git 历史在基线 commit `3b93f5738c72da47d6e43b32f6a5fb531d3d86b4` 取回：

```powershell
git show 3b93f57:apps/api/src/main/java/com/wonderedu/assistant/execution/application/ExecutionService.java
```
