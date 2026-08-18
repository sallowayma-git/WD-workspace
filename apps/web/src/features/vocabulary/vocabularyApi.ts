import { z } from "zod";
import { getJson, patchJson, postJson } from "../../lib/api/http";

const entrySchema = z.object({
  id: z.string().uuid(),
  batchId: z.string().uuid(),
  studentId: z.string().uuid(),
  termOriginal: z.string(),
  termNormalized: z.string(),
  status: z.string(),
  note: z.string().nullable(),
  version: z.number(),
  createdAt: z.string(),
});

const listResponseSchema = z.object({
  entries: z.array(entrySchema),
  total: z.number(),
});

const previewEntrySchema = z.object({
  termOriginal: z.string(),
  termNormalized: z.string(),
  isDuplicate: z.boolean(),
});

const previewResponseSchema = z.object({
  entries: z.array(previewEntrySchema),
  totalCount: z.number(),
  duplicateCount: z.number(),
  duplicates: z.array(z.string()),
});

export type VocabularyEntry = z.infer<typeof entrySchema>;
export type VocabularyListResponse = z.infer<typeof listResponseSchema>;
export type PreviewEntry = z.infer<typeof previewEntrySchema>;
export type PreviewResponse = z.infer<typeof previewResponseSchema>;

export const VOCABULARY_ENTRY_STATUSES = [
  "ACTIVE",
  "MASTERED",
  "ARCHIVED",
] as const;
export type VocabularyEntryStatus = (typeof VOCABULARY_ENTRY_STATUSES)[number];

export function listVocabulary(
  studentId: string,
  from?: string,
  to?: string,
  subject?: string,
): Promise<VocabularyListResponse> {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (subject) params.set("subject", subject);
  const suffix = params.size === 0 ? "" : `?${params.toString()}`;
  return getJson(
    `/students/${studentId}/vocabulary${suffix}`,
    listResponseSchema,
  );
}

export function previewVocabularyBatch(
  studentId: string,
  rawText: string,
): Promise<PreviewResponse> {
  return postJson(
    `/students/${studentId}/vocabulary/batches:preview`,
    previewResponseSchema,
    { rawText, sourceType: "MANUAL", subjectCode: null, sourceLabel: null },
  );
}

export function saveVocabularyBatch(
  studentId: string,
  input: { rawText: string; terms: string[] },
): Promise<string> {
  return postJson(`/students/${studentId}/vocabulary/batches`, z.string(), {
    rawText: input.rawText,
    sourceType: "MANUAL",
    subjectCode: null,
    sourceLabel: null,
    occurredDate: null,
    terms: input.terms,
  });
}

/**
 * PATCH /api/v1/vocabulary/entries/{entryId} — SDD §11.8 修改状态/备注.
 * Pass undefined for a field to leave it unchanged. `expectedVersion` carries the
 * optimistic-lock token (BR-013 / AC-013).
 */
export function updateVocabularyEntry(
  entryId: string,
  input: {
    status?: VocabularyEntryStatus;
    note?: string;
    expectedVersion: number;
  },
): Promise<VocabularyEntry> {
  return patchJson(`/vocabulary/entries/${entryId}`, entrySchema, {
    status: input.status ?? null,
    note: input.note ?? null,
    expectedVersion: input.expectedVersion,
  });
}
