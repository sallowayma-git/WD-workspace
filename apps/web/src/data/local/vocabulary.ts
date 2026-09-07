//! 生词本：批次解析/落库与条目更新，读路径只用 core.storage。

import { ApiError } from "../../lib/api/ApiError";
import type { LocalSqlStatement } from "./LocalStorage";
import type { LocalCore } from "./localCore";
import {
  localError,
  nullableInputString,
  nullableText,
  numberValue,
  record,
  requiredString,
  text,
  type DbRow,
} from "./rows";
import { formatDate, now } from "./dates";

export async function listVocabulary(
  core: LocalCore,
  studentId: string,
  params?: { from?: string; to?: string; subject?: string },
): Promise<unknown> {
  const conditions = ["e.student_id = $1"];
  const values: unknown[] = [studentId];
  if (params?.from) {
    values.push(params.from);
    conditions.push(`e.occurred_date >= $${values.length}`);
  }
  if (params?.to) {
    values.push(params.to);
    conditions.push(`e.occurred_date <= $${values.length}`);
  }
  if (params?.subject) {
    values.push(params.subject);
    conditions.push(`e.subject_code = $${values.length}`);
  }
  const rows = await core.storage.select<DbRow>(
    `SELECT e.* FROM vocabulary_entry e
     WHERE ${conditions.join(" AND ")}
     ORDER BY e.created_at DESC, e.term_normalized`,
    values,
  );
  return {
    entries: rows.map((row) => vocabularyEntryView(row)),
    total: rows.length,
  };
}

export async function previewVocabularyBatch(
  core: LocalCore,
  studentId: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  await core.studentRow(studentId);
  const terms = normalizeVocabularyTerms(requiredString(input, "rawText"));
  const existingRows = terms.length
    ? await core.storage.select<DbRow>(
        `SELECT term_normalized FROM vocabulary_entry
         WHERE student_id = $1 AND term_normalized IN (${terms
           .map((_, index) => `$${index + 2}`)
           .join(", ")})`,
        [studentId, ...terms.map((term) => term.normalized)],
      )
    : [];
  const existing = new Set(
    existingRows.map((row) => text(row, "term_normalized")),
  );
  const entries = terms.map((term) => ({
    termOriginal: term.original,
    termNormalized: term.normalized,
    isDuplicate: existing.has(term.normalized),
  }));
  return {
    entries,
    totalCount: entries.length,
    duplicateCount: entries.filter((entry) => entry.isDuplicate).length,
    duplicates: entries
      .filter((entry) => entry.isDuplicate)
      .map((entry) => entry.termOriginal),
  };
}

export async function saveVocabularyBatch(
  core: LocalCore,
  studentId: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  await core.studentRow(studentId);
  const rawTerms = record(input, "terms");
  const terms = Array.isArray(rawTerms)
    ? normalizeVocabularyTerms(rawTerms.join("\n"))
    : normalizeVocabularyTerms(requiredString(input, "rawText"));
  const batchId = crypto.randomUUID();
  const timestamp = now();
  const occurredDate =
    nullableInputString(input, "occurredDate") ?? formatDate(new Date());
  const statements: LocalSqlStatement[] = [
    {
      sql: `INSERT INTO vocabulary_batch(
              id, student_id, occurred_date, source_type, subject_code,
              source_label, raw_text, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      values: [
        batchId,
        studentId,
        occurredDate,
        nullableInputString(input, "sourceType") ?? "MANUAL",
        nullableInputString(input, "subjectCode"),
        nullableInputString(input, "sourceLabel"),
        nullableInputString(input, "rawText"),
        timestamp,
      ],
      expectedRowsAffected: 1,
    },
  ];
  for (const term of terms) {
    statements.push({
      sql: `INSERT INTO vocabulary_entry(
              id, batch_id, student_id, occurred_date, subject_code,
              term_original, term_normalized, status, version,
              created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE', 0, $8, $8)`,
      values: [
        crypto.randomUUID(),
        batchId,
        studentId,
        occurredDate,
        nullableInputString(input, "subjectCode"),
        term.original,
        term.normalized,
        timestamp,
      ],
      expectedRowsAffected: 1,
    });
  }
  await core.storage.transaction(statements);
  return batchId;
}

export async function updateVocabularyEntry(
  core: LocalCore,
  entryId: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  const entryRows = await core.storage.select<DbRow>(
    `SELECT version FROM vocabulary_entry WHERE id = $1`,
    [entryId],
  );
  const entry = entryRows[0];
  if (!entry) {
    throw new ApiError(404, "生词条目不存在", "VOCABULARY_ENTRY_NOT_FOUND");
  }
  try {
    await core.storage.transaction([
      {
        sql: `UPDATE vocabulary_entry SET
              status = CASE WHEN $1 IS NULL THEN status ELSE $1 END,
              note = CASE WHEN $2 IS NULL THEN note ELSE $2 END,
              version = version + 1, updated_at = $3
              WHERE id = $4 AND version = $5`,
        values: [
          record(input, "status") ?? null,
          record(input, "note") ?? null,
          now(),
          entryId,
          numberValue(entry, "version"),
        ],
        expectedRowsAffected: 1,
      },
    ]);
  } catch (error) {
    localError(error);
  }
  const rows = await core.storage.select<DbRow>(
    "SELECT * FROM vocabulary_entry WHERE id = $1",
    [entryId],
  );
  if (!rows[0]) {
    throw new ApiError(404, "生词条目不存在", "VOCABULARY_ENTRY_NOT_FOUND");
  }
  return vocabularyEntryView(rows[0]);
}

function vocabularyEntryView(row: DbRow): Record<string, unknown> {
  return {
    id: text(row, "id"),
    batchId: text(row, "batch_id"),
    studentId: text(row, "student_id"),
    termOriginal: text(row, "term_original"),
    termNormalized: text(row, "term_normalized"),
    status: text(row, "status"),
    note: nullableText(row, "note"),
    version: numberValue(row, "version"),
    createdAt: text(row, "created_at"),
  };
}

function normalizeVocabularyTerms(
  rawText: string,
): Array<{ original: string; normalized: string }> {
  const seen = new Set<string>();
  const result: Array<{ original: string; normalized: string }> = [];
  for (const original of rawText
    .split(/[\s,，;；]+/)
    .map((value) => value.trim())
    .filter(Boolean)) {
    const normalized = original.normalize("NFKC").toLocaleLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push({ original, normalized });
  }
  return result;
}
