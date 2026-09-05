# ADR-003：长期任务（SEQUENCE）与逐项课程（ITEMIZED）双模式

## 状态

Accepted — 2026-09-05。在 ADR-002 的本地桌面运行时之上叠加领域决策；`packages/api-client`、Spring Modulith 端口等原设计文档（dc5c9ca 基线的《长期任务简化》草案）中的工程结论已随服务端退役而失效，本文只保留其中仍然成立的领域模型部分。

## 背景

用户的真实工作流是"一天一句长难句 Day 1 → Day 2 → …"这类**序号生成型**任务：每一项除了序号不同，标题规则完全一致。现有模型要求先建模板 → 起草版本 → 逐项录入 → 发布 → 挂载轨道，才能让轨道自动推进。对这类任务，Version/Item/Publish 是用户不该理解的概念；但对 Excel 导入的逐项课程（第 1 项阅读、第 2 项测试、第 3 项复盘）它们仍然正确。

2026-09-05 的前序提交（80824cd）已提供手工"生成下一项"箭头（AD_HOC 复制 +1），但完成一项后仍要人工点一次；长期任务要把"完成即出现下一项"变成默认体验。

## 决策

1. **复用 `task_template` 表，不建第二张定义表。** 新增 `generation_mode`（`ITEMIZED`（默认）/`SEQUENCE`）。SEQUENCE 定义使用 `title_pattern`（`前缀{n}后缀`）、`default_start_ordinal`、`sequence_end_ordinal`（null = 开放型）、`normalized_key`；创建即 `ACTIVE`，没有 Draft/Version/Publish。`template_code` 等遗留列由服务端生成兼容值（`LT-` 前缀），不向用户展示。
2. **Track 落定义快照。** `student_task_track` 增加 `generation_mode`、`definition_name_snapshot`、`title_pattern_snapshot`，`template_version_id` 对 SEQUENCE 为 NULL。定义后续改名/改模板只影响新挂载学生；已挂载学生的标题体系不变。若将来需要"应用新规则到现有学生"，做显式迁移命令，不做隐式同步。
3. **task_instance 的 TRACK 身份改为 (track_id, item_ordinal)。** `template_item_id` 成为 ITEMIZED 专属；`uq_task_pending_track_ordinal` 部分唯一索引保证一个轨道的一个序号最多一个 PENDING 实例（对 ITEMIZED 等价于原 `(track_id, template_item_id)` 索引，因为 `(version_id, ordinal)` 唯一）。
4. **end_ordinal 可空，指针算法随之调整。** 完成推进 `currentOrdinal` 到第一个未完成序号：有限型越过 `end_ordinal` 落 `COMPLETED`；开放型永不自动完成。顺延保持序号不变、不动指针（既有不变量，SEQUENCE 同样遵守）。
5. **完成即物化下一项。** `completeTask` 在同一事务里：完成当前项 → 推进指针 → 若未完成，按 `title_pattern_snapshot` 渲染下一项标题，落点解析到下一个真实可学习日（90 天窗口）。ITEMIZED 原路径保留。
6. **普通任务原地升级。** `convertTaskToLongTask` 把一个 PENDING 的 AD_HOC 任务变为 SEQUENCE 轨道的当前项：任务 id、标题快照都不变，只改 `source_type`/`track_id`/`item_ordinal`；定义按 `normalized_key` find-or-create（归一化 = NFKC + 压空白 + 小写，刻意不做去标点/模糊匹配以免误判）。历史任务不回填，`start_ordinal = current_ordinal = 当前任务序号`。
7. **序号识别与渲染复用 `seriesTitle.ts`。** 只看标题末尾连续数字（允许一个"天"后缀）；"密卷1"、"807词汇 场景12" 识别，"Lesson 3 Vocabulary" 这类数字在中间的标题留待后续扩展。
8. **UI 收敛用户心智。** 主导航「任务模板」改为「长期任务」（`/long-tasks`）；课程模板保留在 `/templates` 供 Excel 导入等高级场景，不进主导航。挂载只要「选哪个长期任务 + 从第几项开始」；TrackProgressPanel 对开放型显示"当前第 N 项 · 已完成 M 次"，不显示百分比与版本 UUID。

## 已知限制（有意保留）

1. **无自动系列识别（suggestion）。** "同一学生连续 4 次布置同名编号任务 → 建议设为长期任务"尚无后端检测；当前用户路径是右键「设为长期任务」主动转换。
2. **SEQUENCE 轨道不支持手动批量排期**（`scheduleTrackItems` 明确拒绝）：推进是自动的，混用会绕过模板渲染。
3. **同一学生同一长期任务只允许一条活跃轨道**（`LONG_TASK_ALREADY_MOUNTED`）；挂载时当前序号超出定义结束序号直接拒绝。
4. **定义编辑命令未实现**（改名/改 end 需直接改库或后续补命令）；快照机制保证这不会影响已挂载学生。
5. 迁移 `0002_sequence_long_task.sql` 用备份表 + 重建的方式放宽 NOT NULL/CHECK（SQLite 不支持原地修改），语句顺序保证 `PRAGMA foreign_keys=ON` 下可重放；`task_template` 只做加列。

## 后果

- "布置长期任务"从 建模板→版本→条目→发布→挂载 五步收敛为 建长期任务→挂载 两步，或对已经在手动记 Day N 的学生，右键一步。
- ITEMIZED 能力（版本不可变、校验和、逐项编辑、Excel 导入）全部保留，不再作为所有任务的默认入口。
- 测试基线：`sqliteLocalDataAdapter.test.ts` 29 个用例（含序列定义/挂载/推进/顺延保序/开放型/有限型/原地转换/唯一索引），`seriesTitle.test.ts` 覆盖模板构建与渲染。
