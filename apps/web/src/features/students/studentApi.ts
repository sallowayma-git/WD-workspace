import { z } from "zod";
import { getDataAdapter } from "../../data/runtime";

const studentTagSchema = z.object({
  code: z.string(),
  name: z.string(),
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
  classType: z.string().nullable(),
  enrollmentDate: z.string().nullable(),
  defaultDevicePolicy: z.enum(["ALLOWED", "NOT_ALLOWED", "CONFIRM"]),
  primaryAssistantId: z.string().uuid().nullable(),
  note: z.string().nullable(),
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
export type StudentTag = z.infer<typeof studentTagSchema>;
export type SubjectPreferenceView = z.infer<typeof subjectPreferenceSchema>;
export type SubjectPreferenceInput = z.infer<
  typeof subjectPreferenceInputSchema
>;
export type StudentPage = z.infer<typeof studentPageSchema>;

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
    primaryAssistantId: string | null;
    classType: string | null;
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
