import { z } from "zod";
import { getDataAdapter } from "../../data/runtime";

const templateSchema = z.object({
  id: z.string().uuid(),
  templateCode: z.string(),
  name: z.string(),
  shortName: z.string().nullable(),
  subjectCode: z.string(),
  categoryCode: z.string().nullable(),
  unitLabel: z.string(),
  defaultDurationMinutes: z.number().nullable(),
  defaultRequiresDevice: z.boolean(),
  status: z.enum(["DRAFT", "ACTIVE", "RETIRED", "ARCHIVED"]),
  currentPublishedVersionId: z.string().uuid().nullable(),
  currentPublishedVersionNumber: z.number().nullable(),
  currentItemCount: z.number().nullable(),
  version: z.number(),
  updatedAt: z.string(),
});

const templatePageSchema = z.object({
  items: z.array(templateSchema),
  page: z.number(),
  size: z.number(),
  total: z.number(),
  hasNext: z.boolean(),
});
export type TemplatePage = z.infer<typeof templatePageSchema>;

const templateVersionSchema = z.object({
  id: z.string().uuid(),
  templateId: z.string().uuid(),
  versionNumber: z.number(),
  status: z.enum(["DRAFT", "PUBLISHED", "RETIRED"]),
  itemCount: z.number(),
  changeNote: z.string().nullable(),
  publishedAt: z.string().nullable(),
  version: z.number(),
  updatedAt: z.string(),
});

const templateItemSchema = z.object({
  id: z.string().uuid(),
  ordinal: z.number(),
  itemCode: z.string().nullable(),
  title: z.string(),
  shortTitle: z.string().nullable(),
  durationMinutes: z.number().nullable(),
  requiresDevice: z.boolean().nullable(),
  contentRef: z.string().nullable(),
  instructions: z.string().nullable(),
  active: z.boolean(),
});

const templateUsageSchema = z.object({
  trackId: z.string().uuid(),
  studentId: z.string().uuid(),
  name: z.string(),
  studentCode: z.string(),
  currentOrdinal: z.number(),
  endOrdinal: z.number(),
  status: z.string(),
  nextCandidateDate: z.string().nullable(),
});

const templateItemUsageSchema = z.object({
  taskId: z.string().uuid(),
  studentId: z.string().uuid(),
  name: z.string(),
  studentCode: z.string(),
  status: z.string(),
  scheduledDate: z.string().nullable(),
  itemOrdinal: z.number().nullable(),
});

const templateDetailSchema = z.object({
  id: z.string().uuid(),
  templateCode: z.string(),
  name: z.string(),
  shortName: z.string().nullable(),
  subjectCode: z.string(),
  categoryCode: z.string().nullable(),
  unitLabel: z.string(),
  defaultDurationMinutes: z.number().nullable(),
  defaultRequiresDevice: z.boolean(),
  status: z.enum(["DRAFT", "ACTIVE", "RETIRED", "ARCHIVED"]),
  currentPublishedVersionId: z.string().uuid().nullable(),
  currentPublishedVersionNumber: z.number().nullable(),
  currentItemCount: z.number().nullable(),
  versions: z.array(templateVersionSchema),
  version: z.number(),
  updatedAt: z.string(),
});

export type TaskTemplate = z.infer<typeof templateSchema>;
export type TemplateVersion = z.infer<typeof templateVersionSchema>;
export type TemplateItem = z.infer<typeof templateItemSchema>;
export type TemplateDetail = z.infer<typeof templateDetailSchema>;
export type TemplateUsage = z.infer<typeof templateUsageSchema>;
export type TemplateItemUsage = z.infer<typeof templateItemUsageSchema>;

export function listTemplates(query?: string): Promise<TemplatePage> {
  return getDataAdapter()
    .listTemplates(query)
    .then((value) => templatePageSchema.parse(value));
}

export function createTemplate(input: {
  /** 选填：留空时本地适配器静默生成 T001 式编码（用户反馈表单必填项过多）。 */
  templateCode?: string | null;
  name: string;
  shortName?: string | null;
  /** 选填：留空时落 OTHER 兜底。 */
  subjectCode?: string | null;
  categoryCode?: string | null;
  unitLabel: string;
  defaultDurationMinutes?: number | null;
  defaultRequiresDevice: boolean;
  description?: string | null;
}): Promise<TaskTemplate> {
  return getDataAdapter()
    .createTemplate(input)
    .then((value) => templateSchema.parse(value));
}

export function getTemplateDetail(templateId: string): Promise<TemplateDetail> {
  return getDataAdapter()
    .getTemplateDetail(templateId)
    .then((value) => templateDetailSchema.parse(value));
}

export function listVersionItems(versionId: string): Promise<TemplateItem[]> {
  return getDataAdapter()
    .listVersionItems(versionId)
    .then((value) => z.array(templateItemSchema).parse(value));
}

export function replaceVersionItems(
  versionId: string,
  input: {
    items: Array<{
      ordinal: number;
      itemCode: string | null;
      title: string;
      shortTitle: string | null;
      durationMinutes: number | null;
      requiresDevice: boolean;
      contentRef: string | null;
      instructions: string | null;
      active: boolean;
    }>;
    changeNote: string | null;
  },
): Promise<void> {
  return getDataAdapter().replaceVersionItems(versionId, input);
}

export function publishVersion(versionId: string): Promise<TaskTemplate> {
  return getDataAdapter()
    .publishVersion(versionId)
    .then((value) => templateSchema.parse(value));
}

export function createTemplateDraft(templateId: string): Promise<TaskTemplate> {
  return getDataAdapter()
    .createTemplateDraft(templateId)
    .then((value) => templateSchema.parse(value));
}

export function getTemplateUsage(templateId: string): Promise<TemplateUsage[]> {
  return getDataAdapter()
    .getTemplateUsage(templateId)
    .then((value) => z.array(templateUsageSchema).parse(value));
}

export function getTemplateItemUsage(
  itemId: string,
): Promise<TemplateItemUsage[]> {
  return getDataAdapter()
    .getTemplateItemUsage(itemId)
    .then((value) => z.array(templateItemUsageSchema).parse(value));
}
