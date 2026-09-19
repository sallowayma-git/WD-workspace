import type { TaskLike } from "./taskApi";

/**
 * 序号标签文案。这不是排课工具，「第 N 节」是错的——逐项定义的模板
 * （ITEMIZED，Excel 导入）显示「第 N 项」。
 *
 * 长期任务（SEQUENCE）的标题本身就是按 {n} 渲染出来的，「一天一句长难句
 * Day 7」后面再挂一个「第7项」是同一个数字说两遍，所以标题末尾的数字已经
 * 等于序号时不显示标签。判断按用户实际看到的那行标题走，不靠 generationMode
 * ——省掉一路把模板模式塞进每个任务投影的管道。
 */
export function itemOrdinalLabel(task: TaskLike): string | null {
  const ordinal = task.itemOrdinal;
  if (ordinal == null) return null;
  // Series parsing intentionally accepts every numeric fragment so explicit
  // series actions can choose a counter in the middle of a title.  The compact
  // ordinal label has a narrower job: suppress duplication only when the
  // visible title itself *ends* in the same counter (optionally followed by
  // “天”).  A title such as “密卷08 阅读理解” must still show “第8项”.
  const visibleTitle = (task.shortTitle ?? task.title).trim();
  const trailingOrdinal = visibleTitle.match(/(\d+)\s*(?:天)?\s*$/);
  const titleOrdinal = trailingOrdinal ? Number(trailingOrdinal[1]) : null;
  return titleOrdinal === ordinal ? null : `第${ordinal}项`;
}

export default itemOrdinalLabel;
