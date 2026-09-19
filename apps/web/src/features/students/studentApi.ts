import { z } from "zod";
import { getDataAdapter } from "../../data/runtime";

const studentTagSchema = z.object({
  code: z.string(),
  name: z.string(),
});

export const studentStatusLabelSchema = z.object({
  id: z.string().uuid(),
  label: z.string().min(1),
  color: z.string().nullable(),
  sortOrder: z.number(),
});

// Subject preferences use JSON-compatible numbers at the local adapter boundary.
const subjectPreferenceSchema = z.object({
  id: z.string().uuid(),
  subjectCode: z.string(),
  priority: z.number().int().min(1).max(5),
  targetRatio: z.number().min(0).max(100),
  note: z.string().nullable(),
  version: z.number(),
  updatedAt: z.string(),
});

// FR-PROFILE-006: input payload sent via Create/Update (replace semantics).
// id/version/updatedAt are server-managed and omitted on write.
export const subjectPreferenceInputSchema = z.object({
  subjectCode: z.string().min(1),
  priority: z.number().int().min(1).max(5),
  targetRatio: z.number().min(0).max(100),
  note: z.string().nullable(),
});

const studentSchema = z.object({
  id: z.string().uuid(),
  studentCode: z.string(),
  name: z.string(),
  alias: z.string().nullable(),
  status: z.enum(["ACTIVE", "PAUSED", "ARCHIVED"]),
  statusLabelId: z.string().uuid().nullable().optional(),
  statusLabel: studentStatusLabelSchema
    .omit({ sortOrder: true })
    .nullable()
    .optional(),
  classType: z.string().nullable(),
  enrollmentDate: z.string().nullable(),
  defaultDevicePolicy: z.enum(["ALLOWED", "NOT_ALLOWED", "CONFIRM"]),
  note: z.string().nullable(),
  examDate: z.string().nullable().optional(),
  archivedAt: z.string().nullable().optional(),
  tags: z.array(studentTagSchema),
  subjectPreferences: z.array(subjectPreferenceSchema),
  version: z.number(),
  updatedAt: z.string(),
});

const studentPageSchema = z.object({
  items: z.array(studentSchema),
  page: z.number(),
  size: z.number(),
  total: z.number(),
  hasNext: z.boolean(),
});

export type Student = z.infer<typeof studentSchema>;
export type StudentStatusLabel = z.infer<typeof studentStatusLabelSchema>;
export type StudentTag = z.infer<typeof studentTagSchema>;
export type SubjectPreferenceView = z.infer<typeof subjectPreferenceSchema>;
export type SubjectPreferenceInput = z.infer<
  typeof subjectPreferenceInputSchema
>;
export type StudentPage = z.infer<typeof studentPageSchema>;

export function listStudentStatusLabels(): Promise<StudentStatusLabel[]> {
  const adapter = getDataAdapter();
  if (typeof adapter.listStudentStatusLabels !== "function")
    return Promise.resolve([]);
  return adapter
    .listStudentStatusLabels()
    .then((value) => z.array(studentStatusLabelSchema).parse(value));
}

export function createStudentStatusLabel(input: {
  label: string;
  color?: string | null;
  sortOrder?: number;
}): Promise<StudentStatusLabel> {
  return getDataAdapter()
    .createStudentStatusLabel(input)
    .then((value) => studentStatusLabelSchema.parse(value));
}

export function updateStudentStatusLabel(
  id: string,
  input: { label: string; color?: string | null; sortOrder?: number },
): Promise<StudentStatusLabel> {
  return getDataAdapter()
    .updateStudentStatusLabel(id, input)
    .then((value) => studentStatusLabelSchema.parse(value));
}

export function deleteStudentStatusLabel(id: string): Promise<void> {
  return getDataAdapter()
    .deleteStudentStatusLabel(id)
    .then(() => undefined);
}

export function updateStudentCard(
  studentId: string,
  input: {
    statusLabelId?: string | null;
    classType?: string | null;
    examDate?: string | null;
    note?: string | null;
    expectedVersion: number;
  },
): Promise<Student> {
  return getDataAdapter()
    .updateStudentCard(studentId, input)
    .then((value) => studentSchema.parse(value));
}

export function listStudents(query?: string): Promise<StudentPage> {
  return getDataAdapter()
    .listStudents(query)
    .then((value) => studentPageSchema.parse(value));
}

export function getStudent(studentId: string): Promise<Student> {
  return getDataAdapter()
    .getStudent(studentId)
    .then((value) => studentSchema.parse(value));
}

export function updateStudent(
  studentId: string,
  input: {
    name: string;
    alias: string | null;
    status: Student["status"];
    defaultDevicePolicy: Student["defaultDevicePolicy"];
    classType: string | null;
    examDate?: string | null;
    enrollmentDate: string | null;
    note: string | null;
    tags: StudentTag[];
    subjectPreferences: SubjectPreferenceInput[];
    expectedVersion: number;
  },
): Promise<Student> {
  return getDataAdapter()
    .updateStudent(studentId, input)
    .then((value) => studentSchema.parse(value));
}

export function createStudent(input: {
  /** 选填：留空时由本地数据层按 S001、S002… 自动生成。 */
  studentCode?: string;
  name: string;
  defaultDevicePolicy: "ALLOWED" | "NOT_ALLOWED" | "CONFIRM";
  classType?: string;
  subjectPreferences?: SubjectPreferenceInput[];
}): Promise<Student> {
  return getDataAdapter()
    .createStudent(input)
    .then((value) => studentSchema.parse(value));
}

/** 硬删除学生及其常规周、排期、任务、轨道与生词记录，本地数据不可恢复。 */
export function deleteStudent(studentId: string): Promise<void> {
  return getDataAdapter()
    .deleteStudent(studentId)
    .then(() => undefined);
}

const archiveImpactSchema = z.object({
  pendingTaskCount: z.number().int().nonnegative(),
  tracks: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
  definitions: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
});

const archiveResultSchema = z.object({
  student: studentSchema,
  cancelledTasks: z.number().int().nonnegative(),
  pausedTracks: z.number().int().nonnegative(),
  archivedDefinitions: z.number().int().nonnegative(),
});

const restoreResultSchema = z.object({
  student: studentSchema,
  restoredTracks: z.number().int().nonnegative(),
  materializedTasks: z.number().int().nonnegative(),
  warnings: z.array(z.string()),
});

export type ArchiveImpact = z.infer<typeof archiveImpactSchema>;

export function getArchiveImpact(studentId: string): Promise<ArchiveImpact> {
  return getDataAdapter()
    .getArchiveImpact(studentId)
    .then((value) => archiveImpactSchema.parse(value));
}

export function archiveStudent(studentId: string, expectedVersion: number) {
  return getDataAdapter()
    .archiveStudent(studentId, { expectedVersion })
    .then((value) => archiveResultSchema.parse(value));
}

export function restoreStudent(
  studentId: string,
  input: { expectedVersion: number; businessDate?: string },
) {
  return getDataAdapter()
    .restoreStudent(studentId, input)
    .then((value) => restoreResultSchema.parse(value));
}
