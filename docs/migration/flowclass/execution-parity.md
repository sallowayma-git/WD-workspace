# Execution parity contract

> **Supersession 注记（2026-08-28）**：2026-08-20 起产品决策已取代本契约的部分条款——
>
> - **改期一次直生效**：不拒绝非学习日（照做并记录 `overrideReason`），`COMPLETED` 任务也可移动。见 `apps/web/src/domain/task/taskTransitions.ts:122-133`（rescheduleTask 注释与实现）与测试 `taskTransitions.test.ts:217-238`（"records why a move landed on a day that does not fit"、"keeps the completion status when a finished task is moved"）。
> - **expectedVersion 严格校验仅约束 deleteTask**：reschedule/update/reorder 以库内当前版本执行（`AND version = ?` 保留用于保证事务内行未被中途改写），单用户语义下陈旧界面版本不算冲突。见 `apps/web/src/data/local/sqliteLocalDataAdapter.ts:1709-1716` 的 `currentVersion` 注释。
>
> **仍然有效的条款**：事务边界（Complete+Track 推进、顺延三写、Reschedule 乐观锁单事务）、命令幂等、locked/历史行拒绝，以及顺延 lineage 契约（源置 `CARRIED_OVER`、双向链、复用既有 target）。
>
> **对照方式（如实记录）**：本契约与 TS/SQLite 实现的对照 = 契约逐条评审 + 基线日（2026-08-19）Java 参考实现测试通过声明（见 `baseline.md` Verification baseline 表），**未做过逐例双侧运行**；Java 栈已于 2026-08-20 删除，双侧运行证据不可再补。

These cases freeze the Spring reference behavior before TypeScript domain and
SQLite implementation. A local implementation cannot replace the API until the
same cases pass against both implementations.

## Complete and reopen

- Completing `PENDING` changes it to `COMPLETED`, increments version and advances only the continuous Track prefix.
- Repeating complete with an idempotency key returns the existing completed result without another mutation.
- Completing an invalid state or stale version fails without changing the Track.
- Reopening changes `COMPLETED` to `PENDING`, clears completion data and recalculates the Track.
- Reopen is rejected when later completed ordinals require the correction workflow.

## Carry forward

- A pending unlocked task is cloned from its current snapshot to the next valid study date within 90 days.
- Date overrides take precedence over the weekly pattern; excluded and unavailable dates are skipped.
- Device-required tasks are automatically placed only when device policy is `ALLOWED`.
- The source becomes `CARRIED_OVER`, the target becomes `PENDING`, and both lineage links are populated.
- Track ordinal is unchanged. Repeating the same carry command reuses the target rather than creating a duplicate.
- Locked or non-pending tasks are no-ops. No available date changes the source to `BLOCKED`.
- Undo restores the source to `PENDING`, cancels an unchanged pending target and clears both links atomically.

## Reschedule

- Only `PENDING` and `BLOCKED` can be rescheduled.
- Reschedule sets the date, `scheduleOrigin=MANUAL`, `manualOverride=true`, reason and next version.
- Reschedule never advances Track.
- Unavailable dates and device-policy conflicts remain distinct errors.
- A stale expected version fails without a partial update.

## Transaction boundary

- Complete plus Track advancement is one transaction.
- Carry source transition plus target creation plus lineage is one transaction.
- Reschedule is one optimistic-lock guarded transaction.
