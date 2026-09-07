export interface DataAdapter {
  getToday(date?: string): Promise<unknown>;
  getTodayCarryovers(targetDate: string): Promise<unknown>;
  triggerDayClose(businessDate: string): Promise<unknown>;
  reconcileStartup(businessDate: string): Promise<unknown>;
  getWorkbench(from?: string, to?: string): Promise<unknown>;
  getSchedule(
    studentId: string,
    params?: { from?: string; to?: string; view?: string },
  ): Promise<unknown>;

  listStudents(query?: string): Promise<unknown>;
  getStudent(studentId: string): Promise<unknown>;
  createStudent(input: Record<string, unknown>): Promise<unknown>;
  updateStudent(
    studentId: string,
    input: Record<string, unknown>,
  ): Promise<unknown>;
  deleteStudent(studentId: string): Promise<void>;

  getWeeklyPattern(studentId: string): Promise<unknown>;
  saveWeeklyPattern(
    studentId: string,
    input: Record<string, unknown>,
  ): Promise<unknown>;
  getWeekPlan(studentId: string, weekStart: string): Promise<unknown>;
  saveWeekPlan(
    studentId: string,
    weekStart: string,
    input: Record<string, unknown>,
  ): Promise<unknown>;

  listTemplates(query?: string): Promise<unknown>;
  createTemplate(input: Record<string, unknown>): Promise<unknown>;
  getTemplateDetail(templateId: string): Promise<unknown>;
  listVersionItems(versionId: string): Promise<unknown>;
  replaceVersionItems(
    versionId: string,
    input: Record<string, unknown>,
  ): Promise<void>;
  publishVersion(versionId: string): Promise<unknown>;
  createTemplateDraft(templateId: string): Promise<unknown>;
  getTemplateUsage(templateId: string): Promise<unknown>;
  getTemplateItemUsage(itemId: string): Promise<unknown>;

  listStudentTracks(studentId: string, status?: string): Promise<unknown>;
  getTrack(trackId: string): Promise<unknown>;
  mountTrack(input: Record<string, unknown>): Promise<unknown>;

  listLongTasks(query?: string): Promise<unknown>;
  createLongTask(input: Record<string, unknown>): Promise<unknown>;
  mountLongTask(input: Record<string, unknown>): Promise<unknown>;
  convertTaskToLongTask(
    taskId: string,
    input: Record<string, unknown>,
  ): Promise<unknown>;
  resumeSequenceTrack(
    trackId: string,
    input: Record<string, unknown>,
  ): Promise<unknown>;
  listSeriesSuggestions(studentId: string): Promise<unknown>;
  dismissSeriesSuggestion(
    studentId: string,
    input: Record<string, unknown>,
  ): Promise<void>;

  createAdHocTask(input: Record<string, unknown>): Promise<unknown>;
  carryForwardTask(input: Record<string, unknown>): Promise<unknown>;
  completeTask(input: Record<string, unknown>): Promise<unknown>;
  reopenTask(input: Record<string, unknown>): Promise<unknown>;
  undoCarryover(input: Record<string, unknown>): Promise<unknown>;
  rescheduleTask(input: Record<string, unknown>): Promise<unknown>;
  updateTask(taskId: string, input: Record<string, unknown>): Promise<unknown>;
  duplicateTask(taskId: string, input: Record<string, unknown>): Promise<void>;
  createNextSeriesTask(
    taskId: string,
    input: Record<string, unknown>,
  ): Promise<unknown>;
  createSubTask(
    parentTaskId: string,
    input: Record<string, unknown>,
  ): Promise<void>;
  linkMainTask(
    taskId: string,
    input: Record<string, unknown>,
  ): Promise<unknown>;
  deleteTask(taskId: string, input: Record<string, unknown>): Promise<void>;
  reorderTask(taskId: string, input: Record<string, unknown>): Promise<unknown>;

  listVocabulary(
    studentId: string,
    params?: { from?: string; to?: string; subject?: string },
  ): Promise<unknown>;
  previewVocabularyBatch(
    studentId: string,
    input: Record<string, unknown>,
  ): Promise<unknown>;
  saveVocabularyBatch(
    studentId: string,
    input: Record<string, unknown>,
  ): Promise<unknown>;
  updateVocabularyEntry(
    entryId: string,
    input: Record<string, unknown>,
  ): Promise<unknown>;

  searchGlobal(query: string, limit: number): Promise<unknown>;

  previewTemplateImport(file: File): Promise<unknown>;
  executeTemplateImport(
    jobId: string,
    mappings: Array<Record<string, unknown>>,
  ): Promise<unknown>;
  getImportErrors(
    jobId: string,
    limit?: number,
    offset?: number,
  ): Promise<unknown>;
}
