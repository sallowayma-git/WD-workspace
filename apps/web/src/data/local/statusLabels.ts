//! Student urgency labels. These are independent from student.status, which
//! remains the lifecycle state ACTIVE/PAUSED/ARCHIVED.

import { ApiError } from "../../lib/api/ApiError";
import type { LocalCore } from "./localCore";
import {
  localError,
  nullableText,
  numberValue,
  requiredString,
  text,
  type DbRow,
} from "./rows";
import { now } from "./dates";

export const DEFAULT_STATUS_LABEL_IDS = {
  urgent: "00000000-0000-0000-0000-000000000001",
  normal: "00000000-0000-0000-0000-000000000002",
} as const;

export type StudentStatusLabel = {
  id: string;
  label: string;
  color: string | null;
  sortOrder: number;
};

function labelView(row: DbRow): StudentStatusLabel {
  return {
    id: text(row, "id"),
    label: text(row, "label"),
    color: nullableText(row, "color"),
    sortOrder: numberValue(row, "sort_order"),
  };
}

export async function listStudentStatusLabels(
  core: LocalCore,
): Promise<StudentStatusLabel[]> {
  const rows = await core.storage.select<DbRow>(
    `SELECT id, label, color, sort_order
       FROM student_status_label ORDER BY sort_order, created_at, id`,
  );
  return rows.map(labelView);
}

export async function createStudentStatusLabel(
  core: LocalCore,
  input: Record<string, unknown>,
): Promise<StudentStatusLabel> {
  const id = crypto.randomUUID();
  const timestamp = now();
  const label = requiredString(input, "label").trim();
  const color =
    typeof input.color === "string" && input.color.trim() !== ""
      ? input.color.trim()
      : null;
  const sortOrder = typeof input.sortOrder === "number" ? input.sortOrder : 0;
  try {
    await core.storage.transaction([
      {
        sql: `INSERT INTO student_status_label
          (id, label, color, sort_order, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $5)`,
        values: [id, label, color, sortOrder, timestamp],
        expectedRowsAffected: 1,
      },
    ]);
  } catch (error) {
    localError(error);
  }
  const rows = await core.storage.select<DbRow>(
    "SELECT id, label, color, sort_order FROM student_status_label WHERE id = $1",
    [id],
  );
  return labelView(rows[0]);
}

export async function updateStudentStatusLabel(
  core: LocalCore,
  id: string,
  input: Record<string, unknown>,
): Promise<StudentStatusLabel> {
  const timestamp = now();
  const existing = await core.storage.select<DbRow>(
    "SELECT id FROM student_status_label WHERE id = $1",
    [id],
  );
  if (!existing[0]) {
    throw new ApiError(404, "状态标签不存在", "STATUS_LABEL_NOT_FOUND");
  }
  const label = requiredString(input, "label").trim();
  const color =
    typeof input.color === "string" && input.color.trim() !== ""
      ? input.color.trim()
      : null;
  const sortOrder = typeof input.sortOrder === "number" ? input.sortOrder : 0;
  try {
    await core.storage.transaction([
      {
        sql: `UPDATE student_status_label
              SET label = $1, color = $2, sort_order = $3, updated_at = $4
              WHERE id = $5`,
        values: [label, color, sortOrder, timestamp, id],
        expectedRowsAffected: 1,
      },
    ]);
  } catch (error) {
    localError(error);
  }
  const rows = await core.storage.select<DbRow>(
    "SELECT id, label, color, sort_order FROM student_status_label WHERE id = $1",
    [id],
  );
  return labelView(rows[0]);
}

export async function deleteStudentStatusLabel(
  core: LocalCore,
  id: string,
): Promise<void> {
  if (id === DEFAULT_STATUS_LABEL_IDS.normal) {
    throw new ApiError(
      422,
      "不能删除默认的不紧急标签",
      "STATUS_LABEL_REQUIRED",
    );
  }
  const timestamp = now();
  try {
    await core.storage.transaction([
      {
        // Do not rely on SQLite foreign_keys: sql.js test databases run
        // without that pragma. Explicitly clear references first.
        sql: "UPDATE student SET status_label_id = NULL, updated_at = $1, version = version + 1 WHERE status_label_id = $2",
        values: [timestamp, id],
      },
      {
        sql: "DELETE FROM student_status_label WHERE id = $1",
        values: [id],
        expectedRowsAffected: 1,
      },
    ]);
  } catch (error) {
    localError(error);
  }
}
