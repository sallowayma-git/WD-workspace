# Flowclass fusion baseline

Captured on 2026-08-19 before changing WD business behavior.

## Source state

- WD commit: `3b93f5738c72da47d6e43b32f6a5fb531d3d86b4`
- Migration branch: `codex/flowclass-fusion`
- Flowclass local source: no Git metadata; see the manifest and file hashes in `apps/web/src/vendor/flowclass/provenance.md`.
- Fusion task-book SHA-256: `694cf28cdfbc600513cfd819a9ae2e7dff1004d3687cc5b7280b96b57a527c0a`.

## Verification baseline

| Check                                            | Result                                           |
| ------------------------------------------------ | ------------------------------------------------ |
| Java unit tests (`node scripts/gradle.mjs test`) | Pass                                             |
| Web lint/typecheck (`pnpm --dir apps/web check`) | Pass                                             |
| Web Vitest (`pnpm --dir apps/web test:run`)      | Pass: 3 files / 4 tests                          |
| Desktop Rust fmt/clippy                          | Pass                                             |
| Root `pnpm check`                                | Blocked by 28 pre-existing Prettier drift files  |
| PostgreSQL integration test                      | Blocked: local Docker/Testcontainers unavailable |

Pre-existing formatting drift is deliberately not mixed into the migration.
The PostgreSQL test remains a required CI/environment gate until the SQLite
cutover is complete.

## Visual baseline

The existing WD Schedule, Today and Workbench pages require the Spring API and
PostgreSQL data to render. Flowclass's Calendar, AttendanceSheet and
Availability pages require its API stack. The current machine cannot run their
database-backed stacks because Docker is unavailable, so no trustworthy runtime
screenshots are claimed here. The source-file hashes in provenance are the F0
reference; the isolated Calendar PoC supplies the first reproducible visual
baseline without changing business data.

## F0~F5 phase-gate closure notes (2026-08-28)

逐项收口说明：完成 / 等效完成 / 有意跳过（附理由）。全部证据与判定见
`docs/migration/flowclass/audit-2026-08-27.md` §3.4（审计线 A）。

- **F0-004（WD 三页截图）— 已跳过，不可补**。旧 WD 页面渲染依赖已删除的
  Spring + PostgreSQL 栈，无法再渲染取证；以 `provenance.md` 的源文件 SHA-256
  作为 F0 参照。
- **F0-005（Flow 截图）— 部分完成**。仅 Calendar PoC 两张截图存在；
  AttendanceSheet 与 Availability 无截图。
- **F1（样式兼容层）— 等效完成**。以手写 scoped CSS 等价实现达成 R8 意图
  （无 preflight、无全局规则污染），并非 STYLE-001 原文的 Tailwind 方案；
  STYLE-001/002/004/005 按此口径 superseded（见审计线 B §7.2 / B-MINOR-2）。
- **F3 / F4（Matrix 与 Availability 融合的过渡期门禁）— 门禁失效**。"现有
  WD 后端数据可完整操作 / 改变后端 next available" 的过渡期门禁随 2026-08-20
  后端退役而失效，无法回溯执行；以最终 SQLite 形态的验收
  （`acceptance.md` ACC 矩阵）为准。
- **F5（Delay 提纯）— 等效完成，附单侧证据**。TS 算法与测试在库；与 Java
  行为对照仅有基线日 Java 测试通过声明的单侧证据，未做逐例双侧运行（见
  `execution-parity.md` 头部 supersession 注记）。DLY 必测场景缺口：DLY-T02/T05/T06
  已补齐（`taskTransitions.test.ts` 的带标签用例 "carries a Friday task over the
  closed weekend to Monday (T02)"、"leaves a locked source untouched (T05)"、
  "leaves a completed source untouched (T06)"）；T08 无独立用例，以既有
  "顺延后重读 currentOrdinal 不变" 断言（`sqliteLocalDataAdapter.test.ts` 的
  "runs the student-template-track execution flow atomically" 内 ACC-065 段）为
  等效证据，弱于零写入断言，待补。
