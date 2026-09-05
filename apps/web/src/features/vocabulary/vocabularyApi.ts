import { z } from "zod";
import { getDataAdapter } from "../../data/runtime";

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
  return getDataAdapter()
    .listVocabulary(studentId, { from, to, subject })
    .then((value) => listResponseSchema.parse(value));
}

export function previewVocabularyBatch(
  studentId: string,
  rawText: string,
): Promise<PreviewResponse> {
  return getDataAdapter()
    .previewVocabularyBatch(studentId, {
      rawText,
      sourceType: "MANUAL",
      subjectCode: null,
      sourceLabel: null,
    })
    .then((value) => previewResponseSchema.parse(value));
}

export function saveVocabularyBatch(
  studentId: string,
  input: { rawText: string; terms: string[] },
): Promise<string> {
  return getDataAdapter()
    .saveVocabularyBatch(studentId, {
      rawText: input.rawText,
      sourceType: "MANUAL",
      subjectCode: null,
      sourceLabel: null,
      occurredDate: null,
      terms: input.terms,
    })
    .then((value) => z.string().parse(value));
}

/** Updates status or notes while preserving the local optimistic-lock token. */
export function updateVocabularyEntry(
  entryId: string,
  input: {
    status?: VocabularyEntryStatus;
    note?: string;
    expectedVersion: number;
  },
): Promise<VocabularyEntry> {
  return getDataAdapter()
    .updateVocabularyEntry(entryId, {
      status: input.status ?? null,
      note: input.note ?? null,
      expectedVersion: input.expectedVersion,
    })
    .then((value) => entrySchema.parse(value));
}
