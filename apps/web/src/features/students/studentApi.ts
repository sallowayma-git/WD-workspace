import { z } from "zod";
import { getJson, patchJson, postJson } from "../../lib/api/http";

const studentTagSchema = z.object({
  code: z.string(),
  name: z.string(),
});

// FR-PROFILE-006: read model for student_subject_preference. The backend stores
// targetRatio as BigDecimal (0-100), priority as int (1-5). Both are parsed as
// numbers here — JSON has no native BigDecimal and the API always sends plain
// numbers for these columns.
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
  const params = new URLSearchParams();
  if (query?.trim()) params.set("query", query.trim());
  const suffix = params.size === 0 ? "" : `?${params.toString()}`;
  return getJson(`/students${suffix}`, studentPageSchema);
}

export function getStudent(studentId: string): Promise<Student> {
  return getJson(`/students/${studentId}`, studentSchema);
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
  return patchJson(`/students/${studentId}`, studentSchema, input);
}

export function createStudent(input: {
  studentCode: string;
  name: string;
  defaultDevicePolicy: "ALLOWED" | "NOT_ALLOWED" | "CONFIRM";
  classType?: string;
  subjectPreferences?: SubjectPreferenceInput[];
}): Promise<Student> {
  return postJson("/students", studentSchema, input);
}
